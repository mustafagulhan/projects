/* GÖLGE MUHAFIZLARI — state: save/profile, economy, inventory, heroes, talents, stats math (owner: state).
 * Namespace: GM.S  (SPEC §3)
 *
 * Pure logic, no DOM. Reads content from GM.D at call time (never at load time); if a table is
 * missing from GM.D a small fallback copy of the SPEC values below is used so nothing crashes.
 *
 * Every mutating call bumps a revision, emits its specific event(s) and then one 'change', and
 * schedules a debounced (300 ms) save to localStorage['golge-muhafizlari-v1'] (try/catch — the
 * game works without storage).  Nested mutations (finishRun, resetTalents…) are batched so
 * listeners get each event once.
 *
 * SPEC API (all present):
 *   load save reset · on off emit · addGold spendGold addGems spendGems · getEnergy spendEnergy
 *   itemName itemMain itemSubs itemPower · makeItem addItem removeItem getItem bag
 *   equip unequip equipped · upgradeCost canUpgrade upgradeItem · mergeCandidates merge sell
 *   hero heroDef ownedHeroes setActive unlockHero heroLevelCost levelUpHero heroMaxLv starCost starUpHero
 *   talentPoints branchSpent canRank rankTalent resetTalents · trainCost train
 *   attr addAttrXP attrBonus · ownsSkin buySkin setSkin skinFor · computeStats power appearance
 *   canStart startRun finishRun chapterState
 * Extras (additive helpers for UI/battle):
 *   addEnergy isEquipped markSeen newCount mergeGroups canLevelHero canStarUp heroUnlockCost talentRank
 *   trainInfo attrNeed accInfo skinsFor setBonuses powerIf hints chapterDef setSetting setName
 *   revision fmt batch KEY
 */
