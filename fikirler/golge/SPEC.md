# GÖLGE MUHAFIZLARI — Architecture & Content Spec (source of truth)

A Survivor.io-like mobile game prototype: dark-fantasy (Metin2 mood: torches, cursed stones, ember
and violet magic) but **cute** (chibi heroes, big-eyed monsters, sticker outlines). Portrait, one thumb.
Everything is plain browser JavaScript + Canvas 2D + DOM. No libraries, no build step, no network
(except Google Fonts already linked by the page). All UI text is **Turkish**.

This file is the contract between modules. Code ONLY against the APIs and data shapes defined here.
If something is unclear, choose the most robust interpretation and guard against missing pieces
(`if (GM.Art && GM.Art.fx) …`) instead of crashing.

---------------------------------------------------------------------------------------------------
## 0. Files, ownership, load order

```
fikirler/golge/
  sayfa.html        page fragment (artifact source)            — owner: lead (do not edit)
  index.html        standalone copy generated from sayfa.html  — regenerate with `bash tools/build-index.sh`, never edit by hand
  SPEC.md           this file                                  — owner: lead
  css/base.css      design tokens + shared components          — owner: lead (read it, use its classes)
  css/ui.css        lobby shell + home/battle-select/results/arena/settings screens — owner: ui-core
  css/meta.css      equipment/heroes/talents/training/attributes screens            — owner: ui-meta
  css/battle.css    everything inside #gm-battle                                    — owner: battle
  js/data.js        static content & constants                                      — owner: data
  js/audio.js       procedural WebAudio sfx + music                                 — owner: audio
  js/art-hero.js    heroes, equipment paper-doll, item icons, portraits             — owner: art-hero
  js/art-world.js   enemies, bosses, metin stones, ground/props, fx, pickups, skill icons — owner: art-world
  js/state.js       save/profile, economy, inventory, heroes, talents, stats math   — owner: state
  js/battle.js      the survivor run (engine, HUD, level-up cards, results hand-off) — owner: battle
  js/ui-core.js     lobby shell, router, top bar, nav, modals, toasts, home, chapter select, results, arena hub — owner: ui-core
  js/ui-meta.js     equipment, inventory, item detail, merge, skins, heroes, talents, training, attributes — owner: ui-meta
  js/main.js        boot + main loop                                                — owner: lead
```
Script order in the page: `data, audio, art-hero, art-world, state, battle, ui-core, ui-meta, main`.

Every JS file is one IIFE that only **defines** things on the shared namespace:
```js
(function (GM) {
  'use strict';
  // ...
  GM.X = { ... };
})(window.GM = window.GM || {});
```
No module may call another module's functions at load time. `main.js` boots everything on DOMContentLoaded:
`GM.S.load(); GM.UI.init(); GM.UIMeta && GM.UIMeta.init && GM.UIMeta.init();` then the RAF loop:
```js
if (GM.B && GM.B.active) GM.B.frame(dt, t); else GM.UI.frame(dt, t);   // dt seconds (≤0.05), t seconds
```
`main.js` also: unlocks audio on the first pointerdown inside `#gm` (`GM.A.unlock()`), pauses battle
(`GM.B.pause()`) and saves (`GM.S.save()`) when the tab is hidden.

Namespaces: `GM.D` data · `GM.A` audio · `GM.Art` art (both art files add to it) · `GM.S` state ·
`GM.B` battle · `GM.UI` ui-core · `GM.UIMeta` ui-meta.

### DOM (already in sayfa.html; do not change ids)
```html
<div class="gm-frame"><div id="gm" class="gm">
  <div id="gm-lobby">
    <header id="gm-top"></header>      <!-- ui-core renders the top bar -->
    <main id="gm-screen"></main>        <!-- current lobby screen is mounted here -->
    <nav id="gm-nav"></nav>             <!-- ui-core renders the bottom nav -->
  </div>
  <div id="gm-battle" hidden></div>     <!-- battle owns everything inside -->
  <div id="gm-layer"></div>             <!-- modals + toasts (ui-core) -->
</div></div>
```
`#gm` is a portrait box (≈ 390×844 on desktop, full width/height on phones). Size everything from
its `getBoundingClientRect()`; use `ResizeObserver` for canvases. Canvas DPR = `Math.min(devicePixelRatio, 2)`.
Use `[hidden]` (`el.hidden = true`) for visibility; the page has `[hidden]{display:none!important}`.

CSS class prefixes to avoid collisions: base.css (none / generic), ui-core `ui-`, ui-meta `mt-`, battle `bt-`.

### Testing helpers (any agent)
Playwright + Chromium are installed. In Node:
```js
const { chromium } = require(require('child_process').execSync('npm root -g').toString().trim() + '/playwright');
```
Serve nothing — open `file:///home/user/projects/fikirler/golge/index.html` (or your own scratch
harness page that loads only the scripts you need). Put scratch files in
`/tmp/claude-0/-home-user-projects/01062c8d-bc98-5cd6-8961-ad750f5772b7/scratchpad/golge/` (create it).
You can screenshot and then **look at the PNG with the Read tool** to judge visuals — do it.

---------------------------------------------------------------------------------------------------
## 1. Visual direction

* Dark fantasy, but cute and readable. Think Survivor.io characters (chibi, head ≈ 45% of body
  height, big shiny eyes, chunky silhouettes, dark sticker outline) placed in a Metin2-like world
  (torch-lit forest, cursed graveyards, ember mountains, glowing **Metin stones** with runes).
* Everything drawn procedurally on Canvas 2D: cel shading = base fill + darker shadow shape +
  lighter highlight shape + 2px dark outline (`#120C18`). Use additive glows (`globalCompositeOperation='lighter'`
  with radial gradients) for magic, embers, rarity auras, projectiles.
* Palette tokens are in `css/base.css` (`#gm { --bg0 … }`). Canvas code must use the same hex values
  (listed again in `GM.D.PAL`).
* Rarity is the strongest visual language: frame colour, trim colour on gear, glow strength,
  particles. Rarity hexes: `GM.D.RARITIES[i].col` (also `--r0…--r5`).
