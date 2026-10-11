/* GÖLGE MUHAFIZLARI — ui-core.js (owner: ui-core)  ·  Namespace: GM.UI  (SPEC §7.1)
 *
 * Lobby shell + router + overlay helpers + the ui-core screens:
 *   #gm-top     top bar: account badge (portrait + XP ring + level), name, Savaş Gücü, energy (+ regen timer), gold, gems, gear
 *   #gm-nav     bottom nav: ekipman · kahraman · SAVAŞ (raised medallion) · gelisim · arena, glow + lift, red badges
 *   #gm-screen  router (slide / fade transitions), screens registered with GM.UI.reg (ui-meta registers its own)
 *   #gm-layer   modals, toasts, confirm, floating numbers, the results overlay and the portal transition into battle
 *   #ui-bg      (created inside #gm-lobby) the animated lobby backdrop: gothic cathedral, light shafts, dust, embers,
 *               rune altar with a rarity-coloured aura and the active hero (GM.Art.drawHero) on the home screen
 * Screens owned here: savas (home + chapter carousel + chapter map), arena (multiplayer hub, mock), ayarlar (settings).
 *
 * SPEC API: init frame go back current reg modal toast confirm floatNum showResults refreshTop refresh canvas
 * Extras:   UI.params · UI.tab · UI.isReg(id) · UI.startChapter(id) · UI.selChapter · UI.fmt(n) · UI.fmtC(n) · UI.fmtTime(s)
 *           UI.icon(name) -> inline SVG markup (gold gem bolt swords gear lock …) · UI.closeModals() · UI.openShop(sec) · UI.ticker(fn)
 *           reg(id, def) also accepts def.bg = 'home' | 'dim' (lobby backdrop mode, default 'dim') and def.refresh() (called on GM.S 'change').
 *           canvas(el, draw, opts?) opts = { fps, once, keep } · modal(content, o) also accepts o.dismiss === false (no backdrop close).
 *
 * Every call into another module is guarded: a missing GM.S / GM.Art / GM.A / GM.B / GM.UIMeta never throws here.
 * UI-only bookkeeping (daily quests, mail, notify flags) lives in its own localStorage key (try/catch).
 */