(function (GM) {
  'use strict';

  var KEY = 'golge-muhafizlari-v1';
  var VERSION = 1;
  var ATTR_MAX_DEF = 100;
  var MAX_RUN_ITEMS = 10;          // cap on equipment drops from one run
  var LEVEL_GIFT_ENERGY = 10;      // account level-up gift (energy may overflow the cap)
  var STARTER_SCROLLS = { silah: 12, zirh: 30, taki: 12 };
  var SCROLL_GROUPS = ['silah', 'zirh', 'taki'];
  var EVENTS = ['gold', 'gems', 'energy', 'item', 'equip', 'hero', 'talent', 'train', 'attr', 'skin', 'level'];

  /* ============================================================================================
   * Fallback copy of the SPEC values (used only for tables GM.D does not provide)
   * ========================================================================================== */
  var FB = {
    RARITIES: [
      { id: 'siradan', n: 'Sıradan', col: '#A7ADB7', dark: '#5D6370', mult: 1.00, maxLv: 10, subs: 0, glow: 0 },
      { id: 'iyi', n: 'İyi', col: '#5BD16E', dark: '#2C7A3A', mult: 1.30, maxLv: 20, subs: 1, glow: 0 },
      { id: 'nadir', n: 'Nadir', col: '#4BA3FF', dark: '#1F5DA8', mult: 1.70, maxLv: 30, subs: 2, glow: 0.3 },
      { id: 'destansi', n: 'Destansı', col: '#B565FF', dark: '#6A2BB0', mult: 2.25, maxLv: 40, subs: 3, glow: 0.6 },
      { id: 'efsanevi', n: 'Efsanevi', col: '#FFB020', dark: '#A8620A', mult: 3.00, maxLv: 50, subs: 3, glow: 0.85 },
      { id: 'mitik', n: 'Mitik', col: '#FF3D4F', dark: '#8E1324', mult: 4.00, maxLv: 60, subs: 4, glow: 1.0 }
    ],
    SLOTS: [
      { id: 'silah', n: 'Silah', poss: 'Silahı', group: 'silah', main: 'atk', base: 30, grow: 0.12 },
      { id: 'kafa', n: 'Miğfer', poss: 'Miğferi', group: 'zirh', main: 'hp', base: 90, grow: 0.10 },
      { id: 'yuz', n: 'Maske', poss: 'Maskesi', group: 'taki', main: 'crit', base: 0.015, grow: 0.04 },
      { id: 'boyun', n: 'Kolye', poss: 'Kolyesi', group: 'taki', main: 'atk', base: 12, grow: 0.12 },
      { id: 'omuz', n: 'Omuzluk', poss: 'Omuzluğu', group: 'zirh', main: 'def', base: 8, grow: 0.10 },
      { id: 'gogus', n: 'Göğüslük', poss: 'Göğüslüğü', group: 'zirh', main: 'hp', base: 140, grow: 0.10 },
      { id: 'kol', n: 'Kolluk', poss: 'Kolluğu', group: 'zirh', main: 'def', base: 6, grow: 0.10 },
      { id: 'eldiven', n: 'Eldiven', poss: 'Eldiveni', group: 'zirh', main: 'atk', base: 10, grow: 0.12 },
      { id: 'kemer', n: 'Kemer', poss: 'Kemeri', group: 'zirh', main: 'hp', base: 70, grow: 0.10 },
      { id: 'pantolon', n: 'Pantolon', poss: 'Pantolonu', group: 'zirh', main: 'hp', base: 100, grow: 0.10 },
      { id: 'dizlik', n: 'Dizlik', poss: 'Dizliği', group: 'zirh', main: 'def', base: 7, grow: 0.10 },
      { id: 'ayak', n: 'Çizme', poss: 'Çizmesi', group: 'zirh', main: 'spdPct', base: 0.03, grow: 0.03 }
    ],
    WEAPONS: { kilic: { id: 'kilic', n: 'Kılıç' }, yay: { id: 'yay', n: 'Yay' }, orak: { id: 'orak', n: 'Orak' }, asa: { id: 'asa', n: 'Asa' } },
    WEAPON_NAMES: {
      kilic: ['Paslı Kılıç', 'Demir Kılıç', 'Gece Kılıcı', 'Kor Kılıç', 'Ejder Dişi', 'Kıyamet'],
      yay: ['Budaklı Yay', 'Avcı Yayı', 'Baykuş Yayı', 'Kor Yay', 'Ejder Kanadı', 'Ay Tutulması'],
      orak: ['Kırık Orak', 'Demir Orak', 'Mezar Orağı', 'Kan Orağı', 'Ölüm Hasadı', 'Ecel'],
      asa: ['Budaklı Değnek', 'Çırak Asası', 'Fırtına Asası', 'Kor Asa', 'Yıldız Kalbi', 'Sonsuzluk']
    },
    SETS: {
      kurt: { id: 'kurt', n: 'Kurt Postu', bonus: { 4: { hpPct: 0.08 }, 8: { spdPct: 0.06 } } },
      gece: { id: 'gece', n: 'Gece Bekçisi', bonus: { 4: { defPct: 0.10 }, 8: { crit: 0.05 } } },
      kor: { id: 'kor', n: 'Kor Şövalye', bonus: { 4: { atkPct: 0.08 }, 8: { e_ates: 0.20 } } },
      ejder: { id: 'ejder', n: 'Ejder Pulu', bonus: { 4: { critDmg: 0.25 }, 8: { skillDmg: 0.15 } } },
      golge: { id: 'golge', n: 'Gölge Kralı', bonus: { 4: { lifesteal: 0.04 }, 8: { atkPct: 0.15 } } }
    },
    SET_BY_RARITY: [['kurt'], ['kurt', 'gece'], ['gece', 'kor'], ['kor', 'ejder'], ['ejder', 'golge'], ['golge']],
    SUBSTATS: [
      { k: 'atkPct', fmt: 'pct', min: [0.02, 0.03, 0.04, 0.05, 0.07, 0.09], max: [0.03, 0.05, 0.06, 0.08, 0.10, 0.13] },
      { k: 'hpPct', fmt: 'pct', min: [0.02, 0.03, 0.04, 0.05, 0.07, 0.09], max: [0.04, 0.05, 0.07, 0.09, 0.12, 0.15] },
      { k: 'defPct', fmt: 'pct', min: [0.02, 0.03, 0.05, 0.06, 0.08, 0.10], max: [0.04, 0.06, 0.08, 0.10, 0.13, 0.16] },
      { k: 'crit', fmt: 'pct', min: [0.005, 0.01, 0.015, 0.02, 0.025, 0.03], max: [0.01, 0.015, 0.02, 0.03, 0.04, 0.05] },
      { k: 'critDmg', fmt: 'pct', min: [0.03, 0.05, 0.07, 0.09, 0.12, 0.15], max: [0.05, 0.08, 0.11, 0.14, 0.18, 0.24] },
      { k: 'regen', fmt: 'flat', min: [0.3, 0.5, 0.8, 1.2, 1.8, 2.5], max: [0.6, 0.9, 1.3, 1.9, 2.7, 3.6] }
    ],
    STAT_KEYS: ['atk', 'hp', 'def', 'atkPct', 'hpPct', 'defPct', 'crit', 'critDmg', 'spdPct', 'cdr', 'lifesteal', 'regen',
      'pickup', 'xpGain', 'goldGain', 'area', 'projCount', 'pierce', 'dur', 'eliteDmg', 'bossDmg', 'skillDmg',
      'w_kilic', 'w_yay', 'w_orak', 'w_asa', 'e_ates', 'e_buz', 'e_yildirim', 'e_zehir', 'e_golge',
      'dodge', 'ultCharge', 'ultDmg', 'revive', 'startLvl', 'execute', 'thorns', 'shieldStart', 'killHeal'],
    HEROES: [
      { id: 'bora', n: 'Bora', cls: 'Savaşçı', rar: 2, weapon: 'kilic', unlock: { type: 'start' }, base: { atk: 24, hp: 420, def: 12, spd: 1.0 }, passive: { w_kilic: 0.30, hpPct: 0.15 }, ult: { id: 'kasirga', n: 'Kasırga' }, talents: [] },
      { id: 'ela', n: 'Ela', cls: 'Okçu', rar: 3, weapon: 'yay', unlock: { type: 'start' }, base: { atk: 26, hp: 340, def: 8, spd: 1.08 }, passive: { w_yay: 0.30, crit: 0.10 }, ult: { id: 'okYagmuru', n: 'Ok Yağmuru' }, talents: [] },
      { id: 'yaman', n: 'Yaman', cls: 'Sura', rar: 3, weapon: 'orak', unlock: { type: 'gems', cost: 500 }, base: { atk: 27, hp: 380, def: 10, spd: 1.02 }, passive: { w_orak: 0.30, lifesteal: 0.05 }, ult: { id: 'golgePatlama', n: 'Gölge Patlaması' }, talents: [] },
      { id: 'ayaz', n: 'Ayaz', cls: 'Şaman', rar: 3, weapon: 'asa', unlock: { type: 'gems', cost: 500 }, base: { atk: 25, hp: 360, def: 9, spd: 1.0 }, passive: { w_asa: 0.30, cdr: 0.10, regen: 2 }, ult: { id: 'firtina', n: 'Fırtına Ruhu' }, talents: [] },
      { id: 'alaz', n: 'Alaz', cls: 'Ejder Muhafızı', rar: 4, weapon: 'kilic', unlock: { type: 'gems', cost: 1500 }, base: { atk: 30, hp: 450, def: 14, spd: 1.0 }, passive: { e_ates: 0.40, atkPct: 0.10, skillDmg: 0.10 }, ult: { id: 'ejderNefesi', n: 'Ejder Nefesi' }, talents: [] }
    ],
    HERO_PROG: { maxLvByStar: [0, 20, 30, 40, 50, 60], goldBase: 120, goldGrow: 1.085, shardsByStar: [0, 10, 20, 40, 80, 0], lvlStatGrow: 0.04, starStatGrow: 0.10, pointsPerLevel: 1 },
    SKINS: [],
    TRAINING: [
      { id: 'atk', n: 'Saldırı Eğitimi', key: 'atk', per: 3, max: 200, costBase: 80, costGrow: 1.045 },
      { id: 'hp', n: 'Dayanım Eğitimi', key: 'hp', per: 30, max: 200, costBase: 80, costGrow: 1.045 },
      { id: 'def', n: 'Zırh Eğitimi', key: 'def', per: 2, max: 200, costBase: 80, costGrow: 1.045 },
      { id: 'crit', n: 'Odak Eğitimi', key: 'crit', per: 0.002, max: 100, costBase: 150, costGrow: 1.06 }
    ],
    ATTRS: [
      { id: 'dayaniklilik', n: 'Dayanıklılık', src: 'distance', factor: 0.01, base: 3, eff: { key: 'hpPct', per: 0.004 } },
      { id: 'guc', n: 'Güç', src: 'meleeKills', factor: 1, base: 5, eff: { key: 'w_kilic', per: 0.004 }, eff2: { key: 'w_orak', per: 0.004 } },
      { id: 'nisan', n: 'Nişancılık', src: 'rangedHits', factor: 0.25, base: 3, eff: { key: 'w_yay', per: 0.004 }, eff2: { key: 'w_asa', per: 0.004 } },
      { id: 'ceviklik', n: 'Çeviklik', src: 'nearMisses', factor: 3, base: 2, eff: { key: 'dodge', per: 0.0015 } },
      { id: 'buyu', n: 'Büyü Gücü', src: 'skillDamage', factor: 0.001, base: 5, eff: { key: 'skillDmg', per: 0.004 } },
      { id: 'hayatta', n: 'Hayatta Kalma', src: 'time', factor: 1, base: 3, eff: { key: 'regen', per: 0.03 } }
    ],
    CHAPTERS: [
      { id: 1, n: 'Kara Orman', dur: 240, energy: 5, reward: { gold: 400, gems: 50, heroXp: 120, chest: [60, 30, 9, 1, 0, 0], shards: 5 } },
      { id: 2, n: 'Lanetli Mezarlık', dur: 240, energy: 5, reward: { gold: 700, gems: 80, heroXp: 200, chest: [35, 40, 20, 4.5, 0.5, 0], shards: 8 } },
      { id: 3, n: 'Kor Dağı', dur: 240, energy: 5, reward: { gold: 1100, gems: 120, heroXp: 320, chest: [15, 35, 32, 14, 3.5, 0.5], shards: 12 } },
      { id: 4, n: 'Gölge Kalesi', dur: 240, energy: 5, locked: true, soon: 'Yakında', reward: { gold: 1600, gems: 200, heroXp: 480, chest: [5, 25, 38, 24, 7, 1], shards: 16 } }
    ],
    ECON: { startGold: 3000, startGems: 800, energyMax: 30, energyRegenSec: 300, runEnergy: 5,
      itemUp: { goldBase: 60, goldGrow: 1.09, scroll: function (lvl) { return 1 + Math.floor(lvl / 5); } },
      goldPerKill: 1, goldPerElite: 25, goldPerMetin: 60, goldPerBoss: 250, accXpPerRun: 40,
      accXpNeed: function (L) { return 100 + 60 * L; }, talentResetGems: 100 },
    STARTER: [
      { slot: 'silah', rar: 2, wt: 'kilic', lvl: 5, equip: true },
      { slot: 'kafa', rar: 1, set: 'kurt', lvl: 3, equip: true },
      { slot: 'gogus', rar: 1, set: 'gece', lvl: 3, equip: true },
      { slot: 'ayak', rar: 0, set: 'kurt', lvl: 3, equip: true },
      { slot: 'kafa', rar: 0, set: 'kurt', lvl: 1 }, { slot: 'kafa', rar: 0, set: 'kurt', lvl: 1 }, { slot: 'kafa', rar: 0, set: 'kurt', lvl: 1 }
    ]
  };

  function DK(k) { var d = GM.D; return d && d[k] != null ? d[k] : FB[k]; }

  /* ============================================================================================
   * Small utils
   * ========================================================================================== */
  function hasOwn(o, k) { return o != null && Object.prototype.hasOwnProperty.call(o, k); }
  function isNum(v) { return typeof v === 'number' && isFinite(v); }
  function num(v, d) { v = +v; return isFinite(v) ? v : (d == null ? 0 : d); }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function clampInt(v, a, b) { return clamp(Math.floor(num(v, a)), a, b); }
  function rnd(a, b) { return a + Math.random() * (b - a); }
  function rndInt(a, b) { return a + Math.floor(Math.random() * (b - a + 1)); }
  function pick(arr) { return arr && arr.length ? arr[Math.floor(Math.random() * arr.length)] : undefined; }
  function now() { return Date.now(); }
  function fmt(n, maxFrac) {
    n = num(n);
    try { return n.toLocaleString('tr-TR', { maximumFractionDigits: maxFrac == null ? 0 : maxFrac }); }
    catch (e) { return String(Math.round(n)); }
  }
  function addKey(dst, k, v) { if (!k || !isNum(v)) return; dst[k] = (dst[k] || 0) + v; }
  function addMods(dst, src, mult) {
    if (!src || typeof src !== 'object') return;
    var m = mult == null ? 1 : mult;
    for (var k in src) if (hasOwn(src, k) && isNum(src[k])) dst[k] = (dst[k] || 0) + src[k] * m;
  }
  function findById(arr, id) {
    if (!arr) return null;
    for (var i = 0; i < arr.length; i++) if (arr[i] && arr[i].id === id) return arr[i];
    return null;
  }

  /* ============================================================================================
   * Data accessors (robust to missing pieces)
   * ========================================================================================== */
  function rarities() { var R = DK('RARITIES'); return R && R.length ? R : FB.RARITIES; }
  function maxRar() { return rarities().length - 1; }
  function rarDef(r) { var R = rarities(); return R[clampInt(r, 0, R.length - 1)]; }
  function slots() { var S = DK('SLOTS'); return S && S.length ? S : FB.SLOTS; }
  function slotIds() { return slots().map(function (s) { return s.id; }); }
  function slotDef(id) { return findById(slots(), id); }
  function slotIndex(id) { var S = slots(); for (var i = 0; i < S.length; i++) if (S[i].id === id) return i; return 99; }
  function armorSlotIds() { return slotIds().filter(function (s) { return s !== 'silah'; }); }
  function weaponIds() { var W = DK('WEAPONS') || FB.WEAPONS; var a = Object.keys(W); return a.length ? a : ['kilic', 'yay', 'orak', 'asa']; }
  function validWt(wt) { var W = DK('WEAPONS') || FB.WEAPONS; return !!(wt && hasOwn(W, wt)); }
  function sets() { return DK('SETS') || FB.SETS; }
  function validSet(s) { return !!(s && hasOwn(sets(), s)); }
  function setsForRar(rar) {
    var SB = DK('SET_BY_RARITY') || FB.SET_BY_RARITY;
    var a = (SB && SB[clampInt(rar, 0, SB.length - 1)]) || [];
    a = a.filter(validSet);
    return a.length ? a : Object.keys(sets());
  }
  function substats() { var S = DK('SUBSTATS'); return S && S.length ? S : FB.SUBSTATS; }
  function subDef(k) { var S = substats(); for (var i = 0; i < S.length; i++) if (S[i].k === k) return S[i]; return null; }
  function statKeys() { var K = DK('STAT_KEYS'); return K && K.length ? K : FB.STAT_KEYS; }
  function heroDefs() { var H = DK('HEROES'); return H && H.length ? H : FB.HEROES; }
  function heroDef(id) { return findById(heroDefs(), id); }
  function heroProg() {
    var H = DK('HERO_PROG') || {}, F = FB.HERO_PROG;
    return {
      maxLvByStar: H.maxLvByStar && H.maxLvByStar.length ? H.maxLvByStar : F.maxLvByStar,
      goldBase: num(H.goldBase, F.goldBase), goldGrow: num(H.goldGrow, F.goldGrow),
      shardsByStar: H.shardsByStar && H.shardsByStar.length ? H.shardsByStar : F.shardsByStar,
      lvlStatGrow: num(H.lvlStatGrow, F.lvlStatGrow), starStatGrow: num(H.starStatGrow, F.starStatGrow),
      pointsPerLevel: num(H.pointsPerLevel, F.pointsPerLevel)
    };
  }
  function maxStar() { return heroProg().maxLvByStar.length - 1; }
  function skins() { return DK('SKINS') || []; }
  function skinDef(id) { return findById(skins(), id); }
  function trainings() { var T = DK('TRAINING'); return T && T.length ? T : FB.TRAINING; }
  function trainDef(id) { return findById(trainings(), id); }
  function attrDefs() { var A = DK('ATTRS'); return A && A.length ? A : FB.ATTRS; }
  function attrDef(id) { return findById(attrDefs(), id); }
  function attrMax() { return num(GM.D && GM.D.ATTR_MAX, ATTR_MAX_DEF) || ATTR_MAX_DEF; }
  function chapters() { var C = DK('CHAPTERS'); return C && C.length ? C : FB.CHAPTERS; }
  function chapterDef(id) { var C = chapters(); id = +id; for (var i = 0; i < C.length; i++) if (C[i].id === id) return C[i]; return null; }
  function econ() {
    var E = DK('ECON') || {}, F = FB.ECON, U = E.itemUp || {};
    return {
      startGold: num(E.startGold, F.startGold), startGems: num(E.startGems, F.startGems),
      energyMax: Math.max(1, num(E.energyMax, F.energyMax)), energyRegenSec: Math.max(1, num(E.energyRegenSec, F.energyRegenSec)),
      runEnergy: num(E.runEnergy, F.runEnergy), accXpPerRun: num(E.accXpPerRun, F.accXpPerRun),
      goldBase: num(U.goldBase, 60), goldGrow: num(U.goldGrow, 1.09),
      scroll: typeof U.scroll === 'function' ? U.scroll : F.itemUp.scroll,
      accXpNeed: typeof E.accXpNeed === 'function' ? E.accXpNeed : F.accXpNeed,
      talentResetGems: num(E.talentResetGems, 100)
    };
  }

  /* talent index per hero: nodeId -> { node, branch } (rebuilt if the hero def object changes) */
  var TCACHE = {};
  function talentIdx(heroId) {
    var def = heroDef(heroId);
    if (!def) return {};
    var c = TCACHE[heroId];
    if (c && c.def === def) return c.map;
    var map = {};
    (def.talents || []).forEach(function (b) {
      (b && b.nodes || []).forEach(function (nd) { if (nd && nd.id) map[nd.id] = { node: nd, branch: b }; });
    });
    TCACHE[heroId] = { def: def, map: map };
    return map;
  }

  /* ============================================================================================
   * Events + revision + debounced save
   * ========================================================================================== */
  var LST = {};
  var batchDepth = 0, queued = null, rev = 0, powerCache = {};
  var saveTimer = null;

  function on(evt, fn) {
    if (!evt || typeof fn !== 'function') return function () {};
    (LST[evt] || (LST[evt] = [])).push(fn);
    return function () { off(evt, fn); };
  }
  function off(evt, fn) {
    var a = LST[evt]; if (!a) return;
    var i = a.indexOf(fn); if (i >= 0) a.splice(i, 1);
  }
  function callAll(list, a, b) {
    if (!list || !list.length) return;
    list = list.slice();
    for (var i = 0; i < list.length; i++) {
      try { list[i](a, b); } catch (e) { console.error('[GM.S] listener failed:', e); }
    }
  }
  function emit(evt, data) {
    callAll(LST[evt], data, evt);
    callAll(LST['*'], evt, data);
  }
  /* record a mutation: bump revision, queue events, flush unless batching */
  function mut(evts, data) {
    rev++; powerCache = {};
    if (typeof evts === 'string') evts = [evts];
    if (!queued) queued = { list: [], data: {} };
    for (var i = 0; i < evts.length; i++) {
      if (queued.list.indexOf(evts[i]) < 0) queued.list.push(evts[i]);
      queued.data[evts[i]] = data;
    }
    if (batchDepth === 0) flush();
  }
  function flush() {
    var q = queued; queued = null;
    if (!q) return;
    scheduleSave();
    for (var i = 0; i < q.list.length; i++) emit(q.list[i], q.data[q.list[i]]);
    emit('change', { what: q.list.slice() });
  }
  function batch(fn) {
    batchDepth++;
    try { return fn(); }
    finally { batchDepth--; if (batchDepth === 0) flush(); }
  }

  function storage() {
    try {
      if (typeof window !== 'undefined' && window && window.localStorage) return window.localStorage;
    } catch (e) { /* SecurityError (blocked storage) */ }
    try { if (typeof localStorage !== 'undefined' && localStorage) return localStorage; } catch (e2) { /* ignore */ }
    return null;
  }
  function save() {
    if (saveTimer) { try { clearTimeout(saveTimer); } catch (e) { /* ignore */ } saveTimer = null; }
    if (!prof) return false;
    powerCache = {};
    try {
      var ls = storage(); if (!ls) return false;
      ls.setItem(KEY, JSON.stringify(prof));
      return true;
    } catch (e) { return false; }
  }
  function scheduleSave() {
    if (saveTimer) { try { clearTimeout(saveTimer); } catch (e) { /* ignore */ } }
    try { saveTimer = setTimeout(function () { saveTimer = null; save(); }, 300); }
    catch (e) { saveTimer = null; save(); }
  }

  /* ============================================================================================
   * Profile: fresh / load / reset / sanitize
   * ========================================================================================== */
  var S = {};
  var prof = null;   // the live profile; exposed as GM.S.p (lazy: reading it before load() loads it)
  Object.defineProperty(S, 'p', {
    enumerable: true, configurable: true,
    get: function () { return P(); },
    set: function (v) { prof = v && typeof v === 'object' ? v : null; IDX = null; powerCache = {}; rev++; }
  });
  function P() { if (!prof) load(); return prof; }

  function freshTotals() {
    return { runs: 0, kills: 0, bosses: 0, playSec: 0, wins: 0, elites: 0, metins: 0, chests: 0,
      distance: 0, meleeKills: 0, rangedHits: 0, nearMisses: 0, skillDamage: 0, damageTaken: 0,
      goldEarned: 0, itemsFound: 0, bestRunLevel: 0 };
  }
  function freshProfile() {
    var E = econ(), t = now();
    var p = {
      v: VERSION, name: 'Muhafız', accLvl: 1, accXp: 0, gold: E.startGold, gems: E.startGems,
      energy: E.energyMax, energyTs: t, seq: 1,
      items: [], equip: {}, scrolls: { silah: STARTER_SCROLLS.silah, zirh: STARTER_SCROLLS.zirh, taki: STARTER_SCROLLS.taki },
      shards: {}, heroes: {}, active: null, train: {}, attrs: {},
      skins: { owned: [], sel: {} }, chapters: { max: 1, best: {} },
      totals: freshTotals(), settings: { sound: true, music: true }, created: t
    };
    slotIds().forEach(function (s) { p.equip[s] = null; });
    heroDefs().forEach(function (h) {
      p.shards[h.id] = 0;
      p.heroes[h.id] = { id: h.id, owned: !!(h.unlock && h.unlock.type === 'start'), lvl: 1, stars: 1, talents: {}, skin: null };
    });
    p.active = firstOwned(p);
    trainings().forEach(function (tr) { p.train[tr.id] = 0; });
    attrDefs().forEach(function (a) { p.attrs[a.id] = { lvl: 0, xp: 0 }; });
    skins().forEach(function (sk) { if (sk.cost && sk.cost.type === 'start') p.skins.owned.push(sk.id); });
    return p;
  }
  function firstOwned(p) {
    if (p.heroes.bora && p.heroes.bora.owned) return 'bora';
    var H = heroDefs();
    for (var i = 0; i < H.length; i++) if (p.heroes[H[i].id] && p.heroes[H[i].id].owned) return H[i].id;
    if (H[0]) { if (p.heroes[H[0].id]) p.heroes[H[0].id].owned = true; return H[0].id; }
    return 'bora';
  }
  function giveStarter(p) {
    (DK('STARTER') || []).forEach(function (seed) {
      if (!seed) return;
      var it = makeItemFor(p, seed);
      it.new = !seed.equip;
      p.items.push(it);
      if (seed.equip && p.equip[it.slot] == null) p.equip[it.slot] = it.uid;
    });
  }

  function newUid(p, taken) {
    var u, guard = 0;
    do {
      p.seq = Math.max(1, Math.floor(num(p.seq, 1))) + 1;
      u = 'i' + p.seq.toString(36) + Math.floor(Math.random() * 1296).toString(36);
    } while (((taken && taken[u]) || (p === prof && findItem(u))) && guard++ < 50);
    return u;
  }

  function cleanSubs(arr) {
    var out = [], seen = {};
    (Array.isArray(arr) ? arr : []).forEach(function (s) {
      if (!s || typeof s.k !== 'string' || !isNum(+s.v) || seen[s.k]) return;
      seen[s.k] = 1; out.push({ k: s.k, v: +s.v });
    });
    return out;
  }
  function cleanItem(raw, p) {
    if (!raw || typeof raw !== 'object' || !slotDef(raw.slot)) return null;
    var rar = clampInt(raw.rar, 0, maxRar());
    var it = { uid: typeof raw.uid === 'string' && raw.uid ? raw.uid : newUid(p), slot: raw.slot, rar: rar,
      lvl: clampInt(raw.lvl || 1, 1, rarDef(rar).maxLv) };
    if (raw.slot === 'silah') it.wt = validWt(raw.wt) ? raw.wt : weaponIds()[0];
    else it.set = validSet(raw.set) ? raw.set : setsForRar(rar)[0];
    it.subs = cleanSubs(raw.subs);
    it.new = !!raw.new;
    if (isNum(raw.t)) it.t = raw.t;
    return it;
  }

  function sanitize(d) {
    var p = freshProfile(), t = now(), H = heroProg(), ms = maxStar();
    // keep unknown top-level fields other modules may have stored (flags, tutorial…)
    for (var k in d) if (hasOwn(d, k) && !hasOwn(p, k)) p[k] = d[k];
    p.name = typeof d.name === 'string' && d.name.trim() ? d.name.slice(0, 24) : p.name;
    p.accLvl = clampInt(d.accLvl || 1, 1, 9999);
    p.accXp = Math.max(0, num(d.accXp));
    p.gold = Math.max(0, Math.floor(num(d.gold, p.gold)));
    p.gems = Math.max(0, Math.floor(num(d.gems, p.gems)));
    p.energy = Math.max(0, Math.floor(num(d.energy, p.energy)));
    p.energyTs = num(d.energyTs, t); if (p.energyTs > t) p.energyTs = t;
    p.seq = Math.max(1, Math.floor(num(d.seq, 1)));
    if (isNum(d.created)) p.created = d.created;

    var byUid = {};
    (Array.isArray(d.items) ? d.items : []).forEach(function (raw) {
      var it = cleanItem(raw, p); if (!it) return;
      if (byUid[it.uid]) it.uid = newUid(p, byUid);
      byUid[it.uid] = it; p.items.push(it);
    });
    slotIds().forEach(function (s) {
      var u = d.equip && d.equip[s], it = u && byUid[u];
      p.equip[s] = it && it.slot === s ? u : null;
    });
    if (d.scrolls && typeof d.scrolls === 'object') SCROLL_GROUPS.forEach(function (g) { p.scrolls[g] = Math.max(0, Math.floor(num(d.scrolls[g]))); });

    heroDefs().forEach(function (h) {
      var src = (d.heroes && d.heroes[h.id]) || {}, hs = p.heroes[h.id];
      p.shards[h.id] = Math.max(0, Math.floor(num(d.shards && d.shards[h.id])));
      hs.owned = hs.owned || !!src.owned;
      hs.stars = clampInt(src.stars || 1, 1, ms);
      hs.lvl = clampInt(src.lvl || 1, 1, Math.max(1, num(H.maxLvByStar[hs.stars], 1)));
      var ti = talentIdx(h.id), used = 0;
      if (src.talents && typeof src.talents === 'object') {
        for (var nid in src.talents) {
          if (!hasOwn(src.talents, nid) || !ti[nid]) continue;
          var r = clampInt(src.talents[nid], 0, num(ti[nid].node.max, 1));
          if (r > 0) { hs.talents[nid] = r; used += r; }
        }
      }
      if (used > hs.lvl * H.pointsPerLevel) hs.talents = {};   // data changed: refund everything
      for (var hk in src) if (hasOwn(src, hk) && !hasOwn(hs, hk)) hs[hk] = src[hk];
    });
    p.active = d.active && p.heroes[d.active] && p.heroes[d.active].owned ? d.active : firstOwned(p);

    trainings().forEach(function (tr) { p.train[tr.id] = clampInt(d.train && d.train[tr.id], 0, num(tr.max, 200)); });
    var AM = attrMax();
    attrDefs().forEach(function (a) {
      var src = (d.attrs && d.attrs[a.id]) || {}, st = p.attrs[a.id];
      st.lvl = clampInt(src.lvl, 0, AM); st.xp = Math.max(0, num(src.xp));
      while (st.lvl < AM && st.xp >= attrNeed(a.id, st.lvl)) { st.xp -= attrNeed(a.id, st.lvl); st.lvl++; }
      if (st.lvl >= AM) st.xp = 0;
    });

    var owned = p.skins.owned.slice();
    (d.skins && Array.isArray(d.skins.owned) ? d.skins.owned : []).forEach(function (id) { if (skinDef(id) && owned.indexOf(id) < 0) owned.push(id); });
    p.skins.owned = owned;
    var sel = d.skins && d.skins.sel;
    if (sel && typeof sel === 'object') for (var tg in sel) {
      if (!hasOwn(sel, tg)) continue;
      var sk = skinDef(sel[tg]);
      if (sk && sk.target === tg && owned.indexOf(sk.id) >= 0) p.skins.sel[tg] = sk.id;
    }
    heroDefs().forEach(function (h) { p.heroes[h.id].skin = p.skins.sel['hero:' + h.id] || null; });

    var C = chapters();
    p.chapters.max = clampInt(d.chapters && d.chapters.max || 1, 1, Math.max(1, C.length ? C[C.length - 1].id : 1));
    var best = d.chapters && d.chapters.best;
    if (best && typeof best === 'object') for (var cid in best) {
      if (!hasOwn(best, cid) || !chapterDef(cid) || !best[cid]) continue;
      var b = best[cid], nb = { time: Math.max(0, num(b.time)), cleared: !!b.cleared, kills: Math.max(0, num(b.kills)) };
      if (isNum(b.fastest)) nb.fastest = b.fastest;
      if (isNum(b.clears)) nb.clears = b.clears;
      p.chapters.best[cid] = nb;
    }
    if (d.totals && typeof d.totals === 'object') for (var tk in p.totals) p.totals[tk] = Math.max(0, num(d.totals[tk]));
    if (d.settings && typeof d.settings === 'object') {
      for (var sk2 in d.settings) if (hasOwn(d.settings, sk2)) p.settings[sk2] = d.settings[sk2];
      p.settings.sound = d.settings.sound !== false;
      p.settings.music = d.settings.music !== false;
    }
    return p;
  }

  function load() {
    if (saveTimer && prof) save();   // never lose a pending debounced write
    var data = null;
    try {
      var ls = storage(), raw = ls ? ls.getItem(KEY) : null;
      if (raw) data = JSON.parse(raw);
    } catch (e) { data = null; }
    if (data && typeof data === 'object' && data.v) {
      try {
        prof = sanitize(data);
        reindex(); regen();
        mut(EVENTS.slice(), { load: true });
        return prof;
      } catch (e2) { console.error('[GM.S] corrupt save, starting fresh:', e2); }
    }
    return reset();
  }
  function reset() {
    var p = freshProfile();
    giveStarter(p);
    prof = p;
    curRun = null;
    reindex();
    mut(EVENTS.slice(), { reset: true });
    save();
    return prof;
  }

  /* ============================================================================================
   * Currencies + energy
   * ========================================================================================== */
  function addGold(n) { var p = P(); n = Math.floor(num(n)); if (n <= 0) return p.gold; p.gold += n; mut('gold', { delta: n }); return p.gold; }
  function spendGold(n) {
    var p = P(); n = Math.max(0, Math.ceil(num(n)));
    if (p.gold < n) return false;
    if (n > 0) { p.gold -= n; mut('gold', { delta: -n }); }
    return true;
  }
  function addGems(n) { var p = P(); n = Math.floor(num(n)); if (n <= 0) return p.gems; p.gems += n; mut('gems', { delta: n }); return p.gems; }
  function spendGems(n) {
    var p = P(); n = Math.max(0, Math.ceil(num(n)));
    if (p.gems < n) return false;
    if (n > 0) { p.gems -= n; mut('gems', { delta: -n }); }
    return true;
  }

  /* apply time-based energy regeneration; returns energy gained (no events) */
  function regen() {
    var p = prof; if (!p) return 0;
    var E = econ(), max = E.energyMax, per = E.energyRegenSec * 1000, t = now();
    if (!isNum(p.energyTs) || p.energyTs > t) p.energyTs = t;
    if (!isNum(p.energy)) p.energy = max;
    if (p.energy >= max) return 0;            // full: the timer restarts when energy is spent (spendEnergy)
    var n = Math.floor((t - p.energyTs) / per);
    if (n <= 0) return 0;
    var add = Math.min(n, max - p.energy);
    p.energy += add;
    p.energyTs = p.energy >= max ? t : p.energyTs + n * per;
    return add;
  }
  function getEnergy() {
    var p = P(), E = econ();
    var add = regen();
    if (add > 0) mut('energy', { delta: add, regen: true });
    var full = p.energy >= E.energyMax;
    var next = full ? 0 : Math.max(0, Math.ceil((E.energyRegenSec * 1000 - (now() - p.energyTs)) / 1000));
    return { cur: p.energy, max: E.energyMax, nextInSec: next, full: full, regenSec: E.energyRegenSec };
  }
  function spendEnergy(n) {
    var p = P(), E = econ(); n = Math.max(0, Math.ceil(num(n)));
    regen();
    if (p.energy < n) return false;
    if (p.energy >= E.energyMax) p.energyTs = now();
    p.energy -= n;
    mut('energy', { delta: -n });
    return true;
  }
  function addEnergy(n) { var p = P(); n = Math.floor(num(n)); if (n <= 0) return p.energy; regen(); p.energy += n; mut('energy', { delta: n }); return p.energy; }

  /* ============================================================================================
   * Items
   * ========================================================================================== */
  var IDX = null, idxArr = null, idxLen = -1;
  function reindex() {
    IDX = {}; idxArr = prof ? prof.items : null; idxLen = idxArr ? idxArr.length : 0;
    if (idxArr) for (var i = 0; i < idxArr.length; i++) if (idxArr[i]) IDX[idxArr[i].uid] = idxArr[i];
  }
  function findItem(uid) {
    var p = prof; if (!p || !uid) return null;
    if (!IDX || idxArr !== p.items || idxLen !== p.items.length) reindex();
    var it = IDX[uid];
    if (it && it.uid === uid) return it;
    for (var i = 0; i < p.items.length; i++) if (p.items[i] && p.items[i].uid === uid) { reindex(); return p.items[i]; }
    return null;
  }
  function getItem(uid) { P(); return findItem(uid); }
  function asItem(x) {
    if (!x) return null;
    if (typeof x === 'string') return getItem(x);
    return typeof x === 'object' && slotDef(x.slot) ? x : null;
  }

  function itemName(x) {
    var it = asItem(x); if (!it) return '';
    var r = clampInt(it.rar, 0, maxRar()), sd = slotDef(it.slot);
    if (it.slot === 'silah') {
      if (GM.D && typeof GM.D.weaponName === 'function') { try { var wn = GM.D.weaponName(it.wt, r); if (wn) return wn; } catch (e) { /* fall through */ } }
      var WN = DK('WEAPON_NAMES') || FB.WEAPON_NAMES, row = WN[it.wt];
      if (row && row[r]) return row[r];
      var W = DK('WEAPONS') || FB.WEAPONS;
      return (W[it.wt] && W[it.wt].n) || (sd ? sd.n : 'Silah');
    }
    var st = sets()[it.set];
    return st ? st.n + ' ' + (sd ? sd.poss : '') : (sd ? sd.n : 'Eşya');
  }
  /* SPEC §2.3: main = base * RARITIES[rar].mult * (1 + grow * (lvl - 1)) */
  function itemMain(x) {
    var it = asItem(x), sd = it && slotDef(it.slot);
    if (!sd) return { k: 'atk', v: 0 };
    var lvl = Math.max(1, num(it.lvl, 1));
    return { k: sd.main, v: num(sd.base) * num(rarDef(it.rar).mult, 1) * (1 + num(sd.grow) * (lvl - 1)) };
  }
  function itemSubs(x) {
    var it = asItem(x); if (!it || !Array.isArray(it.subs)) return [];
    return it.subs.map(function (s) { return { k: s.k, v: s.v }; });
  }

  function roundSub(k, v) {
    var d = subDef(k), lab = GM.D && GM.D.STAT_LABELS && GM.D.STAT_LABELS[k];
    var f = (d && d.fmt) || (lab && lab.fmt) || 'pct';
    return f === 'pct' ? Math.round(v * 10000) / 10000 : Math.round(v * 10) / 10;
  }
  /* add rolled substats (distinct keys, not the main stat key) until the rarity's count is reached */
  function fillSubs(it) {
    if (!Array.isArray(it.subs)) it.subs = [];
    var rar = clampInt(it.rar, 0, maxRar()), need = num(rarDef(rar).subs);
    var sd = slotDef(it.slot), mainK = sd ? sd.main : null;
    var have = {}; it.subs.forEach(function (s) { have[s.k] = 1; });
    var pool = substats().filter(function (s) { return s && s.k && !have[s.k] && s.k !== mainK && s.min && s.max; });
    var added = [];
    while (it.subs.length < need && pool.length) {
      var i = Math.floor(Math.random() * pool.length), s = pool.splice(i, 1)[0];
      var lo = num(s.min[rar], num(s.min[s.min.length - 1])), hi = num(s.max[rar], num(s.max[s.max.length - 1], lo));
      var sub = { k: s.k, v: roundSub(s.k, rnd(Math.min(lo, hi), Math.max(lo, hi))) };
      it.subs.push(sub); added.push(sub);
    }
    return added;
  }
  function makeItemFor(p, seed) {
    seed = seed || {};
    var slot = slotDef(seed.slot) ? seed.slot : pick(slotIds());
    var rar = clampInt(seed.rar, 0, maxRar());
    var it = { uid: newUid(p), slot: slot, rar: rar, lvl: clampInt(seed.lvl || 1, 1, rarDef(rar).maxLv) };
    if (slot === 'silah') it.wt = validWt(seed.wt) ? seed.wt : pick(weaponIds());
    else it.set = validSet(seed.set) ? seed.set : pick(setsForRar(rar));
    it.subs = Array.isArray(seed.subs) ? cleanSubs(seed.subs) : [];
    fillSubs(it);
    it.new = seed.new !== false;
    it.t = now();
    return it;
  }
  function makeItem(seed) { return makeItemFor(P(), seed); }
  function addItem(x) {
    var p = P(), it;
    if (x && typeof x === 'object' && p.items.indexOf(x) >= 0) return x;
    if (x && typeof x === 'object' && slotDef(x.slot) && x.uid && x.lvl) {
      it = x;
      if (findItem(it.uid)) it.uid = newUid(p);
      if (!Array.isArray(it.subs)) it.subs = [];
    } else it = makeItemFor(p, x);
    p.items.push(it);
    mut('item', { add: it.uid });
    return it;
  }
  function removeItem(uid) {
    var p = P(), it = findItem(uid); if (!it) return false;
    var evts = ['item'];
    if (p.equip[it.slot] === uid) { p.equip[it.slot] = null; evts.push('equip'); }
    p.items.splice(p.items.indexOf(it), 1);
    reindex();
    mut(evts, { remove: uid });
    return true;
  }
  function isEquipped(x) { var p = P(), it = asItem(x); return !!(it && p.equip[it.slot] === it.uid); }
  function bag() {
    var p = P();
    return p.items.filter(function (it) { return it && p.equip[it.slot] !== it.uid; }).sort(function (a, b) {
      return (b.rar - a.rar) || (slotIndex(a.slot) - slotIndex(b.slot)) || (b.lvl - a.lvl) ||
        String(a.wt || a.set || '').localeCompare(String(b.wt || b.set || '')) || (a.uid < b.uid ? -1 : a.uid > b.uid ? 1 : 0);
    });
  }
  function markSeen(uid) {
    var p = P(), n = 0;
    p.items.forEach(function (it) { if (it.new && (uid === 'all' || uid == null || it.uid === uid)) { it.new = false; n++; } });
    if (n) mut('item', { seen: uid || 'all' });
    return n;
  }
  function newCount() { var p = P(), n = 0; p.items.forEach(function (it) { if (it.new && p.equip[it.slot] !== it.uid) n++; }); return n; }

  /* equipment */
  function equip(uid) {
    var p = P(), it = findItem(uid); if (!it) return false;
    var prev = p.equip[it.slot] || null;
    if (prev === it.uid) return true;
    p.equip[it.slot] = it.uid;
    it.new = false;
    mut(['equip', 'item'], { slot: it.slot, uid: it.uid, prev: prev });
    return true;
  }
  function unequip(slotId) {
    var p = P(); if (!slotDef(slotId) || !p.equip[slotId]) return false;
    var prev = p.equip[slotId];
    p.equip[slotId] = null;
    mut('equip', { slot: slotId, uid: null, prev: prev });
    return true;
  }
  function equipped(slotId) {
    var p = P(), u = p.equip[slotId]; if (!u) return null;
    var it = findItem(u);
    if (!it || it.slot !== slotId) { p.equip[slotId] = null; return null; }
    return it;
  }

  /* upgrades — gold = round(goldBase * goldGrow^(lvl-1)), scrolls = ECON.itemUp.scroll(lvl) of the slot group */
  function upgradeCost(x) {
    var it = asItem(x), E = econ();
    if (!it) return { gold: 0, scroll: 0, scrollType: 'zirh' };
    var sd = slotDef(it.slot), lvl = Math.max(1, num(it.lvl, 1));
    var sc = 1; try { sc = Math.max(0, Math.round(num(E.scroll(lvl), 1))); } catch (e) { sc = 1 + Math.floor(lvl / 5); }
    return { gold: Math.round(E.goldBase * Math.pow(E.goldGrow, lvl - 1)), scroll: sc, scrollType: sd ? sd.group : 'zirh',
      maxed: lvl >= rarDef(it.rar).maxLv };
  }
  function scrollName(g) {
    var SG = GM.D && GM.D.SCROLL_GROUPS;
    return (SG && SG[g] && SG[g].n) || ({ silah: 'Silah Parşömeni', zirh: 'Zırh Parşömeni', taki: 'Takı Parşömeni' })[g] || 'Parşömen';
  }
  function canUpgrade(x) {
    var p = P(), it = asItem(x);
    if (!it) return { ok: false, reason: 'Eşya bulunamadı', code: 'none' };
    var c = upgradeCost(it);
    if (c.maxed) return { ok: false, reason: 'En yüksek seviyede', code: 'max', cost: c };
    if (p.gold < c.gold) return { ok: false, reason: 'Yetersiz altın', code: 'gold', cost: c };
    if (num(p.scrolls[c.scrollType]) < c.scroll) return { ok: false, reason: 'Yetersiz ' + scrollName(c.scrollType), code: 'scroll', cost: c };
    return { ok: true, reason: '', code: 'ok', cost: c };
  }
  function upgradeItem(uid) {
    var p = P(), it = asItem(uid); if (!it || !findItem(it.uid)) return false;
    var chk = canUpgrade(it); if (!chk.ok) return false;
    var c = chk.cost;
    p.gold -= c.gold;
    p.scrolls[c.scrollType] = num(p.scrolls[c.scrollType]) - c.scroll;
    it.lvl++;
    it.new = false;
    mut(['item', 'gold'], { uid: it.uid, lvl: it.lvl, cost: c });
    return true;
  }

  /* merge (SPEC §3.2) */
  function mergeKey(it) { return it.slot + '|' + it.rar + '|' + (it.slot === 'silah' ? it.wt : ''); }
  function mergeCandidates(uid) {
    var p = P(), base = findItem(uid);
    if (!base || base.rar >= maxRar()) return [];
    var key = mergeKey(base);
    return p.items.filter(function (it) {
      return it.uid !== base.uid && p.equip[it.slot] !== it.uid && mergeKey(it) === key;
    }).sort(function (a, b) { return (a.lvl - b.lvl) || (a.subs.length - b.subs.length); }).map(function (it) { return it.uid; });
  }
  /* groups of 3 identical bag items that could be merged right now (for "merge all" / badges) */
  function mergeGroups() {
    var p = P(), g = {}, out = [];
    bag().forEach(function (it) { if (it.rar < maxRar()) (g[mergeKey(it)] || (g[mergeKey(it)] = [])).push(it); });
    for (var k in g) {
      var a = g[k].sort(function (x, y) { return y.lvl - x.lvl; });
      for (var i = 0; i + 2 < a.length; i += 3) out.push([a[i].uid, a[i + 1].uid, a[i + 2].uid]);
    }
    return out;
  }
  function merge(uids) {
    var p = P();
    if (!Array.isArray(uids) || uids.length !== 3) return null;
    if (uids[0] === uids[1] || uids[0] === uids[2] || uids[1] === uids[2]) return null;
    var its = uids.map(findItem);
    if (!its[0] || !its[1] || !its[2]) return null;
    // all three share a slot, so at most one is equipped: that one must survive → it becomes the base
    for (var e = 1; e < 3; e++) if (p.equip[its[e].slot] === its[e].uid) { var tmp = its[0]; its[0] = its[e]; its[e] = tmp; }
    var base = its[0], key = mergeKey(base);
    if (base.rar >= maxRar()) return null;
    for (var i = 1; i < 3; i++) {
      if (mergeKey(its[i]) !== key) return null;
      if (p.equip[its[i].slot] === its[i].uid) return null;   // materials must be in the bag
    }
    var newRar = base.rar + 1;
    base.rar = newRar;
    base.lvl = clamp(Math.max(base.lvl, its[1].lvl, its[2].lvl), 1, rarDef(newRar).maxLv);
    var added = fillSubs(base);
    base.new = true;
    base.t = now();
    p.items.splice(p.items.indexOf(its[1]), 1);
    p.items.splice(p.items.indexOf(its[2]), 1);
    reindex();
    var evts = ['item']; if (p.equip[base.slot] === base.uid) evts.push('equip');
    mut(evts, { merged: base.uid, consumed: [its[1].uid, its[2].uid], newSubs: added });
    return base;
  }
  function sellValue(x) { var it = asItem(x); return it ? 20 * (it.rar + 1) * Math.max(1, it.lvl) : 0; }
  function sell(uid) {
    var p = P(), it = findItem(uid);
    if (!it || p.equip[it.slot] === it.uid) return 0;
    var g = sellValue(it);
    p.items.splice(p.items.indexOf(it), 1);
    reindex();
    p.gold += g;
    mut(['item', 'gold'], { sold: uid, delta: g });
    return g;
  }

  /* ============================================================================================
   * Heroes
   * ========================================================================================== */
  function hero(id) { var p = P(); return p.heroes[id == null ? p.active : id] || null; }
  function ownedHeroes() { var p = P(); return heroDefs().filter(function (h) { return p.heroes[h.id] && p.heroes[h.id].owned; }).map(function (h) { return h.id; }); }
  function setActive(id) {
    var p = P(), hs = p.heroes[id]; if (!hs || !hs.owned) return false;
    if (p.active === id) return true;
    p.active = id;
    mut('hero', { active: id });
    return true;
  }
  function heroUnlockCost(id) { var d = heroDef(id); return d && d.unlock && d.unlock.type === 'gems' ? num(d.unlock.cost) : 0; }
  function unlockHero(id) {
    var p = P(), d = heroDef(id), hs = p.heroes[id];
    if (!d || !hs) return false;
    if (hs.owned) return false;
    if (!d.unlock || d.unlock.type !== 'gems') return false;
    var cost = heroUnlockCost(id);
    if (p.gems < cost) return false;
    p.gems -= cost;
    hs.owned = true;
    mut(['hero', 'gems'], { unlocked: id, delta: -cost });
    return true;
  }
  function heroMaxLv(id) { var hs = hero(id), H = heroProg(); return hs ? Math.max(1, num(H.maxLvByStar[clampInt(hs.stars, 1, maxStar())], 1)) : 1; }
  function heroLevelCost(id) { var hs = hero(id), H = heroProg(); return hs ? Math.round(H.goldBase * Math.pow(H.goldGrow, hs.lvl - 1)) : 0; }
  function canLevelHero(id) {
    var p = P(), hs = hero(id);
    if (!hs) return { ok: false, reason: 'Kahraman bulunamadı', code: 'none' };
    if (!hs.owned) return { ok: false, reason: 'Kahraman kilitli', code: 'locked' };
    if (hs.lvl >= heroMaxLv(id)) {
      return hs.stars >= maxStar() ? { ok: false, reason: 'En yüksek seviyede', code: 'max' }
        : { ok: false, reason: 'Seviye sınırı: yıldız yükselt', code: 'cap' };
    }
    var c = heroLevelCost(id);
    if (p.gold < c) return { ok: false, reason: 'Yetersiz altın', code: 'gold', cost: c };
    return { ok: true, reason: '', code: 'ok', cost: c };
  }
  function levelUpHero(id) {
    var p = P(); id = id == null ? p.active : id;
    var chk = canLevelHero(id); if (!chk.ok) return false;
    p.gold -= chk.cost;
    p.heroes[id].lvl++;
    mut(['hero', 'gold'], { id: id, lvl: p.heroes[id].lvl, delta: -chk.cost });
    return true;
  }
  function starCost(id) { var hs = hero(id), H = heroProg(); return hs && hs.stars < maxStar() ? Math.max(0, num(H.shardsByStar[hs.stars])) : 0; }
  function canStarUp(id) {
    var p = P(), hs = hero(id);
    if (!hs) return { ok: false, reason: 'Kahraman bulunamadı', code: 'none' };
    if (!hs.owned) return { ok: false, reason: 'Kahraman kilitli', code: 'locked' };
    if (hs.stars >= maxStar()) return { ok: false, reason: 'En yüksek yıldızda', code: 'max' };
    var c = starCost(id);
    if (num(p.shards[hs.id]) < c) return { ok: false, reason: 'Yetersiz kahraman parçası', code: 'shards', cost: c };
    return { ok: true, reason: '', code: 'ok', cost: c };
  }
  function starUpHero(id) {
    var p = P(); id = id == null ? p.active : id;
    var chk = canStarUp(id); if (!chk.ok) return false;
    p.shards[id] = num(p.shards[id]) - chk.cost;
    p.heroes[id].stars++;
    mut('hero', { id: id, stars: p.heroes[id].stars, delta: -chk.cost });
    return true;
  }

  /* ============================================================================================
   * Talents (RoK-style). total points = lvl * pointsPerLevel; a node needs every req node at ≥1 rank
   * and the branch must already hold ≥ row*3 points.
   * ========================================================================================== */
  function talentPoints(id) {
    var hs = hero(id), H = heroProg();
    if (!hs) return { total: 0, used: 0, free: 0 };
    var total = Math.floor(hs.lvl * H.pointsPerLevel), used = 0, ti = talentIdx(hs.id);
    for (var k in hs.talents) if (hasOwn(hs.talents, k) && ti[k]) used += num(hs.talents[k]);
    return { total: total, used: used, free: Math.max(0, total - used) };
  }
  function talentRank(id, nodeId) { var hs = hero(id); return hs ? num(hs.talents[nodeId]) : 0; }
  function branchSpent(id, branchId) {
    var hs = hero(id), d = heroDef(hs ? hs.id : id);
    if (!hs || !d) return 0;
    var b = findById(d.talents || [], branchId); if (!b) return 0;
    var s = 0; (b.nodes || []).forEach(function (nd) { s += num(hs.talents[nd.id]); });
    return s;
  }
  function canRank(id, nodeId) {
    var hs = hero(id);
    if (!hs) return { ok: false, reason: 'Kahraman bulunamadı', code: 'none' };
    var e = talentIdx(hs.id)[nodeId];
    if (!e) return { ok: false, reason: 'Geçersiz yetenek', code: 'none' };
    if (!hs.owned) return { ok: false, reason: 'Kahraman kilitli', code: 'locked' };
    var nd = e.node, r = num(hs.talents[nodeId]), max = num(nd.max, 1);
    if (r >= max) return { ok: false, reason: 'En yüksek seviyede', code: 'max' };
    var req = nd.req || [], ti = talentIdx(hs.id);
    for (var i = 0; i < req.length; i++) {
      if (num(hs.talents[req[i]]) < 1) {
        var rn = ti[req[i]] ? ti[req[i]].node.n : req[i];
        return { ok: false, reason: 'Önce “' + rn + '” açılmalı', code: 'req', need: req[i] };
      }
    }
    var needPts = num(nd.row) * 3, spent = branchSpent(hs.id, e.branch.id);
    if (spent < needPts) return { ok: false, reason: 'Bu dalda en az ' + needPts + ' puan harcanmalı (' + spent + '/' + needPts + ')', code: 'row', need: needPts };
    if (talentPoints(hs.id).free < 1) return { ok: false, reason: 'Yetenek puanı yok', code: 'points' };
    return { ok: true, reason: '', code: 'ok' };
  }
  function rankTalent(id, nodeId) {
    var hs = hero(id); if (!hs) return false;
    if (!canRank(hs.id, nodeId).ok) return false;
    hs.talents[nodeId] = num(hs.talents[nodeId]) + 1;
    mut('talent', { id: hs.id, node: nodeId, rank: hs.talents[nodeId] });
    return true;
  }
  function resetTalents(id, free) {
    var p = P(), hs = hero(id); if (!hs || !hs.owned) return false;
    if (talentPoints(hs.id).used <= 0) return false;
    var cost = free ? 0 : econ().talentResetGems;
    if (p.gems < cost) return false;
    batch(function () {
      if (cost > 0) { p.gems -= cost; mut('gems', { delta: -cost }); }
      hs.talents = {};
      mut('talent', { id: hs.id, reset: true });
    });
    return true;
  }

  /* ============================================================================================
   * Training (gold).  Cost L→L+1 = round(costBase * costGrow^L)
   * ========================================================================================== */
  function trainCost(id) { var t = trainDef(id), p = P(); return t ? Math.round(num(t.costBase) * Math.pow(num(t.costGrow, 1), num(p.train[id]))) : 0; }
  function trainInfo(id) {
    var t = trainDef(id), p = P(); if (!t) return null;
    var lvl = num(p.train[id]), max = num(t.max, 200);
    return { id: id, n: t.n, key: t.key, lvl: lvl, max: max, per: t.per, bonus: t.per * lvl, next: t.per * Math.min(max, lvl + 1),
      cost: trainCost(id), maxed: lvl >= max, ok: lvl < max && p.gold >= trainCost(id) };
  }
  function train(id) {
    var p = P(), t = trainDef(id); if (!t) return false;
    var lvl = num(p.train[id]); if (lvl >= num(t.max, 200)) return false;
    var c = trainCost(id); if (p.gold < c) return false;
    p.gold -= c;
    p.train[id] = lvl + 1;
    mut(['train', 'gold'], { id: id, lvl: lvl + 1, delta: -c });
    return true;
  }

  /* ============================================================================================
   * Attributes (GTA-style, grow only by playing).  need(L) = round(base * (L+1)^1.6)
   * ========================================================================================== */
  function attrNeed(id, L) {
    var a = attrDef(id);
    if (GM.D && typeof GM.D.attrNeed === 'function' && a) { var v = num(GM.D.attrNeed(a, L), 0); if (v > 0) return v; }
    return Math.max(1, Math.round(num(a && a.base, 3) * Math.pow((L | 0) + 1, 1.6)));
  }
  function attr(id) {
    var p = P(), st = p.attrs[id]; if (!st) return { lvl: 0, xp: 0, need: 0, pct: 0 };
    var a = attrDef(id), AM = attrMax();
    var need = st.lvl >= AM ? 0 : attrNeed(id, st.lvl);
    return { lvl: st.lvl, xp: st.xp, need: need, pct: st.lvl >= AM ? 1 : clamp(st.xp / need, 0, 1), max: AM,
      total: a ? num(p.totals[a.src === 'time' ? 'playSec' : a.src]) : 0 };
  }
  function addAttrRaw(id, xp) {
    var p = prof, st = p.attrs[id], AM = attrMax();
    if (!st || !(xp > 0) || st.lvl >= AM) return 0;
    var g = 0;
    st.xp += xp;
    while (st.lvl < AM && st.xp >= attrNeed(id, st.lvl)) { st.xp -= attrNeed(id, st.lvl); st.lvl++; g++; }
    if (st.lvl >= AM) st.xp = 0;
    st.xp = Math.round(st.xp * 100) / 100;
    return g;
  }
  function addAttrXP(id, xp) {
    P(); xp = num(xp);
    if (!attrDef(id) || xp <= 0) return 0;
    var g = addAttrRaw(id, xp);
    mut('attr', { id: id, gained: g });
    return g;
  }
  function attrBonus() {
    var p = P(), out = {};
    attrDefs().forEach(function (a) {
      var L = p.attrs[a.id] ? num(p.attrs[a.id].lvl) : 0;
      if (!L) return;
      if (a.eff && a.eff.key) addKey(out, a.eff.key, num(a.eff.per) * L);
      if (a.eff2 && a.eff2.key) addKey(out, a.eff2.key, num(a.eff2.per) * L);
    });
    return out;
  }

  /* ============================================================================================
   * Account level
   * ========================================================================================== */
  function accNeed(L) { var E = econ(); try { return Math.max(1, num(E.accXpNeed(L), 100 + 60 * L)); } catch (e) { return 100 + 60 * L; } }
  function accInfo() { var p = P(), need = accNeed(p.accLvl); return { lvl: p.accLvl, xp: p.accXp, need: need, pct: clamp(p.accXp / need, 0, 1) }; }
  function addAccXpRaw(xp) {
    var p = prof, g = 0;
    p.accXp += Math.max(0, num(xp));
    while (p.accXp >= accNeed(p.accLvl) && g < 500) { p.accXp -= accNeed(p.accLvl); p.accLvl++; g++; }
    return g;
  }

  /* ============================================================================================
   * Skins (cosmetic).  target: 'silah:<wt>' | 'slot:<slotId>' | 'hero:<heroId>'
   * ========================================================================================== */
  function ownsSkin(id) { var p = P(), sk = skinDef(id); if (!sk) return false; return p.skins.owned.indexOf(id) >= 0 || !!(sk.cost && sk.cost.type === 'start'); }
  function skinsFor(target) { return skins().filter(function (s) { return s.target === target; }); }
  function skinCost(id) { var sk = skinDef(id); return sk && sk.cost && isNum(sk.cost.gems) ? sk.cost.gems : 0; }
  function buySkin(id) {
    var p = P(), sk = skinDef(id); if (!sk || ownsSkin(id)) return false;
    var c = skinCost(id); if (p.gems < c) return false;
    batch(function () {
      p.gems -= c;
      p.skins.owned.push(id);
      mut(['gems', 'skin'], { bought: id, delta: -c });
      setSkin(sk.target, id);
    });
    return true;
  }
  function setSkin(target, skinId) {
    var p = P(); if (!target || typeof target !== 'string') return false;
    if (skinId == null) {
      if (!hasOwn(p.skins.sel, target)) return true;
      delete p.skins.sel[target];
    } else {
      var sk = skinDef(skinId);
      if (!sk || sk.target !== target || !ownsSkin(skinId)) return false;
      if (p.skins.owned.indexOf(skinId) < 0) p.skins.owned.push(skinId);
      if (p.skins.sel[target] === skinId) return true;
      p.skins.sel[target] = skinId;
    }
    if (target.indexOf('hero:') === 0) { var hs = p.heroes[target.slice(5)]; if (hs) hs.skin = skinId || null; }
    mut('skin', { target: target, skin: skinId || null });
    return true;
  }
  function skinFor(target) { var p = P(), s = p.skins.sel[target]; return s && skinDef(s) ? s : null; }

  /* ============================================================================================
   * Stats (SPEC §3.3)
   *  hero base × (1 + lvlStatGrow·(lvl−1)) × (1 + starStatGrow·(stars−1))
   *  → + flat (training, gear main stats + flat subs, flat talents)
   *  → aggregate every §2.7 key into mods (gear subs, set bonuses, hero passive, talents, attributes, training)
   *  → atk = (atkBase + mods.atk) * (1 + mods.atkPct) (same for hp, def) → caps.
   * ========================================================================================== */
  var FLAT = { atk: 1, hp: 1, def: 1 };
  /* POWER (documented, monotone in every sheet field; all weights ≥ 0):
   *   atk·4.5 + hp·0.4 + def·5
   *   + (crit−0.05)·1500 + (critDmg−1.5)·400 + (baseSpd·(1+spdPct)−1)·800 + cdr·1500 + lifesteal·2500 + regen·25
   *   + (pickup/70−1)·120 + (xpGain−1)·300 + (goldGain−1)·150 + (area−1)·500 + projCount·250 + pierce·150 + (dur−1)·300
   *   + (eliteDmg−1)·200 + (bossDmg−1)·300 + (skillDmg−1)·500 + (wDmg[equipped weapon type]−1)·600 + Σ(elem−1)·120
   *   + dodge·2000 + (ultCharge−1)·300 + (ultDmg−1)·200 + revive·400 + startLvl·150 + execute·2000 + thorns·400
   *   + shieldStart·0.4 + killHeal·40
   * Tuned so the starter Bora is ≈ 1 450 (chapter 1 rec 1 200; ch2 2 600; ch3 5 200 need real progress).
   * itemPower uses the same per-key weights (PW) on the item's own main stat + subs. */
  var PW = { atk: 4.5, hp: 0.4, def: 5, atkPct: 450, hpPct: 400, defPct: 150, crit: 1500, critDmg: 400, spdPct: 800, cdr: 1500,
    lifesteal: 2500, regen: 25, pickup: 120, xpGain: 300, goldGain: 150, area: 500, projCount: 250, pierce: 150, dur: 300,
    eliteDmg: 200, bossDmg: 300, skillDmg: 500, w_kilic: 400, w_yay: 400, w_orak: 400, w_asa: 400,
    e_ates: 120, e_buz: 120, e_yildirim: 120, e_zehir: 120, e_golge: 120, dodge: 2000, ultCharge: 300, ultDmg: 200,
    revive: 400, startLvl: 150, execute: 2000, thorns: 400, shieldStart: 0.4, killHeal: 40 };
  var W_AFFINITY = 600;   // per +100% damage of the EQUIPPED weapon type (hero weapon passives/talents)
  function pos(v) { return v > 0 ? v : 0; }
  function sheetPower(s) {
    var m = s.mods, el = 0;
    for (var k in s.elem) if (k !== 'none' && hasOwn(s.elem, k)) el += pos(s.elem[k] - 1);
    var v = s.atk * PW.atk + s.hp * PW.hp + s.def * PW.def
      + pos(s.crit - 0.05) * PW.crit + pos(s.critDmg - 1.5) * PW.critDmg + pos(s.baseSpd * (1 + m.spdPct) - 1) * PW.spdPct
      + pos(s.cdr) * PW.cdr + pos(s.lifesteal) * PW.lifesteal + pos(s.regen) * PW.regen
      + pos(s.pickup / 70 - 1) * PW.pickup + pos(s.xpGain - 1) * PW.xpGain + pos(s.goldGain - 1) * PW.goldGain
      + pos(s.area - 1) * PW.area + pos(s.projCount) * PW.projCount + pos(s.pierce) * PW.pierce + pos(s.dur - 1) * PW.dur
      + pos(s.eliteDmg - 1) * PW.eliteDmg + pos(s.bossDmg - 1) * PW.bossDmg + pos(s.skillDmg - 1) * PW.skillDmg
      + pos((s.wDmg[s.weapon] || 1) - 1) * W_AFFINITY + el * 120
      + pos(s.dodge) * PW.dodge + pos(s.ultCharge - 1) * PW.ultCharge + pos(s.ultDmg - 1) * PW.ultDmg
      + pos(s.revive) * PW.revive + pos(s.startLvl) * PW.startLvl + pos(s.execute) * PW.execute + pos(s.thorns) * PW.thorns
      + pos(s.shieldStart) * PW.shieldStart + pos(s.killHeal) * PW.killHeal;
    return Math.max(0, Math.round(v));
  }
  function itemPower(x) {
    var it = asItem(x); if (!it) return 0;
    var m = itemMain(it), v = num(PW[m.k]) * m.v;
    (it.subs || []).forEach(function (s) { v += num(PW[s.k]) * num(s.v); });
    return Math.max(0, Math.round(v));
  }

  /* equipped item map (slot -> ITEM|null), optionally with one item swapped in */
  function equipMap(withItem) {
    var p = P(), m = {};
    slotIds().forEach(function (s) { m[s] = equipped(s); });
    if (withItem && slotDef(withItem.slot)) m[withItem.slot] = withItem;
    return m;
  }

  function computeStats(heroId, opt) {
    var p = P();
    var def = heroDef(heroId == null ? p.active : heroId) || heroDef(p.active) || heroDefs()[0] || FB.HEROES[0];
    var hs = p.heroes[def.id] || { lvl: 1, stars: 1, talents: {} };
    var H = heroProg();
    var lvl = Math.max(1, num(hs.lvl, 1)), stars = Math.max(1, num(hs.stars, 1));
    var gm = (1 + H.lvlStatGrow * (lvl - 1)) * (1 + H.starStatGrow * (stars - 1));
    var b = def.base || {};
    var atkBase = num(b.atk, 20) * gm, hpBase = num(b.hp, 300) * gm, defBase = num(b.def, 8) * gm, baseSpd = num(b.spd, 1) || 1;

    var mods = {};
    statKeys().forEach(function (k) { mods[k] = 0; });
    // training (flat atk/hp/def + crit)
    trainings().forEach(function (t) { addKey(mods, t.key, num(t.per) * num(p.train[t.id])); });
    // gear: main stats + subs; count armor sets
    var eq = equipMap(opt && opt.withItem), setCount = {};
    slotIds().forEach(function (s) {
      var it = eq[s]; if (!it) return;
      var m = itemMain(it); addKey(mods, m.k, m.v);
      (it.subs || []).forEach(function (sb) { addKey(mods, sb.k, num(sb.v)); });
      if (s !== 'silah' && it.set) setCount[it.set] = (setCount[it.set] || 0) + 1;
    });
    // set bonuses (armor only; every threshold reached applies)
    var SETS = sets(), activeSets = [];
    for (var sid in setCount) {
      var sd = SETS[sid]; if (!sd || !sd.bonus) continue;
      for (var need in sd.bonus) if (hasOwn(sd.bonus, need) && setCount[sid] >= +need) { addMods(mods, sd.bonus[need]); activeSets.push({ set: sid, need: +need }); }
    }
    // hero passive
    addMods(mods, def.passive);
    // talents (eff per rank)
    var ti = talentIdx(def.id);
    for (var nid in hs.talents) if (hasOwn(hs.talents, nid) && ti[nid]) addMods(mods, ti[nid].node.eff, num(hs.talents[nid]));
    // attributes
    addMods(mods, attrBonus());

    var wpn = eq.silah;
    var s = {
      heroId: def.id, heroLvl: lvl, stars: stars, ult: def.ult ? def.ult.id : null,
      weapon: wpn && validWt(wpn.wt) ? wpn.wt : (def.weapon || 'kilic'), weaponRar: wpn ? wpn.rar : 0, weaponLvl: wpn ? wpn.lvl : 0,
      atk: Math.round((atkBase + mods.atk) * (1 + mods.atkPct)),
      hp: Math.round((hpBase + mods.hp) * (1 + mods.hpPct)),
      def: Math.round((defBase + mods.def) * (1 + mods.defPct)),
      baseSpd: baseSpd,
      spd: 160 * baseSpd * (1 + mods.spdPct),
      crit: Math.min(1, 0.05 + mods.crit),
      critDmg: 1.5 + mods.critDmg,
      cdr: clamp(mods.cdr, 0, 0.5),
      lifesteal: clamp(mods.lifesteal, 0, 0.2),
      regen: mods.regen,
      pickup: 70 * (1 + mods.pickup),
      xpGain: 1 + mods.xpGain, goldGain: 1 + mods.goldGain, area: 1 + mods.area,
      projCount: Math.round(mods.projCount), pierce: Math.round(mods.pierce),
      dur: 1 + mods.dur, eliteDmg: 1 + mods.eliteDmg, bossDmg: 1 + mods.bossDmg, skillDmg: 1 + mods.skillDmg,
      wDmg: { kilic: 1 + mods.w_kilic, yay: 1 + mods.w_yay, orak: 1 + mods.w_orak, asa: 1 + mods.w_asa },
      elem: { ates: 1 + mods.e_ates, buz: 1 + mods.e_buz, yildirim: 1 + mods.e_yildirim, zehir: 1 + mods.e_zehir, golge: 1 + mods.e_golge, none: 1 },
      dodge: clamp(mods.dodge, 0, 0.4),
      ultCharge: 1 + mods.ultCharge, ultDmg: 1 + mods.ultDmg,
      revive: Math.round(mods.revive), startLvl: Math.round(mods.startLvl),
      execute: Math.max(0, mods.execute), thorns: Math.max(0, mods.thorns),
      shieldStart: Math.max(0, mods.shieldStart), killHeal: Math.max(0, mods.killHeal),
      mods: mods, sets: setCount, activeSets: activeSets,
      base: { atk: atkBase, hp: hpBase, def: defBase }
    };
    s.power = sheetPower(s);
    return s;
  }
  function power(heroId) {
    var p = P(), id = heroDef(heroId == null ? p.active : heroId) ? (heroId == null ? p.active : heroId) : p.active;
    if (hasOwn(powerCache, id)) return powerCache[id];
    var v = computeStats(id).power;
    powerCache[id] = v;
    return v;
  }
  /* power the hero would have with this item equipped instead (compare arrows in item detail) */
  function powerIf(uid, heroId) { var it = asItem(uid); return it ? computeStats(heroId, { withItem: it }).power : power(heroId); }

  /* set bonus summary for the current equipment */
  function setBonuses() {
    var eq = equipMap(), cnt = {}, SETS = sets(), out = [];
    armorSlotIds().forEach(function (s) { var it = eq[s]; if (it && it.set) cnt[it.set] = (cnt[it.set] || 0) + 1; });
    Object.keys(cnt).sort(function (a, b) { return cnt[b] - cnt[a]; }).forEach(function (sid) {
      var sd = SETS[sid]; if (!sd) return;
      var tiers = Object.keys(sd.bonus || {}).map(function (k) { return { need: +k, eff: sd.bonus[k], on: cnt[sid] >= +k }; })
        .sort(function (a, b) { return a.need - b.need; });
      out.push({ id: sid, n: sd.n, count: cnt[sid], tiers: tiers });
    });
    return out;
  }

  /* SPEC §3.4 */
  function appearance(heroId) {
    var p = P(), def = heroDef(heroId == null ? p.active : heroId) || heroDef(p.active) || heroDefs()[0] || FB.HEROES[0];
    var eq = equipMap(), w = eq.silah;
    var wt = w && validWt(w.wt) ? w.wt : (def.weapon || 'kilic');
    var look = { heroId: def.id, heroSkin: skinFor('hero:' + def.id), weapon: { wt: wt, rar: w ? w.rar : 0, skin: skinFor('silah:' + wt) }, gear: {} };
    armorSlotIds().forEach(function (s) {
      var it = eq[s];
      look.gear[s] = it ? { rar: it.rar, set: it.set, skin: skinFor('slot:' + s) } : null;
    });
    return look;
  }

  /* ============================================================================================
   * Runs (SPEC §3.5)
   * ========================================================================================== */
  var curRun = null;
  function chapterState() { var p = P(); return { max: p.chapters.max, best: p.chapters.best }; }
  function runCost(ch) { return Math.max(0, num(ch && ch.energy, econ().runEnergy)); }
  function canStart(chapterId) {
    var p = P(), ch = chapterDef(chapterId);
    if (!ch) return { ok: false, reason: 'Bölüm bulunamadı', code: 'none' };
    if (ch.locked) return { ok: false, reason: ch.soon || 'Yakında', code: 'soon' };
    if (ch.id > p.chapters.max) {
      var prev = chapterDef(ch.id - 1);
      return { ok: false, reason: prev ? 'Önce “' + prev.n + '” bölümünü geç' : 'Bölüm kilitli', code: 'locked' };
    }
    var hs = p.heroes[p.active];
    if (!hs || !hs.owned) return { ok: false, reason: 'Kahraman kilitli', code: 'hero' };
    var cost = runCost(ch);
    if (regen() > 0) mut('energy', { regen: true });
    if (p.energy < cost) return { ok: false, reason: 'Yetersiz enerji', code: 'energy', cost: cost };
    return { ok: true, reason: '', code: 'ok', cost: cost };
  }
  function startRun(chapterId) {
    var p = P(), chk = canStart(chapterId); if (!chk.ok) return false;
    if (!spendEnergy(chk.cost)) return false;
    curRun = { chapterId: +chapterId, heroId: p.active, t0: now() };
    return true;
  }

  var RES_NUM = ['time', 'kills', 'elites', 'bosses', 'metins', 'chests', 'goldPicked', 'distance', 'meleeKills',
    'rangedHits', 'skillDamage', 'nearMisses', 'damageTaken', 'runLevel'];
  function cleanResult(r) {
    r = r && typeof r === 'object' ? r : {};
    var o = { chapterId: +r.chapterId || (curRun && curRun.chapterId) || 1, won: r.won === true || r.won === 1 || r.won === 'true',
      heroId: r.heroId || (curRun && curRun.heroId) || null, killsByType: r.killsByType && typeof r.killsByType === 'object' ? r.killsByType : {} };
    RES_NUM.forEach(function (k) { o[k] = Math.max(0, num(r[k])); });
    return o;
  }
  function rollRar(weights) {
    var w = Array.isArray(weights) && weights.length ? weights : [60, 30, 9, 1, 0, 0], tot = 0, i;
    for (i = 0; i < w.length; i++) tot += Math.max(0, num(w[i]));
    if (tot <= 0) return 0;
    var x = Math.random() * tot;
    for (i = 0; i < w.length; i++) { x -= Math.max(0, num(w[i])); if (x < 0) return clampInt(i, 0, maxRar()); }
    return 0;
  }
  /* finishRun rules (SPEC §3.5):
   *  gold  = goldPicked × goldGain + (won ? reward.gold : 25% of it)
   *  items = 1 per chest + (won ? 2 : 0)  (max 10), rarity from reward.chest weights, added to the bag
   *  gems  = reward.gems on the first clear only · shards → played hero (won ? reward.shards : 1)
   *  scrolls: won → every group +1…3 · lost → 1…3 scrolls of random groups
   *  attributes: xp = round(result[src] × factor) · account xp = accXpPerRun × (0.5 + 0.5·progress + 0.5·won) × (1 + 0.25·(chapter−1))
   *  next chapter unlocks on a win (chapters with locked:true stay unplayable until released). */
  function finishRun(result) {
    var p = P();
    if (result && typeof result === 'object' && result.__rewards) return result.__rewards;
    var r = cleanResult(result);
    var ch = chapterDef(r.chapterId) || chapters()[0] || FB.CHAPTERS[0];
    var rw = ch.reward || {};
    var heroId = r.heroId && p.heroes[r.heroId] ? r.heroId : p.active;
    var sheet = computeStats(heroId);
    var rew = { gold: 0, gems: 0, heroXp: 0, accXp: 0, accLevelUp: false, shards: {}, scrolls: { silah: 0, zirh: 0, taki: 0 },
      items: [], attrs: [], firstClear: false, unlockedChapter: null,
      chapterId: ch.id, won: r.won, heroId: heroId, accLvl: p.accLvl, levelGift: null, newBest: false };

    batch(function () {
      // gold
      var baseGold = num(rw.gold);
      rew.gold = Math.max(0, Math.round(r.goldPicked * sheet.goldGain + (r.won ? baseGold : baseGold * 0.25)));
      p.gold += rew.gold;
      // equipment
      var nItems = Math.min(MAX_RUN_ITEMS, Math.floor(r.chests) + (r.won ? 2 : 0));
      for (var i = 0; i < nItems; i++) {
        var it = makeItemFor(p, { rar: rollRar(rw.chest), lvl: 1 });
        it.new = true;
        p.items.push(it);
        rew.items.push(it);
      }
      rew.items.sort(function (a, b) { return a.rar - b.rar; });   // reveal order: best last
      reindex();
      // chapter record + first clear + unlock
      var best = p.chapters.best[ch.id] || (p.chapters.best[ch.id] = { time: 0, cleared: false, kills: 0 });
      rew.newBest = r.time > num(best.time);
      rew.firstClear = r.won && !best.cleared;
      if (rew.firstClear) { rew.gems = Math.max(0, Math.round(num(rw.gems))); p.gems += rew.gems; }
      best.time = Math.max(num(best.time), Math.round(r.time));
      best.kills = Math.max(num(best.kills), Math.round(r.kills));
      if (r.won) {
        best.cleared = true;
        best.fastest = best.fastest ? Math.min(best.fastest, Math.round(r.time)) : Math.round(r.time);
        best.clears = num(best.clears) + 1;
        if (ch.id >= p.chapters.max) {
          var nx = chapterDef(ch.id + 1);
          if (nx) { p.chapters.max = nx.id; if (!nx.locked) rew.unlockedChapter = nx.id; }
        }
      }
      // shards to the played hero
      var sh = r.won ? Math.max(0, Math.round(num(rw.shards, 5))) : 1;
      if (sh > 0 && p.heroes[heroId]) { p.shards[heroId] = num(p.shards[heroId]) + sh; rew.shards[heroId] = sh; }
      // scrolls
      if (r.won) SCROLL_GROUPS.forEach(function (g) { rew.scrolls[g] = rndInt(1, 3); });
      else { var ns = rndInt(1, 3); for (var j = 0; j < ns; j++) rew.scrolls[pick(SCROLL_GROUPS)]++; }
      SCROLL_GROUPS.forEach(function (g) { p.scrolls[g] = num(p.scrolls[g]) + rew.scrolls[g]; });
      // attributes (account-wide, grow only by playing)
      attrDefs().forEach(function (a) {
        var before = attr(a.id), xp = Math.round(num(r[a.src]) * num(a.factor));
        addAttrRaw(a.id, xp);
        var after = attr(a.id);
        rew.attrs.push({ id: a.id, n: a.n, from: before.lvl, to: after.lvl, xp: xp, fromPct: before.pct, toPct: after.pct });
      });
      // account xp
      var dur = Math.max(1, num(ch.dur, 240));
      var prog = clamp(r.time / dur, 0, 1);
      rew.accXp = Math.round(econ().accXpPerRun * (0.5 + 0.5 * prog + (r.won ? 0.5 : 0)) * (1 + 0.25 * (ch.id - 1)));
      var lv = addAccXpRaw(rew.accXp);
      rew.accLevelUp = lv > 0;
      rew.accLvl = p.accLvl;
      if (lv > 0) { regen(); p.energy += LEVEL_GIFT_ENERGY * lv; rew.levelGift = { levels: lv, energy: LEVEL_GIFT_ENERGY * lv }; }
      rew.heroXp = Math.round(num(rw.heroXp) * (r.won ? 1 : 0.3));
      // lifetime totals
      var T = p.totals;
      T.runs++; if (r.won) T.wins++;
      T.kills += Math.round(r.kills); T.bosses += Math.round(r.bosses); T.playSec += Math.round(r.time);
      T.elites += Math.round(r.elites); T.metins += Math.round(r.metins); T.chests += Math.round(r.chests);
      T.distance += Math.round(r.distance); T.meleeKills += Math.round(r.meleeKills); T.rangedHits += Math.round(r.rangedHits);
      T.nearMisses += Math.round(r.nearMisses); T.skillDamage += Math.round(r.skillDamage); T.damageTaken += Math.round(r.damageTaken);
      T.goldEarned += rew.gold; T.itemsFound += rew.items.length; T.bestRunLevel = Math.max(T.bestRunLevel, Math.round(r.runLevel));

      var evts = ['gold', 'item', 'hero', 'attr', 'energy'];
      if (rew.gems) evts.push('gems');
      if (rew.accLevelUp) evts.push('level');
      mut(evts, { run: true, rewards: rew });
    });
    curRun = null;
    save();
    try { Object.defineProperty(result, '__rewards', { value: rew, enumerable: false, configurable: true }); } catch (e) { /* frozen / primitive */ }
    return rew;
  }

  /* ============================================================================================
   * Misc helpers
   * ========================================================================================== */
  function setSetting(k, v) { var p = P(); if (!k) return; p.settings[k] = v; mut('settings', { key: k, value: v }); }
  function setName(n) { var p = P(); n = String(n == null ? '' : n).trim().slice(0, 24); if (!n) return false; p.name = n; mut('name', { name: n }); return true; }

  /* counts for nav badges */
  function hints() {
    var p = P(), out = { newItems: newCount(), upgradable: 0, mergeable: mergeGroups().length, heroLevel: 0, heroStar: 0,
      heroUnlock: 0, talentFree: 0, train: 0 };
    slotIds().forEach(function (s) { var it = equipped(s); if (it && canUpgrade(it).ok) out.upgradable++; });
    heroDefs().forEach(function (h) {
      var hs = p.heroes[h.id]; if (!hs) return;
      if (hs.owned) {
        if (canLevelHero(h.id).ok) out.heroLevel++;
        if (canStarUp(h.id).ok) out.heroStar++;
        out.talentFree += talentPoints(h.id).free;
      } else if (h.unlock && h.unlock.type === 'gems' && p.gems >= heroUnlockCost(h.id)) out.heroUnlock++;
    });
    trainings().forEach(function (t) { var i = trainInfo(t.id); if (i && i.ok) out.train++; });
    return out;
  }

  /* ============================================================================================
   * Public namespace
   * ========================================================================================== */
  S.KEY = KEY;
  S.load = load; S.save = save; S.reset = reset;
  S.on = on; S.off = off; S.emit = emit; S.batch = batch;
  S.revision = function () { return rev; };
  S.fmt = fmt;
  S.addGold = addGold; S.spendGold = spendGold; S.addGems = addGems; S.spendGems = spendGems;
  S.getEnergy = getEnergy; S.spendEnergy = spendEnergy; S.addEnergy = addEnergy;
  S.itemName = itemName; S.itemMain = itemMain; S.itemSubs = itemSubs; S.itemPower = itemPower;
  S.makeItem = makeItem; S.addItem = addItem; S.removeItem = removeItem; S.getItem = getItem; S.bag = bag;
  S.isEquipped = isEquipped; S.markSeen = markSeen; S.newCount = newCount;
  S.equip = equip; S.unequip = unequip; S.equipped = equipped;
  S.upgradeCost = upgradeCost; S.canUpgrade = canUpgrade; S.upgradeItem = upgradeItem;
  S.mergeCandidates = mergeCandidates; S.mergeGroups = mergeGroups; S.merge = merge; S.sell = sell; S.sellValue = sellValue;
  S.hero = hero; S.heroDef = function (id) { return heroDef(id == null ? P().active : id); };
  S.ownedHeroes = ownedHeroes; S.setActive = setActive;
  S.unlockHero = unlockHero; S.heroUnlockCost = heroUnlockCost; S.heroLevelCost = heroLevelCost; S.levelUpHero = levelUpHero;
  S.heroMaxLv = heroMaxLv; S.canLevelHero = canLevelHero; S.starCost = starCost; S.starUpHero = starUpHero; S.canStarUp = canStarUp;
  S.talentPoints = talentPoints; S.talentRank = talentRank; S.branchSpent = branchSpent;
  S.canRank = canRank; S.rankTalent = rankTalent; S.resetTalents = resetTalents;
  S.trainCost = trainCost; S.train = train; S.trainInfo = trainInfo;
  S.attr = attr; S.attrNeed = attrNeed; S.addAttrXP = addAttrXP; S.attrBonus = attrBonus; S.accInfo = accInfo;
  S.ownsSkin = ownsSkin; S.buySkin = buySkin; S.setSkin = setSkin; S.skinFor = skinFor; S.skinsFor = skinsFor;
  S.computeStats = computeStats; S.power = power; S.powerIf = powerIf; S.setBonuses = setBonuses; S.appearance = appearance;
  S.canStart = canStart; S.startRun = startRun; S.finishRun = finishRun; S.chapterState = chapterState; S.chapterDef = chapterDef;
  S.currentRun = function () { return curRun; };
  S.setSetting = setSetting; S.setName = setName; S.hints = hints;

  GM.S = S;
})(window.GM = window.GM || {});
