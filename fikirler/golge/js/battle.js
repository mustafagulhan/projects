/* GÖLGE MUHAFIZLARI — battle.js  (owner: battle)  ·  Namespace: GM.B  (SPEC §6)
 *
 * The whole survivor run: engine, enemies, bosses, weapons, run skills + evolutions, ultimates,
 * pickups, level-up cards, chest roulette, darkness/light layer, HUD, pause/revive/end flow and the
 * RESULT hand-off to GM.S.finishRun (SPEC §3.5).
 *
 *   GM.B.active                  true while a run owns the screen
 *   GM.B.start(chapterId)        called by ui-core after GM.S.startRun(id) succeeded
 *   GM.B.frame(dt, t)            main loop tick (dt seconds ≤ 0.05, t seconds)
 *   GM.B.pause() / resume()      pause menu (tab hidden → pause)
 *   GM.B.quit()                  immediate surrender (counts as a loss)
 *   GM.B._debug = { skip(sec), god(on), kill() } + test helpers: auto(on) autopilot, resolve() auto-pick open
 *     overlays, spawn(type, n), level(n), give(skillId, n), pick(i), chest(rar), ult(), die(), hurt(v), time(t),
 *     info(), lights(), flags({ noDark, noGround, noEmb, noTint }) (render toggles for profiling)
 *   Extras: GM.B.lastResult / GM.B.lastRewards (after a run), GM.B.perf() (frame-time stats)
 *
 * Tuning notes (measured with the autopilot probe, chapter 1, starter gear): a 4-minute run ends around run
 * level 21–25 (needXp), ~1 400 kills, 140–170 enemies on screen late; per-frame JS ≈ 4–5 ms with 200 enemies.
 *
 * Engine notes: every hot path is allocation-free (object pools + preallocated query buffers), enemies
 * live in a spatial hash (64 px cells) for separation and hits, sprites come from GM.Art (baked),
 * the darkness layer is a ½-resolution canvas filled with darkness and punched with one cached radial
 * sprite per light (destination-out), drawn over the world; emissive fx are drawn after it.
 * Every call into another module is guarded — a missing module never crashes the run.
 */
(function (GM) {
  'use strict';

  /* ============================================================================================
   * Math + small helpers
   * ========================================================================================== */
  var PI = Math.PI, TAU = PI * 2, HPI = PI / 2;
  var sin = Math.sin, cos = Math.cos, abs = Math.abs, mn = Math.min, mx = Math.max, sqrt = Math.sqrt;
  var atan2 = Math.atan2, floor = Math.floor, round = Math.round, rand = Math.random, exp = Math.exp, ceil = Math.ceil;
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function lerp(a, b, k) { return a + (b - a) * k; }
  function eOut(k) { k = 1 - clamp(k, 0, 1); return 1 - k * k * k; }
  function eIn(k) { k = clamp(k, 0, 1); return k * k; }
  function eBack(k) { k = clamp(k, 0, 1) - 1; return 1 + 2.70158 * k * k * k + 1.70158 * k * k; }
  function rr(a, b) { return a + rand() * (b - a); }
  function ri(a, b) { return a + floor(rand() * (b - a + 1)); }
  function angDiff(a, b) { var d = (a - b) % TAU; if (d > PI) d -= TAU; else if (d < -PI) d += TAU; return d; }
  function num(v, d) { v = +v; return isFinite(v) ? v : (d == null ? 0 : d); }
  function fmt(n) { n = round(+n || 0); try { return n.toLocaleString('tr-TR'); } catch (e) { return String(n); } }
  function fmt1(n) { try { return (+n || 0).toLocaleString('tr-TR', { maximumFractionDigits: 1 }); } catch (e) { return String(round(n * 10) / 10); } }
  function fmtTime(s) { s = mx(0, floor(s)); var m = floor(s / 60), r = s % 60; return (m < 10 ? '0' : '') + m + ':' + (r < 10 ? '0' : '') + r; }
  function now() { return (window.performance && performance.now) ? performance.now() : Date.now(); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : '&quot;'; }); }

  var RGBC = Object.create(null);
  function rgbOf(h) {
    var c = RGBC[h]; if (c) return c;
    var m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(h || ''));
    if (m) { var s = m[1]; if (s.length === 3) s = s[0] + s[0] + s[1] + s[1] + s[2] + s[2]; var n = parseInt(s, 16); c = [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
    else c = [200, 200, 200];
    RGBC[h] = c; return c;
  }
  function rgba(h, a) { var c = rgbOf(h); return 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + a + ')'; }
  var MIXC = Object.create(null);
  function mixc(a, b, k) {
    var key = a + b + k, v = MIXC[key]; if (v) return v;
    var A = rgbOf(a), Bc = rgbOf(b);
    var r = round(A[0] + (Bc[0] - A[0]) * k), g = round(A[1] + (Bc[1] - A[1]) * k), bl = round(A[2] + (Bc[2] - A[2]) * k);
    v = '#' + ((1 << 24) | (r << 16) | (g << 8) | bl).toString(16).slice(1);
    MIXC[key] = v; return v;
  }

  var warned = Object.create(null);
  function warnOnce(label, e) {
    if (warned[label]) return; warned[label] = 1;
    try { console.warn('[GM.B] ' + label + ':', e && e.message ? e.message : e); } catch (x) { /* ignore */ }
  }
  /* audio — guarded, one reusable options object */
  var SFXO = { vol: 1, pitch: 1 };
  function sfx(name, vol, pitch) {
    var A = GM.A; if (!A || typeof A.play !== 'function') return;
    SFXO.vol = vol == null ? 1 : vol; SFXO.pitch = pitch == null ? 1 : pitch;
    try { A.play(name, SFXO); } catch (e) { warnOnce('A.play', e); }
  }
  function music(name) { var A = GM.A; if (A && typeof A.music === 'function') { try { A.music(name); } catch (e) { warnOnce('A.music', e); } } }
  function duck(a, s) { var A = GM.A; if (A && typeof A.duck === 'function') { try { A.duck(a, s); } catch (e) { /* optional */ } } }
  function ART() { return GM.Art || null; }
  function FXA() { var A = GM.Art; return A && A.fx ? A.fx : null; }

  /* ============================================================================================
   * Data access (GM.D) with small SPEC fallbacks
   * ========================================================================================== */
  function DD() { return GM.D || {}; }
  var FB_WEAPONS = {
    kilic: { id: 'kilic', n: 'Kılıç', range: 95, cd: 0.75, kind: 'melee' },
    yay: { id: 'yay', n: 'Yay', range: 520, cd: 0.60, kind: 'ranged' },
    orak: { id: 'orak', n: 'Orak', range: 115, cd: 1.30, kind: 'melee' },
    asa: { id: 'asa', n: 'Asa', range: 480, cd: 0.90, kind: 'ranged' }
  };
  var FB_RAR = ['#A7ADB7', '#5BD16E', '#4BA3FF', '#B565FF', '#FFB020', '#FF3D4F'];
  var FB_EL = { none: { n: 'Fiziksel', col: '#C9CED8' }, ates: { n: 'Ateş', col: '#FF7A2F' }, buz: { n: 'Buz', col: '#7FD8FF' },
    yildirim: { n: 'Yıldırım', col: '#FFE45C' }, zehir: { n: 'Zehir', col: '#8BE04E' }, golge: { n: 'Gölge', col: '#9D6BFF' } };
  var FB_EN = {
    yarasa: { id: 'yarasa', n: 'Kan Yarasası', kind: 'fast', hp: 40, dmg: 6, spd: 125, r: 12, xp: 1 },
    kurt: { id: 'kurt', n: 'Gölge Kurdu', kind: 'charger', hp: 110, dmg: 12, spd: 80, r: 18, xp: 2, dash: { spd: 330, every: 3.2, dur: 0.45, range: 260, windup: 0.5 } },
    mantar: { id: 'mantar', n: 'Zehirli Mantar', kind: 'tank', hp: 260, dmg: 14, spd: 42, r: 22, xp: 3, puff: { r: 55, dps: 6, dur: 2.5 } },
    iskelet: { id: 'iskelet', n: 'İskelet Er', kind: 'chase', hp: 75, dmg: 10, spd: 68, r: 16, xp: 1 },
    hayalet: { id: 'hayalet', n: 'Ağlayan Hayalet', kind: 'ranged', hp: 90, dmg: 9, spd: 62, r: 16, xp: 2, ghost: true, keep: 220,
      shot: { spd: 170, dmg: 10, cd: 2.6, r: 7, n: 1, spread: 0, col: '#7DF5C8' } },
    orumcek: { id: 'orumcek', n: 'Mağara Örümceği', kind: 'swarm', hp: 42, dmg: 7, spd: 100, r: 11, xp: 1, pack: 7 },
    korCini: { id: 'korCini', n: 'Kor Cini', kind: 'fast', hp: 70, dmg: 11, spd: 135, r: 13, xp: 2 },
    golem: { id: 'golem', n: 'Taş Golem', kind: 'tank', hp: 2600, dmg: 28, spd: 40, r: 38, xp: 40, elite: true },
    buyucu: { id: 'buyucu', n: 'Kemik Büyücü', kind: 'ranged', hp: 1800, dmg: 18, spd: 52, r: 24, xp: 35, elite: true, keep: 240,
      shot: { spd: 200, dmg: 16, cd: 2.0, r: 9, n: 3, spread: 0.35, col: '#B565FF' } },
    kurtKral: { id: 'kurtKral', n: 'Kurt Kral', kind: 'boss', hp: 22000, dmg: 30, spd: 95, r: 48, xp: 100, boss: true, title: 'Kara Orman’ın Hükümdarı', summon: 'kurt' },
    kemikEjder: { id: 'kemikEjder', n: 'Kemik Ejder', kind: 'boss', hp: 26000, dmg: 34, spd: 70, r: 56, xp: 150, boss: true, title: 'Mezarlığın Kadim Bekçisi' },
    korIblisi: { id: 'korIblisi', n: 'Kor İblisi', kind: 'boss', hp: 30000, dmg: 40, spd: 78, r: 54, xp: 200, boss: true, title: 'Dağın Yanan Yüreği' },
    metin: { id: 'metin', n: 'Metin Taşı', kind: 'stone', hp: 3000, dmg: 0, spd: 0, r: 34, xp: 30, spawnEvery: 3, spawnN: 3 }
  };
  var FB_CH = { id: 1, n: 'Kara Orman', theme: 'orman', dur: 240, scale: 1, ramp: { hp: 0.3, dmg: 0.12 }, maxAlive: 170,
    waves: [{ from: 0, to: 60, rate: 1.0, pool: { yarasa: 3, iskelet: 2 } }, { from: 60, to: 240, rate: 2.4, pool: { yarasa: 2, iskelet: 2, kurt: 2, orumcek: 2 } }],
    events: [{ t: 20, type: 'ring', e: 'yarasa', n: 14 }, { t: 45, type: 'metin' }, { t: 90, type: 'elite', e: 'golem' }, { t: 215, type: 'boss', e: 'kurtKral' }],
    reward: { gold: 400 } };
  /* compact copy of the RUN_SKILLS numbers (used only when GM.D lacks a table) */
  var FB_SK_LIST = [
    { id: 'kilicHalka', n: 'Dönen Kılıçlar', type: 'active', el: 'none', max: 5, rar: 2, evo: { with: 'celikYurek', to: 'kilicFirtina' },
      lv: [{ n: 2, dmg: 0.5, r: 80, spd: 3 }, { n: 3, dmg: 0.5, r: 80, spd: 3 }, { n: 3, dmg: 0.7, r: 80, spd: 3.6 }, { n: 4, dmg: 0.7, r: 80, spd: 3.6 }, { n: 5, dmg: 0.9, r: 100, spd: 3.6 }] },
    { id: 'yildirim', n: 'Yıldırım Çağrısı', type: 'active', el: 'yildirim', max: 5, rar: 3, evo: { with: 'kumSaati', to: 'gokGurultusu' },
      lv: [{ n: 2, dmg: 1.2, cd: 2 }, { n: 3, dmg: 1.2, cd: 2 }, { n: 3, dmg: 1.5, cd: 1.7 }, { n: 4, dmg: 1.5, cd: 1.7 }, { n: 5, dmg: 1.9, cd: 1.5 }] },
    { id: 'atesTopu', n: 'Ateş Topu', type: 'active', el: 'ates', max: 5, rar: 2, evo: { with: 'gucTasi', to: 'cehennem' },
      lv: [{ n: 1, dmg: 1, cd: 1.6, r: 45, burn: 2 }, { n: 2, dmg: 1, cd: 1.6, r: 45, burn: 2 }, { n: 2, dmg: 1.3, cd: 1.6, r: 54, burn: 2 }, { n: 3, dmg: 1.3, cd: 1.6, r: 54, burn: 2 }, { n: 3, dmg: 1.7, cd: 1.2, r: 54, burn: 4 }] },
    { id: 'buzHalka', n: 'Buz Novası', type: 'active', el: 'buz', max: 5, rar: 3, evo: { with: 'buyutec', to: 'mutlakSifir' },
      lv: [{ dmg: 0.8, cd: 3, r: 120, slow: 0.4, slowDur: 2, freeze: 0 }, { dmg: 1, cd: 3, r: 138, slow: 0.4, slowDur: 2, freeze: 0 }, { dmg: 1, cd: 2.5, r: 138, slow: 0.55, slowDur: 2, freeze: 0 },
        { dmg: 1.3, cd: 2.5, r: 159, slow: 0.55, slowDur: 2, freeze: 0 }, { dmg: 1.6, cd: 2.5, r: 159, slow: 0.55, slowDur: 2, freeze: 1 }] },
    { id: 'zehir', n: 'Zehir Şişesi', type: 'active', el: 'zehir', max: 5, rar: 2, evo: { with: 'kanKadeh', to: 'vebaBulutu' },
      lv: [{ n: 1, dps: 0.4, dur: 3, cd: 2.5, r: 60, amp: 0 }, { n: 2, dps: 0.4, dur: 3, cd: 2.5, r: 60, amp: 0 }, { n: 2, dps: 0.55, dur: 3, cd: 2.5, r: 72, amp: 0 },
        { n: 3, dps: 0.55, dur: 4, cd: 2.5, r: 72, amp: 0 }, { n: 3, dps: 0.75, dur: 4, cd: 2.5, r: 72, amp: 0.1 }] },
    { id: 'bumerang', n: 'Gölge Bıçağı', type: 'active', el: 'golge', max: 5, rar: 3, evo: { with: 'ruzgarCizme', to: 'olumDansi' },
      lv: [{ n: 1, dmg: 0.9, cd: 1.8, range: 260, pierce: 3, spd: 1 }, { n: 2, dmg: 0.9, cd: 1.8, range: 260, pierce: 3, spd: 1 }, { n: 2, dmg: 1.15, cd: 1.8, range: 312, pierce: 3, spd: 1 },
        { n: 3, dmg: 1.15, cd: 1.8, range: 312, pierce: 3, spd: 1 }, { n: 3, dmg: 1.5, cd: 1.8, range: 312, pierce: 99, spd: 1.2 }] },
    { id: 'meteor', n: 'Meteor', type: 'active', el: 'ates', max: 5, rar: 4, evo: { with: 'bilgeKitap', to: 'kiyamet' },
      lv: [{ n: 1, dmg: 2.5, cd: 5, r: 90, lava: 0 }, { n: 1, dmg: 3.2, cd: 5, r: 90, lava: 0 }, { n: 2, dmg: 3.2, cd: 4.5, r: 90, lava: 0 }, { n: 2, dmg: 4, cd: 4.5, r: 108, lava: 0 }, { n: 3, dmg: 4, cd: 4.5, r: 108, lava: 2 }] },
    { id: 'ruhlar', n: 'Ruh Fenerleri', type: 'active', el: 'golge', max: 5, rar: 3, evo: { with: 'miknatis', to: 'ruhOrdusu' },
      lv: [{ n: 1, dmg: 0.6, cd: 1.2, bounce: 0 }, { n: 2, dmg: 0.6, cd: 1.2, bounce: 0 }, { n: 2, dmg: 0.8, cd: 1, bounce: 0 }, { n: 3, dmg: 0.8, cd: 1, bounce: 0 }, { n: 4, dmg: 1, cd: 1, bounce: 1 }] },
    { id: 'gucTasi', n: 'Güç Taşı', type: 'passive', el: 'none', max: 5, rar: 1, per: { atkPct: 0.10 } },
    { id: 'celikYurek', n: 'Çelik Yürek', type: 'passive', el: 'none', max: 5, rar: 1, per: { hpPct: 0.10, regen: 0.5 } },
    { id: 'kumSaati', n: 'Kum Saati', type: 'passive', el: 'none', max: 5, rar: 1, per: { cdr: 0.06 } },
    { id: 'buyutec', n: 'Büyüteç', type: 'passive', el: 'none', max: 5, rar: 1, per: { area: 0.08 } },
    { id: 'kanKadeh', n: 'Kan Kadehi', type: 'passive', el: 'none', max: 5, rar: 1, per: { lifesteal: 0.015 } },
    { id: 'ruzgarCizme', n: 'Rüzgâr Çizmesi', type: 'passive', el: 'none', max: 5, rar: 1, per: { spdPct: 0.06 } },
    { id: 'bilgeKitap', n: 'Bilge Kitabı', type: 'passive', el: 'none', max: 5, rar: 1, per: { xpGain: 0.10 } },
    { id: 'miknatis', n: 'Mıknatıs Taşı', type: 'passive', el: 'none', max: 5, rar: 1, per: { pickup: 0.25 } },
    { id: 'silahUst', n: 'Silah Ustalığı', type: 'weapon', el: 'none', max: 5, rar: 4,
      lv: [{ dmg: 0.2, rate: 0, extra: 0, mastery: 0 }, { dmg: 0.2, rate: 0.15, extra: 0, mastery: 0 }, { dmg: 0.2, rate: 0.15, extra: 1, mastery: 0 }, { dmg: 0.5, rate: 0.15, extra: 1, mastery: 0 }, { dmg: 0.5, rate: 0.15, extra: 1, mastery: 1 }] },
    { id: 'kilicFirtina', n: 'Kılıç Fırtınası', type: 'evo', el: 'none', max: 1, rar: 5, from: 'kilicHalka', with: 'celikYurek', lv: [{ n: 8, dmg: 1.3, r: 115, spd: 4.2, knock: 1 }] },
    { id: 'gokGurultusu', n: 'Gök Gürültüsü', type: 'evo', el: 'yildirim', max: 1, rar: 5, from: 'yildirim', with: 'kumSaati', lv: [{ n: 6, dmg: 2.2, cd: 1, chain: 2 }] },
    { id: 'cehennem', n: 'Cehennem Ateşi', type: 'evo', el: 'ates', max: 1, rar: 5, from: 'atesTopu', with: 'gucTasi', lv: [{ n: 4, dmg: 2.5, cd: 1, r: 70, burn: 4, pierce: 99, trail: 1 }] },
    { id: 'mutlakSifir', n: 'Mutlak Sıfır', type: 'evo', el: 'buz', max: 1, rar: 5, from: 'buzHalka', with: 'buyutec', lv: [{ dps: 1.2, r: 190, freeze: 1.5, shatter: 1 }] },
    { id: 'vebaBulutu', n: 'Veba Bulutu', type: 'evo', el: 'zehir', max: 1, rar: 5, from: 'zehir', with: 'kanKadeh', lv: [{ dps: 0.9, r: 150, follow: 1, leech: 0.02 }] },
    { id: 'olumDansi', n: 'Ölüm Dansı', type: 'evo', el: 'golge', max: 1, rar: 5, from: 'bumerang', with: 'ruzgarCizme', lv: [{ n: 6, dmg: 1.7, cd: 1.4, pierce: 99, spiral: 1 }] },
    { id: 'kiyamet', n: 'Kıyamet Yağmuru', type: 'evo', el: 'ates', max: 1, rar: 5, from: 'meteor', with: 'bilgeKitap', lv: [{ n: 6, dmg: 4.5, cd: 2, r: 120, lava: 3 }] },
    { id: 'ruhOrdusu', n: 'Ruh Ordusu', type: 'evo', el: 'golge', max: 1, rar: 5, from: 'ruhlar', with: 'miknatis', lv: [{ n: 6, dmg: 1.1, cd: 0.7, bounce: 3 }] }
  ];
  var FB_SK = Object.create(null);
  FB_SK_LIST.forEach(function (s) { FB_SK[s.id] = s; });
  var EMPTY_LV = { n: 1, dmg: 1, cd: 2, r: 60, spd: 3 };
  var NO = Object.freeze({});        // shared empty fallback (no allocations in hot paths)

  function weaponDef(id) { var W = DD().WEAPONS; return (W && W[id]) || FB_WEAPONS[id] || FB_WEAPONS.kilic; }
  function enemyDef(id) { var E = DD().ENEMIES; return (E && E[id]) || FB_EN[id] || null; }
  function rarCol(r) { var R0 = DD().RARITIES; r = clamp(r | 0, 0, 5); return (R0 && R0[r] && R0[r].col) || FB_RAR[r]; }
  function elInfo(el) { var E = DD().ELEMENTS; return (E && E[el]) || FB_EL[el] || FB_EL.none; }
  function skList() { var L = DD().RUN_SKILLS; return L && L.length ? L : FB_SK_LIST; }
  var SKD = Object.create(null);           // id -> def (cached per run)
  function skDef(id) {
    var d = SKD[id]; if (d) return d;
    var L = skList();
    for (var i = 0; i < L.length; i++) if (L[i].id === id) { d = L[i]; break; }
    d = d || FB_SK[id] || null;
    if (d) SKD[id] = d;
    return d;
  }
  function skLv(id, lv) {
    var d = skDef(id), a = (d && d.lv && d.lv.length ? d.lv : (FB_SK[id] && FB_SK[id].lv));
    if (!a || !a.length) return EMPTY_LV;
    return a[clamp(lv | 0, 1, a.length) - 1] || EMPTY_LV;
  }
  function chapterDef(id) {
    var D = DD(), C = D.CHAPTERS;
    if (C) for (var i = 0; i < C.length; i++) if (+C[i].id === +id) return C[i];
    return (C && C[0]) || FB_CH;
  }
  function heroDef(id) {
    var H0 = DD().HEROES;
    if (H0) for (var i = 0; i < H0.length; i++) if (H0[i].id === id) return H0[i];
    return (H0 && H0[0]) || { id: 'bora', n: 'Bora', weapon: 'kilic', ult: { id: 'kasirga', n: 'Kasırga', dur: 4, col: '#C9CED8' }, lines: {} };
  }

  /* ============================================================================================
   * Constants
   * ========================================================================================== */
  var CAP_EN = 300, CAP_PART = 500, CAP_NUM = 60, CAP_PROJ = 260, CAP_EB = 180, CAP_PICK = 420, CAP_FX = 160;
  var CAP_ZONE = 56, CAP_TELE = 56, CAP_CORPSE = 80, CAP_LIGHT = 90;
  var HERO_SCALE = 0.62, HERO_R = 14, HERO_CY = 24;   // collision radius, body-centre height above the feet
  var CHUNK = 512;
  var K_WEAPON = 1, K_SKILL = 2, K_ULT = 3, K_DOT = 4, K_THORN = 5, K_BOMB = 6;
  var THEMES = {
    orman:    { dark: '5,8,7',   a: 0.88, emb: ['#D8FF8A', '#FFD27A', '#9BFFB0'], fog: '#0E1A12', hero: '#FFE2B0' },
    mezarlik: { dark: '4,7,10',  a: 0.88, emb: ['#7DFFE0', '#C8FFF4', '#9DB8FF'], fog: '#0C1618', hero: '#D6FFF4' },
    kor:      { dark: '13,5,3',  a: 0.82, emb: ['#FF8A3A', '#FFC07A', '#FF5A1F'], fog: '#200A06', hero: '#FFD0A0' },
    kale:     { dark: '8,4,13',  a: 0.9, emb: ['#B57BFF', '#FF7AA0', '#E0C8FF'], fog: '#140A1C', hero: '#F0D8FF' }
  };
  var RM_KEYS = ['atkPct', 'hpPct', 'regen', 'cdr', 'area', 'lifesteal', 'spdPct', 'xpGain', 'pickup', 'critDmg', 'crit', 'skillDmg', 'dur', 'goldGain', 'defPct'];
  var REDUCED = false;
  try { REDUCED = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches); } catch (e) { REDUCED = false; }

  /* ============================================================================================
   * Pools (allocation-free swap-remove lists)
   * ========================================================================================== */
  function Pool(cap, make) { this.a = new Array(cap); this.n = 0; this.cap = cap; for (var i = 0; i < cap; i++) this.a[i] = make(); }
  Pool.prototype.take = function () { return this.n < this.cap ? this.a[this.n++] : null; };
  Pool.prototype.kill = function (i) { var a = this.a, l = --this.n; if (i !== l) { var t = a[i]; a[i] = a[l]; a[l] = t; } };
  Pool.prototype.clear = function () { this.n = 0; };

  var UID = 1;
  function mkEnemy() {
    return { uid: 0, id: 0, type: '', def: null, kind: '', x: 0, y: 0, vx: 0, vy: 0, kx: 0, ky: 0, r: 10, zy: 0, dk: 1,
      hp: 1, maxHp: 1, dmg: 1, spd: 1, mass: 1, elite: false, boss: false, stone: false, ghost: false, dead: false, inv: false,
      dir: 1, hitT: 99, hpPct: 1, frozen: false, burning: false, poisoned: false, dying: 0, moving: true, _aw: undefined,
      atkCd: 0, slowT: 0, slow: 0, frzT: 0, burnT: 0, burnDps: 0, poisT: 0, poisDps: 0, amp: 0, dotT: 0,
      st: 0, stT: 0, ax: 0, ay: 0, shotCd: 0, castP: 0, mode: 0, modeT: 0, phase: 'move',
      cdHalka: -9, cdUlt: -9, cdRing: -9, nearT: -1, nearD: 0, nearHit: false, nearCd: 0, qs: 0, xp: 1,
      inA: 0, spawnT: 0, flashT: 0, enr: false, bs: '', bt: 0, bi: 0, bk: 0, bx: 0, by: 0, ba: 0, bn: 0, lift: 0, intro: 0, lastHurt: 0 };
  }
  function mkProj() {
    return { kind: 0, x: 0, y: 0, vx: 0, vy: 0, ang: 0, spd: 0, r: 6, dmg: 0, life: 0, max: 1, t: 0, pierce: 0, hl: new Int32Array(32), hn: 0,
      el: 'none', src: K_SKILL, tgt: null, tuid: 0, col: '#fff', st: 0, ox: 0, oy: 0, tx: 0, ty: 0, range: 0, bounce: 0, a: 0, b: 0, c: 0, rot: 0, px: 0, py: 0, lx: 0, ly: 0 };
  }
  function mkEB() { return { kind: 0, x: 0, y: 0, vx: 0, vy: 0, r: 6, dmg: 0, life: 0, col: '#fff', near: false, rot: 0, src: null }; }
  function mkPart() { return { type: 0, x: 0, y: 0, vx: 0, vy: 0, life: 0, max: 1, sz: 1, col: '#fff', spr: null, g: 0, drag: 0, rot: 0, vr: 0, add: true, fy: 0 }; }
  function mkNum() { return { x: 0, y: 0, t: 0, txt: '', kind: 0, vx: 0, col: '#fff', sz: 1 }; }
  function mkPick() { return { kind: '', x: 0, y: 0, v: 0, vx: 0, vy: 0, mag: false, t: 0, px: 0, py: 0, col: '#fff', rar: 0 }; }
  function mkFx() { return { kind: 0, x: 0, y: 0, r: 0, ang: 0, arc: 0, t: 0, dur: 1, col: '#fff', x2: 0, y2: 0, a: 1, seed: 0, ref: null }; }
  function mkZone() { return { kind: 0, x: 0, y: 0, r: 0, t: 0, dur: 1, dps: 0, el: 'none', tick: 0, col: '#fff', owner: 0, amp: 0, burn: 0, seed: 0 }; }
  function mkTele() { return { ouid: 0, kind: 0, x: 0, y: 0, r: 0, ang: 0, arc: 0, len: 0, w: 0, t: 0, dur: 1, act: 0, dmg: 0, owner: null, col: '#E8394D', a: 0, b: 0, inside: false, sx: 0, sy: 0 }; }
  function mkCorpse() { return { type: '', x: 0, y: 0, r: 10, dir: 1, dying: 0.01, id: 0, _aw: undefined, elite: false, hitT: 99, hpPct: 0, frozen: false, burning: false, poisoned: false, zy: 0, dk: 4, moving: false, shat: false }; }

  var EN = null, PR = null, EB = null, PA = null, NU = null, PK = null, FXP = null, ZN = null, TG = null, CO = null;
  var LT = new Array(CAP_LIGHT), nL = 0;
  for (var li = 0; li < CAP_LIGHT; li++) LT[li] = { x: 0, y: 0, r: 0, a: 0, col: null };
  function ensurePools() {
    if (EN) return;
    EN = new Pool(CAP_EN, mkEnemy); PR = new Pool(CAP_PROJ, mkProj); EB = new Pool(CAP_EB, mkEB); PA = new Pool(CAP_PART, mkPart);
    NU = new Pool(CAP_NUM, mkNum); PK = new Pool(CAP_PICK, mkPick); FXP = new Pool(CAP_FX, mkFx); ZN = new Pool(CAP_ZONE, mkZone);
    TG = new Pool(CAP_TELE, mkTele); CO = new Pool(CAP_CORPSE, mkCorpse);
  }
  function clearPools() { EN.clear(); PR.clear(); EB.clear(); PA.clear(); NU.clear(); PK.clear(); FXP.clear(); ZN.clear(); TG.clear(); CO.clear(); nL = 0; }

  /* ============================================================================================
   * Spatial hash (enemies) — 64 px cells, 2048 buckets, visit stamps avoid duplicates
   * ========================================================================================== */
  var HSZ = 2048, HMASK = HSZ - 1, INV_CELL = 1 / 64;
  var hHead = new Int32Array(HSZ), hNext = new Int32Array(CAP_EN), QSTAMP = 1;
  var QA = new Array(CAP_EN), QB = new Array(CAP_EN), QC = new Array(CAP_EN), QD = new Array(CAP_EN);
  function hKey(cx, cy) { return ((cx * 73856093) ^ (cy * 19349663)) & HMASK; }
  function hBuild() {
    hHead.fill(-1);
    var a = EN.a, n = EN.n;
    for (var i = 0; i < n; i++) {
      var e = a[i];
      if (e.dead) { hNext[i] = -1; continue; }
      var k = hKey(floor(e.x * INV_CELL), floor(e.y * INV_CELL));
      hNext[i] = hHead[k]; hHead[k] = i;
    }
  }
  /* enemies whose circle intersects (x, y, r) → out[0..n) */
  function hQuery(x, y, r, out) {
    var n = 0, a = EN.a, st = ++QSTAMP, lim = out.length, m = r + 60;
    var c0 = floor((x - m) * INV_CELL), c1 = floor((x + m) * INV_CELL), r0 = floor((y - m) * INV_CELL), r1 = floor((y + m) * INV_CELL);
    for (var cy = r0; cy <= r1; cy++) for (var cx = c0; cx <= c1; cx++) {
      var i = hHead[hKey(cx, cy)];
      while (i >= 0) {
        var e = a[i];
        if (e.qs !== st) {
          e.qs = st;
          if (!e.dead && !e.inv) { var dx = e.x - x, dy = e.y - y, s = r + e.r; if (dx * dx + dy * dy <= s * s && n < lim) out[n++] = e; }
        }
        i = hNext[i];
      }
    }
    return n;
  }
  /* nearest live enemy within maxD (linear scan — cheaper than a huge hash window) */
  function nearest(x, y, maxD, skipUid) {
    var a = EN.a, best = null, bd = maxD * maxD;
    for (var i = 0; i < EN.n; i++) {
      var e = a[i]; if (e.dead || e.inv || e.uid === skipUid) continue;
      var dx = e.x - x, dy = e.y - y, d = dx * dx + dy * dy;
      if (d < bd) { bd = d; best = e; }
    }
    return best;
  }
  /* up to k distinct nearest targets → out (simple selection, k ≤ 8) */
  function nearestK(x, y, maxD, k, out) {
    var n = 0, a = EN.a, md = maxD * maxD;
    for (var j = 0; j < k; j++) {
      var best = null, bd = md;
      for (var i = 0; i < EN.n; i++) {
        var e = a[i]; if (e.dead || e.inv) continue;
        var used = false; for (var q = 0; q < n; q++) if (out[q] === e) { used = true; break; }
        if (used) continue;
        var dx = e.x - x, dy = e.y - y, d = dx * dx + dy * dy;
        if (d < bd) { bd = d; best = e; }
      }
      if (!best) break;
      out[n++] = best;
    }
    return n;
  }
  /* random live enemies within maxD of (x,y) → out (reservoir-ish) */
  function randomIn(x, y, maxD, k, out) {
    var c = 0, a = EN.a, md = maxD * maxD;
    for (var i = 0; i < EN.n; i++) {
      var e = a[i]; if (e.dead || e.inv) continue;
      var dx = e.x - x, dy = e.y - y; if (dx * dx + dy * dy > md) continue;
      if (c < QD.length) QD[c++] = e;
    }
    var n = 0;
    while (n < k && c > 0) { var j = floor(rand() * c); out[n++] = QD[j]; QD[j] = QD[--c]; }
    return n;
  }

  /* ============================================================================================
   * Cached sprites (glows + the light punch sprite) — gradients are built once, drawn scaled
   * ========================================================================================== */
  function mkCanvas(w, h) { var c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
  var GLOW = Object.create(null), HOTG = Object.create(null), LIGHT_SPR = null, SOFT_SPR = null;
  function glowSpr(col) {
    var g = GLOW[col]; if (g) return g;
    g = mkCanvas(64, 64); var x = g.getContext('2d'), gr = x.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, rgba(col, 1)); gr.addColorStop(0.22, rgba(col, 0.62)); gr.addColorStop(0.55, rgba(col, 0.2)); gr.addColorStop(1, rgba(col, 0));
    x.fillStyle = gr; x.fillRect(0, 0, 64, 64);
    GLOW[col] = g; return g;
  }
  function hotSpr(col) {      // white-hot core + coloured halo
    var g = HOTG[col]; if (g) return g;
    g = mkCanvas(64, 64); var x = g.getContext('2d'), gr = x.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.16, rgba(mixc(col, '#FFFFFF', 0.5), 0.95)); gr.addColorStop(0.4, rgba(col, 0.45)); gr.addColorStop(1, rgba(col, 0));
    x.fillStyle = gr; x.fillRect(0, 0, 64, 64);
    HOTG[col] = g; return g;
  }
  function lightSpr() {
    if (LIGHT_SPR) return LIGHT_SPR;
    var c = mkCanvas(128, 128), x = c.getContext('2d'), gr = x.createRadialGradient(64, 64, 0, 64, 64, 64);
    gr.addColorStop(0, 'rgba(0,0,0,1)'); gr.addColorStop(0.3, 'rgba(0,0,0,0.92)'); gr.addColorStop(0.55, 'rgba(0,0,0,0.6)');
    gr.addColorStop(0.8, 'rgba(0,0,0,0.2)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
    x.fillStyle = gr; x.fillRect(0, 0, 128, 128);
    LIGHT_SPR = c; return c;
  }
  function softSpr() {        // dark soft blob (smoke, fog, shadows)
    if (SOFT_SPR) return SOFT_SPR;
    var c = mkCanvas(64, 64), x = c.getContext('2d'), gr = x.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, 'rgba(255,255,255,0.9)'); gr.addColorStop(0.5, 'rgba(255,255,255,0.4)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = gr; x.fillRect(0, 0, 64, 64);
    SOFT_SPR = c; return c;
  }
  var TINT = Object.create(null);
  function smokeSpr(col) {    // soft blob tinted (normal blend)
    var g = TINT[col]; if (g) return g;
    g = mkCanvas(64, 64); var x = g.getContext('2d'), gr = x.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, rgba(col, 0.85)); gr.addColorStop(0.55, rgba(col, 0.35)); gr.addColorStop(1, rgba(col, 0));
    x.fillStyle = gr; x.fillRect(0, 0, 64, 64);
    TINT[col] = g; return g;
  }

  /* ============================================================================================
   * Run state
   * ========================================================================================== */
  var B = { active: false };
  var R = null;                                  // current run (null when idle)
  var H = { x: 0, y: 0, vx: 0, vy: 0, r: HERO_R, hp: 1, hpLag: 1, shield: 0, iT: 0, hurtT: 9, dir: 1, face: 0, moving: false,
    atkT: 9, atkDur: 0.28, atkAng: 0, mvx: 0, mvy: 0, stepT: 0, dk: 3, zy: 0, dead: false, castT: 9, deathT: 0, spdMul: 1, takeMul: 1, lastX: 0, lastY: 0 };

  function fbSheet() {
    return { heroId: 'bora', weapon: 'kilic', weaponRar: 2, atk: 60, hp: 900, def: 15, spd: 160, crit: 0.05, critDmg: 1.5, cdr: 0, lifesteal: 0, regen: 0,
      pickup: 70, xpGain: 1, goldGain: 1, area: 1, projCount: 0, pierce: 0, dur: 1, eliteDmg: 1, bossDmg: 1, skillDmg: 1,
      wDmg: { kilic: 1.3, yay: 1, orak: 1, asa: 1 }, elem: { ates: 1, buz: 1, yildirim: 1, zehir: 1, golge: 1, none: 1 },
      dodge: 0, ultCharge: 1, ultDmg: 1, revive: 0, startLvl: 0, execute: 0, thorns: 0, shieldStart: 0, killHeal: 0, ult: null };
  }
  /* defensive copy of the SHEET with every field present */
  function normSheet(s) {
    var f = fbSheet(), o = {}, k;
    s = s && typeof s === 'object' ? s : {};
    for (k in f) o[k] = (typeof f[k] === 'number') ? num(s[k], f[k]) : (s[k] != null ? s[k] : f[k]);
    o.wDmg = {}; o.elem = {};
    for (k in f.wDmg) o.wDmg[k] = num(s.wDmg && s.wDmg[k], 1);
    for (k in f.elem) o.elem[k] = num(s.elem && s.elem[k], 1);
    if (!FB_WEAPONS[o.weapon]) o.weapon = 'kilic';
    o.heroId = s.heroId || f.heroId;
    o.weaponRar = clamp(num(s.weaponRar, 0) | 0, 0, 5);
    o.hp = mx(50, o.hp); o.atk = mx(1, o.atk); o.spd = clamp(o.spd, 60, 400);
    o.revive = mx(0, round(o.revive)); o.startLvl = clamp(round(o.startLvl), 0, 10); o.projCount = mx(0, round(o.projCount)); o.pierce = mx(0, round(o.pierce));
    return o;
  }

  /* XP to go from run level L to L+1 — tuned with the autopilot probe so a 4-minute run ends around level 20–25 */
  function needXp(L) { return round(6 + 4.5 * L + 0.25 * L * L); }

  function newRun(ch, sheet, look) {
    var hd = heroDef(sheet.heroId), theme = THEMES[ch.theme] ? ch.theme : 'orman';
    var ultId = (sheet.ult) || (hd.ult && hd.ult.id) || 'kasirga';
    var evs = (ch.events || []).slice().sort(function (a, b) { return a.t - b.t; });
    var hasBoss = false; evs.forEach(function (e) { if (e.type === 'boss') hasBoss = true; });
    R = {
      ch: ch, sheet: sheet, look: look, hd: hd, theme: theme, thm: THEMES[theme],
      wType: sheet.weapon, wDef: weaponDef(sheet.weapon), wRar: sheet.weaponRar,
      time: 0, rt: 0, anim: 0, mode: 'play', overlay: null, paused: false, ending: 0, endT: 0, won: false, endShown: false,
      lvl: 1, xp: 0, need: needXp(1), pendingLv: 0, rerolls: 1, lvDelay: 0,
      skills: Object.create(null), aSlots: [], pSlots: [], evolved: Object.create(null), sk: Object.create(null), skOrder: [],
      st: { elem: sheet.elem, maxHp: 0 }, rm: Object.create(null),
      res: { kills: 0, killsByType: {}, elites: 0, bosses: 0, metins: 0, chests: 0, goldPicked: 0, distance: 0, meleeKills: 0,
        rangedHits: 0, skillDamage: 0, nearMisses: 0, damageTaken: 0 },
      events: evs, evIdx: 0, hasBoss: hasBoss, spawnAcc: 0, bossPhase: 0, boss: null, arena: null, warnT: 0, bossDef: null,
      ult: { id: ultId, n: (hd.ult && hd.ult.n) || 'Nihai', col: (hd.ult && hd.ult.col) || '#FFCB57', dur: num(hd.ult && hd.ult.dur, 4),
        charge: 0.35, act: false, t: 0, len: 0, tick: 0, k: 0, x: 0, y: 0, ls: 0, lsT: 0, healLeft: 0, cine: 0, ready: false },
      revives: sheet.revive, combo: 0, comboT: 0, comboPop: 0, comboBest: 0,
      shake: 0, shx: 0, shy: 0, flash: 0, flashCol: '#FFFFFF', hurtFlash: 0, hitstop: 0, hsCd: 0, slow: 1, slowT: 0,
      camX: 0, camY: 0, leadX: 0, leadY: 0,
      w: { cd: 0.5, swings: 0, shots: 0 },
      chunks: new Map(), chunkN: 0,
      nmCd: 0, god: false, dbgSkip: false, lowT: 0, beatT: 0, regenAcc: 0, healCap: 0, healCapT: 0,
      introT: 0, tut: false, tutT: 0, tutMoved: 0, speech: '', speechT: 0, killsShown: -1, goldShown: -1, timeShown: -1,
      bannerQ: [], hudDirty: true, alive: 0, maxAlive: num(ch.maxAlive, 180), metinAlive: 0, eliteAlive: 0,
      perfAcc: 0, perfN: 0, slowFrames: 0, dprDrops: 0, frameMs: 16.7, fpsHist: [], lastSkillIcons: '',
      winT: 0, magnetT: 0, bombs: 0, ultReadyShown: false, lastKillT: -9, lastComboShown: 0
    };
    RM_KEYS.forEach(function (k) { R.rm[k] = 0; });
  }

  /* SHEET + run passives → live stats (every §2.7 key used somewhere below) */
  function recalc() {
    var s = R.sheet, rm = R.rm, st = R.st, k, id, d, L;
    for (k in rm) rm[k] = 0;
    for (var i = 0; i < R.pSlots.length; i++) {
      id = R.pSlots[i]; d = skDef(id); L = R.skills[id] | 0;
      if (d && d.per) for (k in d.per) rm[k] = (rm[k] || 0) + d.per[k] * L;
    }
    st.atk = s.atk * (1 + rm.atkPct);
    var oldMax = st.maxHp || 0;
    st.maxHp = s.hp * (1 + rm.hpPct);
    if (oldMax > 0 && st.maxHp > oldMax) H.hp += st.maxHp - oldMax;
    if (oldMax > 0) H.hp = mn(H.hp, st.maxHp);
    st.def = s.def * (1 + rm.defPct);
    st.spd = s.spd * (1 + rm.spdPct);
    st.crit = s.crit + rm.crit; st.critDmg = s.critDmg + rm.critDmg;
    st.cdr = mn(0.6, s.cdr + rm.cdr);
    st.lifesteal = mn(0.25, s.lifesteal + rm.lifesteal);
    st.regen = s.regen + rm.regen;
    st.pickup = s.pickup * (1 + rm.pickup);
    st.xpGain = s.xpGain + rm.xpGain;
    st.goldGain = s.goldGain + rm.goldGain;
    st.area = mx(0.5, s.area + rm.area);
    st.projCount = s.projCount; st.pierce = s.pierce;
    st.dur = s.dur + rm.dur;
    st.eliteDmg = s.eliteDmg; st.bossDmg = s.bossDmg; st.skillDmg = s.skillDmg + rm.skillDmg;
    st.elem = s.elem; st.wMult = s.wDmg[R.wType] || 1;
    st.dodge = mn(0.4, s.dodge); st.ultCharge = s.ultCharge; st.ultDmg = s.ultDmg;
    st.execute = s.execute; st.thorns = s.thorns; st.killHeal = s.killHeal;
    var su = R.skills.silahUst | 0, S = su ? skLv('silahUst', su) : null;
    st.suDmg = S ? num(S.dmg) : 0; st.suRate = S ? num(S.rate) : 0; st.suExtra = S ? num(S.extra) : 0; st.suMastery = S ? num(S.mastery) : 0;
  }

  /* ============================================================================================
   * Spawning helpers: particles, numbers, fx, zones, telegraphs, lights, pickups
   * ========================================================================================== */
  var PT_GLOW = 1, PT_DOT = 2, PT_SMOKE = 3, PT_SHARD = 4, PT_STREAK = 5, PT_LEAF = 6, PT_BONE = 7;
  function part(type, x, y, vx, vy, life, sz, col, g, drag) {
    var p = PA.take(); if (!p) return null;
    p.type = type; p.x = x; p.y = y; p.vx = vx; p.vy = vy; p.life = life; p.max = life; p.sz = sz; p.col = col;
    p.g = g || 0; p.fy = y + 4 + rand() * 12; p.drag = drag == null ? 2 : drag; p.rot = rand() * TAU; p.vr = rr(-8, 8); p.add = type !== PT_SMOKE && type !== PT_BONE;
    p.spr = type === PT_SMOKE ? smokeSpr(col) : (type === PT_GLOW || type === PT_STREAK) ? glowSpr(col) : null;
    return p;
  }
  function burst(x, y, n, col, spd, life, sz, type, up) {
    if (PA.n > CAP_PART * 0.85) n = mn(n, 3);
    for (var i = 0; i < n; i++) {
      var a = rand() * TAU, s = spd * (0.35 + rand() * 0.75);
      part(type || PT_GLOW, x, y, cos(a) * s, sin(a) * s * 0.8 - (up || 0), life * (0.6 + rand() * 0.6), sz * (0.6 + rand() * 0.7), col, 0, 2.5);
    }
  }

  var N_NORM = 0, N_CRIT = 1, N_DOT = 2, N_HURT = 3, N_HEAL = 4, N_TEXT = 5, N_SKILL = 6, N_BIG = 7;
  function numAt(x, y, txt, kind, col) {
    var o;
    // readability over spam: plain numbers thin out as the screen fills, crits and texts survive longer
    if (kind === N_DOT && NU.n > 20) return;
    if ((kind === N_NORM || kind === N_SKILL) && NU.n > 28) return;
    if (kind === N_CRIT && NU.n > 44) return;
    if (NU.n >= CAP_NUM) {
      if (kind === N_DOT || kind === N_NORM || kind === N_SKILL) return;
      var bi = 0, bt = -1; for (var i = 0; i < NU.n; i++) if (NU.a[i].t > bt) { bt = NU.a[i].t; bi = i; }
      o = NU.a[bi];
    } else o = NU.take();
    o.x = x; o.y = y; o.t = 0; o.txt = txt; o.kind = kind; o.col = col || '#FFFFFF'; o.vx = rr(-14, 14);
    o.sz = kind === N_CRIT ? 1.45 : kind === N_DOT ? 0.72 : kind === N_TEXT ? 0.95 : kind === N_BIG ? 1.7 : kind === N_HURT ? 1.05 : 1;
  }

  var FX_SLASH = 1, FX_SPIN = 2, FX_NOVA = 3, FX_EXPL = 4, FX_BOLT = 5, FX_RING = 6, FX_SHOCK = 7, FX_SCORCH = 8, FX_FLASH = 9, FX_DUST = 10,
    FX_CLAW = 11, FX_PORTAL = 12, FX_PILLAR = 13, FX_SOUL = 14, FX_SPLASH = 15, FX_ULTRING = 16, FX_BREATH = 17, FX_ICEBURST = 18, FX_STAR = 19;
  function fx(kind, x, y, r, dur, col, ang, arc) {
    var f = FXP.take();
    if (!f) { if (kind === FX_SCORCH || kind === FX_DUST) return null; f = FXP.a[floor(rand() * FXP.n)]; }
    f.kind = kind; f.x = x; f.y = y; f.r = r; f.dur = dur; f.col = col || '#FFFFFF'; f.ang = ang || 0; f.arc = arc || 0; f.t = 0;
    f.x2 = 0; f.y2 = 0; f.a = 1; f.seed = rand() * 1000; f.ref = null;
    return f;
  }

  var Z_POISON = 1, Z_LAVA = 2, Z_FIRE = 3, Z_SHADOW = 4, Z_PUFF = 5, Z_ELAVA = 6, Z_FRING = 7, Z_SHOCK = 8;
  function zone(kind, x, y, r, dur, dps, el, col) {
    var z = ZN.take(); if (!z) return null;
    z.kind = kind; z.x = x; z.y = y; z.r = r; z.t = 0; z.dur = dur; z.dps = dps; z.el = el || 'none'; z.col = col || '#8BE04E';
    z.tick = rand() * 0.25; z.owner = (kind === Z_PUFF || kind === Z_ELAVA || kind === Z_FRING || kind === Z_SHOCK) ? 1 : 0; z.amp = 0; z.burn = 0; z.seed = rand() * 100;
    return z;
  }

  var T_CIRCLE = 1, T_LINE = 2, T_CONE = 3;
  var A_NONE = 0, A_METEOR = 1, A_BONE = 2, A_BMETEOR = 3, A_SLAM = 4, A_CLAW = 5, A_METIN = 6, A_STRIKE = 7;
  function tele(kind, x, y, r, dur, act, dmg) {
    var t = TG.take(); if (!t) return null;
    t.kind = kind; t.x = x; t.y = y; t.r = r; t.dur = dur; t.t = 0; t.act = act; t.dmg = dmg || 0; t.ang = 0; t.arc = 0; t.len = 0; t.w = 0;
    t.owner = null; t.ouid = 0; t.col = '#E8394D'; t.a = 0; t.b = 0; t.inside = false; t.sx = x - 180; t.sy = y - 460;
    return t;
  }

  function light(x, y, r, a, col) {
    if (nL >= CAP_LIGHT) return;
    var L = LT[nL++]; L.x = x; L.y = y; L.r = r; L.a = a; L.col = col || null;
  }

  function dropPick(kind, x, y, v) {
    var p = PK.take();
    if (!p) {                                  // full: merge xp into an existing gem
      if (kind.charAt(0) === 'x') { var g = PK.a[floor(rand() * PK.n)]; if (g && g.kind.charAt(0) === 'x') { g.v += v; g.kind = g.v >= 10 ? 'xp3' : g.v >= 3 ? 'xp2' : 'xp1'; } return null; }
      // important drop: recycle an xp gem's slot (its value folds into another gem)
      var j0 = floor(rand() * PK.n), slot = null;
      for (var q = 0; q < PK.n && !slot; q++) { var c = PK.a[(j0 + q) % PK.n]; if (c.kind.charAt(0) === 'x' && !c.mag) slot = c; }
      if (!slot) return null;
      var other = PK.a[(PK.a.indexOf(slot) + 1) % PK.n];
      if (other !== slot && other.kind.charAt(0) === 'x') { other.v += slot.v; other.kind = other.v >= 10 ? 'xp3' : other.v >= 3 ? 'xp2' : 'xp1'; } else addXp(slot.v);
      p = slot;
    }
    p.kind = kind; p.x = x + rr(-6, 6); p.y = y + rr(-6, 6); p.v = v; p.mag = false; p.t = 0; p.px = p.x; p.py = p.y;
    var a = rand() * TAU, s = rr(20, 70); p.vx = cos(a) * s; p.vy = sin(a) * s;
    p.col = kind === 'xp1' ? '#5BD16E' : kind === 'xp2' ? '#4BA3FF' : kind === 'xp3' ? '#B565FF' : kind === 'gold' ? '#FFCB57' : kind === 'heal' ? '#FF6A5A' : kind === 'chest' ? '#FFB020' : '#4BA3FF';
    p.rar = 0;
    return p;
  }
  function dropXp(x, y, v) {
    if (v <= 0) return;
    // big values split into a few gems (feels generous), merge when the field is crowded
    if (PK.n > 260) {
      for (var i = 0; i < 6; i++) { var g = PK.a[floor(rand() * PK.n)]; if (g && !g.mag && g.kind.charAt(0) === 'x') { var dx = g.x - x, dy = g.y - y; if (dx * dx + dy * dy < 160 * 160) { g.v += v; g.kind = g.v >= 10 ? 'xp3' : g.v >= 3 ? 'xp2' : 'xp1'; return; } } }
    }
    if (v >= 20) { var k = mn(5, floor(v / 10)), each = v / k; for (var j = 0; j < k; j++) dropPick('xp3', x + rr(-14, 14), y + rr(-14, 14), each); return; }
    dropPick(v >= 10 ? 'xp3' : v >= 3 ? 'xp2' : 'xp1', x, y, v);
  }

  /* ============================================================================================
   * Feedback helpers
   * ========================================================================================== */
  function shake(a) { if (!R) return; a *= REDUCED ? 0.25 : 1; if (a > R.shake) R.shake = mn(18, a); }
  function flash(a, col) { if (!R) return; a *= REDUCED ? 0.35 : 1; if (a > R.flash) { R.flash = a; R.flashCol = col || '#FFFFFF'; } }
  function hitstop(s) { if (!R || R.hsCd > 0) return; R.hitstop = mx(R.hitstop, s); R.hsCd = 0.22; }
  function heal(v, show) {
    if (!R || H.dead || v <= 0) return;
    var before = H.hp; H.hp = mn(R.st.maxHp, H.hp + v);
    var got = H.hp - before;
    if (show && got >= 1) numAt(H.x + rr(-8, 8), H.y - 62, '+' + fmt(got), N_HEAL, '#7CFF8E');
  }
  /* lifesteal-type healing is budgeted (max 10 % max HP per second) so AoE builds don't become immortal */
  function leech(v) {
    if (!R || v <= 0) return;
    var cap = R.st.maxHp * 0.10;
    if (R.healCap >= cap) return;
    v = mn(v, cap - R.healCap); R.healCap += v;
    heal(v, false);
  }
  function chargeUlt(v) {
    if (!R || R.ult.act) return;
    var was = R.ult.charge;
    R.ult.charge = mn(1, R.ult.charge + v * R.st.ultCharge);
    if (was < 1 && R.ult.charge >= 1) { sfx('unlock', 0.6, 1.2); R.hudDirty = true; }
  }
  function nearMiss(x, y) {
    if (!R || R.nmCd > 0) return;
    R.nmCd = 0.9; R.res.nearMisses++;
    numAt(x, y - 64, 'Kıl payı!', N_TEXT, '#3EDBC8');
    burst(x, y - 24, 6, '#3EDBC8', 90, 0.4, 3, PT_GLOW, 20);
  }

  /* ============================================================================================
   * Damage pipeline — enemies
   * ========================================================================================== */
  var EL_NUM_COL = { none: '#FFFFFF', ates: '#FFB27A', buz: '#BFF0FF', yildirim: '#FFF27A', zehir: '#C8FF8A', golge: '#D9C2FF' };
  function hit(e, base, kind, el, kb, sx, sy, critAdd) {
    if (!e || e.dead || e.inv || e.hp <= 0 || !R) return 0;
    var st = R.st, m = 1;
    if (kind === K_SKILL || kind === K_DOT) m *= st.skillDmg * (st.elem[el] || 1);
    else if (kind === K_ULT) m *= st.ultDmg * (el && el !== 'none' ? (st.elem[el] || 1) : 1);
    else if (kind === K_WEAPON) m *= st.wMult * (1 + st.suDmg);
    if (e.boss) m *= st.bossDmg; else if (e.elite || e.stone) m *= st.eliteDmg;
    if (e.poisT > 0 && e.amp > 0) m *= 1 + e.amp;
    var d = base * m * (kind === K_DOT ? 1 : (0.9 + rand() * 0.2));
    var crit = false;
    if (kind !== K_DOT && kind !== K_THORN && rand() < st.crit + (critAdd || 0)) { crit = true; d *= st.critDmg; }
    var exec = false;
    if (!e.boss && !e.stone && st.execute > 0 && e.hp - d > 0 && (e.hp - d) / e.maxHp < st.execute) { exec = true; d = e.hp; }
    if (d <= 0) return 0;
    var applied = mn(d, e.hp);
    e.hp -= d; if (e.hitT > (e.boss ? 0.2 : 0.12)) e.hitT = 0; e.hpPct = mx(0, e.hp / e.maxHp);
    var res = R.res;
    if (kind === K_SKILL || kind === K_DOT || kind === K_ULT) res.skillDamage += applied;
    else if (kind === K_WEAPON && R.wDef.kind === 'ranged') res.rangedHits++;
    // lifesteal (+ golgePatlama shadow lifesteal)
    var ls = st.lifesteal + (R.ult.lsT > 0 ? R.ult.ls : 0);
    if (ls > 0 && kind !== K_THORN) leech(applied * ls);
    if (e.boss || e.elite) chargeUlt(applied / e.maxHp * (e.boss ? 0.35 : 0.25));
    // knockback (mass-scaled; bosses / stones ignore it)
    if (kb && e.mass < 100) {
      var dx = e.x - sx, dy = e.y - sy, L = sqrt(dx * dx + dy * dy) || 1, k = kb / e.mass;
      e.kx += dx / L * k; e.ky += dy / L * k;
    }
    // numbers
    if (exec) numAt(e.x, e.y - e.r - 10, 'İNFAZ', N_TEXT, '#C9A4FF');
    else if (kind === K_DOT) { if (NU.n < 36) numAt(e.x + rr(-6, 6), e.y - e.r - 2, fmt(d), N_DOT, EL_NUM_COL[el] || '#FFFFFF'); }
    else if (crit) numAt(e.x + rr(-4, 4) * (e.boss ? 8 : 1), e.y - e.r - 8 - (e.boss ? rand() * 30 : 0), fmt(d) + '!', N_CRIT, '#FFCB57');
    else numAt(e.x + rr(-6, 6) * (e.boss ? 6 : 1), e.y - e.r - 6 - (e.boss ? rand() * 30 : 0), fmt(d), kind === K_SKILL ? N_SKILL : N_NORM, kind === K_SKILL || kind === K_ULT ? (EL_NUM_COL[el] || '#FFFFFF') : kind === K_THORN ? '#D9A4FF' : '#FFFFFF');
    if (e.boss) {
      if (crit || d > e.maxHp * 0.02) hitstop(crit ? 0.07 : 0.045);
      R.hudDirty = true;
    }
    if (crit && kind !== K_DOT) { burst(e.x, e.y - e.r * 0.3, 3, '#FFE7A0', 140, 0.25, 2.5, PT_STREAK); sfx('crit', 0.35, rr(0.95, 1.1)); }
    else if (kind === K_WEAPON && (e.boss || e.elite || e.stone)) sfx('hit', 0.4, rr(0.9, 1.1));
    if (e.hp <= 0) killEnemy(e, kind);
    return applied;
  }

  function killEnemy(e, kind) {
    if (e.dead) return;
    e.dead = true; e.hp = 0; e.hpPct = 0;
    var res = R.res, st = R.st;
    if (e.boss) { bossDied(e); return; }
    if (e.stone) { metinBroken(e); return; }
    res.kills++;
    res.killsByType[e.type] = (res.killsByType[e.type] || 0) + 1;
    if (kind === K_WEAPON && R.wDef.kind === 'melee') res.meleeKills++;
    if (e.elite) { res.elites++; R.eliteAlive = mx(0, R.eliteAlive - 1); }
    // corpse: dissolve-to-soul (baked 'die' variant in GM.Art.drawEnemy)
    var c = CO.take();
    if (c) {
      c.type = e.type; c.x = e.x; c.y = e.y; c.r = e.r; c.dir = e.dir; c.dying = 0.01; c.id = e.id; c._aw = e._aw; c.elite = e.elite; c.zy = e.zy;
      c.shat = e.frzT > 0 || (R.skills.mutlakSifir && R.sk.mutlakSifir && inVortex(e));
    }
    var sc = (ART() && ART().soulColor) ? ART().soulColor(e.type) : '#B07CFF';
    burst(e.x, e.y - e.r * 0.4, e.elite ? 16 : 4, sc, e.elite ? 200 : 110, 0.5, e.elite ? 5 : 3, PT_GLOW, 30);
    if (c && c.shat) { for (var i = 0; i < 7; i++) { var a = rand() * TAU; part(PT_SHARD, e.x, e.y - e.r * 0.5, cos(a) * rr(80, 220), sin(a) * rr(60, 180) - 60, rr(0.4, 0.8), rr(3, 6), '#CFF4FF', 420, 1.5); } }
    // drops
    dropXp(e.x, e.y, e.xp);
    var hpLow = H.hp < R.st.maxHp * 0.35;
    if (e.elite) {
      var cp = dropPick('chest', e.x, e.y, 1); if (cp) { cp.rar = 3; cp.col = rarCol(3); }
      var gN = 8; for (var g = 0; g < gN; g++) dropPick('gold', e.x, e.y, num(DD().ECON && DD().ECON.goldPerElite, 25) / gN);
      if (rand() < 0.5) dropPick('heal', e.x, e.y, 1);
      shake(7); fx(FX_RING, e.x, e.y, 120, 0.5, '#FFCB57'); sfx('rare', 0.8);
    } else {
      if (rand() < 0.3) dropPick('gold', e.x, e.y, num(DD().ECON && DD().ECON.goldPerKill, 1) * rr(2, 4.6));
      var r0 = rand();
      if (r0 < (hpLow ? 0.02 : 0.007)) dropPick('heal', e.x, e.y, 1);
      else if (r0 < (hpLow ? 0.022 : 0.0095) + (R.time > 60 ? 0.0025 : 0)) dropPick('magnet', e.x, e.y, 1);
      else if (r0 < (hpLow ? 0.025 : 0.0125) + (R.time > 60 ? 0.0025 : 0)) dropPick('bomb', e.x, e.y, 1);
    }
    // mushroom spores
    var df = e.def;
    if (df && df.puff) { var z = zone(Z_PUFF, e.x, e.y, num(df.puff.r, 55), num(df.puff.dur, 2.5), num(df.puff.dps, 6) * dmgScale(), 'zehir', '#B66BFF'); if (z) burst(e.x, e.y - 10, 8, '#B66BFF', 90, 0.6, 5, PT_SMOKE); }
    // rewards for the kill
    if (st.killHeal > 0) heal(st.killHeal, false);
    chargeUlt(e.elite ? 0.12 : 0.009);
    R.combo++; R.comboT = 2.6; R.comboPop = 0; if (R.combo > R.comboBest) R.comboBest = R.combo;
    if (R.combo === 50 || R.combo === 100 || R.combo === 200 || R.combo === 400) comboMilestone(R.combo);
    R.lastKillT = R.time;
    sfx('enemyDie', 0.45, rr(0.9, 1.15));
  }
  function comboMilestone(n) {
    var txt = n >= 400 ? 'EFSANE!' : n >= 200 ? 'KATLİAM!' : n >= 100 ? 'DURDURULAMAZ!' : 'SERİ KATİL!';
    numAt(H.x, H.y - 90, txt, N_BIG, '#FFCB57');
    fx(FX_RING, H.x, H.y - HERO_CY, 140, 0.55, '#FFCB57');
    chargeUlt(0.06);
    sfx('reward', 0.7);
  }

  /* DoT + status timers (called from the enemy update) */
  function statusTick(e, dt) {
    if (e.slowT > 0) e.slowT -= dt;
    if (e.frzT > 0) e.frzT -= dt;
    e.frozen = e.frzT > 0;
    if (e.burnT > 0 || e.poisT > 0) {
      e.dotT += dt;
      if (e.dotT >= 0.5) {
        e.dotT -= 0.5;
        if (e.burnT > 0) hit(e, e.burnDps * 0.5, K_DOT, 'ates', 0, 0, 0, 0);
        if (!e.dead && e.poisT > 0) hit(e, e.poisDps * 0.5, K_DOT, 'zehir', 0, 0, 0, 0);
      }
      if (e.burnT > 0) { e.burnT -= dt; if (e.burnT <= 0) e.burnDps = 0; }
      if (e.poisT > 0) { e.poisT -= dt; if (e.poisT <= 0) { e.poisDps = 0; e.amp = 0; } }
    }
    e.burning = e.burnT > 0; e.poisoned = e.poisT > 0;
  }
  function burn(e, dps, dur) { if (e.dead) return; e.burnT = mx(e.burnT, dur * R.st.dur); e.burnDps = mx(e.burnDps, dps); }
  function poison(e, dps, dur, amp) { if (e.dead) return; e.poisT = mx(e.poisT, dur); e.poisDps = mx(e.poisDps, dps); if (amp) e.amp = mx(e.amp, amp); }
  function chill(e, slow, dur, frz) {
    if (e.dead) return;
    e.slowT = mx(e.slowT, dur * R.st.dur); e.slow = mx(e.slowT > 0 ? e.slow : 0, slow);
    if (frz > 0 && !e.boss && !e.stone) e.frzT = mx(e.frzT, frz * R.st.dur * (e.elite ? 0.4 : 1));
  }

  /* ============================================================================================
   * Damage pipeline — hero
   * ========================================================================================== */
  function hurtHero(dmg, src) {
    if (!R || H.dead || R.ending || R.god || H.iT > 0 || dmg <= 0) return;
    if (src && src.nearT >= 0) src.nearHit = true;
    if (rand() < R.st.dodge) {
      H.iT = 0.18;
      numAt(H.x, H.y - 66, 'Kaçınma!', N_TEXT, '#3EDBC8');
      burst(H.x, H.y - HERO_CY, 6, '#3EDBC8', 120, 0.35, 3, PT_STREAK);
      sfx('whoosh', 0.5, 1.3);
      return;
    }
    var d = dmg * 100 / (100 + mx(0, R.st.def)) * H.takeMul;
    // thorns: (raw incoming damage + hero attack) × thorns is dealt back (the raw fraction alone would be negligible)
    if (R.st.thorns > 0 && src && !src.dead) hit(src, (dmg + R.st.atk) * R.st.thorns, K_THORN, 'none', 0, H.x, H.y, 0);
    if (H.shield > 0) {
      var s = mn(H.shield, d); H.shield -= s; d -= s;
      burst(H.x, H.y - HERO_CY, 5, '#7FD8FF', 120, 0.3, 3, PT_GLOW);
      if (d <= 0) { H.iT = 0.1; sfx('ice', 0.4, 1.4); return; }
    }
    H.hp -= d; R.res.damageTaken += d;
    H.hurtT = 0; H.iT = 0.12;
    numAt(H.x + rr(-6, 6), H.y - 58, '-' + fmt(d), N_HURT, '#FF5A6A');
    R.hurtFlash = mn(1, R.hurtFlash + 0.35 + d / R.st.maxHp * 2);
    shake(2.5 + mn(7, d / R.st.maxHp * 50));
    sfx('playerHurt', 0.7, rr(0.95, 1.05));
    if (H.hp <= 0) { H.hp = 0; heroDown(); }
  }

  /* ============================================================================================
   * XP + levels
   * ========================================================================================== */
  function addXp(v) {
    R.xp += v * R.st.xpGain;
    while (R.xp >= R.need) {
      R.xp -= R.need; R.lvl++; R.need = needXp(R.lvl); R.pendingLv++;
    }
    R.hudDirty = true;
  }

  /* ============================================================================================
   * Enemy spawning
   * ========================================================================================== */
  function hpScale(mode) {   // mode: 0 normal, 1 elite/stone, 2 boss
    var m = R.time / 60, rp = R.ch.ramp || NO, sc = num(R.ch.scale, 1);
    if (mode === 2) return sc * 1.25;
    // chapter ramp (data) × a gentle quadratic late-game ramp so hordes stay threatening as builds snowball
    return sc * (1 + num(rp.hp, 0.3) * m * (mode === 1 ? 0.5 : 1)) * (1 + (mode === 1 ? 0.03 : 0.08) * m * m);
  }
  function dmgScale() { var m = R.time / 60, rp = R.ch.ramp || NO; return num(R.ch.scale, 1) * (1 + num(rp.dmg, 0.12) * m); }

  function spawnEnemy(type, x, y) {
    var df = enemyDef(type); if (!df) return null;
    var important = df.boss || df.elite || df.kind === 'stone';
    var e = EN.take();
    if (!e) {
      if (!important) return null;
      // evict the farthest normal enemy to make room
      var far = -1, fd = -1;
      for (var i = 0; i < EN.n; i++) { var o = EN.a[i]; if (o.dead || o.boss || o.elite || o.stone) continue; var dx = o.x - H.x, dy = o.y - H.y, d = dx * dx + dy * dy; if (d > fd) { fd = d; far = i; } }
      if (far < 0) return null;
      EN.a[far].dead = true; EN.a[far].hp = 0;
      return null;   // room appears after compaction; caller retries next frame for events
    }
    var mode = df.boss ? 2 : (df.elite || df.kind === 'stone') ? 1 : 0;
    e.uid = UID++; e.id = e.uid; e.type = type; e.def = df; e.kind = df.kind || 'chase';
    e.x = x; e.y = y; e.vx = 0; e.vy = 0; e.kx = 0; e.ky = 0; e.r = num(df.r, 14);
    e.maxHp = mx(1, num(df.hp, 50) * hpScale(mode)); e.hp = e.maxHp; e.hpPct = 1;
    e.dmg = num(df.dmg, 8) * dmgScale(); e.spd = num(df.spd, 60) * rr(0.92, 1.08);
    e.elite = !!df.elite; e.boss = !!df.boss; e.stone = df.kind === 'stone'; e.ghost = !!df.ghost;
    e.mass = e.boss || e.stone ? 1e9 : e.elite ? 6 : df.kind === 'tank' ? 3 : 1;
    e.dead = false; e.inv = false; e.dir = x < H.x ? 1 : -1; e.hitT = 99; e.frozen = false; e.burning = false; e.poisoned = false; e.dying = 0; e.moving = true; e._aw = undefined;
    e.atkCd = 0.6; e.slowT = 0; e.slow = 0; e.frzT = 0; e.burnT = 0; e.burnDps = 0; e.poisT = 0; e.poisDps = 0; e.amp = 0; e.dotT = 0;
    e.st = rr(0.5, 1.5); e.stT = 0; e.ax = 0; e.ay = 0; e.shotCd = df.shot ? rr(0.8, num(df.shot.cd, 2)) : 0; e.castP = 0; e.mode = 0; e.modeT = 0; e.phase = 'move';
    e.cdHalka = -9; e.cdUlt = -9; e.cdRing = -9; e.nearT = -1; e.nearD = 0; e.nearHit = false; e.nearCd = 0; e.qs = 0;
    e.xp = num(df.xp, 1); e.inA = R.arena ? 1 : 0; e.spawnT = 0; e.flashT = 0; e.enr = false; e.bs = ''; e.bt = 0; e.bi = 0; e.bk = 0; e.bx = 0; e.by = 0; e.ba = 0; e.bn = 0; e.lift = 0; e.intro = 0; e.lastHurt = 0;
    e.zy = e.y + e.r * 0.6;
    if (e.elite) R.eliteAlive++;
    return e;
  }
  /* point on the spawn ring just outside the view, biased toward where the hero is heading */
  var SP = { x: 0, y: 0 };
  function ringPoint(extra) {
    var rad = sqrt(R.vw * R.vw + R.vh * R.vh) * 0.5 + 40 + (extra || 0);
    var a;
    var mv = H.mvx * H.mvx + H.mvy * H.mvy;
    if (mv > 0.05 && rand() < 0.55) a = atan2(H.mvy, H.mvx) + rr(-1.1, 1.1);
    else a = rand() * TAU;
    SP.x = R.camX + cos(a) * rad; SP.y = R.camY + sin(a) * rad;
    return SP;
  }
  function poolPick(pool) {
    var tot = 0, k;
    for (k in pool) tot += num(pool[k]);
    var x = rand() * tot;
    for (k in pool) { x -= num(pool[k]); if (x <= 0) return k; }
    return k;
  }
  function curWave() {
    var W0 = R.ch.waves || [], t = R.time;
    for (var i = 0; i < W0.length; i++) if (t >= W0[i].from && t < W0[i].to) return W0[i];
    return W0.length ? W0[W0.length - 1] : null;
  }
  function spawnPack(type, n, x, y) {
    for (var i = 0; i < n; i++) { var a = rand() * TAU, d = rr(4, 34); spawnEnemy(type, x + cos(a) * d, y + sin(a) * d); }
  }
  function updSpawns(dt) {
    if (R.bossPhase > 0 || R.ending) return;
    var w = curWave(); if (!w) return;
    // early-run spawns faster than the table so the screen is never empty; late game slightly denser
    var rate = num(w.rate, 1) * (R.time < 8 ? 1.8 : 1) * (1.15 + 0.45 * R.time / 60);
    R.spawnAcc += rate * dt;
    var cap = mn(R.maxAlive, CAP_EN - 30);
    while (R.spawnAcc >= 1) {
      R.spawnAcc -= 1;
      if (R.alive >= cap) { R.spawnAcc = 0; break; }
      var type = poolPick(w.pool || {}), df = enemyDef(type); if (!df) continue;
      var p = ringPoint(df.r);
      if (df.kind === 'swarm') { spawnPack(type, mn(num(df.pack, 6), 3 + floor(R.time / 70)), p.x, p.y); R.spawnAcc -= 1.5; }
      else spawnEnemy(type, p.x, p.y);
    }
  }
  function portalPuff(x, y, col) { fx(FX_PORTAL, x, y, 22, 0.5, col || '#9D6BFF'); }

  /* ============================================================================================
   * Chapter events (ring / swarm / elite / metin / boss)
   * ========================================================================================== */
  function updEvents() {
    var ev = R.events;
    while (R.evIdx < ev.length && ev[R.evIdx].t <= R.time) {
      var e = ev[R.evIdx++];
      if (R.bossPhase > 0 && e.type !== 'boss') continue;
      if (fireEvent(e) === false) { R.evIdx--; break; }   // field full → retry next frame
    }
    // a chapter with no boss is won by surviving its duration
    if (!R.hasBoss && !R.ending && R.time >= num(R.ch.dur, 240)) endRun(true);
  }
  function fireEvent(ev) {
    var i, a, n, x, y;
    switch (ev.type) {
      case 'ring': {
        n = mn(num(ev.n, 14), 40); var rad = mx(R.vw, R.vh) * 0.42 + 40;
        for (i = 0; i < n; i++) { a = i / n * TAU; x = H.x + cos(a) * rad; y = H.y + sin(a) * rad * 1.05; var e1 = spawnEnemy(ev.e || 'iskelet', x, y); if (e1) { portalPuff(x, y); e1.spd *= 1.1; } }
        banner(ev.msg || 'Kuşatıldın!', 'red');
        sfx('warning', 0.6); break;
      }
      case 'swarm': {
        n = mn(num(ev.n, 24), 60);
        a = rand() * TAU; var cx = H.x - cos(a) * (R.vw * 0.5 + 120), cy = H.y - sin(a) * (R.vh * 0.5 + 80);
        var px = -sin(a), py = cos(a);
        for (i = 0; i < n; i++) {
          var off = (i % 8 - 3.5) * 26 + rr(-8, 8), back = floor(i / 8) * 34 + rr(0, 20);
          var e2 = spawnEnemy(ev.e || 'yarasa', cx + px * off - cos(a) * back, cy + py * off - sin(a) * back);
          if (e2) { e2.mode = 9; e2.modeT = 7; e2.ax = cos(a); e2.ay = sin(a); e2.spd *= 1.25; }
        }
        banner(ev.msg || 'Akın!', 'red'); sfx('whoosh', 0.7, 0.7); break;
      }
      case 'elite': {
        var p = ringPoint(0);
        var e3 = spawnEnemy(ev.e || 'golem', p.x, p.y);
        if (!e3) return false;
        banner(ev.msg || 'Elit düşman!', 'gold'); sfx('bossRoar', 0.45, 1.5); break;
      }
      case 'metin': return spawnMetin(ev);
      case 'boss': startBossWarning(ev); break;
    }
    return true;
  }
  function spawnMetin(ev) {
    var a = rand() * TAU, d = 300;
    var x = H.x + cos(a) * d, y = H.y + sin(a) * d * 0.85;
    if (R.arena) return true;
    var m = spawnEnemy('metin', x, y);
    if (!m) return false;
    m.inv = true; m.lift = 1; m.st = 3; m.intro = 0.9;
    var t = tele(T_CIRCLE, x, y, 60, 0.9, A_METIN, 0); if (t) { t.owner = m; t.col = '#9D6BFF'; }
    R.metinAlive++;
    banner(ev.msg || 'Bir Metin Taşı düştü!', 'violet');
    sfx('whoosh', 0.8, 0.6);
    return true;
  }
  function metinLanded(m) {
    m.inv = false; m.lift = 0;
    shake(9); flash(0.25, '#B57BFF');
    fx(FX_SHOCK, m.x, m.y, 150, 0.6, '#B57BFF'); fx(FX_DUST, m.x, m.y, 90, 0.7, '#3A2E48'); fx(FX_SCORCH, m.x, m.y, 60, 30, '#000000');
    burst(m.x, m.y - 30, 20, '#C49BFF', 260, 0.7, 4, PT_GLOW, 40);
    for (var i = 0; i < 10; i++) { var a = rand() * TAU; part(PT_BONE, m.x, m.y - 10, cos(a) * rr(80, 200), -rr(120, 260), rr(0.5, 0.9), rr(2.5, 5), i & 1 ? '#5A4A3A' : '#3A3048', 600, 0.5); }
    var c = hQuery(m.x, m.y, 110, QA);
    for (var j = 0; j < c; j++) { var e = QA[j]; if (e !== m) { e.kx += (e.x - m.x) * 3; e.ky += (e.y - m.y) * 3; } }
    var dx = H.x - m.x, dy = H.y - m.y; if (dx * dx + dy * dy < 70 * 70) hurtHero(10 * dmgScale(), null);
    sfx('explosion', 0.7, 0.7); sfx('metinBreak', 0.35, 0.6);
  }
  function metinBroken(m) {
    R.res.metins++; R.metinAlive = mx(0, R.metinAlive - 1);
    shake(12); flash(0.45, '#E8D8FF'); hitstop(0.08);
    fx(FX_EXPL, m.x, m.y - 40, 110, 0.8, '#B57BFF'); fx(FX_SHOCK, m.x, m.y, 220, 0.7, '#E0C8FF'); fx(FX_PILLAR, m.x, m.y, 60, 1.2, '#C49BFF');
    for (var i = 0; i < 14; i++) { var a = rand() * TAU; part(PT_BONE, m.x, m.y - 40, cos(a) * rr(120, 320), -rr(150, 380), rr(0.6, 1.1), rr(3, 6), i & 1 ? '#4E4468' : '#2E2840', 700, 0.4); }
    burst(m.x, m.y - 40, 30, '#C49BFF', 320, 0.9, 5, PT_GLOW, 60);
    var cp = dropPick('chest', m.x, m.y + 10, 1); if (cp) { cp.rar = 4; cp.col = rarCol(4); cp.vx = 0; cp.vy = 0; }
    var gN = 10, gv = num(DD().ECON && DD().ECON.goldPerMetin, 60) / gN; for (var g = 0; g < gN; g++) dropPick('gold', m.x, m.y, gv);
    dropXp(m.x, m.y, m.xp);
    chargeUlt(0.15);
    banner('Metin Taşı kırıldı!', 'gold');
    sfx('metinBreak', 1); sfx('legendary', 0.5);
  }

  /* ============================================================================================
   * Enemy AI (chase / fast zigzag / tank / ranged / swarm / charger / stone) + separation
   * ========================================================================================== */
  var HY = 10;                 // hero collision centre = feet - HY
  function separate(e) {
    var x = e.x, y = e.y, r = e.r, a = EN.a, st = ++QSTAMP, m = r + 40;
    var c0 = floor((x - m) * INV_CELL), c1 = floor((x + m) * INV_CELL), r0 = floor((y - m) * INV_CELL), r1 = floor((y + m) * INV_CELL);
    var px = 0, py = 0, cnt = 0;
    for (var cy = r0; cy <= r1 && cnt < 10; cy++) for (var cx = c0; cx <= c1 && cnt < 10; cx++) {
      var j = hHead[hKey(cx, cy)];
      while (j >= 0) {
        var o = a[j]; j = hNext[j];
        if (o === e || o.qs === st) continue;
        o.qs = st;
        if (o.dead || o.ghost) continue;
        var dx = x - o.x, dy = y - o.y, s = (r + o.r) * 0.86, d2 = dx * dx + dy * dy;
        if (d2 >= s * s) continue;
        if (d2 < 0.01) { px += rr(-1, 1); py += rr(-1, 1); continue; }
        var d = sqrt(d2), ov = (s - d) / d, w = o.mass / (o.mass + e.mass);
        px += dx * ov * w; py += dy * ov * w;
        if (++cnt >= 10) break;
      }
    }
    e.x += px * 0.55; e.y += py * 0.55;
  }
  function arenaClamp(e) {
    var A = R.arena, dx = e.x - A.x, dy = e.y - A.y, d = sqrt(dx * dx + dy * dy) || 1;
    if (e.inA >= 0) { var lim = A.r - e.r * 0.8; if (d > lim) { e.x = A.x + dx / d * lim; e.y = A.y + dy / d * lim; } }
    else { var lo = A.r + e.r + 6; if (d < lo) { e.x = A.x + dx / d * lo; e.y = A.y + dy / d * lo; } }
  }
  function updEnemies(dt) {
    hBuild();
    var a = EN.a, n = EN.n, t = R.time, alive = 0;
    var farD = sqrt(R.vw * R.vw + R.vh * R.vh) * 0.95 + 120, farD2 = farD * farD;
    var hx = H.x, hy = H.y - HY;
    for (var i = 0; i < n; i++) {
      var e = a[i]; if (e.dead) continue;
      e.hitT += dt;
      if (!e.boss && !e.stone) alive++;
      statusTick(e, dt); if (e.dead) continue;
      if (e.stone) { updMetin(e, dt); continue; }
      if (e.boss) { updBoss(e, dt); continue; }
      var df = e.def, dx = hx - e.x, dy = hy - e.y, d2 = dx * dx + dy * dy, d = sqrt(d2) || 1, nx = dx / d, ny = dy / d;
      // stragglers far behind are recycled in front of the hero (keeps the pressure on)
      if (d2 > farD2 && e.mode !== 9 && !R.arena) {
        var p = ringPoint(e.r); e.x = p.x; e.y = p.y; e.kx = 0; e.ky = 0; e.mode = 0; e.castP = 0; continue;
      }
      var sp = e.spd * (e.slowT > 0 ? 1 - e.slow : 1) * (e.frozen ? 0 : 1);
      var mvx = 0, mvy = 0;
      if (e.mode === 9) {
        e.modeT -= dt; mvx = e.ax * sp; mvy = e.ay * sp;
        if (e.modeT <= 0) e.mode = 0;
      } else {
        switch (e.kind) {
          case 'fast': { var zz = sin(t * 5.5 + e.uid * 1.3) * 0.8; mvx = (nx - ny * zz) * sp; mvy = (ny + nx * zz) * sp; break; }
          case 'swarm': { var w = sin(t * 3.2 + e.uid * 1.7) * 0.5; mvx = (nx - ny * w) * sp; mvy = (ny + nx * w) * sp; break; }
          case 'ranged': {
            var keep = num(df.keep, 220);
            if (d > keep + 30) { mvx = nx * sp; mvy = ny * sp; }
            else if (d < keep - 50) { mvx = -nx * sp * 0.8; mvy = -ny * sp * 0.8; }
            else { var sd = (e.uid & 1) ? 1 : -1; mvx = -ny * sp * 0.45 * sd; mvy = nx * sp * 0.45 * sd; }
            if (df.shot && !e.frozen) {
              e.shotCd -= dt;
              e.castP = (e.shotCd < 0.45 && d < keep + 220) ? 1 - mx(0, e.shotCd) / 0.45 : 0;
              if (e.shotCd <= 0) { if (d < keep + 220) enemyShoot(e, atan2(dy, dx)); e.shotCd = num(df.shot.cd, 2) * rr(0.85, 1.2); e.castP = 0; }
            }
            break;
          }
          case 'charger': {
            var ds = df.dash || NO;
            if (e.frozen) { if (e.mode !== 0) { e.mode = 0; e.st = 1; } e.castP = 0; break; }
            if (e.mode === 0) {
              mvx = nx * sp; mvy = ny * sp; e.st -= dt;
              if (e.st <= 0 && d < num(ds.range, 260) + 40) { e.mode = 1; e.modeT = num(ds.windup, 0.5); e.ax = nx; e.ay = ny; }
            } else if (e.mode === 1) {
              e.modeT -= dt; e.castP = 1 - e.modeT / num(ds.windup, 0.5);
              if (e.castP < 0.6) { e.ax = nx; e.ay = ny; }
              mvx = -nx * 12; mvy = -ny * 12;   // crouch back
              if (e.modeT <= 0) { e.mode = 2; e.modeT = num(ds.dur, 0.45); e.castP = 0; }
            } else {
              mvx = e.ax * num(ds.spd, 330); mvy = e.ay * num(ds.spd, 330); e.modeT -= dt;
              if (rand() < 0.5) part(PT_SMOKE, e.x - e.ax * e.r, e.y + e.r * 0.5, -e.ax * 30, -10, 0.4, 7, '#3A3048', 0, 2);
              if (e.modeT <= 0) { e.mode = 0; e.st = num(ds.every, 3.2) * rr(0.8, 1.2); }
            }
            break;
          }
          default: mvx = nx * sp; mvy = ny * sp;
        }
      }
      e.x += (mvx + e.kx) * dt; e.y += (mvy + e.ky) * dt;
      var kd = exp(-7 * dt); e.kx *= kd; e.ky *= kd;
      if (mvx > 4) e.dir = 1; else if (mvx < -4) e.dir = -1;
      e.moving = !e.frozen;
      if (!e.ghost) separate(e);
      // the hero shoulders through the crowd
      var ddx = e.x - hx, ddy = e.y - hy, dd2 = ddx * ddx + ddy * ddy, cr = e.r + HERO_R;
      if (dd2 < cr * cr * 0.7 && dd2 > 0.01) { var dd = sqrt(dd2), ov = (cr * 0.84 - dd) / dd; if (ov > 0) { e.x += ddx * ov * 0.5; e.y += ddy * ov * 0.5; } }
      if (R.arena) arenaClamp(e);
      // contact damage
      e.atkCd -= dt;
      if (!e.frozen && d < cr && e.atkCd <= 0) { hurtHero(e.dmg * (e.mode === 2 ? 1.4 : 1), e); e.atkCd = 0.8; }
      // near-miss tracking: came within ~40 px of contact, hero kept moving, no hit within 1 s
      if (e.nearCd > 0) e.nearCd -= dt;
      var gap = d - cr;
      if (e.nearT < 0) {
        if (gap > 0 && gap < 52 && e.nearCd <= 0 && H.moving && (e.kind === 'charger' ? e.mode === 2 : d2 > 0)) { e.nearT = t; e.nearHit = false; e.nearD = R.res.distance; }
      } else if (t - e.nearT >= 0.9) {
        if (!e.nearHit && R.res.distance - e.nearD > 35 && gap > 0 && (e.kind === 'charger' || e.kind === 'fast' || rand() < 0.7)) nearMiss(H.x, H.y);
        e.nearT = -1; e.nearCd = 5;
      }
      e.zy = e.y + e.r * 0.6;
    }
    R.alive = alive;
  }

  var B_ECTO = 1, B_CURSE = 2, B_BONE = 3, B_FIRE = 4;
  function bullet(x, y, ang, spd, dmg, r, col, kind, src) {
    var b = EB.take(); if (!b) return null;
    b.kind = kind; b.x = x; b.y = y; b.vx = cos(ang) * spd; b.vy = sin(ang) * spd; b.r = r; b.dmg = dmg; b.life = 4.5; b.col = col; b.near = false; b.rot = ang; b.src = src;
    return b;
  }
  function enemyShoot(e, ang) {
    var s = e.def.shot || {}, n = num(s.n, 1), sp = num(s.spread, 0);
    for (var k = 0; k < n; k++) {
      var a = ang + (n > 1 ? (k - (n - 1) / 2) * sp : 0);
      bullet(e.x + cos(a) * e.r * 0.6, e.y - e.r * 0.2, a, num(s.spd, 170), num(s.dmg, 10) * dmgScale(), num(s.r, 7), s.col || '#7DF5C8', e.elite ? B_CURSE : B_ECTO, e);
    }
    burst(e.x + cos(ang) * e.r * 0.7, e.y - e.r * 0.2, 4, s.col || '#7DF5C8', 70, 0.3, 3, PT_GLOW);
    sfx('magic', 0.18, 1.5);
  }
  function updBullets(dt) {
    var hx = H.x, hy = H.y - 16;
    for (var i = EB.n - 1; i >= 0; i--) {
      var b = EB.a[i];
      b.life -= dt; b.x += b.vx * dt; b.y += b.vy * dt; b.rot += dt * 9;
      var dx = hx - b.x, dy = hy - b.y, d2 = dx * dx + dy * dy, rr2 = b.r + HERO_R - 3;
      if (!H.dead && d2 < rr2 * rr2) {
        hurtHero(b.dmg, b.src && !b.src.dead ? b.src : null);
        burst(b.x, b.y, 6, b.col, 120, 0.3, 3, PT_GLOW);
        EB.kill(i); continue;
      }
      if (!b.near && d2 < (rr2 + 24) * (rr2 + 24) && H.moving) b.near = true;
      else if (b.near === true && d2 > (rr2 + 50) * (rr2 + 50)) { b.near = 2; nearMiss(H.x, H.y); }
      if (b.life <= 0) EB.kill(i);
    }
  }

  /* ============================================================================================
   * Metin stone
   * ========================================================================================== */
  var METIN_LIFT = 30;     // collision centre sits 30 px above the stone's base
  function updMetin(m, dt) {
    m.zy = m.y + METIN_LIFT;
    if (m.inv) { m.intro -= dt; return; }
    m.st -= dt;
    m.castP = 1 - clamp(m.st / 0.7, 0, 1);
    if (m.st <= 0) {
      m.st = num(m.def.spawnEvery, 3);
      var w = curWave(), n = num(m.def.spawnN, 3);
      if (w && R.alive < CAP_EN - 40) {
        for (var k = 0; k < n; k++) {
          var a = rand() * TAU, x = m.x + cos(a) * rr(55, 80), y = m.y + METIN_LIFT + sin(a) * rr(40, 60);
          var e = spawnEnemy(poolPick(w.pool || {}), x, y);
          if (e) { portalPuff(x, y, '#B57BFF'); e.dir = cos(a) > 0 ? 1 : -1; }
        }
        burst(m.x, m.y - 40, 10, '#C49BFF', 120, 0.6, 4, PT_GLOW, 50);
        sfx('magic', 0.35, 0.55);
      }
    }
    // the stone blocks the hero
    var dx = H.x - m.x, dy = (H.y - HY) - (m.y + 14), d = sqrt(dx * dx + dy * dy) || 1, lim = m.r * 0.8 + HERO_R;
    if (d < lim) { H.x = m.x + dx / d * lim; H.y = m.y + 14 + HY + dy / d * lim; }
  }

  /* ============================================================================================
   * Bosses — 3 attack patterns each, red ground telegraphs, enrage after dur + 60 s
   * ========================================================================================== */
  function startBossWarning(ev) {
    if (R.bossPhase > 0) return;
    R.bossPhase = 1; R.warnT = 3.0; R.bossDef = ev;
    var df = enemyDef(ev.e || R.ch.boss) || {};
    showWarn(df.n || 'Boss');
    music('boss'); sfx('warning', 1); sfx('bossRoar', 0.7, 0.7); duck(0.5, 1.5);
  }
  function spawnBoss() {
    var type = (R.bossDef && R.bossDef.e) || R.ch.boss || 'kurtKral';
    var ar = mn(310, mx(R.vw, 300) * 0.82);
    if (!R.arena) {
      R.arena = { x: H.x, y: H.y, r: ar, t: 0 };
      for (var i = 0; i < EN.n; i++) { var o = EN.a[i]; if (o.dead) continue; var dx = o.x - H.x, dy = o.y - H.y; o.inA = dx * dx + dy * dy < ar * ar ? 1 : -1; if (o.stone) { o.dead = true; R.metinAlive = 0; fx(FX_EXPL, o.x, o.y, 60, 0.6, '#B57BFF'); } }
    }
    var b = spawnEnemy(type, R.arena.x, R.arena.y - ar * 0.4);
    if (!b) { R.warnT = 0.05; return; }
    b.inA = 1; b.inv = true; b.bs = 'intro'; b.bt = 1.8; b.lift = 1; b.intro = 1.8; b.atkCd = 1.5;
    R.boss = b; R.bossPhase = 2;
    fx(FX_PILLAR, b.x, b.y + b.r, 90, 1.8, '#E8394D'); fx(FX_SHOCK, R.arena.x, R.arena.y, ar, 0.9, '#E8394D');
    shake(12); flash(0.35, '#E8394D');
    showBossIntro(b);
    sfx('bossRoar', 1, 0.85); sfx('explosion', 0.6, 0.5);
  }
  function bdmg(b, m) { return b.dmg * m * (b.enr ? 1.5 : 1); }
  function heroIn(x, y, r) { var dx = H.x - x, dy = (H.y - HY) - y; return dx * dx + dy * dy < (r + HERO_R * 0.6) * (r + HERO_R * 0.6); }
  function heroInCone(x, y, ang, arc, len) {
    var dx = H.x - x, dy = (H.y - HY) - y, d = sqrt(dx * dx + dy * dy);
    if (d > len + HERO_R) return false;
    if (d < HERO_R + 10) return true;
    return abs(angDiff(atan2(dy, dx), ang)) < arc / 2 + HERO_R / d;
  }
  function heroInLine(x, y, ang, len, w) {
    var dx = H.x - x, dy = (H.y - HY) - y, c = cos(ang), s = sin(ang);
    var along = dx * c + dy * s, across = -dx * s + dy * c;
    return along > -10 && along < len && abs(across) < w / 2 + HERO_R * 0.6;
  }
  var BOSS = {
    kurtKral: {
      next: function (b, d) {
        var r = rand();
        if (d < 170 && r < 0.45) { b.bs = 'clawW'; b.bn = 3; b.bt = 0.42; bossClawTele(b); }
        else if (r < 0.72 || b.bk === 0) { b.bs = 'dashW'; b.bn = (b.hpPct < 0.5 || b.enr) ? 2 : 1; bossDashTele(b); }
        else { b.bs = 'howl'; b.bt = 1.1; sfx('bossRoar', 0.5, 1.2); }
        b.bk++;
      },
      upd: function (b, dt, d, nx, ny) {
        switch (b.bs) {
          case 'dashW':
            b.phase = 'cast'; b.castP = 1 - b.bt / 0.8;
            if (b.castP < 0.7) b.ba = atan2(H.y - HY - b.y, H.x - b.x);
            b.vx = -cos(b.ba) * 18; b.vy = -sin(b.ba) * 18;
            if (b.bt <= 0) { b.bs = 'dash'; b.bt = 0.55; sfx('dash', 0.8, 0.8); sfx('whoosh', 0.7, 0.7); b.atkCd = 0; }
            break;
          case 'dash':
            b.phase = 'dash'; b.vx = cos(b.ba) * 760; b.vy = sin(b.ba) * 760;
            if (rand() < 0.8) part(PT_SMOKE, b.x - cos(b.ba) * b.r, b.y + b.r * 0.6, rr(-20, 20), -20, 0.5, 14, '#2A2238', 0, 2);
            if (b.atkCd <= 0 && d < b.r + HERO_R + 6) { hurtHero(bdmg(b, 1.5), b); b.atkCd = 0.6; }
            if (b.bt <= 0) { b.bn--; if (b.bn > 0) { b.bs = 'dashW'; bossDashTele(b); } else { b.bs = 'rec'; b.bt = 0.6; } shake(4); }
            break;
          case 'howl':
            b.phase = 'cast'; b.castP = 1 - b.bt / 1.1; b.vx = 0; b.vy = 0;
            if (b.bt <= 0) {
              var z = zone(Z_SHOCK, b.x, b.y, 0, 0.9, bdmg(b, 0.9), 'none', '#E8394D'); if (z) z.amp = 0;
              fx(FX_SHOCK, b.x, b.y, 300, 0.8, '#FF5A6A'); shake(10); flash(0.15, '#E8394D');
              var n = b.enr ? 6 : 4, sum = (b.def && b.def.summon) || 'kurt';
              for (var k = 0; k < n; k++) { var a = k / n * TAU + rand() * 0.5, x = b.x + cos(a) * 90, y = b.y + sin(a) * 70; var e = spawnEnemy(sum, x, y); if (e) { e.inA = 1; portalPuff(x, y, '#E8394D'); } }
              sfx('bossRoar', 0.9, 1.0);
              b.bs = 'rec'; b.bt = 0.8;
            }
            break;
          case 'clawW':
            b.phase = 'cast'; b.castP = 1 - b.bt / 0.42; b.vx = nx * 30; b.vy = ny * 30;
            if (b.bt <= 0) {
              var hitH = heroInCone(b.x, b.y, b.ba, 2.2, 150);
              if (hitH) hurtHero(bdmg(b, 1.0), b); else if (heroInCone(b.x, b.y, b.ba, 2.6, 190)) nearMiss(H.x, H.y);
              var f = fx(FX_CLAW, b.x, b.y, 140, 0.28, '#FF6A6A', b.ba, 2.4);
              b.x += cos(b.ba) * 28; b.y += sin(b.ba) * 28;
              sfx('slash', 0.8, 0.7); shake(4);
              b.bn--;
              if (b.bn > 0) { b.bt = 0.36; bossClawTele(b); } else { b.bs = 'rec'; b.bt = 0.7; }
            }
            break;
          case 'rec': b.phase = 'idle'; b.vx *= 0.8; b.vy *= 0.8; if (b.bt <= 0) { b.bs = 'move'; b.bt = rr(1.3, 2.1) * (b.hpPct < 0.5 ? 0.75 : 1) * (b.enr ? 0.6 : 1); } break;
        }
      }
    },
    kemikEjder: {
      next: function (b, d) {
        var r = rand();
        if (r < 0.4) { b.bs = 'breathW'; b.bt = 0.95; b.ba = atan2(H.y - HY - b.y, H.x - b.x); var t = tele(T_CONE, b.x, b.y, 0, 0.95, A_NONE, 0); if (t) { t.ang = b.ba; t.arc = 0.95; t.len = 400; t.owner = b; } sfx('magic', 0.6, 0.5); }
        else if (r < 0.75) { b.bs = 'bonesW'; b.bt = 0.6; }
        else { b.bs = 'spikesW'; b.bt = 0.7; b.bn = 2; }
      },
      upd: function (b, dt, d, nx, ny) {
        switch (b.bs) {
          case 'breathW': b.phase = 'cast'; b.castP = 1 - b.bt / 0.95; b.vx = 0; b.vy = 0; b.ba += angDiff(atan2(H.y - HY - b.y, H.x - b.x), b.ba) * mn(1, dt * 3);
            if (b.bt <= 0) { b.bs = 'breath'; b.bt = 1.8; b.bk = 0; var f = fx(FX_BREATH, b.x, b.y, 400, 1.8, '#7DFFE0', b.ba, 0.95); if (f) { f.ref = b; f.a = b.uid; } sfx('fire', 0.8, 0.6); } break;
          case 'breath':
            b.phase = 'cast'; b.castP = 1; b.vx = 0; b.vy = 0;
            b.ba += clamp(angDiff(atan2(H.y - HY - b.y, H.x - b.x), b.ba), -0.75 * dt, 0.75 * dt);
            b.bk -= dt;
            if (b.bk <= 0) { b.bk = 0.2; if (heroInCone(b.x, b.y, b.ba, 0.95, 400)) hurtHero(bdmg(b, 0.42), b); }
            for (var q = 0; q < 3; q++) { var aa = b.ba + rr(-0.42, 0.42), sp = rr(260, 420); part(PT_GLOW, b.x + cos(b.ba) * b.r, b.y + sin(b.ba) * b.r * 0.6 - 10, cos(aa) * sp, sin(aa) * sp, rr(0.6, 1.0), rr(6, 12), rand() < 0.5 ? '#7DFFE0' : '#2BE8B0', 0, 0.6); }
            if (b.bt <= 0) { b.bs = 'rec'; b.bt = 0.6; }
            break;
          case 'bonesW': b.phase = 'cast'; b.castP = 1 - b.bt / 0.6; b.vx = 0; b.vy = 0;
            if (b.bt <= 0) {
              var n = b.enr ? 14 : 10;
              for (var k = 0; k < n; k++) {
                var x = k === 0 ? H.x : H.x + rr(-240, 240), y = k === 0 ? H.y - HY : H.y - HY + rr(-240, 240);
                if (R.arena) { var ax = x - R.arena.x, ay = y - R.arena.y, ad = sqrt(ax * ax + ay * ay); if (ad > R.arena.r - 20) { x = R.arena.x + ax / ad * (R.arena.r - 20); y = R.arena.y + ay / ad * (R.arena.r - 20); } }
                var t = tele(T_CIRCLE, x, y, 44, 0.9 + k * 0.07, A_BONE, bdmg(b, 1.0)); if (t) { t.owner = b; t.col = '#E8394D'; }
              }
              sfx('bossRoar', 0.5, 1.4); b.bs = 'rec'; b.bt = 1.3;
            }
            break;
          case 'spikesW': b.phase = 'cast'; b.castP = 1 - b.bt / 0.7; b.vx = 0; b.vy = 0;
            if (b.bt <= 0) {
              var m = b.enr ? 20 : 16, off = b.bn * 0.5 / m * TAU;
              for (var j = 0; j < m; j++) bullet(b.x, b.y - 10, j / m * TAU + off, 210, bdmg(b, 0.6), 8, '#F2EAD8', B_BONE, b);
              sfx('magic', 0.6, 0.7); shake(3);
              b.bn--; if (b.bn > 0) b.bt = 0.35; else { b.bs = 'rec'; b.bt = 0.8; }
            }
            break;
          case 'rec': b.phase = 'idle'; b.vx *= 0.8; b.vy *= 0.8; if (b.bt <= 0) { b.bs = 'move'; b.bt = rr(1.4, 2.2) * (b.hpPct < 0.5 ? 0.75 : 1) * (b.enr ? 0.6 : 1); } break;
        }
      }
    },
    korIblisi: {
      next: function (b, d) {
        var r = rand();
        if (r < 0.36) { b.bs = 'ringW'; b.bt = 0.8; b.bn = b.enr ? 4 : 3; }
        else if (r < 0.7) { b.bs = 'jump'; b.bt = 0.45; sfx('whoosh', 0.8, 0.5); }
        else { b.bs = 'volleyW'; b.bt = 0.5; b.bn = 3; }
      },
      upd: function (b, dt, d, nx, ny) {
        switch (b.bs) {
          case 'ringW': b.phase = 'cast'; b.castP = 1 - b.bt / 0.8; b.vx = 0; b.vy = 0;
            if (b.bt <= 0) {
              var z = zone(Z_FRING, b.x, b.y, 0, 2.6, bdmg(b, 1.0), 'ates', '#FF7A2F'); if (z) { z.amp = 0; z.burn = rand() * TAU; }
              fx(FX_SHOCK, b.x, b.y, 80, 0.4, '#FF7A2F'); sfx('fire', 0.8, 0.8); shake(3);
              b.bn--; if (b.bn > 0) b.bt = 0.55; else { b.bs = 'rec'; b.bt = 0.9; }
            }
            break;
          case 'jump': b.phase = 'cast'; b.inv = true; b.lift = 1 - b.bt / 0.45; b.vx = 0; b.vy = 0;
            if (b.bt <= 0) { b.bs = 'air'; b.bt = 1.05; var t = tele(T_CIRCLE, H.x, H.y - HY, 96, 1.05, A_NONE, 0); if (t) { t.owner = b; t.a = 1; } b.bx = H.x; b.by = H.y - HY; }
            break;
          case 'air': b.phase = 'cast'; b.lift = 1; b.inv = true;
            if (b.bt > 0.5) { b.bx = H.x; b.by = H.y - HY; for (var i = 0; i < TG.n; i++) { var tt = TG.a[i]; if (tt.owner === b && tt.a === 1) { tt.x = b.bx; tt.y = b.by; } } }
            if (b.bt <= 0) {
              b.x = b.bx; b.y = b.by; b.inv = false; b.lift = 0;
              if (heroIn(b.x, b.y, 96)) hurtHero(bdmg(b, 1.6), b); else nearMiss(H.x, H.y);
              shake(15); flash(0.3, '#FF7A2F'); hitstop(0.06);
              fx(FX_SHOCK, b.x, b.y, 200, 0.7, '#FF7A2F'); fx(FX_EXPL, b.x, b.y, 110, 0.7, '#FF7A2F'); fx(FX_SCORCH, b.x, b.y + 20, 90, 20, '#000');
              var c = hQuery(b.x, b.y, 160, QA); for (var j = 0; j < c; j++) { var o = QA[j]; if (o !== b) { o.kx += (o.x - b.x) * 4; o.ky += (o.y - b.y) * 4; } }
              var n = b.enr ? 9 : 6;
              for (var k = 0; k < n; k++) { var a = k / n * TAU + rand(), rd = rr(140, 260), x = b.x + cos(a) * rd, y = b.y + sin(a) * rd; var tm = tele(T_CIRCLE, x, y, 52, 0.8 + k * 0.1, A_BMETEOR, bdmg(b, 1.1)); if (tm) tm.owner = b; }
              sfx('explosion', 1, 0.6); b.bs = 'rec'; b.bt = 0.9;
            }
            break;
          case 'volleyW': b.phase = 'cast'; b.castP = 1 - b.bt / 0.5; b.vx = 0; b.vy = 0;
            if (b.bt <= 0) {
              var m = b.enr ? 14 : 10, off = b.bn * 0.37;
              for (var q = 0; q < m; q++) bullet(b.x, b.y - 14, q / m * TAU + off, 190, bdmg(b, 0.7), 10, '#FF7A2F', B_FIRE, b);
              sfx('fire', 0.6, 1.1); b.bn--; if (b.bn > 0) b.bt = 0.35; else { b.bs = 'rec'; b.bt = 0.8; }
            }
            break;
          case 'rec': b.phase = 'idle'; b.vx *= 0.8; b.vy *= 0.8; if (b.bt <= 0) { b.bs = 'move'; b.bt = rr(1.3, 2.0) * (b.hpPct < 0.5 ? 0.75 : 1) * (b.enr ? 0.6 : 1); } break;
        }
      }
    }
  };
  function bossDashTele(b) {
    b.bt = 0.8; b.ba = atan2(H.y - HY - b.y, H.x - b.x);
    var t = tele(T_LINE, b.x, b.y, 0, 0.8, A_NONE, 0); if (t) { t.owner = b; t.ang = b.ba; t.len = 440; t.w = b.r * 1.5; }
    sfx('bossRoar', 0.35, 1.6);
  }
  function bossClawTele(b) {
    b.ba = atan2(H.y - HY - b.y, H.x - b.x);
    var t = tele(T_CONE, b.x, b.y, 0, b.bt, A_NONE, 0); if (t) { t.owner = b; t.ang = b.ba; t.arc = 2.2; t.len = 150; }
  }
  function updBoss(b, dt) {
    var P = BOSS[b.type] || BOSS[(b.def && b.def.art)] || BOSS.kurtKral;
    b.bt -= dt; b.atkCd -= dt;
    var dx = H.x - b.x, dy = (H.y - HY) - b.y, d = sqrt(dx * dx + dy * dy) || 1, nx = dx / d, ny = dy / d;
    if (!b.enr && R.time >= num(R.ch.dur, 240) + 60) {
      b.enr = true; banner('Boss öfkelendi! Hasarı ×1,5', 'red'); shake(10); flash(0.3, '#E8394D'); sfx('bossRoar', 1, 0.7);
    }
    var sp = b.spd * (b.slowT > 0 ? 1 - b.slow * 0.5 : 1) * (b.enr ? 1.25 : 1);
    if (b.bs === 'intro') {
      b.inv = true; b.lift = clamp(b.bt / 1.8, 0, 1); b.phase = 'cast'; b.castP = 1 - b.lift; b.vx = 0; b.vy = 0;
      if (rand() < 0.6) part(PT_SMOKE, b.x + rr(-40, 40), b.y + b.r, rr(-30, 30), -rr(20, 60), 0.8, rr(10, 18), '#2A2238', 0, 1.5);
      if (b.bt <= 0) { b.inv = false; b.lift = 0; b.bs = 'move'; b.bt = 1.0; shake(10); sfx('bossRoar', 1, 1); fx(FX_SHOCK, b.x, b.y, 180, 0.6, '#E8394D'); }
    } else if (b.bs === 'move') {
      b.phase = b.enr ? 'enrage' : 'move';
      var close = d < b.r + HERO_R + 8;
      b.vx = close ? 0 : nx * sp; b.vy = close ? 0 : ny * sp;
      if (b.bt <= 0) P.next(b, d);
    } else P.upd(b, dt, d, nx, ny);
    if (b.bs !== 'air' && b.bs !== 'jump') {
      b.x += b.vx * dt; b.y += b.vy * dt;
      if (b.vx > 5) b.dir = 1; else if (b.vx < -5) b.dir = -1;
      if (b.bs === 'dashW' || b.bs === 'clawW' || b.bs === 'breathW' || b.bs === 'breath') b.dir = cos(b.ba) >= 0 ? 1 : -1;
    }
    if (R.arena) arenaClamp(b);
    // contact damage + the hero cannot walk through a boss
    if (!b.inv && b.bs !== 'dash' && d < b.r + HERO_R) {
      if (b.atkCd <= 0) { hurtHero(bdmg(b, 1), b); b.atkCd = 0.9; }
      var lim = b.r * 0.85 + HERO_R; if (d < lim) { H.x = b.x + nx * lim; H.y = b.y + ny * lim + HY; }
    }
    b.zy = b.y + b.r * 0.8;
    b.moving = abs(b.vx) + abs(b.vy) > 5;
  }
  function bossDied(b) {
    R.res.bosses++; R.res.kills++; R.res.killsByType[b.type] = (R.res.killsByType[b.type] || 0) + 1;
    R.bossPhase = 3; R.res.chests++; R.god = true;
    R.bossDeath = { t: 0, x: b.x, y: b.y, k: 0 };
    R.slow = 0.2; R.slowT = 1.2;
    shake(18); flash(0.7, '#FFFFFF'); hitstop(0.12);
    hideBossBar();
    sfx('bossRoar', 1, 0.6); sfx('explosion', 1, 0.5);
    var gN = 20, gv = num(DD().ECON && DD().ECON.goldPerBoss, 250) / gN;
    for (var g = 0; g < gN; g++) { var p = dropPick('gold', b.x, b.y, gv); if (p) { var a = rand() * TAU, s = rr(120, 320); p.vx = cos(a) * s; p.vy = sin(a) * s; } }
    dropXp(b.x, b.y, b.xp);
    // the rest of the horde turns to dust
    for (var i = 0; i < EN.n; i++) { var e = EN.a[i]; if (e.dead || e === b) continue; e.hitT = 0; killEnemy(e, K_ULT); }
    R.winT = 1.6;
  }

  /* ============================================================================================
   * Telegraphs, zones (ground effects)
   * ========================================================================================== */
  function updTeles(dt) {
    for (var i = TG.n - 1; i >= 0; i--) {
      var t = TG.a[i]; t.t += dt;
      var o = t.owner;
      if (o && !t.ouid) t.ouid = o.uid;
      if (o && (o.dead || o.uid !== t.ouid)) { if (t.act === A_METIN) { TG.kill(i); continue; } t.owner = o = null; if (t.act === A_NONE) { TG.kill(i); continue; } }
      if (o && t.act === A_NONE && (t.kind === T_LINE || t.kind === T_CONE)) { t.x = o.x; t.y = o.y; t.ang = o.ba; }
      if ((t.act === A_BONE || t.act === A_BMETEOR) && t.t > t.dur * 0.35 && heroIn(t.x, t.y, t.r)) t.inside = true;
      if (t.t >= t.dur) { resolveTele(t); TG.kill(i); }
    }
  }
  function resolveTele(t) {
    switch (t.act) {
      case A_METEOR: meteorImpact(t.x, t.y, t.r, t.dmg, t.a, t.b); break;
      case A_BONE:
      case A_BMETEOR: {
        if (heroIn(t.x, t.y, t.r)) hurtHero(t.dmg, t.owner && !t.owner.dead && t.owner.uid === t.ouid ? t.owner : null); else if (t.inside) nearMiss(H.x, H.y);
        if (t.act === A_BONE) {
          fx(FX_DUST, t.x, t.y, t.r * 1.2, 0.5, '#4A4038');
          for (var i = 0; i < 6; i++) { var a = rand() * TAU; part(PT_BONE, t.x, t.y - 6, cos(a) * rr(60, 160), -rr(80, 200), rr(0.4, 0.7), rr(3, 5), '#EDE4CE', 650, 0.4); }
          sfx('hit', 0.35, 0.6);
        } else {
          fx(FX_EXPL, t.x, t.y, t.r * 1.2, 0.55, '#FF7A2F'); fx(FX_SCORCH, t.x, t.y, t.r * 0.8, 10, '#000');
          zone(Z_ELAVA, t.x, t.y, t.r * 0.7, 2.2, t.dmg * 0.35, 'ates', '#FF5A1F');
          shake(4); sfx('explosion', 0.4, 0.9);
        }
        break;
      }
      case A_METIN: if (t.owner && !t.owner.dead && t.owner.uid === t.ouid) metinLanded(t.owner); break;
    }
  }
  function updZones(dt) {
    var hx = H.x, hy = H.y - HY;
    for (var i = ZN.n - 1; i >= 0; i--) {
      var z = ZN.a[i]; z.t += dt;
      if (z.t >= z.dur) { ZN.kill(i); continue; }
      if (z.owner === 0) {
        z.tick -= dt;
        if (z.tick > 0) continue;
        z.tick += 0.25;
        var c = hQuery(z.x, z.y, z.r, QB);
        for (var j = 0; j < c; j++) {
          var e = QB[j];
          if (z.kind === Z_POISON) { poison(e, z.dps, 0.8, z.amp); hit(e, z.dps * 0.25, K_DOT, 'zehir', 0, 0, 0, 0); }
          else if (z.kind === Z_LAVA || z.kind === Z_FIRE) { burn(e, z.dps * 0.5, 1.2); hit(e, z.dps * 0.25, K_DOT, 'ates', 0, 0, 0, 0); }
          else if (z.kind === Z_SHADOW) hit(e, z.dps * 0.25, K_WEAPON, 'golge', 40, z.x, z.y, 0);
        }
      } else if (z.kind === Z_FRING || z.kind === Z_SHOCK) {
        var spd = z.kind === Z_FRING ? 230 : 380;
        z.r = z.t * spd;
        if (z.amp === 0) {
          var dx = hx - z.x, dy = hy - z.y, d = sqrt(dx * dx + dy * dy);
          if (abs(d - z.r) < 16 + HERO_R * 0.5) {
            var inGap = z.kind === Z_FRING && abs(angDiff(atan2(dy, dx), z.burn)) < 0.5;
            if (inGap) { nearMiss(H.x, H.y); z.amp = 1; }
            else { hurtHero(z.dps, R.boss && !R.boss.dead ? R.boss : null); z.amp = 1; }
          }
        }
      } else {
        z.tick -= dt;
        if (z.tick <= 0) { z.tick += 0.5; if (heroIn(z.x, z.y, z.r)) hurtHero(z.dps * 0.5, null); }
      }
    }
  }

  /* ============================================================================================
   * Main weapon (by SHEET.weapon) — kilic arc slash · yay piercing arrows · orak spin · asa homing orbs
   * ========================================================================================== */
  var P_ARROW = 1, P_ORB = 2, P_WAVE = 3, P_FIRE = 4, P_HELL = 5, P_BOTTLE = 6, P_BLADE = 7, P_SPIRAL = 8, P_SOUL = 9, P_SPARK = 10, P_RAIN = 11;
  function wCol() {
    var r = R.wRar;
    if (R.wType === 'kilic') return r >= 2 ? mixc(rarCol(r), '#FFFFFF', 0.35) : '#E6ECF5';
    if (R.wType === 'orak') return r >= 2 ? rarCol(r) : '#B57BFF';
    if (R.wType === 'yay') return r >= 2 ? mixc(rarCol(r), '#FFFFFF', 0.25) : '#9FE6FF';
    return r >= 2 ? rarCol(r) : '#B57BFF';
  }
  function proj(kind, x, y, ang, spd, dmg, r, life) {
    var p = PR.take(); if (!p) return null;
    p.kind = kind; p.x = x; p.y = y; p.ang = ang; p.spd = spd; p.vx = cos(ang) * spd; p.vy = sin(ang) * spd; p.dmg = dmg; p.r = r;
    p.life = life; p.max = life; p.t = 0; p.pierce = 0; p.hn = 0; p.el = 'none'; p.src = K_SKILL; p.tgt = null; p.tuid = 0; p.col = '#FFFFFF';
    p.st = 0; p.ox = x; p.oy = y; p.tx = 0; p.ty = 0; p.range = 0; p.bounce = 0; p.a = 0; p.b = 0; p.c = 0; p.rot = ang; p.px = x; p.py = y; p.lx = x; p.ly = y;
    return p;
  }
  function hasHit(p, uid) { var h = p.hl, n = p.hn > 32 ? 32 : p.hn; for (var i = 0; i < n; i++) if (h[i] === uid) return true; return false; }
  function markHit(p, uid) { p.hl[p.hn % 32] = uid; p.hn++; }

  function heroAttackAnim(ang) { H.atkT = 0; H.atkAng = ang; if (abs(cos(ang)) > 0.2) H.dir = cos(ang) > 0 ? 1 : -1; }
  function updWeapon(dt) {
    var W0 = R.w, wd = R.wDef, st = R.st;
    W0.cd -= dt;
    if (W0.cd > 0) return;
    var cdBase = num(wd.cd, 0.8) * (1 - st.cdr) / (1 + st.suRate);
    var range = num(wd.range, 100), hx = H.x, hy = H.y - HERO_CY;
    var atk = st.atk;
    switch (R.wType) {
      case 'kilic': {
        var big = st.suExtra > 0 ? 1.25 : 1;
        var r = range * st.area * (st.suExtra > 0 ? 1.12 : 1);
        var tg = nearest(hx, hy, r + 50, 0);
        if (!tg) { W0.cd = 0.08; return; }
        var ang = atan2(tg.y - hy, tg.x - hx), arc = 140 * PI / 180 * big;
        var cnt = 1 + st.projCount;
        W0.swings++;
        for (var k = 0; k < cnt; k++) meleeArc(hx, hy, ang + k * TAU / cnt, arc, r, atk * (k ? 0.75 : 1), 150, k === 0);
        if (st.suMastery && W0.swings % 3 === 0) {
          var pw = proj(P_WAVE, hx, hy, ang, 430, atk * 1.0, 26 * st.area, 0.95);
          if (pw) { pw.src = K_WEAPON; pw.pierce = 99; pw.col = wCol(); sfx('whoosh', 0.6, 1.3); }
        }
        heroAttackAnim(ang); sfx('slash', 0.55, rr(0.92, 1.1));
        W0.cd = cdBase; break;
      }
      case 'orak': {
        var r2 = range * st.area * (st.suExtra > 0 ? 1.25 : 1);
        var tg2 = nearest(hx, hy, r2 + 30, 0);
        if (!tg2) { W0.cd = 0.08; return; }
        orakSpin(hx, hy, r2, atk * 1.25, 1);
        if (st.projCount > 0) R.w.echo = 0.2;
        if (st.suMastery) { var z = zone(Z_SHADOW, H.x, H.y - HERO_CY, r2 * 0.95, 1.0, atk * 0.9, 'golge', wCol()); }
        heroAttackAnim(atan2(tg2.y - hy, tg2.x - hx)); sfx('scythe', 0.6, rr(0.9, 1.1));
        W0.cd = cdBase; break;
      }
      case 'yay': {
        var tg3 = nearest(hx, hy, range, 0);
        if (!tg3) { W0.cd = 0.08; return; }
        W0.shots++;
        var a0 = atan2(tg3.y - hy, tg3.x - hx);
        var n = 1 + st.projCount + st.suExtra, spread = 0.13;
        if (st.suMastery && W0.shots % 4 === 0) { n = mx(n, 5); spread = 0.2; }
        for (var i = 0; i < n; i++) {
          var a = a0 + (i - (n - 1) / 2) * spread;
          var p = proj(P_ARROW, hx + cos(a) * 12, hy + sin(a) * 12, a, 680, atk * 0.9, 9, range / 680 + 0.1);
          if (p) { p.src = K_WEAPON; p.pierce = 1 + st.pierce; p.col = wCol(); }
        }
        burst(hx + cos(a0) * 16, hy + sin(a0) * 16, 3, wCol(), 80, 0.2, 2.5, PT_STREAK);
        heroAttackAnim(a0); sfx('arrow', 0.5, rr(0.95, 1.1));
        W0.cd = cdBase; break;
      }
      default: {     // asa
        var nO = 1 + st.projCount + st.suExtra;
        var c = nearestK(hx, hy, range, nO, QA);
        if (!c) { W0.cd = 0.08; return; }
        for (var j = 0; j < nO; j++) {
          var t = QA[j % c], ao = atan2(t.y - hy, t.x - hx) + (j - (nO - 1) / 2) * 0.5;
          var po = proj(P_ORB, hx + cos(ao) * 14, hy - 6 + sin(ao) * 10, ao, 170, atk * 0.95, 9, 3.2);
          if (po) { po.src = K_WEAPON; po.tgt = t; po.tuid = t.uid; po.col = wCol(); po.range = 44 * st.area; }
        }
        heroAttackAnim(atan2(QA[0].y - hy, QA[0].x - hx)); sfx('magic', 0.5, rr(1.0, 1.2));
        W0.cd = cdBase;
      }
    }
  }
  function meleeArc(x, y, ang, arc, r, dmg, kb, main) {
    var c = hQuery(x, y, r, QA), hits = 0;
    for (var i = 0; i < c; i++) {
      var e = QA[i], dx = e.x - x, dy = e.y - y, d = sqrt(dx * dx + dy * dy) || 1;
      if (d > e.r + 18 && abs(angDiff(atan2(dy, dx), ang)) > arc / 2 + e.r / d) continue;
      hit(e, dmg, K_WEAPON, 'none', kb, x, y, 0); hits++;
    }
    fx(FX_SLASH, x, y, r * 0.95, 0.24, wCol(), ang, arc);
    if (hits && main) { shake(1.2); burst(x + cos(ang) * r * 0.6, y + sin(ang) * r * 0.6, 4, wCol(), 160, 0.25, 2.5, PT_STREAK); sfx('hit', 0.3, rr(0.9, 1.15)); }
  }
  function orakSpin(x, y, r, dmg, main) {
    var c = hQuery(x, y, r, QA);
    for (var i = 0; i < c; i++) hit(QA[i], dmg, K_WEAPON, 'none', 260, x, y, 0);
    var f = fx(FX_SPIN, x, y, r, 0.38, wCol()); if (f) f.ref = H;
    if (c && main) shake(2);
  }

  /* ============================================================================================
   * Run skills (actives + evolutions) — numbers from GM.D.RUN_SKILLS[*].lv
   * ========================================================================================== */
  function skCd(cd) { return mx(0.15, num(cd, 2) * (1 - R.st.cdr)); }
  function skAtk() { return R.st.atk; }
  function inVortex(e) { var s = R.sk.mutlakSifir; if (!s) return false; var dx = e.x - H.x, dy = e.y - (H.y - HERO_CY), r = num(skLv('mutlakSifir', 1).r, 190) * R.st.area; return dx * dx + dy * dy < r * r; }
  function strike(x, y, dmg, r, chain, big, kind) {
    kind = kind || K_SKILL;
    var f = fx(FX_BOLT, x + rr(-50, 50), y - 420, 0, big ? 0.3 : 0.22, '#FFE45C'); if (f) { f.x2 = x; f.y2 = y; f.a = big ? 2 : 1; }
    fx(FX_EXPL, x, y, r * (big ? 1.3 : 1), 0.35, '#FFE45C'); fx(FX_SCORCH, x, y + 6, r * 0.6, 6, '#000');
    var c = hQuery(x, y, r, QB), first = null;
    for (var i = 0; i < c; i++) { var e = QB[i]; if (!first) first = e; hit(e, dmg, kind, 'yildirim', 60, x, y, 0); }
    if (chain > 0 && first) {
      var px = x, py = y, used = first.uid;
      for (var k = 0; k < chain; k++) {
        var cc = hQuery(px, py, 160, QC), nb = null, bd = 1e9;
        for (var j = 0; j < cc; j++) { var o = QC[j]; if (o.uid === used || o.dead) continue; var dx = o.x - px, dy = o.y - py, dd = dx * dx + dy * dy; if (dd < bd) { bd = dd; nb = o; } }
        if (!nb) break;
        var fb = fx(FX_BOLT, px, py, 0, 0.2, '#FFF27A'); if (fb) { fb.x2 = nb.x; fb.y2 = nb.y; fb.a = 0.6; }
        hit(nb, dmg * 0.6, kind, 'yildirim', 30, px, py, 0);
        px = nb.x; py = nb.y; used = nb.uid;
      }
    }
    sfx('lightning', big ? 0.55 : 0.4, rr(0.9, 1.15));
  }
  function explode(x, y, r, dmg, el, col, kb, burnS, mainE) {
    var c = hQuery(x, y, r, QB);
    for (var i = 0; i < c; i++) { var e = QB[i]; hit(e, dmg, el === 'none' ? K_WEAPON : K_SKILL, el, kb, x, y, 0); if (burnS > 0 && !e.dead) burn(e, dmg * 0.22, burnS); }
    fx(FX_EXPL, x, y, r, 0.5, col);
    if (r > 50) shake(r * 0.04);
  }
  function meteorImpact(x, y, r, dmg, lava, big) {
    var c = hQuery(x, y, r, QB);
    for (var i = 0; i < c; i++) hit(QB[i], dmg, K_SKILL, 'ates', 240, x, y, 0);
    fx(FX_EXPL, x, y, r * (big ? 0.72 : 0.85), 0.6, '#FF7A2F'); fx(FX_SHOCK, x, y, r * 1.25, 0.45, '#FFB04A'); fx(FX_SCORCH, x, y + 4, r * 0.7, 14, '#000');
    for (var k = 0; k < 8; k++) { var a = rand() * TAU; part(PT_BONE, x, y - 6, cos(a) * rr(80, 220), -rr(100, 260), rr(0.5, 0.9), rr(3, 6), '#3A2A24', 650, 0.4); }
    burst(x, y - 10, 12, '#FFB04A', 260, 0.6, 4, PT_GLOW, 40);
    if (lava > 0) zone(Z_LAVA, x, y, r * 0.7, lava * R.st.dur, skAtk() * 0.8, 'ates', '#FF5A1F');
    shake(big ? 9 : 6); flash(big ? 0.12 : 0.06, '#FF9A4A');
    sfx('explosion', big ? 0.7 : 0.55, rr(0.85, 1.05));
  }

  var SKU = Object.create(null);
  SKU.kilicHalka = function (s, dt) {
    var L = skLv('kilicHalka', s.lv), st = R.st, n = num(L.n, 2) + st.projCount, rad = num(L.r, 80) * st.area, br = 15 * st.area;
    s.a += num(L.spd, 3) * dt; s.n = n; s.r = rad;
    orbitHits(s, n, rad, br, skAtk() * num(L.dmg, 0.5), 'none', 90, 0.42);
  };
  SKU.kilicFirtina = function (s, dt) {
    var L = skLv('kilicFirtina', 1), st = R.st, n = num(L.n, 8) + st.projCount, rad = num(L.r, 115) * st.area, br = 22 * st.area;
    s.a += num(L.spd, 4.2) * dt; s.n = n; s.r = rad;
    orbitHits(s, n, rad, br, skAtk() * num(L.dmg, 1.3), 'none', L.knock ? 320 : 120, 0.3);
  };
  function orbitHits(s, n, rad, br, dmg, el, kb, cd) {
    var cx = H.x, cy = H.y - HERO_CY;
    for (var i = 0; i < n; i++) {
      var a = s.a + i * TAU / n, bx = cx + cos(a) * rad, by = cy + sin(a) * rad;
      var c = hQuery(bx, by, br, QB);
      for (var j = 0; j < c; j++) {
        var e = QB[j], ecd = e.boss || e.elite || e.stone ? cd * 0.45 : cd;
        if (R.time - e.cdHalka < ecd) continue;
        e.cdHalka = R.time;
        hit(e, dmg, K_SKILL, el, kb, cx, cy, 0);
        if (rand() < 0.5) burst(bx, by, 2, '#E6F2FF', 120, 0.2, 2, PT_STREAK);
      }
    }
  }
  SKU.yildirim = function (s, dt) {
    s.t -= dt; if (s.t > 0) return;
    var L = skLv('yildirim', s.lv); s.t = skCd(L.cd);
    var c = randomIn(H.x, H.y, 430, num(L.n, 2), QA);
    if (!c) { s.t = 0.3; return; }
    for (var i = 0; i < c; i++) strike(QA[i].x, QA[i].y, skAtk() * num(L.dmg, 1.2), 34 * R.st.area, 0, false);
  };
  SKU.gokGurultusu = function (s, dt) {
    s.t -= dt; if (s.t > 0) return;
    var L = skLv('gokGurultusu', 1); s.t = skCd(L.cd);
    var c = randomIn(H.x, H.y, 460, num(L.n, 6), QA);
    if (!c) { s.t = 0.3; return; }
    for (var i = 0; i < c; i++) strike(QA[i].x, QA[i].y, skAtk() * num(L.dmg, 2.2), 44 * R.st.area, num(L.chain, 2), true);
    flash(0.08, '#FFF27A');
  };
  SKU.atesTopu = function (s, dt) {
    s.t -= dt; if (s.t > 0) return;
    var L = skLv('atesTopu', s.lv), n = num(L.n, 1) + R.st.projCount; s.t = skCd(L.cd);
    var c = nearestK(H.x, H.y - HERO_CY, 460, n, QA);
    if (!c) { s.t = 0.25; return; }
    for (var i = 0; i < n; i++) {
      var t = QA[i % c], a = atan2(t.y - (H.y - HERO_CY), t.x - H.x) + (i >= c ? rr(-0.3, 0.3) : 0);
      var p = proj(P_FIRE, H.x, H.y - HERO_CY, a, 360, skAtk() * num(L.dmg, 1), 9, 1.6);
      if (p) { p.el = 'ates'; p.tgt = t; p.tuid = t.uid; p.range = num(L.r, 45) * R.st.area; p.a = num(L.burn, 2); }
    }
    sfx('fire', 0.45, rr(1.0, 1.2));
  };
  SKU.cehennem = function (s, dt) {
    s.t -= dt; if (s.t > 0) return;
    var L = skLv('cehennem', 1), n = num(L.n, 4) + R.st.projCount; s.t = skCd(L.cd);
    s.a += 0.55;
    for (var i = 0; i < n; i++) {
      var a = s.a + i * TAU / n, p = proj(P_HELL, H.x, H.y - HERO_CY, a, 300, skAtk() * num(L.dmg, 2.5), 18 * R.st.area, 1.9);
      if (p) { p.el = 'ates'; p.pierce = 99; p.a = num(L.burn, 4); p.range = num(L.r, 70) * R.st.area; }
    }
    sfx('fire', 0.6, 0.8);
  };
  SKU.buzHalka = function (s, dt) {
    s.t -= dt; if (s.t > 0) return;
    var L = skLv('buzHalka', s.lv); s.t = skCd(L.cd);
    var r = num(L.r, 120) * R.st.area, x = H.x, y = H.y - HERO_CY, c = hQuery(x, y, r, QA);
    for (var i = 0; i < c; i++) { var e = QA[i]; hit(e, skAtk() * num(L.dmg, 0.8), K_SKILL, 'buz', 120, x, y, 0); if (!e.dead) chill(e, num(L.slow, 0.4), num(L.slowDur, 2), num(L.freeze, 0)); }
    fx(FX_NOVA, x, y, r, 0.55, '#7FD8FF');
    for (var k = 0; k < 10; k++) { var a = k / 10 * TAU; part(PT_SHARD, x + cos(a) * r * 0.3, y + sin(a) * r * 0.3, cos(a) * r * 2.2, sin(a) * r * 2.2, 0.35, rr(3, 5), '#CFF4FF', 0, 4); }
    sfx('ice', 0.55, rr(0.95, 1.1));
  };
  SKU.mutlakSifir = function (s, dt) {
    var L = skLv('mutlakSifir', 1), r = num(L.r, 190) * R.st.area, x = H.x, y = H.y - HERO_CY;
    s.a += dt * 1.4; s.r = r;
    s.t -= dt; s.k -= dt;
    if (s.t <= 0) {
      s.t = 0.25;
      var c = hQuery(x, y, r, QA);
      for (var i = 0; i < c; i++) { var e = QA[i]; hit(e, skAtk() * num(L.dps, 1.2) * 0.25, K_DOT, 'buz', 0, x, y, 0); if (!e.dead) chill(e, 0.65, 0.5, 0); }
      if (rand() < 0.7) { var a = rand() * TAU, d = rr(0.3, 1) * r; part(PT_SHARD, x + cos(a) * d, y + sin(a) * d, -sin(a) * 120, cos(a) * 120, 0.8, rr(2, 4), '#E8FBFF', 0, 1); }
    }
    if (s.k <= 0) {
      s.k = 2.4;
      var c2 = hQuery(x, y, r, QA);
      for (var j = 0; j < c2; j++) chill(QA[j], 0.65, 1.2, num(L.freeze, 1.5));
      fx(FX_NOVA, x, y, r, 0.7, '#BFF0FF'); sfx('ice', 0.6, 0.8);
    }
  };
  SKU.zehir = function (s, dt) {
    s.t -= dt; if (s.t > 0) return;
    var L = skLv('zehir', s.lv), n = num(L.n, 1) + R.st.projCount; s.t = skCd(L.cd);
    var c = randomIn(H.x, H.y, 330, n, QA);
    for (var i = 0; i < n; i++) {
      var tx, ty;
      if (i < c) { tx = QA[i].x; ty = QA[i].y; } else { var a = rand() * TAU, d = rr(80, 200); tx = H.x + cos(a) * d; ty = H.y + sin(a) * d; }
      var p = proj(P_BOTTLE, H.x, H.y - HERO_CY - 6, 0, 0, skAtk() * num(L.dps, 0.4), 6, 0.55 + i * 0.06);
      if (p) { p.el = 'zehir'; p.tx = tx; p.ty = ty; p.range = num(L.r, 60) * R.st.area; p.a = num(L.dur, 3) * R.st.dur; p.b = num(L.amp, 0); }
    }
    sfx('whoosh', 0.35, 1.5);
  };
  SKU.vebaBulutu = function (s, dt) {
    var L = skLv('vebaBulutu', 1), r = num(L.r, 150) * R.st.area;
    if (!s.init) { s.x = H.x; s.y = H.y - HERO_CY; s.init = 1; }
    var k = 1 - exp(-2.2 * dt); s.x += (H.x - s.x) * k; s.y += (H.y - HERO_CY - s.y) * k;
    s.a += dt; s.r = r;
    s.t -= dt;
    if (s.t <= 0) {
      s.t = 0.25;
      var c = hQuery(s.x, s.y, r, QA), tot = 0;
      for (var i = 0; i < c; i++) { var e = QA[i]; poison(e, 0, 0.6, 0.05); tot += hit(e, skAtk() * num(L.dps, 0.9) * 0.25, K_DOT, 'zehir', 0, s.x, s.y, 0); }
      if (tot > 0) leech(tot * num(L.leech, 0.02));
    }
    if (rand() < 0.35) part(PT_SMOKE, s.x + rr(-r, r) * 0.7, s.y + rr(-r, r) * 0.5, rr(-10, 10), -rr(8, 24), rr(0.8, 1.4), rr(14, 26), rand() < 0.5 ? '#2E5A1C' : '#3B1E4E', 0, 0.5);
  };
  SKU.bumerang = function (s, dt) {
    s.t -= dt; if (s.t > 0) return;
    var L = skLv('bumerang', s.lv), n = num(L.n, 1) + R.st.projCount; s.t = skCd(L.cd);
    var tg = nearest(H.x, H.y, 360, 0);
    var a0 = tg ? atan2(tg.y - (H.y - HERO_CY), tg.x - H.x) : H.face;
    for (var i = 0; i < n; i++) {
      var a = a0 + (i - (n - 1) / 2) * 0.42;
      var p = proj(P_BLADE, H.x, H.y - HERO_CY, a, 520 * num(L.spd, 1), skAtk() * num(L.dmg, 0.9), 15 * R.st.area, 4);
      if (p) { p.el = 'golge'; p.range = num(L.range, 260) * R.st.area; p.pierce = num(L.pierce, 3) + R.st.pierce; p.st = 0; p.a = 520 * num(L.spd, 1); }
    }
    sfx('whoosh', 0.5, 1.1);
  };
  SKU.olumDansi = function (s, dt) {
    s.t -= dt; s.a += dt * 0.7; if (s.t > 0) return;
    var L = skLv('olumDansi', 1), n = num(L.n, 6) + R.st.projCount; s.t = skCd(L.cd);
    for (var i = 0; i < n; i++) {
      var p = proj(P_SPIRAL, H.x, H.y - HERO_CY, 0, 0, skAtk() * num(L.dmg, 1.7), 17 * R.st.area, 1.35);
      if (p) { p.el = 'golge'; p.pierce = 99; p.a = s.a + i * TAU / n; p.range = 250 * R.st.area; }
    }
    sfx('whoosh', 0.6, 0.8);
  };
  SKU.meteor = function (s, dt) {
    s.t -= dt; if (s.t > 0) return;
    var L = skLv('meteor', s.lv); s.t = skCd(L.cd);
    castMeteors(num(L.n, 1), num(L.r, 90) * R.st.area, skAtk() * num(L.dmg, 2.5), num(L.lava, 0), false);
  };
  SKU.kiyamet = function (s, dt) {
    s.t -= dt; if (s.t > 0) return;
    var L = skLv('kiyamet', 1); s.t = skCd(L.cd);
    castMeteors(num(L.n, 6), num(L.r, 120) * R.st.area, skAtk() * num(L.dmg, 4.5), num(L.lava, 3), true);
    flash(0.06, '#FF5A1F');
  };
  function castMeteors(n, r, dmg, lava, big) {
    var c = randomIn(H.x, H.y, 400, n, QA);
    for (var i = 0; i < n; i++) {
      var x, y;
      if (i < c) { x = QA[i].x + rr(-12, 12); y = QA[i].y + rr(-12, 12); } else { var a = rand() * TAU, d = rr(90, 300); x = H.x + cos(a) * d; y = H.y + sin(a) * d; }
      var t = tele(T_CIRCLE, x, y, r, (big ? 0.85 : 0.95) + i * 0.08, A_METEOR, dmg);
      if (t) { t.a = lava; t.b = big ? 1 : 0; t.col = '#FF5A1F'; t.sx = x - 170 - rand() * 60; t.sy = y - 470; }
    }
  }
  SKU.ruhlar = function (s, dt) { ruhUpd(s, dt, skLv('ruhlar', s.lv), 46); };
  SKU.ruhOrdusu = function (s, dt) { ruhUpd(s, dt, skLv('ruhOrdusu', 1), 58); };
  function ruhUpd(s, dt, L, rad) {
    var n = num(L.n, 1); s.n = n; s.r = rad;
    s.a += dt * 1.5;
    if (!s.wt) { s.wt = new Float32Array(8); s.dx = new Float32Array(8); for (var q = 0; q < 8; q++) s.wt[q] = q * 0.15; }
    for (var i = 0; i < n && i < 8; i++) {
      s.dx[i] *= exp(-6 * dt);
      s.wt[i] -= dt;
      if (s.wt[i] > 0) continue;
      var a = s.a + i * TAU / n, wx = H.x + cos(a) * rad, wy = H.y - HERO_CY - 10 + sin(a) * rad * 0.7;
      var tg = nearest(wx, wy, 400, 0);
      if (!tg) { s.wt[i] = 0.2; continue; }
      s.wt[i] = skCd(L.cd);
      var ang = atan2(tg.y - wy, tg.x - wx);
      var p = proj(P_SOUL, wx, wy, ang, 400, skAtk() * num(L.dmg, 0.6), 7, 1.6);
      if (p) { p.el = 'golge'; p.tgt = tg; p.tuid = tg.uid; p.bounce = num(L.bounce, 0) + floor(R.st.pierce / 2); p.col = n >= 6 ? '#7DF5E0' : '#3EDBC8'; }
      s.dx[i] = 1;          // the wisp darts forward
      s.ang = ang;
    }
    if (rand() < 0.08) sfx('magic', 0.12, 1.8);
  }

  function updSkills(dt) {
    for (var i = 0; i < R.skOrder.length; i++) {
      var id = R.skOrder[i], s = R.sk[id];
      if (!s || R.evolved[id]) continue;
      var fn = SKU[id]; if (fn) fn(s, dt);
    }
    if (R.w.echo > 0) { R.w.echo -= dt; if (R.w.echo <= 0) { var r2 = num(R.wDef.range, 115) * R.st.area * (R.st.suExtra > 0 ? 1.25 : 1); orakSpin(H.x, H.y - HERO_CY, r2 * 1.1, R.st.atk * 0.75, 0); } }
  }

  /* ============================================================================================
   * Projectiles (hero side)
   * ========================================================================================== */
  function retarget(p, maxD) {
    var t = p.tgt;
    if (t && !t.dead && t.uid === p.tuid) return t;
    t = nearest(p.x, p.y, maxD, 0);
    p.tgt = t; p.tuid = t ? t.uid : 0;
    return t;
  }
  function steer(p, t, turn, dt) {
    var want = atan2(t.y - p.y, t.x - p.x), d = angDiff(want, p.ang);
    p.ang += clamp(d, -turn * dt, turn * dt);
    p.vx = cos(p.ang) * p.spd; p.vy = sin(p.ang) * p.spd;
  }
  function updProj(dt) {
    var i, p, c, j, e;
    for (i = PR.n - 1; i >= 0; i--) {
      p = PR.a[i];
      p.t += dt; p.life -= dt; p.lx = p.x; p.ly = p.y;
      var dead = p.life <= 0;
      switch (p.kind) {
        case P_ARROW: case P_WAVE: case P_HELL: {
          p.x += p.vx * dt; p.y += p.vy * dt;
          if (p.kind === P_HELL) {
            p.c -= dt;
            if (p.c <= 0) { p.c = 0.09; zone(Z_FIRE, p.x, p.y + 10, 24 * R.st.area, 1.4 * R.st.dur, skAtk() * 0.5, 'ates', '#FF5A1F'); }
            if (rand() < 0.6) part(PT_GLOW, p.x + rr(-6, 6), p.y + rr(-6, 6), -p.vx * 0.2 + rr(-30, 30), -p.vy * 0.2 - 30, 0.45, rr(5, 9), rand() < 0.5 ? '#FF7A2F' : '#FFB04A', 0, 1);
          }
          c = hQuery(p.x, p.y, p.r, QA);
          for (j = 0; j < c && !dead; j++) {
            e = QA[j]; if (hasHit(p, e.uid)) continue;
            markHit(p, e.uid);
            if (p.kind === P_HELL) { hit(e, p.dmg, K_SKILL, 'ates', 120, p.x - p.vx, p.y - p.vy, 0); if (!e.dead) burn(e, p.dmg * 0.15, p.a); }
            else hit(e, p.dmg, p.src, p.el, p.kind === P_WAVE ? 160 : 70, p.x - p.vx, p.y - p.vy, 0);
            if (p.kind === P_ARROW) { burst(p.x, p.y, 2, p.col, 90, 0.18, 2, PT_STREAK); if (--p.pierce < 0) dead = true; }
          }
          break;
        }
        case P_ORB: case P_FIRE: case P_SOUL: case P_SPARK: {
          var t = retarget(p, p.kind === P_SOUL ? 360 : 420);
          if (p.kind === P_ORB) p.spd = mn(470, p.spd + 520 * dt);
          if (t) steer(p, t, p.kind === P_ORB ? 7 : p.kind === P_SPARK ? 9 : p.kind === P_SOUL ? 8 : 3.5, dt);
          p.x += p.vx * dt; p.y += p.vy * dt;
          if (p.kind === P_FIRE && rand() < 0.5) part(PT_GLOW, p.x, p.y, -p.vx * 0.15 + rr(-20, 20), -p.vy * 0.15 - 20, 0.35, rr(4, 7), '#FF8A3A', 0, 1);
          c = hQuery(p.x, p.y, p.r, QA);
          if (c) {
            e = QA[0];
            if (p.kind === P_ORB) {
              explode(p.x, p.y, p.range, p.dmg, 'none', p.col, 90, 0, e);
              if (R.st.suMastery) for (var k = 0; k < 3; k++) { var sp = proj(P_SPARK, p.x, p.y, rand() * TAU, 300, p.dmg * 0.35, 6, 1.0); if (sp) { sp.src = K_WEAPON; sp.col = p.col; } }
              sfx('explosion', 0.25, 1.5); dead = true;
            } else if (p.kind === P_FIRE) {
              explode(p.x, p.y, p.range, p.dmg, 'ates', '#FF7A2F', 120, p.a, e); sfx('fire', 0.3, 1.3); dead = true;
            } else if (p.kind === P_SPARK) {
              hit(e, p.dmg, K_WEAPON, 'none', 30, p.x, p.y, 0); burst(p.x, p.y, 3, p.col, 100, 0.2, 2, PT_GLOW); dead = true;
            } else {   // soul bolt: hits and bounces
              if (!hasHit(p, e.uid)) {
                markHit(p, e.uid);
                hit(e, p.dmg, K_SKILL, 'golge', 40, p.x, p.y, 0);
                burst(p.x, p.y, 4, p.col, 110, 0.3, 3, PT_GLOW);
                if (p.bounce > 0) {
                  p.bounce--;
                  var nb = null, bd = 1e9, cc = hQuery(p.x, p.y, 220, QC);
                  for (var q = 0; q < cc; q++) { var o = QC[q]; if (hasHit(p, o.uid)) continue; var dx = o.x - p.x, dy = o.y - p.y, dd = dx * dx + dy * dy; if (dd < bd) { bd = dd; nb = o; } }
                  if (nb) { p.tgt = nb; p.tuid = nb.uid; p.life = mx(p.life, 0.8); } else dead = true;
                } else dead = true;
              }
            }
          }
          break;
        }
        case P_BOTTLE: {
          var k2 = clamp(p.t / p.max, 0, 1);
          p.x = lerp(p.ox, p.tx, k2); p.y = lerp(p.oy, p.ty, k2) - sin(k2 * PI) * 90; p.rot += dt * 14;
          if (k2 >= 1) {
            var z = zone(Z_POISON, p.tx, p.ty, p.range, p.a, p.dmg, 'zehir', '#8BE04E'); if (z) z.amp = p.b;
            fx(FX_SPLASH, p.tx, p.ty, p.range, 0.45, '#8BE04E');
            for (var q2 = 0; q2 < 8; q2++) { var a2 = rand() * TAU; part(PT_DOT, p.tx, p.ty - 4, cos(a2) * rr(60, 140), -rr(60, 160), rr(0.3, 0.6), rr(2, 4), '#B8FF7A', 520, 0.5); }
            sfx('poison', 0.45, rr(0.9, 1.1)); dead = true;
          }
          break;
        }
        case P_BLADE: {
          p.rot += dt * 18;
          if (p.st === 0) {
            var travelled = sqrt((p.x - p.ox) * (p.x - p.ox) + (p.y - p.oy) * (p.y - p.oy));
            var slow = clamp(1 - travelled / p.range, 0.12, 1);
            p.x += cos(p.ang) * p.a * slow * dt; p.y += sin(p.ang) * p.a * slow * dt;
            if (travelled >= p.range * 0.97) { p.st = 1; p.hn = 0; p.spd = 120; }
          } else {
            p.spd = mn(p.a * 1.25, p.spd + 900 * dt);
            var hx = H.x, hy = H.y - HERO_CY, dx2 = hx - p.x, dy2 = hy - p.y, dd2 = sqrt(dx2 * dx2 + dy2 * dy2) || 1;
            p.x += dx2 / dd2 * p.spd * dt; p.y += dy2 / dd2 * p.spd * dt;
            if (dd2 < 18) dead = true;
          }
          c = hQuery(p.x, p.y, p.r, QA);
          for (j = 0; j < c; j++) {
            e = QA[j]; if (hasHit(p, e.uid)) continue;
            if (p.pierce <= 0) break;
            markHit(p, e.uid); p.pierce--;
            hit(e, p.dmg, K_SKILL, 'golge', 80, p.x, p.y, 0);
          }
          if (p.st === 0 && p.pierce <= 0) { p.st = 1; p.hn = 0; p.spd = 200; p.pierce = 2; }
          break;
        }
        case P_SPIRAL: {
          var k3 = clamp(p.t / p.max, 0, 1), rad = p.range * sin(k3 * PI), ang = p.a + k3 * 4.6;
          p.x = H.x + cos(ang) * rad; p.y = H.y - HERO_CY + sin(ang) * rad; p.rot += dt * 20;
          if (k3 > 0.5 && p.b === 0) { p.b = 1; p.hn = 0; }
          c = hQuery(p.x, p.y, p.r, QA);
          for (j = 0; j < c; j++) { e = QA[j]; if (hasHit(p, e.uid)) continue; markHit(p, e.uid); hit(e, p.dmg, K_SKILL, 'golge', 110, H.x, H.y, 0); }
          break;
        }
        case P_RAIN: {     // okYagmuru arrow falling from the sky
          var k4 = clamp(p.t / p.max, 0, 1);
          p.x = lerp(p.ox, p.tx, k4); p.y = lerp(p.oy, p.ty, eIn(k4));
          if (k4 >= 1) {
            c = hQuery(p.tx, p.ty, p.range, QA);
            for (j = 0; j < c; j++) hit(QA[j], p.dmg, K_ULT, 'none', 60, p.tx, p.ty - 20, 0.5);
            burst(p.tx, p.ty, 4, '#FFE7A0', 120, 0.25, 2.5, PT_STREAK);
            fx(FX_DUST, p.tx, p.ty, 22, 0.35, '#5A4A3A');
            if (rand() < 0.3) sfx('hit', 0.2, rr(1.2, 1.5));
            dead = true;
          }
          break;
        }
      }
      if (dead) PR.kill(i);
    }
  }

  /* ============================================================================================
   * Pickups (gems / gold / heal / magnet / bomb / chest)
   * ========================================================================================== */
  function updPickups(dt) {
    var hx = H.x, hy = H.y - 14, rad = R.st.pickup, rad2 = rad * rad, mT = R.magnetT > 0;
    if (mT) R.magnetT -= dt;
    for (var i = PK.n - 1; i >= 0; i--) {
      var p = PK.a[i];
      p.t += dt; p.px = p.x; p.py = p.y;
      var dx = hx - p.x, dy = hy - p.y, d2 = dx * dx + dy * dy;
      if (!p.mag) {
        p.x += p.vx * dt; p.y += p.vy * dt; var k = exp(-5 * dt); p.vx *= k; p.vy *= k;
        var r2 = p.kind === 'chest' ? (rad * 0.6) * (rad * 0.6) : rad2;
        if ((d2 < r2 && p.t > 0.25) || (mT && p.kind.charAt(0) === 'x')) { p.mag = true; p.vx = -dx * 1.4; p.vy = -dy * 1.4; }
      } else {
        var d = sqrt(d2) || 1, acc = 1900 + p.t * 400;
        p.vx += dx / d * acc * dt; p.vy += dy / d * acc * dt;
        var damp = exp(-3.5 * dt); p.vx *= damp; p.vy *= damp;
        p.x += p.vx * dt; p.y += p.vy * dt;
        if (d < 16) { collect(p); PK.kill(i); }
      }
    }
  }
  function collect(p) {
    switch (p.kind) {
      case 'xp1': case 'xp2': case 'xp3':
        addXp(p.v); sfx('gem', 0.3, p.kind === 'xp3' ? 0.8 : p.kind === 'xp2' ? 0.95 : 1.1); break;
      case 'gold':
        R.res.goldPicked += p.v; R.hudDirty = true; sfx('gold', 0.3); break;
      case 'heal':
        heal(R.st.maxHp * 0.25, true); burst(H.x, H.y - HERO_CY, 12, '#7CFF8E', 120, 0.6, 4, PT_GLOW, 40); sfx('heal', 0.7); break;
      case 'magnet':
        R.magnetT = 1.2; fx(FX_SHOCK, H.x, H.y - HERO_CY, 260, 0.5, '#4BA3FF'); sfx('magnet', 0.8); numAt(H.x, H.y - 70, 'Mıknatıs!', N_TEXT, '#8FD0FF'); break;
      case 'bomb': {
        flash(0.6, '#FFFFFF'); shake(12); sfx('explosion', 1, 0.7);
        fx(FX_SHOCK, H.x, H.y - HERO_CY, 520, 0.6, '#FFB04A');
        var hw = R.vw * 0.55, hh = R.vh * 0.55;
        var nfx = 0;
        for (var i = 0; i < EN.n; i++) {
          var e = EN.a[i]; if (e.dead || e.inv) continue;
          if (abs(e.x - R.camX) >= hw || abs(e.y - R.camY) >= hh) continue;
          if (e.boss || e.elite || e.stone) hit(e, R.st.atk * 6, K_BOMB, 'none', 0, H.x, H.y, -1);
          else { e.hitT = 0; killEnemy(e, K_BOMB); }
          if (nfx < 14 && (i & 1)) { nfx++; fx(FX_EXPL, e.x, e.y, 34, 0.45, '#FF7A2F'); }
        }
        numAt(H.x, H.y - 80, 'BOMBA!', N_BIG, '#FFB04A'); break;
      }
      case 'chest':
        R.res.chests++; openChest(p.rar); break;
    }
  }

  /* ============================================================================================
   * Hero: movement, regen, footsteps, camera
   * ========================================================================================== */
  var JOY = { on: false, id: -1, bx: 0, by: 0, x: 0, y: 0, dx: 0, dy: 0, mag: 0 };
  var KEYS = { up: false, down: false, left: false, right: false };
  function updHero(dt) {
    var ix = 0, iy = 0;
    if (JOY.on && JOY.mag > 0.12) { ix = JOY.dx; iy = JOY.dy; }
    var kx = (KEYS.right ? 1 : 0) - (KEYS.left ? 1 : 0), ky = (KEYS.down ? 1 : 0) - (KEYS.up ? 1 : 0);
    if (kx || ky) { var kl = sqrt(kx * kx + ky * ky); ix = kx / kl; iy = ky / kl; }
    if (R.auto && !ix && !iy) { autoPilot(dt); ix = AUTO.x; iy = AUTO.y; }
    if (H.dead || R.ending) { ix = 0; iy = 0; }
    H.mvx = ix; H.mvy = iy;
    var sp = R.st.spd * H.spdMul;
    var tvx = ix * sp, tvy = iy * sp, k = 1 - exp(-16 * dt);
    H.vx += (tvx - H.vx) * k; H.vy += (tvy - H.vy) * k;
    var ox = H.x, oy = H.y;
    H.x += H.vx * dt; H.y += H.vy * dt;
    if (R.arena) {
      var A = R.arena, dx = H.x - A.x, dy = H.y - A.y, d = sqrt(dx * dx + dy * dy), lim = A.r - HERO_R - 4;
      if (d > lim) { H.x = A.x + dx / d * lim; H.y = A.y + dy / d * lim; }
    }
    var moved = sqrt((H.x - ox) * (H.x - ox) + (H.y - oy) * (H.y - oy));
    R.res.distance += moved;
    H.moving = ix * ix + iy * iy > 0.01;
    if (H.moving) { H.face = atan2(iy, ix); if (abs(ix) > 0.15 && H.atkT > H.atkDur) H.dir = ix > 0 ? 1 : -1; }
    H.atkT += dt; H.hurtT += dt; H.castT += dt;
    if (H.iT > 0) H.iT -= dt;
    // footsteps (fire trail with the Alev Çizmeler skin)
    if (H.moving) {
      H.stepT -= dt;
      if (H.stepT <= 0) {
        H.stepT = 0.2;
        var g = R.look && R.look.gear && R.look.gear.ayak;
        if (g && g.skin === 'sk_ayak_alev') { for (var q = 0; q < 3; q++) part(PT_GLOW, H.x + rr(-6, 6), H.y - 2, rr(-15, 15), -rr(30, 70), 0.5, rr(4, 7), rand() < 0.5 ? '#FF7A2F' : '#FFC07A', 0, 1); }
        else part(PT_SMOKE, H.x - H.vx * 0.03, H.y, rr(-12, 12), -rr(4, 14), 0.5, rr(5, 8), R.theme === 'kor' ? '#3A2420' : '#2E2A26', 0, 2);
      }
    }
    // regen (+ celikYurek), heal budget refresh
    if (R.st.regen > 0 && !H.dead && H.hp < R.st.maxHp) { R.regenAcc += R.st.regen * dt; if (R.regenAcc >= 1) { var v = floor(R.regenAcc); R.regenAcc -= v; heal(v, false); } }
    R.healCapT += dt; if (R.healCapT >= 1) { R.healCapT = 0; R.healCap = 0; }
    var lagK = 1 - exp(-3 * dt); H.hpLag += (H.hp - H.hpLag) * (H.hpLag > H.hp ? lagK : 1);
    if (R.nmCd > 0) R.nmCd -= dt;
    // combo decay
    if (R.comboT > 0) { R.comboT -= dt; if (R.comboT <= 0) R.combo = 0; }
    R.comboPop += dt;
  }
  /* test autopilot (debug only): kite away from crowds, collect gems/chests, break metins */
  var AUTO = { x: 0, y: 0, t: 0, a: 0 };
  function autoPilot(dt) {
    AUTO.t -= dt; if (AUTO.t > 0) return;
    AUTO.t = 0.12;
    var px = 0, py = 0, i, e, dx, dy, d2, threat = 0;
    for (i = 0; i < EN.n; i++) {
      e = EN.a[i]; if (e.dead || e.inv || e.stone) continue;
      dx = H.x - e.x; dy = H.y - e.y; d2 = dx * dx + dy * dy;
      if (d2 < 140 * 140) { var w = (e.boss ? 6 : e.elite ? 3 : 1) / mx(400, d2); px += dx * w; py += dy * w; threat += w; }
    }
    var tx = 0, ty = 0, best = 1e12;
    for (i = 0; i < EN.n; i++) { e = EN.a[i]; if (!e.stone || e.dead || e.inv) continue; dx = e.x - H.x; dy = e.y - H.y; d2 = dx * dx + dy * dy; if (d2 < best) { best = d2; tx = dx; ty = dy; } }
    for (i = 0; i < PK.n; i++) { var p = PK.a[i]; if (p.mag) continue; dx = p.x - H.x; dy = p.y - H.y; d2 = dx * dx + dy * dy * (p.kind === 'chest' ? 0.2 : 1); if (d2 < best) { best = d2; tx = dx; ty = dy; } }
    if (best === 1e12) { AUTO.a += 0.35; tx = cos(AUTO.a); ty = sin(AUTO.a); }
    var tl = sqrt(tx * tx + ty * ty) || 1, pl = sqrt(px * px + py * py) || 1;
    var mx0 = tx / tl + (threat > 0 ? px / pl * mn(3, threat * 900) : 0), my0 = ty / tl + (threat > 0 ? py / pl * mn(3, threat * 900) : 0);
    if (R.arena) { var ax = R.arena.x - H.x, ay = R.arena.y - H.y; if (ax * ax + ay * ay > (R.arena.r * 0.6) * (R.arena.r * 0.6)) { mx0 += ax * 0.01; my0 += ay * 0.01; } }
    var ml = sqrt(mx0 * mx0 + my0 * my0) || 1;
    AUTO.x = mx0 / ml; AUTO.y = my0 / ml;
    if (R.ult.charge >= 1 && (threat > 0.004 || (R.boss && !R.boss.dead && !R.boss.inv))) castUlt();
  }
  function updCamera(dt, rdt) {
    var lead = 0.28, tx = H.x + clamp(H.vx * lead, -60, 60), ty = H.y - 30 + clamp(H.vy * lead, -70, 70);
    if (R.arena && R.bossPhase >= 2) { tx = lerp(tx, R.arena.x, 0.18); ty = lerp(ty, R.arena.y - 20, 0.18); }
    var k = 1 - exp(-6 * rdt);
    R.camX += (tx - R.camX) * k; R.camY += (ty - R.camY) * k;
    if (R.shake > 0.05) { R.shx = rr(-1, 1) * R.shake; R.shy = rr(-1, 1) * R.shake; R.shake *= exp(-11 * rdt); } else { R.shx = 0; R.shy = 0; R.shake = 0; }
    if (R.flash > 0) R.flash = mx(0, R.flash - rdt * 2.8);
    if (R.hurtFlash > 0) R.hurtFlash = mx(0, R.hurtFlash - rdt * 2.2);
  }

  /* ============================================================================================
   * Ultimates — kasirga · okYagmuru · golgePatlama · firtina · ejderNefesi
   * ========================================================================================== */
  var ULT_STAMP = 1;
  function castUlt() {
    if (!R || R.ult.act || R.ult.charge < 1 || R.ending || R.overlay || R.paused || H.dead) return false;
    var U = R.ult, st = R.st;
    U.charge = 0; U.act = true; U.t = 0; U.len = mx(1, U.dur * st.dur); U.tick = 0; U.k = 0; U.stamp = ++ULT_STAMP;
    R.slow = 0.12; R.slowT = 0.7;
    H.castT = 0;
    showUltBanner();
    flash(0.4, U.col); shake(7); sfx('ult', 1); duck(0.6, 1.4);
    fx(FX_ULTRING, H.x, H.y - HERO_CY, 200, 0.7, U.col);
    switch (U.id) {
      case 'golgePatlama': U.x = H.x; U.y = H.y - HERO_CY; U.len = 0.9; break;
      case 'ejderNefesi': U.k = rand() < 0.5 ? 1 : -1; U.x = R.camX - U.k * (R.vw / 2 + 260); U.y = R.camY - R.vh * 0.2; sfx('bossRoar', 0.7, 1.4); break;
      case 'firtina': U.healLeft = st.maxHp * 0.3; break;
      case 'okYagmuru': U.tick = 0.15; break;
    }
    R.hudDirty = true;
    return true;
  }
  function onScreen(e, m) { return abs(e.x - R.camX) < R.vw * 0.5 + (m || 0) && abs(e.y - R.camY) < R.vh * 0.5 + (m || 0); }
  function updUlt(dt) {
    var U = R.ult, st = R.st, atk = st.atk, i, e, c;
    if (U.lsT > 0) { U.lsT -= dt; if (U.lsT <= 0) U.ls = 0; }
    if (!U.act) return;
    U.t += dt;
    switch (U.id) {
      case 'kasirga': {
        H.spdMul = 1.45; H.takeMul = 0.5;
        var r = 150 * st.area;
        U.tick -= dt;
        if (U.tick <= 0) {
          U.tick = 0.2;
          c = hQuery(H.x, H.y - HERO_CY, r, QA);
          for (i = 0; i < c; i++) hit(QA[i], atk * 0.95, K_ULT, 'none', 340, H.x, H.y - HERO_CY, 0);
          if (c) shake(2.5);
          var f = fx(FX_SPIN, H.x, H.y - HERO_CY, r, 0.32, (U.tick2 = (U.tick2 || 0) + 1) & 1 ? '#8FB4F0' : '#B9C8E8'); if (f) { f.ref = H; f.a = 0.75; }
          sfx('scythe', 0.4, rr(1.1, 1.3));
        }
        for (i = 0; i < 3; i++) { var a = rand() * TAU, d = rr(0.4, 1) * r; part(PT_STREAK, H.x + cos(a) * d, H.y - HERO_CY + sin(a) * d * 0.8, -sin(a) * 420, cos(a) * 420 * 0.8, 0.22, rr(2, 4), i ? '#9FB8E8' : '#DDE6F5', 0, 3); }
        if (rand() < 0.5) part(PT_SMOKE, H.x + rr(-30, 30), H.y, rr(-60, 60), -rr(10, 40), 0.6, rr(10, 16), '#3A342E', 0, 2);
        break;
      }
      case 'okYagmuru': {
        U.tick -= dt;
        while (U.tick <= 0 && U.t < U.len) {
          U.tick += 0.035;
          var tx, ty;
          var tg = rand() < 0.75 ? randomIn(R.camX, R.camY, mx(R.vw, R.vh) * 0.55, 1, QD) : 0;
          if (tg) { tx = QD[0].x + rr(-10, 10); ty = QD[0].y + rr(-10, 10); }
          else { tx = R.camX + rr(-0.5, 0.5) * R.vw; ty = R.camY + rr(-0.45, 0.45) * R.vh; }
          var p = proj(P_RAIN, tx - 110, ty - 420, 0, 0, atk * 1.15, 6, 0.34);
          if (p) { p.tx = tx; p.ty = ty; p.ox = tx - 110; p.oy = ty - 420; p.range = 30 * st.area; p.col = '#FFD27A'; }
        }
        if (rand() < 0.15) sfx('arrow', 0.3, rr(0.8, 1.3));
        break;
      }
      case 'golgePatlama': {
        var maxR = sqrt(R.vw * R.vw + R.vh * R.vh) * 0.62, rad = eOut(mn(1, U.t / 0.7)) * maxR;
        for (i = 0; i < EN.n; i++) {
          e = EN.a[i]; if (e.dead || e.inv || e.cdUlt === U.stamp) continue;
          var dx = e.x - U.x, dy = e.y - U.y;
          if (dx * dx + dy * dy < rad * rad) { e.cdUlt = U.stamp; hit(e, atk * 7, K_ULT, 'golge', 420, U.x, U.y, 0.2); if (!e.dead) burst(e.x, e.y - e.r * 0.4, 3, '#B57BFF', 120, 0.4, 3, PT_GLOW); }
        }
        if (U.k === 0) { U.k = 1; U.ls = 0.3; U.lsT = 4 * st.dur; sfx('explosion', 1, 0.45); shake(14); flash(0.5, '#6A2BB0'); }
        break;
      }
      case 'firtina': {
        if (U.healLeft > 0) { var hv = mn(U.healLeft, st.maxHp * 0.3 * dt / 1.0); U.healLeft -= hv; heal(hv, false); if (rand() < 0.4) part(PT_GLOW, H.x + rr(-14, 14), H.y - rr(0, 40), 0, -60, 0.6, 5, '#7CFF8E', 0, 1); if (U.healLeft <= 0) numAt(H.x, H.y - 70, '+' + fmt(st.maxHp * 0.3), N_HEAL, '#7CFF8E'); }
        U.tick -= dt;
        if (U.tick <= 0) {
          U.tick = 0.1;
          var n = randomIn(R.camX, R.camY, mx(R.vw, R.vh) * 0.6, 2, QD);
          for (i = 0; i < n; i++) strike(QD[i].x, QD[i].y, atk * 1.6, 40 * st.area, 0, true, K_ULT);
          if (!n) { var sx = R.camX + rr(-0.45, 0.45) * R.vw, sy = R.camY + rr(-0.4, 0.4) * R.vh; strike(sx, sy, atk, 30, 0, false, K_ULT); }
          if (rand() < 0.3) flash(0.12, '#BFE6FF');
        }
        break;
      }
      case 'ejderNefesi': {
        var spd = (R.vw + 520) / U.len;
        U.x += U.k * spd * dt; U.y = R.camY - R.vh * 0.2 + sin(U.t * 3) * 12;
        var mx0 = U.x + U.k * 150;
        U.tick -= dt;
        if (U.tick <= 0) {
          U.tick = 0.12;
          for (i = 0; i < EN.n; i++) {
            e = EN.a[i]; if (e.dead || e.inv) continue;
            if (abs(e.x - (mx0 + U.k * 30)) < 95 && e.y > U.y - 20 && onScreen(e, 40)) { hit(e, atk * 1.25, K_ULT, 'ates', 90, mx0, U.y, 0); if (!e.dead) burn(e, atk * 0.4, 3); }
          }
          shake(3);
        }
        for (i = 0; i < 5; i++) {
          var fa = HPI + U.k * rr(-0.5, 0.15), fs = rr(380, 620);
          part(PT_GLOW, mx0, U.y - 4, cos(fa) * fs * 0.5 + U.k * 60, sin(fa) * fs, rr(0.5, 0.9), rr(10, 20), rand() < 0.4 ? '#FFD27A' : rand() < 0.6 ? '#FF7A2F' : '#E8401E', 0, 0.6);
        }
        if (rand() < 0.3) fx(FX_SCORCH, mx0 + U.k * 30 + rr(-40, 40), R.camY + rr(-0.2, 0.45) * R.vh, rr(20, 36), 6, '#000');
        if (rand() < 0.2) sfx('fire', 0.5, rr(0.7, 0.9));
        break;
      }
    }
    if (U.t >= U.len) { U.act = false; H.spdMul = 1; H.takeMul = 1; R.hudDirty = true; }
  }

  /* ============================================================================================
   * Level-up: burst → 3 cards (weighted, EVRİM when eligible, 1 reroll per run)
   * ========================================================================================== */
  function levelBurst() {
    fx(FX_RING, H.x, H.y - HERO_CY, 170, 0.6, '#FFCB57'); fx(FX_PILLAR, H.x, H.y, 40, 0.8, '#FFCB57');
    burst(H.x, H.y - HERO_CY, 18, '#FFE07A', 260, 0.7, 4, PT_GLOW, 40);
    var c = hQuery(H.x, H.y - HERO_CY, 170, QA);
    for (var i = 0; i < c; i++) { var e = QA[i]; if (e.mass > 50) continue; var dx = e.x - H.x, dy = e.y - H.y, d = sqrt(dx * dx + dy * dy) || 1; e.kx += dx / d * 420 / e.mass; e.ky += dy / d * 420 / e.mass; }
    R.slow = 0.3; R.slowT = 0.35;
    sfx('levelup', 0.9);
  }
  function upgradable(forChest) {
    var out = [], L = skList(), i, d, lv;
    for (i = 0; i < L.length; i++) {
      d = L[i]; if (!d || !d.id) continue;
      if (d.type === 'evo') {
        var from = d.from, wth = d.with || (skDef(from) && skDef(from).evo && skDef(from).evo.with);
        if (!R.skills[d.id] && (R.skills[from] | 0) >= num(skDef(from) && skDef(from).max, 5) && (R.skills[wth] | 0) > 0) out.push({ id: d.id, w: 1000, d: d });
        continue;
      }
      if (d.type === 'active' || d.type === 'weapon') {
        if (R.evolved[d.id]) continue;
        lv = R.skills[d.id] | 0;
        if (lv >= num(d.max, 5)) continue;
        if (!lv && R.aSlots.length >= num(DD().RUN_LIMITS && DD().RUN_LIMITS.actives, 6)) continue;
        out.push({ id: d.id, w: lv ? (forChest ? 4 : 3.2) : (d.type === 'weapon' ? 1.4 : num(d.rar, 2) >= 4 ? 1.0 : 1.6), d: d });
      } else if (d.type === 'passive') {
        lv = R.skills[d.id] | 0;
        if (lv >= num(d.max, 5)) continue;
        if (!lv && R.pSlots.length >= num(DD().RUN_LIMITS && DD().RUN_LIMITS.passives, 6)) continue;
        // passives that complete an owned evolution pair are a bit more likely
        var pair = false; for (var k = 0; k < R.aSlots.length; k++) { var ad = skDef(R.aSlots[k]); if (ad && ad.evo && ad.evo.with === d.id) pair = true; }
        out.push({ id: d.id, w: (lv ? 2.4 : 1.5) * (pair && !lv ? 1.6 : 1), d: d });
      }
    }
    return out;
  }
  function weightedPick(list, n) {
    var res = [], pool = list.slice();
    for (var i = 0; i < pool.length; i++) if (pool[i].w >= 1000) { res.push(pool[i]); pool.splice(i, 1); i--; if (res.length >= n) return res; }
    while (res.length < n && pool.length) {
      var tot = 0, j; for (j = 0; j < pool.length; j++) tot += pool[j].w;
      var x = rand() * tot;
      for (j = 0; j < pool.length; j++) { x -= pool[j].w; if (x <= 0) break; }
      j = mn(j, pool.length - 1);
      res.push(pool[j]); pool.splice(j, 1);
    }
    return res;
  }
  function rollCards() {
    var picks = weightedPick(upgradable(false), 3);
    if (picks.length < 3) picks.push({ id: '_can', w: 1, d: null });
    if (picks.length < 3) picks.push({ id: '_altin', w: 1, d: null });
    return picks;
  }
  function cardInfo(id) {
    if (id === '_can') return { id: id, n: 'Can İksiri', desc: 'Canının %30’unu hemen yeniler.', type: 'fb', rar: 1, lv: 0, max: 0, el: 'none' };
    if (id === '_altin') return { id: id, n: 'Altın Kesesi', desc: '+40 altın.', type: 'fb', rar: 4, lv: 0, max: 0, el: 'none' };
    var d = skDef(id) || { n: id, type: 'active', max: 5, rar: 2, desc: [] }, lv = R.skills[id] | 0, desc = '';
    if (d.type === 'evo') desc = (d.desc && d.desc[0]) || 'EVRİM';
    else if (d.type === 'weapon' && d.descBy && d.descBy[R.wType]) desc = d.descBy[R.wType][lv] || '';
    else desc = (d.desc && d.desc[lv]) || ('Seviye ' + (lv + 1));
    return { id: id, n: d.n || id, desc: desc, type: d.type, rar: d.type === 'evo' ? 5 : num(d.rar, 2), lv: lv, max: num(d.max, 5), el: d.el || 'none', d: d };
  }
  function applyPick(id) {
    if (id === '_can') { heal(R.st.maxHp * 0.3, true); sfx('heal', 0.8); return; }
    if (id === '_altin') { R.res.goldPicked += 40; R.hudDirty = true; sfx('gold', 0.8); return; }
    var d = skDef(id); if (!d) return;
    if (d.type === 'evo') {
      if (R.skills[id]) return;
      R.skills[id] = 1; R.evolved[d.from] = id;
      var ix = R.aSlots.indexOf(d.from); if (ix >= 0) R.aSlots[ix] = id; else R.aSlots.push(id);
      R.sk[id] = newSk(id); R.skOrder.push(id);
      flash(0.5, '#FFCB57'); shake(8);
      fx(FX_RING, H.x, H.y - HERO_CY, 220, 0.8, '#FFCB57'); fx(FX_PILLAR, H.x, H.y, 60, 1.4, '#FFCB57');
      burst(H.x, H.y - HERO_CY, 30, '#FFE07A', 320, 0.9, 5, PT_GLOW, 50);
      banner('EVRİM: ' + d.n, 'gold');
      sfx('evolve', 1);
    } else {
      if ((R.skills[id] | 0) >= num(d.max, 5)) return;
      var lv = (R.skills[id] | 0) + 1; R.skills[id] = lv;
      if (lv === 1) {
        if (d.type === 'passive') R.pSlots.push(id); else R.aSlots.push(id);
        if (d.type === 'active') { R.sk[id] = newSk(id); R.skOrder.push(id); }
      } else if (R.sk[id]) R.sk[id].lv = lv;
      sfx('skillPick', 0.8);
    }
    recalc(); R.hudDirty = true; R.skillsDirty = true;
  }
  function newSk(id) { return { id: id, lv: 1, t: 0.4, a: rand() * TAU, n: 0, r: 0, k: 1.2, x: H.x, y: H.y, init: 0, wt: null, dx: null, ang: 0 }; }
  function maybeLevelUp(rdt) {
    if (R.pendingLv <= 0 || R.overlay || R.ending || R.paused || H.dead || R.bossDeath) { R.lvState = 0; return; }
    if (!R.lvState) { R.lvState = 1; R.lvDelay = 0.42; levelBurst(); return; }
    R.lvDelay -= rdt;
    if (R.lvDelay <= 0) { R.lvState = 0; R.pendingLv--; openLevelUp(); }
  }

  /* ============================================================================================
   * Rendering
   * ========================================================================================== */
  var cv = null, ctx = null, lcv = null, lctx = null, DPR = 1, LS = 0.5, DPR0 = 1, bakeChanged = false;
  var SORT = [], VIG = null, EMB = [];
  var HOPT = { look: null, t: 0, anim: 'idle', dir: 1, atkP: 0, glow: true, shadow: true, lite: true, moving: false, hurtP: 0 };
  var BV = { type: '', x: 0, y: 0, r: 48, dir: 1, hitT: 99, hpPct: 1, phase: 'idle', castP: 0 };
  var MV = { x: 0, y: 0, r: 34, hpPct: 1, hitT: 99, theme: 'orman' };
  var OFFX = 0, OFFY = 0, EM0 = 0, DBGF = {};
  function byZ(a, b) { return a.zy - b.zy; }
  function vigSpr() {
    if (VIG) return VIG;
    var c = mkCanvas(256, 256), x = c.getContext('2d'), gr = x.createRadialGradient(128, 128, 70, 128, 128, 180);
    gr.addColorStop(0, 'rgba(232,57,77,0)'); gr.addColorStop(0.6, 'rgba(232,57,77,0.35)'); gr.addColorStop(1, 'rgba(160,10,30,0.95)');
    x.fillStyle = gr; x.fillRect(0, 0, 256, 256);
    VIG = c; return c;
  }
  function initEmbers() {
    EMB.length = 0;
    var n = R.theme === 'kor' ? 46 : 30;
    for (var i = 0; i < n; i++) EMB.push({ x: rand() * R.vw, y: rand() * R.vh, vx: rr(-8, 8), vy: -rr(8, 30), sz: rr(1.2, 3.4), ph: rand() * TAU, col: R.thm.emb[i % R.thm.emb.length], a: rr(0.35, 0.9) });
  }
  function chunkProps(cx, cy) {
    var key = (cx + 32768) * 65536 + (cy + 32768), c = R.chunks.get(key);
    if (c) return c;
    var A = ART(); c = [];
    if (A && A.chunkProps) { try { c = A.chunkProps(R.theme, cx, cy, CHUNK) || []; } catch (e) { warnOnce('chunkProps', e); c = []; } }
    for (var i = 0; i < c.length; i++) { c[i].dk = 2; c[i].zy = c[i].y; }
    if (R.chunks.size > 64) R.chunks.clear();
    R.chunks.set(key, c);
    return c;
  }

  function render(t) {
    if (!ctx || !R) return;
    var A = ART(), F = FXA(), vw = R.vw, vh = R.vh, i, j, e, p, f;
    // lights registered by the emissive pass last frame (after the darkness was drawn) are carried over
    var carry = 0;
    for (i = EM0; i < nL; i++) { var tl = LT[carry]; LT[carry] = LT[i]; LT[i] = tl; carry++; }
    nL = carry; EM0 = 0;
    // the hero's own light first (never dropped by the light cap)
    if (nL > CAP_LIGHT - 4) nL = CAP_LIGHT - 4;
    var hf = 0.96 + 0.04 * sin(t * 9.1) * sin(t * 5.3);
    light(H.x, H.y - 26, 200 * hf, 1, null);
    light(H.x, H.y - 26, 360, 0.38, null);
    light(H.x, H.y - 22, 170, 0.6, R.thm.hero);
    var ox = vw / 2 - R.camX + R.shx, oy = vh / 2 - R.camY + R.shy;
    ox = round(ox * DPR) / DPR; oy = round(oy * DPR) / DPR;
    OFFX = ox; OFFY = oy;
    ctx.setTransform(DPR, 0, 0, DPR, ox * DPR, oy * DPR);
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
    var x0 = R.camX - vw / 2 - 40, x1 = R.camX + vw / 2 + 40, y0 = R.camY - vh / 2 - 40, y1 = R.camY + vh / 2 + 40;
    // ---- ground
    var gt = A && A.ground && !DBGF.noGround ? A.ground(R.theme) : null;
    if (gt) {
      var gx0 = floor(x0 / CHUNK), gx1 = floor(x1 / CHUNK), gy0 = floor(y0 / CHUNK), gy1 = floor(y1 / CHUNK);
      for (var gx = gx0; gx <= gx1; gx++) for (var gy = gy0; gy <= gy1; gy++) ctx.drawImage(gt, gx * CHUNK, gy * CHUNK, CHUNK + 0.5, CHUNK + 0.5);
    } else { ctx.fillStyle = '#16121C'; ctx.fillRect(x0, y0, x1 - x0, y1 - y0); }
    // ---- floor: props, decals, zones
    var ns = 0;
    var cx0 = floor((x0 - 60) / CHUNK), cx1 = floor((x1 + 60) / CHUNK), cy0 = floor((y0 - 60) / CHUNK), cy1 = floor((y1 + 160) / CHUNK);
    for (var ccx = cx0; ccx <= cx1; ccx++) for (var ccy = cy0; ccy <= cy1; ccy++) {
      var props = chunkProps(ccx, ccy);
      for (j = 0; j < props.length; j++) {
        p = props[j];
        if (p.x < x0 - 80 || p.x > x1 + 80 || p.y < y0 - 20 || p.y > y1 + 170) continue;
        if (p.light) light(p.x, p.y - (p.layer === 'floor' ? 0 : 34 * (p.s || 1)), p.light.r * 1.15, 0.75 + num(p.light.flick, 0.2) * sin(t * 11 + p.x * 0.07) * 0.6, p.light.col);
        if (p.layer === 'floor') { if (A && A.drawProp) A.drawProp(ctx, p, t); }
        else SORT[ns++] = p;
      }
    }
    for (i = 0; i < FXP.n; i++) { f = FXP.a[i]; if (f.kind === FX_SCORCH) drawScorch(f); }
    drawZonesFloor(F, t);
    // ---- y-sorted entities
    for (i = 0; i < EN.n; i++) { e = EN.a[i]; if (e.dead) continue; if (e.x < x0 - 80 || e.x > x1 + 80 || e.y < y0 - 60 || e.y > y1 + 140) { if (e.boss || e.elite || e.stone) offscreenMark(e); continue; } SORT[ns++] = e; }
    for (i = 0; i < CO.n; i++) SORT[ns++] = CO.a[i];
    H.zy = H.y; SORT[ns++] = H;
    if (R.bossDeath && R.bossDeath.t < 1.6) { R.bossDeath.zy = R.bossDeath.y + 40; R.bossDeath.dk = 5; SORT[ns++] = R.bossDeath; }
    SORT.length = ns;
    SORT.sort(byZ);
    try {
      for (i = 0; i < ns; i++) {
        var o = SORT[i];
        switch (o.dk) {
          case 1: if (o.boss) drawBossE(A, o, t); else if (o.stone) drawMetinE(A, o, t); else drawEnemyE(A, o, t); break;
          case 2: if (A && A.drawProp) A.drawProp(ctx, o, t); break;
          case 3: drawHeroE(A, t); break;
          case 4: if (A && A.drawEnemy) A.drawEnemy(ctx, o, t); break;
          case 5: drawBossCorpse(A, o, t); break;
        }
      }
    } catch (err) { warnOnce('entity draw', err); }
    SORT.length = 0;
    // ---- lights for entities
    collectLights(t);
    // ---- darkness
    if (!DBGF.noDark) drawDarkness(vw, vh, ox, oy);
    EM0 = nL;
    // ---- emissive world layer
    ctx.setTransform(DPR, 0, 0, DPR, ox * DPR, oy * DPR);
    if (R.arena) drawArena(t);
    drawZonesEmissive(F, t);
    drawChargeLines(t);
    drawTeles(F, t);
    drawPickups(A, F, t);
    drawSkills(F, t);
    drawFx(F, t);
    drawProj(F, t);
    drawBullets(t);
    drawParts();
    if (R.ult.act) drawUltWorld(F, t);
    // ---- screen space
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    drawNums();
    if (!DBGF.noEmb) drawEmbers(R.rdt || 0.016, t);
    drawHud(t);
  }

  function drawEnemyE(A, e, t) {
    if (A && A.drawEnemy) A.drawEnemy(ctx, e, t);
    else { ctx.beginPath(); ctx.arc(e.x, e.y, e.r, 0, TAU); ctx.fillStyle = (e.def && e.def.col) || '#8E3FB0'; ctx.fill(); ctx.lineWidth = 2; ctx.strokeStyle = '#120C18'; ctx.stroke(); }
    if (e.castP > 0.02) {
      var col = e.kind === 'charger' ? '#FF4A3A' : ((e.def && e.def.shot && e.def.shot.col) || '#7DF5C8');
      ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = e.castP * 0.8;
      var gr = e.kind === 'charger' ? e.r * 1.6 : e.r * 1.1;
      ctx.drawImage(glowSpr(col), e.x - gr, e.y - e.r * 0.3 - gr, gr * 2, gr * 2);
      ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
    }
  }
  function drawBossE(A, b, t) {
    BV.type = b.type; BV.x = b.x; BV.y = b.y; BV.r = b.r; BV.dir = b.dir; BV.hitT = b.hitT; BV.hpPct = b.hpPct; BV.phase = b.phase; BV.castP = b.castP;
    var ga = 1, dy = 0;
    if (b.bs === 'intro') { ga = 1 - b.lift * 0.85; dy = b.lift * 26; }
    else if (b.bs === 'jump' || b.bs === 'air') { dy = -b.lift * b.lift * 560; var F = FXA(); if (F) F.shadow(ctx, b.bx || b.x, (b.by || b.y) + b.r * 0.8, b.r * (1.1 - b.lift * 0.4), b.r * 0.3); }
    BV.y = b.y + dy;
    ctx.globalAlpha = ga;
    if (A && A.drawBoss) A.drawBoss(ctx, BV, t);
    else { ctx.beginPath(); ctx.arc(b.x, BV.y, b.r, 0, TAU); ctx.fillStyle = '#5A5A7A'; ctx.fill(); ctx.lineWidth = 3; ctx.strokeStyle = '#120C18'; ctx.stroke(); }
    ctx.globalAlpha = 1;
  }
  function drawBossCorpse(A, d, t) {
    var k = d.t / 1.6;
    BV.type = d.type; BV.x = d.x + (rand() - 0.5) * 6 * (1 - k); BV.y = d.y + k * 10; BV.r = d.r; BV.dir = d.dir; BV.hitT = (floor(d.t * 14) % 2) ? 0.02 : 0.5; BV.hpPct = 0; BV.phase = 'cast'; BV.castP = 1;
    ctx.globalAlpha = clamp(1 - k * k, 0, 1);
    if (A && A.drawBoss) A.drawBoss(ctx, BV, t);
    ctx.globalAlpha = 1;
  }
  function drawMetinE(A, m, t) {
    MV.x = m.x; MV.y = m.y + METIN_LIFT; MV.r = m.r; MV.hpPct = m.hpPct; MV.hitT = m.hitT; MV.theme = R.theme;
    if (m.inv && m.intro > 0) { var k = clamp(m.intro / 0.9, 0, 1); MV.y -= k * k * 640; }
    if (A && A.drawMetin) A.drawMetin(ctx, MV, t);
    else { ctx.fillStyle = '#2E2840'; ctx.beginPath(); ctx.moveTo(MV.x - 16, MV.y); ctx.lineTo(MV.x, MV.y - 100); ctx.lineTo(MV.x + 16, MV.y); ctx.closePath(); ctx.fill(); }
    if (!m.inv && m.castP > 0) { ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = m.castP * 0.6; ctx.drawImage(glowSpr('#C49BFF'), m.x - 60, m.y - 40, 120, 90); ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over'; }
  }
  function drawHeroE(A, t) {
    var o = HOPT, anim = 'idle';
    if (H.dead) anim = 'hurt';
    else if (R.ending && R.won) anim = 'victory';
    else if (R.ult.act && R.ult.id === 'kasirga') anim = 'attack';
    else if (H.castT < 0.55) anim = 'cast';
    else if (H.hurtT < 0.22) anim = 'hurt';
    else if (H.atkT < H.atkDur) anim = 'attack';
    else if (H.moving) anim = 'walk';
    o.look = R.look; o.t = t; o.anim = anim; o.dir = H.dir; o.atkP = clamp(H.atkT / H.atkDur, 0, 1); o.moving = H.moving; o.hurtP = clamp(H.hurtT / 0.22, 0, 1);
    if (anim === 'attack' && R.ult.act && R.ult.id === 'kasirga') { o.atkP = (t * 3.2) % 1; o.dir = (floor(t * 10) % 2) ? 1 : -1; }
    var ga = 1;
    if (H.dead) ga = clamp(1 - H.deathT * 0.45, 0.25, 1);
    else if (H.iT > 0.3) ga = 0.55 + 0.45 * abs(sin(t * 18));
    ctx.globalAlpha = ga;
    // aura under the hero (ult lifesteal window / kasirga)
    if (R.ult.lsT > 0 || (R.ult.act && R.ult.id === 'kasirga')) {
      ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = 0.45 * ga;
      var ac = R.ult.lsT > 0 ? '#9D6BFF' : '#C9D6EE';
      ctx.drawImage(glowSpr(ac), H.x - 50, H.y - 70, 100, 100);
      ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = ga;
    }
    var fall = H.dead ? eOut(mn(1, H.deathT * 2.2)) : 0;
    if (fall > 0) { ctx.save(); ctx.translate(H.x, H.y); ctx.rotate(-H.dir * fall * 1.3); ctx.translate(-H.x, -H.y); }
    if (A && A.drawHero) A.drawHero(ctx, H.x, H.y, HERO_SCALE, o);
    else {
      ctx.beginPath(); ctx.ellipse(H.x, H.y - 20, 13, 18, 0, 0, TAU); ctx.fillStyle = '#8E2F2F'; ctx.fill(); ctx.lineWidth = 2; ctx.strokeStyle = '#120C18'; ctx.stroke();
      ctx.beginPath(); ctx.arc(H.x, H.y - 44, 14, 0, TAU); ctx.fillStyle = '#F2C7A5'; ctx.fill(); ctx.stroke();
    }
    if (fall > 0) ctx.restore();
    ctx.globalAlpha = 1;
    if (H.shield > 0 && !H.dead) {
      var sp = 0.7 + 0.3 * sin(t * 4);
      ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = 0.35 * sp;
      ctx.beginPath(); ctx.ellipse(H.x, H.y - 26, 30, 36, 0, 0, TAU); ctx.strokeStyle = '#7FD8FF'; ctx.lineWidth = 2; ctx.stroke();
      ctx.globalAlpha = 0.18 * sp; ctx.drawImage(glowSpr('#7FD8FF'), H.x - 34, H.y - 62, 68, 72);
      ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
    }
  }

  function collectLights(t) {
    var i, e;
    for (i = 0; i < EN.n; i++) {
      e = EN.a[i]; if (e.dead) continue;
      if (e.stone) light(e.x, e.y, 170, 0.75 + 0.2 * sin(t * 2.6) + e.castP * 0.3, '#9D6BFF');
      else if (e.boss) light(e.x, e.y, 220, 0.75, e.enr ? '#FF3D4F' : '#FF7A5A');
      else if (e.elite) light(e.x, e.y, 110, 0.55, '#FF5A4A');
      else if (e.castP > 0.3) light(e.x, e.y, 60, e.castP * 0.5, null);
    }
    for (i = 0; i < ZN.n; i++) {
      var z = ZN.a[i], za = clamp(mn(z.t / 0.2, (z.dur - z.t) / 0.4), 0, 1);
      if (z.kind === Z_POISON) light(z.x, z.y, z.r * 1.7, 0.5 * za, '#8BE04E');
      else if (z.kind === Z_LAVA || z.kind === Z_ELAVA) light(z.x, z.y, z.r * 2, 0.7 * za, '#FF5A1F');
      else if (z.kind === Z_FIRE && (i & 1)) light(z.x, z.y, 70, 0.45 * za, '#FF7A2F');
      else if (z.kind === Z_FRING) light(z.x, z.y, z.r + 80, 0.6 * za, '#FF7A2F');
    }
    if (R.arena) { var A0 = R.arena; for (i = 0; i < 10; i++) { var a = i / 10 * TAU + t * 0.1; light(A0.x + cos(a) * A0.r, A0.y + sin(a) * A0.r, 120, 0.45, '#FF3D4F'); } }
  }

  function drawDarkness(vw, vh, ox, oy) {
    var lw = lcv.width, lh = lcv.height, s = lw / vw, i, L, x, y, r;
    var a = R.thm.a;
    if (R.ult.act && R.ult.t < 0.7) a = mn(0.94, a + 0.14);
    if (R.ult.act && R.ult.id === 'golgePatlama') a = mn(0.95, a + 0.1);
    if (R.bossPhase === 1) a = mn(0.92, a + 0.06 * (0.5 + 0.5 * sin(R.rt * 8)));
    lctx.globalCompositeOperation = 'source-over'; lctx.globalAlpha = 1;
    lctx.clearRect(0, 0, lw, lh);
    lctx.fillStyle = 'rgba(' + R.thm.dark + ',' + a + ')';
    lctx.fillRect(0, 0, lw, lh);
    // punch the lights out of the darkness (one cached radial sprite, scaled)
    lctx.globalCompositeOperation = 'destination-out';
    var spr = lightSpr();
    for (i = 0; i < nL; i++) {
      L = LT[i]; x = (L.x + ox) * s; y = (L.y + oy) * s; r = L.r * s;
      if (x + r < 0 || y + r < 0 || x - r > lw || y - r > lh || L.a <= 0) continue;
      lctx.globalAlpha = clamp(L.a, 0, 1);
      lctx.drawImage(spr, x - r, y - r, r * 2, r * 2);
    }
    // coloured light = a soft colour wash baked into the same low-res layer (no extra full-res passes)
    lctx.globalCompositeOperation = 'source-over';
    for (i = 0; i < nL; i++) {
      L = LT[i]; if (!L.col) continue;
      x = (L.x + ox) * s; y = (L.y + oy) * s; r = L.r * s * 0.8;
      if (x + r < 0 || y + r < 0 || x - r > lw || y - r > lh) continue;
      lctx.globalAlpha = clamp(L.a, 0, 1) * 0.2;
      lctx.drawImage(glowSpr(L.col), x - r, y - r, r * 2, r * 2);
    }
    lctx.globalAlpha = 1;
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    ctx.drawImage(lcv, 0, 0, vw, vh);
    // one additive warm glow around the hero (the torch the hero carries)
    ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = 0.11;
    var hx = H.x + ox, hy = H.y - 24 + oy;
    ctx.drawImage(glowSpr(R.thm.hero), hx - 150, hy - 150, 300, 300);
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
  }

  function drawScorch(f) {
    var k = f.t / f.dur, a = k > 0.6 ? (1 - k) / 0.4 : 1;
    ctx.globalAlpha = 0.45 * a;
    ctx.drawImage(smokeSpr('#0A0608'), f.x - f.r, f.y - f.r * 0.5, f.r * 2, f.r);
    ctx.globalAlpha = 1;
  }
  function drawZonesFloor(F, t) {
    for (var i = 0; i < ZN.n; i++) {
      var z = ZN.a[i], a = clamp(mn(z.t / 0.2, (z.dur - z.t) / 0.4), 0, 1);
      if (a <= 0) continue;
      ctx.globalAlpha = a;
      switch (z.kind) {
        case Z_POISON: if (F) F.pool(ctx, z.x, z.y, z.r, t + z.seed, z.amp > 0 ? '#A6F06A' : '#8BE04E'); break;
        case Z_LAVA: case Z_ELAVA: if (F) F.pool(ctx, z.x, z.y, z.r, t + z.seed, '#FF5A1F'); break;
        case Z_PUFF: {
          for (var k = 0; k < 4; k++) { var aa = z.seed + k * 1.6 + t * 0.6, rx = z.x + cos(aa) * z.r * 0.4, ry = z.y + sin(aa) * z.r * 0.25 - 6; ctx.globalAlpha = a * 0.45; ctx.drawImage(smokeSpr(k & 1 ? '#7A3AA8' : '#4A2A6A'), rx - z.r * 0.7, ry - z.r * 0.55, z.r * 1.4, z.r * 1.1); }
          break;
        }
      }
    }
    ctx.globalAlpha = 1;
  }
  function drawZonesEmissive(F, t) {
    for (var i = 0; i < ZN.n; i++) {
      var z = ZN.a[i], a = clamp(mn(z.t / 0.15, (z.dur - z.t) / 0.35), 0, 1);
      if (a <= 0) continue;
      switch (z.kind) {
        case Z_FIRE: {
          ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = a * 0.55;
          var fl = 0.85 + 0.15 * sin(t * 20 + z.seed);
          ctx.drawImage(glowSpr('#FF6A1F'), z.x - z.r * fl, z.y - z.r * 0.7 * fl, z.r * 2 * fl, z.r * 1.4 * fl);
          ctx.globalAlpha = a * 0.5; ctx.drawImage(hotSpr('#FFB04A'), z.x - z.r * 0.4, z.y - z.r * 0.6, z.r * 0.8, z.r * 0.8);
          break;
        }
        case Z_SHADOW: if (F) { ctx.globalAlpha = a * 0.6; F.spin(ctx, z.x, z.y, z.r, (z.t * 2.2) % 1, z.col); } break;
        case Z_FRING: {
          if (z.r <= 1) break;
          var g0 = z.burn + 0.5, g1 = z.burn - 0.5 + TAU;
          ctx.globalCompositeOperation = 'lighter';
          ctx.globalAlpha = a * 0.35; ctx.lineWidth = 34; ctx.strokeStyle = '#E8401E'; ctx.beginPath(); ctx.arc(z.x, z.y, z.r, g0, g1); ctx.stroke();
          ctx.globalAlpha = a * 0.85; ctx.lineWidth = 12; ctx.strokeStyle = '#FF8A3A'; ctx.beginPath(); ctx.arc(z.x, z.y, z.r, g0, g1); ctx.stroke();
          ctx.globalAlpha = a; ctx.lineWidth = 4; ctx.strokeStyle = '#FFE07A'; ctx.beginPath(); ctx.arc(z.x, z.y, z.r, g0, g1); ctx.stroke();
          for (var k2 = 0; k2 < 14; k2++) { var fa = g0 + (g1 - g0) * ((k2 + (t * 2) % 1) / 14); var fx2 = z.x + cos(fa) * z.r, fy2 = z.y + sin(fa) * z.r; ctx.globalAlpha = a * 0.8; ctx.drawImage(hotSpr('#FF7A2F'), fx2 - 10, fy2 - 16, 20, 22); }
          break;
        }
        case Z_SHOCK: {
          ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = a * 0.7 * (1 - z.t / z.dur);
          ctx.lineWidth = 10; ctx.strokeStyle = '#FF5A6A'; ctx.beginPath(); ctx.arc(z.x, z.y, mx(1, z.r), 0, TAU); ctx.stroke();
          ctx.lineWidth = 3; ctx.strokeStyle = '#FFD0D6'; ctx.stroke();
          break;
        }
      }
      ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
    }
  }

  function drawArena(t) {
    var A0 = R.arena, k = clamp(A0.t / 0.8, 0, 1), r = A0.r, pul = 0.75 + 0.25 * sin(t * 3);
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 0.16 * k; ctx.lineWidth = 46; ctx.strokeStyle = '#E8394D'; ctx.beginPath(); ctx.arc(A0.x, A0.y, r + 14, 0, TAU); ctx.stroke();
    ctx.globalAlpha = 0.85 * k * pul; ctx.lineWidth = 3.5; ctx.strokeStyle = '#FF5A6A'; ctx.stroke();
    ctx.globalAlpha = 0.5 * k; ctx.lineWidth = 1.5; ctx.strokeStyle = '#FFD0D6'; ctx.beginPath(); ctx.arc(A0.x, A0.y, r + 5, 0, TAU); ctx.stroke();
    // rotating rune ticks
    ctx.globalAlpha = 0.75 * k; ctx.strokeStyle = '#FF8A95'; ctx.lineWidth = 2; ctx.beginPath();
    var n = 48, rot = t * 0.25;
    for (var i = 0; i < n; i++) { var a = rot + i / n * TAU, l = (i % 4 === 0) ? 12 : 6; ctx.moveTo(A0.x + cos(a) * (r + 10), A0.y + sin(a) * (r + 10)); ctx.lineTo(A0.x + cos(a) * (r + 10 + l), A0.y + sin(a) * (r + 10 + l)); }
    ctx.stroke();
    ctx.globalCompositeOperation = 'source-over';
    // spires
    var vx0 = R.camX - R.vw / 2 - 30, vx1 = R.camX + R.vw / 2 + 30, vy0 = R.camY - R.vh / 2 - 60, vy1 = R.camY + R.vh / 2 + 30;
    for (var j = 0; j < 16; j++) {
      var aa = j / 16 * TAU, sx = A0.x + cos(aa) * (r + 22), sy = A0.y + sin(aa) * (r + 22);
      if (sx < vx0 || sx > vx1 || sy < vy0 || sy > vy1) continue;
      var hgt = (26 + (j % 3) * 8) * k;
      ctx.globalAlpha = k;
      ctx.beginPath(); ctx.moveTo(sx - 8, sy); ctx.lineTo(sx - 3, sy - hgt); ctx.lineTo(sx, sy - hgt - 7); ctx.lineTo(sx + 3, sy - hgt); ctx.lineTo(sx + 8, sy); ctx.closePath();
      ctx.fillStyle = '#241B31'; ctx.fill(); ctx.lineWidth = 2; ctx.strokeStyle = '#120C18'; ctx.stroke();
      ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = k * (0.6 + 0.4 * sin(t * 4 + j));
      ctx.drawImage(hotSpr('#FF3D4F'), sx - 7, sy - hgt * 0.6 - 7, 14, 14);
      ctx.globalCompositeOperation = 'source-over';
    }
    ctx.globalAlpha = 1;
  }

  function drawChargeLines(t) {
    for (var i = 0; i < EN.n; i++) {
      var e = EN.a[i]; if (e.dead || e.kind !== 'charger' || e.mode !== 1) continue;
      var ds = (e.def && e.def.dash) || NO, len = num(ds.spd, 330) * num(ds.dur, 0.45), p = clamp(e.castP, 0, 1);
      var ang = atan2(e.ay, e.ax), w = e.r * 1.3;
      ctx.save(); ctx.translate(e.x, e.y + e.r * 0.4); ctx.rotate(ang);
      ctx.fillStyle = 'rgba(232,57,77,' + (0.08 + 0.14 * p) + ')'; ctx.fillRect(0, -w / 2, len, w);
      ctx.fillStyle = 'rgba(255,70,90,' + (0.15 + 0.2 * p) + ')'; ctx.fillRect(0, -w / 2, len * p, w);
      ctx.strokeStyle = 'rgba(255,90,106,' + (0.35 + 0.45 * p) + ')'; ctx.lineWidth = 1.5; ctx.strokeRect(0, -w / 2, len, w);
      ctx.restore();
    }
  }
  function drawTeles(F, t) {
    for (var i = 0; i < TG.n; i++) {
      var g = TG.a[i], p = clamp(g.t / g.dur, 0, 1), pul = 0.65 + 0.35 * sin(t * 18);
      if (g.act === A_METEOR) {
        drawMeteorMark(g.x, g.y, g.r, p, t);
        var mxp = lerp(g.sx, g.x, eIn(p)), myp = lerp(g.sy, g.y, eIn(p)), ang = atan2(g.y - g.sy, g.x - g.sx), sz = g.b ? 15 : 11;
        ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = 0.5;
        for (var q = 1; q <= 3; q++) { var tp = mx(0, eIn(p) - q * 0.05); ctx.drawImage(glowSpr('#FF7A2F'), lerp(g.sx, g.x, tp) - sz * 1.5, lerp(g.sy, g.y, tp) - sz * 1.5, sz * 3, sz * 3); }
        ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
        if (F) F.fireball(ctx, mxp, myp, sz, ang, t);
        light(mxp, myp, 90, 0.6, '#FF7A2F');
        continue;
      }
      if (g.act === A_METIN) {
        ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = 0.25 + 0.45 * p;
        ctx.beginPath(); ctx.ellipse(g.x, g.y + METIN_LIFT, g.r * (0.5 + 0.5 * p), g.r * 0.4 * (0.5 + 0.5 * p), 0, 0, TAU); ctx.strokeStyle = '#C49BFF'; ctx.lineWidth = 2.5; ctx.stroke();
        ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 0.35 + 0.4 * p;
        ctx.drawImage(smokeSpr('#000000'), g.x - g.r * p, g.y + METIN_LIFT - g.r * 0.4 * p, g.r * 2 * p, g.r * 0.8 * p);
        ctx.globalAlpha = 1;
        continue;
      }
      ctx.globalAlpha = 1;
      if (g.kind === T_CIRCLE) {
        ctx.beginPath(); ctx.arc(g.x, g.y, g.r, 0, TAU);
        ctx.fillStyle = 'rgba(232,57,77,' + (0.1 + 0.12 * p) + ')'; ctx.fill();
        ctx.lineWidth = 2.5; ctx.strokeStyle = 'rgba(255,90,106,' + (0.55 + 0.4 * pul) + ')'; ctx.stroke();
        ctx.beginPath(); ctx.arc(g.x, g.y, mx(0.5, g.r * p), 0, TAU); ctx.fillStyle = 'rgba(255,70,90,' + (0.22 + 0.15 * p) + ')'; ctx.fill();
        if (g.act === A_BONE || g.act === A_BMETEOR) {
          var fy = g.y - (1 - eIn(p)) * 460;
          if (g.act === A_BMETEOR) { if (F) F.fireball(ctx, g.x + (1 - p) * 120, fy, 10, atan2(460, -120), t); light(g.x, fy, 70, 0.5, '#FF7A2F'); }
          else { ctx.save(); ctx.translate(g.x, fy); ctx.rotate(t * 9 + i); drawBone(14); ctx.restore(); }
        }
      } else if (g.kind === T_LINE) {
        ctx.save(); ctx.translate(g.x, g.y); ctx.rotate(g.ang);
        ctx.fillStyle = 'rgba(232,57,77,' + (0.1 + 0.15 * p) + ')'; ctx.fillRect(0, -g.w / 2, g.len, g.w);
        ctx.fillStyle = 'rgba(255,70,90,' + (0.18 + 0.15 * p) + ')'; ctx.fillRect(0, -g.w / 2, g.len * p, g.w);
        ctx.lineWidth = 2; ctx.strokeStyle = 'rgba(255,90,106,' + (0.5 + 0.4 * pul) + ')'; ctx.strokeRect(0, -g.w / 2, g.len, g.w);
        ctx.fillStyle = 'rgba(255,200,205,' + (0.35 + 0.35 * pul) + ')';
        for (var c2 = 0; c2 < 5; c2++) { var cx = ((c2 / 5 + t * 1.4) % 1) * g.len; ctx.beginPath(); ctx.moveTo(cx, -g.w * 0.28); ctx.lineTo(cx + 14, 0); ctx.lineTo(cx, g.w * 0.28); ctx.lineTo(cx + 6, 0); ctx.closePath(); ctx.fill(); }
        ctx.restore();
      } else if (g.kind === T_CONE) {
        ctx.beginPath(); ctx.moveTo(g.x, g.y); ctx.arc(g.x, g.y, g.len, g.ang - g.arc / 2, g.ang + g.arc / 2); ctx.closePath();
        ctx.fillStyle = 'rgba(232,57,77,' + (0.1 + 0.14 * p) + ')'; ctx.fill();
        ctx.lineWidth = 2; ctx.strokeStyle = 'rgba(255,90,106,' + (0.5 + 0.4 * pul) + ')'; ctx.stroke();
        ctx.beginPath(); ctx.moveTo(g.x, g.y); ctx.arc(g.x, g.y, mx(1, g.len * p), g.ang - g.arc / 2, g.ang + g.arc / 2); ctx.closePath();
        ctx.fillStyle = 'rgba(255,70,90,' + (0.2 + 0.12 * p) + ')'; ctx.fill();
      }
    }
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
  }
  function drawMeteorMark(x, y, r, p, t) {
    ctx.globalAlpha = 0.25 + 0.35 * p; ctx.drawImage(smokeSpr('#000000'), x - r * (0.3 + 0.6 * p), y - r * (0.18 + 0.36 * p), r * (0.6 + 1.2 * p), r * (0.36 + 0.72 * p));
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 0.18 + 0.3 * p; ctx.lineWidth = 2; ctx.strokeStyle = '#FFB04A';
    ctx.beginPath(); ctx.ellipse(x, y, r, r * 0.6, 0, 0, TAU); ctx.stroke();
    ctx.globalAlpha = 0.5 * p; ctx.lineWidth = 3; ctx.strokeStyle = '#FFE07A';
    ctx.beginPath(); ctx.ellipse(x, y, mx(1, r * p), mx(1, r * 0.6 * p), 0, 0, TAU); ctx.stroke();
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
  }
  function drawBone(L) {
    ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(-L / 2, 0); ctx.lineTo(L / 2, 0); ctx.lineWidth = 6; ctx.strokeStyle = '#120C18'; ctx.stroke(); ctx.lineWidth = 3.4; ctx.strokeStyle = '#F2EAD8'; ctx.stroke();
    ctx.fillStyle = '#F2EAD8'; ctx.strokeStyle = '#120C18'; ctx.lineWidth = 1.4;
    for (var s = -1; s <= 1; s += 2) { ctx.beginPath(); ctx.arc(s * L / 2, -2.4, 2.8, 0, TAU); ctx.arc(s * L / 2, 2.4, 2.8, 0, TAU); ctx.fill(); }
  }

  function drawPickups(A, F, t) {
    var vx0 = R.camX - R.vw / 2 - 30, vx1 = R.camX + R.vw / 2 + 30, vy0 = R.camY - R.vh / 2 - 30, vy1 = R.camY + R.vh / 2 + 40;
    for (var i = 0; i < PK.n; i++) {
      var p = PK.a[i];
      if (p.x < vx0 || p.x > vx1 || p.y < vy0 || p.y > vy1) { if (p.kind === 'chest') offscreenMark(p); continue; }
      if (p.mag) {
        ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = 0.6; ctx.strokeStyle = p.col; ctx.lineWidth = p.kind === 'xp3' ? 4 : 2.5; ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(p.x, p.y - 3); ctx.lineTo(p.x - p.vx * 0.045, p.y - 3 - p.vy * 0.045); ctx.stroke();
        ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
      }
      if (p.kind === 'chest') { if (F) F.beam(ctx, p.x, p.y + 4, 170, p.col, t); light(p.x, p.y - 20, 120, 0.8, p.col); }
      if (A && A.drawPickup) A.drawPickup(ctx, p.kind, p.x, p.y, t + 50000);
      else { ctx.fillStyle = p.col; ctx.beginPath(); ctx.arc(p.x, p.y, 5, 0, TAU); ctx.fill(); }
    }
  }

  function drawSkills(F, t) {
    if (!F) return;
    var cx = H.x, cy = H.y - HERO_CY, s, i, a;
    for (var k = 0; k < R.skOrder.length; k++) {
      var id = R.skOrder[k]; s = R.sk[id]; if (!s || R.evolved[id]) continue;
      switch (id) {
        case 'kilicHalka': case 'kilicFirtina': {
          var evo = id === 'kilicFirtina', bl = evo ? 19 * R.st.area : 13 * R.st.area, col = evo ? '#FFE7A0' : '#9FE6FF';
          for (i = 0; i < s.n; i++) {
            a = s.a + i * TAU / s.n;
            if (evo) {
              ctx.globalAlpha = 0.28; F.blade(ctx, cx + cos(a - 0.16) * s.r, cy + sin(a - 0.16) * s.r, bl, a - 0.16 + HPI, col);
              ctx.globalAlpha = 0.12; F.blade(ctx, cx + cos(a - 0.32) * s.r, cy + sin(a - 0.32) * s.r, bl, a - 0.32 + HPI, col);
              ctx.globalAlpha = 1;
            }
            F.blade(ctx, cx + cos(a) * s.r, cy + sin(a) * s.r, bl, a + HPI, col);
            if (i % 2 === 0) light(cx + cos(a) * s.r, cy + sin(a) * s.r, evo ? 80 : 50, 0.4, null);
          }
          if (evo) { ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = 0.12; ctx.lineWidth = 14; ctx.strokeStyle = '#FFCB57'; ctx.beginPath(); ctx.arc(cx, cy, s.r, 0, TAU); ctx.stroke(); ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over'; }
          break;
        }
        case 'ruhlar': case 'ruhOrdusu': {
          var big = id === 'ruhOrdusu', col2 = big ? '#7DF5E0' : '#3EDBC8';
          for (i = 0; i < s.n && i < 8; i++) {
            a = s.a + i * TAU / s.n;
            var d = s.dx ? s.dx[i] : 0, wx = cx + cos(a) * s.r + cos(s.ang) * d * 18, wy = cy - 10 + sin(a) * s.r * 0.7 + sin(s.ang) * d * 18 + sin(t * 3 + i) * 3;
            F.wisp(ctx, wx, wy, big ? 8.5 : 7, t + i, col2);
            light(wx, wy, big ? 70 : 55, 0.45, col2);
          }
          break;
        }
        case 'mutlakSifir': {
          var r = s.r, rot = s.a;
          ctx.globalCompositeOperation = 'lighter';
          ctx.globalAlpha = 0.14; ctx.drawImage(glowSpr('#7FD8FF'), cx - r, cy - r, r * 2, r * 2);
          ctx.lineCap = 'round';
          for (i = 0; i < 3; i++) {
            ctx.globalAlpha = 0.5 - i * 0.12; ctx.lineWidth = 5 - i; ctx.strokeStyle = i ? '#BFF0FF' : '#7FD8FF';
            ctx.beginPath(); ctx.arc(cx, cy, r * (1 - i * 0.22), rot * (1 + i * 0.5) + i, rot * (1 + i * 0.5) + i + 2.2); ctx.stroke();
            ctx.beginPath(); ctx.arc(cx, cy, r * (1 - i * 0.22), rot * (1 + i * 0.5) + i + PI, rot * (1 + i * 0.5) + i + PI + 2.2); ctx.stroke();
          }
          for (i = 0; i < 10; i++) { a = -rot * 1.3 + i / 10 * TAU; var rr2 = r * (0.55 + 0.4 * ((i * 0.37 + t * 0.2) % 1)); ctx.globalAlpha = 0.8; ctx.drawImage(hotSpr('#BFF0FF'), cx + cos(a) * rr2 - 4, cy + sin(a) * rr2 - 4, 8, 8); }
          ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
          light(cx, cy, r * 1.3, 0.45, '#7FD8FF');
          break;
        }
        case 'vebaBulutu': {
          var r3 = s.r;
          for (i = 0; i < 7; i++) {
            a = s.a * 0.6 + i / 7 * TAU; var px = s.x + cos(a) * r3 * 0.5, py = s.y + sin(a) * r3 * 0.35, pr = r3 * (0.55 + 0.1 * sin(t * 1.5 + i));
            ctx.globalAlpha = 0.32; ctx.drawImage(smokeSpr(i & 1 ? '#2F5A1E' : '#3A1E52'), px - pr, py - pr * 0.75, pr * 2, pr * 1.5);
          }
          ctx.globalCompositeOperation = 'lighter';
          for (i = 0; i < 5; i++) { a = -s.a + i * 1.3; ctx.globalAlpha = 0.25; ctx.drawImage(glowSpr('#A6F06A'), s.x + cos(a) * r3 * 0.4 - 30, s.y + sin(a) * r3 * 0.3 - 30, 60, 60); }
          ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
          light(s.x, s.y, r3 * 1.4, 0.4, '#A6F06A');
          break;
        }
      }
    }
  }

  function drawFx(F, t) {
    if (!F) return;
    for (var i = 0; i < FXP.n; i++) {
      var f = FXP.a[i], p = clamp(f.t / f.dur, 0, 1), x = f.x, y = f.y, r = f.r;
      switch (f.kind) {
        case FX_SLASH: F.slash(ctx, x, y, r, f.ang, f.arc, p, f.col); if (p < 0.5) light(x + cos(f.ang) * r * 0.6, y + sin(f.ang) * r * 0.6, r * 1.5, 0.5 * (1 - p * 2), null); break;
        case FX_CLAW:
          F.slash(ctx, x, y, r, f.ang, f.arc, p, f.col);
          F.slash(ctx, x - cos(f.ang) * 14, y - sin(f.ang) * 14, r * 0.82, f.ang, f.arc * 0.9, mn(1, p * 1.1), '#FF2A3A');
          light(x, y, r * 1.4, 0.6 * (1 - p), '#FF3D4F'); break;
        case FX_SPIN: if (f.ref === H) { x = H.x; y = H.y - HERO_CY; } ctx.globalAlpha = f.a; F.spin(ctx, x, y, r, p, f.col); ctx.globalAlpha = 1; light(x, y, r * 1.6, 0.45 * (1 - p), f.col); break;
        case FX_NOVA: F.nova(ctx, x, y, r, p, f.col); light(x, y, r * 1.3, 0.55 * (1 - p), f.col); break;
        case FX_EXPL: F.explosion(ctx, x, y, r, p, f.col); light(x, y, r * 2.6, 0.95 * (1 - p), f.col); break;
        case FX_BOLT: {
          ctx.globalAlpha = 1 - p * p;
          F.bolt(ctx, x, y, f.x2, f.y2, t + f.seed, f.col);
          if (f.a >= 2) F.bolt(ctx, x + 10, y, f.x2, f.y2, t + f.seed + 3.7, '#FFFFFF');
          ctx.globalAlpha = 1;
          light(f.x2, f.y2, f.a >= 1 ? 170 : 90, 0.9 * (1 - p), '#FFF27A');
          break;
        }
        case FX_RING: case FX_ULTRING: {
          var rr2 = r * eOut(p);
          ctx.globalCompositeOperation = 'lighter';
          ctx.globalAlpha = (1 - p) * 0.9; ctx.lineWidth = mx(1, 10 * (1 - p)); ctx.strokeStyle = f.col; ctx.beginPath(); ctx.arc(x, y, mx(1, rr2), 0, TAU); ctx.stroke();
          ctx.globalAlpha = (1 - p) * 0.5; ctx.lineWidth = mx(1, 3 * (1 - p)); ctx.strokeStyle = '#FFFFFF'; ctx.stroke();
          if (f.kind === FX_ULTRING) {
            ctx.globalAlpha = (1 - p) * 0.6; ctx.strokeStyle = f.col; ctx.lineWidth = 3; ctx.beginPath();
            for (var k = 0; k < 16; k++) { var a = k / 16 * TAU + f.seed; ctx.moveTo(x + cos(a) * rr2 * 0.4, y + sin(a) * rr2 * 0.4); ctx.lineTo(x + cos(a) * rr2 * 1.25, y + sin(a) * rr2 * 1.25); }
            ctx.stroke();
          }
          ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
          light(x, y, r * 1.2, 0.6 * (1 - p), f.col);
          break;
        }
        case FX_SHOCK: {
          ctx.globalCompositeOperation = 'lighter';
          ctx.globalAlpha = (1 - p) * 0.75; ctx.lineWidth = mx(1, 8 * (1 - p)); ctx.strokeStyle = f.col; ctx.beginPath(); ctx.ellipse(x, y, mx(1, r * eOut(p)), mx(1, r * eOut(p) * 0.6), 0, 0, TAU); ctx.stroke();
          ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
          break;
        }
        case FX_DUST: {
          for (var d = 0; d < 6; d++) { var da = d / 6 * TAU + f.seed, dr = r * (0.3 + 0.7 * eOut(p)); ctx.globalAlpha = (1 - p) * 0.45; ctx.drawImage(smokeSpr(f.col), x + cos(da) * dr - r * 0.35, y + sin(da) * dr * 0.45 - r * 0.3, r * 0.7, r * 0.5); }
          ctx.globalAlpha = 1; break;
        }
        case FX_PORTAL: {
          var pr = r * sin(p * PI);
          ctx.globalAlpha = 0.7 * (1 - p * 0.5); ctx.drawImage(smokeSpr('#120818'), x - pr * 1.4, y - pr * 0.55, pr * 2.8, pr * 1.1);
          ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = 0.8 * sin(p * PI);
          ctx.beginPath(); ctx.ellipse(x, y, mx(1, pr * 1.2), mx(1, pr * 0.45), 0, 0, TAU); ctx.lineWidth = 2; ctx.strokeStyle = f.col; ctx.stroke();
          ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
          break;
        }
        case FX_PILLAR: {
          var pa = p < 0.2 ? p / 0.2 : 1 - (p - 0.2) / 0.8;
          ctx.globalAlpha = pa; F.beam(ctx, x, y, 260 * (0.6 + 0.4 * pa), f.col, t); ctx.globalAlpha = 1;
          light(x, y - 60, 180, 0.8 * pa, f.col);
          break;
        }
        case FX_SOUL: F.soul(ctx, x, y, p, f.col); light(x, y - p * 50, 60, 0.6 * (1 - p), f.col); break;
        case FX_SPLASH: {
          ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = (1 - p) * 0.7;
          ctx.beginPath(); ctx.ellipse(x, y, mx(1, r * eOut(p)), mx(1, r * 0.55 * eOut(p)), 0, 0, TAU); ctx.lineWidth = 3 * (1 - p) + 1; ctx.strokeStyle = f.col; ctx.stroke();
          ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
          break;
        }
        case FX_BREATH: {
          var b = f.ref; if (!b || b.dead || b.uid !== f.a || b.bs !== 'breath') break;
          var ang = b.ba, len = r * mn(1, p * 6), ox2 = b.x + cos(ang) * b.r * 0.8, oy2 = b.y + sin(ang) * b.r * 0.5 - 10;
          ctx.globalCompositeOperation = 'lighter';
          for (var L2 = 0; L2 < 3; L2++) {
            var w = 0.95 * (1 - L2 * 0.3) / 2, fl = 0.9 + 0.1 * sin(t * 30 + L2);
            ctx.globalAlpha = (0.22 + L2 * 0.1) * (p > 0.9 ? (1 - p) * 10 : 1);
            ctx.beginPath(); ctx.moveTo(ox2, oy2); ctx.arc(ox2, oy2, len * fl * (1 - L2 * 0.15), ang - w, ang + w); ctx.closePath();
            ctx.fillStyle = L2 === 2 ? '#E8FFF8' : L2 ? '#7DFFE0' : '#2BE8B0'; ctx.fill();
          }
          ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
          light(ox2 + cos(ang) * len * 0.5, oy2 + sin(ang) * len * 0.5, len * 0.8, 0.8, '#7DFFE0');
          break;
        }
      }
    }
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
  }

  function drawProj(F, t) {
    if (!F) return;
    for (var i = 0; i < PR.n; i++) {
      var p = PR.a[i], a;
      switch (p.kind) {
        case P_ARROW: F.arrow(ctx, p.x, p.y, p.ang, p.col); if (i % 3 === 0) light(p.x, p.y, 40, 0.35, null); break;
        case P_RAIN: {
          a = atan2(p.ty - p.oy, p.tx - p.ox);
          ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = 0.55; ctx.lineCap = 'round'; ctx.lineWidth = 3; ctx.strokeStyle = '#FFD27A';
          ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x - cos(a) * 46, p.y - sin(a) * 46); ctx.stroke();
          ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
          ctx.save(); ctx.translate(p.x, p.y); ctx.scale(1.35, 1.35); F.arrow(ctx, 0, 0, a, p.col); ctx.restore();
          if (i % 4 === 0) light(p.x, p.y, 50, 0.4, '#FFD27A');
          break;
        }
        case P_WAVE: F.slash(ctx, p.x - cos(p.ang) * p.r, p.y - sin(p.ang) * p.r, p.r * 1.3, p.ang, 1.7, 0.42, p.col); light(p.x, p.y, 90, 0.55, p.col); break;
        case P_ORB: F.orb(ctx, p.x, p.y, 6.5, p.col, t + i); light(p.x, p.y, 75, 0.6, p.col); break;
        case P_SPARK: ctx.globalCompositeOperation = 'lighter'; ctx.drawImage(hotSpr(p.col), p.x - 8, p.y - 8, 16, 16); ctx.globalCompositeOperation = 'source-over'; break;
        case P_FIRE: F.fireball(ctx, p.x, p.y, 7.5, p.ang, t); light(p.x, p.y, 80, 0.6, '#FF7A2F'); break;
        case P_HELL: F.fireball(ctx, p.x, p.y, p.r, p.ang, t); light(p.x, p.y, 150, 0.8, '#FF5A1F'); break;
        case P_BOTTLE: drawBottle(p, t); break;
        case P_BLADE: case P_SPIRAL: {
          var col = p.kind === P_SPIRAL ? '#C9A4FF' : '#9D6BFF';
          ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = 0.45; ctx.drawImage(glowSpr(col), p.x - p.r * 1.8, p.y - p.r * 1.8, p.r * 3.6, p.r * 3.6); ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
          F.blade(ctx, p.x, p.y, p.r * 0.85, p.rot, col);
          light(p.x, p.y, 60, 0.45, col);
          break;
        }
        case P_SOUL: {
          ctx.globalCompositeOperation = 'lighter';
          ctx.globalAlpha = 0.6; ctx.lineWidth = 4; ctx.lineCap = 'round'; ctx.strokeStyle = p.col; ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x - p.vx * 0.05, p.y - p.vy * 0.05); ctx.stroke();
          ctx.globalAlpha = 1; ctx.drawImage(hotSpr(p.col), p.x - 10, p.y - 10, 20, 20);
          ctx.globalCompositeOperation = 'source-over';
          light(p.x, p.y, 50, 0.4, p.col);
          break;
        }
      }
    }
  }
  function drawBottle(p, t) {
    ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot);
    ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = 0.5; ctx.drawImage(glowSpr('#8BE04E'), -14, -14, 28, 28); ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
    ctx.lineWidth = 1.6; ctx.strokeStyle = '#120C18';
    ctx.beginPath(); ctx.arc(0, 2, 5.5, 0, TAU); ctx.fillStyle = '#6BC23A'; ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.rect(-2, -7, 4, 5); ctx.fillStyle = '#C9E6B0'; ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.arc(-1.8, 0.5, 1.6, 0, TAU); ctx.fillStyle = '#E8FFD0'; ctx.fill();
    ctx.restore();
  }
  function drawBullets(t) {
    ctx.globalCompositeOperation = 'lighter';
    for (var i = 0; i < EB.n; i++) {
      var b = EB.a[i], r = b.r;
      if (b.kind === B_BONE) continue;
      ctx.globalAlpha = 0.7; ctx.drawImage(glowSpr(b.col), b.x - r * 2.6, b.y - r * 2.6, r * 5.2, r * 5.2);
      ctx.globalAlpha = 1; ctx.drawImage(hotSpr(b.col), b.x - r * 1.2, b.y - r * 1.2, r * 2.4, r * 2.4);
    }
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
    for (var j = 0; j < EB.n; j++) {
      var bb = EB.a[j]; if (bb.kind !== B_BONE) continue;
      ctx.save(); ctx.translate(bb.x, bb.y); ctx.rotate(bb.rot); drawBone(14); ctx.restore();
    }
  }
  function drawParts() {
    var i, p, k, s;
    for (i = 0; i < PA.n; i++) {
      p = PA.a[i]; if (p.add) continue;
      k = p.life / p.max;
      if (p.type === PT_SMOKE) { s = p.sz * (1.6 - k * 0.6); ctx.globalAlpha = k * 0.55; ctx.drawImage(p.spr, p.x - s, p.y - s, s * 2, s * 2); }
      else if (p.type === PT_BONE) {
        ctx.globalAlpha = mn(1, k * 2.5); s = p.sz * 0.8;
        ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot);
        ctx.beginPath(); ctx.moveTo(-s, s * 0.5); ctx.lineTo(-s * 0.3, -s * 0.8); ctx.lineTo(s, -s * 0.2); ctx.lineTo(s * 0.4, s * 0.7); ctx.closePath();
        ctx.fillStyle = p.col; ctx.fill(); ctx.lineWidth = 1.2; ctx.strokeStyle = '#120C18'; ctx.stroke();
        ctx.beginPath(); ctx.moveTo(-s * 0.3, -s * 0.8); ctx.lineTo(s, -s * 0.2); ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.stroke();
        ctx.restore();
      }
    }
    ctx.globalCompositeOperation = 'lighter';
    for (i = 0; i < PA.n; i++) {
      p = PA.a[i]; if (!p.add) continue;
      k = p.life / p.max;
      ctx.globalAlpha = mn(1, k * 1.6);
      if (p.type === PT_GLOW) { s = p.sz * (0.5 + k * 0.7); ctx.drawImage(p.spr, p.x - s * 2, p.y - s * 2, s * 4, s * 4); }
      else if (p.type === PT_STREAK) { ctx.strokeStyle = p.col; ctx.lineWidth = p.sz * k + 0.5; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x - p.vx * 0.04, p.y - p.vy * 0.04); ctx.stroke(); }
      else if (p.type === PT_SHARD) { ctx.fillStyle = p.col; ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot); ctx.beginPath(); ctx.moveTo(0, -p.sz); ctx.lineTo(p.sz * 0.5, 0); ctx.lineTo(0, p.sz); ctx.lineTo(-p.sz * 0.5, 0); ctx.closePath(); ctx.fill(); ctx.restore(); }
      else { ctx.fillStyle = p.col; ctx.beginPath(); ctx.arc(p.x, p.y, p.sz * (0.4 + 0.6 * k), 0, TAU); ctx.fill(); }
    }
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
  }

  /* ult world visuals: storm clouds, shadow burst, dragon */
  function drawUltWorld(F, t) {
    var U = R.ult;
    if (U.id === 'golgePatlama') {
      var maxR = sqrt(R.vw * R.vw + R.vh * R.vh) * 0.62, k = mn(1, U.t / 0.7), rad = eOut(k) * maxR;
      ctx.globalAlpha = 0.35 * (1 - k); ctx.drawImage(smokeSpr('#1A0828'), U.x - rad, U.y - rad, rad * 2, rad * 2);
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 0.9 * (1 - k * 0.8); ctx.lineWidth = 24 * (1 - k) + 4; ctx.strokeStyle = '#9D6BFF'; ctx.beginPath(); ctx.arc(U.x, U.y, mx(1, rad), 0, TAU); ctx.stroke();
      ctx.lineWidth = 4; ctx.strokeStyle = '#E8D8FF'; ctx.stroke();
      for (var i = 0; i < 24; i++) { var a = i / 24 * TAU + t; ctx.globalAlpha = 0.7 * (1 - k); ctx.drawImage(hotSpr('#B57BFF'), U.x + cos(a) * rad - 9, U.y + sin(a) * rad - 9, 18, 18); }
      ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
      light(U.x, U.y, rad + 60, 0.6 * (1 - k), '#9D6BFF');
    } else if (U.id === 'ejderNefesi') {
      drawDragon(U.x, U.y, U.k, t);
      light(U.x + U.k * 150, U.y + 120, 260, 0.9, '#FF7A2F');
    } else if (U.id === 'firtina') {
      // dark storm clouds hang over the screen
      var top = R.camY - R.vh / 2;
      for (var c = 0; c < 7; c++) { var cx = R.camX - R.vw / 2 + (c + 0.5) / 7 * R.vw + sin(t * 0.7 + c) * 12, cr = 70 + (c % 3) * 16; ctx.globalAlpha = 0.75 * mn(1, U.t * 3) * mn(1, (U.len - U.t) * 2); ctx.drawImage(smokeSpr('#10141E'), cx - cr, top - cr * 0.6, cr * 2, cr * 1.5); }
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'lighter'; ctx.strokeStyle = 'rgba(160,200,255,0.25)'; ctx.lineWidth = 1.2; ctx.beginPath();
      for (var q = 0; q < 26; q++) { var rx = R.camX - R.vw / 2 + ((q * 97.3 + t * 260) % R.vw), ry = top + ((q * 53.1 + t * 900) % R.vh); ctx.moveTo(rx, ry); ctx.lineTo(rx - 5, ry + 18); }
      ctx.stroke(); ctx.globalCompositeOperation = 'source-over';
    }
  }
  /* procedural cel-shaded dragon for Ejder Nefesi (k = flight direction ±1) */
  function dpath(pts) { ctx.beginPath(); ctx.moveTo(pts[0], pts[1]); for (var i = 2; i < pts.length; i += 2) ctx.lineTo(pts[i], pts[i + 1]); ctx.closePath(); }
  function dfill(col, lw) { ctx.fillStyle = col; ctx.fill(); ctx.lineWidth = lw || 2.6; ctx.strokeStyle = '#120C18'; ctx.stroke(); }
  function dragonWing(flap, col, bone, sc) {
    var ex = -16, ey = -50 - flap * 26, wx = -54, wy = -88 - flap * 46;
    var t1x = -96, t1y = -66 - flap * 34, t2x = -84, t2y = -36 - flap * 16, t3x = -56, t3y = -16 - flap * 4;
    ctx.save(); ctx.scale(sc, sc);
    ctx.beginPath(); ctx.moveTo(6, -16); ctx.lineTo(ex, ey); ctx.lineTo(wx, wy); ctx.lineTo(t1x, t1y);
    ctx.quadraticCurveTo(-78, -54 - flap * 26, t2x, t2y); ctx.quadraticCurveTo(-66, -28 - flap * 10, t3x, t3y); ctx.quadraticCurveTo(-36, -18, -20, -8); ctx.closePath();
    dfill(col, 2.6);
    ctx.lineWidth = 3; ctx.strokeStyle = bone; ctx.beginPath(); ctx.moveTo(6, -16); ctx.lineTo(ex, ey); ctx.lineTo(wx, wy); ctx.moveTo(wx, wy); ctx.lineTo(t1x, t1y); ctx.moveTo(wx, wy); ctx.lineTo(t2x, t2y); ctx.moveTo(wx, wy); ctx.lineTo(t3x, t3y); ctx.stroke();
    ctx.fillStyle = '#F2E2C0'; ctx.beginPath(); ctx.moveTo(wx, wy); ctx.lineTo(wx - 3, wy - 9); ctx.lineTo(wx + 4, wy - 2); ctx.closePath(); ctx.fill();
    ctx.restore();
  }
  function drawDragon(x, y, k, t) {
    var flap = sin(t * 8), s = 1.5, w1 = sin(t * 4) * 8, w2 = sin(t * 4 + 1.2) * 14;
    ctx.save(); ctx.translate(x, y); ctx.scale(k * s, s);
    ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    // far wing (darker, slightly offset)
    ctx.save(); ctx.translate(10, -4); dragonWing(flap * 0.9, '#5E1414', '#3A0A0A', 0.86); ctx.restore();
    // tail with spade tip
    ctx.beginPath(); ctx.moveTo(-30, -8); ctx.quadraticCurveTo(-78, -4 + w1, -126, -14 + w2); ctx.lineTo(-122, -2 + w2); ctx.quadraticCurveTo(-78, 16 + w1, -26, 12); ctx.closePath(); dfill('#B3261A');
    dpath([-124, -8 + w2, -146, -20 + w2, -138, -6 + w2, -146, 6 + w2]); dfill('#FFB020', 2);
    for (var q = 0; q < 5; q++) { var tx = -40 - q * 17, ty = -6 + w1 * (q / 5) + (w2 - w1) * (q / 5) * 0.4 - 4; dpath([tx - 5, ty + 2, tx, ty - 8, tx + 5, ty + 2]); dfill('#FFB020', 1.6); }
    // legs (tucked)
    ctx.beginPath(); ctx.ellipse(-16, 20, 8, 11, 0.5, 0, TAU); dfill('#8E1E14');
    ctx.beginPath(); ctx.ellipse(22, 20, 8, 11, -0.3, 0, TAU); dfill('#8E1E14');
    ctx.fillStyle = '#F2E2C0'; for (var c = 0; c < 3; c++) { ctx.beginPath(); ctx.arc(-20 + c * 4, 30, 1.6, 0, TAU); ctx.arc(18 + c * 4, 30, 1.6, 0, TAU); ctx.fill(); }
    // body: base, belly plates, back highlight, dorsal spikes
    ctx.beginPath(); ctx.ellipse(0, 0, 46, 23, -0.06, 0, TAU); dfill('#C8301F');
    ctx.save(); ctx.beginPath(); ctx.ellipse(0, 0, 46, 23, -0.06, 0, TAU); ctx.clip();
    ctx.fillStyle = '#8E1E14'; ctx.beginPath(); ctx.ellipse(2, 14, 46, 14, -0.06, 0, TAU); ctx.fill();
    ctx.fillStyle = '#FFCB57'; ctx.beginPath(); ctx.ellipse(6, 17, 34, 9, -0.06, 0, TAU); ctx.fill();
    ctx.strokeStyle = 'rgba(138,90,20,0.8)'; ctx.lineWidth = 1.4; ctx.beginPath(); for (var b = -3; b <= 3; b++) { ctx.moveTo(6 + b * 9, 9); ctx.lineTo(4 + b * 9, 25); } ctx.stroke();
    ctx.fillStyle = 'rgba(255,140,100,0.55)'; ctx.beginPath(); ctx.ellipse(-4, -12, 30, 5, -0.1, 0, TAU); ctx.fill();
    ctx.restore();
    for (var d = 0; d < 5; d++) { var dx = -30 + d * 14; dpath([dx - 6, -20 + d * 0.5, dx, -33, dx + 6, -21 + d * 0.5]); dfill('#FFB020', 1.8); }
    // neck + head
    ctx.beginPath(); ctx.moveTo(26, -14); ctx.quadraticCurveTo(46, -38, 66, -30); ctx.lineTo(70, -10); ctx.quadraticCurveTo(52, -12, 36, 12); ctx.closePath(); dfill('#C8301F');
    ctx.beginPath(); ctx.moveTo(30, -2); ctx.quadraticCurveTo(48, -16, 66, -14); ctx.strokeStyle = '#FFCB57'; ctx.lineWidth = 5; ctx.stroke();
    // horns + frill
    ctx.beginPath(); ctx.moveTo(62, -40); ctx.quadraticCurveTo(48, -60, 30, -64); ctx.quadraticCurveTo(48, -52, 56, -34); ctx.closePath(); dfill('#F2E2C0', 2);
    ctx.beginPath(); ctx.moveTo(70, -42); ctx.quadraticCurveTo(62, -66, 50, -76); ctx.quadraticCurveTo(70, -62, 76, -40); ctx.closePath(); dfill('#F2E2C0', 2);
    // head (upper jaw + snout)
    ctx.beginPath(); ctx.moveTo(54, -38); ctx.quadraticCurveTo(74, -48, 100, -32); ctx.quadraticCurveTo(108, -26, 104, -18); ctx.lineTo(74, -14); ctx.quadraticCurveTo(58, -14, 54, -24); ctx.closePath(); dfill('#D9402A');
    // open lower jaw + teeth + inner mouth
    ctx.beginPath(); ctx.moveTo(70, -12); ctx.lineTo(104, -16); ctx.lineTo(98, 2); ctx.quadraticCurveTo(80, 4, 64, -4); ctx.closePath(); dfill('#5C1010', 2);
    ctx.beginPath(); ctx.moveTo(64, -4); ctx.quadraticCurveTo(82, 6, 100, 4); ctx.lineTo(96, 12); ctx.quadraticCurveTo(78, 12, 62, 4); ctx.closePath(); dfill('#B3261A', 2);
    ctx.fillStyle = '#FFF6E8';
    for (var tth = 0; tth < 4; tth++) { var tx2 = 78 + tth * 6; dpath([tx2, -15, tx2 + 2.5, -9, tx2 + 5, -15]); ctx.fill(); dpath([tx2 - 2, 4, tx2 + 0.5, -2, tx2 + 3, 4]); ctx.fill(); }
    ctx.fillStyle = '#120C18'; ctx.beginPath(); ctx.ellipse(98, -28, 2, 1.4, 0.4, 0, TAU); ctx.fill();
    // eye (glowing, slit pupil)
    ctx.beginPath(); ctx.ellipse(76, -31, 6, 4.4, 0.25, 0, TAU); dfill('#FFE07A', 2);
    ctx.fillStyle = '#120C18'; ctx.beginPath(); ctx.ellipse(77.5, -31, 1.4, 3.6, 0.25, 0, TAU); ctx.fill();
    ctx.strokeStyle = '#120C18'; ctx.lineWidth = 2.6; ctx.beginPath(); ctx.moveTo(68, -38); ctx.lineTo(84, -36); ctx.stroke();
    // near wing
    dragonWing(flap, '#D2382A', '#7A1A12', 1);
    ctx.restore();
    // eye + mouth glow (additive)
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 0.8; ctx.drawImage(glowSpr('#FFE07A'), x + k * 77 * s - 12, y - 31 * s - 12, 24, 24);
    ctx.globalAlpha = 0.95; ctx.drawImage(hotSpr('#FFB04A'), x + k * 104 * s - 34, y - 6 * s - 20, 68, 68);
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
  }

  /* ---------------------------------------------------------------- screen-space layers */
  var OFFM = [], nOff = 0;
  function offscreenMark(o) { if (nOff < 12) OFFM[nOff++] = o; }
  function drawNums() {
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.lineJoin = 'round';
    var font = '16px "Lilita One","Arial Rounded MT Bold",system-ui,sans-serif';
    ctx.font = font;
    for (var i = 0; i < NU.n; i++) {
      var n = NU.a[i], life = n.kind === N_TEXT || n.kind === N_BIG ? 1.15 : n.kind === N_CRIT ? 0.9 : 0.7, t = n.t;
      var s = t < 0.07 ? lerp(0.35, 1.45, t / 0.07) : t < 0.17 ? lerp(1.45, 1, (t - 0.07) / 0.1) : 1;
      if (n.kind === N_DOT) s = 1;
      var x = n.x + n.vx * t + OFFX, y = n.y - eOut(t / life) * (n.kind === N_BIG ? 40 : 30) + OFFY;
      var a = t > life * 0.6 ? clamp(1 - (t - life * 0.6) / (life * 0.4), 0, 1) : 1;
      if (x < -60 || x > R.vw + 60 || y < -40 || y > R.vh + 40) continue;
      var sc = s * n.sz;
      ctx.setTransform(DPR * sc, 0, 0, DPR * sc, DPR * x, DPR * y);
      ctx.globalAlpha = a;
      ctx.lineWidth = n.kind === N_DOT ? 3 : 4.2; ctx.strokeStyle = '#120C18';
      ctx.strokeText(n.txt, 0, 0);
      ctx.fillStyle = n.col; ctx.fillText(n.txt, 0, 0);
    }
    ctx.globalAlpha = 1;
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  }
  function drawEmbers(rdt, t) {
    var vw = R.vw, vh = R.vh;
    ctx.globalCompositeOperation = 'lighter';
    for (var i = 0; i < EMB.length; i++) {
      var e = EMB[i];
      e.x += (e.vx + sin(t * 0.8 + e.ph) * 10) * rdt - (H.vx * 0.15) * rdt; e.y += e.vy * rdt - (H.vy * 0.15) * rdt;
      if (e.y < -10) { e.y = vh + 10; e.x = rand() * vw; } else if (e.y > vh + 12) e.y = -8;
      if (e.x < -10) e.x = vw + 8; else if (e.x > vw + 10) e.x = -8;
      var tw = 0.6 + 0.4 * sin(t * 3 + e.ph * 3);
      ctx.globalAlpha = e.a * tw; var s = e.sz * 3;
      ctx.drawImage(glowSpr(e.col), e.x - s, e.y - s, s * 2, s * 2);
    }
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
  }
  function rrect(x, y, w, h, r) { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }
  function drawHud(t) {
    var vw = R.vw, vh = R.vh, i;
    // hurt flash + low-HP pulse vignette
    var low = H.hp < R.st.maxHp * 0.3 && !H.dead ? (1 - H.hp / (R.st.maxHp * 0.3)) : 0;
    var va = mx(R.hurtFlash * 0.75, low * (0.35 + 0.25 * sin(t * 6)));
    if (va > 0.01) { ctx.globalAlpha = clamp(va, 0, 1); ctx.drawImage(vigSpr(), 0, 0, vw, vh); ctx.globalAlpha = 1; }
    if (R.flash > 0.01) { ctx.globalAlpha = clamp(R.flash, 0, 1) * 0.55; ctx.fillStyle = R.flashCol; ctx.fillRect(0, 0, vw, vh); ctx.globalAlpha = 1; }
    // elite / metin / boss HP pips above heads
    for (i = 0; i < EN.n; i++) {
      var e = EN.a[i]; if (e.dead || e.inv || !(e.elite || e.stone) || e.hpPct >= 0.999) continue;
      var sx = e.x + OFFX, sy = e.y + OFFY - (e.stone ? 118 : e.r + 26);
      if (sx < -40 || sx > vw + 40 || sy < -20 || sy > vh + 20) continue;
      var w = e.stone ? 54 : 46;
      rrect(sx - w / 2 - 1, sy - 1, w + 2, 7, 3); ctx.fillStyle = 'rgba(10,6,14,0.85)'; ctx.fill();
      rrect(sx - w / 2, sy, mx(2, w * e.hpPct), 5, 2.5); ctx.fillStyle = e.stone ? '#B57BFF' : '#FF5A4A'; ctx.fill();
    }
    // hero HP bar
    if (!H.dead) {
      var hx = H.x + OFFX, hy = H.y + OFFY - 74, bw = 46, f = clamp(H.hp / R.st.maxHp, 0, 1), fl = clamp(H.hpLag / R.st.maxHp, 0, 1);
      rrect(hx - bw / 2 - 2, hy - 2, bw + 4, 9, 4.5); ctx.fillStyle = 'rgba(12,8,18,0.88)'; ctx.fill();
      if (fl > f) { rrect(hx - bw / 2, hy, bw * fl, 5, 2.5); ctx.fillStyle = '#FFF2E0'; ctx.fill(); }
      rrect(hx - bw / 2, hy, mx(2.5, bw * f), 5, 2.5); ctx.fillStyle = f < 0.3 ? '#E8394D' : f < 0.6 ? '#FFB020' : '#5BD16E'; ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.35)'; ctx.fillRect(hx - bw / 2 + 2, hy + 0.5, mx(0, bw * f - 4), 1.2);
      if (H.shield > 0) { var sf = clamp(H.shield / R.st.maxHp, 0, 1); rrect(hx - bw / 2, hy - 4, mx(2, bw * sf), 3, 1.5); ctx.fillStyle = '#7FD8FF'; ctx.fill(); }
    }
    // speech bubble at the start
    if (R.speechT > 0 && R.speech) {
      var a = clamp(R.speechT / 0.3, 0, 1) * clamp((2.6 - R.speechT) / 0.2 + 0.0001, 0, 1);
      ctx.globalAlpha = a;
      ctx.font = '13px "Nunito",system-ui,sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      var tw = ctx.measureText(R.speech).width + 20, bx = H.x + OFFX, by = H.y + OFFY - 104;
      rrect(bx - tw / 2, by - 13, tw, 26, 10); ctx.fillStyle = 'rgba(244,238,255,0.95)'; ctx.fill();
      ctx.beginPath(); ctx.moveTo(bx - 6, by + 12); ctx.lineTo(bx, by + 19); ctx.lineTo(bx + 6, by + 12); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#1A1424'; ctx.font = '800 13px "Nunito",system-ui,sans-serif'; ctx.fillText(R.speech, bx, by + 0.5);
      ctx.globalAlpha = 1;
    }
    // offscreen indicators
    for (i = 0; i < nOff; i++) {
      var o = OFFM[i], dx = o.x + OFFX - vw / 2, dy = o.y + OFFY - vh / 2, ang = atan2(dy, dx);
      var m = 30, tx = vw / 2 - m, ty = vh / 2 - m - 40, kx = abs(cos(ang)) > 1e-4 ? tx / abs(cos(ang)) : 1e9, ky = abs(sin(ang)) > 1e-4 ? ty / abs(sin(ang)) : 1e9, k2 = mn(kx, ky);
      var px = vw / 2 + cos(ang) * k2, py = vh / 2 + 20 + sin(ang) * k2;
      var col = o.kind === 'chest' ? '#FFCB57' : o.stone ? '#B57BFF' : o.boss ? '#FF3D4F' : '#FF7A5A', pul = 1 + 0.12 * sin(t * 6);
      ctx.save(); ctx.translate(px, py); ctx.rotate(ang); ctx.scale(pul, pul);
      ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = 0.5; ctx.drawImage(glowSpr(col), -22, -22, 44, 44); ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
      ctx.beginPath(); ctx.moveTo(14, 0); ctx.lineTo(-6, -10); ctx.lineTo(-2, 0); ctx.lineTo(-6, 10); ctx.closePath();
      ctx.fillStyle = col; ctx.fill(); ctx.lineWidth = 2; ctx.strokeStyle = '#120C18'; ctx.stroke();
      ctx.restore();
    }
    nOff = 0;
    // kill combo
    if (R.combo >= 8) {
      var pop = R.comboPop < 0.12 ? 1 + (1 - R.comboPop / 0.12) * 0.35 : 1, cc = R.combo >= 100 ? '#FF5A4A' : R.combo >= 40 ? '#FFB020' : '#FFE7A0';
      var cxp = vw - 14, cyp = 236;
      ctx.save(); ctx.translate(cxp, cyp); ctx.scale(pop, pop);
      ctx.textAlign = 'right'; ctx.textBaseline = 'alphabetic'; ctx.lineJoin = 'round';
      ctx.font = '24px "Lilita One",system-ui,sans-serif'; ctx.lineWidth = 5; ctx.strokeStyle = '#120C18';
      if (R.comboTxtN !== R.combo) { R.comboTxtN = R.combo; R.comboTxt = '×' + fmt(R.combo); }
      var ct = R.comboTxt;
      ctx.globalAlpha = clamp(R.comboT / 0.6, 0, 1) * 0.9;
      ctx.strokeText(ct, 0, 0); ctx.fillStyle = cc; ctx.fillText(ct, 0, 0);
      ctx.font = '11px "Lilita One",system-ui,sans-serif'; ctx.lineWidth = 3.5; ctx.strokeText('SERİ', 0, 13); ctx.fillStyle = '#F4EEFF'; ctx.fillText('SERİ', 0, 13);
      ctx.fillStyle = 'rgba(255,255,255,0.22)'; ctx.fillRect(-50, 18, 50, 2.5); ctx.fillStyle = cc; ctx.fillRect(-50 * clamp(R.comboT / 2.6, 0, 1), 18, 50 * clamp(R.comboT / 2.6, 0, 1), 2.5);
      ctx.restore(); ctx.globalAlpha = 1;
    }
    // floating joystick
    if (JOY.on) {
      var jx = JOY.bx, jy = JOY.by, kx2 = JOY.bx + JOY.dx * JOY.mag * 46, ky2 = JOY.by + JOY.dy * JOY.mag * 46;
      ctx.beginPath(); ctx.arc(jx, jy, 52, 0, TAU); ctx.fillStyle = 'rgba(10,6,16,0.32)'; ctx.fill();
      ctx.lineWidth = 2.5; ctx.strokeStyle = 'rgba(244,238,255,0.35)'; ctx.stroke();
      ctx.beginPath(); ctx.arc(jx, jy, 40, 0, TAU); ctx.lineWidth = 1; ctx.strokeStyle = 'rgba(244,238,255,0.14)'; ctx.stroke();
      if (JOY.mag > 0.15) {
        var ja = atan2(JOY.dy, JOY.dx);
        ctx.save(); ctx.translate(jx, jy); ctx.rotate(ja); ctx.fillStyle = 'rgba(255,203,87,' + (0.35 + 0.5 * JOY.mag) + ')';
        ctx.beginPath(); ctx.moveTo(60, 0); ctx.lineTo(52, -7); ctx.lineTo(52, 7); ctx.closePath(); ctx.fill(); ctx.restore();
      }
      ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = 0.35; ctx.drawImage(glowSpr('#FFCB57'), kx2 - 34, ky2 - 34, 68, 68); ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
      ctx.beginPath(); ctx.arc(kx2, ky2, 23, 0, TAU);
      ctx.fillStyle = 'rgba(244,238,255,0.92)'; ctx.fill(); ctx.lineWidth = 3; ctx.strokeStyle = '#120C18'; ctx.stroke();
      ctx.beginPath(); ctx.arc(kx2, ky2, 15, 0, TAU); ctx.fillStyle = '#FFCB57'; ctx.fill();
      ctx.beginPath(); ctx.arc(kx2 - 5, ky2 - 6, 5, 0, TAU); ctx.fillStyle = 'rgba(255,255,255,0.7)'; ctx.fill();
    }
  }

  /* ============================================================================================
   * DOM: HUD + overlays (everything lives inside #gm-battle and is removed after the run)
   * ========================================================================================== */
  var root = null, U = null, listeners = [], ro = null;
  var HAND_SVG = '<svg viewBox="0 0 64 80" aria-hidden="true"><path d="M24 6c3.6 0 6 2.6 6 6.2V36l2.2-1.6c0-3.6 2.4-6 5.6-6s5.6 2.4 5.6 6v2.4c.8-2.4 2.8-4 5.4-4 3.2 0 5.4 2.4 5.4 5.8v3c.8-1.6 2.4-2.6 4.4-2.6 3 0 4.8 2.2 4.8 5.4v13.4C63.4 70.6 54 78 43 78H35c-8 0-13.6-3.4-17.6-9.6L6.6 51.6c-1.8-2.8-1.2-6.2 1.4-8 2.6-1.8 6-1.2 8 1.2l2 2.6V12.2C18 8.6 20.4 6 24 6z" fill="#F4EEFF" stroke="#120C18" stroke-width="3" stroke-linejoin="round"/><path d="M30 36v12M43.4 38v10M54.4 44v6" stroke="#8C7FA6" stroke-width="2.4" stroke-linecap="round"/></svg>';
  var TPL =
    '<canvas class="bt-cv"></canvas>' +
    '<div class="bt-hud">' +
      '<div class="bt-top">' +
        '<div class="bt-lv"><small>SV</small><b class="num">1</b></div>' +
        '<div class="bt-xp"><i></i><span></span></div>' +
        '<button class="bt-pbtn" type="button" aria-label="Duraklat"><i></i><i></i></button>' +
      '</div>' +
      '<div class="bt-row">' +
        '<div class="bt-stat bt-kills"><canvas width="44" height="44"></canvas><b class="num">0</b></div>' +
        '<div class="bt-time num">00:00</div>' +
        '<div class="bt-stat bt-gold"><b class="num">0</b><canvas width="44" height="44"></canvas></div>' +
      '</div>' +
      '<div class="bt-boss" hidden><div class="bt-boss-n"><b></b><em></em></div><div class="bt-boss-bar"><i class="lag"></i><i class="hp"></i><s></s></div></div>' +
      '<div class="bt-skills"><div class="bt-sk-row bt-sk-a"></div><div class="bt-sk-row bt-sk-p"></div></div>' +
      '<div class="bt-banner" hidden><span></span></div>' +
    '</div>' +
    '<button class="bt-ult" type="button" aria-label="Nihai güç"><canvas></canvas><span class="bt-ult-l">NİHAİ</span></button>' +
    '<div class="bt-warn" hidden><div class="bt-warn-band"><i></i><b>UYARI</b><i></i></div><div class="bt-warn-n"></div><div class="bt-warn-band b2"><i></i><b>UYARI</b><i></i></div></div>' +
    '<div class="bt-bintro" hidden><small></small><b class="ttl"></b><span></span></div>' +
    '<div class="bt-ultb" hidden><div class="bt-ultb-in"><canvas></canvas><div class="bt-ultb-tx"><b class="ttl"></b><span></span></div></div></div>' +
    '<div class="bt-chap" hidden><small></small><b class="ttl"></b><span></span></div>' +
    '<div class="bt-tut" hidden><div class="bt-tut-ring"></div><div class="bt-tut-orbit"><div class="bt-tut-knob"></div><div class="bt-tut-hand">' + HAND_SVG + '</div></div><div class="bt-tut-tx">Sürükle ve hareket et</div><div class="bt-tut-sub">Saldırı otomatik · Sağ alttaki nihai güce dokun</div></div>' +
    '<div class="bt-ov bt-lvl" hidden><div class="bt-lvl-in">' +
      '<div class="bt-lvl-h"><div class="bt-lvl-rays"></div><b class="ttl">Seviye Atladın!</b><span class="bt-lvl-n"></span></div>' +
      '<div class="bt-cards"></div>' +
      '<div class="bt-lvl-f"><div class="bt-lvl-own"></div><button class="btn btn-dark btn-sm bt-reroll" type="button">Yenile <em class="num">1</em></button></div>' +
    '</div></div>' +
    '<div class="bt-ov bt-chest" hidden><div class="bt-ch-in">' +
      '<b class="ttl bt-ch-t">Hazine Sandığı</b>' +
      '<canvas class="bt-ch-cv"></canvas>' +
      '<div class="bt-reel"><div class="bt-reel-s"></div><i class="bt-reel-m"></i></div>' +
      '<div class="bt-ch-res"><b></b><span></span></div>' +
      '<button class="btn btn-gold bt-ch-ok" type="button" disabled>Al!</button>' +
    '</div></div>' +
    '<div class="bt-ov bt-pause" hidden><div class="bt-pz panel">' +
      '<b class="ttl">Duraklatıldı</b>' +
      '<div class="bt-pz-st"></div>' +
      '<div class="bt-pz-sk"></div>' +
      '<button class="btn btn-gold btn-lg bt-pz-go" type="button">Devam</button>' +
      '<div class="bt-pz-row"><button class="btn btn-dark bt-pz-snd" type="button"></button><button class="btn btn-dark bt-pz-mus" type="button"></button></div>' +
      '<button class="btn btn-red bt-pz-quit" type="button">Pes Et</button>' +
    '</div></div>' +
    '<div class="bt-ov bt-rev" hidden><div class="bt-rev-in"><canvas></canvas><b class="ttl">Diriliş</b><span></span></div></div>' +
    '<div class="bt-end" hidden><div class="bt-end-rays"></div><div class="bt-end-in"><small></small><b class="bt-end-t"></b><div class="bt-end-s"></div><div class="bt-end-st"></div><div class="bt-end-tap">Devam etmek için dokun</div></div></div>';

  function q(s) { return root.querySelector(s); }
  function on(target, type, fn, opts) { target.addEventListener(type, fn, opts); listeners.push([target, type, fn, opts]); }
  function offAll() { for (var i = 0; i < listeners.length; i++) { var L = listeners[i]; try { L[0].removeEventListener(L[1], L[2], L[3]); } catch (e) { /* ignore */ } } listeners.length = 0; }
  function show(el, cls) { if (!el) return; el.hidden = false; if (cls) { el.classList.remove(cls); void el.offsetWidth; el.classList.add(cls); } }
  function hide(el) { if (el) el.hidden = true; }
  function dprCanvas(c, w, h) { var d = mn(window.devicePixelRatio || 1, 2); c.width = round(w * d); c.height = round(h * d); c.style.width = w + 'px'; c.style.height = h + 'px'; var g = c.getContext('2d'); g.setTransform(d, 0, 0, d, 0, 0); return g; }

  function buildDom() {
    root.innerHTML = TPL;
    root.classList.add('bt-root');
    U = {
      cv: q('.bt-cv'), hud: q('.bt-hud'), lv: q('.bt-lv b'), xp: q('.bt-xp i'), time: q('.bt-time'), kills: q('.bt-kills b'), gold: q('.bt-gold b'),
      killsCv: q('.bt-kills canvas'), goldCv: q('.bt-gold canvas'), pbtn: q('.bt-pbtn'),
      boss: q('.bt-boss'), bossN: q('.bt-boss-n b'), bossT: q('.bt-boss-n em'), bossHp: q('.bt-boss-bar .hp'), bossLag: q('.bt-boss-bar .lag'),
      skA: q('.bt-sk-a'), skP: q('.bt-sk-p'), banner: q('.bt-banner'), bannerT: q('.bt-banner span'),
      ult: q('.bt-ult'), ultCv: q('.bt-ult canvas'), ultL: q('.bt-ult-l'),
      warn: q('.bt-warn'), warnN: q('.bt-warn-n'), bintro: q('.bt-bintro'),
      ultb: q('.bt-ultb'), ultbCv: q('.bt-ultb canvas'), chap: q('.bt-chap'), tut: q('.bt-tut'),
      lvl: q('.bt-lvl'), lvlN: q('.bt-lvl-n'), cards: q('.bt-cards'), own: q('.bt-lvl-own'), reroll: q('.bt-reroll'),
      chest: q('.bt-chest'), chCv: q('.bt-ch-cv'), reel: q('.bt-reel-s'), chRes: q('.bt-ch-res'), chOk: q('.bt-ch-ok'),
      pause: q('.bt-pause'), pzSt: q('.bt-pz-st'), pzSk: q('.bt-pz-sk'), pzGo: q('.bt-pz-go'), pzSnd: q('.bt-pz-snd'), pzMus: q('.bt-pz-mus'), pzQuit: q('.bt-pz-quit'),
      rev: q('.bt-rev'), revCv: q('.bt-rev canvas'), revT: q('.bt-rev span'),
      end: q('.bt-end'), endT: q('.bt-end-t'), endS: q('.bt-end-s'), endSt: q('.bt-end-st'), endSm: q('.bt-end small'),
      skCells: [], ultLast: -1, ultRdy: null, xpLast: -1, lvLast: -1, bossHpLast: -1, bossLagV: 1, cardsCur: [], bannerT0: 0, bannerQ: [],
      chestS: null, revT0: 0, closeT: 0, closeFn: null
    };
    cv = U.cv; ctx = cv.getContext('2d');
    lcv = mkCanvas(8, 8); lctx = lcv.getContext('2d');
    // skill slots
    for (var i = 0; i < 12; i++) {
      var d = document.createElement('div'); d.className = 'bt-sk' + (i >= 6 ? ' ps' : '');
      d.innerHTML = '<canvas></canvas><i class="bt-pips"></i>';
      (i < 6 ? U.skA : U.skP).appendChild(d);
      U.skCells.push({ el: d, cv: d.querySelector('canvas'), pips: d.querySelector('.bt-pips'), id: null, lv: 0 });
    }
    U.skCells.forEach(function (c, k) { dprCanvas(c.cv, k < 6 ? 26 : 20, k < 6 ? 26 : 20); });
    drawStatIcons();
    dprCanvas(U.ultCv, 68, 68);
    on(U.pbtn, 'click', function () { sfx('click'); B.pause(); });
    on(U.ult, 'pointerdown', function (e) { e.stopPropagation(); if (!castUlt()) { if (R && R.ult.charge < 1) { sfx('error', 0.5); U.ult.classList.remove('bt-nope'); void U.ult.offsetWidth; U.ult.classList.add('bt-nope'); } } });
    on(U.reroll, 'click', function () { reroll(); });
    on(U.chOk, 'click', function () { chestTake(); });
    on(U.pzGo, 'click', function () { sfx('click'); B.resume(); });
    on(U.pzSnd, 'click', function () { toggleSetting('sound'); });
    on(U.pzMus, 'click', function () { toggleSetting('music'); });
    on(U.pzQuit, 'click', function () { quitAsk(); });
    on(U.end, 'click', function () { if (R && R.endT > 1.4 && !R.finished) { R.finished = true; finish(); } });
    on(U.rev, 'click', function () { if (R && R.overlay === 'revive' && R.anim - U.revT0 > 0.5) doRevive(); });
  }
  function drawStatIcons() {
    var g = dprCanvas(U.killsCv, 22, 22);
    g.lineJoin = 'round'; g.lineWidth = 2; g.strokeStyle = '#120C18';
    g.beginPath(); g.arc(11, 9.5, 7.5, PI * 0.85, PI * 2.15); g.lineTo(16, 17); g.lineTo(6, 17); g.closePath(); g.fillStyle = '#EDE4CE'; g.fill(); g.stroke();
    g.fillStyle = '#120C18'; g.beginPath(); g.ellipse(8, 10.5, 2.2, 2.6, 0, 0, TAU); g.ellipse(14, 10.5, 2.2, 2.6, 0, 0, TAU); g.fill();
    g.fillStyle = '#E8394D'; g.beginPath(); g.arc(8, 10.6, 0.9, 0, TAU); g.arc(14, 10.6, 0.9, 0, TAU); g.fill();
    g.strokeStyle = '#120C18'; g.lineWidth = 1.2; g.beginPath(); g.moveTo(9, 14.5); g.lineTo(9, 17); g.moveTo(11, 14.5); g.lineTo(11, 17); g.moveTo(13, 14.5); g.lineTo(13, 17); g.stroke();
    var g2 = dprCanvas(U.goldCv, 22, 22), A = ART();
    if (A && A.drawPickup) { g2.save(); g2.translate(11, 11); g2.scale(1.15, 1.15); g2.translate(-11, -11); try { A.drawPickup(g2, 'gold', 11, 14, 0); } catch (e) { /* ignore */ } g2.restore(); }
    else { g2.beginPath(); g2.arc(11, 11, 8, 0, TAU); g2.fillStyle = '#FFCB57'; g2.fill(); g2.lineWidth = 2; g2.strokeStyle = '#120C18'; g2.stroke(); }
  }

  /* ---------------------------------------------------------------- banners */
  function banner(text, kind) {
    if (!U) return;
    U.bannerQ.push([text, kind || 'violet']);
    if (U.banner.hidden) nextBanner();
  }
  function nextBanner() {
    var b = U.bannerQ.shift(); if (!b) { hide(U.banner); return; }
    U.bannerT.textContent = b[0];
    U.banner.className = 'bt-banner k-' + b[1];
    show(U.banner, 'go'); U.bannerT0 = R ? R.anim : 0;
  }
  function showWarn(name) {
    U.warnN.textContent = String(name).toLocaleUpperCase('tr-TR') + ' YAKLAŞIYOR';
    show(U.warn, 'go');
  }
  function showBossIntro(b) {
    var df = b.def || {};
    hide(U.warn);
    U.bintro.querySelector('small').textContent = 'BOSS';
    U.bintro.querySelector('b').textContent = df.n || 'Boss';
    U.bintro.querySelector('span').textContent = df.title || '';
    show(U.bintro, 'go'); R.bintroT = 2.8;
    U.bossN.textContent = df.n || 'Boss'; U.bossT.textContent = df.title || '';
    show(U.boss, 'go'); U.bossHpLast = -1; U.bossLagV = 1;
  }
  function hideBossBar() { if (U) { U.boss.classList.add('out'); } }
  function showUltBanner() {
    var hd = R.hd || {}, g = dprCanvas(U.ultbCv, 64, 64), A = ART();
    if (A && A.drawHeroPortrait) { try { A.drawHeroPortrait(g, 0, 0, 64, R.sheet.heroId, R.rt, R.look && R.look.heroSkin); } catch (e) { warnOnce('portrait', e); } }
    U.ultb.querySelector('b').textContent = R.ult.n;
    var line = (hd.lines && hd.lines.ult) || '', same = line.replace(/[!.\s]/g, '').toLocaleUpperCase('tr-TR') === String(R.ult.n).replace(/\s/g, '').toLocaleUpperCase('tr-TR');
    U.ultb.querySelector('span').textContent = (hd.n || '') + ' · ' + (line && !same ? line : 'Nihai Güç');
    U.ultb.style.setProperty('--uc', R.ult.col);
    show(U.ultb, 'go'); R.ultbT = 1.5;
  }
  function showChapter() {
    U.chap.querySelector('small').textContent = 'BÖLÜM ' + R.ch.id;
    U.chap.querySelector('b').textContent = R.ch.n || '';
    U.chap.querySelector('span').textContent = R.ch.sub || '';
    show(U.chap, 'go'); R.chapT = 2.6;
  }

  /* ---------------------------------------------------------------- HUD tick */
  function hudTick(rdt) {
    if (!U || !R) return;
    if (R.lvl !== U.lvLast) { U.lvLast = R.lvl; U.lv.textContent = R.lvl; U.lv.parentNode.classList.remove('pop'); void U.lv.offsetWidth; U.lv.parentNode.classList.add('pop'); }
    var xp = clamp(R.xp / R.need, 0, 1);
    if (abs(xp - U.xpLast) > 0.002) { U.xpLast = xp; U.xp.style.transform = 'scaleX(' + xp.toFixed(4) + ')'; }
    var ts = floor(R.time);
    if (ts !== R.timeShown) { R.timeShown = ts; U.time.textContent = fmtTime(ts); }
    if (R.res.kills !== R.killsShown) { R.killsShown = R.res.kills; U.kills.textContent = fmt(R.res.kills); }
    var gold = round(R.res.goldPicked * R.st.goldGain);
    if (gold !== R.goldShown) { if (R.goldShown >= 0) { U.gold.parentNode.classList.remove('pop'); void U.gold.offsetWidth; U.gold.parentNode.classList.add('pop'); } R.goldShown = gold; U.gold.textContent = fmt(gold); }
    // boss bar
    var b = R.boss;
    if (b && !b.dead && R.bossPhase === 2) {
      var hp = b.hpPct;
      if (abs(hp - U.bossHpLast) > 0.0005) { U.bossHpLast = hp; U.bossHp.style.transform = 'scaleX(' + hp.toFixed(4) + ')'; }
      if (U.bossLagV > hp) { U.bossLagV = mx(hp, U.bossLagV - rdt * 0.35); U.bossLag.style.transform = 'scaleX(' + U.bossLagV.toFixed(4) + ')'; }
      U.boss.classList.toggle('enr', !!b.enr);
    }
    // ult button
    var ch = R.ult.charge, rdy = ch >= 1 && !R.ult.act;
    if (abs(ch - U.ultLast) > 0.006 || rdy !== U.ultRdy || R.ult.act) { U.ultLast = ch; drawUltBtn(rdy); }
    if (rdy !== U.ultRdy) { U.ultRdy = rdy; U.ult.classList.toggle('rdy', rdy); U.ultL.textContent = rdy ? 'HAZIR' : 'NİHAİ'; }
    U.ult.classList.toggle('act', R.ult.act);
    if (R.skillsDirty) { R.skillsDirty = false; drawSkillSlots(); }
    // banners
    if (!U.banner.hidden && R.anim - U.bannerT0 > 2.3) { hide(U.banner); if (U.bannerQ.length) nextBanner(); }
    if (R.bintroT > 0) { R.bintroT -= rdt; if (R.bintroT <= 0) hide(U.bintro); }
    if (R.ultbT > 0) { R.ultbT -= rdt; if (R.ultbT <= 0) hide(U.ultb); }
    if (R.chapT > 0) { R.chapT -= rdt; if (R.chapT <= 0) hide(U.chap); }
    if (R.bossPhase !== 1 && !U.warn.hidden) hide(U.warn);
  }
  var ULT_PORT = null, ULT_PORT_ID = '';
  function drawUltBtn(rdy) {
    var g = U.ultCv.getContext('2d'), d = mn(window.devicePixelRatio || 1, 2), s = 68, c = s / 2, A = ART();
    g.setTransform(d, 0, 0, d, 0, 0); g.clearRect(0, 0, s, s);
    var pid = R.sheet.heroId + '|' + ((R.look && R.look.heroSkin) || '') + '|' + d;
    if (!ULT_PORT || ULT_PORT_ID !== pid) {
      ULT_PORT = mkCanvas(round(56 * d), round(56 * d)); ULT_PORT_ID = pid;
      var pg = ULT_PORT.getContext('2d'); pg.setTransform(d, 0, 0, d, 0, 0);
      if (A && A.drawHeroPortrait) { try { A.drawHeroPortrait(pg, 0, 0, 56, R.sheet.heroId, 0, R.look && R.look.heroSkin); } catch (e) { warnOnce('portrait', e); } }
    }
    g.save(); g.beginPath(); g.arc(c, c, 27, 0, TAU); g.clip();
    g.fillStyle = '#1A1424'; g.fillRect(0, 0, s, s);
    g.globalAlpha = rdy ? 1 : 0.55; g.drawImage(ULT_PORT, c - 28, c - 28, 56, 56); g.globalAlpha = 1;
    if (!rdy) { g.fillStyle = 'rgba(9,7,13,0.55)'; g.beginPath(); g.moveTo(c, c); g.arc(c, c, 30, -HPI + TAU * R.ult.charge, -HPI + TAU); g.closePath(); g.fill(); }
    g.restore();
    g.lineWidth = 5; g.strokeStyle = 'rgba(0,0,0,0.6)'; g.beginPath(); g.arc(c, c, 30, 0, TAU); g.stroke();
    g.lineWidth = 4; g.lineCap = 'round'; g.strokeStyle = rdy ? '#FFE07A' : R.ult.col;
    g.beginPath(); g.arc(c, c, 30, -HPI, -HPI + TAU * mx(0.001, R.ult.charge)); g.stroke();
    if (R.ult.act) { g.strokeStyle = '#FFFFFF'; g.lineWidth = 2; g.beginPath(); g.arc(c, c, 30, -HPI, -HPI + TAU * (1 - R.ult.t / mx(0.01, R.ult.len))); g.stroke(); }
  }
  function drawSkillSlots() {
    var A = ART(), list = R.aSlots.concat([]), plist = R.pSlots;
    for (var i = 0; i < 12; i++) {
      var c = U.skCells[i], id = i < 6 ? list[i] : plist[i - 6], lv = id ? (R.skills[id] | 0) : 0, size = i < 6 ? 26 : 20;
      if (c.id === id && c.lv === lv) continue;
      c.id = id; c.lv = lv;
      var g = c.cv.getContext('2d'), d = mn(window.devicePixelRatio || 1, 2);
      g.setTransform(d, 0, 0, d, 0, 0); g.clearRect(0, 0, size, size);
      c.el.classList.toggle('on', !!id);
      var def = id ? skDef(id) : null;
      c.el.classList.toggle('evo', !!(def && def.type === 'evo'));
      if (id && A && A.drawSkillIcon) { try { A.drawSkillIcon(g, 0, 0, size, id, null); } catch (e) { warnOnce('drawSkillIcon', e); } }
      var mxl = def ? (def.type === 'evo' ? 0 : num(def.max, 5)) : 0, h = '';
      for (var k = 0; k < mxl; k++) h += '<b' + (k < lv ? ' class="on"' : '') + '></b>';
      c.pips.innerHTML = h;
      if (id) { c.el.classList.remove('pop'); void c.el.offsetWidth; c.el.classList.add('pop'); }
    }
  }

  /* ---------------------------------------------------------------- level-up overlay */
  var ROMAN = ['', 'I', 'II', 'III', 'IV', 'V'];
  function openLevelUp() {
    R.overlay = 'lvl'; JOY.on = false;
    U.lvlN.textContent = 'Seviye ' + fmt(R.lvl - R.pendingLv);
    U.cardsCur = rollCards();
    renderCards(false);
    renderOwned();
    U.reroll.disabled = R.rerolls <= 0; U.reroll.querySelector('em').textContent = R.rerolls;
    show(U.lvl, 'go');
    sfx('open', 0.7); duck(0.35, 0.6);
  }
  function renderCards(flipOnly) {
    var html = '', i;
    for (i = 0; i < U.cardsCur.length; i++) {
      var ci = cardInfo(U.cardsCur[i].id), isNew = ci.type !== 'evo' && ci.type !== 'fb' && ci.lv === 0;
      var typeN = ci.type === 'active' ? 'Aktif' : ci.type === 'passive' ? 'Pasif' : ci.type === 'weapon' ? 'Silah' : ci.type === 'evo' ? 'Evrim' : 'Ödül';
      var el = elInfo(ci.el), pips = '';
      if (ci.type !== 'evo' && ci.type !== 'fb') for (var k = 0; k < ci.max; k++) pips += '<b class="' + (k < ci.lv ? 'on' : k === ci.lv ? 'nx' : '') + '"></b>';
      html += '<button type="button" class="bt-card r' + ci.rar + (ci.type === 'evo' ? ' evo' : '') + '" data-i="' + i + '" style="--d:' + (i * 0.09) + 's">' +
        '<span class="bt-card-in">' +
          '<span class="bt-card-ic"><canvas></canvas>' + (ci.lv > 0 && ci.type !== 'evo' ? '<em class="num">' + ROMAN[clamp(ci.lv + 1, 1, 5)] + '</em>' : '') + '</span>' +
          '<span class="bt-card-tx">' +
            '<span class="bt-card-n">' + esc(ci.n) + (isNew ? '<i class="tag new">YENİ</i>' : '') + (ci.type === 'evo' ? '<i class="tag evo">EVRİM</i>' : '') + '</span>' +
            '<span class="bt-card-m"><i class="ty">' + typeN + '</i>' + (ci.type === 'active' || ci.type === 'evo' ? '<i class="el" style="--ec:' + el.col + '">' + esc(el.n) + '</i>' : '') + '<span class="bt-pips2">' + pips + '</span></span>' +
            '<span class="bt-card-d">' + esc(ci.desc) + '</span>' +
          '</span>' +
        '</span><span class="bt-card-shine"></span></button>';
    }
    U.cards.innerHTML = html;
    U.cards.classList.remove('flip'); void U.cards.offsetWidth; U.cards.classList.add('flip');
    var btns = U.cards.querySelectorAll('.bt-card');
    for (i = 0; i < btns.length; i++) {
      (function (btn, idx) {
        var c = btn.querySelector('canvas'), g = dprCanvas(c, 60, 60), id = U.cardsCur[idx].id;
        drawCardIcon(g, id, 0);
        btn.addEventListener('click', function () { pickCard(idx); });
      })(btns[i], i);
    }
    sfx('flip', 0.6);
  }
  function drawCardIcon(g, id, t) {
    var A = ART();
    g.clearRect(0, 0, 60, 60);
    if (id === '_can' || id === '_altin') {
      g.fillStyle = '#1A1424'; g.beginPath(); g.arc(30, 30, 27, 0, TAU); g.fill();
      if (A && A.drawPickup) { g.save(); g.translate(30, 34); g.scale(2.4, 2.4); g.translate(-30, -34); try { A.drawPickup(g, id === '_can' ? 'heal' : 'gold', 30, 36, t); } catch (e) { /* ignore */ } g.restore(); }
      return;
    }
    if (A && A.drawSkillIcon) { try { A.drawSkillIcon(g, 0, 0, 60, id, t); } catch (e) { warnOnce('drawSkillIcon', e); } }
  }
  function renderOwned() {
    var h = '', i, id;
    for (i = 0; i < 6; i++) { id = R.aSlots[i]; h += '<i class="o' + (id ? ' on' : '') + '" data-s="' + (id || '') + '"></i>'; }
    h += '<s></s>';
    for (i = 0; i < 6; i++) { id = R.pSlots[i]; h += '<i class="o p' + (id ? ' on' : '') + '" data-s="' + (id || '') + '"></i>'; }
    U.own.innerHTML = h;
    var A = ART(), els = U.own.querySelectorAll('i.on');
    for (i = 0; i < els.length; i++) {
      var c = document.createElement('canvas'); els[i].appendChild(c);
      var g = dprCanvas(c, 19, 19);
      if (A && A.drawSkillIcon) { try { A.drawSkillIcon(g, 0, 0, 19, els[i].getAttribute('data-s'), null); } catch (e) { /* ignore */ } }
    }
  }
  function reroll() {
    if (!R || R.overlay !== 'lvl' || R.rerolls <= 0 || U.closeT > 0) return;
    R.rerolls--;
    U.reroll.disabled = true; U.reroll.querySelector('em').textContent = R.rerolls;
    U.cardsCur = rollCards();
    renderCards(true);
    sfx('whoosh', 0.6, 1.2);
  }
  function pickCard(i) {
    if (!R || R.overlay !== 'lvl' || U.closeT > 0) return;
    var c = U.cardsCur[i]; if (!c) return;
    var btns = U.cards.querySelectorAll('.bt-card');
    for (var k = 0; k < btns.length; k++) btns[k].classList.add(k === i ? 'picked' : 'gone');
    applyPick(c.id);
    U.closeT = R.dbgSkip ? 0.0001 : 0.42;
    U.closeFn = closeLevelUp;
  }
  function closeLevelUp() {
    hide(U.lvl); R.overlay = null;
    if (R.chestQ > 0) { R.chestQ--; openChest(R.chestRar || 3); }
  }

  /* ---------------------------------------------------------------- chest roulette */
  var CELL_W = 64;
  function openChest(rar) {
    if (!R) return;
    if (R.overlay || R.ending) { R.chestQ = (R.chestQ || 0) + 1; R.chestRar = rar; return; }
    R.overlay = 'chest'; JOY.on = false;
    var cands = upgradable(true), res = weightedPick(cands, 1)[0];
    var resId = res ? res.id : '_altin';
    // reel strip: fillers from the possible pool, result lands at index 20
    var fill = cands.length ? cands : [{ id: '_altin' }, { id: '_can' }], N = 24, ids = [];
    for (var i = 0; i < N; i++) ids.push(i === 20 ? resId : fill[floor(rand() * fill.length)].id);
    var h = '';
    for (i = 0; i < N; i++) h += '<span class="bt-reel-c' + (i === 20 ? ' res' : '') + '"><canvas></canvas></span>';
    U.reel.innerHTML = h;
    var cvs = U.reel.querySelectorAll('canvas');
    for (i = 0; i < N; i++) { var g = dprCanvas(cvs[i], 56, 56); drawCardIcon(g, ids[i], null); }
    U.reel.style.transform = 'translateX(0px)';
    U.chOk.disabled = true; U.chRes.classList.remove('on');
    U.chRes.querySelector('b').textContent = ''; U.chRes.querySelector('span').textContent = '';
    U.chest.classList.toggle('mythic', rar >= 5);
    show(U.chest, 'go');
    var reelW = U.reel.parentNode.getBoundingClientRect().width || 300;
    U.chestS = { t: 0, dur: R.dbgSkip ? 0.01 : 2.3, to: 20 * CELL_W - (reelW / 2 - CELL_W / 2) + rr(-14, 14), res: resId, landed: false, cell: -1, rar: rar, open: 0 };
    sfx('chest', 1); duck(0.4, 0.8);
  }
  function chestTick(rdt, t) {
    var S = U.chestS; if (!S) return;
    S.t += rdt;
    var k = clamp(S.t / S.dur, 0, 1), e = 1 - Math.pow(1 - k, 4), pos = S.to * e;
    U.reel.style.transform = 'translateX(' + (-pos).toFixed(1) + 'px)';
    var cell = floor((pos + CELL_W * 0.5) / CELL_W);
    if (cell !== S.cell) { S.cell = cell; if (!S.landed && k < 1) sfx('tick', 0.35, 1 + k * 0.6); }
    drawChestCanvas(t, k, S.landed);
    if (k >= 1 && !S.landed) {
      S.landed = true;
      var ci = cardInfo(S.res);
      U.chRes.querySelector('b').textContent = ci.n;
      U.chRes.querySelector('span').textContent = ci.type === 'evo' ? 'EVRİM!' : ci.type === 'fb' ? ci.desc : (ci.lv === 0 ? 'Yeni yetenek' : 'Seviye ' + ci.lv + ' → ' + (ci.lv + 1));
      U.chRes.classList.add('on'); U.chOk.disabled = false;
      var cells = U.reel.querySelectorAll('.bt-reel-c'); if (cells[20]) cells[20].classList.add('hit');
      sfx(ci.type === 'evo' ? 'evolve' : 'rare', 0.9);
      if (R.dbgSkip) chestTake();
    }
  }
  function drawChestCanvas(t, k, landed) {
    var c = U.chCv, g = c.getContext('2d'), d = mn(window.devicePixelRatio || 1, 2), w = 220, h = 120, A = ART();
    if (c.width !== round(w * d)) dprCanvas(c, w, h);
    g.setTransform(d, 0, 0, d, 0, 0); g.clearRect(0, 0, w, h);
    var col = rarCol(U.chestS ? U.chestS.rar : 3);
    g.globalCompositeOperation = 'lighter';
    g.save(); g.translate(w / 2, 70); g.rotate(t * 0.4);
    for (var i = 0; i < 12; i++) { g.rotate(TAU / 12); g.globalAlpha = 0.12 + (landed ? 0.18 : 0.08 * k); g.fillStyle = col; g.beginPath(); g.moveTo(0, 0); g.lineTo(-10, -110); g.lineTo(10, -110); g.closePath(); g.fill(); }
    g.restore();
    g.globalAlpha = landed ? 0.9 : 0.4 + 0.3 * k; g.drawImage(glowSpr(col), w / 2 - 70, 0, 140, 140);
    g.globalAlpha = 1; g.globalCompositeOperation = 'source-over';
    var S = U.chestS;
    if (S) S.open = landed ? mn(1, S.open + 0.06) : 0;
    var sh = landed ? 0 : sin(t * 46) * 2.2 * k * k;
    drawBigChest(g, w / 2 + sh, 106, 1.25, S ? eBack(S.open) : 0, t, col);
  }
  /* big vector chest for the roulette (lid flips open, light pours out) */
  function drawBigChest(g, cx, cy, s, open, t, col) {
    g.save(); g.translate(cx, cy); g.scale(s, s);
    g.lineJoin = 'round'; g.lineCap = 'round';
    g.fillStyle = 'rgba(0,0,0,0.5)'; g.beginPath(); g.ellipse(0, 1, 38, 6, 0, 0, TAU); g.fill();
    // body
    g.lineWidth = 2.6; g.strokeStyle = '#120C18';
    g.beginPath(); g.moveTo(-32, -40); g.lineTo(32, -40); g.lineTo(30, 0); g.lineTo(-30, 0); g.closePath(); g.fillStyle = '#8A5230'; g.fill(); g.stroke();
    g.fillStyle = '#6A3C20'; g.fillRect(-29, -16, 58, 14);
    g.strokeStyle = 'rgba(18,12,24,0.45)'; g.lineWidth = 1.2; g.beginPath(); g.moveTo(-30, -27); g.lineTo(30, -27); g.moveTo(-30, -14); g.lineTo(30, -14); g.stroke();
    g.strokeStyle = '#120C18'; g.lineWidth = 2;
    g.fillStyle = '#FFCB57'; g.beginPath(); g.rect(-23, -40, 7, 40); g.rect(16, -40, 7, 40); g.fill(); g.stroke();
    g.fillStyle = '#FFF1C4'; g.fillRect(-22, -39, 2, 37); g.fillRect(17, -39, 2, 37);
    // inside glow when open
    if (open > 0.02) {
      g.fillStyle = '#1A0E08'; g.beginPath(); g.ellipse(0, -40, 31, 7 * clamp(open, 0, 1), 0, 0, TAU); g.fill();
      g.globalCompositeOperation = 'lighter';
      g.globalAlpha = clamp(open, 0, 1); g.drawImage(hotSpr(col), -46, -86, 92, 92);
      for (var i = 0; i < 7; i++) { var a = -HPI + (i - 3) * 0.24 + sin(t * 2 + i) * 0.04; g.save(); g.rotate(a + HPI); g.globalAlpha = 0.35 * clamp(open, 0, 1); g.fillStyle = col; g.beginPath(); g.moveTo(-4, -40); g.lineTo(-12, -150); g.lineTo(12, -150); g.lineTo(4, -40); g.closePath(); g.fill(); g.restore(); }
      g.globalAlpha = 1; g.globalCompositeOperation = 'source-over';
    }
    // lid: hinged at the back; flips over as it opens
    var sy = 1 - open * 1.75;
    g.save(); g.translate(0, -40); g.scale(1, sy); g.translate(0, 40);
    g.lineWidth = 2.6 / mx(0.25, abs(sy)); g.strokeStyle = '#120C18';
    g.beginPath(); g.moveTo(-33, -40); g.bezierCurveTo(-33, -64, 33, -64, 33, -40); g.closePath(); g.fillStyle = sy > 0 ? '#9A5E36' : '#4A2814'; g.fill(); g.stroke();
    g.fillStyle = '#FFCB57'; g.lineWidth = 2 / mx(0.25, abs(sy));
    g.beginPath(); g.rect(-23, -58, 7, 18); g.rect(16, -58, 7, 18); g.fill(); g.stroke();
    g.restore();
    // lock
    if (open < 0.4) {
      g.globalAlpha = 1 - open * 2.5;
      g.fillStyle = '#FFCB57'; g.strokeStyle = '#120C18'; g.lineWidth = 2;
      g.beginPath(); g.rect(-7, -46, 14, 15); g.fill(); g.stroke();
      g.fillStyle = '#120C18'; g.beginPath(); g.arc(0, -40, 2.4, 0, TAU); g.fill(); g.fillRect(-1, -40, 2, 5);
      g.globalCompositeOperation = 'lighter'; g.globalAlpha = (0.4 + 0.3 * sin(t * 8)) * (1 - open * 2.5); g.drawImage(glowSpr(col), -14, -52, 28, 28); g.globalCompositeOperation = 'source-over';
      g.globalAlpha = 1;
    }
    g.restore();
  }
  function chestTake() {
    var S = U.chestS; if (!S || !S.landed || !R) return;
    U.chestS = null;
    applyPick(S.res);
    hide(U.chest); R.overlay = null;
    sfx('click');
    if (R.chestQ > 0) { R.chestQ--; openChest(R.chestRar || 3); }
  }

  /* ---------------------------------------------------------------- pause / settings */
  function settings() { var p = GM.S && GM.S.p; return (p && p.settings) || { sound: GM.A ? GM.A.sfxOn !== false : true, music: GM.A ? GM.A.musicOn !== false : true }; }
  function refreshPauseButtons() {
    var s = settings();
    U.pzSnd.textContent = 'Ses: ' + (s.sound !== false ? 'Açık' : 'Kapalı');
    U.pzMus.textContent = 'Müzik: ' + (s.music !== false ? 'Açık' : 'Kapalı');
    U.pzSnd.classList.toggle('off', s.sound === false); U.pzMus.classList.toggle('off', s.music === false);
  }
  function toggleSetting(k) {
    var s = settings(), v = !(s[k] !== false);
    try { if (GM.S && GM.S.setSetting) GM.S.setSetting(k, v); else s[k] = v; } catch (e) { s[k] = v; }
    try { if (GM.A) { if (k === 'sound' && GM.A.setSfx) GM.A.setSfx(v); if (k === 'music' && GM.A.setMusic) GM.A.setMusic(v); } } catch (e) { warnOnce('A.set', e); }
    if (v) sfx('click');
    refreshPauseButtons();
  }
  function renderPause() {
    var st = '<div><small>Süre</small><b class="num">' + fmtTime(R.time) + '</b></div><div><small>Öldürme</small><b class="num">' + fmt(R.res.kills) + '</b></div>' +
      '<div><small>Seviye</small><b class="num">' + fmt(R.lvl) + '</b></div><div><small>Altın</small><b class="num">' + fmt(R.res.goldPicked * R.st.goldGain) + '</b></div>';
    U.pzSt.innerHTML = st;
    var h = '', all = R.aSlots.concat(R.pSlots);
    for (var i = 0; i < all.length; i++) { var d = skDef(all[i]) || {}; h += '<div class="bt-pz-s"><canvas data-s="' + all[i] + '"></canvas><span>' + esc(d.n || all[i]) + '</span><em class="num">' + (d.type === 'evo' ? 'EVRİM' : 'Sv ' + (R.skills[all[i]] | 0)) + '</em></div>'; }
    U.pzSk.innerHTML = h || '<p class="muted">Henüz yetenek yok.</p>';
    var cs = U.pzSk.querySelectorAll('canvas'), A = ART();
    for (var j = 0; j < cs.length; j++) { var g = dprCanvas(cs[j], 26, 26); if (A && A.drawSkillIcon) { try { A.drawSkillIcon(g, 0, 0, 26, cs[j].getAttribute('data-s'), null); } catch (e) { /* ignore */ } } }
    U.pzQuit.textContent = 'Pes Et'; U.pzQuit.classList.remove('sure'); R.quitAsk = false;
    refreshPauseButtons();
  }
  function quitAsk() {
    if (!R) return;
    if (!R.quitAsk) { R.quitAsk = true; U.pzQuit.textContent = 'Emin misin? Tekrar dokun'; U.pzQuit.classList.add('sure'); sfx('error', 0.5); return; }
    hide(U.pause); R.paused = false; R.quit = true;
    endRun(false);
  }

  /* ---------------------------------------------------------------- revive */
  function heroDown() {
    if (R.ending) return;
    if (R.revives > 0) { R.revives--; openRevive(); return; }
    H.dead = true; H.deathT = 0;
    burst(H.x, H.y - HERO_CY, 20, '#E8394D', 200, 0.8, 4, PT_GLOW, 40);
    fx(FX_SOUL, H.x, H.y - 30, 0, 1.4, '#E8D8FF');
    endRun(false);
  }
  function openRevive() {
    R.overlay = 'revive'; JOY.on = false; H.hp = 0;
    U.revT.textContent = 'Kalan diriliş: ' + fmt(R.revives);
    show(U.rev, 'go'); U.revT0 = R.anim;
    sfx('heartbeat', 0.8); duck(0.6, 1.5);
  }
  function revTick(t) {
    var k = clamp((R.anim - U.revT0) / 1.7, 0, 1), g = U.revCv.getContext('2d'), d = mn(window.devicePixelRatio || 1, 2);
    if (U.revCv.width !== round(110 * d)) dprCanvas(U.revCv, 110, 110);
    g.setTransform(d, 0, 0, d, 0, 0); g.clearRect(0, 0, 110, 110);
    g.globalCompositeOperation = 'lighter'; g.globalAlpha = 0.5 + 0.4 * k; g.drawImage(glowSpr('#FFCB57'), 5, 5, 100, 100); g.globalAlpha = 1; g.globalCompositeOperation = 'source-over';
    g.lineWidth = 6; g.strokeStyle = 'rgba(0,0,0,0.5)'; g.beginPath(); g.arc(55, 55, 40, 0, TAU); g.stroke();
    g.strokeStyle = '#FFCB57'; g.lineCap = 'round'; g.beginPath(); g.arc(55, 55, 40, -HPI, -HPI + TAU * k); g.stroke();
    g.fillStyle = '#FFF1C4'; g.font = '34px "Lilita One",system-ui,sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(String(mx(1, ceil(2 - k * 2))), 55, 57);
    if (k >= 1) doRevive();
  }
  function doRevive() {
    if (!R || R.overlay !== 'revive') return;
    hide(U.rev); R.overlay = null;
    H.dead = false; H.hp = R.st.maxHp * 0.5; H.hpLag = H.hp; H.iT = 2.6;
    fx(FX_PILLAR, H.x, H.y, 70, 1.6, '#FFCB57'); fx(FX_RING, H.x, H.y - HERO_CY, 300, 0.8, '#FFE07A');
    var c = hQuery(H.x, H.y - HERO_CY, 300, QA);
    for (var i = 0; i < c; i++) { var e = QA[i]; hit(e, R.st.atk * 3, K_ULT, 'none', 600, H.x, H.y, 0); }
    flash(0.6, '#FFF1C4'); shake(10);
    numAt(H.x, H.y - 80, 'DİRİLDİN!', N_BIG, '#FFCB57');
    sfx('revive', 1);
  }

  /* ---------------------------------------------------------------- end of run */
  function endRun(won) {
    if (!R || R.ending) return;
    R.ending = 1; R.won = !!won; R.endT = 0;
    closeOverlays();
    JOY.on = false;
    R.slow = 0.22; R.slowT = 1.4;
    if (won) { R.god = true; sfx('victory', 1); }
    else {
      sfx('defeat', 1);
      if (!H.dead) { H.dead = true; H.deathT = 0; fx(FX_SOUL, H.x, H.y - 30, 0, 1.6, '#E8D8FF'); burst(H.x, H.y - HERO_CY, 16, '#B57BFF', 160, 0.8, 4, PT_GLOW, 40); }
    }
    music(null);
    U.ult.classList.add('gone'); U.hud.classList.add('dim');
  }
  function closeOverlays() {
    if (!U) return;
    hide(U.lvl); hide(U.chest); hide(U.rev); hide(U.pause); hide(U.tut); hide(U.warn);
    U.chestS = null; U.closeT = 0;
    R.overlay = null; R.paused = false;
  }
  function showEnd() {
    var won = R.won;
    U.end.className = 'bt-end ' + (won ? 'win' : 'lose');
    U.endSm.textContent = (R.ch.n || '') + ' · Bölüm ' + R.ch.id;
    U.endT.textContent = won ? 'ZAFER' : 'YENİLDİN';
    U.endS.textContent = won ? ((R.hd.lines && R.hd.lines.win) || 'Karanlık geri çekildi.') : ((R.hd.lines && R.hd.lines.lose) || 'Gölgeler bu gece kazandı…');
    U.endSt.innerHTML = '<div><small>Süre</small><b class="num">' + fmtTime(R.time) + '</b></div><div><small>Öldürme</small><b class="num">' + fmt(R.res.kills) + '</b></div><div><small>Seviye</small><b class="num">' + fmt(R.lvl) + '</b></div>';
    show(U.end, 'go');
  }
  function buildResult() {
    var r = R.res, kbt = {}, k;
    for (k in r.killsByType) kbt[k] = r.killsByType[k];
    return {
      chapterId: +R.ch.id || 1, won: !!R.won, time: round(R.time), kills: r.kills, killsByType: kbt, elites: r.elites, bosses: r.bosses,
      metins: r.metins, chests: r.chests, goldPicked: round(r.goldPicked), distance: round(r.distance), meleeKills: r.meleeKills,
      rangedHits: r.rangedHits, skillDamage: round(r.skillDamage), nearMisses: r.nearMisses, damageTaken: round(r.damageTaken),
      runLevel: R.lvl, heroId: R.sheet.heroId
    };
  }
  function fallbackRewards(res) {
    return { gold: res.goldPicked, gems: 0, heroXp: 0, accXp: 0, accLevelUp: false, shards: {}, scrolls: { silah: 0, zirh: 0, taki: 0 },
      items: [], attrs: [], firstClear: false, unlockedChapter: null, chapterId: res.chapterId, won: res.won, heroId: res.heroId };
  }
  function finish() {
    if (!R) return;
    R.finished = true;
    var res = buildResult(), rew = null;
    B.lastResult = res;
    if (GM.S && typeof GM.S.finishRun === 'function') { try { rew = GM.S.finishRun(res); } catch (e) { warnOnce('S.finishRun', e); } }
    if (!rew) rew = fallbackRewards(res);
    B.lastRewards = rew;
    teardown();
    var lobby = document.getElementById('gm-lobby'); if (lobby) lobby.hidden = false;
    B.active = false;
    if (GM.UI && typeof GM.UI.showResults === 'function') { try { GM.UI.showResults(rew, res); } catch (e) { warnOnce('UI.showResults', e); } }
    music('lobby');
  }
  function teardown() {
    offAll();
    if (ro) { try { ro.disconnect(); } catch (e) { /* ignore */ } ro = null; }
    if (root) { root.innerHTML = ''; root.hidden = true; root.classList.remove('bt-root'); }
    if (EN) clearPools();
    if (R) R.chunks.clear();
    R = null; U = null; cv = null; ctx = null; lcv = null; lctx = null;
    JOY.on = false; KEYS.up = KEYS.down = KEYS.left = KEYS.right = false;
    EMB.length = 0; SORT.length = 0; nOff = 0;
    if (bakeChanged) { var A = ART(); if (A && A.setBakeScale) { try { A.setBakeScale(0); } catch (e) { /* ignore */ } } bakeChanged = false; }
  }

  /* ============================================================================================
   * Input: floating joystick (pointer) + keyboard
   * ========================================================================================== */
  function localXY(ev) { var r = cv.getBoundingClientRect(), sx = r.width ? R.vw / r.width : 1, sy = r.height ? R.vh / r.height : 1; return [(ev.clientX - r.left) * sx, (ev.clientY - r.top) * sy]; }
  function onDown(ev) {
    if (!R || R.overlay || R.paused || R.ending) return;
    if (JOY.on && ev.pointerId !== JOY.id) return;
    var p = localXY(ev);
    JOY.on = true; JOY.id = ev.pointerId; JOY.bx = p[0]; JOY.by = p[1]; JOY.x = p[0]; JOY.y = p[1]; JOY.dx = 0; JOY.dy = 0; JOY.mag = 0;
    try { cv.setPointerCapture(ev.pointerId); } catch (e) { /* ignore */ }
    if (ev.cancelable) ev.preventDefault();
  }
  function onMove(ev) {
    if (!JOY.on || ev.pointerId !== JOY.id || !R) return;
    var p = localXY(ev), dx = p[0] - JOY.bx, dy = p[1] - JOY.by, d = sqrt(dx * dx + dy * dy), max = 46;
    if (d > max) { JOY.bx = p[0] - dx / d * max; JOY.by = p[1] - dy / d * max; if (R.tut) R.tutMoved += d - max; d = max; }
    JOY.x = p[0]; JOY.y = p[1];
    JOY.mag = clamp(d / max, 0, 1);
    if (d > 0.5) { JOY.dx = dx / d; JOY.dy = dy / d; }
    if (R.tut) R.tutMoved += 1;
    if (ev.cancelable) ev.preventDefault();
  }
  function onUp(ev) { if (ev.pointerId !== JOY.id) return; JOY.on = false; JOY.mag = 0; JOY.id = -1; }
  var KEYMAP = { KeyW: 'up', ArrowUp: 'up', KeyS: 'down', ArrowDown: 'down', KeyA: 'left', ArrowLeft: 'left', KeyD: 'right', ArrowRight: 'right' };
  function onKey(ev, down) {
    if (!R || !B.active) return;
    var k = KEYMAP[ev.code];
    if (k) { KEYS[k] = down; if (down && R.tut) R.tutMoved += 8; ev.preventDefault(); return; }
    if (!down) return;
    if (ev.code === 'Space') { ev.preventDefault(); castUlt(); }
    else if (ev.code === 'Escape' || ev.code === 'KeyP') { ev.preventDefault(); if (R.paused) B.resume(); else B.pause(); }
    else if (R.overlay === 'lvl' && (ev.key === '1' || ev.key === '2' || ev.key === '3')) pickCard(+ev.key - 1);
    else if (R.overlay === 'chest' && (ev.code === 'Enter')) chestTake();
  }

  /* ============================================================================================
   * Resize + adaptive resolution
   * ========================================================================================== */
  function resize() {
    if (!R || !root || !cv) return;
    var r = root.getBoundingClientRect(), w = mx(200, r.width || 390), h = mx(300, r.height || 844);
    R.vw = w; R.vh = h;
    cv.width = round(w * DPR); cv.height = round(h * DPR); cv.style.width = w + 'px'; cv.style.height = h + 'px';
    lcv.width = ceil(w * LS); lcv.height = ceil(h * LS);
    if (ctx) ctx.imageSmoothingEnabled = true;
  }
  function perfTick(rdt) {
    if (R.dbgSkip || R.overlay || R.paused) return;
    R.frameMs = R.frameMs * 0.94 + rdt * 1000 * 0.06;
    R.perfAcc += rdt * 1000; R.perfN++;
    if (R.frameMs > 22 && R.time > 3) {
      R.slowFrames += rdt;
      if (R.slowFrames > 2.5) {
        R.slowFrames = 0;
        if (DPR > 1.3) setDpr(1.25);
        else if (DPR > 1.01) { setDpr(1); LS = 0.35; }
      }
    } else R.slowFrames = mx(0, R.slowFrames - rdt * 0.5);
  }
  function setDpr(d) {
    if (d === DPR) return;
    DPR = d; R.dprDrops++;
    var A = ART(); if (A && A.setBakeScale) { try { A.setBakeScale(d); bakeChanged = true; } catch (e) { warnOnce('setBakeScale', e); } }
    resize();
  }

  /* ============================================================================================
   * Simulation step + frame
   * ========================================================================================== */
  function step(dt) {
    if (dt <= 0) return;
    R.time += dt;
    if (R.bossPhase === 1) { R.warnT -= dt; if (R.warnT <= 0) spawnBoss(); }
    if (R.arena) R.arena.t += dt;
    if (R.boss && R.boss.dead) R.boss = null;
    var bd = R.bossDeath;
    if (bd) {
      bd.t += dt;
      while (bd.k < 8 && bd.t > bd.k * 0.15) { bd.k++; fx(FX_EXPL, bd.x + rr(-50, 50), bd.y + rr(-50, 30), rr(40, 75), 0.6, rand() < 0.5 ? '#FF7A2F' : '#FFE07A'); shake(6); sfx('explosion', 0.5, rr(0.7, 1)); }
      if (bd.t > 1.25 && !bd.fin) {
        bd.fin = 1; fx(FX_EXPL, bd.x, bd.y, 170, 0.9, '#FFF1C4'); fx(FX_PILLAR, bd.x, bd.y + 40, 120, 3, '#FF3D4F'); fx(FX_SHOCK, bd.x, bd.y, 360, 0.9, '#FFE07A');
        burst(bd.x, bd.y - 20, 40, '#FFE07A', 360, 1.0, 5, PT_GLOW, 60); flash(0.6, '#FFF1C4'); shake(16);
        sfx('legendary', 1); sfx('metinBreak', 0.8, 0.6);
      }
    }
    if (R.winT > 0) { R.winT -= dt; if (R.winT <= 0 && !R.ending) endRun(true); }
    if (R.speechT > 0) R.speechT -= dt;
    updEvents();
    updSpawns(dt);
    updHero(dt);
    updEnemies(dt);
    hBuild();
    if (!H.dead && !R.ending) { updWeapon(dt); updSkills(dt); }
    updUlt(dt);
    updProj(dt);
    updBullets(dt);
    updTeles(dt);
    updZones(dt);
    updPickups(dt);
    var i;
    for (i = EN.n - 1; i >= 0; i--) if (EN.a[i].dead) EN.kill(i);
    for (i = PA.n - 1; i >= 0; i--) {
      var p = PA.a[i]; p.life -= dt;
      if (p.life <= 0) { PA.kill(i); continue; }
      var k = exp(-p.drag * dt); p.vx *= k; p.vy = p.vy * k + p.g * dt; p.x += p.vx * dt; p.y += p.vy * dt; p.rot += p.vr * dt;
      if (p.g > 0 && p.vy > 0 && p.y > p.fy) { p.y = p.fy; p.vy *= -0.3; p.vx *= 0.5; }
    }
    for (i = FXP.n - 1; i >= 0; i--) { var f = FXP.a[i]; f.t += dt; if (f.t >= f.dur) FXP.kill(i); }
    for (i = NU.n - 1; i >= 0; i--) { var n = NU.a[i]; n.t += dt; if (n.t > (n.kind === N_TEXT || n.kind === N_BIG ? 1.15 : 0.9)) NU.kill(i); }
    for (i = CO.n - 1; i >= 0; i--) { var c = CO.a[i]; c.dying += dt / 0.55; if (c.dying >= 1) CO.kill(i); }
    if (H.dead) H.deathT += dt;
  }
  function frame(dt, t) {
    if (!R || !ctx) return;
    var t0 = now();
    var rdt = clamp(dt, 0, 0.05);
    R.rdt = rdt; R.rt += rdt; R.anim += rdt;
    var ts = 1;
    if (R.hitstop > 0) { R.hitstop -= rdt; ts = 0.05; }
    if (R.hsCd > 0) R.hsCd -= rdt;
    if (R.slowT > 0) { R.slowT -= rdt; ts *= R.slow; if (R.slowT <= 0) { R.slow = 1; R.slowT = 0; } }
    var running = !R.paused && !R.overlay;
    if (running) {
      step(rdt * ts);
      if (!R) return;
      updCamera(rdt * ts, rdt);
      if (R.time > 1.0) maybeLevelUp(rdt);
      tutTick(rdt);
    }
    if (!R) return;
    if (U.closeT > 0) { U.closeT -= rdt; if (U.closeT <= 0) { U.closeT = 0; var fn = U.closeFn; U.closeFn = null; if (fn) fn(); } }
    if (R.overlay === 'chest') chestTick(rdt, t);
    else if (R.overlay === 'revive') revTick(t);
    else if (R.overlay === 'lvl') lvlTick(t);
    hudTick(rdt);
    if (running || R.renderOnce) { R.renderOnce = false; try { render(t); } catch (err) { warnOnce('render', err); try { ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over'; } catch (e2) { /* ignore */ } } }
    if (R.ending) {
      R.endT += rdt;
      if (R.endT > 0.55 && !R.endShown) { R.endShown = true; showEnd(); }
      if (R.endT > (R.quit ? 1.8 : 3.8) && !R.finished) finish();
    }
    if (R) { perfTick(rdt); R.workMs = now() - t0; R.workAcc = (R.workAcc || 0) + R.workMs; R.workN = (R.workN || 0) + 1; }
  }
  function lvlTick(t) {
    // animated evolution icons on the cards
    if (!U.cardsCur) return;
    var cvs = U.cards.querySelectorAll('.bt-card.evo canvas');
    for (var i = 0; i < cvs.length; i++) {
      var g = cvs[i].getContext('2d'), d = mn(window.devicePixelRatio || 1, 2);
      g.setTransform(d, 0, 0, d, 0, 0);
      var btn = cvs[i].closest('.bt-card'), idx = btn ? +btn.getAttribute('data-i') : 0;
      drawCardIcon(g, U.cardsCur[idx] ? U.cardsCur[idx].id : '', t);
    }
  }
  function tutTick(rdt) {
    if (!R.tut) return;
    R.tutT += rdt;
    if (R.res.distance > 90 || R.tutT > 9) {
      R.tut = false; U.tut.classList.add('out');
      setTimeout(function () { if (U && U.tut) hide(U.tut); }, 450);
      try { if (GM.S && GM.S.p) { GM.S.p.tutBattle = 1; if (GM.S.save) GM.S.save(); } } catch (e) { /* storage optional */ }
      TUT_DONE = true;
    }
  }
  var TUT_DONE = false;

  /* ============================================================================================
   * Public API
   * ========================================================================================== */
  function start(chapterId) {
    if (R) teardown();
    root = document.getElementById('gm-battle');
    if (!root) return false;
    ensurePools(); clearPools();
    for (var k in SKD) delete SKD[k];
    var ch = chapterDef(chapterId) || FB_CH;
    var sheet = null, look = null, A = ART();
    if (GM.S && typeof GM.S.computeStats === 'function') { try { sheet = GM.S.computeStats(); } catch (e) { warnOnce('S.computeStats', e); } }
    sheet = normSheet(sheet);
    if (GM.S && typeof GM.S.appearance === 'function') { try { look = GM.S.appearance(); } catch (e) { warnOnce('S.appearance', e); } }
    if (!look) look = (A && A.heroLook) ? A.heroLook(sheet.heroId) : { heroId: sheet.heroId, heroSkin: null, weapon: { wt: sheet.weapon, rar: sheet.weaponRar, skin: null }, gear: {} };
    if (look && !look.weapon) look.weapon = { wt: sheet.weapon, rar: sheet.weaponRar, skin: null };
    newRun(ch, sheet, look);
    H.x = 0; H.y = 0; H.vx = 0; H.vy = 0; H.dead = false; H.deathT = 0; H.iT = 1.2; H.hurtT = 9; H.atkT = 9; H.castT = 9; H.dir = 1; H.face = 0;
    H.moving = false; H.mvx = 0; H.mvy = 0; H.spdMul = 1; H.takeMul = 1; H.stepT = 0;
    recalc();
    H.hp = R.st.maxHp; H.hpLag = H.hp; H.shield = sheet.shieldStart;
    R.camX = 0; R.camY = -30;
    if (sheet.startLvl > 0) { R.lvl += sheet.startLvl; R.pendingLv += sheet.startLvl; R.need = needXp(R.lvl); }
    DPR = mn(window.devicePixelRatio || 1, 2); DPR0 = DPR; LS = 0.5;
    buildDom();
    on(cv, 'pointerdown', onDown); on(cv, 'pointermove', onMove); on(cv, 'pointerup', onUp); on(cv, 'pointercancel', onUp); on(cv, 'lostpointercapture', onUp);
    on(window, 'keydown', function (e) { onKey(e, true); }); on(window, 'keyup', function (e) { onKey(e, false); });
    on(window, 'blur', function () { KEYS.up = KEYS.down = KEYS.left = KEYS.right = false; JOY.on = false; });
    var lobby = document.getElementById('gm-lobby'); if (lobby) lobby.hidden = true;
    root.hidden = false;
    if (typeof ResizeObserver !== 'undefined') { ro = new ResizeObserver(function () { resize(); if (R) R.renderOnce = true; }); ro.observe(root); }
    resize();
    initEmbers();
    // warm the sprites of this chapter so the first wave doesn't hitch
    if (A && A.bakeEnemy) {
      var types = {}; (ch.waves || []).forEach(function (w) { for (var t in (w.pool || {})) types[t] = 1; }); (ch.events || []).forEach(function (e) { if (e.e) types[e.e] = 1; });
      for (var ty in types) { var df = enemyDef(ty); if (df && !df.boss) { try { A.bakeEnemy(ty); } catch (e) { warnOnce('bakeEnemy', e); } } }
    }
    B.active = true;
    music('battle');
    showChapter();
    R.speech = (R.hd.lines && R.hd.lines.start) || ''; R.speechT = R.speech ? 2.6 : 0;
    var p = GM.S && GM.S.p;
    if (!TUT_DONE && !(p && p.tutBattle)) { R.tut = true; R.tutT = 0; show(U.tut, 'go'); }
    R.skillsDirty = true; R.renderOnce = true;
    sfx('whoosh', 0.6, 0.6);
    return true;
  }
  B.start = start;
  B.frame = frame;
  B.pause = function () {
    if (!R || R.ending || R.paused) return;
    JOY.on = false; KEYS.up = KEYS.down = KEYS.left = KEYS.right = false;
    if (R.overlay) return;            // level-up / chest / revive already freeze the run
    R.paused = true;
    renderPause(); show(U.pause, 'go');
    sfx('open', 0.5);
  };
  B.resume = function () {
    if (!R || !R.paused) return;
    R.paused = false; hide(U.pause); R.renderOnce = true;
  };
  B.quit = function () {
    if (!R || R.finished) return;
    R.won = false; R.quit = true;
    if (!H.dead) H.dead = true;
    finish();
  };
  B.perf = function () { return R ? { avgFrameMs: R.perfN ? R.perfAcc / R.perfN : 0, emaFrameMs: R.frameMs, avgWorkMs: R.workN ? R.workAcc / R.workN : 0, dpr: DPR, enemies: EN.n, particles: PA.n } : null; };
  function autoResolve() {
    if (!R) return;
    for (var guard = 0; guard < 20 && R.overlay; guard++) {
      if (R.overlay === 'lvl') { applyPick(U.cardsCur[0].id); hide(U.lvl); R.overlay = null; U.closeT = 0; U.closeFn = null; if (R.chestQ > 0) { R.chestQ--; openChest(R.chestRar || 3); } }
      else if (R.overlay === 'chest' && U.chestS) { U.chestS.landed = true; chestTake(); }
      else if (R.overlay === 'revive') doRevive();
      else break;
    }
    while (R.pendingLv > 0) { R.pendingLv--; applyPick(rollCards()[0].id); }
    while (R.chestQ > 0) { R.chestQ--; var c = weightedPick(upgradable(true), 1)[0]; if (c) applyPick(c.id); }
    R.lvState = 0;
  }
  B._debug = {
    skip: function (sec) {
      if (!R) return;
      R.dbgSkip = true;
      var n = ceil((+sec || 1) * 30);
      for (var i = 0; i < n && R && !R.finished && !R.ending; i++) {
        autoResolve(); if (!R) break;
        if (R.overlay || R.paused) break;
        step(1 / 30); if (!R) break;
        updCamera(1 / 30, 1 / 30);
      }
      if (R) { autoResolve(); R.dbgSkip = false; R.renderOnce = true; }
    },
    god: function (v) { if (R) R.god = v !== false; return R ? R.god : false; },
    auto: function (v) { if (R) R.auto = v !== false; return R ? !!R.auto : false; },
    resolve: function () { autoResolve(); if (R) R.renderOnce = true; },
    flags: function (f) { DBGF = f || {}; },
    lights: function () { var o = []; for (var i = 0; i < nL; i++) o.push([round(LT[i].x), round(LT[i].y), round(LT[i].r), +LT[i].a.toFixed(2), LT[i].col]); return { n: nL, em0: EM0, hx: H.x, hy: H.y, cam: [R && R.camX, R && R.camY], list: o.slice(0, 12) }; },
    kill: function () {
      if (!R) return 0;
      var n = 0;
      for (var i = 0; i < EN.n; i++) { var e = EN.a[i]; if (e.dead) continue; if (e.stone && e.inv) continue; e.inv = false; killEnemy(e, K_ULT); n++; }
      return n;
    },
    spawn: function (type, n) { if (!R) return 0; var c = 0; for (var i = 0; i < (n || 1); i++) { var p = ringPoint(0); if (spawnEnemy(type || 'iskelet', p.x + rr(-80, 80), p.y + rr(-80, 80))) c++; } return c; },
    level: function (n) { if (!R) return; n = n || 1; R.lvl += n; R.pendingLv += n; R.need = needXp(R.lvl); },
    give: function (id, n) { if (!R) return; for (var i = 0; i < (n || 1); i++) applyPick(id); },
    ult: function () { if (!R) return false; R.ult.charge = 1; return castUlt(); },
    die: function () { if (!R) return; R.god = false; H.iT = 0; R.revives = 0; R.st.dodge = 0; H.shield = 0; hurtHero(1e9, null); },
    hurt: function (v) { if (!R) return; H.iT = 0; hurtHero(v || 100, null); },
    pick: function (i) { if (R && R.overlay === 'lvl') pickCard(i || 0); },
    chest: function (rar) { if (R) openChest(rar || 4); },
    time: function (t) { if (R) R.time = t; },
    info: function () {
      if (!R) return null;
      return { time: R.time, lvl: R.lvl, xp: R.xp, need: R.need, kills: R.res.kills, alive: R.alive, enemies: EN.n, parts: PA.n, nums: NU.n, proj: PR.n, picks: PK.n,
        hp: H.hp, maxHp: R.st.maxHp, bossPhase: R.bossPhase, boss: R.boss ? { type: R.boss.type, hp: R.boss.hp, maxHp: R.boss.maxHp, bs: R.boss.bs } : null,
        overlay: R.overlay, paused: R.paused, ending: R.ending, skills: JSON.parse(JSON.stringify(R.skills)), aSlots: R.aSlots.slice(), pSlots: R.pSlots.slice(),
        ult: R.ult.charge, ultAct: R.ult.act, frameMs: R.frameMs, dpr: DPR, res: JSON.parse(JSON.stringify(R.res)), metinAlive: R.metinAlive, eliteAlive: R.eliteAlive };
    }
  };

  GM.B = B;
})(window.GM = window.GM || {});