(function (GM) {
  'use strict';

  /* ============================================================================================
   * Small math / dom / format helpers
   * ========================================================================================== */
  var PI = Math.PI, TAU = PI * 2;
  var sin = Math.sin, cos = Math.cos, abs = Math.abs, mn = Math.min, mx = Math.max, floor = Math.floor, round = Math.round;
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function lerp(a, b, k) { return a + (b - a) * k; }
  function eOut(k) { k = clamp(k, 0, 1); return 1 - (1 - k) * (1 - k) * (1 - k); }
  function eIn(k) { k = clamp(k, 0, 1); return k * k * k; }
  function eInOut(k) { k = clamp(k, 0, 1); return k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2; }
  function rng(seed) {
    var s = (seed >>> 0) || 1;
    return function () { s = (s + 0x6D2B79F5) >>> 0; var t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }
  function hash(n) { var x = sin(n * 127.1 + 311.7) * 43758.5453; return x - floor(x); }
  var RGBC = {};
  function rgbOf(h) {
    var c = RGBC[h]; if (c) return c;
    var m = /^#?([0-9a-f]{6})$/i.exec(String(h || ''));
    var n = m ? parseInt(m[1], 16) : 0x808080;
    c = [(n >> 16) & 255, (n >> 8) & 255, n & 255]; RGBC[h] = c; return c;
  }
  function rgba(h, a) { var c = rgbOf(h); return 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + a + ')'; }
  function mixHex(a, b, k) {
    var A = rgbOf(a), B = rgbOf(b);
    return '#' + ((1 << 24) | (round(lerp(A[0], B[0], k)) << 16) | (round(lerp(A[1], B[1], k)) << 8) | round(lerp(A[2], B[2], k))).toString(16).slice(1);
  }

  var RM = false;
  try { RM = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches); } catch (e) { /* ignore */ }
  function DPR() { return mn(window.devicePixelRatio || 1, 2); }

  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
  function mk(tag, cls, html) { var e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function offCv(w, h) { var c = document.createElement('canvas'); c.width = mx(1, round(w)); c.height = mx(1, round(h)); return c; }

  function fmt(n) { n = round(+n || 0); try { return n.toLocaleString('tr-TR'); } catch (e) { return String(n); } }
  function fmt1(v) { try { return (+v || 0).toLocaleString('tr-TR', { maximumFractionDigits: 1 }); } catch (e) { return String(round(v * 10) / 10); } }
  function fmtC(n) {
    n = +n || 0; var a = abs(n);
    if (a >= 1e9) return fmt1(n / 1e9) + ' Mr';
    if (a >= 1e6) return fmt1(n / 1e6) + ' Mn';
    if (a >= 1e5) return fmt(floor(n / 1000)) + ' B';
    return fmt(n);
  }
  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  function fmtTime(sec) { sec = mx(0, round(+sec || 0)); return floor(sec / 60) + ':' + pad2(sec % 60); }
  function fmtDur(sec) {
    sec = mx(0, floor(+sec || 0));
    var d = floor(sec / 86400), h = floor(sec % 86400 / 3600), m = floor(sec % 3600 / 60), s = sec % 60;
    return (d > 0 ? d + 'g ' : '') + pad2(h) + ':' + pad2(m) + ':' + pad2(s);
  }

  var errN = 0;
  function report(e, label) { if (errN++ < 12) { try { console.error('[GM.UI] ' + label + ':', e); } catch (x) { /* ignore */ } } }
  function safe(fn, label) { try { return fn(); } catch (e) { report(e, label || 'error'); } return undefined; }
  function snd(name, o) { try { if (GM.A && typeof GM.A.play === 'function') GM.A.play(name, o); } catch (e) { /* audio never breaks UI */ } }

  /* ============================================================================================
   * Data access (GM.D with SPEC fallbacks) + guarded state access
   * ========================================================================================== */
  var FB = {
    RARITIES: [
      { id: 'siradan', n: 'Sıradan', col: '#A7ADB7', dark: '#5D6370' }, { id: 'iyi', n: 'İyi', col: '#5BD16E', dark: '#2C7A3A' },
      { id: 'nadir', n: 'Nadir', col: '#4BA3FF', dark: '#1F5DA8' }, { id: 'destansi', n: 'Destansı', col: '#B565FF', dark: '#6A2BB0' },
      { id: 'efsanevi', n: 'Efsanevi', col: '#FFB020', dark: '#A8620A' }, { id: 'mitik', n: 'Mitik', col: '#FF3D4F', dark: '#8E1324' }],
    CHAPTERS: [
      { id: 1, n: 'Kara Orman', sub: 'Kurt Kral’ın İni', theme: 'orman', rec: 1200, energy: 5, boss: 'kurtKral', col: '#6FCF5A' },
      { id: 2, n: 'Lanetli Mezarlık', sub: 'Kemik Ejder’in Mezarı', theme: 'mezarlik', rec: 2600, energy: 5, boss: 'kemikEjder', col: '#7DF5C8' },
      { id: 3, n: 'Kor Dağı', sub: 'Kor İblisi’nin Kalbi', theme: 'kor', rec: 5200, energy: 5, boss: 'korIblisi', col: '#FF7A2F' },
      { id: 4, n: 'Gölge Kalesi', sub: 'Gölge Kralı’nın Tahtı', theme: 'kale', rec: 9000, energy: 5, boss: null, locked: true, soon: 'Yakında', col: '#9D6BFF' }],
    HEROES: [
      { id: 'bora', n: 'Bora', cls: 'Savaşçı', rar: 2, weapon: 'kilic', passiveText: ['Kılıç hasarı +%30'] },
      { id: 'ela', n: 'Ela', cls: 'Okçu', rar: 3, weapon: 'yay', passiveText: ['Yay hasarı +%30'] },
      { id: 'yaman', n: 'Yaman', cls: 'Sura', rar: 3, weapon: 'orak', passiveText: ['Orak hasarı +%30'] },
      { id: 'ayaz', n: 'Ayaz', cls: 'Şaman', rar: 3, weapon: 'asa', passiveText: ['Asa hasarı +%30'] },
      { id: 'alaz', n: 'Alaz', cls: 'Ejder Muhafızı', rar: 4, weapon: 'kilic', passiveText: ['Ateş hasarı +%40'] }],
    SLOTS: [['silah', 'Silah'], ['kafa', 'Miğfer'], ['yuz', 'Maske'], ['boyun', 'Kolye'], ['omuz', 'Omuzluk'], ['gogus', 'Göğüslük'], ['kol', 'Kolluk'],
      ['eldiven', 'Eldiven'], ['kemer', 'Kemer'], ['pantolon', 'Pantolon'], ['dizlik', 'Dizlik'], ['ayak', 'Çizme']].map(function (x) { return { id: x[0], n: x[1] }; }),
    ECON: { energyMax: 30, energyRegenSec: 300, runEnergy: 5, accXpNeed: function (L) { return 100 + 60 * L; } },
    ATTRS: [],
    SCROLL_GROUPS: { silah: { n: 'Silah Parşömeni', col: '#FF7A2F' }, zirh: { n: 'Zırh Parşömeni', col: '#4BA3FF' }, taki: { n: 'Takı Parşömeni', col: '#B565FF' } },
    TIPS: ['Aynı yuvadan ve aynı nadirlikte 3 eşyayı birleştir: bir üst nadirlik doğar.', 'Nitelikler yalnızca savaşarak gelişir. Koş, öldür, hayatta kal.']
  };
  function dat(k) { var D = GM.D; return D && D[k] != null ? D[k] : FB[k]; }
  function rarOf(i) { var R = dat('RARITIES') || FB.RARITIES; return R[clamp(i | 0, 0, R.length - 1)] || FB.RARITIES[0]; }
  function S() { try { return GM.S && GM.S.p ? GM.S : null; } catch (e) { return null; } }
  function P() { var s = S(); return s ? s.p : null; }
  function call(name) {
    var s = S(); if (!s || typeof s[name] !== 'function') return undefined;
    try { return s[name].apply(s, Array.prototype.slice.call(arguments, 1)); } catch (e) { report(e, 'GM.S.' + name); return undefined; }
  }
  function heroDef(id) {
    var H = dat('HEROES') || FB.HEROES;
    for (var i = 0; i < H.length; i++) if (H[i].id === id) return H[i];
    return H[0] || FB.HEROES[0];
  }
  function activeId() { var p = P(); return (p && p.active) || 'bora'; }
  function heroSt(id) { var p = P(); return (p && p.heroes && p.heroes[id]) || { lvl: 1, stars: 1, owned: true }; }
  function chapters() { var C = dat('CHAPTERS'); return C && C.length ? C : FB.CHAPTERS; }
  function chapterById(id) { var C = chapters(); for (var i = 0; i < C.length; i++) if (C[i].id === +id) return C[i]; return null; }
  function chState() { var cs = call('chapterState'); return cs && cs.best ? cs : { max: 1, best: {} }; }
  function curPower() { var v = call('power'); return typeof v === 'number' && isFinite(v) ? v : 0; }
  function econ() { var E = dat('ECON') || FB.ECON; return E; }
  function energyInfo() {
    var e = call('getEnergy'); if (e && typeof e.cur === 'number') return e;
    var E = econ(); return { cur: E.energyMax || 30, max: E.energyMax || 30, nextInSec: 0, full: true };
  }
  function accInfo() {
    var a = call('accInfo'); if (a && typeof a.lvl === 'number') return a;
    var p = P(), E = econ(), L = (p && p.accLvl) || 1, xp = (p && p.accXp) || 0;
    var need = (typeof E.accXpNeed === 'function' ? E.accXpNeed : FB.ECON.accXpNeed)(L);
    return { lvl: L, xp: xp, need: need, pct: clamp(xp / need, 0, 1) };
  }
  function runCost(ch) { return (ch && ch.energy) || econ().runEnergy || 5; }
  function topRar() {
    var best = -1;
    (dat('SLOTS') || FB.SLOTS).forEach(function (sl) { var it = call('equipped', sl.id); if (it && it.rar > best) best = it.rar; });
    return mx(0, best);
  }
  function lookOf(id) {
    var l = call('appearance', id);
    if (l) return l;
    if (GM.Art && typeof GM.Art.heroLook === 'function') { try { return GM.Art.heroLook(id); } catch (e) { /* fall through */ } }
    return { heroId: id || 'bora', heroSkin: null, weapon: { wt: 'kilic', rar: 0, skin: null }, gear: {} };
  }
  function totals() { var p = P(); return (p && p.totals) || {}; }
  function starsHtml(n, max) { var s = ''; max = max || 5; for (var i = 0; i < max; i++) s += i < n ? '★' : '<span class="off">★</span>'; return '<span class="stars">' + s + '</span>'; }

  /* UI-only bookkeeping (quests / mail / notify flags) — never part of the profile save */
  var LSK = 'golge-muhafizlari-ui-v1', LS = null;
  function ls() {
    if (LS) return LS;
    try { var raw = window.localStorage && window.localStorage.getItem(LSK); LS = raw ? JSON.parse(raw) : null; } catch (e) { LS = null; }
    if (!LS || typeof LS !== 'object') LS = {};
    return LS;
  }
  function lsSave() { try { if (window.localStorage) window.localStorage.setItem(LSK, JSON.stringify(LS || {})); } catch (e) { /* storage blocked */ } }
  function lsReset() { LS = {}; try { if (window.localStorage) window.localStorage.removeItem(LSK); } catch (e) { /* ignore */ } }

  /* ============================================================================================
   * Inline SVG glyphs (shared gradients live in one hidden <svg><defs>)
   * ========================================================================================== */
  function lg(id, a, b, c) {
    return '<linearGradient id="ui-g-' + id + '" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="' + a + '"/><stop offset=".5" stop-color="' + b +
      '"/><stop offset="1" stop-color="' + c + '"/></linearGradient>';
  }
  var DEFS = '<svg class="ui-defs" width="0" height="0" aria-hidden="true" focusable="false"><defs>' +
    lg('gold', '#FFF3BF', '#FFCB57', '#C2701A') + lg('gem', '#FFD6F2', '#FF4FA0', '#7A20C8') + lg('bolt', '#F2FFFC', '#5EF0DA', '#0F8A7A') +
    lg('steel', '#FFFFFF', '#C3CCE0', '#5A6682') + lg('blood', '#FF9AA4', '#E8394D', '#7A0E1E') + lg('violet', '#E6D8FF', '#9D6BFF', '#3F2088') +
    lg('parch', '#FFF4DA', '#E8C88C', '#9A713C') + lg('green', '#E6FFDA', '#5BD16E', '#1C7432') + lg('ember', '#FFE8B4', '#FF7A2F', '#94280A') +
    lg('teal', '#E0FFFA', '#3EDBC8', '#127A6E') + lg('night', '#5A4A7A', '#2A2040', '#120C18') +
    '<radialGradient id="ui-g-medal" cx=".5" cy=".38" r=".7"><stop offset="0" stop-color="#5A2A16"/><stop offset=".6" stop-color="#2A1020"/><stop offset="1" stop-color="#12080F"/></radialGradient>' +
    '</defs></svg>';

  var O = 'stroke="#120C18"';
  function cogD() {
    var d = '', n = 8, r1 = 11, r2 = 14.6, cx = 16, cy = 16, w = TAU / n;
    for (var i = 0; i < n; i++) {
      var a = i * w, pts = [[r1, a - w * 0.5], [r1, a - w * 0.25], [r2, a - w * 0.17], [r2, a + w * 0.17], [r1, a + w * 0.25]];
      for (var j = 0; j < pts.length; j++) d += (i === 0 && j === 0 ? 'M' : 'L') + (cx + cos(pts[j][1]) * pts[j][0]).toFixed(2) + ' ' + (cy + sin(pts[j][1]) * pts[j][0]).toFixed(2);
    }
    return d + 'Z';
  }
  var SWORD = '<path d="M4 4l3.8.5L21.2 18l-3.2 3.2L4.5 7.8z" fill="url(#ui-g-steel)" ' + O + ' stroke-width="1.7" stroke-linejoin="round"/>' +
    '<path d="M7 6l11.6 11.6" stroke="#fff" stroke-width="1" opacity=".7"/>' +
    '<path d="M15.2 24.2l9-9" stroke="#120C18" stroke-width="5" stroke-linecap="round"/><path d="M15.2 24.2l9-9" stroke="#FFCB57" stroke-width="2.6" stroke-linecap="round"/>' +
    '<path d="M21.6 21.6l3.9 3.9" stroke="#120C18" stroke-width="4.4" stroke-linecap="round"/><path d="M21.6 21.6l3.9 3.9" stroke="#8A4A22" stroke-width="2.2" stroke-linecap="round"/>' +
    '<circle cx="26.7" cy="26.7" r="2.4" fill="#FFCB57" ' + O + ' stroke-width="1.5"/>';
  var IC = {
    gold: '<svg viewBox="0 0 32 32"><circle cx="16" cy="17.2" r="12.4" fill="#8A5A14" ' + O + ' stroke-width="2.2"/><circle cx="16" cy="15.2" r="12.2" fill="url(#ui-g-gold)" ' + O + ' stroke-width="2.2"/>' +
      '<circle cx="16" cy="15.2" r="8.1" fill="none" stroke="#B8761C" stroke-width="1.5"/><path d="M16 9.4l1.7 3.7 4 .4-3 2.7.9 4-3.6-2.1-3.6 2.1.9-4-3-2.7 4-.4z" fill="#FFF6D6"/>' +
      '<path d="M8.6 11.2a8.6 8.6 0 0 1 6-5" stroke="#fff" stroke-width="2" stroke-linecap="round" fill="none" opacity=".75"/></svg>',
    gem: '<svg viewBox="0 0 32 32"><path d="M9.5 4.5h13l6.5 8.5L16 29 3 13z" fill="url(#ui-g-gem)" ' + O + ' stroke-width="2.2" stroke-linejoin="round"/>' +
      '<path d="M3.5 13h25M9.5 4.5 12.5 13 16 4.5 19.5 13 22.5 4.5M12.5 13 16 28.5 19.5 13" fill="none" stroke="#fff" stroke-opacity=".4" stroke-width="1.1" stroke-linejoin="round"/>' +
      '<path d="M10.4 6.4 12 11.6H6.6z" fill="#fff" opacity=".65"/></svg>',
    bolt: '<svg viewBox="0 0 32 32"><path d="M19 2.5 6 18.5h8.2L11.5 29.5 26 12.8h-8.6z" fill="url(#ui-g-bolt)" ' + O + ' stroke-width="2.2" stroke-linejoin="round"/>' +
      '<path d="M17.2 6.5 10.6 15" stroke="#fff" stroke-width="1.8" stroke-linecap="round" opacity=".8"/></svg>',
    swords: '<svg viewBox="0 0 32 32"><g>' + SWORD + '</g><g transform="matrix(-1 0 0 1 32 0)">' + SWORD + '</g></svg>',
    gear: '<svg viewBox="0 0 32 32"><path d="' + cogD() + '" fill="url(#ui-g-steel)" ' + O + ' stroke-width="2" stroke-linejoin="round"/>' +
      '<circle cx="16" cy="16" r="5.4" fill="#2A2040" ' + O + ' stroke-width="2"/><circle cx="16" cy="16" r="2.2" fill="#9D6BFF"/></svg>',
    lock: '<svg viewBox="0 0 32 32"><path d="M10 14v-3.5a6 6 0 0 1 12 0V14" fill="none" stroke="#120C18" stroke-width="5.4"/><path d="M10 14v-3.5a6 6 0 0 1 12 0V14" fill="none" stroke="#C9CED8" stroke-width="2.6"/>' +
      '<rect x="6.5" y="13.5" width="19" height="15" rx="3.5" fill="url(#ui-g-gold)" ' + O + ' stroke-width="2.2"/><path d="M16 19v4.4" stroke="#5A3A10" stroke-width="2.6" stroke-linecap="round"/><circle cx="16" cy="19" r="2.1" fill="#5A3A10"/></svg>',
    x: '<svg viewBox="0 0 32 32"><path d="M9 9l14 14M23 9 9 23" stroke="#120C18" stroke-width="6" stroke-linecap="round"/><path d="M9 9l14 14M23 9 9 23" stroke="#F4EEFF" stroke-width="3" stroke-linecap="round"/></svg>',
    back: '<svg viewBox="0 0 32 32"><path d="M19.5 6.5 10 16l9.5 9.5" fill="none" stroke="#120C18" stroke-width="6.4" stroke-linecap="round" stroke-linejoin="round"/><path d="M19.5 6.5 10 16l9.5 9.5" fill="none" stroke="#FFCB57" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    left: '<svg viewBox="0 0 32 32"><path d="M20 6 10 16l10 10" fill="none" stroke="#120C18" stroke-width="6.4" stroke-linecap="round" stroke-linejoin="round"/><path d="M20 6 10 16l10 10" fill="none" stroke="#F4EEFF" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    right: '<svg viewBox="0 0 32 32"><path d="M12 6l10 10-10 10" fill="none" stroke="#120C18" stroke-width="6.4" stroke-linecap="round" stroke-linejoin="round"/><path d="M12 6l10 10-10 10" fill="none" stroke="#F4EEFF" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    check: '<svg viewBox="0 0 32 32"><path d="M7 16.5l6 6L25.5 9.5" fill="none" stroke="#120C18" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/><path d="M7 16.5l6 6L25.5 9.5" fill="none" stroke="#5BD16E" stroke-width="3.6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    clock: '<svg viewBox="0 0 32 32"><circle cx="16" cy="17" r="11.5" fill="url(#ui-g-night)" ' + O + ' stroke-width="2.2"/><circle cx="16" cy="17" r="8.4" fill="none" stroke="#FFCB57" stroke-width="1.4" opacity=".7"/>' +
      '<path d="M16 11v6.4l4 2.4" fill="none" stroke="#F4EEFF" stroke-width="2.4" stroke-linecap="round"/><path d="M12.5 3.8h7" stroke="#120C18" stroke-width="4.6" stroke-linecap="round"/><path d="M12.5 3.8h7" stroke="#FFCB57" stroke-width="2.2" stroke-linecap="round"/></svg>',
    skull: '<svg viewBox="0 0 32 32"><path d="M16 4C9.4 4 5.5 8.6 5.5 14.2c0 3.6 1.7 6 4 7.4V26c0 1.2 1 2 2 2h9c1 0 2-.8 2-2v-4.4c2.3-1.4 4-3.8 4-7.4C26.5 8.6 22.6 4 16 4z" fill="#EDE6D8" ' + O + ' stroke-width="2.2"/>' +
      '<ellipse cx="11.6" cy="15.2" rx="3" ry="3.4" fill="#120C18"/><ellipse cx="20.4" cy="15.2" rx="3" ry="3.4" fill="#120C18"/><circle cx="11.6" cy="15.6" r="1.1" fill="#E8394D"/><circle cx="20.4" cy="15.6" r="1.1" fill="#E8394D"/>' +
      '<path d="M16 19.4l-1.6 2.6h3.2z" fill="#120C18"/><path d="M13 25v3M16 25v3M19 25v3" stroke="#120C18" stroke-width="1.4"/></svg>',
    crown: '<svg viewBox="0 0 32 32"><path d="M4.5 11l6 5.5L16 6l5.5 10.5 6-5.5-2.5 15h-18z" fill="url(#ui-g-gold)" ' + O + ' stroke-width="2.2" stroke-linejoin="round"/>' +
      '<path d="M7.5 22.5h17" stroke="#8A5A14" stroke-width="1.6"/><circle cx="16" cy="18.6" r="2.2" fill="#E8394D" ' + O + ' stroke-width="1.2"/><circle cx="4.5" cy="11" r="1.8" fill="#FFF3BF" ' + O + ' stroke-width="1"/><circle cx="27.5" cy="11" r="1.8" fill="#FFF3BF" ' + O + ' stroke-width="1"/><circle cx="16" cy="6" r="1.8" fill="#FFF3BF" ' + O + ' stroke-width="1"/></svg>',
    quest: '<svg viewBox="0 0 32 32"><path d="M9 5.5h14.5a3 3 0 0 1 3 3V25a2.5 2.5 0 0 1-2.5 2.5H11.5A2.5 2.5 0 0 1 9 25z" fill="url(#ui-g-parch)" ' + O + ' stroke-width="2" stroke-linejoin="round"/>' +
      '<path d="M5.5 8.5a3 3 0 0 1 6 0V12h-6z" fill="#C9A060" ' + O + ' stroke-width="2" stroke-linejoin="round"/><path d="M13 11.5h9M13 15.5h9M13 19.5h5" stroke="#7A5530" stroke-width="1.8" stroke-linecap="round"/>' +
      '<path d="M18.5 22.2l2.6 2.6 5.4-6.4" fill="none" stroke="#120C18" stroke-width="4.6" stroke-linecap="round" stroke-linejoin="round"/><path d="M18.5 22.2l2.6 2.6 5.4-6.4" fill="none" stroke="#5BD16E" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    mail: '<svg viewBox="0 0 32 32"><rect x="3.5" y="7.5" width="25" height="18" rx="3" fill="url(#ui-g-parch)" ' + O + ' stroke-width="2.2"/><path d="M4.5 9.5 16 18l11.5-8.5" fill="none" ' + O + ' stroke-width="2" stroke-linejoin="round"/>' +
      '<circle cx="16" cy="18.4" r="4" fill="url(#ui-g-blood)" ' + O + ' stroke-width="1.6"/><path d="M14.6 18.4h2.8M16 17v2.8" stroke="#FFCB57" stroke-width="1.2"/></svg>',
    event: '<svg viewBox="0 0 32 32"><path d="M8 4v25" stroke="#120C18" stroke-width="4.4" stroke-linecap="round"/><path d="M8 4v25" stroke="#C9CED8" stroke-width="2" stroke-linecap="round"/>' +
      '<path d="M9 5h17l-4 6.2 4 6.2H9z" fill="url(#ui-g-blood)" ' + O + ' stroke-width="2" stroke-linejoin="round"/><path d="M18.8 7.8a3.4 3.4 0 1 0 0 6.6 2.8 2.8 0 1 1 0-6.6z" fill="#FFE9A3"/><circle cx="8" cy="3.6" r="2" fill="#FFCB57" ' + O + ' stroke-width="1.2"/></svg>',
    map: '<svg viewBox="0 0 32 32"><path d="M3.5 8l7.5-3 10 3 7.5-3v19.5l-7.5 3-10-3-7.5 3z" fill="url(#ui-g-parch)" ' + O + ' stroke-width="2" stroke-linejoin="round"/>' +
      '<path d="M11 5v19.5M21 8v19.5" stroke="#9A713C" stroke-width="1.3"/><path d="M6.5 21c3-1.2 4-5 7.6-5s4.2 3 7.4 1" fill="none" stroke="#E8394D" stroke-width="1.8" stroke-dasharray="2 2"/>' +
      '<path d="M21.6 10.4l3.4 3.4m0-3.4-3.4 3.4" stroke="#120C18" stroke-width="3.6" stroke-linecap="round"/><path d="M21.6 10.4l3.4 3.4m0-3.4-3.4 3.4" stroke="#E8394D" stroke-width="1.8" stroke-linecap="round"/></svg>',
    shop: '<svg viewBox="0 0 32 32"><path d="M11.5 9.5c-4.6 3-7.5 7.6-7.5 12 0 4.6 4.6 7 12 7s12-2.4 12-7c0-4.4-2.9-9-7.5-12z" fill="url(#ui-g-ember)" ' + O + ' stroke-width="2.2" stroke-linejoin="round"/>' +
      '<path d="M11 9.6c-1.6-2.4-1-5 1.6-5.6 1.4-.3 2.4.6 3.4.6s2-.9 3.4-.6c2.6.6 3.2 3.2 1.6 5.6z" fill="#C2701A" ' + O + ' stroke-width="2" stroke-linejoin="round"/>' +
      '<path d="M10.5 10.2h11" stroke="#FFCB57" stroke-width="2.4" stroke-linecap="round"/><circle cx="16" cy="19.6" r="4.6" fill="url(#ui-g-gold)" ' + O + ' stroke-width="1.8"/>' +
      '<path d="M16 17.2v4.8M14.4 18.4h3.2" stroke="#8A5A14" stroke-width="1.4" stroke-linecap="round"/><path d="M8.4 16c.8-2 2-3.4 3.6-4.4" stroke="#fff" stroke-width="1.8" stroke-linecap="round" opacity=".55" fill="none"/></svg>',
    chest: '<svg viewBox="0 0 32 32"><path d="M4.5 14h23v12a2 2 0 0 1-2 2h-19a2 2 0 0 1-2-2z" fill="#7A4424" ' + O + ' stroke-width="2.2"/><path d="M4.5 14c0-6 4.6-9 11.5-9s11.5 3 11.5 9z" fill="#9A5A30" ' + O + ' stroke-width="2.2"/>' +
      '<path d="M4.5 14h23M10 5.8V28M22 5.8V28" stroke="#FFCB57" stroke-width="2"/><rect x="13.4" y="12" width="5.2" height="6.4" rx="1.2" fill="url(#ui-g-gold)" ' + O + ' stroke-width="1.6"/></svg>',
    scroll: '<svg viewBox="0 0 32 32"><path d="M8 6h16v20H8z" fill="url(#ui-g-parch)" ' + O + ' stroke-width="2"/><rect x="5.5" y="4" width="21" height="4.4" rx="2.2" fill="currentColor" ' + O + ' stroke-width="2"/>' +
      '<rect x="5.5" y="23.6" width="21" height="4.4" rx="2.2" fill="currentColor" ' + O + ' stroke-width="2"/><path d="M11.5 12.5h9M11.5 16h9M11.5 19.5h6" stroke="#7A5530" stroke-width="1.6" stroke-linecap="round"/></svg>',
    shard: '<svg viewBox="0 0 32 32"><path d="M16 3l7 9-3 16h-8L9 12z" fill="url(#ui-g-violet)" ' + O + ' stroke-width="2.2" stroke-linejoin="round"/><path d="M16 3v25M9 12h14" stroke="#fff" stroke-opacity=".35" stroke-width="1.1"/><path d="M13 7l-2 4" stroke="#fff" stroke-width="1.6" opacity=".7" stroke-linecap="round"/></svg>',
    sound: '<svg viewBox="0 0 32 32"><path d="M5 12.5h5l7-6v19l-7-6H5z" fill="url(#ui-g-steel)" ' + O + ' stroke-width="2.2" stroke-linejoin="round"/><path d="M21 11.5c2.2 2.4 2.2 6.6 0 9M24.4 8.4c4 4.2 4 11 0 15.2" fill="none" stroke="#FFCB57" stroke-width="2.2" stroke-linecap="round"/></svg>',
    music: '<svg viewBox="0 0 32 32"><path d="M12 23V7.5l14-3V20" fill="none" stroke="#120C18" stroke-width="4.6" stroke-linejoin="round"/><path d="M12 23V7.5l14-3V20" fill="none" stroke="#C9CED8" stroke-width="2.2" stroke-linejoin="round"/>' +
      '<ellipse cx="8.6" cy="23.4" rx="4.4" ry="3.4" fill="url(#ui-g-violet)" ' + O + ' stroke-width="2"/><ellipse cx="22.6" cy="20.4" rx="4.4" ry="3.4" fill="url(#ui-g-violet)" ' + O + ' stroke-width="2"/></svg>',
    user: '<svg viewBox="0 0 32 32"><circle cx="16" cy="11" r="6" fill="url(#ui-g-parch)" ' + O + ' stroke-width="2.2"/><path d="M5 28c0-6.4 5-10 11-10s11 3.6 11 10z" fill="url(#ui-g-violet)" ' + O + ' stroke-width="2.2"/></svg>',
    trash: '<svg viewBox="0 0 32 32"><path d="M8 10h16l-1.4 16a2 2 0 0 1-2 1.8h-9.2a2 2 0 0 1-2-1.8z" fill="url(#ui-g-blood)" ' + O + ' stroke-width="2.2" stroke-linejoin="round"/><path d="M5.5 9.5h21M12.5 9V6h7v3" fill="none" ' + O + ' stroke-width="2.4" stroke-linecap="round"/><path d="M13 14v9M19 14v9" stroke="#120C18" stroke-width="1.6" opacity=".6"/></svg>',
    info: '<svg viewBox="0 0 32 32"><circle cx="16" cy="16" r="12" fill="url(#ui-g-violet)" ' + O + ' stroke-width="2.2"/><path d="M16 14v8" stroke="#fff" stroke-width="3" stroke-linecap="round"/><circle cx="16" cy="9.8" r="1.9" fill="#fff"/></svg>',
    warn: '<svg viewBox="0 0 32 32"><path d="M16 4 29 27H3z" fill="url(#ui-g-blood)" ' + O + ' stroke-width="2.2" stroke-linejoin="round"/><path d="M16 12v7" stroke="#fff" stroke-width="3" stroke-linecap="round"/><circle cx="16" cy="23" r="1.8" fill="#fff"/></svg>',
    star: '<svg viewBox="0 0 32 32"><path d="M16 3.5l3.7 8 8.7 1-6.4 6 1.8 8.6L16 22.7l-7.8 4.4L10 18.5l-6.4-6 8.7-1z" fill="url(#ui-g-gold)" ' + O + ' stroke-width="2" stroke-linejoin="round"/></svg>',
    shield: '<svg viewBox="0 0 32 32"><path d="M16 3.5l11 4v8.5c0 6.6-4.6 11-11 13-6.4-2-11-6.4-11-13V7.5z" fill="url(#ui-g-steel)" ' + O + ' stroke-width="2.2" stroke-linejoin="round"/><path d="M16 7.5l7 2.6v6c0 4.4-2.8 7.4-7 9z" fill="url(#ui-g-blood)" opacity=".9"/></svg>',
    bell: '<svg viewBox="0 0 32 32"><path d="M16 4.5c-5 0-8 3.6-8 8.6v5.4l-2.6 4h21.2l-2.6-4v-5.4c0-5-3-8.6-8-8.6z" fill="url(#ui-g-gold)" ' + O + ' stroke-width="2.2" stroke-linejoin="round"/><path d="M12.6 25.4a3.4 3.4 0 0 0 6.8 0" fill="none" ' + O + ' stroke-width="2.2"/></svg>',
    /* nav icons (viewBox 40) */
    helm: '<svg viewBox="0 0 40 40"><path d="M20 2.6c5.2 2 6.8 6.2 5.6 10.4H14.4C13.2 8.8 14.8 4.6 20 2.6z" fill="url(#ui-g-blood)" ' + O + ' stroke-width="2" stroke-linejoin="round"/>' +
      '<path d="M7.5 23C7.5 14 13 9.6 20 9.6S32.5 14 32.5 23v8.6c0 2.4-2 4-4.4 4H11.9c-2.4 0-4.4-1.6-4.4-4z" fill="url(#ui-g-steel)" ' + O + ' stroke-width="2.2"/>' +
      '<path d="M8.4 18.6c3.8-2 7.8-3 11.6-3s7.8 1 11.6 3" fill="none" stroke="#FFCB57" stroke-width="2.2"/><path d="M10.6 22.4h18.8" stroke="#120C18" stroke-width="3.6" stroke-linecap="round"/>' +
      '<path d="M20 22.4v11.4" stroke="#120C18" stroke-width="2.2"/><path d="M13 27.4h3.4M23.6 27.4H27M13 30.6h3.4M23.6 30.6H27" stroke="#3A3F52" stroke-width="1.5" stroke-linecap="round"/>' +
      '<path d="M12 15.2c1.4-2 3-3.1 5.2-3.6" stroke="#fff" stroke-width="2" stroke-linecap="round" opacity=".8" fill="none"/></svg>',
    hood: '<svg viewBox="0 0 40 40"><path d="M20 2.5c2 3 9 4.5 12.4 10.6 1.4 2.6 2.1 5.4 2.1 8.4V31c0 3-2 4.5-5 4.5H10.5c-3 0-5-1.5-5-4.5v-9.5c0-3 .7-5.8 2.1-8.4C11 7 18 5.5 20 2.5z" fill="url(#ui-g-violet)" ' + O + ' stroke-width="2.2" stroke-linejoin="round"/>' +
      '<ellipse cx="20" cy="21.4" rx="9.4" ry="8.4" fill="#120C18"/><ellipse cx="16.3" cy="21.8" rx="2.1" ry="2.7" fill="#FFCB57"/><ellipse cx="23.7" cy="21.8" rx="2.1" ry="2.7" fill="#FFCB57"/>' +
      '<circle cx="16.9" cy="20.8" r=".8" fill="#fff"/><circle cx="24.3" cy="20.8" r=".8" fill="#fff"/><circle cx="20" cy="33" r="2.6" fill="url(#ui-g-gold)" ' + O + ' stroke-width="1.6"/>' +
      '<path d="M10.4 14.6c1.6-3.6 4.4-6 7.6-7" stroke="#fff" stroke-width="2" opacity=".55" fill="none" stroke-linecap="round"/></svg>',
    tome: '<svg viewBox="0 0 40 40"><path d="M3.5 12c6-2.5 11.5-2 16.5 1.5 5-3.5 10.5-4 16.5-1.5v21.5c-6-2.5-11.5-2-16.5 1.5-5-3.5-10.5-4-16.5-1.5z" fill="#5A23A0" ' + O + ' stroke-width="2.2" stroke-linejoin="round"/>' +
      '<path d="M6 11.6c5-1.8 9.5-1.2 14 2V33c-4.5-3.2-9-3.8-14-2zM34 11.6c-5-1.8-9.5-1.2-14 2V33c4.5-3.2 9-3.8 14-2z" fill="url(#ui-g-parch)" ' + O + ' stroke-width="1.6" stroke-linejoin="round"/>' +
      '<path d="M9 18.4c2.5-.7 5-.5 7.5.6M9 22.4c2.5-.7 5-.5 7.5.6M9 26.4c2.5-.7 5-.5 7.5.6M23.5 19c2.5-1.1 5-1.3 7.5-.6M23.5 23c2.5-1.1 5-1.3 7.5-.6M23.5 27c2.5-1.1 5-1.3 7.5-.6" stroke="#9A713C" stroke-width="1.3" stroke-linecap="round" fill="none"/>' +
      '<path d="M20 3.2l6.4 7.4h-3.8v6.6h-5.2v-6.6h-3.8z" fill="url(#ui-g-green)" ' + O + ' stroke-width="1.8" stroke-linejoin="round"/></svg>',
    trophy: '<svg viewBox="0 0 40 40"><path d="M12 9.5H7.4c0 5.4 2.2 8.6 6 9.2M28 9.5h4.6c0 5.4-2.2 8.6-6 9.2" fill="none" stroke="#120C18" stroke-width="4.6"/>' +
      '<path d="M12 9.5H7.4c0 5.4 2.2 8.6 6 9.2M28 9.5h4.6c0 5.4-2.2 8.6-6 9.2" fill="none" stroke="#FFCB57" stroke-width="2"/>' +
      '<path d="M11.5 5.5h17V14c0 6.4-3.8 10.6-8.5 10.6S11.5 20.4 11.5 14z" fill="url(#ui-g-gold)" ' + O + ' stroke-width="2.2" stroke-linejoin="round"/>' +
      '<path d="M17.4 24.4h5.2v5h-5.2z" fill="#B8761C" ' + O + ' stroke-width="2"/><path d="M11.5 29.4h17l1.6 5.6H9.9z" fill="url(#ui-g-blood)" ' + O + ' stroke-width="2.2" stroke-linejoin="round"/>' +
      '<path d="M20 9.2l1.5 3.1 3.4.4-2.5 2.3.7 3.4-3.1-1.8-3.1 1.8.7-3.4-2.5-2.3 3.4-.4z" fill="#FFF6D6"/><path d="M14.6 8.6v5c0 2 .8 4 2 5.2" stroke="#fff" stroke-width="2" fill="none" opacity=".6" stroke-linecap="round"/></svg>',
    bigswords: '<svg viewBox="0 0 32 32"><g>' + SWORD + '</g><g transform="matrix(-1 0 0 1 32 0)">' + SWORD + '</g></svg>'
  };
  function ic(name, cls) {
    var s = IC[name] || IC.info;
    return s.replace('<svg ', '<svg class="ui-ic' + (cls ? ' ' + cls : '') + '" aria-hidden="true" focusable="false" ');
  }

  /* ============================================================================================
   * Module state
   * ========================================================================================== */
  var UI = {};
  var ROOT = null, LOBBY = null, TOP = null, SCREEN = null, NAV = null, LAYER = null, BGHOST = null;
  var REG = {};                       // id -> def
  var CUR = null;                     // { id, def, el, params, tab }
  var HIST = [];                      // stack of { id, params }
  var TABS = [
    { id: 'ekipman', n: 'Ekipman', ic: 'helm' },
    { id: 'kahraman', n: 'Kahramanlar', ic: 'hood' },
    { id: 'savas', n: 'Savaş', ic: 'bigswords', big: true },
    { id: 'gelisim', n: 'Gelişim', ic: 'tome' },
    { id: 'arena', n: 'Arena', ic: 'trophy' }];
  var TAB_IDX = { ekipman: 0, kahraman: 1, savas: 2, gelisim: 3, arena: 4 };
  var T = 0;                          // last frame time (s)
  var needRefresh = false, inited = false;
  var MODALS = [], TOASTS = [];
  var TW = [];                        // number tweens
  var TICKERS = [];                   // fn(dt, t) -> false to remove
  var PORTAL = null, RES = null;

  /* ============================================================================================
   * Canvas helper (SPEC: UI.canvas(el, draw) -> { cv, stop() })
   * ========================================================================================== */
  var CVS = [], IO = null, RO = null;
  function cvRec(cv) { for (var i = 0; i < CVS.length; i++) if (CVS[i].cv === cv) return CVS[i]; return null; }
  function setupObservers() {
    try {
      if (window.IntersectionObserver) IO = new IntersectionObserver(function (ents) {
        ents.forEach(function (en) { var r = cvRec(en.target); if (r) r.vis = en.isIntersecting; });
      });
    } catch (e) { IO = null; }
    try {
      if (window.ResizeObserver) RO = new ResizeObserver(function (ents) {
        ents.forEach(function (en) {
          var r = cvRec(en.target);
          if (r) { var cr = en.contentRect; r.cw = cr.width; r.ch = cr.height; r.dirtySize = true; }
          if (en.target === ROOT || en.target === LOBBY) { BG.dirty = true; HOME.dirty = true; }
        });
      });
    } catch (e2) { RO = null; }
  }
  function canvasHelper(host, draw, opts) {
    opts = opts || {};
    var cv = document.createElement('canvas');
    cv.className = 'ui-cv' + (opts.cls ? ' ' + opts.cls : '');
    if (host) host.appendChild(cv);
    var rec = {
      host: host, cv: cv, ctx: cv.getContext('2d'), draw: draw, w: 0, h: 0, cw: 0, ch: 0, dpr: 0, vis: true,
      keep: !!opts.keep, fps: +opts.fps || 0, once: !!opts.once, acc: 1e9, dead: false, seen: false, miss: 0,
      dirtySize: true, resized: true, drawn: false, data: opts.data || {}
    };
    rec.stop = function () {
      if (rec.dead) return; rec.dead = true;
      try { if (IO) IO.unobserve(cv); if (RO) RO.unobserve(cv); } catch (e) { /* ignore */ }
    };
    rec.redraw = function () { rec.drawn = false; rec.acc = 1e9; };
    CVS.push(rec);
    try { if (IO) IO.observe(cv); if (RO) RO.observe(cv); } catch (e) { /* ignore */ }
    return rec;
  }
  function drawCanvases(dt, t) {
    var dpr = DPR(), resOpen = !!RES, i, r;
    for (i = CVS.length - 1; i >= 0; i--) {
      r = CVS[i];
      if (r.dead) { CVS.splice(i, 1); continue; }
      if (!r.cv.isConnected) { if (r.seen && ++r.miss > 90) { r.stop(); CVS.splice(i, 1); } continue; }
      r.seen = true; r.miss = 0;
      if (!r.vis) continue;
      if (resOpen && !RES.el.contains(r.cv)) continue;
      if (r.dirtySize || !RO) { if (!RO) { r.cw = r.cv.clientWidth; r.ch = r.cv.clientHeight; } r.dirtySize = false; }
      var w = r.cw, h = r.ch;
      if (w < 1 || h < 1) continue;
      if (w !== r.w || h !== r.h || dpr !== r.dpr) {
        r.w = w; r.h = h; r.dpr = dpr;
        r.cv.width = mx(1, round(w * dpr)); r.cv.height = mx(1, round(h * dpr));
        r.resized = true; r.drawn = false;
      }
      if (r.once && r.drawn) continue;
      if (r.fps > 0) { r.acc += dt; if (r.acc < 1 / r.fps && r.drawn) continue; r.acc = 0; }
      var ctx = r.ctx;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      if (!r.keep) ctx.clearRect(0, 0, w, h);
      try { r.draw(ctx, w, h, t, r); } catch (e) { report(e, 'canvas draw'); r.stop(); }
      ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
      r.resized = false; r.drawn = true;
    }
  }

  /* ============================================================================================
   * Number tweens, tickers
   * ========================================================================================== */
  function tweenNum(el, from, to, dur, f) {
    for (var i = TW.length - 1; i >= 0; i--) if (TW[i].el === el) TW.splice(i, 1);
    if (!el) return;
    if (RM || dur <= 0 || from === to) { el.textContent = (f || fmt)(to); return; }
    TW.push({ el: el, a: from, b: to, d: dur, t: 0, f: f || fmt });
  }
  function stepTweens(dt) {
    for (var i = TW.length - 1; i >= 0; i--) {
      var w = TW[i]; w.t += dt;
      var k = eOut(w.t / w.d);
      w.el.textContent = w.f(lerp(w.a, w.b, k));
      if (k >= 1) TW.splice(i, 1);
    }
  }
  function ticker(fn) { TICKERS.push(fn); }

  /* ============================================================================================
   * Rect helpers relative to #gm
   * ========================================================================================== */
  function rootRect() { return ROOT ? ROOT.getBoundingClientRect() : { left: 0, top: 0, width: 390, height: 844 }; }
  function relRect(el) {
    var R = rootRect(), r = el.getBoundingClientRect();
    return { x: r.left - R.left, y: r.top - R.top, w: r.width, h: r.height };
  }

  /* ============================================================================================
   * Overlays: modal, toast, confirm, floatNum
   * ========================================================================================== */
  UI.modal = function (content, o) {
    o = o || {};
    if (!LAYER) return { el: mk('div'), body: mk('div'), close: function () {} };
    var back = mk('div', 'modal-back ui-mback');
    var box = mk('div', 'modal ui-modal' + (o.cls ? ' ' + o.cls : ''));
    box.setAttribute('role', 'dialog');
    var head = o.title != null
      ? '<div class="modal-h ui-mh"><div class="ttl ui-mt">' + esc(o.title) + '</div><button class="x" type="button" aria-label="Kapat">' + ic('x') + '</button></div>'
      : '<button class="x ui-mx" type="button" aria-label="Kapat">' + ic('x') + '</button>';
    box.innerHTML = head + '<div class="ui-mbody"></div>';
    var body = box.querySelector('.ui-mbody');
    if (typeof content === 'string') body.innerHTML = content;
    else if (content && content.nodeType) body.appendChild(content);
    back.appendChild(box);
    LAYER.appendChild(back);
    var closed = false;
    var m = { el: box, body: body, back: back };
    m.close = function () {
      if (closed) return; closed = true;
      var i = MODALS.indexOf(m); if (i >= 0) MODALS.splice(i, 1);
      snd('close');
      back.classList.add('ui-closing');
      setTimeout(function () { if (back.parentNode) back.parentNode.removeChild(back); }, 170);
      if (typeof o.onClose === 'function') safe(o.onClose, 'modal onClose');
    };
    back.addEventListener('click', function (e) { if (e.target === back && o.dismiss !== false) m.close(); });
    var xb = box.querySelector('.x'); if (xb) xb.addEventListener('click', function () { m.close(); });
    MODALS.push(m);
    if (!o.silent) snd('open');
    return m;
  };
  UI.closeModals = function () { MODALS.slice().forEach(function (m) { m.close(); }); };

  var TOAST_IC = { ok: 'check', warn: 'warn', rare: 'star', info: 'info' };
  UI.toast = function (text, kind) {
    if (!LAYER) return null;
    kind = TOAST_IC[kind] ? kind : 'info';
    var t = mk('div', 'toast ui-toast ' + kind, ic(TOAST_IC[kind], 'ui-toast-ic') + '<span>' + esc(text) + '</span>');
    t.setAttribute('role', 'status');
    LAYER.appendChild(t);
    TOASTS.push(t);
    while (TOASTS.length > 3) { var old = TOASTS.shift(); if (old.parentNode) old.parentNode.removeChild(old); }
    restackToasts();
    if (kind === 'warn') snd('error'); else if (kind === 'rare') snd('rare');
    setTimeout(function () {
      var i = TOASTS.indexOf(t); if (i >= 0) TOASTS.splice(i, 1);
      if (t.parentNode) t.parentNode.removeChild(t);
      restackToasts();
    }, 2450);
    return t;
  };
  function restackToasts() {
    var base = 70;
    if (TOP && LOBBY && !LOBBY.hidden && TOP.offsetHeight) base = TOP.offsetHeight + 10;
    TOASTS.forEach(function (t, i) { t.style.top = (base + (TOASTS.length - 1 - i) * 44) + 'px'; });
  }

  UI.confirm = function (o) {
    o = o || {};
    return new Promise(function (resolve) {
      var done = false;
      var body = mk('div', 'ui-confirm',
        (o.icon ? '<div class="ui-confirm-ic">' + ic(o.icon) + '</div>' : '') +
        '<p class="ui-confirm-t">' + esc(o.text || '') + '</p>' +
        '<div class="ui-row2"><button class="btn btn-dark ui-c-no" type="button">' + esc(o.cancel || 'Vazgeç') + '</button>' +
        '<button class="btn ' + (o.danger ? 'btn-red' : 'btn-gold') + ' ui-c-yes" type="button">' + esc(o.ok || 'Tamam') + '</button></div>');
      var m = UI.modal(body, { title: o.title || 'Emin misin?', cls: 'ui-confirm-m', onClose: function () { if (!done) { done = true; resolve(false); } } });
      body.querySelector('.ui-c-yes').addEventListener('click', function () { if (!done) { done = true; resolve(true); } snd('click'); m.close(); });
      body.querySelector('.ui-c-no').addEventListener('click', function () { m.close(); });
    });
  };

  UI.floatNum = function (target, text, color) {
    if (!LAYER || !target) return;
    var x, y;
    if (target.nodeType) { var r = relRect(target); x = r.x + r.w / 2; y = r.y + r.h * 0.35; }
    else { x = +target.x || 0; y = +target.y || 0; }
    var f = mk('div', 'ui-float num', esc(text));
    f.style.left = x + 'px'; f.style.top = y + 'px';
    if (color) f.style.color = color;
    LAYER.appendChild(f);
    setTimeout(function () { if (f.parentNode) f.parentNode.removeChild(f); }, 1150);
  };

  /* ============================================================================================
   * Top bar
   * ========================================================================================== */
  var TB = { built: false, shown: {}, portraitKey: '', pow: null, gold: null, gems: null, enKey: '', lastTick: -1 };
  function buildTop() {
    TOP.classList.add('ui-top');
    TOP.innerHTML = DEFS +
      '<button class="ui-acc" type="button" aria-label="Profil">' +
        '<span class="ui-acc-pic"></span>' +
        '<svg class="ui-acc-ring" viewBox="0 0 56 56" aria-hidden="true"><circle class="ui-ring-bg" cx="28" cy="28" r="25"/><circle class="ui-ring-fg" cx="28" cy="28" r="25"/></svg>' +
        '<span class="ui-acc-lv num">1</span>' +
      '</button>' +
      '<div class="ui-tb-main">' +
        '<div class="ui-tb-id">' +
          '<span class="ui-tb-name">Muhafız</span>' +
          '<span class="ui-tb-pow" title="Savaş Gücü">' + ic('swords') + '<b class="num">0</b></span>' +
          '<button class="ui-gear" type="button" aria-label="Ayarlar">' + ic('gear') + '</button>' +
        '</div>' +
        '<div class="ui-tb-res">' +
          '<button class="chip ui-chip ui-chip-en" type="button" aria-label="Enerji">' + ic('bolt', 'ico') + '<b class="num">30/30</b><span class="plus">+</span><i class="ui-en-t num" hidden></i></button>' +
          '<button class="chip ui-chip ui-chip-gold" type="button" aria-label="Altın">' + ic('gold', 'ico') + '<b class="num">0</b><span class="plus">+</span></button>' +
          '<button class="chip ui-chip ui-chip-gem" type="button" aria-label="Elmas">' + ic('gem', 'ico') + '<b class="num">0</b><span class="plus">+</span></button>' +
        '</div>' +
      '</div>';
    TB.pic = canvasHelper($('.ui-acc-pic', TOP), function (ctx, w, h, t) {
      var id = activeId(), hs = heroSt(id);
      if (GM.Art && GM.Art.drawHeroPortrait) GM.Art.drawHeroPortrait(ctx, 0, 0, w, id, t, hs && hs.skin ? hs.skin : (call('skinFor', 'hero:' + id) || null));
      else { ctx.fillStyle = '#2F2440'; ctx.fillRect(0, 0, w, h); }
    }, { fps: 12 });
    $('.ui-acc', TOP).addEventListener('click', function () { snd('click'); openProfile(); });
    $('.ui-gear', TOP).addEventListener('click', function () { snd('click'); UI.go('ayarlar'); });
    $('.ui-chip-en', TOP).addEventListener('click', function () { snd('click'); UI.openShop('energy'); });
    $('.ui-chip-gold', TOP).addEventListener('click', function () { snd('click'); UI.openShop('gold'); });
    $('.ui-chip-gem', TOP).addEventListener('click', function () { snd('click'); UI.openShop('gems'); });
    $('.ui-tb-pow', TOP).addEventListener('click', function () { snd('click'); UI.go('ekipman'); });
    TB.built = true;
  }
  function setNum(key, el, v, animate) {
    var prev = TB.shown[key];
    TB.shown[key] = v;
    if (prev == null || !animate) { el.textContent = fmtC(v); return; }
    if (prev !== v) {
      tweenNum(el, prev, v, 0.7, fmtC);
      var chip = el.closest('.ui-chip, .ui-tb-pow');
      if (chip) { chip.classList.remove('ui-bump'); void chip.offsetWidth; chip.classList.add('ui-bump'); }
    }
  }
  UI.refreshTop = function () {
    if (!TOP || !TB.built) return;
    var p = P();
    var acc = accInfo();
    $('.ui-acc-lv', TOP).textContent = acc.lvl;
    var C = 2 * PI * 25;
    var ring = $('.ui-ring-fg', TOP);
    ring.style.strokeDasharray = C.toFixed(1);
    ring.style.strokeDashoffset = (C * (1 - clamp(acc.pct, 0, 1))).toFixed(1);
    $('.ui-tb-name', TOP).textContent = (p && p.name) || 'Muhafız';
    var powEl = $('.ui-tb-pow b', TOP), pw = curPower();
    var prevPow = TB.shown.pow;
    setNum('pow', powEl, pw, true);
    if (prevPow != null && pw > prevPow && !LOBBY.hidden) UI.floatNum($('.ui-tb-pow', TOP), '+' + fmt(pw - prevPow), '#5BD16E');
    setNum('gold', $('.ui-chip-gold b', TOP), p ? p.gold : 0, true);
    setNum('gems', $('.ui-chip-gem b', TOP), p ? p.gems : 0, true);
    tickEnergy(true);
    TB.pic.redraw();
  };
  function tickEnergy(force) {
    if (!TB.built) return;
    var e = energyInfo();
    var key = e.cur + '/' + e.max + '|' + (e.full ? '' : e.nextInSec);
    if (!force && key === TB.enKey) return;
    TB.enKey = key;
    var chip = $('.ui-chip-en', TOP);
    $('b', chip).textContent = fmt(e.cur) + '/' + fmt(e.max);
    chip.classList.toggle('ui-over', e.cur > e.max);
    var tEl = $('.ui-en-t', chip);
    if (e.full || e.cur >= e.max) { tEl.hidden = true; }
    else { tEl.hidden = false; tEl.textContent = '+1 ' + fmtTime(e.nextInSec); }
    if (CUR && CUR.id === 'savas') homeUpdateStart();
  }

  /* ============================================================================================
   * Bottom nav
   * ========================================================================================== */
  var NB = { built: false, last: '' };
  function buildNav() {
    NAV.classList.add('ui-nav');
    NAV.innerHTML = '<div class="ui-nav-bar"></div>' + TABS.map(function (tb) {
      return '<button class="ui-tab' + (tb.big ? ' ui-tab-c' : '') + '" type="button" data-tab="' + tb.id + '" aria-label="' + esc(tb.n) + '">' +
        (tb.big ? '<span class="ui-medal"><span class="ui-medal-ring"></span><span class="ui-medal-in">' + ic(tb.ic, 'ui-tab-ic') + '</span></span>'
          : '<span class="ui-tab-icw">' + ic(tb.ic, 'ui-tab-ic') + '</span>') +
        '<span class="ui-tab-n">' + esc(tb.n) + '</span><b class="dot" hidden></b></button>';
    }).join('');
    $$('.ui-tab', NAV).forEach(function (b) {
      b.addEventListener('click', function () {
        var id = b.getAttribute('data-tab');
        if (CUR && CUR.tab === id && CUR.id === id) { snd('click'); if (CUR.def && CUR.def.refresh) safe(function () { CUR.def.refresh(); }, 'refresh'); return; }
        snd('tab');
        HIST.length = 0;
        UI.go(id);
      });
    });
    NB.built = true;
  }
  function navActive(tab) {
    if (!NB.built) return;
    $$('.ui-tab', NAV).forEach(function (b) { b.classList.toggle('on', b.getAttribute('data-tab') === tab); });
  }
  function hintBadges() {
    var h = call('hints');
    if (!h) return {};
    return {
      ekipman: (h.newItems || 0) + (h.upgradable ? 1 : 0) + (h.mergeable ? 1 : 0),
      kahraman: (h.heroLevel || 0) + (h.heroStar || 0) + (h.heroUnlock || 0) + (h.talentFree > 0 ? 1 : 0),
      gelisim: h.train ? 1 : 0
    };
  }
  function refreshNav() {
    if (!NB.built) return;
    var b = {};
    try {
      if (GM.UIMeta && typeof GM.UIMeta.badges === 'function') b = GM.UIMeta.badges() || {};
      else b = hintBadges();
    } catch (e) { b = {}; }
    b.savas = claimableCount();
    var key = JSON.stringify(b);
    if (key === NB.last) return;
    NB.last = key;
    $$('.ui-tab', NAV).forEach(function (btn) {
      var id = btn.getAttribute('data-tab'), n = +b[id] || (b[id] === true ? 1 : 0), d = $('.dot', btn);
      d.hidden = !(n > 0);
      d.textContent = n > 9 ? '9+' : String(n);
    });
  }

  /* ============================================================================================
   * Router
   * ========================================================================================== */
  UI.reg = function (id, def) {
    if (!id || !def) return;
    REG[id] = def;
    if (CUR && CUR.id === id && CUR.placeholder) UI.go(id, CUR.params, { dir: 'fade', replace: true });
  };
  UI.isReg = function (id) { return !!REG[id]; };

  function placeholderDef(id) {
    var tb = null; TABS.forEach(function (x) { if (x.id === id) tb = x; });
    return {
      title: tb ? tb.n : 'Hazırlanıyor', tab: tb ? id : null, bg: 'dim',
      mount: function (el) {
        el.classList.add('ui-ph-scr');
        el.innerHTML = '<div class="ui-wip panel"><div class="ui-wip-ic">' + ic(tb ? tb.ic : 'gear') + '</div>' +
          '<div class="ttl ui-wip-t">' + esc(tb ? tb.n : 'Hazırlanıyor') + '</div>' +
          '<p class="muted">Demirciler bu bölümün son dokunuşlarını yapıyor. Birazdan burada olacak.</p>' +
          '<button class="btn btn-dark btn-sm ui-wip-b" type="button">Savaşa Dön</button></div>';
        $('.ui-wip-b', el).addEventListener('click', function () { snd('click'); UI.go('savas'); });
      }
    };
  }
  function tabOf(id, def) {
    if (def && def.tab !== undefined) return def.tab;
    return TAB_IDX[id] != null ? id : null;
  }

  UI.go = function (id, params, opts) {
    if (!SCREEN) return;
    opts = opts || {};
    id = String(id || 'savas');
    var def = REG[id], ph = false;
    if (!def) { def = placeholderDef(id); ph = true; }
    var tab = tabOf(id, def);
    var prev = CUR;
    // direction
    var dir = opts.dir;
    if (!dir) {
      if (!prev) dir = 'none';
      else if (tab && prev.tab && TAB_IDX[tab] != null && TAB_IDX[prev.tab] != null && TAB_IDX[id] != null) dir = TAB_IDX[tab] >= TAB_IDX[prev.tab] ? 'left' : 'right';
      else dir = 'left';
    }
    // history (sub-screens push, tab roots reset)
    if (prev && !opts.replace && !opts.fromBack) {
      if (TAB_IDX[id] != null) HIST.length = 0;
      else if (prev.id !== id) HIST.push({ id: prev.id, params: prev.params });
      if (HIST.length > 20) HIST.shift();
    }
    // unmount old
    if (prev) {
      safe(function () { if (prev.def.unmount) prev.def.unmount(); }, 'unmount ' + prev.id);
      var old = prev.el;
      old.classList.add('ui-leaving');
      old.setAttribute('aria-hidden', 'true');
      if (dir === 'none' || RM) { if (old.parentNode) old.parentNode.removeChild(old); }
      else {
        old.classList.add(dir === 'left' ? 'ui-out-l' : dir === 'right' ? 'ui-out-r' : 'ui-out-f');
        setTimeout(function () { if (old.parentNode) old.parentNode.removeChild(old); }, 340);
      }
    }
    var el = mk('section', 'ui-scr');
    el.setAttribute('data-scr', id);
    if (dir !== 'none' && !RM) el.classList.add(dir === 'left' ? 'ui-in-r' : dir === 'right' ? 'ui-in-l' : 'ui-in-f');
    SCREEN.appendChild(el);
    CUR = { id: id, def: def, el: el, params: params || null, tab: tab || (prev ? prev.tab : null), placeholder: ph };
    UI.current = id; UI.params = params || null; UI.tab = CUR.tab;
    BG.mode = def.bg || (id === 'savas' ? 'home' : 'dim');
    navActive(CUR.tab);
    safe(function () { def.mount(el, params || {}); }, 'mount ' + id);
    setTimeout(function () { el.classList.remove('ui-in-r', 'ui-in-l', 'ui-in-f'); }, 360);
    refreshNav();
    restackToasts();
    return el;
  };
  UI.back = function () {
    if (MODALS.length) { MODALS[MODALS.length - 1].close(); return; }
    var h = HIST.pop();
    if (h) UI.go(h.id, h.params, { dir: 'right', fromBack: true });
    else if (!CUR || CUR.id !== 'savas') UI.go('savas', null, { dir: 'right', fromBack: true });
  };
  UI.refresh = function () {
    needRefresh = false;
    safe(UI.refreshTop, 'refreshTop');
    safe(refreshNav, 'refreshNav');
    if (CUR && CUR.def && typeof CUR.def.refresh === 'function') safe(function () { CUR.def.refresh(); }, 'refresh ' + CUR.id);
    if (CUR && CUR.id === 'savas') safe(homeRefresh, 'home refresh');
  };

  /* ============================================================================================
   * Lobby backdrop: gothic cathedral + light shafts + dust + embers + rune altar + hero
   * ========================================================================================== */
  var BG = {
    rec: null, mode: 'home', mix: 1, dirty: true, back: null, backKey: '', shafts: null, fog: null,
    altar: null, altarKey: '', ring: null, ringKey: '', beam: null, glowKey: '', embers: [], motes: [], sparks: [],
    candles: [], frameAcc: 0, rose: null
  };
  var GLOWS = {};
  function glowSprite(col, soft) {
    var k = col + (soft ? 's' : '');
    if (GLOWS[k]) return GLOWS[k];
    var s = 64, c = offCv(s, s), g = c.getContext('2d'), gr = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    gr.addColorStop(0, soft ? rgba(col, 0.55) : 'rgba(255,255,255,1)');
    gr.addColorStop(soft ? 0.3 : 0.12, rgba(col, soft ? 0.32 : 0.95));
    gr.addColorStop(soft ? 0.65 : 0.35, rgba(col, soft ? 0.1 : 0.35));
    gr.addColorStop(1, rgba(col, 0));
    g.fillStyle = gr; g.fillRect(0, 0, s, s);
    GLOWS[k] = c; return c;
  }
  function radial(g, x, y, r, stops) {
    var gr = g.createRadialGradient(x, y, 0, x, y, r);
    stops.forEach(function (s) { gr.addColorStop(s[0], s[1]); });
    g.fillStyle = gr; g.fillRect(x - r, y - r, r * 2, r * 2);
  }
  function archPath(g, x0, x1, base, top) {
    var w = x1 - x0, mid = (x0 + x1) / 2, spring = top + w * 0.62;
    g.beginPath(); g.moveTo(x0, base); g.lineTo(x0, spring);
    g.bezierCurveTo(x0, top + w * 0.2, mid - w * 0.12, top + w * 0.04, mid, top);
    g.bezierCurveTo(mid + w * 0.12, top + w * 0.04, x1, top + w * 0.2, x1, spring);
    g.lineTo(x1, base); g.closePath();
  }

  /* static cathedral: drawn once per size / layout. L = { w, h, cx, floorY, roseY, roseR } */
  function paintCathedral(g, L) {
    var w = L.w, h = L.h, cx = L.cx, fy = L.floorY, i, gr;
    gr = g.createLinearGradient(0, 0, 0, h);
    gr.addColorStop(0, '#06040A'); gr.addColorStop(0.28, '#120C1E'); gr.addColorStop(clamp(fy / h, 0.3, 0.95), '#1C1430'); gr.addColorStop(1, '#050308');
    g.fillStyle = gr; g.fillRect(0, 0, w, h);
    // deep violet glow behind the rose window
    radial(g, cx, L.roseY, w * 0.95, [[0, 'rgba(150,96,255,0.30)'], [0.35, 'rgba(110,52,170,0.14)'], [1, 'rgba(0,0,0,0)']]);
    radial(g, cx, fy, w * 0.7, [[0, 'rgba(255,122,47,0.10)'], [1, 'rgba(0,0,0,0)']]);
    // far arcade (row of small dark arches above the floor)
    var aw = w / 6.5, abase = fy + 2, atop = fy - h * 0.2;
    for (i = -1; i < 8; i++) {
      var x0 = i * aw + aw * 0.14, x1 = x0 + aw * 0.72;
      g.fillStyle = 'rgba(4,2,8,0.6)'; archPath(g, x0, x1, abase, atop); g.fill();
      g.strokeStyle = 'rgba(160,120,230,0.10)'; g.lineWidth = 1.5; g.stroke();
      // faint blue glass at the top of each far arch
      g.save(); archPath(g, x0 + aw * 0.12, x1 - aw * 0.12, atop + aw * 0.9, atop + aw * 0.18); g.clip();
      radial(g, (x0 + x1) / 2, atop + aw * 0.4, aw * 0.6, [[0, 'rgba(90,140,255,0.22)'], [1, 'rgba(0,0,0,0)']]);
      g.restore();
    }
    // central great arch (frames rose window + altar)
    var gx0 = cx - w * 0.36, gx1 = cx + w * 0.36, gtop = L.roseY - L.roseR * 1.9;
    g.save();
    archPath(g, gx0 - 14, gx1 + 14, fy + 4, gtop - 16); g.fillStyle = '#1A1228'; g.fill();
    archPath(g, gx0, gx1, fy + 4, gtop); g.fillStyle = '#0B0712'; g.fill();
    // inner arch moulding lines
    g.lineWidth = 2; g.strokeStyle = 'rgba(255,203,87,0.16)'; archPath(g, gx0 - 7, gx1 + 7, fy + 4, gtop - 8); g.stroke();
    g.strokeStyle = 'rgba(157,107,255,0.22)'; archPath(g, gx0, gx1, fy + 4, gtop); g.stroke();
    // recess: tall lancet windows left/right of the rose
    [-1, 1].forEach(function (s) {
      var lx = cx + s * w * 0.22, lw = w * 0.07, ltop = L.roseY - L.roseR * 0.6, lbase = fy - h * 0.05;
      archPath(g, lx - lw / 2, lx + lw / 2, lbase, ltop);
      gr = g.createLinearGradient(0, ltop, 0, lbase);
      gr.addColorStop(0, 'rgba(120,80,220,0.55)'); gr.addColorStop(0.5, 'rgba(70,40,140,0.35)'); gr.addColorStop(1, 'rgba(20,10,40,0.2)');
      g.fillStyle = gr; g.fill();
      g.strokeStyle = 'rgba(10,6,16,0.9)'; g.lineWidth = 3; g.stroke();
      g.beginPath(); g.moveTo(lx, ltop + lw * 0.3); g.lineTo(lx, lbase);
      for (var k = 1; k < 5; k++) { var yy = lerp(ltop + lw, lbase, k / 5); g.moveTo(lx - lw / 2, yy); g.lineTo(lx + lw / 2, yy); }
      g.lineWidth = 2; g.stroke();
    });
    g.restore();
    // rose window (stained glass)
    paintRose(g, cx, L.roseY, L.roseR);
    // foreground columns (left / right)
    [-1, 1].forEach(function (s) {
      var cw = w * 0.15, x0 = s < 0 ? -cw * 0.25 : w - cw * 0.75, x1 = x0 + cw;
      gr = g.createLinearGradient(x0, 0, x1, 0);
      if (s < 0) { gr.addColorStop(0, '#07050B'); gr.addColorStop(0.6, '#1A1326'); gr.addColorStop(0.92, '#3A2A55'); gr.addColorStop(1, '#120C18'); }
      else { gr.addColorStop(0, '#120C18'); gr.addColorStop(0.08, '#3A2A55'); gr.addColorStop(0.4, '#1A1326'); gr.addColorStop(1, '#07050B'); }
      g.fillStyle = gr; g.fillRect(x0, 0, cw, h);
      // fluting
      g.strokeStyle = 'rgba(0,0,0,0.35)'; g.lineWidth = 2;
      for (var f = 1; f < 4; f++) { var fx = x0 + cw * f / 4; g.beginPath(); g.moveTo(fx, 0); g.lineTo(fx, h); g.stroke(); }
      // capital bands + base
      [h * 0.06, fy - h * 0.005].forEach(function (by, j) {
        var bh = j ? 16 : 12;
        gr = g.createLinearGradient(0, by - bh, 0, by + bh);
        gr.addColorStop(0, '#2A1F3C'); gr.addColorStop(0.45, '#4A3A66'); gr.addColorStop(1, '#0E0A14');
        g.fillStyle = gr; g.fillRect(x0 - 6, by - bh / 2, cw + 12, bh);
        g.fillStyle = 'rgba(255,203,87,0.25)'; g.fillRect(x0 - 6, by - bh / 2, cw + 12, 1.5);
      });
      // candle sconce on the column (flame animated later)
      var sx = s < 0 ? x1 - 2 : x0 + 2, sy = fy - h * 0.16;
      g.fillStyle = '#120C18'; g.beginPath(); g.moveTo(sx - s * 2, sy + 10); g.lineTo(sx + s * 14, sy + 6); g.lineTo(sx + s * 14, sy + 2); g.lineTo(sx - s * 2, sy); g.fill();
      g.fillStyle = '#3A2A55'; g.fillRect(sx + s * 14 - 6, sy - 4, 12, 5);
      g.fillStyle = '#E8DCC8'; g.fillRect(sx + s * 14 - 3, sy - 16, 6, 12);
      BG.candles.push({ x: sx + s * 14, y: sy - 17, s: 1 });
    });
    // banners hanging inside the great arch
    [-1, 1].forEach(function (s) {
      var bx = cx + s * w * 0.31, bw = w * 0.085, by0 = gtop + h * 0.07, by1 = by0 + h * 0.2;
      g.fillStyle = '#120C18'; g.fillRect(bx - bw / 2 - 5, by0 - 4, bw + 10, 5);
      gr = g.createLinearGradient(bx - bw / 2, 0, bx + bw / 2, 0);
      gr.addColorStop(0, '#5A0E1C'); gr.addColorStop(0.5, '#A51E31'); gr.addColorStop(1, '#4A0A16');
      g.beginPath(); g.moveTo(bx - bw / 2, by0); g.lineTo(bx + bw / 2, by0); g.lineTo(bx + bw / 2, by1); g.lineTo(bx, by1 - bw * 0.45); g.lineTo(bx - bw / 2, by1); g.closePath();
      g.fillStyle = gr; g.fill(); g.strokeStyle = 'rgba(255,203,87,0.75)'; g.lineWidth = 1.6; g.stroke();
      // emblem: gold rune diamond with an eye
      var ey = by0 + (by1 - by0) * 0.38, er = bw * 0.28;
      g.beginPath(); g.moveTo(bx, ey - er); g.lineTo(bx + er * 0.8, ey); g.lineTo(bx, ey + er); g.lineTo(bx - er * 0.8, ey); g.closePath();
      g.strokeStyle = '#FFCB57'; g.lineWidth = 1.5; g.stroke();
      g.beginPath(); g.ellipse(bx, ey, er * 0.45, er * 0.25, 0, 0, TAU); g.stroke();
      g.fillStyle = '#FFCB57'; g.beginPath(); g.arc(bx, ey, er * 0.12, 0, TAU); g.fill();
    });
    // floor (perspective stone + crimson carpet)
    gr = g.createLinearGradient(0, fy, 0, h);
    gr.addColorStop(0, '#231A33'); gr.addColorStop(0.4, '#140F1E'); gr.addColorStop(1, '#060409');
    g.fillStyle = gr; g.fillRect(0, fy, w, h - fy);
    var vy = fy - h * 0.35;
    g.strokeStyle = 'rgba(190,160,255,0.06)'; g.lineWidth = 1;
    for (i = -10; i <= 10; i++) { g.beginPath(); g.moveTo(cx + i * w * 0.04, fy); g.lineTo(cx + i * w * 0.04 + (i * w * 0.04) * ((h - fy) / (fy - vy)), h); g.stroke(); }
    for (i = 0; i < 9; i++) { var yy2 = fy + (h - fy) * Math.pow(i / 9, 1.8); g.beginPath(); g.moveTo(0, yy2); g.lineTo(w, yy2); g.stroke(); }
    var c0 = w * 0.09, c1 = w * 0.3;
    g.beginPath(); g.moveTo(cx - c0, fy); g.lineTo(cx + c0, fy); g.lineTo(cx + c1, h); g.lineTo(cx - c1, h); g.closePath();
    gr = g.createLinearGradient(0, fy, 0, h); gr.addColorStop(0, '#4A0E1C'); gr.addColorStop(0.5, '#6A1426'); gr.addColorStop(1, '#2A0610');
    g.fillStyle = gr; g.fill();
    g.strokeStyle = 'rgba(255,203,87,0.45)'; g.lineWidth = 1.5;
    g.beginPath(); g.moveTo(cx - c0 * 0.86, fy); g.lineTo(cx - c1 * 0.9, h); g.moveTo(cx + c0 * 0.86, fy); g.lineTo(cx + c1 * 0.9, h); g.stroke();
    // vignette
    var vg = g.createRadialGradient(cx, h * 0.45, mn(w, h) * 0.3, cx, h * 0.5, mx(w, h) * 0.75);
    vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,0.78)');
    g.fillStyle = vg; g.fillRect(0, 0, w, h);
  }
  function paintRose(g, x, y, R) {
    var i, n = 12;
    radial(g, x, y, R * 2.4, [[0, 'rgba(255,170,90,0.22)'], [0.4, 'rgba(157,107,255,0.16)'], [1, 'rgba(0,0,0,0)']]);
    g.save();
    g.beginPath(); g.arc(x, y, R + 7, 0, TAU); g.fillStyle = '#251A36'; g.fill();
    g.strokeStyle = 'rgba(255,203,87,0.35)'; g.lineWidth = 1.5; g.stroke();
    g.beginPath(); g.arc(x, y, R, 0, TAU); g.clip();
    var cols = ['#7A1830', '#3A2A8A', '#A8620A', '#1F5D78', '#6A2BB0', '#8E1324'];
    for (i = 0; i < n; i++) {
      var a0 = i / n * TAU - PI / 2, a1 = (i + 1) / n * TAU - PI / 2;
      g.beginPath(); g.moveTo(x, y); g.arc(x, y, R, a0, a1); g.closePath();
      g.fillStyle = cols[i % cols.length]; g.fill();
    }
    var gr = g.createRadialGradient(x, y - R * 0.3, 0, x, y, R);
    gr.addColorStop(0, 'rgba(255,230,180,0.55)'); gr.addColorStop(0.5, 'rgba(255,160,90,0.18)'); gr.addColorStop(1, 'rgba(0,0,0,0.35)');
    g.fillStyle = gr; g.fillRect(x - R, y - R, R * 2, R * 2);
    // tracery
    g.strokeStyle = '#0A0610'; g.lineWidth = mx(2, R * 0.05);
    for (i = 0; i < n; i++) { var a = i / n * TAU - PI / 2; g.beginPath(); g.moveTo(x + cos(a) * R * 0.3, y + sin(a) * R * 0.3); g.lineTo(x + cos(a) * R, y + sin(a) * R); g.stroke(); }
    for (i = 0; i < n; i++) { var b = (i + 0.5) / n * TAU - PI / 2; g.beginPath(); g.arc(x + cos(b) * R * 0.68, y + sin(b) * R * 0.68, R * 0.17, 0, TAU); g.stroke(); }
    g.beginPath(); g.arc(x, y, R * 0.3, 0, TAU); g.stroke();
    g.beginPath(); g.arc(x, y, R * 0.98, 0, TAU); g.stroke();
    g.restore();
    g.beginPath(); g.arc(x, y, R * 0.28, 0, TAU); g.fillStyle = 'rgba(255,203,87,0.55)'; g.fill();
    g.beginPath(); g.arc(x, y, R * 0.12, 0, TAU); g.fillStyle = '#FFF1C4'; g.fill();
  }
  function paintShafts(w, h, L) {
    var k = 0.5, c = offCv(w * k, h * k), g = c.getContext('2d');
    g.scale(k, k);
    var sx = L.cx, sy = L.roseY, ey = L.floorY + h * 0.06;
    var defs = [[-0.07, 0.42, 1.3], [0.0, 0.3, 1.2], [0.08, 0.38, 1.1], [-0.17, 0.24, 0.7], [0.18, 0.22, 0.7], [-0.03, 0.12, 1.1], [0.04, 0.1, 1.0]];
    defs.forEach(function (d) {
      var bx = sx + d[0] * w * 2.2, bw = w * d[1];
      for (var j = 0; j < 7; j++) {
        var f = 1 - j / 8, tw = L.roseR * 0.35 * f, bww = bw * f;
        var gr = g.createLinearGradient(0, sy, 0, ey);
        gr.addColorStop(0, 'rgba(255,226,180,' + (0.06 * d[2]) + ')'); gr.addColorStop(0.5, 'rgba(225,180,255,' + (0.035 * d[2]) + ')'); gr.addColorStop(1, 'rgba(160,110,255,0)');
        g.fillStyle = gr;
        g.beginPath(); g.moveTo(sx + d[0] * L.roseR - tw, sy); g.lineTo(sx + d[0] * L.roseR + tw, sy); g.lineTo(bx + bww / 2, ey); g.lineTo(bx - bww / 2, ey); g.closePath(); g.fill();
      }
    });
    return c;
  }
  function paintFog(w, h) {
    var c = offCv(w * 0.5, h * 0.5), g = c.getContext('2d'), r = rng(77);
    g.scale(0.5, 0.5);
    for (var i = 0; i < 26; i++) {
      var x = r() * w, y = h * (0.2 + r() * 0.7), rx = w * (0.18 + r() * 0.3), ry = h * (0.06 + r() * 0.12);
      g.save(); g.translate(x, y); g.scale(1, ry / rx);
      var gr = g.createRadialGradient(0, 0, 0, 0, 0, rx);
      gr.addColorStop(0, 'rgba(120,96,170,0.10)'); gr.addColorStop(1, 'rgba(120,96,170,0)');
      g.fillStyle = gr; g.fillRect(-rx, -rx, rx * 2, rx * 2); g.restore();
    }
    return c;
  }
  /* altar sprite: stepped round dais (k = altar scale). returns { cv, w, h, ox, oy, top } in css px; (0,0) = dais centre */
  function paintAltar(k, dpr) {
    var W = 156 * k, H = 52 * k, ox = W / 2, oy = 20 * k;
    var c = offCv(W * dpr, H * dpr), g = c.getContext('2d');
    g.scale(dpr, dpr); g.translate(ox, oy);
    function step(rx, ry, y, hgt, top, side) {
      g.beginPath(); g.ellipse(0, y + hgt, rx, ry, 0, 0, PI); g.lineTo(-rx, y); g.ellipse(0, y, rx, ry, 0, PI, 0, true); g.closePath();
      var gr = g.createLinearGradient(-rx, 0, rx, 0); gr.addColorStop(0, '#0B0811'); gr.addColorStop(0.5, side); gr.addColorStop(1, '#0B0811');
      g.fillStyle = gr; g.fill(); g.strokeStyle = '#120C18'; g.lineWidth = 2; g.stroke();
      g.beginPath(); g.ellipse(0, y, rx, ry, 0, 0, TAU);
      var gt = g.createLinearGradient(0, y - ry, 0, y + ry); gt.addColorStop(0, '#1C1528'); gt.addColorStop(1, top);
      g.fillStyle = gt; g.fill(); g.stroke();
      g.beginPath(); g.ellipse(0, y, rx - 2, ry - 1.5, 0, 0.15 * PI, 0.85 * PI); g.strokeStyle = 'rgba(200,170,255,0.25)'; g.lineWidth = 1.5; g.stroke();
      // tiny gold studs along the front rim
      g.fillStyle = 'rgba(255,203,87,0.55)';
      for (var i = 1; i < 8; i++) { var a = PI * i / 8; g.beginPath(); g.arc(cos(a) * rx * 0.97, y + hgt * 0.55 + sin(a) * ry, 1.3, 0, TAU); g.fill(); }
    }
    step(76 * k, 19 * k, 14 * k, 9 * k, '#2B2140', '#2A2038');
    step(62 * k, 15 * k, 5 * k, 8 * k, '#342850', '#30243F');
    step(48 * k, 12 * k, -3 * k, 7 * k, '#3E3060', '#3A2C4E');
    g.beginPath(); g.ellipse(0, -3 * k, 38 * k, 9 * k, 0, 0, TAU); g.strokeStyle = 'rgba(0,0,0,0.45)'; g.lineWidth = 2; g.stroke();
    g.strokeStyle = 'rgba(0,0,0,0.5)'; g.lineWidth = 1.2;
    g.beginPath(); g.moveTo(-56 * k, 13 * k); g.lineTo(-50 * k, 18 * k); g.lineTo(-53 * k, 23 * k); g.moveTo(40 * k, 7 * k); g.lineTo(45 * k, 12 * k); g.lineTo(42 * k, 16 * k); g.stroke();
    return { cv: c, w: W, h: H, ox: ox, oy: oy, top: -3 * k };
  }
  /* brazier sprite (bowl on a stand), (0,0) = foot centre; fire point at (0, fire) */
  function paintBrazier(k, dpr) {
    var W = 34 * k, H = 44 * k, ox = W / 2, oy = H - 4 * k;
    var c = offCv(W * dpr, H * dpr), g = c.getContext('2d');
    g.scale(dpr, dpr); g.translate(ox, oy);
    g.fillStyle = 'rgba(0,0,0,0.45)'; g.beginPath(); g.ellipse(0, 1.5 * k, 14 * k, 3.6 * k, 0, 0, TAU); g.fill();
    g.fillStyle = '#1A1324'; g.strokeStyle = '#120C18'; g.lineWidth = 2;
    g.beginPath(); g.moveTo(-3.6 * k, 0); g.lineTo(-2.2 * k, -24 * k); g.lineTo(2.2 * k, -24 * k); g.lineTo(3.6 * k, 0); g.closePath(); g.fill(); g.stroke();
    g.beginPath(); g.moveTo(-9 * k, 0); g.lineTo(9 * k, 0); g.lineTo(5.5 * k, -3.6 * k); g.lineTo(-5.5 * k, -3.6 * k); g.closePath(); g.fill(); g.stroke();
    var bowl = -24 * k;
    g.beginPath(); g.moveTo(-11 * k, bowl - 5 * k); g.quadraticCurveTo(0, bowl + 8 * k, 11 * k, bowl - 5 * k); g.closePath();
    var gb = g.createLinearGradient(0, bowl - 6 * k, 0, bowl + 4 * k); gb.addColorStop(0, '#5A4A7A'); gb.addColorStop(1, '#1A1324');
    g.fillStyle = gb; g.fill(); g.stroke();
    g.strokeStyle = 'rgba(255,203,87,0.6)'; g.lineWidth = 1.2; g.beginPath(); g.moveTo(-9 * k, bowl - 2 * k); g.quadraticCurveTo(0, bowl + 4 * k, 9 * k, bowl - 2 * k); g.stroke();
    g.fillStyle = '#FFB020'; g.beginPath(); g.ellipse(0, bowl - 5 * k, 10 * k, 2.4 * k, 0, 0, TAU); g.fill();
    return { cv: c, w: W, h: H, ox: ox, oy: oy, fire: bowl - 6 * k };
  }
  function paintRing(R, col, dpr) {
    var s = R * 2 + 8, c = offCv(s * dpr, s * dpr), g = c.getContext('2d'), m = s / 2, i;
    g.scale(dpr, dpr); g.translate(m, m);
    g.strokeStyle = col; g.fillStyle = col; g.lineCap = 'round';
    g.shadowColor = col; g.shadowBlur = 8 * dpr;
    g.lineWidth = 2.4; g.beginPath(); g.arc(0, 0, R, 0, TAU); g.stroke();
    g.lineWidth = 1.2; g.beginPath(); g.arc(0, 0, R * 0.84, 0, TAU); g.stroke();
    g.beginPath(); g.arc(0, 0, R * 0.46, 0, TAU); g.stroke();
    // hexagram
    g.lineWidth = 1.4; g.beginPath();
    for (i = 0; i < 2; i++) { for (var j = 0; j <= 3; j++) { var a = (j / 3) * TAU + i * PI / 3 - PI / 2; var px = cos(a) * R * 0.82, py = sin(a) * R * 0.82; if (j) g.lineTo(px, py); else g.moveTo(px, py); } }
    g.stroke();
    // runes between the outer rings
    var rr = R * 0.92, r2 = rng(9);
    for (i = 0; i < 16; i++) {
      var b = i / 16 * TAU; g.save(); g.translate(cos(b) * rr, sin(b) * rr); g.rotate(b + PI / 2);
      var u = R * 0.045; g.lineWidth = 1.1; g.beginPath();
      var kind = floor(r2() * 4);
      if (kind === 0) { g.moveTo(0, -u * 1.4); g.lineTo(0, u * 1.4); g.moveTo(-u, -u * 0.4); g.lineTo(u, u * 0.6); }
      else if (kind === 1) { g.moveTo(-u, u * 1.2); g.lineTo(0, -u * 1.3); g.lineTo(u, u * 1.2); }
      else if (kind === 2) { g.arc(0, 0, u * 0.9, 0, TAU); g.moveTo(0, -u * 1.5); g.lineTo(0, -u * 0.9); }
      else { g.moveTo(-u, -u); g.lineTo(u, -u); g.lineTo(-u, u); g.lineTo(u, u); }
      g.stroke(); g.restore();
    }
    return { cv: c, s: s };
  }
  function paintBeam(col, k, dpr) {
    var W = 120 * k, H = 220 * k, c = offCv(W * dpr, H * dpr), g = c.getContext('2d');
    g.scale(dpr, dpr);
    for (var j = 0; j < 6; j++) {
      var f = 1 - j / 7, bw = W * f;
      var gr = g.createLinearGradient(0, H, 0, 0);
      gr.addColorStop(0, rgba(col, 0.10)); gr.addColorStop(0.5, rgba(col, 0.045)); gr.addColorStop(1, rgba(col, 0));
      g.fillStyle = gr; g.beginPath(); g.ellipse(W / 2, H, bw / 2, bw * 0.18, 0, PI, 0); g.lineTo(W / 2 + bw * 0.32, 0); g.lineTo(W / 2 - bw * 0.32, 0); g.closePath(); g.fill();
    }
    return { cv: c, w: W, h: H };
  }

  function bgLayout(w, h) {
    // stage of the home screen (if mounted) decides altar position; otherwise a sensible default
    var L = { w: w, h: h, cx: w / 2 };
    var st = HOME.stage && HOME.stage.isConnected ? HOME.stageRect : null;
    var feet = st ? st.y + st.h - 50 : h * 0.55;
    var k = HOME.k || 1.9;
    L.floorY = feet - 28 * k;
    L.roseY = feet - 112 * k;
    L.roseR = clamp(mn(w * 0.2, 40 * k), 40, 96);
    if (L.roseY - L.roseR < 40) L.roseY = L.roseR + 40;
    return L;
  }
  function initParticles(w, h) {
    var n = RM ? 12 : (w * h > 500000 ? 46 : 36);
    BG.embers = [];
    for (var i = 0; i < n; i++) BG.embers.push(newEmber(w, h, true));
    BG.motes = [];
    for (i = 0; i < (RM ? 8 : 26); i++) BG.motes.push({ u: Math.random(), v: Math.random(), s: 0.6 + Math.random() * 1.4, ph: Math.random() * TAU, sp: 0.01 + Math.random() * 0.02 });
  }
  function newEmber(w, h, anyY) {
    var violet = Math.random() < 0.28;
    return { x: Math.random() * w, y: anyY ? Math.random() * h : h + 10, vy: 14 + Math.random() * 34, sw: 6 + Math.random() * 18, ph: Math.random() * TAU,
      s: 0.5 + Math.random() * 1.6, col: violet ? '#B98CFF' : (Math.random() < 0.5 ? '#FF7A2F' : '#FFB04A'), life: 0.6 + Math.random() * 0.4 };
  }
  function bgDraw(ctx, w, h, t, rec) {
    var dt = BG.dt || 0.016, dpr = rec.dpr, i;
    // rebuild static layers when needed
    var L = bgLayout(w, h);
    var key = round(w) + 'x' + round(h) + '@' + dpr + '|' + round(L.floorY) + '|' + round(L.roseY);
    if (key !== BG.backKey) {
      BG.backKey = key; BG.candles = [];
      var bk = mn(dpr, 1.5);
      BG.back = offCv(w * bk, h * bk);
      var g = BG.back.getContext('2d'); g.scale(bk, bk);
      paintCathedral(g, L);
      BG.shafts = paintShafts(w, h, L);
      BG.fog = paintFog(w, h);
      BG.L = L;
      if (!BG.embers.length || BG.ew !== w || BG.eh !== h) { initParticles(w, h); BG.ew = w; BG.eh = h; }
    }
    var homeOn = BG.mode === 'home' && !RES;
    BG.mix += ((homeOn ? 1 : 0) - BG.mix) * mn(1, dt * 7);
    ctx.drawImage(BG.back, 0, 0, w, h);
    // light shafts (breathing)
    ctx.globalCompositeOperation = 'lighter';
    var sh = 0.7 + 0.2 * sin(t * 0.55) + 0.1 * sin(t * 1.7);
    ctx.globalAlpha = sh * (0.4 + 0.6 * BG.mix);
    ctx.drawImage(BG.shafts, 0, 0, w, h);
    ctx.globalAlpha = (0.45 + 0.25 * sin(t * 0.9 + 1.3)) * (0.4 + 0.6 * BG.mix);
    ctx.drawImage(BG.shafts, -w * 0.02 * sin(t * 0.2), 0, w * 1.04, h);
    // dust motes in the shafts
    var mg = glowSprite('#FFE2B0');
    for (i = 0; i < BG.motes.length; i++) {
      var m = BG.motes[i];
      m.v -= m.sp * dt; if (m.v < 0) { m.v = 1; m.u = Math.random(); }
      var my = lerp(L.roseY, L.floorY + 20, m.v), spread = lerp(L.roseR * 0.4, w * 0.36, m.v);
      var mxp = L.cx + (m.u - 0.5) * 2 * spread + sin(t * 0.7 + m.ph) * 8;
      ctx.globalAlpha = 0.35 * (0.5 + 0.5 * sin(t * 2 + m.ph)) * (0.4 + 0.6 * BG.mix);
      var ms = 5 * m.s; ctx.drawImage(mg, mxp - ms, my - ms, ms * 2, ms * 2);
    }
    // wall candles
    var cg = glowSprite('#FF9A3C');
    for (i = 0; i < BG.candles.length; i++) {
      var c = BG.candles[i], fl = 0.8 + 0.12 * sin(t * 13 + i * 3) + 0.08 * sin(t * 21 + i);
      ctx.globalAlpha = 0.5 * fl; ctx.drawImage(cg, c.x - 30, c.y - 30, 60, 60);
      ctx.globalAlpha = 1; drawFlame(ctx, c.x, c.y + 2, 4.2 * fl, 11 * fl, t + i);
    }
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
    // darken for non-home screens
    if (BG.mix < 0.999) { ctx.fillStyle = 'rgba(6,4,10,' + (0.62 * (1 - BG.mix)).toFixed(3) + ')'; ctx.fillRect(0, 0, w, h); }
    // altar + hero (follows the home stage element, also while it slides)
    if (HOME.stage && HOME.stage.isConnected && !RES) drawAltarHero(ctx, w, h, t, dt, dpr);
    // embers
    ctx.globalCompositeOperation = 'lighter';
    for (i = 0; i < BG.embers.length; i++) {
      var e = BG.embers[i];
      e.y -= e.vy * dt; e.ph += dt;
      if (e.y < -20) BG.embers[i] = e = newEmber(w, h, false);
      var ex = e.x + sin(e.ph * 1.3) * e.sw, fade = clamp(e.y / h, 0, 1);
      var fl2 = 0.6 + 0.4 * sin(e.ph * 7 + i);
      ctx.globalAlpha = clamp(fade * 1.3, 0, 1) * fl2 * (0.55 + 0.45 * BG.mix);
      var es = 6 * e.s;
      ctx.drawImage(glowSprite(e.col), ex - es, e.y - es, es * 2, es * 2);
    }
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
    // drifting fog at the bottom
    var fx = (t * 6) % w;
    ctx.globalAlpha = 0.55;
    ctx.drawImage(BG.fog, -fx, h * 0.35, w, h * 0.65);
    ctx.drawImage(BG.fog, w - fx, h * 0.35, w, h * 0.65);
    ctx.globalAlpha = 1;
  }
  function drawFlame(ctx, x, y, w, h, t) {
    var sway = sin(t * 9) * w * 0.25;
    ctx.fillStyle = 'rgba(255,122,47,0.85)';
    ctx.beginPath(); ctx.moveTo(x - w, y); ctx.quadraticCurveTo(x - w * 0.9, y - h * 0.6, x + sway, y - h); ctx.quadraticCurveTo(x + w * 0.9, y - h * 0.6, x + w, y); ctx.closePath(); ctx.fill();
    ctx.fillStyle = 'rgba(255,230,160,0.95)';
    ctx.beginPath(); ctx.moveTo(x - w * 0.5, y); ctx.quadraticCurveTo(x - w * 0.4, y - h * 0.4, x + sway * 0.6, y - h * 0.62); ctx.quadraticCurveTo(x + w * 0.4, y - h * 0.4, x + w * 0.5, y); ctx.closePath(); ctx.fill();
  }
  function drawAltarHero(ctx, w, h, t, dt, dpr) {
    homeMeasure();
    var st = HOME.stageRect;
    if (!st) return;
    var k = HOME.k, cx = st.x + st.w / 2, feet = st.y + st.h - 50;
    var ka = mn(k, (w * 0.5 - 6) / 78), kb = mn(k, 1.7);
    var rar = HOME.rar, col = rarOf(rar).col;
    var aKey = ka.toFixed(3) + '|' + kb.toFixed(3) + '@' + dpr;
    if (BG.altarKey !== aKey) { BG.altarKey = aKey; BG.altar = paintAltar(ka, dpr); BG.braz = paintBrazier(kb, dpr); }
    var rKey = aKey + col;
    if (BG.ringKey !== rKey) { BG.ringKey = rKey; BG.ring = paintRing(40 * ka, col, dpr); BG.beam = paintBeam(col, k, dpr); }
    var A = BG.altar, top = feet;                 // hero feet stand on the dais top
    var dy = feet - A.top;                         // dais centre y
    var inten = 0.45 + 0.11 * rar;
    // floor glow
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = (0.5 + 0.15 * sin(t * 1.6)) * inten;
    var gs = glowSprite(col, true), gw = 230 * ka, ghh = 70 * ka;
    ctx.drawImage(gs, cx - gw / 2, dy + 16 * ka - ghh / 2, gw, ghh);
    ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
    ctx.drawImage(A.cv, cx - A.ox, dy - A.oy, A.w, A.h);
    // braziers flanking the altar
    var Bz = BG.braz, bxo = mn(98 * k, w / 2 - 22 * kb), byy = dy + 20 * ka;
    for (var b = 0; b < 2; b++) {
      var bx = cx + (b ? bxo : -bxo);
      ctx.drawImage(Bz.cv, bx - Bz.ox, byy - Bz.oy, Bz.w, Bz.h);
      var fy = byy + Bz.fire, fl = 0.82 + 0.1 * sin(t * 11 + b * 2) + 0.08 * sin(t * 23 + b);
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 0.55 * fl; var gr = 64 * kb * fl; ctx.drawImage(glowSprite('#FF7A2F'), bx - gr / 2, fy - gr / 2 - 6 * kb, gr, gr);
      ctx.globalAlpha = 1; drawFlame(ctx, bx, fy, 7.5 * kb * fl, 21 * kb * fl, t * 1.1 + b * 3);
      ctx.globalCompositeOperation = 'source-over';
    }
    ctx.globalCompositeOperation = 'lighter';
    // rotating rune ring on the dais top (perspective)
    var R = BG.ring, rs = R.s;
    ctx.save(); ctx.translate(cx, dy); ctx.scale(1, 0.25); ctx.rotate(t * 0.22);
    ctx.globalAlpha = (0.55 + 0.25 * sin(t * 2.1)) * mn(1, inten + 0.2);
    ctx.drawImage(R.cv, -rs / 2, -rs / 2, rs, rs);
    ctx.rotate(-t * 0.5); ctx.globalAlpha *= 0.45; ctx.drawImage(R.cv, -rs * 0.33, -rs * 0.33, rs * 0.66, rs * 0.66);
    ctx.restore();
    // aura beam behind the hero
    var Bm = BG.beam;
    ctx.globalAlpha = (0.6 + 0.3 * sin(t * 1.3)) * inten * 1.3;
    ctx.drawImage(Bm.cv, cx - Bm.w / 2, dy - Bm.h, Bm.w, Bm.h);
    ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
    // hero
    var H = HOME.hero, anim = 'idle', atkP = 0;
    if (H.act) {
      H.act.t += dt;
      if (H.act.t >= H.act.d) H.act = null;
      else { anim = H.act.anim; atkP = H.act.t / H.act.d; }
    } else {
      H.idleT += dt;
      if (H.idleT > H.next && !RM) { H.idleT = 0; H.next = 7 + Math.random() * 6; H.act = { anim: 'attack', t: 0, d: 0.6 }; }
    }
    if (GM.Art && typeof GM.Art.drawHero === 'function') {
      GM.Art.drawHero(ctx, cx, top, k, { look: HOME.look, t: t, anim: anim, atkP: atkP, dir: 1, glow: true, shadow: true });
      if (anim === 'attack' && GM.Art.fx && GM.Art.fx.slash && atkP > 0.25 && atkP < 0.85) {
        safe(function () { GM.Art.fx.slash(ctx, cx + 22 * k, top - 40 * k, 46 * k, -0.25, 2.2, (atkP - 0.25) / 0.6, col); }, 'fx.slash');
      }
    } else {
      // tiny fallback silhouette
      ctx.fillStyle = '#2A2040'; ctx.beginPath(); ctx.ellipse(cx, top - 70 * k, 26 * k, 26 * k, 0, 0, TAU); ctx.fill();
      ctx.fillRect(cx - 18 * k, top - 48 * k, 36 * k, 48 * k);
    }
    // rising aura sparks
    ctx.globalCompositeOperation = 'lighter';
    var sp = BG.sparks;
    if (!RM && sp.length < 14 + rar * 3 && Math.random() < dt * (6 + rar * 3)) {
      var a = Math.random() * TAU;
      sp.push({ a: a, r: (24 + Math.random() * 20) * ka, y: 0, vy: (20 + Math.random() * 30) * k / 2, life: 1 + Math.random() * 1.2, age: 0, s: 0.6 + Math.random() * 0.9 });
    }
    var sg = glowSprite(col);
    for (var i = sp.length - 1; i >= 0; i--) {
      var p = sp[i]; p.age += dt; p.y += p.vy * dt;
      if (p.age > p.life) { sp.splice(i, 1); continue; }
      var px = cx + cos(p.a + t * 0.4) * p.r, py = dy + sin(p.a + t * 0.4) * p.r * 0.25 - p.y;
      ctx.globalAlpha = sin(p.age / p.life * PI) * 0.9;
      var ss = 6 * p.s * mx(1, k / 1.6); ctx.drawImage(sg, px - ss, py - ss, ss * 2, ss * 2);
    }
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
  }

  /* ============================================================================================
   * Chapter art (static paintings per theme, cached) + live boss on the centred card
   * ========================================================================================== */
  var THEME = {
    orman: { sky: ['#06110D', '#0E2A20', '#1B4A35'], far: '#0D2219', mid: '#08160F', ground: '#0A140D', glow: '#6FCF5A', moon: '#E6FFD0', acc: '#FF9A3C', part: '#C8FF6A' },
    mezarlik: { sky: ['#060D11', '#0F2228', '#21423F'], far: '#10232A', mid: '#0A161B', ground: '#0B1417', glow: '#7DF5C8', moon: '#F0FFF9', acc: '#7DF5C8', part: '#9FFFE6' },
    kor: { sky: ['#120303', '#3A0B06', '#7A220A'], far: '#2A0A08', mid: '#170505', ground: '#120404', glow: '#FF7A2F', moon: '#FFC27A', acc: '#FFCB57', part: '#FF9A3C' },
    kale: { sky: ['#07040E', '#1A0E2E', '#3A1E5C'], far: '#170D26', mid: '#0D0716', ground: '#0B0612', glow: '#9D6BFF', moon: '#EFE4FF', acc: '#FF3D4F', part: '#C49BFF' }
  };
  var CARDART = {};
  function themeOf(ch) { return THEME[ch && ch.theme] ? ch.theme : 'orman'; }
  function paintSky(g, w, h, P) {
    var gr = g.createLinearGradient(0, 0, 0, h);
    gr.addColorStop(0, P.sky[0]); gr.addColorStop(0.55, P.sky[1]); gr.addColorStop(1, P.sky[2]);
    g.fillStyle = gr; g.fillRect(0, 0, w, h);
  }
  function paintMoon(g, x, y, r, col, glow) {
    radial(g, x, y, r * 4, [[0, rgba(glow, 0.35)], [0.35, rgba(glow, 0.1)], [1, rgba(glow, 0)]]);
    g.fillStyle = col; g.beginPath(); g.arc(x, y, r, 0, TAU); g.fill();
    g.fillStyle = 'rgba(0,0,0,0.12)'; g.beginPath(); g.arc(x - r * 0.3, y + r * 0.2, r * 0.25, 0, TAU); g.arc(x + r * 0.35, y - r * 0.25, r * 0.15, 0, TAU); g.fill();
  }
  function pine(g, x, y, s, col) {
    g.fillStyle = col; g.beginPath();
    for (var i = 0; i < 4; i++) { var yy = y - s * (0.25 + i * 0.22), ww = s * (0.36 - i * 0.07); g.moveTo(x - ww, yy + s * 0.18); g.lineTo(x, yy - s * 0.2); g.lineTo(x + ww, yy + s * 0.18); }
    g.fill(); g.fillRect(x - s * 0.04, y - s * 0.28, s * 0.08, s * 0.28);
  }
  function paintCardBack(g, w, h, ch) {
    var th = themeOf(ch), P = THEME[th], r = rng(ch.id * 991 + 7), i, gy = h * 0.86;
    paintSky(g, w, h, P);
    // stars
    for (i = 0; i < 40; i++) { g.fillStyle = 'rgba(255,255,255,' + (0.15 + r() * 0.5) + ')'; g.fillRect(r() * w, r() * h * 0.5, 1 + r(), 1 + r()); }
    if (th === 'orman') {
      paintMoon(g, w * 0.78, h * 0.24, h * 0.1, P.moon, P.glow);
      for (i = 0; i < 18; i++) pine(g, r() * w, h * (0.72 + r() * 0.06), h * (0.45 + r() * 0.2), P.far);
      radial(g, w * 0.5, gy, w * 0.6, [[0, rgba(P.glow, 0.12)], [1, rgba(P.glow, 0)]]);
      for (i = 0; i < 12; i++) pine(g, r() * w, h * (0.9 + r() * 0.06), h * (0.6 + r() * 0.3), P.mid);
      // torch
      radial(g, w * 0.16, h * 0.62, h * 0.3, [[0, 'rgba(255,140,60,0.4)'], [1, 'rgba(255,140,60,0)']]);
      g.fillStyle = '#120C18'; g.fillRect(w * 0.16 - 2, h * 0.62, 4, h * 0.26);
      g.fillStyle = '#FFB04A'; g.beginPath(); g.ellipse(w * 0.16, h * 0.6, 4, 8, 0, 0, TAU); g.fill();
    } else if (th === 'mezarlik') {
      paintMoon(g, w * 0.62, h * 0.22, h * 0.13, P.moon, P.glow);
      // dead tree
      g.strokeStyle = P.far; g.lineCap = 'round';
      (function tree(x, y, a, len, d) { if (d > 6) return; var x2 = x + cos(a) * len, y2 = y + sin(a) * len; g.lineWidth = mx(1, 7 - d); g.beginPath(); g.moveTo(x, y); g.lineTo(x2, y2); g.stroke(); tree(x2, y2, a - 0.4 - r() * 0.3, len * 0.72, d + 1); tree(x2, y2, a + 0.35 + r() * 0.3, len * 0.68, d + 1); })(w * 0.3, gy, -PI / 2, h * 0.22, 0);
      // fence + graves
      g.fillStyle = P.far;
      for (i = 0; i < 26; i++) g.fillRect(i * w / 25, h * 0.7, 2, h * 0.12);
      g.fillRect(0, h * 0.73, w, 2);
      for (i = 0; i < 9; i++) {
        var gx = r() * w, gh = h * (0.08 + r() * 0.08), gw = gh * 0.6, gyy = h * (0.84 + r() * 0.06);
        g.fillStyle = P.mid;
        if (r() < 0.5) { g.beginPath(); g.moveTo(gx - gw / 2, gyy); g.lineTo(gx - gw / 2, gyy - gh + gw / 2); g.arc(gx, gyy - gh + gw / 2, gw / 2, PI, 0); g.lineTo(gx + gw / 2, gyy); g.fill(); }
        else { g.fillRect(gx - 2, gyy - gh, 4, gh); g.fillRect(gx - gw * 0.4, gyy - gh * 0.75, gw * 0.8, 4); }
      }
      // ghost lights
      for (i = 0; i < 6; i++) radial(g, r() * w, h * (0.6 + r() * 0.25), h * 0.08, [[0, rgba(P.glow, 0.35)], [1, rgba(P.glow, 0)]]);
    } else if (th === 'kor') {
      radial(g, w * 0.55, h * 0.45, w * 0.8, [[0, 'rgba(255,90,30,0.35)'], [1, 'rgba(255,90,30,0)']]);
      // volcano
      g.fillStyle = P.far; g.beginPath(); g.moveTo(w * 0.05, h * 0.82); g.lineTo(w * 0.38, h * 0.3); g.lineTo(w * 0.5, h * 0.27); g.lineTo(w * 0.85, h * 0.82); g.fill();
      g.strokeStyle = '#FF7A2F'; g.lineWidth = 2.5; g.beginPath(); g.moveTo(w * 0.44, h * 0.29); g.quadraticCurveTo(w * 0.47, h * 0.5, w * 0.42, h * 0.8); g.stroke();
      radial(g, w * 0.44, h * 0.27, h * 0.25, [[0, 'rgba(255,200,90,0.7)'], [1, 'rgba(255,120,40,0)']]);
      // smoke
      for (i = 0; i < 6; i++) radial(g, w * (0.42 + r() * 0.12), h * (0.05 + r() * 0.2), h * (0.1 + r() * 0.08), [[0, 'rgba(40,10,10,0.6)'], [1, 'rgba(40,10,10,0)']]);
      // lava river
      var gl = g.createLinearGradient(0, h * 0.82, 0, h);
      gl.addColorStop(0, '#FFCB57'); gl.addColorStop(0.5, '#FF7A2F'); gl.addColorStop(1, '#A8320A');
      g.fillStyle = gl; g.beginPath(); g.moveTo(0, h * 0.9); g.quadraticCurveTo(w * 0.3, h * 0.82, w * 0.6, h * 0.9); g.quadraticCurveTo(w * 0.8, h * 0.95, w, h * 0.88); g.lineTo(w, h * 0.93); g.quadraticCurveTo(w * 0.7, h, w * 0.4, h * 0.94); g.quadraticCurveTo(w * 0.2, h * 0.9, 0, h * 0.96); g.fill();
      // obsidian rocks
      g.fillStyle = P.mid;
      for (i = 0; i < 7; i++) { var rx = r() * w, rs = h * (0.06 + r() * 0.1); g.beginPath(); g.moveTo(rx - rs, h * 0.9); g.lineTo(rx - rs * 0.3, h * 0.9 - rs * 1.4); g.lineTo(rx + rs * 0.5, h * 0.9 - rs); g.lineTo(rx + rs, h * 0.9); g.fill(); }
    } else {
      paintMoon(g, w * 0.7, h * 0.3, h * 0.18, P.moon, P.glow);
      // castle silhouette
      g.fillStyle = P.far;
      g.fillRect(w * 0.2, h * 0.45, w * 0.6, h * 0.4);
      [[0.18, 0.25, 0.08], [0.34, 0.15, 0.07], [0.5, 0.05, 0.09], [0.66, 0.18, 0.07], [0.8, 0.28, 0.08]].forEach(function (tw) {
        var x = w * tw[0], top = h * tw[1], ww = w * tw[2];
        g.fillRect(x - ww / 2, top, ww, h * 0.8);
        g.beginPath(); g.moveTo(x - ww * 0.7, top); g.lineTo(x, top - h * 0.12); g.lineTo(x + ww * 0.7, top); g.fill();
      });
      g.fillStyle = 'rgba(255,61,79,0.8)';
      for (i = 0; i < 12; i++) g.fillRect(w * (0.22 + r() * 0.56), h * (0.3 + r() * 0.45), 2, 3);
      // lightning
      g.strokeStyle = 'rgba(200,170,255,0.7)'; g.lineWidth = 1.5; g.beginPath();
      var lx = w * 0.88, ly = 0; g.moveTo(lx, ly);
      for (i = 0; i < 6; i++) { lx += (r() - 0.5) * 18; ly += h * 0.08; g.lineTo(lx, ly); }
      g.stroke();
    }
    // ground strip
    var gg = g.createLinearGradient(0, gy - 8, 0, h);
    gg.addColorStop(0, rgba(P.ground, 0)); gg.addColorStop(0.4, P.ground); gg.addColorStop(1, '#050308');
    g.fillStyle = gg; g.fillRect(0, gy - 8, w, h - gy + 8);
  }
  function paintCardFront(g, w, h, ch) {
    var P = THEME[themeOf(ch)];
    // low fog
    radial(g, w * 0.7, h * 0.95, w * 0.5, [[0, rgba(P.glow, 0.12)], [1, rgba(P.glow, 0)]]);
    // left scrim for text
    var gr = g.createLinearGradient(0, 0, w * 0.75, 0);
    gr.addColorStop(0, 'rgba(6,4,10,0.85)'); gr.addColorStop(0.55, 'rgba(6,4,10,0.35)'); gr.addColorStop(1, 'rgba(6,4,10,0)');
    g.fillStyle = gr; g.fillRect(0, 0, w, h);
    var gb = g.createLinearGradient(0, h * 0.6, 0, h);
    gb.addColorStop(0, 'rgba(6,4,10,0)'); gb.addColorStop(1, 'rgba(6,4,10,0.75)');
    g.fillStyle = gb; g.fillRect(0, h * 0.6, w, h * 0.4);
    // vignette
    var vg = g.createRadialGradient(w / 2, h / 2, h * 0.3, w / 2, h / 2, w * 0.7);
    vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,0.55)');
    g.fillStyle = vg; g.fillRect(0, 0, w, h);
  }
  function bossGeom(w, h, ch) { var r = h * (ch.boss === 'kemikEjder' ? 0.27 : 0.3), u = r / 48; return { x: w * 0.72, y: h * 0.86 - 40 * u, r: r, u: u, gy: h * 0.86 }; }
  function drawShadowKing(g, x, gy, r, t, P) {
    var u = r / 48, bob = sin(t * 1.6) * 2 * u;
    g.save(); g.translate(x, gy);
    g.fillStyle = 'rgba(0,0,0,0.5)'; g.beginPath(); g.ellipse(0, 0, 40 * u, 9 * u, 0, 0, TAU); g.fill();
    g.fillStyle = '#0A0612'; g.strokeStyle = '#120C18'; g.lineWidth = 2;
    g.beginPath(); g.moveTo(-36 * u, 0); g.quadraticCurveTo(-30 * u, -60 * u, -18 * u, -78 * u + bob); g.lineTo(18 * u, -78 * u + bob); g.quadraticCurveTo(30 * u, -60 * u, 36 * u, 0); g.closePath(); g.fill();
    g.beginPath(); g.arc(0, -88 * u + bob, 16 * u, 0, TAU); g.fill();
    g.fillStyle = '#FFCB57';
    g.beginPath(); g.moveTo(-14 * u, -98 * u + bob); g.lineTo(-14 * u, -112 * u + bob); g.lineTo(-7 * u, -104 * u + bob); g.lineTo(0, -116 * u + bob); g.lineTo(7 * u, -104 * u + bob); g.lineTo(14 * u, -112 * u + bob); g.lineTo(14 * u, -98 * u + bob); g.closePath(); g.fill();
    g.globalCompositeOperation = 'lighter';
    var e = 0.8 + 0.2 * sin(t * 3);
    [-6, 6].forEach(function (ex) { g.globalAlpha = e; g.drawImage(glowSprite(P.acc), ex * u - 8 * u, -90 * u + bob - 8 * u, 16 * u, 16 * u); });
    g.globalAlpha = 1; g.globalCompositeOperation = 'source-over';
    g.restore();
  }
  function drawCardBoss(g, w, h, ch, t) {
    var P = THEME[themeOf(ch)], B = bossGeom(w, h, ch);
    g.globalCompositeOperation = 'lighter';
    g.globalAlpha = 0.6 + 0.15 * sin(t * 1.4);
    var gs = glowSprite(P.glow, true), gr = B.r * 3.2;
    g.drawImage(gs, B.x - gr / 2, B.gy - B.r * 1.2 - gr / 2, gr, gr);
    g.globalAlpha = 1; g.globalCompositeOperation = 'source-over';
    if (ch.boss && GM.Art && typeof GM.Art.drawBoss === 'function') {
      GM.Art.drawBoss(g, { type: ch.boss, x: B.x, y: B.y, r: B.r, dir: -1, phase: 'idle', hpPct: 1, castP: 0 }, t);
    } else drawShadowKing(g, B.x, B.gy, B.r, t, P);
  }
  function cardArt(ch, w, h, dpr, revealed) {
    var key = ch.id + '|' + round(w) + 'x' + round(h) + '@' + dpr + (revealed ? 'r' : 'h');
    var A = CARDART[key];
    if (A) return A;
    A = { key: key };
    A.back = offCv(w * dpr, h * dpr); var g = A.back.getContext('2d'); g.scale(dpr, dpr); paintCardBack(g, w, h, ch);
    A.front = offCv(w * dpr, h * dpr); g = A.front.getContext('2d'); g.scale(dpr, dpr); paintCardFront(g, w, h, ch);
    A.still = offCv(w * dpr, h * dpr); g = A.still.getContext('2d'); g.scale(dpr, dpr);
    g.drawImage(A.back, 0, 0, w, h);
    if (revealed) safe(function () { drawCardBoss(g, w, h, ch, 0.3); }, 'card boss');
    else {
      // unrevealed boss: black silhouette with a theme-coloured rim
      var tmp = offCv(w * dpr, h * dpr), tg = tmp.getContext('2d'); tg.scale(dpr, dpr);
      safe(function () {
        if (ch.boss && GM.Art && GM.Art.drawBoss) { var B = bossGeom(w, h, ch); GM.Art.drawBoss(tg, { type: ch.boss, x: B.x, y: B.y, r: B.r, dir: -1, phase: 'idle', hpPct: 1 }, 0.3); }
        else drawShadowKing(tg, w * 0.72, h * 0.86, h * 0.3, 0.3, THEME[themeOf(ch)]);
      }, 'card silhouette');
      tg.setTransform(1, 0, 0, 1, 0, 0); tg.globalCompositeOperation = 'source-in'; tg.fillStyle = '#05030A'; tg.fillRect(0, 0, tmp.width, tmp.height);
      g.save(); g.shadowColor = THEME[themeOf(ch)].glow; g.shadowBlur = 10 * dpr; g.drawImage(tmp, 0, 0, w, h); g.restore();
      g.drawImage(tmp, 0, 0, w, h);
      var B2 = bossGeom(w, h, ch);
      g.font = '900 ' + round(h * 0.2) + 'px Cinzel, Georgia, serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillStyle = rgba(THEME[themeOf(ch)].glow, 0.85); g.fillText('?', B2.x, B2.gy - B2.r * 1.05);
    }
    g.drawImage(A.front, 0, 0, w, h);
    var ks = Object.keys(CARDART); if (ks.length > 7) delete CARDART[ks[0]];
    CARDART[key] = A;
    return A;
  }
  function cardParticles(g, w, h, ch, t) {
    var P = THEME[themeOf(ch)], th = themeOf(ch), sp = glowSprite(P.part);
    g.globalCompositeOperation = 'lighter';
    for (var i = 0; i < 14; i++) {
      var s1 = hash(i + ch.id * 31), s2 = hash(i * 7.3 + 2), s3 = hash(i * 3.1 + 9), x, y, a;
      if (th === 'kor' || th === 'kale') { y = h - ((t * (14 + s2 * 22) + s1 * h * 1.3) % (h * 1.3)); x = s3 * w + sin(t + i) * 8; a = clamp(y / h, 0, 1); }
      else { x = (s1 * w + sin(t * 0.4 + i) * 22 + w) % w; y = h * (0.35 + s2 * 0.55) + sin(t * 0.7 + i * 2) * 10; a = 0.5 + 0.5 * sin(t * 2.2 + i * 1.7); }
      g.globalAlpha = a * 0.85; var s = 4 + s3 * 5; g.drawImage(sp, x - s, y - s, s * 2, s * 2);
    }
    g.globalAlpha = 1; g.globalCompositeOperation = 'source-over';
  }

  /* ============================================================================================
   * HOME (savas): hero showcase + chapter carousel + BAŞLA
   * ========================================================================================== */
  var HOME = {
    el: null, stage: null, stageRect: null, k: 1.9, rar: 0, look: null, car: null, cards: [], pos: 0, target: 0, drag: null,
    sel: null, dirty: true, hero: { act: null, idleT: 0, next: 5 }, bubbleT: 0, lastActive: -1, dotsKey: ''
  };
  function sideBtn(id, n, icn) {
    return '<button class="ui-sbtn" type="button" data-side="' + id + '" aria-label="' + esc(n) + '"><span class="ui-sbtn-ic">' + ic(icn) +
      '</span><span class="ui-sbtn-n">' + esc(n) + '</span><b class="dot" hidden></b></button>';
  }
  function defaultChapter() {
    var cs = chState(), C = chapters(), pick = C[0] ? C[0].id : 1;
    C.forEach(function (ch) { if (ch.id <= cs.max && !ch.locked) pick = ch.id; });
    return pick;
  }
  function homeMount(root) {
    HOME.el = root;
    root.classList.add('ui-home');
    root.innerHTML =
      '<div class="ui-home-top">' +
        '<button class="ui-htag" type="button" aria-label="Kahraman">' +
          '<span class="ui-htag-l1"><span class="ui-htag-rar"></span><span class="ui-htag-cls"></span></span>' +
          '<b class="ui-htag-name"></b>' +
          '<span class="ui-htag-l3"></span>' +
          '<span class="ui-htag-pas"></span>' +
        '</button>' +
      '</div>' +
      '<div class="ui-stage">' +
        '<div class="ui-side ui-side-l">' + sideBtn('map', 'Harita', 'map') + sideBtn('shop', 'Mağaza', 'shop') + '</div>' +
        '<div class="ui-side ui-side-r">' + sideBtn('quest', 'Görevler', 'quest') + sideBtn('mail', 'Posta', 'mail') + sideBtn('event', 'Etkinlik', 'event') + '</div>' +
        '<button class="ui-herohit" type="button" aria-label="Kahramana dokun"></button>' +
        '<div class="ui-bubble" hidden></div>' +
        '<div class="ui-plate"><span class="ui-plate-ic">' + ic('swords') + '</span><span class="ui-plate-tx"><b class="num ui-plate-v">0</b><small>SAVAŞ GÜCÜ</small></span></div>' +
      '</div>' +
      '<div class="ui-chaps">' +
        '<div class="ui-car" role="listbox" aria-label="Bölümler"></div>' +
        '<button class="ui-arr ui-arr-l" type="button" aria-label="Önceki bölüm">' + ic('left') + '</button>' +
        '<button class="ui-arr ui-arr-r" type="button" aria-label="Sonraki bölüm">' + ic('right') + '</button>' +
      '</div>' +
      '<div class="ui-dots"></div>' +
      '<div class="ui-cta"><button class="btn btn-gold btn-lg ui-start" type="button"><span class="ui-start-t">BAŞLA</span><span class="ui-start-c">' + ic('bolt') + '<b class="num">5</b></span></button></div>';
    HOME.stage = $('.ui-stage', root);
    HOME.car = $('.ui-car', root);
    HOME.cards = [];
    var C = chapters();
    if (HOME.sel == null || !chapterById(HOME.sel)) HOME.sel = defaultChapter();
    var idx = 0;
    C.forEach(function (ch, i) {
      if (ch.id === HOME.sel) idx = i;
      var card = mk('div', 'ui-ch');
      card.setAttribute('data-id', ch.id); card.setAttribute('role', 'option');
      card.style.setProperty('--tc', THEME[themeOf(ch)].glow);
      card.innerHTML = '<div class="ui-ch-art"></div>' +
        '<div class="ui-ch-info"><span class="ui-ch-no">BÖLÜM ' + ch.id + '</span><b class="ui-ch-name">' + esc(ch.n) + '</b><span class="ui-ch-sub">' + esc(ch.sub || '') + '</span></div>' +
        '<div class="ui-ch-foot"><span class="ui-ch-rec"></span><span class="ui-ch-best"></span></div>' +
        '<span class="ui-ch-done" hidden>' + ic('check') + '</span>' +
        '<div class="ui-ch-lock" hidden>' + ic('lock') + '<span></span></div>' +
        (ch.locked ? '<div class="ui-ribbon">' + esc((ch.soon || 'Yakında').toLocaleUpperCase('tr-TR')) + '</div>' : '') +
        '<div class="ui-ch-frame"></div>';
      HOME.car.appendChild(card);
      var rec = canvasHelper($('.ui-ch-art', card), function (ctx, w, h, t, r) { drawCard(ctx, w, h, t, r, ch); }, { keep: true });
      HOME.cards.push({ ch: ch, el: card, rec: rec, lx: null, ls: null, lo: null });
    });
    HOME.pos = HOME.target = idx;
    HOME.lastActive = -1;
    // events
    $('.ui-htag', root).addEventListener('click', function () { snd('click'); UI.go('kahraman'); });
    $('.ui-herohit', root).addEventListener('click', heroPoke);
    $$('.ui-sbtn', root).forEach(function (b) { b.addEventListener('click', function () { snd('click'); sideAction(b.getAttribute('data-side')); }); });
    $('.ui-arr-l', root).addEventListener('click', function () { carGo(HOME.target - 1); });
    $('.ui-arr-r', root).addEventListener('click', function () { carGo(HOME.target + 1); });
    $('.ui-start', root).addEventListener('click', function () { UI.startChapter(HOME.sel); });
    $('.ui-plate', root).addEventListener('click', function () { snd('click'); UI.go('ekipman'); });
    carBind();
    HOME.dirty = true;
    homeRefresh();
    layoutCards(true);
  }
  function homeUnmount() { HOME.drag = null; HOME.cards.forEach(function (c) { c.rec.stop(); }); }
  function drawCard(ctx, w, h, t, r, ch) {
    var cs = chState(), revealed = ch.id <= cs.max && !ch.locked;
    var A = cardArt(ch, w, h, r.dpr, revealed);
    var active = HOME.cards[HOME.target] && HOME.cards[HOME.target].ch === ch && !HOME.drag;
    if (!active || RM) {
      if (r.data.still === A.key) return;
      ctx.clearRect(0, 0, w, h); ctx.drawImage(A.still, 0, 0, w, h); r.data.still = A.key; return;
    }
    r.data.still = null;
    ctx.clearRect(0, 0, w, h);
    if (revealed) {
      ctx.drawImage(A.back, 0, 0, w, h);
      safe(function () { drawCardBoss(ctx, w, h, ch, t); }, 'card boss live');
      cardParticles(ctx, w, h, ch, t);
      ctx.drawImage(A.front, 0, 0, w, h);
    } else { ctx.drawImage(A.still, 0, 0, w, h); cardParticles(ctx, w, h, ch, t); }
  }
  function homeMeasure() {
    if (!HOME.stage || !HOME.stage.isConnected || !LOBBY) return;
    var L = LOBBY.getBoundingClientRect(), r = HOME.stage.getBoundingClientRect();
    HOME.stageRect = { x: r.left - L.left, y: r.top - L.top, w: r.width, h: r.height };
    HOME.k = clamp(mn((r.height - 158) / 98, (r.width - 130) / 95), 1.0, 2.4);
  }
  function homeRefresh() {
    if (!HOME.el || !HOME.el.isConnected) return;
    var id = activeId(), def = heroDef(id), hs = heroSt(id), R = rarOf(def.rar);
    var tag = $('.ui-htag', HOME.el);
    tag.style.setProperty('--rc', R.col);
    $('.ui-htag-rar', tag).textContent = R.n;
    $('.ui-htag-cls', tag).textContent = def.cls || '';
    $('.ui-htag-name', tag).textContent = def.n;
    $('.ui-htag-l3', tag).innerHTML = '<span class="ui-lv num">Sv. ' + fmt(hs.lvl || 1) + '</span>' + starsHtml(hs.stars || 1, 5);
    var pt = (def.passiveText && def.passiveText[0]) || '';
    $('.ui-htag-pas', tag).textContent = pt;
    $('.ui-htag-pas', tag).hidden = !pt;
    HOME.look = lookOf(id);
    HOME.rar = topRar();
    var pv = $('.ui-plate-v', HOME.el), pw = curPower();
    if (HOME.pow != null && HOME.pow !== pw) tweenNum(pv, HOME.pow, pw, 0.8); else pv.textContent = fmt(pw);
    HOME.pow = pw;
    // side badges
    var qd = questClaimable(), md = mailUnclaimed();
    sideDot('quest', qd); sideDot('mail', md); sideDot('event', 0); sideDot('shop', shopFreeReady() ? 1 : 0);
    // cards
    var cs = chState();
    HOME.cards.forEach(function (c) {
      var ch = c.ch, el = c.el, best = cs.best && cs.best[ch.id], unlocked = ch.id <= cs.max && !ch.locked;
      var rec = $('.ui-ch-rec', el), ok = pw >= (ch.rec || 0);
      rec.className = 'ui-ch-rec ' + (ok ? 'ok' : 'bad');
      rec.innerHTML = ic('swords') + '<span class="num">' + fmt(ch.rec || 0) + '</span>';
      rec.title = 'Önerilen güç';
      var bestEl = $('.ui-ch-best', el);
      if (best && best.cleared) bestEl.innerHTML = ic('clock') + '<span class="num">' + fmtTime(best.fastest || best.time) + '</span>';
      else if (best && best.time) bestEl.innerHTML = ic('clock') + '<span class="num">' + fmtTime(best.time) + '</span>';
      else bestEl.innerHTML = '<span class="dim">Denenmedi</span>';
      $('.ui-ch-done', el).hidden = !(best && best.cleared);
      el.classList.toggle('locked', !unlocked);
      var lk = $('.ui-ch-lock', el);
      lk.hidden = unlocked || !!ch.locked;
      if (!unlocked && !ch.locked) { var prev = chapterById(ch.id - 1); $('span', lk).textContent = prev ? '“' + prev.n + '” bölümünü geç' : 'Kilitli'; }
    });
    homeUpdateStart();
    homeDots();
    HOME.dirty = true;
  }
  function sideDot(id, n) { var b = HOME.el && $('.ui-sbtn[data-side="' + id + '"] .dot', HOME.el); if (b) { b.hidden = !(n > 0); b.textContent = n > 9 ? '9+' : String(n); } }
  function homeUpdateStart() {
    if (!HOME.el || !HOME.el.isConnected) return;
    var ch = chapterById(HOME.sel), btn = $('.ui-start', HOME.el);
    if (!ch || !btn) return;
    var chk = call('canStart', ch.id) || { ok: true };
    var cost = runCost(ch);
    $('.ui-start-c b', btn).textContent = fmt(cost);
    var label = 'BAŞLA';
    if (ch.locked) label = (ch.soon || 'Yakında').toLocaleUpperCase('tr-TR');
    else if (chk.code === 'locked') label = 'KİLİTLİ';
    $('.ui-start-t', btn).textContent = label;
    btn.classList.toggle('off', !chk.ok);
    btn.classList.toggle('ui-pulse', !!chk.ok);
    $('.ui-start-c', btn).classList.toggle('bad', chk.code === 'energy');
  }
  function homeDots() {
    var d = $('.ui-dots', HOME.el); if (!d) return;
    var cs = chState(), key = HOME.target + '|' + cs.max;
    if (key === HOME.dotsKey && d.childNodes.length) return;
    HOME.dotsKey = key;
    d.innerHTML = HOME.cards.map(function (c, i) {
      var st = c.ch.locked ? 'soon' : c.ch.id > cs.max ? 'lock' : (cs.best[c.ch.id] && cs.best[c.ch.id].cleared ? 'done' : 'open');
      return '<i class="' + st + (i === HOME.target ? ' on' : '') + '"></i>';
    }).join('');
  }
  function carStep() { var w = HOME.car ? HOME.car.clientWidth : 360; HOME.cw = clamp(w * 0.8, 240, 330); return HOME.cw + 12; }
  function carGo(i) {
    var n = HOME.cards.length; if (!n) return;
    i = clamp(i, 0, n - 1);
    if (i !== HOME.target) snd('whoosh', { vol: 0.35 });
    HOME.target = i;
    HOME.sel = HOME.cards[i].ch.id;
    UI.selChapter = HOME.sel;
    homeUpdateStart(); homeDots();
  }
  function carBind() {
    var car = HOME.car;
    car.addEventListener('pointerdown', function (e) {
      if (e.button != null && e.button > 0) return;
      HOME.drag = { x0: e.clientX, p0: HOME.pos, moved: false, lx: e.clientX, lt: performance.now(), v: 0, id: e.pointerId,
        card: e.target && e.target.closest ? e.target.closest('.ui-ch') : null };
      try { car.setPointerCapture(e.pointerId); } catch (x) { /* ignore */ }
    });
    car.addEventListener('pointermove', function (e) {
      var d = HOME.drag; if (!d || d.id !== e.pointerId) return;
      var dx = e.clientX - d.x0;
      if (abs(dx) > 6) d.moved = true;
      var step = carStep(), n = HOME.cards.length;
      HOME.pos = clamp(d.p0 - dx / step, -0.3, n - 0.7);
      var now = performance.now(), dtm = mx(1, now - d.lt);
      d.v = lerp(d.v, -(e.clientX - d.lx) / step / (dtm / 1000), 0.35);
      d.lx = e.clientX; d.lt = now;
    });
    function end(e) {
      var d = HOME.drag; if (!d || d.id !== e.pointerId) return;
      HOME.drag = null;
      if (d.moved) { carGo(round(HOME.pos + clamp(d.v * 0.18, -1, 1))); return; }
      var card = d.card;
      if (!card) return;
      var i = -1; HOME.cards.forEach(function (c, j) { if (c.el === card) i = j; });
      if (i < 0) return;
      if (i !== HOME.target) { carGo(i); return; }
      cardTap(HOME.cards[i].ch);
    }
    car.addEventListener('pointerup', end);
    car.addEventListener('pointercancel', function (e) { if (HOME.drag && HOME.drag.id === e.pointerId) { HOME.drag = null; carGo(round(HOME.pos)); } });
  }
  function cardTap(ch) {
    var cs = chState();
    snd('click');
    if (ch.locked) { UI.toast((ch.n || 'Bölüm') + ': ' + (ch.soon || 'Yakında') + '…', 'info'); return; }
    if (ch.id > cs.max) { var prev = chapterById(ch.id - 1); UI.toast(prev ? 'Önce “' + prev.n + '” bölümünü geç' : 'Bölüm kilitli', 'warn'); return; }
    openChapterInfo(ch);
  }
  function layoutCards(force) {
    if (!HOME.car) return;
    var step = carStep(), cw = HOME.cw;
    if (force || HOME.lcw !== cw) { HOME.lcw = cw; HOME.car.style.setProperty('--cw', round(cw) + 'px'); }
    var activeIdx = round(HOME.pos);
    HOME.cards.forEach(function (c, i) {
      var d = i - HOME.pos, ad = abs(d);
      var x = round(d * step * 10) / 10, s = round((1 - mn(1, ad) * 0.1) * 1000) / 1000, o = round((1 - mn(1.5, ad) * 0.42) * 100) / 100;
      if (force || x !== c.lx || s !== c.ls || o !== c.lo) {
        c.lx = x; c.ls = s; c.lo = o;
        c.el.style.transform = 'translate3d(' + x + 'px,0,0) scale(' + s + ')';
        c.el.style.opacity = o;
        c.el.style.zIndex = String(10 - round(ad * 2));
      }
      c.el.classList.toggle('on', i === activeIdx);
    });
    var l = $('.ui-arr-l', HOME.el), r = $('.ui-arr-r', HOME.el);
    if (l) l.classList.toggle('hide', HOME.target <= 0);
    if (r) r.classList.toggle('hide', HOME.target >= HOME.cards.length - 1);
  }
  function homeFrame(dt, t) {
    if (!HOME.el || !HOME.el.isConnected) return;
    homeMeasure();
    if (!HOME.drag) {
      var k = 1 - Math.exp(-dt * 11);
      HOME.pos += (HOME.target - HOME.pos) * k;
      if (abs(HOME.target - HOME.pos) < 0.0005) HOME.pos = HOME.target;
    }
    layoutCards(false);
    HOME.cdAcc = (HOME.cdAcc || 0) + dt;
    if (HOME.cdAcc > 1 || !HOME.cdEl) {
      HOME.cdAcc = 0;
      if (!HOME.cdEl || !HOME.cdEl.isConnected) { var eb = $('.ui-sbtn[data-side="event"]', HOME.el); if (eb) { HOME.cdEl = mk('i', 'ui-sbtn-t num'); eb.appendChild(HOME.cdEl); } }
      if (HOME.cdEl) { var left = (nextEventStart() - Date.now()) / 1000, d = floor(left / 86400); HOME.cdEl.textContent = d > 0 ? d + 'g ' + floor(left % 86400 / 3600) + 'sa' : fmtDur(left).slice(-8); }
    }
    if (HOME.bubbleT > 0) { HOME.bubbleT -= dt; if (HOME.bubbleT <= 0) { var b = $('.ui-bubble', HOME.el); if (b) b.hidden = true; } }
  }
  function heroPoke() {
    var def = heroDef(activeId()), H = HOME.hero, busy = H.act && H.act.t < H.act.d * 0.7;
    var lines = [];
    if (def.quote) lines.push(def.quote.replace(/[“”]/g, ''));
    if (def.lines) { if (def.lines.start) lines.push(def.lines.start); if (def.lines.win) lines.push(def.lines.win); }
    if (!lines.length) lines.push('Hazırım!');
    H.pokeI = ((H.pokeI || 0) + 1) % lines.length;
    var useAtk = Math.random() < 0.5;
    if (!busy) { H.act = useAtk ? { anim: 'attack', t: 0, d: 0.6 } : { anim: 'victory', t: 0, d: 1.4 }; snd(useAtk ? 'slash' : 'magic', { vol: 0.45 }); }
    H.idleT = 0;
    var b = $('.ui-bubble', HOME.el);
    if (b) {
      b.textContent = lines[H.pokeI];
      b.hidden = false; b.classList.remove('ui-pop'); void b.offsetWidth; b.classList.add('ui-pop');
      if (HOME.stageRect) b.style.bottom = round(50 + 106 * HOME.k) + 'px';
      HOME.bubbleT = 2.8;
    }
  }
  function sideAction(id) {
    if (id === 'map') openChapterMap();
    else if (id === 'quest') openQuests();
    else if (id === 'mail') openMail();
    else if (id === 'event') openEvent();
    else if (id === 'shop') UI.openShop();
  }

  /* chapter info + chapter map modals */
  function chapterStatus(ch, cs) {
    if (ch.locked) return { k: 'soon', n: ch.soon || 'Yakında' };
    if (ch.id > cs.max) return { k: 'lock', n: 'Kilitli' };
    if (cs.best[ch.id] && cs.best[ch.id].cleared) return { k: 'done', n: 'Temizlendi' };
    return { k: 'open', n: 'Açık' };
  }
  function openChapterInfo(ch) {
    var cs = chState(), best = cs.best[ch.id] || {}, pw = curPower(), D = GM.D || {};
    var bossN = ch.boss && D.ENEMIES && D.ENEMIES[ch.boss] ? D.ENEMIES[ch.boss].n : (ch.boss ? ch.boss : 'Gölge Kralı');
    var rw = ch.reward || {};
    var body = mk('div', 'ui-chinfo',
      '<div class="ui-chinfo-art"></div>' +
      '<p class="muted ui-chinfo-d">' + esc(ch.desc || '') + '</p>' +
      '<div class="ui-kv">' +
        '<div><span>Boss</span><b>' + esc(bossN) + '</b></div>' +
        '<div><span>Önerilen güç</span><b class="' + (pw >= (ch.rec || 0) ? 'c-green' : 'c-red') + '">' + fmt(ch.rec || 0) + '</b></div>' +
        '<div><span>Senin gücün</span><b class="c-gold">' + fmt(pw) + '</b></div>' +
        '<div><span>Süre</span><b>' + fmtTime(ch.dur || 240) + '</b></div>' +
        '<div><span>En iyi</span><b>' + (best.cleared ? fmtTime(best.fastest || best.time) + ' (zafer)' : best.time ? fmtTime(best.time) : '—') + '</b></div>' +
        '<div><span>Zafer sayısı</span><b>' + fmt(best.clears || 0) + '</b></div>' +
      '</div>' +
      '<div class="ui-rw-row"><span class="dim">Ödüller</span>' +
        '<span class="ui-rw">' + ic('gold') + '<b class="num">' + fmt(rw.gold || 0) + '</b></span>' +
        (rw.gems ? '<span class="ui-rw' + (best.cleared ? ' used' : '') + '">' + ic('gem') + '<b class="num">' + fmt(rw.gems) + '</b><small>ilk zafer</small></span>' : '') +
        '<span class="ui-rw">' + ic('chest') + '<b class="num">+2</b></span>' +
      '</div>' +
      '<button class="btn btn-gold btn-lg ui-chinfo-go" type="button">BAŞLA <span class="cost">' + ic('bolt') + fmt(runCost(ch)) + '</span></button>');
    var m = UI.modal(body, { title: 'Bölüm ' + ch.id + ' · ' + ch.n, cls: 'ui-chinfo-m' });
    var host = $('.ui-chinfo-art', body);
    canvasHelper(host, function (ctx, w, h, t, r) {
      var A = cardArt(ch, w, h, r.dpr, true);
      ctx.drawImage(A.back, 0, 0, w, h);
      safe(function () { drawCardBoss(ctx, w, h, ch, t); }, 'info boss');
      cardParticles(ctx, w, h, ch, t);
      ctx.drawImage(A.front, 0, 0, w, h);
    });
    $('.ui-chinfo-go', body).addEventListener('click', function () { m.close(); UI.startChapter(ch.id); });
  }
  function openChapterMap() {
    var cs = chState(), C = chapters();
    var body = mk('div', 'ui-map');
    body.innerHTML = '<div class="ui-map-bg"></div><div class="ui-map-path">' + C.slice().reverse().map(function (ch, ri) {
      var st = chapterStatus(ch, cs), best = cs.best[ch.id], side = (C.length - 1 - ri) % 2 ? 'r' : 'l';
      var tcol = THEME[themeOf(ch)].glow;
      return '<button class="ui-node ' + st.k + ' ' + side + '" type="button" data-id="' + ch.id + '" style="--tc:' + tcol + ';--td:' + mixHex(tcol, '#120C18', 0.62) + '">' +
        '<span class="ui-node-m"><b class="num">' + ch.id + '</b>' + (st.k === 'lock' || st.k === 'soon' ? '<i class="ui-node-lock">' + ic('lock') + '</i>' : '') + (st.k === 'done' ? '<i class="ui-node-ok">' + ic('check') + '</i>' : '') + '</span>' +
        '<span class="ui-node-t"><b>' + esc(ch.n) + '</b><small>' + esc(ch.sub || '') + '</small>' +
        '<em class="ui-node-s ' + st.k + '">' + esc(st.n) + (best && best.cleared ? ' · ' + fmtTime(best.fastest || best.time) : '') + ' · ' + ic('swords') + fmt(ch.rec || 0) + '</em></span></button>';
    }).join('') + '</div>';
    var m = UI.modal(body, { title: 'Bölüm Haritası', cls: 'ui-map-m' });
    canvasHelper($('.ui-map-bg', body), function (ctx, w, h, t) { drawMapBg(ctx, w, h, t, C, cs); }, { fps: 30 });
    $$('.ui-node', body).forEach(function (b) {
      b.addEventListener('click', function () {
        var id = +b.getAttribute('data-id'), ch = chapterById(id), st = chapterStatus(ch, cs);
        if (st.k === 'soon') { UI.toast(ch.n + ': ' + (ch.soon || 'Yakında'), 'info'); return; }
        if (st.k === 'lock') { snd('error'); UI.toast('Önce önceki bölümü geç', 'warn'); return; }
        snd('click');
        var i = -1; HOME.cards.forEach(function (c, j) { if (c.ch.id === id) i = j; });
        if (i >= 0) carGo(i); else HOME.sel = id;
        m.close();
      });
    });
  }
  var MAPBG = { key: '', cv: null };
  function drawMapBg(ctx, w, h, t, C, cs) {
    var n = C.length, dpr = DPR(), key = round(w) + 'x' + round(h) + '@' + dpr + '|' + cs.max;
    if (MAPBG.key !== key) {
      // vertical collage of the chapter paintings (bottom = chapter 1), blended with soft seams
      MAPBG.key = key; MAPBG.cv = offCv(w * dpr, h * dpr);
      var g = MAPBG.cv.getContext('2d'); g.scale(dpr, dpr);
      g.fillStyle = '#0A0710'; g.fillRect(0, 0, w, h);
      var bh = h / n;
      C.forEach(function (ch, i) {
        var y0 = h - (i + 1) * bh, tile = offCv(w * dpr, bh * 1.5 * dpr), tg = tile.getContext('2d');
        tg.scale(dpr, dpr); paintCardBack(tg, w, bh * 1.5, ch);
        var on = ch.id <= cs.max && !ch.locked;
        g.save(); g.globalAlpha = on ? 0.62 : 0.3;
        g.drawImage(tile, 0, y0 - bh * 0.25, w, bh * 1.5);
        g.restore();
      });
      for (var i = 1; i < n; i++) {
        var yy = h - i * bh, gr = g.createLinearGradient(0, yy - bh * 0.3, 0, yy + bh * 0.3);
        gr.addColorStop(0, 'rgba(10,7,16,0)'); gr.addColorStop(0.5, 'rgba(10,7,16,0.85)'); gr.addColorStop(1, 'rgba(10,7,16,0)');
        g.fillStyle = gr; g.fillRect(0, yy - bh * 0.3, w, bh * 0.6);
      }
      var vg = g.createRadialGradient(w / 2, h / 2, mn(w, h) * 0.3, w / 2, h / 2, mx(w, h) * 0.7);
      vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,0.6)');
      g.fillStyle = vg; g.fillRect(0, 0, w, h);
    }
    ctx.drawImage(MAPBG.cv, 0, 0, w, h);
    // winding dotted road between node medallions
    var pts = [];
    for (var j = 0; j < n; j++) pts.push([j % 2 ? w * 0.78 : w * 0.22, h - (j + 0.5) * h / n]);
    ctx.lineWidth = 3; ctx.setLineDash([5, 7]); ctx.lineDashOffset = -t * 12;
    ctx.strokeStyle = 'rgba(255,203,87,0.55)';
    ctx.beginPath();
    pts.forEach(function (p, k) { if (!k) ctx.moveTo(p[0], p[1]); else { var q = pts[k - 1]; ctx.bezierCurveTo(q[0], (q[1] + p[1]) / 2, p[0], (q[1] + p[1]) / 2, p[0], p[1]); } });
    ctx.stroke(); ctx.setLineDash([]);
    ctx.globalCompositeOperation = 'lighter';
    pts.forEach(function (p, k) {
      var ch = C[k], col = THEME[themeOf(ch)].glow, on = ch.id <= cs.max && !ch.locked;
      ctx.globalAlpha = on ? 0.55 + 0.2 * sin(t * 2 + k) : 0.12;
      var s2 = h / n * 1.3; ctx.drawImage(glowSprite(col, true), p[0] - s2 / 2, p[1] - s2 / 2, s2, s2);
    });
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
  }

  /* ============================================================================================
   * Start flow + portal transition
   * ========================================================================================== */
  UI.startChapter = function (id) {
    if (PORTAL) return false;
    var ch = chapterById(id);
    if (!ch) { UI.toast('Bölüm bulunamadı', 'warn'); return false; }
    if (!S()) { UI.toast('Profil yüklenemedi', 'warn'); return false; }
    var chk = call('canStart', ch.id) || { ok: false, reason: 'Başlatılamadı' };
    if (!chk.ok) {
      if (chk.code === 'energy') {
        var e = energyInfo();
        UI.toast('Yetersiz enerji (' + e.cur + '/' + runCost(ch) + ')' + (e.full ? '' : ' · +1 ' + fmtTime(e.nextInSec)), 'warn');
        var chip = TOP && $('.ui-chip-en', TOP);
        if (chip) { chip.classList.remove('ui-shake'); void chip.offsetWidth; chip.classList.add('ui-shake'); }
      } else UI.toast(chk.reason || 'Başlatılamadı', chk.code === 'soon' ? 'info' : 'warn');
      return false;
    }
    if (!GM.B || typeof GM.B.start !== 'function') { UI.toast('Savaş alanı henüz hazır değil', 'warn'); return false; }
    if (!call('startRun', ch.id)) { UI.toast('Savaş başlatılamadı', 'warn'); return false; }
    UI.closeModals();
    portal(ch);
    return true;
  };
  function portal(ch) {
    var el = mk('div', 'ui-portal');
    LAYER.appendChild(el);
    var col = THEME[themeOf(ch)].glow;
    var btn = HOME.el && HOME.el.isConnected ? $('.ui-start', HOME.el) : null;
    var R = rootRect(), cx = R.width / 2, cy = R.height * 0.45;
    if (btn) { var br = relRect(btn); cx = br.x + br.w / 2; cy = br.y + br.h / 2; }
    PORTAL = { t: 0, ch: ch, el: el, col: col, cx: cx, cy: cy, done: false };
    PORTAL.rec = canvasHelper(el, function (ctx, w, h, t) { drawPortal(ctx, w, h, t); });
    snd('whoosh'); snd('magic', { vol: 0.7 });
    if (GM.A && GM.A.duck) safe(function () { GM.A.duck(0.5, 0.8); }, 'duck');
  }
  function drawPortal(ctx, w, h, t) {
    var P0 = PORTAL; if (!P0) return;
    var p = clamp(P0.t / 0.8, 0, 1), e = eInOut(p);
    var cx = lerp(P0.cx, w / 2, e), cy = lerp(P0.cy, h * 0.46, e);
    var maxR = Math.hypot(mx(cx, w - cx), mx(cy, h - cy)) * 1.06, R = 26 + maxR * eIn(clamp(p * 1.1, 0, 1));
    var col = P0.col, i, j, f;
    // the world outside darkens and leans in
    var og = ctx.createRadialGradient(cx, cy, R, cx, cy, mx(w, h));
    og.addColorStop(0, 'rgba(4,2,8,' + (0.35 + 0.5 * p).toFixed(3) + ')'); og.addColorStop(1, 'rgba(4,2,8,' + (0.15 + 0.6 * p).toFixed(3) + ')');
    ctx.fillStyle = og; ctx.fillRect(0, 0, w, h);
    // the void
    ctx.save(); ctx.beginPath(); ctx.arc(cx, cy, R, 0, TAU); ctx.clip();
    var vg = ctx.createRadialGradient(cx, cy, 0, cx, cy, R);
    vg.addColorStop(0, rgba(col, 0.95)); vg.addColorStop(0.16, '#4A2290'); vg.addColorStop(0.55, '#140824'); vg.addColorStop(1, '#040208');
    ctx.fillStyle = vg; ctx.fillRect(cx - R, cy - R, R * 2, R * 2);
    ctx.globalCompositeOperation = 'lighter';
    var passes = [[R * 0.1 + 6, 0.10], [R * 0.035 + 3, 0.28], [R * 0.01 + 1.2, 0.9]];
    for (i = 0; i < 6; i++) {
      var a0 = -t * 5.5 + i * TAU / 6, c = i % 2 ? col : '#B48CFF';
      for (j = 0; j < passes.length; j++) {
        ctx.lineWidth = passes[j][0]; ctx.strokeStyle = rgba(c, passes[j][1]); ctx.lineCap = 'round';
        ctx.beginPath();
        for (var k = 0; k <= 36; k++) { f = k / 36; var rr = R * (0.04 + f * 1.04), a = a0 + f * 3.8, x = cx + cos(a) * rr, y = cy + sin(a) * rr; if (k) ctx.lineTo(x, y); else ctx.moveTo(x, y); }
        ctx.stroke();
      }
    }
    // sparks sucked into the centre
    var sp = glowSprite(col), sw = glowSprite('#E6D8FF');
    for (j = 0; j < (RM ? 12 : 44); j++) {
      var s1 = hash(j * 1.73 + 0.3), life = (t * 1.1 + s1) % 1, r2 = R * (1 - life) * 1.02, aa = s1 * TAU + life * 5 - t * 2.5;
      ctx.globalAlpha = 0.25 + 0.75 * life; var ss = 3 + 7 * (1 - life);
      ctx.drawImage(j % 3 ? sp : sw, cx + cos(aa) * r2 - ss, cy + sin(aa) * r2 - ss, ss * 2, ss * 2);
    }
    ctx.globalAlpha = 0.85; var cs = R * 0.45 + 30; ctx.drawImage(glowSprite('#FFFFFF'), cx - cs / 2, cy - cs / 2, cs, cs);
    ctx.globalAlpha = 1; ctx.restore();
    // energy rim + rotating rune dashes
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineWidth = 14; ctx.strokeStyle = rgba(col, 0.22); ctx.beginPath(); ctx.arc(cx, cy, R, 0, TAU); ctx.stroke();
    ctx.lineWidth = 4; ctx.strokeStyle = rgba(col, 0.95); ctx.beginPath(); ctx.arc(cx, cy, R, 0, TAU); ctx.stroke();
    ctx.lineWidth = 1.5; ctx.strokeStyle = 'rgba(255,255,255,0.85)'; ctx.beginPath(); ctx.arc(cx, cy, R - 2, 0, TAU); ctx.stroke();
    ctx.setLineDash([4, 9]); ctx.lineDashOffset = -t * 60; ctx.lineWidth = 2.5; ctx.strokeStyle = 'rgba(255,203,87,0.7)';
    ctx.beginPath(); ctx.arc(cx, cy, R + 10, 0, TAU); ctx.stroke(); ctx.setLineDash([]);
    ctx.globalCompositeOperation = 'source-over';
    if (p > 0.8) { ctx.fillStyle = 'rgba(250,244,255,' + ((RM ? 0.35 : 0.96) * eIn((p - 0.8) / 0.2)).toFixed(3) + ')'; ctx.fillRect(0, 0, w, h); }
  }
  function portalStep(dt) {
    if (!PORTAL) return;
    PORTAL.t += dt;
    if (PORTAL.t >= 0.8 && !PORTAL.done) {
      PORTAL.done = true;
      var P0 = PORTAL, ok = true;
      drawCanvases(0, T);   // final (flash) frame before battle takes over the loop
      try { GM.B.start(P0.ch.id); } catch (e) { ok = false; report(e, 'GM.B.start'); }
      if (!ok) { if (LOBBY) LOBBY.hidden = false; var bt = document.getElementById('gm-battle'); if (bt && !(GM.B && GM.B.active)) bt.hidden = true; UI.toast('Savaş başlatılamadı', 'warn'); }
      P0.el.classList.add('ui-portal-out');
      P0.rec.stop();
      setTimeout(function () { if (P0.el.parentNode) P0.el.parentNode.removeChild(P0.el); }, 520);
      PORTAL = null;
    }
  }

  /* ============================================================================================
   * Daily quests / mail / event / shop / profile modals
   * ========================================================================================== */
  var QUESTS = [
    { id: 'q_run1', n: 'Bir savaşa katıl', k: 'runs', need: 1, rw: { gold: 300 }, ic: 'swords' },
    { id: 'q_kill', n: '150 düşman yok et', k: 'kills', need: 150, rw: { gems: 20 }, ic: 'skull' },
    { id: 'q_metin', n: 'Bir Metin Taşı kır', k: 'metins', need: 1, rw: { gold: 400 }, ic: 'gem' },
    { id: 'q_boss', n: 'Bir boss devir', k: 'bosses', need: 1, rw: { gems: 40 }, ic: 'crown' },
    { id: 'q_run3', n: '3 savaş tamamla', k: 'runs', need: 3, rw: { energy: 10 }, ic: 'bolt' }];
  function dayKey() { var d = new Date(); return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate(); }
  function secToMidnight() { var d = new Date(), m = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1); return (m - d) / 1000; }
  function daily() {
    var L = ls(), dk = dayKey();
    if (!L.daily || L.daily.day !== dk || !L.daily.base) {
      var Tt = totals();
      L.daily = { day: dk, base: { runs: Tt.runs || 0, kills: Tt.kills || 0, metins: Tt.metins || 0, bosses: Tt.bosses || 0 }, claimed: {}, gift: false };
      lsSave();
    }
    return L.daily;
  }
  function questProg(q) { var dl = daily(), Tt = totals(); return clamp((Tt[q.k] || 0) - (dl.base[q.k] || 0), 0, q.need); }
  function questClaimable() { if (!S()) return 0; var dl = daily(), n = 0; QUESTS.forEach(function (q) { if (!dl.claimed[q.id] && questProg(q) >= q.need) n++; }); return n; }
  function rwHtml(rw) {
    var s = '';
    if (rw.gold) s += '<span class="ui-rw">' + ic('gold') + '<b class="num">' + fmt(rw.gold) + '</b></span>';
    if (rw.gems) s += '<span class="ui-rw">' + ic('gem') + '<b class="num">' + fmt(rw.gems) + '</b></span>';
    if (rw.energy) s += '<span class="ui-rw">' + ic('bolt') + '<b class="num">' + fmt(rw.energy) + '</b></span>';
    return s;
  }
  function grant(rw, fromEl) {
    var s = S(); if (!s) return false;
    var parts = [];
    if (rw.gold) { call('addGold', rw.gold); parts.push('+' + fmt(rw.gold) + ' altın'); if (fromEl) UI.floatNum(fromEl, '+' + fmt(rw.gold), '#FFCB57'); }
    if (rw.gems) { call('addGems', rw.gems); parts.push('+' + fmt(rw.gems) + ' elmas'); if (fromEl) UI.floatNum(fromEl, '+' + fmt(rw.gems), '#FF6FB5'); }
    if (rw.energy) {
      if (typeof s.addEnergy === 'function') call('addEnergy', rw.energy);
      else { var p = s.p; p.energy = (p.energy || 0) + rw.energy; if (s.save) call('save'); }
      parts.push('+' + fmt(rw.energy) + ' enerji');
      if (fromEl) UI.floatNum(fromEl, '+' + fmt(rw.energy), '#3EDBC8');
    }
    snd('reward');
    UI.toast(parts.join(' · '), 'ok');
    UI.refresh();
    return true;
  }
  function openQuests() {
    var body = mk('div', 'ui-quests');
    function render() {
      var dl = daily();
      body.innerHTML = '<div class="ui-q-head"><span class="muted">Yenilenmesine</span><b class="num ui-q-cd">' + fmtDur(secToMidnight()) + '</b></div>' +
        QUESTS.map(function (q) {
          var pr = questProg(q), done = pr >= q.need, cl = !!dl.claimed[q.id];
          return '<div class="ui-q' + (cl ? ' claimed' : done ? ' ready' : '') + '"><span class="ui-q-ic">' + ic(q.ic) + '</span>' +
            '<div class="ui-q-m"><b>' + esc(q.n) + '</b><div class="pbar ' + (done ? 'green' : '') + '"><i style="width:' + round(pr / q.need * 100) + '%"></i></div>' +
            '<small class="num">' + fmt(pr) + ' / ' + fmt(q.need) + '</small></div>' +
            '<div class="ui-q-r">' + rwHtml(q.rw) + (cl ? '<span class="ui-q-ok">' + ic('check') + '</span>'
              : '<button class="btn btn-sm ' + (done ? 'btn-green' : 'btn-dark off') + ' ui-q-b" type="button" data-q="' + q.id + '">' + (done ? 'Topla' : 'Devam') + '</button>') + '</div></div>';
        }).join('');
      $$('.ui-q-b', body).forEach(function (b) {
        b.addEventListener('click', function () {
          var q = null; QUESTS.forEach(function (x) { if (x.id === b.getAttribute('data-q')) q = x; });
          if (!q) return;
          if (questProg(q) < q.need) { snd('error'); UI.toast('Görev henüz tamamlanmadı', 'info'); return; }
          var dl2 = daily(); if (dl2.claimed[q.id]) return;
          dl2.claimed[q.id] = true; lsSave();
          grant(q.rw, b);
          render();
        });
      });
    }
    render();
    var m = UI.modal(body, { title: 'Günlük Görevler', cls: 'ui-quests-m' });
    var cdT = setInterval(function () { if (!body.isConnected) { clearInterval(cdT); return; } var c = $('.ui-q-cd', body); if (c) c.textContent = fmtDur(secToMidnight()); }, 1000);
    return m;
  }
  var MAIL = [
    { id: 'm_hosgeldin', from: 'Gölge Konseyi', n: 'Hoş geldin, Muhafız!', gift: { gold: 500, gems: 100 },
      txt: 'Metin taşları gökten düştüğünden beri Karanlık her gece biraz daha yaklaşıyor. Konsey sana küçük bir armağan gönderdi: zırhını güçlendir, kılıcını bile ve Kara Orman’a yürü.' },
    { id: 'm_bora', from: 'Bora', n: 'Kuzey’den bir not',
      txt: 'Kurt Kral’ın ulumasını duydun mu? Sürüsü ormanın kenarına kadar indi. Kalkanını sıkı tut, sağ elinden şaşma. Ve unutma: hiçbir muhafız tek başına düşmez.' },
    { id: 'm_kizilay', from: 'Kâhin Selvi', n: 'Kızıl Ay yaklaşıyor', gift: { energy: 10 },
      txt: 'Yıldızlar kızıla dönüyor. Kızıl Ay Festivali başladığında Metin taşları iki kat ganimet düşürecek. Bu enerjiyi şimdiden sakla, muhafız.' }];
  function mailUnclaimed() { var L = ls(), m = L.mail || {}, n = 0; MAIL.forEach(function (x) { if ((x.gift && !m[x.id]) || (!x.gift && !(L.read || {})[x.id])) n++; }); return n; }
  function openMail() {
    var L = ls(); L.mail = L.mail || {}; L.read = L.read || {};
    var body = mk('div', 'ui-mail');
    function render() {
      body.innerHTML = MAIL.map(function (x) {
        var got = !!L.mail[x.id], unread = x.gift ? !got : !L.read[x.id];
        return '<details class="ui-letter' + (unread ? ' unread' : '') + '" data-m="' + x.id + '"><summary><span class="ui-letter-ic">' + ic(x.gift ? 'chest' : 'mail') + '</span>' +
          '<span class="ui-letter-t"><b>' + esc(x.n) + '</b><small>' + esc(x.from) + '</small></span>' + (unread ? '<i class="ui-letter-dot"></i>' : '') + '</summary>' +
          '<p>' + esc(x.txt) + '</p>' +
          (x.gift ? '<div class="ui-letter-g">' + rwHtml(x.gift) + (got ? '<span class="ui-q-ok">' + ic('check') + ' Alındı</span>'
            : '<button class="btn btn-sm btn-green ui-letter-b" type="button" data-m="' + x.id + '">Al</button>') + '</div>' : '') + '</details>';
      }).join('');
      $$('.ui-letter', body).forEach(function (d) {
        d.addEventListener('toggle', function () {
          if (!d.open) return;
          snd('click');
          var id = d.getAttribute('data-m');
          if (!L.read[id]) { L.read[id] = true; lsSave(); d.classList.remove('unread'); var dot = $('.ui-letter-dot', d); var x = MAIL.filter(function (q) { return q.id === id; })[0]; if (dot && x && !x.gift) dot.remove(); homeRefreshSoon(); }
        });
      });
      $$('.ui-letter-b', body).forEach(function (b) {
        b.addEventListener('click', function (e) {
          e.preventDefault();
          var id = b.getAttribute('data-m'), x = MAIL.filter(function (q) { return q.id === id; })[0];
          if (!x || L.mail[id]) return;
          L.mail[id] = true; L.read[id] = true; lsSave();
          grant(x.gift, b);
          render();
          var d = $('.ui-letter[data-m="' + id + '"]', body); if (d) d.open = true;
        });
      });
    }
    render();
    return UI.modal(body, { title: 'Posta', cls: 'ui-mail-m' });
  }
  function homeRefreshSoon() { needRefresh = true; }
  function openEvent() {
    var start = nextEventStart(), Tt = totals();
    var miles = [{ n: '10 Metin Taşı kır', k: 'metins', need: 10, rw: 'Kızıl Ay Sandığı' }, { n: '5 boss devir', k: 'bosses', need: 5, rw: 'Kızıl Ay Çerçevesi' }, { n: '2.000 düşman', k: 'kills', need: 2000, rw: 'Destansı Silah Sandığı' }];
    var body = mk('div', 'ui-event',
      '<div class="ui-ev-banner"><div class="ui-ev-art"></div><div class="ui-ev-tx"><span class="ui-kick">Sınırlı süreli etkinlik</span><b class="ttl">Kızıl Ay Festivali</b>' +
      '<span class="ui-ev-cd">' + ic('clock') + '<span>Başlamasına</span> <b class="num" data-cd>' + fmtDur((start - Date.now()) / 1000) + '</b></span></div></div>' +
      '<p class="muted">Kızıl Ay yükseldiğinde Metin taşları iki kat ganimet düşürür, boss’lar kızıl zırh giyer. Ön hazırlık görevleri şimdiden sayılıyor!</p>' +
      '<div class="ui-ev-list">' + miles.map(function (mi) {
        var pr = clamp(Tt[mi.k] || 0, 0, mi.need);
        return '<div class="ui-ev-row"><div><b>' + esc(mi.n) + '</b><small>' + esc(mi.rw) + '</small></div><div class="pbar violet"><i style="width:' + round(pr / mi.need * 100) + '%"></i></div><span class="num">' + fmt(pr) + '/' + fmt(mi.need) + '</span></div>';
      }).join('') + '</div>' +
      '<button class="btn btn-violet ui-ev-b" type="button">' + ic('bell') + ' Hatırlat</button>');
    var m = UI.modal(body, { title: 'Etkinlik', cls: 'ui-event-m' });
    canvasHelper($('.ui-ev-art', body), function (ctx, w, h, t) { drawMoonArt(ctx, w, h, t); }, { fps: 30 });
    $('.ui-ev-b', body).addEventListener('click', function () { var L = ls(); L.notifyEvent = true; lsSave(); snd('click'); UI.toast('Etkinlik başlayınca haber vereceğiz!', 'ok'); m.close(); });
    var cdT = setInterval(function () { if (!body.isConnected) { clearInterval(cdT); return; } var c = $('[data-cd]', body); if (c) c.textContent = fmtDur((start - Date.now()) / 1000); }, 1000);
  }
  function nextEventStart() { var anchor = Date.UTC(2026, 0, 2, 18, 0, 0), per = 9 * 86400000, n = Date.now(); return anchor + Math.ceil((n - anchor) / per) * per; }
  function drawMoonArt(ctx, w, h, t) {
    var gr = ctx.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, '#1A0410'); gr.addColorStop(1, '#3A0A18');
    ctx.fillStyle = gr; ctx.fillRect(0, 0, w, h);
    var mx0 = w * 0.5, my = h * 0.48, r = h * 0.3;
    radial(ctx, mx0, my, r * 3.2, [[0, 'rgba(255,61,79,0.45)'], [0.4, 'rgba(160,20,40,0.18)'], [1, 'rgba(0,0,0,0)']]);
    var mg = ctx.createRadialGradient(mx0 - r * 0.3, my - r * 0.3, 0, mx0, my, r);
    mg.addColorStop(0, '#FFB0A0'); mg.addColorStop(0.6, '#E8394D'); mg.addColorStop(1, '#7A0E1E');
    ctx.fillStyle = mg; ctx.beginPath(); ctx.arc(mx0, my, r, 0, TAU); ctx.fill();
    ctx.fillStyle = 'rgba(60,0,10,0.25)'; ctx.beginPath(); ctx.arc(mx0 + r * 0.3, my + r * 0.1, r * 0.2, 0, TAU); ctx.arc(mx0 - r * 0.25, my - r * 0.35, r * 0.12, 0, TAU); ctx.fill();
    // silhouette ridge + bats
    ctx.fillStyle = '#0A0206'; ctx.beginPath(); ctx.moveTo(0, h);
    for (var i = 0; i <= 12; i++) ctx.lineTo(i / 12 * w, h * (0.78 + 0.12 * hash(i + 3)));
    ctx.lineTo(w, h); ctx.fill();
    for (i = 0; i < 5; i++) {
      var bx = ((t * (18 + i * 6) + i * 80) % (w + 40)) - 20, by = h * (0.2 + 0.12 * i) + sin(t * 3 + i) * 6, fl = sin(t * 14 + i * 2) * 4;
      ctx.beginPath(); ctx.moveTo(bx - 8, by - fl); ctx.lineTo(bx, by + 2); ctx.lineTo(bx + 8, by - fl); ctx.lineTo(bx, by - 1); ctx.fill();
    }
  }
  function shopFreeReady() { var L = ls(); return S() && L.shopFree !== dayKey(); }
  UI.openShop = function (sec) {
    var body = mk('div', 'ui-shop');
    function render() {
      var p = P() || { gems: 0 }, e = energyInfo(), free = shopFreeReady();
      body.innerHTML =
        '<div class="ui-shop-row' + (sec === 'energy' ? ' hl' : '') + '"><span class="ui-shop-ic en">' + ic('bolt') + '</span><div class="ui-shop-t"><b>Enerji Kristali</b><small>+15 enerji · şu an ' + fmt(e.cur) + '/' + fmt(e.max) + (e.full ? '' : ' · +1 ' + fmtTime(e.nextInSec)) + '</small></div>' +
          '<button class="btn btn-sm btn-violet ui-shop-b" data-buy="energy" type="button">' + ic('gem') + '<span class="num">50</span></button></div>' +
        '<div class="ui-shop-row' + (sec === 'gold' ? ' hl' : '') + '"><span class="ui-shop-ic">' + ic('gold') + '</span><div class="ui-shop-t"><b>Altın Kesesi</b><small>+2.000 altın</small></div>' +
          '<button class="btn btn-sm btn-violet ui-shop-b" data-buy="gold" type="button">' + ic('gem') + '<span class="num">100</span></button></div>' +
        '<div class="ui-shop-row free' + (free ? ' ready' : '') + '"><span class="ui-shop-ic">' + ic('chest') + '</span><div class="ui-shop-t"><b>Günlük Hediye</b><small>' + (free ? 'Ücretsiz: 250 altın + 10 elmas' : 'Yarın yine gel · ' + fmtDur(secToMidnight())) + '</small></div>' +
          '<button class="btn btn-sm ' + (free ? 'btn-green' : 'btn-dark off') + ' ui-shop-b" data-buy="free" type="button">' + (free ? 'Al' : 'Alındı') + '</button></div>' +
        '<div class="ui-shop-row soon' + (sec === 'gems' ? ' hl' : '') + '"><span class="ui-shop-ic">' + ic('gem') + '</span><div class="ui-shop-t"><b>Elmas Paketleri</b><small>Yakında · gerçek para yok, bu bir prototip</small></div>' +
          '<span class="ui-soon-pill">YAKINDA</span></div>' +
        '<p class="dim ui-shop-note">Elmasın: <b class="c-gold num">' + fmt(p.gems) + '</b> · Elmas kazanmak için bölümleri ilk kez temizle ve günlük görevleri tamamla.</p>';
      $$('.ui-shop-b', body).forEach(function (b) {
        b.addEventListener('click', function () {
          var k = b.getAttribute('data-buy'), s = S();
          if (!s) return;
          if (k === 'free') {
            if (!shopFreeReady()) { snd('error'); UI.toast('Bugünün hediyesini zaten aldın', 'info'); return; }
            var L = ls(); L.shopFree = dayKey(); lsSave();
            grant({ gold: 250, gems: 10 }, b); render(); return;
          }
          var cost = k === 'energy' ? 50 : 100;
          if (!call('spendGems', cost)) { UI.toast('Yeterli elmas yok', 'warn'); return; }
          snd('buy');
          grant(k === 'energy' ? { energy: 15 } : { gold: 2000 }, b);
          render();
        });
      });
    }
    render();
    return UI.modal(body, { title: 'Mağaza', cls: 'ui-shop-m' });
  };
  function openProfile() {
    var p = P() || {}, a = accInfo(), Tt = totals();
    var body = mk('div', 'ui-prof',
      '<div class="ui-prof-top"><div class="ui-prof-pic"></div><div class="ui-prof-id"><b class="ttl">' + esc(p.name || 'Muhafız') + '</b>' +
      '<span>Hesap Seviyesi <b class="num c-gold">' + fmt(a.lvl) + '</b></span><div class="pbar violet"><i style="width:' + round(a.pct * 100) + '%"></i></div>' +
      '<small class="num dim">' + fmt(a.xp) + ' / ' + fmt(a.need) + ' TP</small></div></div>' +
      '<div class="ui-kv">' +
        '<div><span>Savaş Gücü</span><b class="c-gold">' + fmt(curPower()) + '</b></div><div><span>Savaşlar</span><b>' + fmt(Tt.runs || 0) + '</b></div>' +
        '<div><span>Zaferler</span><b>' + fmt(Tt.wins || 0) + '</b></div><div><span>Öldürülen</span><b>' + fmt(Tt.kills || 0) + '</b></div>' +
        '<div><span>Devrilen boss</span><b>' + fmt(Tt.bosses || 0) + '</b></div><div><span>Oyun süresi</span><b>' + fmtTime(Tt.playSec || 0) + '</b></div>' +
      '</div>' +
      '<div class="ui-row2"><button class="btn btn-dark ui-prof-set" type="button">' + ic('gear') + ' Ayarlar</button><button class="btn btn-violet ui-prof-hero" type="button">' + ic('hood') + ' Kahramanlar</button></div>');
    var m = UI.modal(body, { title: 'Profil', cls: 'ui-prof-m' });
    canvasHelper($('.ui-prof-pic', body), function (ctx, w, h, t) { if (GM.Art && GM.Art.drawHeroPortrait) GM.Art.drawHeroPortrait(ctx, 0, 0, w, activeId(), t, call('skinFor', 'hero:' + activeId()) || null); }, { fps: 12 });
    $('.ui-prof-set', body).addEventListener('click', function () { m.close(); UI.go('ayarlar'); });
    $('.ui-prof-hero', body).addEventListener('click', function () { m.close(); UI.go('kahraman'); });
  }
  function claimableCount() { try { return questClaimable() + mailUnclaimed() + (shopFreeReady() ? 1 : 0); } catch (e) { return 0; } }

  /* ============================================================================================
   * ARENA (multiplayer hub, mock)
   * ========================================================================================== */
  var MODES = [
    { id: 'pvp', n: 'Arena', sub: 'Gerçek zamanlı 1v1 düello', req: 'Hesap Sv. 10', col: '#E8394D',
      desc: 'Diğer muhafızlarla birebir düelloya gir. Kahramanın, ekipmanın ve yetenek ağacın sınanır; her galibiyet sezon puanı ve lig yükselişi getirir.' },
    { id: 'lonca', n: 'Lonca Savaşları', sub: 'Kale kuşatması · 20v20', req: 'Hesap Sv. 15', col: '#FFB020',
      desc: 'Loncanla birlikte rakip kaleleri kuşat, Metin kulelerini kır, sancağını en yükseğe dik. Haftalık kuşatmalar lonca hazinesini doldurur.' },
    { id: 'zindan', n: 'Ortak Zindan', sub: '3 kişilik eşli macera', req: 'Bölüm 3', col: '#3EDBC8',
      desc: 'İki arkadaşınla aynı zindana in. Farklı sınıflar birbirini tamamlar: biri ön safta, biri uzaktan, biri şifacı. Ortak boss’lar mitik ganimet düşürür.' },
    { id: 'dunya', n: 'Dünya Boss', sub: 'Bütün sunucu tek düşmana', req: 'Hafta sonu', col: '#9D6BFF',
      desc: 'Kıyamet Ejderi uyanınca bütün muhafızlar aynı canavara saldırır. Verdiğin hasara göre sıralama ödülü kazanırsın.' }];
  var LB = [
    { n: 'KaraKurt', g: 'KZL', h: 'alaz', p: 48920 }, { n: 'AyşeOku', g: 'AY', h: 'ela', p: 45110 }, { n: 'GeceBekçisi', g: 'GLG', h: 'yaman', p: 43870 },
    { n: 'Fırtınaİz', g: 'KZL', h: 'ayaz', p: 41200 }, { n: 'MetinKıran', g: 'DMR', h: 'bora', p: 39650 }, { n: 'Yıldırım44', g: 'GLG', h: 'ayaz', p: 37480 },
    { n: 'KorŞövalye', g: 'KOR', h: 'alaz', p: 35925 }, { n: 'SessizOk', g: 'AY', h: 'ela', p: 34010 }, { n: 'ÇelikYürek', g: 'DMR', h: 'bora', p: 32775 },
    { n: 'GölgeAvcı', g: 'KOR', h: 'yaman', p: 31260 }];
  var SEASONS = ['Kızıl Ay', 'Kemik Fırtınası', 'Kor Yağmuru', 'Gölge Tahtı'];
  function seasonInfo() {
    var anchor = Date.UTC(2026, 0, 5), len = 28 * 86400000, el = Date.now() - anchor, n = floor(el / len);
    return { no: n + 1, name: SEASONS[((n % 4) + 4) % 4], left: (anchor + (n + 1) * len - Date.now()) / 1000 };
  }
  function leagueOf(pw) {
    var L = [['Bronz', '#C07A44', 0], ['Gümüş', '#C9CED8', 4000], ['Altın', '#FFCB57', 9000], ['Elmas', '#7FD8FF', 16000], ['Efsane', '#FF3D4F', 30000]];
    var i = 0; for (var j = 0; j < L.length; j++) if (pw >= L[j][2]) i = j;
    var lo = L[i][2], hi = L[i + 1] ? L[i + 1][2] : lo * 2, sub = 3 - clamp(floor((pw - lo) / ((hi - lo) / 3)), 0, 2);
    return { n: L[i][0] + ' ' + ['I', 'II', 'III'][sub - 1], col: L[i][1] };
  }
  function arenaMount(root) {
    root.classList.add('ui-page', 'ui-arena');
    var si = seasonInfo(), pw = curPower(), lg2 = leagueOf(pw), p = P() || {};
    var myRank = mx(11, round(5200 - pw * 0.42));
    root.innerHTML = '<div class="ui-page-in scroll">' +
      '<header class="ui-ar-head panel">' +
        '<div class="ui-ar-hl"><span class="ui-kick">Sezon ' + si.no + ' · ' + esc(si.name) + '</span><h2 class="ttl ui-ar-t">Arena</h2>' +
        '<span class="ui-ar-cd">' + ic('clock') + '<span>Sezon sonu</span> <b class="num" data-cd>' + fmtDur(si.left) + '</b></span></div>' +
        '<div class="ui-ar-lg" style="--lc:' + lg2.col + '">' + ic('shield') + '<b>' + esc(lg2.n) + '</b><small>Ligin</small></div>' +
      '</header>' +
      '<div class="ui-ar-grid">' + MODES.map(function (md) {
        return '<button class="ui-mode" type="button" data-mode="' + md.id + '" style="--mc:' + md.col + '"><span class="ui-mode-art"></span>' +
          '<span class="ui-mode-tx"><b>' + esc(md.n) + '</b><small>' + esc(md.sub) + '</small></span>' +
          '<span class="ui-mode-req">' + ic('lock') + esc(md.req) + '</span><span class="ui-ribbon sm">YAKINDA</span></button>';
      }).join('') + '</div>' +
      '<section class="panel ui-lb"><div class="ui-lb-h"><b class="ui">Sezon Sıralaması</b><span class="dim">İlk 10 · Savaş Gücü</span></div>' +
        '<ol class="ui-lb-list">' + LB.map(function (r, i) {
          var hd = heroDef(r.h);
          return '<li class="ui-lb-r' + (i < 3 ? ' top' + (i + 1) : '') + '"><span class="ui-lb-no num">' + (i + 1) + '</span><span class="ui-lb-pic" data-h="' + r.h + '"></span>' +
            '<span class="ui-lb-n"><b>' + esc(r.n) + '</b><small>[' + esc(r.g) + '] ' + esc(hd.n) + ' · ' + esc(hd.cls) + '</small></span><span class="ui-lb-p num">' + ic('swords') + fmt(r.p) + '</span></li>';
        }).join('') + '</ol>' +
        '<div class="ui-lb-r me"><span class="ui-lb-no num">' + fmt(myRank) + '</span><span class="ui-lb-pic" data-h="' + activeId() + '"></span>' +
          '<span class="ui-lb-n"><b>' + esc(p.name || 'Muhafız') + ' <em>(Sen)</em></b><small>' + esc(heroDef(activeId()).n) + ' · ' + esc(lg2.n) + '</small></span><span class="ui-lb-p num">' + ic('swords') + fmt(pw) + '</span></div>' +
      '</section>' +
      '<p class="dim ui-ar-note">Çok oyunculu modlar yakında açılacak. Şimdilik bölümleri temizle, gücünü artır ve sezon sıralamasında yerini hazırla.</p>' +
      '</div>';
    $$('.ui-mode', root).forEach(function (b) {
      var md = MODES.filter(function (x) { return x.id === b.getAttribute('data-mode'); })[0];
      canvasHelper($('.ui-mode-art', b), function (ctx, w, h, t, r) { drawModeArt(ctx, w, h, t, r, md); }, { fps: 30 });
      b.addEventListener('click', function () { snd('click'); openMode(md); });
    });
    $$('.ui-lb-pic', root).forEach(function (el) {
      var hid = el.getAttribute('data-h');
      canvasHelper(el, function (ctx, w, h, t) { if (GM.Art && GM.Art.drawHeroPortrait) GM.Art.drawHeroPortrait(ctx, 0, 0, w, hid, t, null); }, { fps: 8 });
    });
    ARENA.cd = $('[data-cd]', root);
  }
  var ARENA = { cd: null, acc: 0 };
  function arenaFrame(dt) {
    ARENA.acc += dt;
    if (ARENA.acc > 0.5 && ARENA.cd && ARENA.cd.isConnected) { ARENA.acc = 0; ARENA.cd.textContent = fmtDur(seasonInfo().left); }
  }
  function openMode(md) {
    var L = ls(); L.notify = L.notify || {};
    var on = !!L.notify[md.id];
    var body = mk('div', 'ui-modeinfo',
      '<div class="ui-modeinfo-art" style="--mc:' + md.col + '"></div>' +
      '<p class="muted">' + esc(md.desc) + '</p>' +
      '<div class="ui-kv"><div><span>Durum</span><b class="c-violet">Yakında</b></div><div><span>Açılış şartı</span><b>' + esc(md.req) + '</b></div></div>' +
      '<button class="btn ' + (on ? 'btn-dark' : 'btn-violet') + ' ui-mode-b" type="button">' + ic('bell') + (on ? ' Hatırlatma açık' : ' Açılınca haber ver') + '</button>');
    var m = UI.modal(body, { title: md.n, cls: 'ui-mode-m' });
    canvasHelper($('.ui-modeinfo-art', body), function (ctx, w, h, t, r) { drawModeArt(ctx, w, h, t, r, md); }, { fps: 30 });
    $('.ui-mode-b', body).addEventListener('click', function () {
      L.notify[md.id] = !on; lsSave(); snd('click');
      UI.toast(!on ? md.n + ' açıldığında haber vereceğiz!' : 'Hatırlatma kapatıldı', !on ? 'ok' : 'info');
      m.close();
    });
  }
  var MODEART = {};
  function drawModeArt(ctx, w, h, t, r, md) {
    var key = md.id + w + 'x' + h + '@' + r.dpr, A = MODEART[md.id];
    if (!A || A.key !== key) {
      A = { key: key, cv: offCv(w * r.dpr, h * r.dpr) };
      var g = A.cv.getContext('2d'); g.scale(r.dpr, r.dpr);
      safe(function () { paintModeArt(g, w, h, md); }, 'mode art');
      MODEART[md.id] = A;
    }
    ctx.drawImage(A.cv, 0, 0, w, h);
    // live sparks / embers
    ctx.globalCompositeOperation = 'lighter';
    var sp = glowSprite(md.col);
    for (var i = 0; i < 9; i++) {
      var s1 = hash(i * 3.7 + md.id.length), s2 = hash(i * 9.1 + 1);
      var y = h - ((t * (10 + s2 * 18) + s1 * h) % h), x = s2 * w + sin(t + i) * 6;
      ctx.globalAlpha = clamp(y / h, 0, 1) * 0.8; var s = 3 + s1 * 4; ctx.drawImage(sp, x - s, y - s, s * 2, s * 2);
    }
    if (md.id === 'pvp') { ctx.globalAlpha = 0.5 + 0.5 * sin(t * 6); var cs = h * 0.42; ctx.drawImage(glowSprite('#FFE9A3'), w / 2 - cs / 2, h * 0.42 - cs / 2, cs, cs); }
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
  }
  function paintModeArt(g, w, h, md) {
    var r = rng(md.id.length * 131 + md.col.length), i, gr = g.createLinearGradient(0, 0, 0, h);
    gr.addColorStop(0, mixHex(md.col, '#05030A', 0.82)); gr.addColorStop(1, mixHex(md.col, '#05030A', 0.55));
    g.fillStyle = gr; g.fillRect(0, 0, w, h);
    radial(g, w / 2, h * 0.4, w * 0.7, [[0, rgba(md.col, 0.35)], [1, rgba(md.col, 0)]]);
    var Art = GM.Art || {};
    if (md.id === 'pvp') {
      // colosseum arches
      g.fillStyle = 'rgba(10,4,8,0.75)';
      for (i = 0; i < 7; i++) { archPath(g, i * w / 6 - w * 0.05, i * w / 6 + w * 0.07, h * 0.62, h * 0.2); g.fill(); }
      g.fillStyle = 'rgba(0,0,0,0.6)'; g.fillRect(0, h * 0.62, w, h);
      var s = h / 175;
      radial(g, w / 2, h * 0.5, h * 0.45, [[0, 'rgba(255,233,163,0.35)'], [1, 'rgba(255,233,163,0)']]);
      if (Art.drawHero) {
        Art.drawHero(g, w * 0.24, h * 0.8, s, { look: bareLook('bora', 4), t: 0.2, anim: 'attack', atkP: 0.4, dir: 1, glow: true, shadow: true });
        Art.drawHero(g, w * 0.76, h * 0.8, s, { look: bareLook('yaman', 5), t: 0.6, anim: 'attack', atkP: 0.55, dir: -1, glow: true, shadow: true });
      }
    } else if (md.id === 'lonca') {
      g.fillStyle = 'rgba(10,6,4,0.9)';
      g.fillRect(w * 0.45, h * 0.35, w * 0.5, h * 0.45);
      [[0.5, 0.2], [0.7, 0.1], [0.9, 0.22]].forEach(function (tw) { g.fillRect(w * tw[0] - 8, h * tw[1], 16, h); g.beginPath(); g.moveTo(w * tw[0] - 12, h * tw[1]); g.lineTo(w * tw[0], h * tw[1] - 14); g.lineTo(w * tw[0] + 12, h * tw[1]); g.fill(); });
      // banners
      [['#E8394D', 0.3], ['#4BA3FF', 0.75]].forEach(function (b) { g.fillStyle = '#120C18'; g.fillRect(w * b[1], h * 0.12, 2, h * 0.3); g.fillStyle = b[0]; g.beginPath(); g.moveTo(w * b[1] + 2, h * 0.13); g.lineTo(w * b[1] + 22, h * 0.17); g.lineTo(w * b[1] + 2, h * 0.24); g.fill(); });
      // fire arcs (catapults)
      g.strokeStyle = 'rgba(255,170,60,0.7)'; g.lineWidth = 2; g.setLineDash([3, 4]);
      for (i = 0; i < 3; i++) { g.beginPath(); g.moveTo(w * 0.05, h * (0.8 - i * 0.05)); g.quadraticCurveTo(w * 0.35, -h * 0.1 + i * 10, w * (0.55 + i * 0.12), h * (0.4 + i * 0.05)); g.stroke(); }
      g.setLineDash([]);
      // army silhouettes
      g.fillStyle = '#0A0604';
      for (i = 0; i < 26; i++) { var ax = r() * w * 0.5, ay = h * (0.82 + r() * 0.12); g.beginPath(); g.arc(ax, ay - 7, 3, 0, TAU); g.fill(); g.fillRect(ax - 3, ay - 5, 6, 8); g.fillRect(ax + 2, ay - 14, 1.2, 12); }
      g.fillStyle = 'rgba(0,0,0,0.5)'; g.fillRect(0, h * 0.92, w, h);
    } else if (md.id === 'zindan') {
      // dungeon gate
      var gx = w / 2, gw = w * 0.42;
      g.fillStyle = '#1A1A22'; archPath(g, gx - gw / 2 - 12, gx + gw / 2 + 12, h, h * 0.08); g.fill();
      g.fillStyle = '#04120F'; archPath(g, gx - gw / 2, gx + gw / 2, h, h * 0.16); g.fill();
      g.save(); archPath(g, gx - gw / 2, gx + gw / 2, h, h * 0.16); g.clip();
      radial(g, gx, h * 0.55, gw, [[0, 'rgba(62,219,200,0.55)'], [1, 'rgba(62,219,200,0)']]);
      g.strokeStyle = 'rgba(8,10,14,0.85)'; g.lineWidth = 3;
      for (i = 1; i < 6; i++) { g.beginPath(); g.moveTo(gx - gw / 2 + i * gw / 6, 0); g.lineTo(gx - gw / 2 + i * gw / 6, h * 0.5); g.stroke(); }
      g.beginPath(); g.moveTo(gx - gw / 2, h * 0.3); g.lineTo(gx + gw / 2, h * 0.3); g.stroke();
      g.restore();
      // stone blocks
      g.strokeStyle = 'rgba(255,255,255,0.06)'; g.lineWidth = 1;
      for (i = 0; i < 8; i++) { g.strokeRect(r() * w, r() * h, 18, 10); }
      // three heroes from behind (silhouettes)
      g.fillStyle = '#020605';
      [-1, 0, 1].forEach(function (k2) { var hx = gx + k2 * gw * 0.32, hy = h * 0.98, s2 = k2 ? 0.85 : 1; g.beginPath(); g.arc(hx, hy - 30 * s2, 9 * s2, 0, TAU); g.fill(); g.beginPath(); g.moveTo(hx - 11 * s2, hy); g.lineTo(hx - 8 * s2, hy - 24 * s2); g.lineTo(hx + 8 * s2, hy - 24 * s2); g.lineTo(hx + 11 * s2, hy); g.fill(); });
    } else {
      // world boss: huge demon over a city
      g.fillStyle = 'rgba(0,0,0,0.6)';
      for (i = 0; i < 14; i++) { var bx = i * w / 13, bh = h * (0.12 + r() * 0.16); g.fillRect(bx, h - bh, w / 14, bh); g.beginPath(); g.moveTo(bx - 2, h - bh); g.lineTo(bx + w / 28, h - bh - 8); g.lineTo(bx + w / 14 + 2, h - bh); g.fill(); }
      if (Art.drawBoss) {
        var tmpR = h * 0.42;
        Art.drawBoss(g, { type: 'korIblisi', x: w * 0.5, y: h * 0.62 - 40 * tmpR / 48 + h * 0.1, r: tmpR, dir: -1, phase: 'enrage', hpPct: 0.4 }, 0.5);
        g.fillStyle = 'rgba(40,10,60,0.45)'; g.fillRect(0, 0, w, h);
      }
      g.fillStyle = '#05030A';
      for (i = 0; i < 9; i++) { var ux = w * (0.12 + i * 0.09), uy = h * 0.97; g.beginPath(); g.arc(ux, uy - 9, 3, 0, TAU); g.fill(); g.fillRect(ux - 3, uy - 7, 6, 7); }
    }
    var vg = g.createLinearGradient(0, h * 0.5, 0, h); vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,0.65)');
    g.fillStyle = vg; g.fillRect(0, 0, w, h);
  }
  function lookFor(id) {
    var l = lookOf(id);
    if (l && l.heroId !== id) l = (GM.Art && GM.Art.heroLook) ? GM.Art.heroLook(id) : l;
    return l;
  }
  /* a hero in their own outfit holding their signature weapon (teasers, other players) */
  function bareLook(id, rar) {
    var d = heroDef(id), l = (GM.Art && GM.Art.heroLook) ? GM.Art.heroLook(id) : { heroId: id, heroSkin: null, gear: {} };
    l = { heroId: l.heroId || id, heroSkin: l.heroSkin || null, weapon: { wt: d.weapon || 'kilic', rar: rar == null ? 3 : rar, skin: null }, gear: l.gear || {} };
    return l;
  }

  /* ============================================================================================
   * AYARLAR (settings)
   * ========================================================================================== */
  function pageHeader(title, sub) {
    return '<header class="ui-ph"><button class="ui-back" type="button" aria-label="Geri">' + ic('back') + '</button><div class="ui-ph-t"><h2 class="ttl">' + esc(title) + '</h2>' +
      (sub ? '<small>' + esc(sub) + '</small>' : '') + '</div></header>';
  }
  function toggleRow(id, icn, n, sub, on) {
    return '<label class="ui-tg-row"><span class="ui-tg-ic">' + ic(icn) + '</span><span class="ui-tg-t"><b>' + esc(n) + '</b><small>' + esc(sub) + '</small></span>' +
      '<input type="checkbox" class="ui-tg-in" data-set="' + id + '"' + (on ? ' checked' : '') + '><span class="ui-tg" aria-hidden="true"><i></i></span></label>';
  }
  function settingsMount(root) {
    root.classList.add('ui-page', 'ui-set');
    var p = P() || { settings: {} }, st = p.settings || {}, Tt = totals(), a = accInfo();
    root.innerHTML = pageHeader('Ayarlar', 'Ses · Profil · Veri') + '<div class="ui-page-in scroll">' +
      '<section class="panel ui-sec"><h3 class="ui-sec-h">Ses</h3>' +
        toggleRow('sound', 'sound', 'Ses Efektleri', 'Vuruşlar, ganimet, arayüz', st.sound !== false) +
        toggleRow('music', 'music', 'Müzik', 'Karanlık koro ve davullar', st.music !== false) +
      '</section>' +
      '<section class="panel ui-sec"><h3 class="ui-sec-h">Profil</h3>' +
        '<div class="ui-name-row"><span class="ui-tg-ic">' + ic('user') + '</span><input class="ui-name-in" type="text" maxlength="24" autocomplete="off" spellcheck="false" aria-label="Muhafız adı" value="' + esc(p.name || 'Muhafız') + '">' +
        '<button class="btn btn-sm btn-gold ui-name-b" type="button">Kaydet</button></div>' +
        '<div class="ui-kv">' +
          '<div><span>Hesap seviyesi</span><b class="c-gold">' + fmt(a.lvl) + '</b></div><div><span>Savaşlar</span><b>' + fmt(Tt.runs || 0) + '</b></div>' +
          '<div><span>Zaferler</span><b>' + fmt(Tt.wins || 0) + '</b></div><div><span>Öldürülen</span><b>' + fmt(Tt.kills || 0) + '</b></div>' +
          '<div><span>Koşulan mesafe</span><b>' + fmt((Tt.distance || 0) / 50) + ' m</b></div><div><span>Bulunan eşya</span><b>' + fmt(Tt.itemsFound || 0) + '</b></div>' +
        '</div>' +
      '</section>' +
      '<section class="panel ui-sec"><h3 class="ui-sec-h">Veri</h3>' +
        '<p class="muted ui-sec-p">İlerleme bu cihazda otomatik kaydedilir. Sıfırlarsan bütün eşyalar, kahramanlar ve nitelikler başlangıca döner.</p>' +
        '<button class="btn btn-red ui-reset" type="button">' + ic('trash') + ' Profili Sıfırla</button>' +
      '</section>' +
      '<section class="ui-credits"><div class="ttl ui-cr-t">Gölge Muhafızları</div><p>Oynanabilir prototip · sürüm ' + esc(String((GM.D && GM.D.VERSION) || 1)) + '</p>' +
        '<p>Bütün kahramanlar, canavarlar, eşyalar, sesler ve müzik kodla, gerçek zamanlı üretildi. Hiçbir resim ya da ses dosyası yok.</p>' +
        '<p class="dim">Tasarım · Kod · Ses: Gölge Muhafızları ekibi</p></section>' +
      '</div>';
    $('.ui-back', root).addEventListener('click', function () { snd('click'); UI.back(); });
    $$('.ui-tg-in', root).forEach(function (inp) {
      inp.addEventListener('change', function () {
        var k = inp.getAttribute('data-set'), v = !!inp.checked;
        if (S()) { if (S().setSetting) call('setSetting', k, v); else { P().settings[k] = v; call('save'); } }
        try {
          if (GM.A) {
            if (k === 'sound' && GM.A.setSfx) GM.A.setSfx(v);
            if (k === 'music' && GM.A.setMusic) { GM.A.setMusic(v); if (v && GM.A.music && !(GM.B && GM.B.active)) GM.A.music('lobby'); }
          }
        } catch (e) { report(e, 'audio toggle'); }
        snd('click');
        UI.toast((k === 'sound' ? 'Ses efektleri ' : 'Müzik ') + (v ? 'açık' : 'kapalı'), 'info');
      });
    });
    var nameIn = $('.ui-name-in', root);
    function saveName() {
      var v = String(nameIn.value || '').trim();
      if (!v) { UI.toast('Ad boş olamaz', 'warn'); return; }
      var ok = S() && S().setName ? call('setName', v) : (P() ? (P().name = v.slice(0, 24), true) : false);
      if (ok !== false) { snd('upgrade'); UI.toast('Adın artık “' + v.slice(0, 24) + '”', 'ok'); UI.refreshTop(); nameIn.blur(); }
    }
    $('.ui-name-b', root).addEventListener('click', saveName);
    nameIn.addEventListener('keydown', function (e) { e.stopPropagation(); if (e.key === 'Enter') saveName(); });
    $('.ui-reset', root).addEventListener('click', function () {
      snd('click');
      UI.confirm({ title: 'Profili Sıfırla', text: 'Bütün ilerlemen silinecek: eşyalar, kahramanlar, yetenekler, nitelikler ve altın. Bu geri alınamaz.', ok: 'Sıfırla', cancel: 'Vazgeç', danger: true, icon: 'warn' })
        .then(function (yes) {
          if (!yes) return;
          if (!S() || typeof S().reset !== 'function') { UI.toast('Sıfırlama şu an kullanılamıyor', 'warn'); return; }
          call('reset');
          lsReset();
          HOME.sel = null; HOME.pow = null; TB.shown = {};
          UI.refresh();
          HIST.length = 0;
          UI.go('savas', null, { dir: 'fade' });
          UI.toast('Profil sıfırlandı. Yeni bir yolculuk başlıyor!', 'ok');
        });
    });
  }

  /* ============================================================================================
   * RESULTS overlay (SPEC: showResults(REWARDS, RESULT))
   * ========================================================================================== */
  function attrDef(id) { var A = dat('ATTRS') || []; for (var i = 0; i < A.length; i++) if (A[i].id === id) return A[i]; return null; }
  function itemName(it) {
    var n = call('itemName', it);
    if (n) return n;
    var SL = dat('SLOTS') || FB.SLOTS, s = null; SL.forEach(function (x) { if (x.id === it.slot) s = x; });
    return (s && s.n) || 'Eşya';
  }
  UI.showResults = function (rew, res) {
    if (!LAYER) return;
    rew = rew || {}; res = res || {};
    if (RES) closeResults(true);
    UI.closeModals();
    if (LOBBY) LOBBY.hidden = false;
    var won = !!(res.won != null ? res.won : rew.won);
    var ch = chapterById(res.chapterId || rew.chapterId) || chapters()[0];
    var heroId = res.heroId || rew.heroId || activeId(), hd = heroDef(heroId);
    var items = (rew.items || []).slice();
    var attrs = (rew.attrs || []).slice();
    var scrolls = rew.scrolls || {};
    var shards = rew.shards || {};
    var SG = dat('SCROLL_GROUPS') || FB.SCROLL_GROUPS;
    var el = mk('div', 'ui-res ' + (won ? 'win' : 'lose'));
    var title = won ? 'ZAFER' : 'YENİLDİN';
    var tags = '';
    if (rew.firstClear) tags += '<span class="ui-tag gold">İlk Zafer!</span>';
    if (rew.newBest) tags += '<span class="ui-tag">Yeni Rekor!</span>';
    if (rew.unlockedChapter) { var nc = chapterById(rew.unlockedChapter); tags += '<span class="ui-tag green">Yeni bölüm: ' + esc(nc ? nc.n : rew.unlockedChapter) + '</span>'; }
    var tips = dat('TIPS') || FB.TIPS, tip = tips[floor(Math.random() * tips.length)] || '';
    var acc = accInfo();
    el.innerHTML =
      '<div class="ui-res-bg"></div>' +
      '<div class="ui-res-sc scroll">' +
        '<div class="ui-res-head">' +
          '<div class="ui-res-hero"></div>' +
          '<h1 class="ui-res-title" aria-label="' + title + '">' + title.split('').map(function (c, i) { return '<span style="--i:' + i + '">' + esc(c) + '</span>'; }).join('') + '</h1>' +
          '<div class="ui-res-sub">Bölüm ' + (ch ? ch.id : '') + ' · ' + esc(ch ? ch.n : '') + '</div>' +
          (tags ? '<div class="ui-res-tags">' + tags + '</div>' : '') +
          (hd.lines ? '<div class="ui-res-quote">“' + esc(won ? hd.lines.win : hd.lines.lose) + '” <small>— ' + esc(hd.n) + '</small></div>' : '') +
        '</div>' +
        '<div class="ui-res-stats">' +
          '<div><span>' + ic('clock') + '</span><b class="num">' + fmtTime(res.time || 0) + '</b><small>Süre</small></div>' +
          '<div><span>' + ic('skull') + '</span><b class="num">' + fmt(res.kills || 0) + '</b><small>Öldürme</small></div>' +
          '<div><span>' + ic('star') + '</span><b class="num">' + fmt(res.runLevel || 1) + '</b><small>Seviye</small></div>' +
          '<div><span>' + ic('crown') + '</span><b class="num">' + fmt((res.elites || 0) + (res.bosses || 0)) + '</b><small>Elit · Boss</small></div>' +
        '</div>' +
        '<section class="panel ui-res-cur">' +
          '<div class="ui-res-coin"><span class="ui-res-ic">' + ic('gold') + '</span><span>Altın</span><b class="num" data-n="gold">0</b></div>' +
          (rew.gems ? '<div class="ui-res-coin"><span class="ui-res-ic">' + ic('gem') + '</span><span>Elmas <small>ilk zafer</small></span><b class="num" data-n="gems">0</b></div>' : '') +
          '<div class="ui-res-acc"><span class="ui-res-lv"><small>Hesap</small><b class="num">' + fmt(rew.accLevelUp ? mx(1, acc.lvl - (rew.levelGift && rew.levelGift.levels || 1)) : acc.lvl) + '</b></span>' +
          '<div class="ui-res-accm"><div class="pbar violet"><i></i></div><small class="num">+' + fmt(rew.accXp || 0) + ' TP</small></div></div>' +
        '</section>' +
        '<section class="panel ui-res-loot"><div class="ui-res-h"><b class="ui">Ganimet</b><span class="dim">' + (items.length ? fmt(items.length) + ' eşya' : 'Sandık bulunamadı') + '</span></div>' +
          '<div class="ui-loot-grid">' + items.map(function (it, i) {
            var R = rarOf(it.rar);
            return '<div class="ui-loot r' + it.rar + '" data-i="' + i + '" style="--rc:' + R.col + '"><div class="ui-loot-beam"></div><div class="ui-loot-card">' +
              '<div class="ui-loot-back">' + ic('chest') + '</div><div class="ui-loot-front rf rf' + clamp(it.rar | 0, 0, 5) + '"><span class="ui-loot-ic"></span></div></div>' +
              '<div class="ui-loot-n rc' + clamp(it.rar | 0, 0, 5) + '">' + esc(itemName(it)) + '</div><div class="ui-loot-r">' + esc(R.n) + '</div></div>';
          }).join('') + '</div>' +
          '<div class="ui-res-extra">' +
            Object.keys(shards).filter(function (k) { return shards[k] > 0; }).map(function (k) {
              return '<span class="ui-xchip" data-pop><span class="ui-xchip-pic" data-h="' + k + '"></span><b class="num">+' + fmt(shards[k]) + '</b><small>' + esc(heroDef(k).n) + ' parçası</small></span>';
            }).join('') +
            ['silah', 'zirh', 'taki'].filter(function (k) { return scrolls[k] > 0; }).map(function (k) {
              return '<span class="ui-xchip" data-pop style="color:' + ((SG[k] && SG[k].col) || '#FFCB57') + '">' + ic('scroll') + '<b class="num">+' + fmt(scrolls[k]) + '</b><small>' + esc((SG[k] && SG[k].n) || k) + '</small></span>';
            }).join('') +
          '</div>' +
        '</section>' +
        (attrs.length ? '<section class="panel ui-res-attrs"><div class="ui-res-h"><b class="ui">Nitelikler</b><span class="dim">yalnızca savaşarak gelişir</span></div>' +
          attrs.map(function (a, i) {
            var ad = attrDef(a.id) || {};
            return '<div class="ui-attr" data-a="' + i + '" style="--ac:' + (ad.col || '#9D6BFF') + '"><span class="ui-attr-ic" data-icon="' + esc(ad.icon || 'star') + '"></span>' +
              '<div class="ui-attr-m"><div class="ui-attr-t"><b>' + esc(a.n || ad.n || a.id) + '</b><span class="num ui-attr-lv">Sv. ' + fmt(a.from || 0) + '</span><em class="ui-attr-up" hidden>Seviye atladı!</em><small class="num">+' + fmt(a.xp || 0) + ' TP</small></div>' +
              '<div class="ui-attr-bar"><i></i><span class="ui-attr-seg"></span></div></div></div>';
          }).join('') + '</section>' : '') +
        (!won && tip ? '<div class="ui-res-tip">' + ic('info') + '<span><b>İpucu:</b> ' + esc(tip) + '</span></div>' : '') +
        '<div class="ui-res-pad"></div>' +
      '</div>' +
      '<div class="ui-res-foot">' +
        '<button class="btn btn-dark ui-res-again" type="button">Tekrar <span class="cost">' + ic('bolt') + fmt(runCost(ch)) + '</span></button>' +
        '<button class="btn btn-gold ui-res-ok" type="button">Tamam</button>' +
      '</div>' +
      '<div class="ui-res-skip">Hızlandırmak için dokun</div>';
    LAYER.appendChild(el);
    RES = { el: el, t: 0, q: [], speed: 1, fast: false, anims: [], won: won, rew: rew, res: res, ch: ch, sc: $('.ui-res-sc', el), done: false };
    // background + hero canvases
    canvasHelper($('.ui-res-bg', el), function (ctx, w, h, t) { drawResBg(ctx, w, h, t, won); });
    canvasHelper($('.ui-res-hero', el), function (ctx, w, h, t) {
      if (!(GM.Art && GM.Art.drawHero)) return;
      var k = h / 125;
      GM.Art.drawHero(ctx, w / 2, h - 8, k, { look: lookFor(heroId), t: t, anim: won ? 'victory' : 'hurt', dir: 1, glow: true, shadow: true });
    });
    $$('.ui-xchip-pic', el).forEach(function (pe) { var hid = pe.getAttribute('data-h'); canvasHelper(pe, function (ctx, w, h, t) { if (GM.Art && GM.Art.drawHeroPortrait) GM.Art.drawHeroPortrait(ctx, 0, 0, w, hid, t, null); }, { fps: 10 }); });
    $$('.ui-attr-ic', el).forEach(function (ae) { var icn = ae.getAttribute('data-icon'); canvasHelper(ae, function (ctx, w, h, t) { if (GM.Art && GM.Art.drawAttrIcon) GM.Art.drawAttrIcon(ctx, 0, 0, w, icn, t); }, { once: true }); });
    // buttons
    $('.ui-res-ok', el).addEventListener('click', function (e) { e.stopPropagation(); snd('click'); closeResults(); UI.go('savas', null, { dir: 'fade' }); });
    $('.ui-res-again', el).addEventListener('click', function (e) {
      e.stopPropagation();
      var chk = call('canStart', ch.id) || { ok: false, reason: 'Başlatılamadı' };
      if (!chk.ok) { UI.toast(chk.code === 'energy' ? 'Yetersiz enerji' : chk.reason, 'warn'); return; }
      closeResults(); HOME.sel = ch.id; UI.go('savas', null, { dir: 'none' }); UI.startChapter(ch.id);
    });
    el.addEventListener('click', function (e) { if (e.target.closest('button')) return; if (!RES || RES.done) return; RES.fast = true; RES.speed = 14; });
    updateAgain();
    // ---- timeline
    var at = 0.15;
    function q(dt, fn) { at += dt; RES.q.push({ at: at, fn: fn }); }
    q(0, function () { snd(won ? 'victory' : 'defeat'); });
    q(0.75, function () { el.classList.add('s-stats'); });
    q(0.35, function () {
      el.classList.add('s-cur');
      countUp($('[data-n="gold"]', el), rew.gold || 0, 1.1, 'gold');
      var ge = $('[data-n="gems"]', el); if (ge) countUp(ge, rew.gems || 0, 1.1, null);
      accBar();
    });
    at += 0.6;
    items.forEach(function (it, i) {
      var big = it.rar >= 3;
      q(i === 0 ? 0.4 : (big ? 0.55 : 0.32), function () { revealItem(i, it); });
      if (big) at += 0.35;
    });
    q(0.4, function () { $$('[data-pop]', el).forEach(function (x, j) { setTimeout(function () { x.classList.add('on'); }, RES && RES.fast ? 0 : j * 120); }); if (Object.keys(shards).length) snd('pickup'); });
    attrs.forEach(function (a, i) { q(i === 0 ? 0.45 : 0.28, function () { attrAnim(i, a); }); });
    q(0.6, function () {
      if (rew.accLevelUp) levelBurst(rew);
    });
    q(0.4, function () { RES.done = true; el.classList.add('s-done'); });
    function accBar() {
      var bar = $('.ui-res-acc .pbar i', el), lvEl = $('.ui-res-lv b', el);
      var a = accInfo(), gained = rew.accXp || 0;
      var fromPct = rew.accLevelUp ? clamp(1 - gained / mx(1, a.need), 0.05, 0.9) : clamp((a.xp - gained) / mx(1, a.need), 0, 1);
      var toPct = clamp(a.pct, 0, 1);
      bar.style.transition = 'none'; bar.style.width = round(fromPct * 100) + '%'; void bar.offsetWidth;
      bar.style.transition = '';
      if (rew.accLevelUp) {
        bar.style.width = '100%';
        setTimeout(function () { if (!bar.isConnected) return; lvEl.textContent = fmt(a.lvl); bar.style.transition = 'none'; bar.style.width = '0%'; void bar.offsetWidth; bar.style.transition = ''; bar.style.width = round(toPct * 100) + '%'; }, RES.fast ? 50 : 700);
      } else bar.style.width = round(toPct * 100) + '%';
    }
  };
  function updateAgain() {
    if (!RES) return;
    var b = $('.ui-res-again', RES.el); if (!b) return;
    var chk = call('canStart', RES.ch && RES.ch.id) || { ok: false };
    b.classList.toggle('off', !chk.ok);
    b.hidden = !!(RES.ch && RES.ch.locked);
  }
  function countUp(elm, to, dur, sndName) {
    if (!elm) return;
    var a = { t: 0, d: RES.fast ? 0.05 : dur, to: to, tick: 0 };
    RES.anims.push(function (dt) {
      a.t += dt;
      var k = eOut(a.t / a.d);
      elm.textContent = fmt(to * k);
      if (sndName && !RES.fast) { a.tick += dt; if (a.tick > 0.11 && k < 1) { a.tick = 0; snd(sndName, { vol: 0.35 }); } }
      if (k >= 1) { elm.classList.add('ui-pop'); return false; }
      return true;
    });
  }
  function revealItem(i, it) {
    if (!RES) return;
    var card = $('.ui-loot[data-i="' + i + '"]', RES.el); if (!card) return;
    card.classList.add('on');
    if (it.rar >= 3) card.classList.add('big');
    var icHost = $('.ui-loot-ic', card);
    canvasHelper(icHost, function (ctx, w, h, t) { if (GM.Art && GM.Art.drawItemIcon) GM.Art.drawItemIcon(ctx, 0, 0, w, it, t); }, it.rar >= 3 ? { fps: 30 } : { once: true });
    if (!RES.fast) {
      if (it.rar >= 4) snd('legendary'); else if (it.rar >= 3) snd('rare'); else snd('reward', { vol: 0.5 });
      // keep the reveal in view
      scrollResTo(card);
      if (it.rar >= 4) UI.toast(rarOf(it.rar).n + '! ' + itemName(it), 'rare');
    }
  }
  function scrollResTo(node) {
    var sc = RES && RES.sc; if (!sc || !node) return;
    var r = node.getBoundingClientRect(), s = sc.getBoundingClientRect();
    var foot = 76;
    if (r.bottom > s.bottom - foot) RES.scrollTo = sc.scrollTop + (r.bottom - (s.bottom - foot)) + 16;
    else if (r.top < s.top) RES.scrollTo = sc.scrollTop - (s.top - r.top) - 16;
  }
  function attrAnim(i, a) {
    if (!RES) return;
    var row = $('.ui-attr[data-a="' + i + '"]', RES.el); if (!row) return;
    row.classList.add('on');
    scrollResTo(row);
    var fill = $('.ui-attr-bar i', row), lvEl = $('.ui-attr-lv', row), up = $('.ui-attr-up', row);
    var cur = { lvl: a.to };
    var fromPct = a.fromPct != null ? a.fromPct : 0;
    var toPct = a.toPct != null ? a.toPct : (function () { var x = call('attr', a.id); return x && x.lvl === a.to ? x.pct : 0.5; })();
    var v0 = (a.from || 0) + fromPct, v1 = (a.to || 0) + toPct;
    var dur = RES.fast ? 0.05 : clamp(0.6 + (v1 - v0) * 0.12, 0.6, 1.8), t = 0, lastL = a.from || 0;
    fill.style.width = round(fromPct * 100) + '%';
    RES.anims.push(function (dt) {
      t += dt;
      var k = eInOut(t / dur), v = lerp(v0, v1, k), L = floor(v + 1e-6), f = v - L;
      if (L >= 100) { L = 100; f = 1; }
      fill.style.width = (f * 100).toFixed(1) + '%';
      if (L !== lastL) {
        lastL = L; lvEl.textContent = 'Sv. ' + fmt(L);
        up.hidden = false; up.classList.remove('ui-pop'); void up.offsetWidth; up.classList.add('ui-pop');
        row.classList.remove('lvup'); void row.offsetWidth; row.classList.add('lvup');
        if (!RES.fast) snd('levelup', { vol: 0.45 });
      }
      if (k >= 1) { lvEl.textContent = 'Sv. ' + fmt(cur.lvl); return false; }
      return true;
    });
  }
  function levelBurst(rew) {
    if (!RES) return;
    var b = mk('div', 'ui-lvup', '<div class="ui-lvup-rays"></div><div class="ui-lvup-in"><small>HESAP SEVİYESİ</small><b class="num">' + fmt(rew.accLvl || accInfo().lvl) + '</b>' +
      (rew.levelGift && rew.levelGift.energy ? '<span>' + ic('bolt') + ' +' + fmt(rew.levelGift.energy) + ' enerji hediye</span>' : '') + '</div>');
    RES.el.appendChild(b);
    snd('levelup');
    setTimeout(function () { b.classList.add('out'); }, RES.fast ? 900 : 2000);
    setTimeout(function () { if (b.parentNode) b.parentNode.removeChild(b); }, RES.fast ? 1300 : 2500);
  }
  function resStep(dt) {
    if (!RES) return;
    var d = dt * RES.speed;
    RES.t += d;
    while (RES.q.length && RES.q[0].at <= RES.t) { var s = RES.q.shift(); safe(s.fn, 'results step'); if (!RES) return; }
    for (var i = RES.anims.length - 1; i >= 0; i--) { var keep = false; try { keep = RES.anims[i](d); } catch (e) { report(e, 'results anim'); } if (!keep) RES.anims.splice(i, 1); }
    if (RES.scrollTo != null && RES.sc) {
      var cur = RES.sc.scrollTop, tgt = RES.scrollTo;
      var nx = abs(tgt - cur) < 1 ? tgt : cur + (tgt - cur) * mn(1, dt * 8);
      RES.sc.scrollTop = nx;
      if (abs(tgt - nx) < 1) RES.scrollTo = null;
    }
    if (RES.done && RES.speed !== 1) RES.speed = 1;
    RES.acc = (RES.acc || 0) + dt;
    if (RES.acc > 1) { RES.acc = 0; updateAgain(); }
  }
  function closeResults(instant) {
    if (!RES) return;
    var el = RES.el;
    RES = null;
    if (instant) { if (el.parentNode) el.parentNode.removeChild(el); return; }
    el.classList.add('ui-closing');
    setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 260);
    needRefresh = true;
  }
  function drawResBg(ctx, w, h, t, won) {
    var gr = ctx.createLinearGradient(0, 0, 0, h);
    if (won) { gr.addColorStop(0, '#1A0F05'); gr.addColorStop(0.4, '#120A1A'); gr.addColorStop(1, '#06040A'); }
    else { gr.addColorStop(0, '#1A0508'); gr.addColorStop(0.5, '#0E0610'); gr.addColorStop(1, '#050306'); }
    ctx.fillStyle = gr; ctx.fillRect(0, 0, w, h);
    var cx = w / 2, cy = h * 0.16, col = won ? '#FFCB57' : '#E8394D';
    ctx.globalCompositeOperation = 'lighter';
    // rotating god rays
    ctx.save(); ctx.translate(cx, cy); ctx.rotate(t * (RM ? 0 : 0.12));
    var n = 14, L = mx(w, h) * 1.1;
    for (var i = 0; i < n; i++) {
      ctx.rotate(TAU / n);
      var g2 = ctx.createLinearGradient(0, 0, L, 0);
      g2.addColorStop(0, rgba(col, won ? 0.16 : 0.08)); g2.addColorStop(1, rgba(col, 0));
      ctx.fillStyle = g2; ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(L, -L * 0.07); ctx.lineTo(L, L * 0.07); ctx.closePath(); ctx.fill();
    }
    ctx.restore();
    radial(ctx, cx, cy, w * 0.6, [[0, rgba(col, won ? 0.35 : 0.22)], [1, rgba(col, 0)]]);
    // particles: gold motes rising (win) / ash falling (lose)
    var sp = glowSprite(won ? '#FFCB57' : '#FF7A5A');
    for (i = 0; i < (RM ? 10 : 34); i++) {
      var s1 = hash(i * 1.37), s2 = hash(i * 7.9 + 3), x, y;
      if (won) { y = h - ((t * (20 + s2 * 40) + s1 * h) % (h + 20)); x = s2 * w + sin(t * 0.8 + i) * 14; }
      else { y = ((t * (12 + s2 * 18) + s1 * h) % (h + 20)) - 10; x = s2 * w + sin(t * 0.6 + i) * 20; }
      ctx.globalAlpha = (0.4 + 0.4 * sin(t * 3 + i)) * (won ? 0.9 : 0.5);
      var s = 3 + s1 * 5; ctx.drawImage(sp, x - s, y - s, s * 2, s * 2);
    }
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
  }

  /* ============================================================================================
   * Screen registrations (ui-core's own)
   * ========================================================================================== */
  function registerOwn() {
    UI.reg('savas', { title: 'Savaş', tab: 'savas', bg: 'home', mount: homeMount, unmount: homeUnmount, frame: homeFrame });
    UI.reg('arena', { title: 'Arena', tab: 'arena', bg: 'dim', mount: arenaMount, frame: arenaFrame });
    UI.reg('ayarlar', { title: 'Ayarlar', tab: null, bg: 'dim', mount: settingsMount });
  }

  /* ============================================================================================
   * init + frame
   * ========================================================================================== */
  UI.init = function () {
    if (inited) return;
    inited = true;
    ROOT = document.getElementById('gm');
    LOBBY = document.getElementById('gm-lobby');
    TOP = document.getElementById('gm-top');
    SCREEN = document.getElementById('gm-screen');
    NAV = document.getElementById('gm-nav');
    LAYER = document.getElementById('gm-layer');
    if (!ROOT || !LOBBY || !TOP || !SCREEN || !NAV || !LAYER) { report(new Error('lobby DOM missing'), 'init'); return; }
    if (!ROOT.getAttribute('lang')) ROOT.setAttribute('lang', 'tr');   // correct Turkish upper-casing (i → İ)
    LOBBY.classList.add('ui-shell');
    if (RM) ROOT.classList.add('ui-rm');
    setupObservers();
    // backdrop layer
    BGHOST = mk('div', 'ui-bg'); BGHOST.id = 'ui-bg';
    LOBBY.insertBefore(BGHOST, LOBBY.firstChild);
    BG.rec = canvasHelper(BGHOST, function (ctx, w, h, t, r) { bgDraw(ctx, w, h, t, r); }, { keep: true });
    buildTop();
    buildNav();
    registerOwn();
    if (RO) { try { RO.observe(ROOT); } catch (e) { /* ignore */ } }
    window.addEventListener('resize', function () { BG.dirty = true; HOME.dirty = true; restackToasts(); });
    // state events
    var s = S() || GM.S;
    if (s && typeof s.on === 'function') { try { s.on('change', function () { needRefresh = true; }); } catch (e) { report(e, 'S.on'); } }
    // keyboard: Esc closes modals / goes back
    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape' || (GM.B && GM.B.active)) return;
      if (RES) { if (RES.done) { closeResults(); UI.go('savas', null, { dir: 'fade' }); } else { RES.fast = true; RES.speed = 14; } return; }
      if (MODALS.length) { MODALS[MODALS.length - 1].close(); return; }
      if (CUR && CUR.id !== 'savas') UI.back();
    });
    safe(UI.refreshTop, 'refreshTop');
    safe(refreshNav, 'refreshNav');
    setTimeout(function () { if (!UI.current) UI.go('savas'); }, 0);
  };

  var navAcc = 0;
  UI.frame = function (dt, t) {
    if (!inited) return;
    dt = +dt || 0; T = +t || 0;
    BG.dt = dt;
    if (needRefresh) safe(UI.refresh, 'refresh');
    stepTweens(dt);
    TB.lastTick += dt;
    if (TB.lastTick > 0.5 || TB.lastTick < 0) { TB.lastTick = 0; safe(function () { tickEnergy(false); }, 'energy tick'); }
    navAcc += dt;
    if (navAcc > 2) { navAcc = 0; safe(refreshNav, 'nav badges'); }
    if (CUR && CUR.def && typeof CUR.def.frame === 'function') { var d = CUR.def; safe(function () { d.frame(dt, t); }, 'frame ' + CUR.id); }
    for (var i = TICKERS.length - 1; i >= 0; i--) { var keep = false; try { keep = TICKERS[i](dt, t); } catch (e) { report(e, 'ticker'); } if (keep === false) TICKERS.splice(i, 1); }
    safe(function () { resStep(dt); }, 'results');
    safe(function () { portalStep(dt); }, 'portal');
    drawCanvases(dt, t);
  };

  /* SPEC: DPR-sized canvas filling `el`, redrawn every UI frame while connected + visible.
   * draw(ctx, w, h, t) gets CSS-pixel units (ctx is pre-scaled and cleared).
   * opts (optional): { fps: n (throttle), once: true (draw once / on resize), keep: true (no auto clear), cls } */
  UI.canvas = function (el, draw, opts) {
    if (!el || typeof draw !== 'function') return { cv: null, ctx: null, stop: function () {}, redraw: function () {} };
    var r = canvasHelper(el, function (ctx, w, h, t) { draw(ctx, w, h, t); }, opts);
    return { cv: r.cv, ctx: r.ctx, stop: r.stop, redraw: r.redraw };
  };

  /* extras */
  UI.fmt = fmt; UI.fmtC = fmtC; UI.fmtTime = fmtTime;
  UI.icon = function (name, cls) { return ic(name, cls); };
  UI.current = null; UI.params = null; UI.tab = null; UI.selChapter = null;
  UI.ticker = ticker;

  GM.UI = UI;
})(window.GM = window.GM || {});