* Motion everywhere: idle breathing, walk bob, attack anticipation + follow-through, squash/stretch
  and white flash on hit, dissolve-to-soul on death, floating embers in menus, number pops.
* Respect `prefers-reduced-motion` for screen shake and big flashes (reduce, don't remove gameplay).

---------------------------------------------------------------------------------------------------
## 2. Data (js/data.js) — `GM.D`

All ids are ASCII lowercase as written below. Names (`n`) are Turkish. Every list below is
**fixed**: other modules rely on these ids existing.

### 2.1 Palette
`GM.D.PAL = { bg0:'#09070D', bg1:'#120E19', bg2:'#1A1424', bg3:'#241B31', line:'#3B2E50', tx:'#F4EEFF',
tx2:'#BDB1D6', gold:'#FFCB57', gold2:'#E39A2D', blood:'#E8394D', ember:'#FF7A2F', violet:'#9D6BFF',
teal:'#3EDBC8', green:'#5BD16E', blue:'#4BA3FF', outline:'#120C18' }`

### 2.2 Rarities — `GM.D.RARITIES` (array, index = rarity number 0..5)
```js
{ id:'siradan', n:'Sıradan', col:'#A7ADB7', dark:'#5D6370', mult:1.00, maxLv:10, subs:0, glow:0 }
{ id:'iyi',     n:'İyi',     col:'#5BD16E', dark:'#2C7A3A', mult:1.30, maxLv:20, subs:1, glow:0 }
{ id:'nadir',   n:'Nadir',   col:'#4BA3FF', dark:'#1F5DA8', mult:1.70, maxLv:30, subs:2, glow:0.3 }
{ id:'destansi',n:'Destansı',col:'#B565FF', dark:'#6A2BB0', mult:2.25, maxLv:40, subs:3, glow:0.6 }
{ id:'efsanevi',n:'Efsanevi',col:'#FFB020', dark:'#A8620A', mult:3.00, maxLv:50, subs:3, glow:0.85 }
{ id:'mitik',   n:'Mitik',   col:'#FF3D4F', dark:'#8E1324', mult:4.00, maxLv:60, subs:4, glow:1.0 }
```

### 2.3 Equipment slots — `GM.D.SLOTS` (array, this order is the UI order)
| id | n (UI) | poss (name suffix form) | group (scroll type) | main stat key | base | grow |
|---|---|---|---|---|---|---|
| silah | Silah | — | silah | atk | 30 | 0.12 |
| kafa | Miğfer | Miğferi | zirh | hp | 90 | 0.10 |
| yuz | Maske | Maskesi | taki | crit | 0.015 | 0.04 |
| boyun | Kolye | Kolyesi | taki | atk | 12 | 0.12 |
| omuz | Omuzluk | Omuzluğu | zirh | def | 8 | 0.10 |
| gogus | Göğüslük | Göğüslüğü | zirh | hp | 140 | 0.10 |
| kol | Kolluk | Kolluğu | zirh | def | 6 | 0.10 |
| eldiven | Eldiven | Eldiveni | zirh | atk | 10 | 0.12 |
| kemer | Kemer | Kemeri | zirh | hp | 70 | 0.10 |
| pantolon | Pantolon | Pantolonu | zirh | hp | 100 | 0.10 |
| dizlik | Dizlik | Dizliği | zirh | def | 7 | 0.10 |
| ayak | Çizme | Çizmesi | zirh | spdPct | 0.03 | 0.03 |

Object shape: `{ id, n, poss, group, main, base, grow }`.
**Main stat value** of an item (state implements exactly this):
`main = base * RARITIES[rar].mult * (1 + grow * (lvl - 1))` (crit/spdPct are fractions).

### 2.4 Weapon types — `GM.D.WEAPONS` (object keyed by id). Every hero can use every type.
```js
kilic: { id:'kilic', n:'Kılıç', desc:'Önündeki yayda geniş bir kesik atar.', range:95,  cd:0.75, kind:'melee' }
yay:   { id:'yay',   n:'Yay',   desc:'En yakın düşmana delip geçen oklar atar.', range:520, cd:0.60, kind:'ranged' }
orak:  { id:'orak',  n:'Orak',  desc:'Etrafında tam tur dönen ağır bir savuruş.', range:115, cd:1.30, kind:'melee' }
asa:   { id:'asa',   n:'Asa',   desc:'Hedef arayan, patlayan büyü küreleri.',     range:480, cd:0.90, kind:'ranged' }
```
Item display names for weapons by rarity (`GM.D.WEAPON_NAMES[type][rar]`, 6 each), e.g. kılıç:
`['Paslı Kılıç','Demir Kılıç','Gece Kılıcı','Kor Kılıç','Ejder Dişi','Kıyamet']` — write all 4×6.

### 2.5 Armor sets — `GM.D.SETS` (object keyed by id; the set gives the *shape/motif* of the gear)
```js
kurt:  { id:'kurt',  n:'Kurt Postu',   motif:'leather+fur, brown/tan',          bonus:{4:{hpPct:0.08},  8:{spdPct:0.06}} }
gece:  { id:'gece',  n:'Gece Bekçisi', motif:'dark steel + navy cloth, rivets', bonus:{4:{defPct:0.10}, 8:{crit:0.05}} }
kor:   { id:'kor',   n:'Kor Şövalye',  motif:'blackened plate, glowing ember cracks', bonus:{4:{atkPct:0.08}, 8:{e_ates:0.20}} }
ejder: { id:'ejder', n:'Ejder Pulu',   motif:'crimson scales + gold trim, small horns', bonus:{4:{critDmg:0.25}, 8:{skillDmg:0.15}} }
golge: { id:'golge', n:'Gölge Kralı',  motif:'obsidian, violet/red runes, smoke wisps', bonus:{4:{lifesteal:0.04}, 8:{atkPct:0.15}} }
```
Set bonus counts only armor slots (all except `silah`). Item name = `SETS[set].n + ' ' + SLOTS[slot].poss`
(e.g. "Kor Şövalye Miğferi"). Weapons use WEAPON_NAMES.
`GM.D.SET_BY_RARITY = [['kurt'],['kurt','gece'],['gece','kor'],['kor','ejder'],['ejder','golge'],['golge']]`
(sets a newly generated item can roll at each rarity).

### 2.6 Substats — `GM.D.SUBSTATS` (array) `{ k, n, min:[6 values by rarity], max:[6 values], fmt:'pct'|'flat'|'int' }`
Keys allowed: `atkPct, hpPct, defPct, crit, critDmg, spdPct, cdr, lifesteal, pickup, xpGain, goldGain, skillDmg, eliteDmg, bossDmg, regen`.
Values are fractions for pct keys. Item substats are rolled once on creation: count = `RARITIES[rar].subs`,
distinct keys, uniform in [min[rar], max[rar]].

### 2.7 Stat keys (the ONLY modifier keys allowed anywhere: passives, talents, sets, substats, attributes, training)
```
atk hp def                      flat
atkPct hpPct defPct             fraction
crit                            fraction added to base 0.05
critDmg                         fraction added to base 1.5 (crit multiplier)
spdPct                          fraction (move speed)
cdr                             fraction (skill & weapon cooldown reduction, cap 0.5)
lifesteal                       fraction of damage dealt healed (cap 0.2)
regen                           HP per second
pickup                          fraction (pickup radius)
xpGain goldGain                 fraction
area                            fraction (all AoE / arc / radius sizes)
projCount pierce                integer bonus (weapon + projectile skills)
dur                             fraction (skill effect duration)
eliteDmg bossDmg skillDmg       fraction
w_kilic w_yay w_orak w_asa      fraction (main weapon damage by type)
e_ates e_buz e_yildirim e_zehir e_golge   fraction (skill damage by element)
dodge                           fraction chance to avoid a hit (cap 0.4)
ultCharge ultDmg                fraction
revive                          integer (extra lives, revive at 50% HP)
startLvl                        integer (start the run with this many free level-ups)
execute                         fraction: non-boss enemies hit while below this HP fraction die
thorns                          fraction of damage taken dealt back to attacker
shieldStart                     flat shield HP at run start
killHeal                        HP healed per kill
```
`GM.D.STAT_LABELS[key] = { n:'Saldırı %', fmt:'pct'|'flat'|'int' }` for every key above (UI uses it).

### 2.8 Heroes — `GM.D.HEROES` (array of 5)
```js
{ id:'bora', n:'Bora', cls:'Savaşçı', rar:2 /*Nadir*/, weapon:'kilic', unlock:{type:'start'},
  desc:'…', base:{ atk:24, hp:420, def:12, spd:1.0 }, passive:{ w_kilic:0.30, hpPct:0.15 },
  passiveText:['Kılıç hasarı +%30','Can +%15'],
  ult:{ id:'kasirga', n:'Kasırga', desc:'…' },
  look:{ skin:'#F2C7A5', hair:'#5A3424', cloth:'#8E2F2F', accent:'#C9CED8', eye:'#3A2A20', extra:'headband' },
  talents:[ BRANCH, BRANCH, BRANCH ] }
```
The 5 heroes (fixed ids, classes, weapon affinity, ult ids):
| id | n | cls | rar | weapon | passive (minimum) | ult id / n | unlock |
|---|---|---|---|---|---|---|---|
| bora | Bora | Savaşçı | 2 | kilic | w_kilic .30, hpPct .15 | kasirga / Kasırga (4 s whirlwind AoE) | start |
| ela | Ela | Okçu | 3 | yay | w_yay .30, crit .10 | okYagmuru / Ok Yağmuru (3 s arrow rain over screen) | start |
| yaman | Yaman | Sura | 3 | orak | w_orak .30, lifesteal .05 | golgePatlama / Gölge Patlaması (screen-wide dark burst + 4 s lifesteal) | gems 500 |
| ayaz | Ayaz | Şaman | 3 | asa | w_asa .30, cdr .10, regen 2 | firtina / Fırtına Ruhu (5 s lightning storm + heal 30%) | gems 500 |
| alaz | Alaz | Ejder Muhafızı | 4 | kilic | e_ates .40, atkPct .10, skillDmg .10 | ejderNefesi / Ejder Nefesi (a dragon crosses the screen breathing fire) | gems 1500 |

`unlock`: `{type:'start'}` or `{type:'gems', cost:500}`.
`look.extra` ∈ `'headband'|'hood'|'scar'|'feathers'|'horns'` (art-hero draws it).

**Talent BRANCH** (RoK-style; 3 branches per hero, each 8–10 nodes):
```js
{ id:'bora_saldiri', n:'Saldırı', col:'#E8394D', nodes:[
  { id:'bora_s1', n:'Keskin Kenar', max:3, eff:{ w_kilic:0.03 }, req:[], row:0, col:1, icon:'sword' },
  { id:'bora_s2', n:'…', max:5, eff:{ atkPct:0.02 }, req:['bora_s1'], row:1, col:0, icon:'fist' },
  … last node: max:1, big:true, eff:{ execute:0.10 }, text:'Canı %10'un altındaki düşmanları tek vuruşta öldür.' } ] }
```
* `eff` values are **per rank**; total = value × rank.
* `req` = node ids that must have ≥1 rank (and the branch must have ≥ `row*3` points spent — state enforces `row*3`).
* `row` 0..5, `col` 0..2 (grid position inside the branch; UI draws lines along `req`).
* `icon` ∈ `sword bow scythe staff fist shield heart boot clock star skull flame snow bolt drop eye crown wing`.
* Every branch ends with exactly one `big:true` capstone (max 1) with a strong / special effect.
* Branch themes: bora: Saldırı / Savunma / Liderlik · ela: Nişancı / Avcı / Rüzgâr · yaman: Lanet / Kan / Gölge ·
  ayaz: Fırtına / Şifa / Ruh · alaz: Ateş / Ejder / Muhafız. Capacity per hero ≈ 80–95 ranks (> 60 points).

Hero progression constants `GM.D.HERO_PROG = { maxLvByStar:[0,20,30,40,50,60], goldBase:120, goldGrow:1.085,
shardsByStar:[0,10,20,40,80,0] /* shards needed to go from star s to s+1 */, lvlStatGrow:0.04, starStatGrow:0.10,
pointsPerLevel:1 }`. Heroes start at lvl 1, star 1.

### 2.9 Skins — `GM.D.SKINS` (array; fixed ids)
`{ id, n, target, rar, cost:{gems:N} | {type:'start'}, desc }` where `target` is `'silah:<type>'`, `'slot:<slotId>'` or `'hero:<heroId>'`.
```
sk_kilic_ejder  Ejder Dişi Kılıcı   silah:kilic   rar 4  start
sk_kilic_buz    Ayaz Kılıcı         silah:kilic   rar 3  gems 300
sk_yay_kemik    Kemik Yay           silah:yay     rar 3  gems 300
sk_yay_ay       Hilal Yay           silah:yay     rar 4  gems 450
sk_orak_ruh     Ruh Biçen           silah:orak    rar 4  gems 450
sk_asa_kristal  Kristal Asa         silah:asa     rar 4  gems 450
sk_kafa_boynuz  Boynuzlu Miğfer     slot:kafa     rar 3  start
sk_kafa_tac     Gölge Tacı          slot:kafa     rar 5  gems 800
sk_omuz_kafatasi Kafatası Omuzluk   slot:omuz     rar 3  gems 250
sk_gogus_kanat  Kanatlı Zırh        slot:gogus    rar 4  gems 600   (small animated wings on the back)
sk_yuz_iblis    İblis Maskesi       slot:yuz      rar 3  gems 250
sk_ayak_alev    Alev Çizmeler       slot:ayak     rar 4  gems 400   (fire trail while walking)
sk_bora_kurt    Kurt Lordu Bora     hero:bora     rar 4  gems 600
sk_ela_gece     Gece Avcısı Ela     hero:ela      rar 4  gems 600
sk_yaman_kan    Kan Ayı Yaman       hero:yaman    rar 4  gems 600
sk_ayaz_kis     Kış Ruhu Ayaz       hero:ayaz     rar 4  gems 600
sk_alaz_kara    Kara Ejder Alaz     hero:alaz     rar 5  gems 900
```
Skins are cosmetic only.

### 2.10 Training (gold upgrades) — `GM.D.TRAINING` (array)
```js
{ id:'atk', n:'Saldırı Eğitimi', key:'atk', per:3,  max:200, costBase:80, costGrow:1.045 }
{ id:'hp',  n:'Dayanım Eğitimi', key:'hp',  per:30, max:200, costBase:80, costGrow:1.045 }
{ id:'def', n:'Zırh Eğitimi',    key:'def', per:2,  max:200, costBase:80, costGrow:1.045 }
{ id:'crit',n:'Odak Eğitimi',    key:'crit',per:0.002, max:100, costBase:150, costGrow:1.06 }
```
Cost of next level L→L+1 = `round(costBase * costGrow^L)`.

### 2.11 Attributes (GTA-style, grow ONLY by playing) — `GM.D.ATTRS` (array of 6)
```js
{ id:'dayaniklilik', n:'Dayanıklılık', icon:'heart', src:'distance',   factor:0.01, base:6,   eff:{ key:'hpPct',    per:0.004 }, how:'Savaşta koştukça artar.' }
{ id:'guc',          n:'Güç',          icon:'fist',  src:'meleeKills', factor:1,    base:9,   eff:{ key:'w_kilic',  per:0.004 }, …, eff2:{ key:'w_orak', per:0.004 } }
{ id:'nisan',        n:'Nişancılık',   icon:'bow',   src:'rangedHits', factor:0.5,  base:12,  eff:{ key:'w_yay',    per:0.004 }, eff2:{ key:'w_asa', per:0.004 } }
{ id:'ceviklik',     n:'Çeviklik',     icon:'boot',  src:'nearMisses', factor:1,    base:5,   eff:{ key:'dodge',    per:0.0015 } }
{ id:'buyu',         n:'Büyü Gücü',    icon:'star',  src:'skillDamage',factor:0.002,base:8,   eff:{ key:'skillDmg', per:0.004 } }
{ id:'hayatta',      n:'Hayatta Kalma',icon:'clock', src:'time',       factor:0.25, base:4,   eff:{ key:'regen',    per:0.03 } }
```
* Level 0..100. XP to go from L to L+1: `need(L) = round(base * Math.pow(L + 1, 1.6))`.
* XP gained from a run = `result[src] * factor`. Tune `base`/`factor` so a typical 4-minute run
  gives roughly +5…+10 levels at the very start and level 100 needs **hundreds** of runs
  (document the estimate in a comment). Data agent: compute and adjust.
* Effect at level L = `per * L` for `eff` (and `eff2` if present).

### 2.12 Run skills (in-battle level-up cards) — `GM.D.RUN_SKILLS` (array) — fixed ids
Actives (max level 5; one evolution each, unlocked when the active is Lv5 and its paired passive is owned):
| id | n | element | evo pair | evolved id / n |
|---|---|---|---|---|
| kilicHalka | Dönen Kılıçlar | none | celikYurek | kilicFirtina / Kılıç Fırtınası |
| yildirim | Yıldırım Çağrısı | yildirim | kumSaati | gokGurultusu / Gök Gürültüsü |
| atesTopu | Ateş Topu | ates | gucTasi | cehennem / Cehennem Ateşi |
| buzHalka | Buz Novası | buz | buyutec | mutlakSifir / Mutlak Sıfır |
| zehir | Zehir Şişesi | zehir | kanKadeh | vebaBulutu / Veba Bulutu |
| bumerang | Gölge Bıçağı | golge | ruzgarCizme | olumDansi / Ölüm Dansı |
| meteor | Meteor | ates | bilgeKitap | kiyamet / Kıyamet Yağmuru |
| ruhlar | Ruh Fenerleri | golge | miknatis | ruhOrdusu / Ruh Ordusu |

Passives (max level 5): `gucTasi` Güç Taşı (+10% atk/lv) · `celikYurek` Çelik Yürek (+10% max HP/lv, +0.5 regen/lv) ·
`kumSaati` Kum Saati (−6% cooldown/lv) · `buyutec` Büyüteç (+8% area/lv) · `kanKadeh` Kan Kadehi (+1.5% lifesteal/lv) ·
`ruzgarCizme` Rüzgâr Çizmesi (+6% speed/lv) · `bilgeKitap` Bilge Kitabı (+10% XP/lv) · `miknatis` Mıknatıs Taşı (+25% pickup/lv).
Weapon card: `silahUst` Silah Ustalığı (max 5): upgrades the equipped main weapon.

Shape: `{ id, n, type:'active'|'passive'|'weapon'|'evo', el:'none'|'ates'|'buz'|'yildirim'|'zehir'|'golge',
max:5, desc:['Lv1 text', … 'Lv5 text'], evo:{ with:'celikYurek', to:'kilicFirtina' } /* actives only */,
from:'kilicHalka' /* evo only */ }`. Evolved entries are in the same array with `type:'evo'`, `max:1`.
Run limits: 6 active slots (weapon card counts as one) and 6 passive slots.

### 2.13 Enemies — `GM.D.ENEMIES` (object keyed by id; fixed ids)
`{ id, n, hp, dmg, spd, r, xp, kind, art, elite?:true, boss?:true }`
kinds: `'chase'` (walk at hero), `'fast'` (zigzag fast), `'tank'` (slow, big), `'ranged'` (keeps ~220px, shoots
`shot` projectiles), `'swarm'` (spawns in packs), `'charger'` (walks, then dashes), `'stone'` (Metin stone).
| id | n | kind | notes |
|---|---|---|---|
| yarasa | Kan Yarasası | fast | tiny, fragile |
| kurt | Gölge Kurdu | charger | |
| mantar | Zehirli Mantar | tank | leaves a small poison puff on death |
| iskelet | İskelet Er | chase | |
| hayalet | Ağlayan Hayalet | ranged | passes through others, shoots ectoplasm |
| orumcek | Mağara Örümceği | swarm | |
| korCini | Kor Cini | fast | fire imp |
| golem | Taş Golem | tank | elite:true |
| buyucu | Kemik Büyücü | ranged | elite:true, shoots 3-way |
| kurtKral | Kurt Kral | boss | boss:true — dashes, howl summons wolves |
| kemikEjder | Kemik Ejder | boss | boss:true — breath cone, bone rain |
| korIblisi | Kor İblisi | boss | boss:true — fire rings, meteor slam |
| metin | Metin Taşı | stone | spawns 3 enemies of the chapter every 3 s until broken; drops a chest |

Numbers are base values at chapter 1; battle scales by chapter (`GM.D.CHAPTERS[i].scale`) and by time.

### 2.14 Chapters — `GM.D.CHAPTERS` (array)
```js
{ id:1, n:'Kara Orman', sub:'Kurt Kral'ın İni', theme:'orman', dur:240, scale:1.0, rec:1200 /*recommended power*/,
  energy:5, waves:[ { from:0, to:60, rate:1.2, pool:{ yarasa:3, kurt:1 } }, … ],
  events:[ { t:30, type:'ring', e:'yarasa', n:18 }, { t:45, type:'metin' }, { t:90, type:'elite', e:'golem' },
           { t:120, type:'swarm', e:'yarasa', n:30 }, … { t:225, type:'boss', e:'kurtKral' } ],
  reward:{ gold:400, gems:50 /*first clear*/, heroXp:120, chest:[60,30,9,1,0,0] /*rarity weights*/, shards:5 } }
```
4 chapters: `1 Kara Orman (orman, boss kurtKral)`, `2 Lanetli Mezarlık (mezarlik, boss kemikEjder)`,
`3 Kor Dağı (kor, boss korIblisi)`, `4 Gölge Kalesi (kale, locked:true, no waves — "Yakında")`.
Event types: `ring` (circle of enemies around hero), `swarm` (a dense stream crossing the screen),
`elite`, `metin` (a Metin stone appears 300px from the hero, arrow indicator), `boss` (normal spawns stop,
an arena ring wall traps the player, boss intro banner). The run is **won** when the boss dies, lost when
HP hits 0 with no revives. If the boss is still alive at `dur + 60` s it enrages (×1.5 dmg).

### 2.15 Economy constants — `GM.D.ECON`
```js
{ startGold:3000, startGems:800, energyMax:30, energyRegenSec:300, runEnergy:5,
  itemUp:{ goldBase:60, goldGrow:1.09, scroll:(lvl)=>1+Math.floor(lvl/5) },
  goldPerKill:1, goldPerElite:25, goldPerMetin:60, goldPerBoss:250, accXpPerRun:40, accXpNeed:(L)=>100+60*L }
```

### 2.16 Starter inventory — `GM.D.STARTER`
Array of item seeds `{ slot, rar, set?, wt?, lvl? , equip?:true }`. Requirements:
* Equipped: Nadir `kilic` weapon, Sıradan/İyi pieces in ~8 armor slots (not all 12, so empty slots show the hero's own clothes).
* In bag (not equipped): one Destansı `kor` göğüslük, one Efsanevi `yay`, three identical Sıradan `kurt` miğfer (to demo merging),
  two more İyi items, one Nadir `ejder` maske. ~15–18 items total.

---------------------------------------------------------------------------------------------------
## 3. State (js/state.js) — `GM.S`

Persistence: `localStorage` key `'golge-muhafizlari-v1'`, wrapped in try/catch (the page must work
without storage). Auto-save on every mutating call (debounced 300 ms) and `save()` explicitly.

### 3.1 Profile `GM.S.p`
```js
{ v:1, name:'Muhafız', accLvl:1, accXp:0, gold, gems, energy, energyTs /*ms*/,
  items:[ ITEM ], equip:{ silah:uid|null, kafa:…, … all 12 }, scrolls:{ silah:n, zirh:n, taki:n },
  shards:{ bora:0, … }, heroes:{ bora:{ id, owned, lvl, stars, talents:{ nodeId:rank }, skin:null }, … },
  active:'bora', train:{ atk:0, hp:0, def:0, crit:0 }, attrs:{ dayaniklilik:{ lvl:0, xp:0 }, … },
  skins:{ owned:[ids], sel:{ /* target → skinId */ } }, chapters:{ max:1, best:{ /* id:{ time, cleared } */ } },
  totals:{ runs:0, kills:0, bosses:0, playSec:0 }, settings:{ sound:true, music:true } }
```
ITEM = `{ uid:'i' + base36, slot, rar, lvl, set /* armor */, wt /* weapon type, silah only */, subs:[{k,v}], new:true }`.

### 3.2 API (all must exist)
```
load()  save()  reset()                      // reset() wipes to a fresh profile (with STARTER)
on(evt, fn)  off(evt, fn)  emit(evt, data)   // events: 'change' (any mutation), 'gold', 'gems', 'energy',
                                             // 'item', 'equip', 'hero', 'talent', 'train', 'attr', 'skin', 'level'
addGold(n)  spendGold(n)->bool  addGems(n)  spendGems(n)->bool
getEnergy()->{ cur, max, nextInSec }  spendEnergy(n)->bool          // regen computed from energyTs
itemName(item)->string   itemMain(item)->{ k, v }   itemSubs(item)->[{k,v}]   itemPower(item)->number
makeItem(seed)->ITEM     addItem(item)   removeItem(uid)   getItem(uid)->ITEM|null   bag()->ITEM[] (unequipped, sorted rar desc, slot order)
equip(uid)->bool   unequip(slotId)->bool   equipped(slotId)->ITEM|null
upgradeCost(item)->{ gold, scroll, scrollType }   canUpgrade(item)->{ ok, reason }   upgradeItem(uid)->bool
mergeCandidates(uid)->uid[]   /* same slot, same rarity, same wt for weapons, not the item itself, unequipped */
merge(uids /*exactly 3, first is the base*/)->ITEM|null  /* result rar+1, keeps base set/wt, lvl=max(lvls) clamped, new subs added to reach count */
sell(uid)->gold                                       // optional but implement (gold = 20*(rar+1)*lvl)
hero(id)->hero state   heroDef(id)->D.HEROES entry   ownedHeroes()->ids   setActive(id)->bool
unlockHero(id)->bool   heroLevelCost(id)->gold   levelUpHero(id)->bool   heroMaxLv(id)
starCost(id)->shards   starUpHero(id)->bool
talentPoints(id)->{ total, used, free }   branchSpent(id, branchId)->n
canRank(id, nodeId)->{ ok, reason }   rankTalent(id, nodeId)->bool   resetTalents(id, free?)->bool  // reset costs 100 gems unless free
trainCost(id)->gold   train(id)->bool
attr(id)->{ lvl, xp, need, pct /*0..1*/ }   addAttrXP(id, xp)->levelsGained   attrBonus()->{ key:value }
ownsSkin(id)  buySkin(id)->bool  setSkin(target, skinId|null)  skinFor(target)->skinId|null
computeStats(heroId = active)->SHEET     power(heroId = active)->int
appearance(heroId = active)->LOOK
canStart(chapterId)->{ ok, reason }   startRun(chapterId)->bool   finishRun(RESULT)->REWARDS
chapterState()->{ max, best }
```
### 3.3 Combat stat sheet `SHEET` (computeStats)
```js
{ heroId, weapon:'kilic', weaponRar:2, atk, hp, def, spd /* px/s = 160*(1+spdPct) */, crit /*0.05+…*/, critDmg /*1.5+…*/,
  cdr, lifesteal, regen, pickup /* px = 70*(1+pickup) */, xpGain /* multiplier 1+… */, goldGain /* 1+… */, area /* 1+… */,
  projCount, pierce, dur /*1+…*/, eliteDmg /*1+…*/, bossDmg /*1+…*/, skillDmg /*1+…*/,
  wDmg:{ kilic, yay, orak, asa } /* 1 + w_<type> */, elem:{ ates, buz, yildirim, zehir, golge, none:1 } /* 1 + e_<el> */,
  dodge, ultCharge /*1+…*/, ultDmg /*1+…*/, revive, startLvl, execute, thorns, shieldStart, killHeal,
  mods:{ every raw key summed }, power }
```
Computation order: hero base × (1 + lvlStatGrow·(lvl−1)) × (1 + starStatGrow·(stars−1)) → + training flat → + gear flat
(main stats + flat subs) → aggregate all fractional mods (gear subs, set bonuses, hero passive, talents, attributes, training crit)
→ `atk = (atkBase + atkFlat) * (1 + atkPct)` (same for hp, def) → caps (cdr ≤ .5, lifesteal ≤ .2, dodge ≤ .4).
`power = round(atk*10 + hp*0.9 + def*12 + (crit-0.05)*3000 + (critDmg-1.5)*800 + (skillDmg-1)*600 + …)` — any monotone formula over the sheet, documented in a comment.

### 3.4 Appearance `LOOK` (for art)
```js
{ heroId, heroSkin:skinId|null, weapon:{ wt, rar, skin }, gear:{ kafa:{ rar, set, skin }|null, yuz:…, … (11 armor slots) } }
```
`skin` here is the selected skin for that slot/weapon type (or null).

### 3.5 Run result `RESULT` (battle → finishRun) and `REWARDS`
```js
RESULT = { chapterId, won, time, kills, killsByType:{ id:n }, elites, bosses, metins, chests, goldPicked,
           distance /*px*/, meleeKills, rangedHits, skillDamage, nearMisses, damageTaken, runLevel, heroId }
REWARDS = { gold, gems, heroXp /* informational */, accXp, accLevelUp:bool, shards:{ heroId:n }, scrolls:{ silah,zirh,taki },
            items:[ ITEM ] /* already added to bag */, attrs:[ { id, n, from, to, xp } ], firstClear:bool, unlockedChapter:int|null }
```
finishRun rules: gold = goldPicked × goldGain + (won ? chapter.reward.gold : 25% of it); items: 1 per chest + (won ? 2 : 0),
rarity rolled from `chapter.reward.chest` weights; gems only on first clear; shards to the active hero
(won ? reward.shards : 1); scrolls 1–3 random; attributes from §2.11. Unlock next chapter on win.

---------------------------------------------------------------------------------------------------
## 4. Art — `GM.Art`

### 4.1 art-hero.js
```
GM.Art.drawHero(ctx, x, y, scale, o)
  o = { look: LOOK, t, anim:'idle'|'walk'|'attack'|'hurt'|'victory'|'cast', dir:1|-1, atkP:0..1, glow:true, shadow:true, lite:false }
  Feet at (x, y). At scale 1 the hero is ~100 px tall (head ≈ 45%). All 12 slots must be visible
  when equipped (helmet, mask/face piece, necklace, shoulder pads, chest, bracers, gloves, belt, pants,
  knee pads, boots, weapon in hand). Empty slots show the hero's own outfit (look colours + extra).
  Gear form comes from the set motif; trim/glow from rarity; skins override form; Destansı+ pieces
  glow, Efsanevi adds an aura, Mitik adds red-black flame wisps. Weapon drawn by type (kilic, yay, orak, asa)
  + rarity + weapon skin; attack anim swings it. `lite:true` = cheaper drawing for battle (skip tiny details).
GM.Art.drawItemIcon(ctx, x, y, size, item|seed, t)   // seed { slot, rar, set, wt, skin? }. Square icon with rarity
  background (gradient + inner bevel + corner shine; glow/particles for rar ≥ 3), the piece centred. No text.
GM.Art.drawHeroPortrait(ctx, x, y, size, heroId, t, heroSkin)   // head + shoulders bust in a circle-friendly square
GM.Art.drawTalentIcon(ctx, x, y, size, iconName, color, t)      // the icon names of §2.8
GM.Art.drawAttrIcon(ctx, x, y, size, iconName, t)               // reuse the same icon set
```
### 4.2 art-world.js
```
GM.Art.drawEnemy(ctx, e, t)        e = { type, x, y, r, dir, hitT /*sec since hit, large = none*/, hpPct, elite, frozen, burning, poisoned, dying /*0..1*/ }
GM.Art.drawBoss(ctx, b, t)         b = { type, x, y, r, dir, hitT, hpPct, phase:'idle'|'move'|'dash'|'cast'|'enrage', castP:0..1 }
GM.Art.drawMetin(ctx, m, t)        m = { x, y, r, hpPct, hitT, theme }
GM.Art.bake(drawFn, w, h, frames)  -> { frames:[canvas], w, h }    // drawFn(ctx, cx, cy, frameT) — sprite cache helper
GM.Art.bakeEnemy(type, frames)     -> { frames:[canvas], w, h, ox, oy }  // pre-rendered walk cycle at r = ENEMIES[type].r (white-flash variant: .flash[canvas])
GM.Art.ground(theme)               -> canvas (512×512 seamless tile, cached)
GM.Art.chunkProps(theme, cx, cy, size) -> [{ kind, x, y, s, light? }]   // deterministic per chunk (seeded); light:{ r, col } for torches/lava/crystals
GM.Art.drawProp(ctx, p, t)
GM.Art.drawPickup(ctx, kind, x, y, t)   // kind: 'xp1' 'xp2' 'xp3' 'gold' 'heal' 'magnet' 'bomb' 'chest'
GM.Art.drawSkillIcon(ctx, x, y, size, skillId, t)   // every RUN_SKILLS id incl. evolved + 'silahUst'
GM.Art.fx = {
  slash(ctx, x, y, r, ang, arc, p, col),           // melee arc, p 0..1
  spin(ctx, x, y, r, p, col),                       // orak full circle sweep
  arrow(ctx, x, y, ang, col), orb(ctx, x, y, r, col, t), fireball(ctx, x, y, r, ang, t),
  bolt(ctx, x1, y1, x2, y2, t, col),                // jagged lightning
  nova(ctx, x, y, r, p, col), explosion(ctx, x, y, r, p, col), pool(ctx, x, y, r, t, col),
  meteorShadow(ctx, x, y, r, p), blade(ctx, x, y, r, ang, col), wisp(ctx, x, y, r, t, col),
  soul(ctx, x, y, p, col), beam(ctx, x, y, h, col, t) /* loot beam by rarity colour */,
  shadow(ctx, x, y, rx, ry)
}
```
Themes: `orman`, `mezarlik`, `kor`, `kale`. Props per theme (trees/roots/mushrooms/torches · graves/crosses/candles/dead
trees/lanterns · lava cracks/obsidian rocks/braziers · banners/pillars). Provide `light` for light-emitting props.

---------------------------------------------------------------------------------------------------
## 5. Audio — `GM.A`
```
unlock()  setSfx(bool)  setMusic(bool)  sfxOn  musicOn
play(name, { vol, pitch })   // throttled per name; unknown names ignored
music(name|null)             // 'lobby' | 'battle' | 'boss' | null — procedural loops, low CPU, crossfade
```
Names: `click tab open close equip unequip upgrade merge levelup reward rare legendary error
 slash arrow magic scythe hit crit enemyDie playerHurt pickup gold chest skillPick evolve ult bossRoar
 explosion lightning ice fire poison victory defeat metinBreak buy whoosh`.
Dark-fantasy flavour: low drones, metallic shimmers, choir-like pads (detuned saws through lowpass), taiko-ish drums.
Respect `GM.S.p.settings.sound/music` (ui calls setSfx/setMusic). Never throw before unlock.

---------------------------------------------------------------------------------------------------
## 6. Battle — `GM.B` (js/battle.js + css/battle.css)
```
GM.B.active (bool)   GM.B.start(chapterId)   GM.B.frame(dt, t)   GM.B.pause()   GM.B.resume()   GM.B.quit()
```
* `start`: called by ui-core **after** `GM.S.startRun(id)` succeeded. Hides `#gm-lobby`, shows `#gm-battle`,
  builds its own DOM inside it (canvas + HUD + overlays), sets `active = true`, `GM.A.music('battle')`.
* Controls: floating virtual joystick — touch/drag anywhere on the battle canvas moves the hero (Survivor.io);
  WASD/arrows on desktop. Ult button bottom-right (charges with kills/damage, glows when full; also key Space).
  Pause button top-right. Hero auto-attacks with the equipped weapon type.
* World: infinite, chunked ground (`GM.Art.ground`, `chunkProps`), camera follows hero, darkness overlay with light
  around the hero, torches/lava/crystals (prop lights), projectiles and explosions also light up. Floating embers.
* Enemies: spatial hash for collisions; use baked sprites (`GM.Art.bakeEnemy`) for normals so 200+ run at 60 fps.
  Elites have a glow + crown marker and drop a chest. Bosses: intro banner with name, arena ring wall, HP bar.
* Pickups: XP gems (3 sizes, merge when too many), gold, heal (meat), magnet, bomb, chest (opens a 1-of-3 free upgrade / or
  roulette — show it). Equipment found at the end is decided by `finishRun` (chests counted).
* Level-up: pause, show 3 cards (`GM.Art.drawSkillIcon` on small canvases), rarity frames, level stars, "YENİ", "EVRİM" glow,
  reroll button (1 per run). Apply SHEET stats + run skills. All §2.7 keys must have an effect.
* Ultimates: implement all 5 (`kasirga okYagmuru golgePatlama firtina ejderNefesi`) with cinematic flash, banner, effects.
* HUD: hero HP bar over hero, top: in-run level + XP bar, timer, kill count, gold; skill slots row (6 actives + 6 passives small icons).
* Damage numbers (pop, crit = bigger gold with "!"), hit flash, knockback, screen shake (reduced-motion aware), hit-stop on boss hits.
* Run stats tracked for RESULT (§3.5). On end: slow-mo + "ZAFER" / "YENİLDİN" banner → `const rew = GM.S.finishRun(result)` →
  hide battle, show lobby, `GM.UI.showResults(rew, result)`, `active=false`, `GM.A.music('lobby')`.
* Pause menu: Devam, Ses on/off, Pes Et (quit = loss). Revive prompt if SHEET.revive > 0 (auto).
* Tutorial hint on first run (joystick ghost hand).

---------------------------------------------------------------------------------------------------
## 7. UI — `GM.UI` (ui-core.js + css/ui.css) and `GM.UIMeta` (ui-meta.js + css/meta.css)

### 7.1 ui-core owns
```
GM.UI.init()  GM.UI.frame(dt, t)  GM.UI.go(screenId, params)  GM.UI.back()  GM.UI.current
GM.UI.reg(id, { title, tab, mount(el, params), unmount(), frame(dt,t) })   // ui-meta registers its screens here
GM.UI.modal(contentNodeOrHtml, { title, cls, onClose }) -> { el, close() }
GM.UI.toast(text, kind /* 'ok'|'warn'|'rare'|'info' */)
GM.UI.confirm({ title, text, ok, cancel }) -> Promise<bool>
GM.UI.floatNum(el, text, color)          // floating "+1.240" over an element
GM.UI.showResults(REWARDS, RESULT)
GM.UI.refreshTop()
GM.UI.refresh()                          // top bar + nav badges + re-mount current screen if it asks (screen.refresh?.())
GM.UI.canvas(el, draw /* (ctx,w,h,t) */) -> { cv, stop() }  // helper: DPR-sized canvas inside el, redrawn every UI frame while mounted
```
* Top bar: account level badge + XP ring, power (Savaş Gücü), energy (cur/max + regen timer), gold, gems.
* Bottom nav (5): `ekipman` (Ekipman), `kahraman` (Kahramanlar), `savas` (center, big — Savaş), `gelisim` (Gelişim), `arena` (Arena).
  Badges (red dots) when something is upgradable / new items.
* Screens owned by ui-core: `savas` (home: animated hero showcase on a dark altar with embers + rarity aura, power, chapter card
  carousel with boss art preview, BAŞLA button with energy cost, chapter map with 4 chapters), `arena` (multiplayer hub: Arena PvP,
  Lonca, Ortak Zindan, Dünya Boss — locked "Yakında" cards with teaser art + a mock season leaderboard), `ayarlar` (sound, music,
  reset profile with confirm), results screen (overlay with reward reveal: items flip one by one with rarity beams, attribute bars
  filling, gold counting up).
* Default screen at boot: `savas`.
### 7.2 ui-meta owns (registers via GM.UI.reg at its own init)
* `GM.UIMeta = { init(), badges() -> { ekipman:n, kahraman:n, gelisim:n } }` — ui-core calls `badges()` (guarded) to draw nav red dots.
* Each registered screen may expose `refresh()`; ui-core calls it on `GM.S` 'change' events while mounted.
* `ekipman`: hero paper-doll (canvas, `GM.Art.drawHero` large, slow idle) with the 12 slots around it (6 left / 6 right) showing
  `drawItemIcon` + level; power + key stats; set bonus summary; bag grid below (filter by slot, sort), "Birleştir" mode
  (select 3 → forge animation → reveal), item detail modal (big icon, name in rarity colour, rarity, level, main + subs, set,
  compare with equipped, Kuşan/Çıkar, Yükselt (cost gold + scrolls, long-press repeat), Görünüm (skins for that slot/weapon), Sat).
* `kahraman`: hero roster cards (portrait, class, rarity frame, stars, level, owned/locked + unlock price), hero detail
  (big animated hero in their default look + current gear, passive bonuses, ult description, level up (gold), star up (shards),
  "Aktif Yap"), hero skins, talent tree screen (3 branch tabs, node grid with connecting lines, ranks x/y, points left,
  node detail popover, reset).
* `gelisim`: two tabs — `Eğitim` (gold training rows with level, bonus, cost, buy; hold-to-repeat) and `Nitelikler`
  (6 GTA-style attributes 0–100: big segmented bars, current bonus, how it grows, total lifetime numbers).

---------------------------------------------------------------------------------------------------
## 8. Quality bar
* Zero console errors. Every button does something (or explains why not with a toast).
* 60 fps target on mid phones; never allocate gradients per enemy per frame (bake), cap particles.
* Numbers formatted Turkish style (`1.240`, `%12`). Use `toLocaleString('tr-TR')`.
* Make it feel like a premium mobile game: juicy, animated, consistent, surprising details.
