/* GÖLGE MUHAFIZLARI — ui-meta.js (owner: ui-meta)  ·  Namespace: GM.UIMeta  (SPEC §7.2)
 *
 * Meta-progression screens, registered with GM.UI.reg at init:
 *   ekipman         paper-doll stage (velvet backdrop, GM.Art.drawHero large, 12 slots 6|6), power + key stats,
 *                   set bonus chips, bag grid (5 cols) with slot filters / sort / "Yeni" / better-than-equipped arrows,
 *                   merge mode (pick 3 → forge overlay: anvil, hammer flashes, sparks → beam reveal),
 *                   item detail modal (compare, Kuşan/Çıkar, hold-to-repeat Yükselt, Görünüm skin picker, Sat).
 *   kahraman        hero roster cards (portrait, rarity frame, class, stars, level, weapon affinity, lock/price, active).
 *   kahraman-detay  hero detail: big animated hero (own look + gear + skin preview), lore, passives, ult card,
 *                   level up (hold) / star up / Aktif Yap / unlock / hero skins / talent tree entry.
 *   yetenek         RoK-style talent tree: 3 coloured branch tabs, node grid with glowing connectors along req,
 *                   row gates (row×3 points), rank badges, node popover (hold to rank), reset (100 elmas).
 *   gelisim         tabs Eğitim (4 gold trainings, hold-to-repeat) and Nitelikler (6 GTA-style attributes 0–100).
 *
 * Public: GM.UIMeta = { init(), badges(), openItem(uid), openSkins(target, item), openHero(id), openTalents(id),
 *                       openMerge(uid?), screens /* registered defs (for harnesses) *\/ }
 * Every call into another module is guarded (typeof checks + try/catch): a missing GM.S / GM.Art / GM.UI / GM.A
 * never throws here. Numbers are formatted with toLocaleString('tr-TR').
 */
(function (GM) {
  'use strict';

  /* ============================================================================================
   * Small helpers
   * ========================================================================================== */
  var PI = Math.PI, TAU = PI * 2;
  var sin = Math.sin, cos = Math.cos, abs = Math.abs, mn = Math.min, mx = Math.max, floor = Math.floor, round = Math.round, sqrt = Math.sqrt;
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function lerp(a, b, k) { return a + (b - a) * k; }
  function eOut(k) { k = clamp(k, 0, 1); return 1 - (1 - k) * (1 - k) * (1 - k); }
  function eIn(k) { k = clamp(k, 0, 1); return k * k * k; }
  function eBack(k) { k = clamp(k, 0, 1); var c = 1.70158, c3 = c + 1; return 1 + c3 * Math.pow(k - 1, 3) + c * Math.pow(k - 1, 2); }
  function fract(v) { return v - floor(v); }
  function hash(n) { var x = sin(n * 127.1 + 311.7) * 43758.5453; return x - floor(x); }
  function now() { return (window.performance && performance.now) ? performance.now() : Date.now(); }

  var RM = false;
  try { RM = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches); } catch (e) { /* ignore */ }
  function DPR() { return mn(window.devicePixelRatio || 1, 2); }

  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
  function mk(tag, cls, html) { var e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function setText(el, s) { if (el && el.textContent !== String(s)) el.textContent = s; }
  function setHTML(el, s) { if (el && el.__mtH !== s) { el.__mtH = s; el.innerHTML = s; } }
  function tog(el, cls, on) { if (el) el.classList.toggle(cls, !!on); }
  function restart(el, cls) { if (!el || RM) return; el.classList.remove(cls); void el.offsetWidth; el.classList.add(cls); }

  function fmt(n) { n = round(+n || 0); try { return n.toLocaleString('tr-TR'); } catch (e) { return String(n); } }
  function fmtD(v, d) {
    v = +v || 0; d = d == null ? 1 : d;
    try { return v.toLocaleString('tr-TR', { maximumFractionDigits: d, minimumFractionDigits: 0 }); }
    catch (e) { return String(round(v * Math.pow(10, d)) / Math.pow(10, d)).replace('.', ','); }
  }

  var RGBC = {};
  function rgbOf(h) {
    var c = RGBC[h]; if (c) return c;
    var m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(h || '').trim()), s;
    if (m) { s = m[1]; if (s.length === 3) s = s[0] + s[0] + s[1] + s[1] + s[2] + s[2]; }
    var n = m ? parseInt(s, 16) : 0x808080;
    c = [(n >> 16) & 255, (n >> 8) & 255, n & 255]; RGBC[h] = c; return c;
  }
  function rgba(h, a) { var c = rgbOf(h); return 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + a + ')'; }
  function mixHex(a, b, k) {
    var A = rgbOf(a), B = rgbOf(b);
    return '#' + ((1 << 24) | (round(lerp(A[0], B[0], k)) << 16) | (round(lerp(A[1], B[1], k)) << 8) | round(lerp(A[2], B[2], k))).toString(16).slice(1);
  }

  var errN = 0;
  function report(e, label) { if (errN++ < 12) { try { console.error('[GM.UIMeta] ' + label + ':', e); } catch (x) { /* ignore */ } } }
  function safe(fn, label) { try { return fn(); } catch (e) { report(e, label || 'error'); } return undefined; }

  /* ============================================================================================
   * Data access (GM.D with SPEC fallbacks)
   * ========================================================================================== */
  var FB = {
    RARITIES: [
      { id: 'siradan', n: 'Sıradan', col: '#A7ADB7', dark: '#5D6370', mult: 1.00, maxLv: 10, subs: 0, glow: 0 },
      { id: 'iyi', n: 'İyi', col: '#5BD16E', dark: '#2C7A3A', mult: 1.30, maxLv: 20, subs: 1, glow: 0 },
      { id: 'nadir', n: 'Nadir', col: '#4BA3FF', dark: '#1F5DA8', mult: 1.70, maxLv: 30, subs: 2, glow: 0.3 },
      { id: 'destansi', n: 'Destansı', col: '#B565FF', dark: '#6A2BB0', mult: 2.25, maxLv: 40, subs: 3, glow: 0.6 },
      { id: 'efsanevi', n: 'Efsanevi', col: '#FFB020', dark: '#A8620A', mult: 3.00, maxLv: 50, subs: 3, glow: 0.85 },
      { id: 'mitik', n: 'Mitik', col: '#FF3D4F', dark: '#8E1324', mult: 4.00, maxLv: 60, subs: 4, glow: 1.0 }],
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
      { id: 'ayak', n: 'Çizme', poss: 'Çizmesi', group: 'zirh', main: 'spdPct', base: 0.03, grow: 0.03 }],
    WEAPONS: {
      kilic: { id: 'kilic', n: 'Kılıç', desc: 'Önündeki yayda geniş bir kesik atar.', kind: 'melee', icon: 'sword' },
      yay: { id: 'yay', n: 'Yay', desc: 'En yakın düşmana delip geçen oklar atar.', kind: 'ranged', icon: 'bow' },
      orak: { id: 'orak', n: 'Orak', desc: 'Etrafında tam tur dönen ağır bir savuruş.', kind: 'melee', icon: 'scythe' },
      asa: { id: 'asa', n: 'Asa', desc: 'Hedef arayan, patlayan büyü küreleri.', kind: 'ranged', icon: 'staff' } },
    SETS: {
      kurt: { id: 'kurt', n: 'Kurt Postu', col: '#8A5A3A', bonus: { 4: { hpPct: 0.08 }, 8: { spdPct: 0.06 } } },
      gece: { id: 'gece', n: 'Gece Bekçisi', col: '#2E3F66', bonus: { 4: { defPct: 0.10 }, 8: { crit: 0.05 } } },
      kor: { id: 'kor', n: 'Kor Şövalye', col: '#FF7A2F', bonus: { 4: { atkPct: 0.08 }, 8: { e_ates: 0.20 } } },
      ejder: { id: 'ejder', n: 'Ejder Pulu', col: '#C8283C', bonus: { 4: { critDmg: 0.25 }, 8: { skillDmg: 0.15 } } },
      golge: { id: 'golge', n: 'Gölge Kralı', col: '#9D6BFF', bonus: { 4: { lifesteal: 0.04 }, 8: { atkPct: 0.15 } } } },
    SCROLL_GROUPS: { silah: { n: 'Silah Parşömeni', col: '#FF7A2F' }, zirh: { n: 'Zırh Parşömeni', col: '#4BA3FF' }, taki: { n: 'Takı Parşömeni', col: '#B565FF' } },
    HERO_PROG: { maxLvByStar: [0, 20, 30, 40, 50, 60], goldBase: 120, goldGrow: 1.085, shardsByStar: [0, 10, 20, 40, 80, 0], lvlStatGrow: 0.04, starStatGrow: 0.10, pointsPerLevel: 1 },
    TRAINING: [
      { id: 'atk', n: 'Saldırı Eğitimi', key: 'atk', per: 3, max: 200, costBase: 80, costGrow: 1.045, icon: 'sword' },
      { id: 'hp', n: 'Dayanım Eğitimi', key: 'hp', per: 30, max: 200, costBase: 80, costGrow: 1.045, icon: 'heart' },
      { id: 'def', n: 'Zırh Eğitimi', key: 'def', per: 2, max: 200, costBase: 80, costGrow: 1.045, icon: 'shield' },
      { id: 'crit', n: 'Odak Eğitimi', key: 'crit', per: 0.002, max: 100, costBase: 150, costGrow: 1.06, icon: 'eye' }],
    ATTRS: [
      { id: 'dayaniklilik', n: 'Dayanıklılık', icon: 'heart', src: 'distance', factor: 0.01, base: 6, eff: { key: 'hpPct', per: 0.004 }, how: 'Savaşta koştukça artar.' },
      { id: 'guc', n: 'Güç', icon: 'fist', src: 'meleeKills', factor: 1, base: 9, eff: { key: 'w_kilic', per: 0.004 }, eff2: { key: 'w_orak', per: 0.004 }, how: 'Yakın dövüş silahıyla düşman öldürdükçe artar.' },
      { id: 'nisan', n: 'Nişancılık', icon: 'bow', src: 'rangedHits', factor: 0.5, base: 12, eff: { key: 'w_yay', per: 0.004 }, eff2: { key: 'w_asa', per: 0.004 }, how: 'Uzak menzilli silahla isabet ettirdikçe artar.' },
      { id: 'ceviklik', n: 'Çeviklik', icon: 'boot', src: 'nearMisses', factor: 1, base: 5, eff: { key: 'dodge', per: 0.0015 }, how: 'Saldırıları kıl payı atlattıkça artar.' },
      { id: 'buyu', n: 'Büyü Gücü', icon: 'star', src: 'skillDamage', factor: 0.002, base: 8, eff: { key: 'skillDmg', per: 0.004 }, how: 'Yeteneklerle hasar verdikçe artar.' },
      { id: 'hayatta', n: 'Hayatta Kalma', icon: 'clock', src: 'time', factor: 0.25, base: 4, eff: { key: 'regen', per: 0.03 }, how: 'Savaşta hayatta kaldığın her saniye artar.' }],
    ECON: { talentResetGems: 100 },
    ATTR_MAX: 100
  };
  var PCT_KEYS = { atkPct: 1, hpPct: 1, defPct: 1, crit: 1, critDmg: 1, spdPct: 1, cdr: 1, lifesteal: 1, pickup: 1, xpGain: 1, goldGain: 1, area: 1,
    dur: 1, eliteDmg: 1, bossDmg: 1, skillDmg: 1, w_kilic: 1, w_yay: 1, w_orak: 1, w_asa: 1, e_ates: 1, e_buz: 1, e_yildirim: 1, e_zehir: 1, e_golge: 1,
    dodge: 1, ultCharge: 1, ultDmg: 1, execute: 1, thorns: 1 };
  var INT_KEYS = { projCount: 1, pierce: 1, revive: 1, startLvl: 1 };

  function dat(k) { var D = GM.D; return D && D[k] != null ? D[k] : FB[k]; }
  function rarities() { var R = dat('RARITIES'); return R && R.length ? R : FB.RARITIES; }
  function rarOf(i) { var R = rarities(); return R[clamp(i | 0, 0, R.length - 1)] || FB.RARITIES[0]; }
  function maxRar() { return rarities().length - 1; }
  function slots() { var S = dat('SLOTS'); return S && S.length ? S : FB.SLOTS; }
  function slotDef(id) { var S = slots(); for (var i = 0; i < S.length; i++) if (S[i].id === id) return S[i]; return null; }
  function slotIndex(id) { var S = slots(); for (var i = 0; i < S.length; i++) if (S[i].id === id) return i; return 99; }
  function weapons() { return dat('WEAPONS') || FB.WEAPONS; }
  function weaponDef(wt) { var W = weapons(); return (W && W[wt]) || FB.WEAPONS[wt] || null; }
  function weaponIcon(wt) { var w = weaponDef(wt); return (w && w.icon) || ({ kilic: 'sword', yay: 'bow', orak: 'scythe', asa: 'staff' })[wt] || 'sword'; }
  function sets() { return dat('SETS') || FB.SETS; }
  function setDef(id) { var S = sets(); return (S && S[id]) || null; }
  function setCol(id) { var s = setDef(id); return (s && s.col) || (FB.SETS[id] && FB.SETS[id].col) || '#9D6BFF'; }
  function heroDefs() { var H = dat('HEROES'); return H && H.length ? H : []; }
  function heroDef(id) { var H = heroDefs(); for (var i = 0; i < H.length; i++) if (H[i].id === id) return H[i]; return null; }
  function skinDefs() { var S = dat('SKINS'); return S && S.length ? S : []; }
  function skinDef(id) { var S = skinDefs(); for (var i = 0; i < S.length; i++) if (S[i].id === id) return S[i]; return null; }
  function skinsFor(target) { return skinDefs().filter(function (s) { return s.target === target; }); }
  function heroProg() { var H = dat('HERO_PROG'); return H && H.maxLvByStar ? H : FB.HERO_PROG; }
  function trainings() { var T = dat('TRAINING'); return T && T.length ? T : FB.TRAINING; }
  function attrDefs() { var A = dat('ATTRS'); return A && A.length ? A : FB.ATTRS; }
  function attrMax() { return +dat('ATTR_MAX') || 100; }
  function scrollGroup(g) { var G = dat('SCROLL_GROUPS') || FB.SCROLL_GROUPS; return (G && G[g]) || FB.SCROLL_GROUPS[g] || { n: 'Parşömen', col: '#C9A060' }; }
  function econ() { return dat('ECON') || FB.ECON; }
  function resetGems() { var E = econ(); return +(E && E.talentResetGems) || 100; }

  function statLabel(k) {
    var L = GM.D && GM.D.STAT_LABELS && GM.D.STAT_LABELS[k];
    if (L) return L;
    return { n: k, fmt: PCT_KEYS[k] ? 'pct' : INT_KEYS[k] ? 'int' : 'flat' };
  }
  /* stat value text without sign: '%12' / '1.240' / '2,5/sn' */
  function sv(k, v) {
    var L = statLabel(k); v = +v || 0;
    var a = abs(v);
    if (L.fmt === 'pct') { var p = a * 100; return '%' + fmtD(p, p < 10 ? (p < 1 ? 2 : 1) : (p % 1 ? 1 : 0)); }
    if (L.fmt === 'int') return fmt(a);
    if (k === 'atk' || k === 'hp' || k === 'def' || k === 'shieldStart') return fmt(a);
    return fmtD(a, a < 100 ? 1 : 0) + (L.u || '');
  }
  function svs(k, v) { return ((+v || 0) < 0 ? '−' : '+') + sv(k, v); }
  function statN(k) { return String(statLabel(k).n || k).replace(/\s*%$/, ''); }

  /* ============================================================================================
   * State access (guarded)
   * ========================================================================================== */
  function S() { try { return GM.S && GM.S.p ? GM.S : null; } catch (e) { return null; } }
  function P() { var s = S(); return s ? s.p : null; }
  function call(name) {
    var s = S(); if (!s || typeof s[name] !== 'function') return undefined;
    var a = Array.prototype.slice.call(arguments, 1);
    try { return s[name].apply(s, a); } catch (e) { report(e, 'S.' + name); return undefined; }
  }
  function rev() { var r = call('revision'); return typeof r === 'number' ? r : -1; }
  function gold() { var p = P(); return p ? +p.gold || 0 : 0; }
  function gems() { var p = P(); return p ? +p.gems || 0 : 0; }
  function getItem(uid) { return call('getItem', uid) || null; }
  function equippedItem(slot) { return call('equipped', slot) || null; }
  function isEquipped(it) { var p = P(); return !!(it && p && p.equip && p.equip[it.slot] === it.uid); }
  function itemName(it) {
    var n = call('itemName', it); if (n) return n;
    if (!it) return '';
    if (it.slot === 'silah') { var W = GM.D && GM.D.WEAPON_NAMES; return (W && W[it.wt] && W[it.wt][it.rar]) || (weaponDef(it.wt) || { n: 'Silah' }).n; }
    var st = setDef(it.set), sd = slotDef(it.slot); return st ? st.n + ' ' + (sd ? sd.poss : '') : (sd ? sd.n : 'Eşya');
  }
  function itemMain(it) {
    var m = call('itemMain', it); if (m && m.k) return m;
    var sd = slotDef(it && it.slot); if (!sd) return { k: 'atk', v: 0 };
    return { k: sd.main, v: sd.base * rarOf(it.rar).mult * (1 + sd.grow * ((it.lvl || 1) - 1)) };
  }
  function mainAt(it, lvl) { var sd = slotDef(it.slot); if (!sd) return 0; return sd.base * rarOf(it.rar).mult * (1 + sd.grow * (lvl - 1)); }
  function itemPower(it) { var v = call('itemPower', it); return typeof v === 'number' ? v : 0; }
  function power(id) { var v = call('power', id); return typeof v === 'number' && isFinite(v) ? v : 0; }
  function stats(id) { return call('computeStats', id) || null; }
  function heroSt(id) { var p = P(); return (p && p.heroes && p.heroes[id]) || null; }
  function activeId() { var p = P(); return (p && p.active) || 'bora'; }
  function look(id) { return call('appearance', id) || { heroId: id || activeId(), heroSkin: null, weapon: null, gear: {} }; }
  function cloneLook(L) {
    var o = { heroId: L.heroId, heroSkin: L.heroSkin || null, weapon: L.weapon ? { wt: L.weapon.wt, rar: L.weapon.rar, skin: L.weapon.skin || null } : null, gear: {} };
    var g = L.gear || {};
    for (var k in g) if (Object.prototype.hasOwnProperty.call(g, k)) o.gear[k] = g[k] ? { rar: g[k].rar, set: g[k].set, skin: g[k].skin || null } : null;
    return o;
  }
  function onChange(fn) {
    var s = GM.S;
    if (!s || typeof s.on !== 'function') return function () {};
    try {
      var r = s.on('change', fn);
      return typeof r === 'function' ? r : function () { try { if (s.off) s.off('change', fn); } catch (e) { /* ignore */ } };
    } catch (e) { return function () {}; }
  }

  /* ============================================================================================
   * UI wrappers (GM.UI with tiny fallbacks)
   * ========================================================================================== */
  function snd(name, o) { try { if (GM.A && typeof GM.A.play === 'function') GM.A.play(name, o); } catch (e) { /* audio never breaks UI */ } }
  function rootEl() { return document.getElementById('gm'); }
  function layerEl() { return document.getElementById('gm-layer') || rootEl() || document.body; }
  function toast(text, kind) {
    if (GM.UI && typeof GM.UI.toast === 'function') { try { return GM.UI.toast(text, kind); } catch (e) { report(e, 'toast'); } }
    var t = mk('div', 'toast ' + (kind || 'info'), esc(text));
    layerEl().appendChild(t);
    setTimeout(function () { if (t.parentNode) t.parentNode.removeChild(t); }, 2400);
    return t;
  }
  function modal(content, o) {
    o = o || {};
    if (GM.UI && typeof GM.UI.modal === 'function') { try { return GM.UI.modal(content, o); } catch (e) { report(e, 'modal'); } }
    var back = mk('div', 'modal-back'), box = mk('div', 'modal' + (o.cls ? ' ' + o.cls : ''));
    box.innerHTML = '<button class="x mt-fbx" type="button" aria-label="Kapat">×</button><div class="mt-fbody"></div>';
    var body = $('.mt-fbody', box);
    if (typeof content === 'string') body.innerHTML = content; else if (content) body.appendChild(content);
    back.appendChild(box); layerEl().appendChild(back);
    var closed = false, m = { el: box, body: body, back: back };
    m.close = function () { if (closed) return; closed = true; if (back.parentNode) back.parentNode.removeChild(back); if (o.onClose) safe(o.onClose, 'onClose'); };
    back.addEventListener('click', function (e) { if (e.target === back && o.dismiss !== false) m.close(); });
    $('.mt-fbx', box).addEventListener('click', m.close);
    return m;
  }
  function confirmBox(o) {
    if (GM.UI && typeof GM.UI.confirm === 'function') { try { return GM.UI.confirm(o); } catch (e) { report(e, 'confirm'); } }
    return new Promise(function (res) {
      var done = false;
      var b = mk('div', 'mt-cfm', '<p>' + esc(o.text || '') + '</p><div class="mt-row"><button class="btn btn-dark" type="button">' + esc(o.cancel || 'Vazgeç') +
        '</button><button class="btn btn-gold" type="button">' + esc(o.ok || 'Tamam') + '</button></div>');
      var m = modal(b, { title: o.title, onClose: function () { if (!done) { done = true; res(false); } } });
      var bs = $$('button', b);
      bs[0].addEventListener('click', function () { m.close(); });
      bs[1].addEventListener('click', function () { if (!done) { done = true; res(true); } m.close(); });
    });
  }
  function floatNum(el, text, col) {
    if (GM.UI && typeof GM.UI.floatNum === 'function') { try { GM.UI.floatNum(el, text, col); return; } catch (e) { report(e, 'floatNum'); } }
    var R = rootEl(); if (!R || !el || !el.getBoundingClientRect) return;
    var a = R.getBoundingClientRect(), r = el.getBoundingClientRect();
    var f = mk('div', 'mt-float num', esc(text));
    f.style.left = (r.left - a.left + r.width / 2) + 'px'; f.style.top = (r.top - a.top + r.height * 0.3) + 'px';
    if (col) f.style.color = col;
    layerEl().appendChild(f);
    setTimeout(function () { if (f.parentNode) f.parentNode.removeChild(f); }, 1150);
  }
  function go(id, params) { if (GM.UI && typeof GM.UI.go === 'function') safe(function () { GM.UI.go(id, params); }, 'go ' + id); }
  function back() { if (GM.UI && typeof GM.UI.back === 'function') safe(function () { GM.UI.back(); }, 'back'); }
  function uiRefresh() { if (GM.UI && typeof GM.UI.refresh === 'function') safe(function () { GM.UI.refresh(); }, 'UI.refresh'); }

  /* ============================================================================================
   * SVG glyphs (own set; ui-core's coloured icons are used for currencies when present)
   * ========================================================================================== */
  var G = {
    silah: '<path d="M20.8 2.9l.3 3.4-9.5 9.6-3-3 9.6-9.6z"/><path d="M5.8 12.4l5.8 5.8" class="k" stroke-width="3.2"/><path d="M7.9 16.1l-3.6 3.6" class="k" stroke-width="2.6"/><circle cx="3.6" cy="20.4" r="1.9"/>',
    kafa: '<path d="M12 2.4c1.7.5 2.6 1.6 2.7 3.1H9.3c.1-1.5 1-2.6 2.7-3.1z"/><path d="M3.8 14.6C3.8 9 7.4 5.2 12 5.2s8.2 3.8 8.2 9.4v4.3c0 .9-.7 1.6-1.6 1.6h-4.4v-5.6H9.8v5.6H5.4c-.9 0-1.6-.7-1.6-1.6z"/><path d="M5.6 12.4h12.8" class="d" stroke-width="1.8"/>',
    yuz: '<path d="M12 2.8c4.6 0 7.8 2.4 7.8 7.2 0 5.7-3.6 10.7-7.8 11.2-4.2-.5-7.8-5.5-7.8-11.2 0-4.8 3.2-7.2 7.8-7.2z"/><path d="M6.6 9.6c1.2-.8 2.6-.8 3.8 0-.4 1.4-1.2 2.1-1.9 2.1s-1.5-.7-1.9-2.1zM13.6 9.6c1.2-.8 2.6-.8 3.8 0-.4 1.4-1.2 2.1-1.9 2.1s-1.5-.7-1.9-2.1z" class="f"/><path d="M9.6 16.2c1.6.9 3.2.9 4.8 0" class="d" stroke-width="1.5"/>',
    boyun: '<path d="M4.6 3.6c.4 6.4 3.4 10 7.4 10s7-3.6 7.4-10" class="k" stroke-width="2.2"/><path d="M12 12.6l3.4 4-3.4 5.2-3.4-5.2z"/><circle cx="7.2" cy="9.6" r="1.1"/><circle cx="16.8" cy="9.6" r="1.1"/>',
    omuz: '<path d="M2.8 15.2c0-6.2 4-10.4 9.2-10.4s9.2 4.2 9.2 10.4c-2.1-1.5-4.6-2.3-9.2-2.3s-7.1.8-9.2 2.3z"/><path d="M4.8 18.8c1.9-1.7 4.1-2.5 7.2-2.5s5.3.8 7.2 2.5c-.6 1.5-3.3 2.2-7.2 2.2s-6.6-.7-7.2-2.2z"/><circle cx="12" cy="9.4" r="1.4" class="f"/>',
    gogus: '<path d="M5.9 3.6h3.4c.6 1.6 1.5 2.5 2.7 2.5s2.1-.9 2.7-2.5h3.4l2.7 3.6-2.1 3.1v8.4c0 1.3-3 2.7-6.7 2.7s-6.7-1.4-6.7-2.7v-8.4L3.2 7.2z"/><path d="M12 8.2v12M8 12.6c2.6.8 5.4.8 8 0" class="d" stroke-width="1.4"/>',
    kol: '<path d="M6.6 4.4h10.8l1.7 15.2H4.9z"/><path d="M6.2 9h11.6M5.7 14.2h12.6" class="d" stroke-width="1.6"/><circle cx="12" cy="11.6" r="1.2" class="f"/>',
    eldiven: '<path d="M7.4 21.2v-6.3L4.6 11.4c-.7-1 .5-2.3 1.6-1.6l2.1 1.4V5.4c0-.9.7-1.6 1.6-1.6s1.6.7 1.6 1.6v4.4V4.2c0-.9.7-1.6 1.6-1.6s1.6.7 1.6 1.6v5.6V5c0-.9.7-1.6 1.6-1.6s1.6.7 1.6 1.6v5.4V7.6c0-.9.7-1.6 1.6-1.6s1.6.7 1.6 1.6v7.2c0 3.6-2.4 6.4-6 6.4z"/><path d="M7.6 17.6h9.6" class="d" stroke-width="1.5"/>',
    kemer: '<path d="M1.8 8.8h20.4v6.4H1.8z"/><rect x="8.4" y="6.6" width="7.2" height="10.8" rx="1.6" class="f"/><path d="M10.6 9.2h2.8v5.6h-2.8z" class="d" stroke-width="1.4"/>',
    pantolon: '<path d="M5.8 2.8h12.4l1.6 18.4h-5.3L12 9.8l-2.5 11.4H4.2z"/><path d="M5.6 6h12.8" class="d" stroke-width="1.5"/>',
    dizlik: '<path d="M6.6 3.6h10.8v8.2c0 4-2.4 7-5.4 7s-5.4-3-5.4-7z"/><circle cx="12" cy="11.2" r="2.6" class="f"/><path d="M4.4 6.6h15.2M4.4 15.4h3M16.6 15.4h3" class="k" stroke-width="1.6"/>',
    ayak: '<path d="M6.6 2.8h7.6v10.6c3.8.4 7 1.9 7.4 4.8v2.6H4.2l.6-7.8z"/><path d="M4.4 18.4h17.2M6.8 6.8h7.2" class="d" stroke-width="1.5"/>',
    heart: '<path d="M12 21s-8.4-5.3-8.4-11.4A4.7 4.7 0 0 1 12 6.6a4.7 4.7 0 0 1 8.4 3C20.4 15.7 12 21 12 21z"/>',
    shield: '<path d="M12 2.4l8.4 3.1v6.1c0 5.2-3.6 8.9-8.4 10.3-4.8-1.4-8.4-5.1-8.4-10.3V5.5z"/><path d="M12 6v12" class="d" stroke-width="1.4"/>',
    crit: '<circle cx="12" cy="12" r="7.6" class="k" stroke-width="2.4"/><circle cx="12" cy="12" r="3.2"/><path d="M12 1.6v4M12 18.4v4M1.6 12h4M18.4 12h4" class="k" stroke-width="2.2"/>',
    speed: '<path d="M3 15.5c4.6-.4 8-2.6 10.4-6.8L21 5.4c-1.2 5.8-5 11.2-12.4 12.6z"/><path d="M2.6 8.6h6M1.6 12h4.4" class="k" stroke-width="1.8"/>',
    anvil: '<path d="M2.6 6.6h12.8c.4 2.6 2.8 4 6 4v1.8c-3.2 0-5.4 1.2-6.4 3.4l1.7 3.6H7.2l1.6-3.6c-1.4-1.6-3.6-2.6-6.2-2.8z"/><path d="M5 19.4h12" class="k" stroke-width="2"/>',
    sort: '<path d="M7 3.4v15.4M3.4 15l3.6 3.8 3.6-3.8" class="k" stroke-width="2.2"/><path d="M17 20.6V5.2M13.4 9 17 5.2 20.6 9" class="k" stroke-width="2.2"/>',
    lock: '<path d="M7.4 10.4V7.6a4.6 4.6 0 0 1 9.2 0v2.8" class="k" stroke-width="2.6"/><rect x="4.6" y="10" width="14.8" height="11" rx="2.6"/><path d="M12 14v3" class="d" stroke-width="2"/>',
    check: '<path d="M4.4 12.6l5 5L19.8 6.8" class="k" stroke-width="3.2"/>',
    plus: '<path d="M12 4.4v15.2M4.4 12h15.2" class="k" stroke-width="3.4"/>',
    up: '<path d="M12 3.6l7.2 8.2h-4.4v8.6H9.2v-8.6H4.8z"/>',
    down: '<path d="M12 20.4l7.2-8.2h-4.4V3.6H9.2v8.6H4.8z"/>',
    back: '<path d="M15.4 4.4 7.8 12l7.6 7.6" class="k" stroke-width="3.4"/>',
    star: '<path d="M12 2.4l2.8 6.1 6.6.7-5 4.5 1.4 6.5L12 17l-5.8 3.2 1.4-6.5-5-4.5 6.6-.7z"/>',
    tree: '<circle cx="12" cy="4.6" r="2.6"/><circle cx="5.4" cy="12.4" r="2.6"/><circle cx="18.6" cy="12.4" r="2.6"/><circle cx="12" cy="19.6" r="2.8"/><path d="M12 7.2v9.6M10.2 6.4 6.8 10.4M13.8 6.4l3.4 4M6.8 14.6l3.6 3.4M17.2 14.6l-3.6 3.4" class="k" stroke-width="1.6"/>',
    flame: '<path d="M12 21.6c-4.4 0-6.8-2.8-6.8-6.4 0-3 2-4.8 3-6.8.4 1.4 1 2.4 2 2.8-.2-3.4 1.6-6.6 4.2-8.8-.2 2.6.8 4.6 2.6 6.6 1.4 1.6 2 3.4 2 5.6 0 4-2.8 7-7 7z"/>',
    swap: '<path d="M4 8h13.6M14 4.4 17.6 8 14 11.6M20 16H6.4M10 12.4 6.4 16l3.6 3.6" class="k" stroke-width="2.2"/>',
    eye: '<path d="M1.8 12C4.4 7.6 8 5.4 12 5.4s7.6 2.2 10.2 6.6C19.6 16.4 16 18.6 12 18.6S4.4 16.4 1.8 12z"/><circle cx="12" cy="12" r="3.2" class="f"/>',
    info: '<circle cx="12" cy="12" r="9.4"/><path d="M12 10.6v6.6" class="d" stroke-width="2.4"/><circle cx="12" cy="7.2" r="1.4" class="f"/>',
    sell: '<circle cx="12" cy="12" r="9.2"/><path d="M14.8 8.6c-.6-.9-1.6-1.4-2.8-1.4-1.7 0-2.8.9-2.8 2.2 0 3 5.8 1.6 5.8 4.8 0 1.3-1.2 2.4-3 2.4-1.3 0-2.4-.6-3-1.6M12 5.4v1.8M12 16.6v2" class="d" stroke-width="1.6"/>',
    brush: '<path d="M20.8 3.2c-3.4 1.8-7.6 5.6-9.8 8.6l1.8 1.8c3-2.2 6.8-6.4 8.6-9.8z"/><path d="M10 13c-2.2-.2-4 1.4-4.2 3.6-.1 1.4-.8 2.6-2.4 3.2 2.8 1.2 6.6.6 7.8-1.6.8-1.4.6-3.2-1.2-5.2z"/>'
  };
  function gl(name, cls) {
    var b = G[name] || G.info;
    return '<svg class="mt-g' + (cls ? ' ' + cls : '') + '" viewBox="0 0 24 24" aria-hidden="true" focusable="false">' + b + '</svg>';
  }
  /* ui-core's coloured icons (gold, gem, scroll, shard, swords, x…) with a glyph fallback */
  var UIFB = { gold: 'sell', gem: 'star', scroll: 'tree', shard: 'star', swords: 'silah', x: 'plus', crown: 'star', bolt: 'speed', clock: 'info', lock: 'lock', check: 'check', star: 'star' };
  function ui(name, cls) {
    if (GM.UI && typeof GM.UI.icon === 'function') { try { var s = GM.UI.icon(name, 'mt-ui' + (cls ? ' ' + cls : '')); if (s) return s; } catch (e) { /* ignore */ } }
    return gl(UIFB[name] || 'info', 'mt-ui ' + (cls || ''));
  }

  /* ============================================================================================
   * Canvases (GM.UI.canvas when present; a tiny own driver otherwise)
   * ========================================================================================== */
  var OWN = [], ownRaf = 0;
  function ownLoop(ts) {
    ownRaf = 0;
    var t = ts / 1000, dpr = DPR();
    for (var i = OWN.length - 1; i >= 0; i--) {
      var r = OWN[i];
      if (r.dead || (!r.cv.isConnected && r.seen)) { OWN.splice(i, 1); continue; }
      if (!r.cv.isConnected) continue;
      r.seen = true;
      var w = r.cv.clientWidth, h = r.cv.clientHeight; if (w < 1 || h < 1) continue;
      if (r.w !== w || r.h !== h) { r.w = w; r.h = h; r.cv.width = round(w * dpr); r.cv.height = round(h * dpr); r.drawn = false; }
      if (r.once && r.drawn) continue;
      r.ctx.setTransform(dpr, 0, 0, dpr, 0, 0); r.ctx.clearRect(0, 0, w, h);
      try { r.draw(r.ctx, w, h, t); } catch (e) { report(e, 'canvas'); r.dead = true; }
      r.drawn = true;
    }
    if (OWN.length) ownRaf = requestAnimationFrame(ownLoop);
  }
  function cvs(host, draw, opts) {
    opts = opts || {};
    if (GM.UI && typeof GM.UI.canvas === 'function') {
      try {
        var r = GM.UI.canvas(host, draw, opts);
        if (r && r.cv) { r.cv.classList.add('mt-cv'); return r; }
      } catch (e) { report(e, 'UI.canvas'); }
    }
    var cv = mk('canvas', 'mt-cv'); if (host) host.appendChild(cv);
    var rec = { cv: cv, ctx: cv.getContext('2d'), draw: draw, once: !!opts.once, dead: false, drawn: false, w: 0, h: 0 };
    rec.stop = function () { rec.dead = true; };
    rec.redraw = function () { rec.drawn = false; };
    OWN.push(rec); if (!ownRaf) ownRaf = requestAnimationFrame(ownLoop);
    return rec;
  }
  function stopAll(list) { (list || []).forEach(function (r) { if (r && r.stop) safe(r.stop, 'stop'); }); if (list) list.length = 0; }
  function art(name) { return GM.Art && typeof GM.Art[name] === 'function' ? GM.Art[name] : null; }
  /* item icon canvas: rarity ≥ 3 animates, lower rarities draw once (and on resize / redraw) */
  function iconCv(host, getSeed, list, forceAnim) {
    var seed0 = getSeed();
    var anim = forceAnim || (seed0 && seed0.rar >= 3);
    var r = cvs(host, function (ctx, w, h, t) {
      var sd = getSeed(); if (!sd) return;
      var f = art('drawItemIcon');
      if (f) f(ctx, 0, 0, mn(w, h), sd, t);
      else { ctx.fillStyle = rarOf(sd.rar).col; ctx.globalAlpha = 0.5; ctx.fillRect(w * 0.2, h * 0.2, w * 0.6, h * 0.6); ctx.globalAlpha = 1; }
    }, anim ? { fps: 30 } : { once: true });
    if (list) list.push(r);
    return r;
  }

  /* ============================================================================================
   * Number tweens (own RAF so they run inside modals too)
   * ========================================================================================== */
  var TW = [], twRaf = 0;
  function twStep() {
    twRaf = 0;
    var tnow = now();
    for (var i = TW.length - 1; i >= 0; i--) {
      var w = TW[i], k = clamp((tnow - w.t0) / w.d, 0, 1), v = lerp(w.a, w.b, eOut(k));
      w.el.__mtv = v; w.el.textContent = w.f(v);
      if (k >= 1) { w.el.__mtv = w.b; TW.splice(i, 1); }
    }
    if (TW.length) twRaf = requestAnimationFrame(twStep);
  }
  function tweenTo(el, to, f, dur) {
    if (!el) return;
    f = f || fmt; to = +to || 0;
    for (var i = TW.length - 1; i >= 0; i--) if (TW[i].el === el) TW.splice(i, 1);
    var from = typeof el.__mtv === 'number' ? el.__mtv : null;
    if (from === null || RM || from === to || !el.isConnected) { el.__mtv = to; el.textContent = f(to); return; }
    TW.push({ el: el, a: from, b: to, d: dur || 650, t0: now(), f: f });
    if (to > from) restart(el, 'mt-bump');
    if (!twRaf) twRaf = requestAnimationFrame(twStep);
  }

  /* ============================================================================================
   * FX layer: additive particle bursts over everything (sparkles, rings, embers)
   * ========================================================================================== */
  var FX = { cv: null, ctx: null, parts: [], rings: [], raf: 0, w: 0, h: 0, spr: {} };
  function glowSpr(col) {
    var s = FX.spr[col]; if (s) return s;
    s = document.createElement('canvas'); s.width = s.height = 64;
    var g = s.getContext('2d'), gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.18, rgba(col, 0.95)); gr.addColorStop(0.5, rgba(col, 0.35)); gr.addColorStop(1, rgba(col, 0));
    g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
    FX.spr[col] = s; return s;
  }
  function fxEnsure() {
    var L = layerEl(), R = rootEl(); if (!L || !R) return false;
    if (!FX.cv || !FX.cv.isConnected) {
      FX.cv = mk('canvas', 'mt-fx'); L.appendChild(FX.cv); FX.ctx = FX.cv.getContext('2d'); FX.w = 0;
    } else if (FX.cv !== L.lastElementChild) L.appendChild(FX.cv);
    var w = R.clientWidth, h = R.clientHeight, d = DPR();
    if (w !== FX.w || h !== FX.h) { FX.w = w; FX.h = h; FX.cv.width = round(w * d); FX.cv.height = round(h * d); }
    return true;
  }
  function relPt(el, fx, fy) {
    var R = rootEl(); if (!R || !el || !el.getBoundingClientRect) return { x: 0, y: 0, w: 0, h: 0 };
    var a = R.getBoundingClientRect(), r = el.getBoundingClientRect();
    return { x: r.left - a.left + r.width * (fx == null ? 0.5 : fx), y: r.top - a.top + r.height * (fy == null ? 0.5 : fy), w: r.width, h: r.height };
  }
  /* burst(el | {x,y}, { col, n, speed, ring, up, size, life, cols }) */
  function burst(target, o) {
    o = o || {};
    if (!fxEnsure()) return;
    var p = target && target.nodeType ? relPt(target) : { x: +target.x || 0, y: +target.y || 0, w: 40, h: 40 };
    var n = RM ? mn(6, o.n || 18) : (o.n || 18), col = o.col || '#FFCB57', sp = o.speed || 160;
    for (var i = 0; i < n && FX.parts.length < 260; i++) {
      var a = Math.random() * TAU, v = sp * (0.35 + Math.random() * 0.8);
      var c = o.cols ? o.cols[i % o.cols.length] : col;
      FX.parts.push({ x: p.x + (Math.random() - 0.5) * p.w * (o.spread || 0.4), y: p.y + (Math.random() - 0.5) * p.h * (o.spread || 0.4),
        vx: cos(a) * v, vy: sin(a) * v - (o.up || 60), g: o.g == null ? 220 : o.g, age: 0, life: (o.life || 0.75) * (0.6 + Math.random() * 0.7),
        s: (o.size || 7) * (0.5 + Math.random() * 0.9), col: c, star: Math.random() < 0.35 });
    }
    if (o.ring !== false) FX.rings.push({ x: p.x, y: p.y, r0: mn(p.w, p.h) * 0.3, r1: mx(p.w, p.h) * (o.ringK || 0.9) + 24, age: 0, life: 0.5, col: col });
    if (!FX.raf) { FX.last = now(); FX.raf = requestAnimationFrame(fxStep); }
  }
  function fxStep() {
    FX.raf = 0;
    var tn = now(), dt = mn(0.05, (tn - FX.last) / 1000); FX.last = tn;
    var c = FX.ctx, d = DPR(); if (!c) return;
    c.setTransform(d, 0, 0, d, 0, 0); c.clearRect(0, 0, FX.w, FX.h);
    c.globalCompositeOperation = 'lighter';
    var i, q;
    for (i = FX.rings.length - 1; i >= 0; i--) {
      q = FX.rings[i]; q.age += dt; var k = q.age / q.life;
      if (k >= 1) { FX.rings.splice(i, 1); continue; }
      c.globalAlpha = (1 - k) * 0.9; c.strokeStyle = q.col; c.lineWidth = 3 * (1 - k) + 1;
      c.beginPath(); c.arc(q.x, q.y, lerp(q.r0, q.r1, eOut(k)), 0, TAU); c.stroke();
    }
    for (i = FX.parts.length - 1; i >= 0; i--) {
      q = FX.parts[i]; q.age += dt;
      if (q.age >= q.life) { FX.parts.splice(i, 1); continue; }
      q.vy += q.g * dt; q.vx *= 0.985; q.x += q.vx * dt; q.y += q.vy * dt;
      var kk = q.age / q.life, s = q.s * (1 - kk * 0.6);
      c.globalAlpha = (1 - kk) * (kk < 0.1 ? kk * 10 : 1);
      c.drawImage(glowSpr(q.col), q.x - s * 2, q.y - s * 2, s * 4, s * 4);
      if (q.star) {
        c.fillStyle = '#FFFFFF'; c.globalAlpha *= 0.9;
        c.beginPath(); c.moveTo(q.x, q.y - s * 1.6); c.lineTo(q.x + s * 0.3, q.y); c.lineTo(q.x, q.y + s * 1.6); c.lineTo(q.x - s * 0.3, q.y); c.closePath(); c.fill();
        c.beginPath(); c.moveTo(q.x - s * 1.6, q.y); c.lineTo(q.x, q.y + s * 0.3); c.lineTo(q.x + s * 1.6, q.y); c.lineTo(q.x, q.y - s * 0.3); c.closePath(); c.fill();
      }
    }
    c.globalAlpha = 1; c.globalCompositeOperation = 'source-over';
    if (FX.parts.length || FX.rings.length) FX.raf = requestAnimationFrame(fxStep);
    else c.clearRect(0, 0, FX.w, FX.h);
  }

  /* ============================================================================================
   * Hold-to-repeat buttons. Quick tap = one action; holding ≥ 0.36 s repeats, accelerating.
   * Moving the finger (scroll) cancels without acting. fn(i) returns false to stop.
   * ========================================================================================== */
  function holdable(btn, fn) {
    var tm = null, active = false, held = false, n = 0, sx = 0, sy = 0, pid = null;
    function clear() { if (tm) { clearTimeout(tm); tm = null; } }
    function stop() { clear(); active = false; held = false; btn.classList.remove('mt-holding'); }
    function fire() {
      var ok = false;
      try { ok = fn(n++) !== false; } catch (e) { report(e, 'hold'); ok = false; }
      return ok;
    }
    function rep() {
      if (!active) return;
      if (!fire()) { stop(); return; }
      tm = setTimeout(rep, mx(45, 190 - n * 16));
    }
    btn.addEventListener('pointerdown', function (e) {
      if (e.button > 0 || btn.disabled) return;
      active = true; held = false; n = 0; sx = e.clientX; sy = e.clientY; pid = e.pointerId;
      btn.classList.add('mt-holding');
      clear();
      tm = setTimeout(function () { if (!active) return; held = true; rep(); }, 360);
    });
    btn.addEventListener('pointermove', function (e) {
      if (!active || held || e.pointerId !== pid) return;
      if (abs(e.clientX - sx) + abs(e.clientY - sy) > 12) stop();
    });
    btn.addEventListener('pointerup', function (e) {
      if (!active || e.pointerId !== pid) return;
      var wasHeld = held; stop();
      if (!wasHeld) fire();
    });
    btn.addEventListener('pointercancel', stop);
    btn.addEventListener('pointerleave', function () { if (active && !held) stop(); else if (held) stop(); });
    btn.addEventListener('click', function (e) { if (e.detail === 0) { n = 0; fire(); } });
    btn.addEventListener('contextmenu', function (e) { e.preventDefault(); });
  }
  /* plain tap handler that also plays the click sound */
  function tap(el, fn, sound) {
    el.addEventListener('click', function (e) { if (sound !== false) snd(sound || 'click'); safe(function () { fn(e); }, 'tap'); });
  }

  /* shared bits of markup */
  function starsHtml(n, max) { var s = ''; max = max || 5; for (var i = 0; i < max; i++) s += i < n ? '★' : '<span class="off">★</span>'; return '<span class="stars mt-stars">' + s + '</span>'; }
  function rarPill(r) { return '<span class="mt-rar mt-r' + r + '">' + esc(rarOf(r).n) + '</span>'; }
  function costHtml(kind, n, short) {
    return '<span class="cost mt-cost' + (short ? ' mt-short' : '') + '" data-k="' + kind + '"><i class="mt-ci">' + ui(kind) + '</i><b>' + fmt(n) + '</b></span>';
  }
  function backHeader(title, sub, right) {
    return '<header class="mt-hd"><button class="mt-back" type="button" aria-label="Geri">' + gl('back') + '</button>' +
      '<div class="mt-hd-t"><h2 class="ttl">' + esc(title) + '</h2>' + (sub ? '<small>' + esc(sub) + '</small>' : '') + '</div>' + (right || '') + '</header>';
  }
  function bindBack(root) { var b = $('.mt-back', root); if (b) tap(b, function () { back(); }, 'click'); }

  /* lazily-created screen-level resize observer helper */
  function observe(el, fn) {
    var ro = null;
    try { if (window.ResizeObserver) { ro = new ResizeObserver(function () { safe(fn, 'resize'); }); ro.observe(el); } } catch (e) { ro = null; }
    if (!ro) { var h = function () { safe(fn, 'resize'); }; window.addEventListener('resize', h); return function () { window.removeEventListener('resize', h); }; }
    return function () { try { ro.disconnect(); } catch (e) { /* ignore */ } };
  }

  /* ============================================================================================
   * Stage painter (velvet curtains, spotlight, stone dais, rune ring, embers) — shared by the
   * paper-doll and the hero detail stage. Static layers are cached per size/tint.
   * ========================================================================================== */
  var BGC = {}, BGK = [], SPR = {};
  function offCv(w, h) { var c = document.createElement('canvas'); c.width = mx(1, round(w)); c.height = mx(1, round(h)); return c; }
  function softSpr(col) {
    var key = 's' + col; if (SPR[key]) return SPR[key];
    var s = offCv(128, 128), g = s.getContext('2d'), gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    gr.addColorStop(0, rgba(col, 0.75)); gr.addColorStop(0.35, rgba(col, 0.32)); gr.addColorStop(1, rgba(col, 0));
    g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
    SPR[key] = s; return s;
  }
  function beamSpr(col) {
    var key = 'b' + col; if (SPR[key]) return SPR[key];
    var s = offCv(64, 256), g = s.getContext('2d');
    var gx = g.createLinearGradient(0, 0, 64, 0);
    gx.addColorStop(0, rgba(col, 0)); gx.addColorStop(0.5, rgba(col, 0.55)); gx.addColorStop(1, rgba(col, 0));
    g.fillStyle = gx; g.fillRect(0, 0, 64, 256);
    g.globalCompositeOperation = 'destination-in';
    var gy = g.createLinearGradient(0, 0, 0, 256);
    gy.addColorStop(0, 'rgba(0,0,0,0)'); gy.addColorStop(0.55, 'rgba(0,0,0,0.6)'); gy.addColorStop(1, 'rgba(0,0,0,1)');
    g.fillStyle = gy; g.fillRect(0, 0, 64, 256);
    SPR[key] = s; return s;
  }
  function runeRing(col) {
    var key = 'r' + col; if (SPR[key]) return SPR[key];
    var N = 256, s = offCv(N, N), g = s.getContext('2d'), c = N / 2;
    g.translate(c, c); g.strokeStyle = col; g.fillStyle = col; g.lineCap = 'round';
    g.globalAlpha = 0.9; g.lineWidth = 3; g.beginPath(); g.arc(0, 0, 118, 0, TAU); g.stroke();
    g.globalAlpha = 0.55; g.lineWidth = 1.6; g.beginPath(); g.arc(0, 0, 104, 0, TAU); g.stroke();
    g.beginPath(); g.arc(0, 0, 70, 0, TAU); g.stroke();
    for (var i = 0; i < 24; i++) {
      var a = i * TAU / 24; g.save(); g.rotate(a); g.globalAlpha = 0.85; g.lineWidth = 2;
      var r = hash(i + 3);
      g.beginPath();
      if (r < 0.33) { g.moveTo(-4, -112); g.lineTo(0, -106); g.lineTo(4, -112); g.moveTo(0, -106); g.lineTo(0, -98); }
      else if (r < 0.66) { g.moveTo(-4, -100); g.lineTo(4, -110); g.moveTo(-4, -110); g.lineTo(0, -105); }
      else { g.moveTo(0, -111); g.lineTo(0, -99); g.moveTo(-4, -104); g.lineTo(4, -104); }
      g.stroke(); g.restore();
    }
    g.globalAlpha = 0.5; g.lineWidth = 2;
    g.beginPath();
    for (var j = 0; j <= 6; j++) { var b = j * TAU / 6 * 2 - PI / 2; var x = cos(b) * 70, y = sin(b) * 70; if (j) g.lineTo(x, y); else g.moveTo(x, y); }
    g.stroke();
    SPR[key] = s; return s;
  }
  function velvet(w, h, floorY, tint, dpr) {
    var key = [round(w), round(h), round(floorY), tint, dpr].join('|');
    if (BGC[key]) return BGC[key];
    var cv = offCv(w * dpr, h * dpr), g = cv.getContext('2d');
    g.scale(dpr, dpr);
    var base = tint || '#3A0F24';
    var gr = g.createLinearGradient(0, 0, 0, h);
    gr.addColorStop(0, mixHex(base, '#000000', 0.7)); gr.addColorStop(0.45, mixHex(base, '#000000', 0.25)); gr.addColorStop(1, '#0B0710');
    g.fillStyle = gr; g.fillRect(0, 0, w, h);
    // curtain folds
    var fw = clamp(w / 15, 18, 30);
    for (var x = -fw * 0.5, i = 0; x < w; x += fw, i++) {
      var sw = fw * (0.85 + hash(i * 1.7) * 0.4);
      var lg = g.createLinearGradient(x, 0, x + sw, 0);
      lg.addColorStop(0, 'rgba(0,0,0,0.55)'); lg.addColorStop(0.42, rgba(mixHex(base, '#FFFFFF', 0.35), 0.16));
      lg.addColorStop(0.55, rgba(mixHex(base, '#FFFFFF', 0.45), 0.2)); lg.addColorStop(1, 'rgba(0,0,0,0.55)');
      g.fillStyle = lg; g.fillRect(x, 0, sw, floorY);
    }
    // top valance (scalloped swags with gold trim + fringe)
    var sc = clamp(w / 5, 60, 110), vy = clamp(h * 0.06, 12, 22);
    g.beginPath(); g.moveTo(0, 0);
    for (var sx = 0; sx < w + sc; sx += sc) g.quadraticCurveTo(sx + sc / 2, vy * 2.2, sx + sc, 0);
    g.lineTo(w, 0); g.closePath();
    var vg = g.createLinearGradient(0, 0, 0, vy * 1.6);
    vg.addColorStop(0, mixHex(base, '#000000', 0.55)); vg.addColorStop(1, mixHex(base, '#FFFFFF', 0.08));
    g.fillStyle = vg; g.fill();
    g.strokeStyle = 'rgba(255,203,87,0.55)'; g.lineWidth = 1.6;
    g.beginPath();
    for (var sx2 = 0; sx2 < w + sc; sx2 += sc) { g.moveTo(sx2, 0); g.quadraticCurveTo(sx2 + sc / 2, vy * 2.2, sx2 + sc, 0); }
    g.stroke();
    g.fillStyle = 'rgba(255,203,87,0.35)';
    for (var fx = 0; fx < w; fx += 5) {
      var u = (fx % sc) / sc, fy = vy * 2.2 * 2 * u * (1 - u);
      g.fillRect(fx, fy, 1.4, 4 + hash(fx) * 3);
    }
    // spotlight cone
    g.save(); g.globalCompositeOperation = 'lighter';
    var cg = g.createLinearGradient(0, 0, 0, floorY);
    cg.addColorStop(0, 'rgba(255,214,160,0.13)'); cg.addColorStop(1, 'rgba(255,214,160,0.02)');
    g.fillStyle = cg; g.beginPath();
    g.moveTo(w / 2 - w * 0.08, 0); g.lineTo(w / 2 + w * 0.08, 0); g.lineTo(w / 2 + w * 0.36, floorY + 6); g.lineTo(w / 2 - w * 0.36, floorY + 6); g.closePath(); g.fill();
    var rg = g.createRadialGradient(w / 2, h * 0.32, 0, w / 2, h * 0.32, h * 0.55);
    rg.addColorStop(0, 'rgba(255,190,140,0.12)'); rg.addColorStop(1, 'rgba(255,190,140,0)');
    g.fillStyle = rg; g.fillRect(0, 0, w, h);
    g.restore();
    // floor
    var fg = g.createLinearGradient(0, floorY - 8, 0, h);
    fg.addColorStop(0, '#1A1222'); fg.addColorStop(1, '#09070D');
    g.fillStyle = fg; g.fillRect(0, floorY - 6, w, h - floorY + 6);
    g.fillStyle = 'rgba(255,203,87,0.12)'; g.fillRect(0, floorY - 6, w, 1);
    // stone dais
    var rx = mn(w * 0.34, 150), ry = rx * 0.24;
    g.save(); g.translate(w / 2, floorY + 2);
    g.fillStyle = '#0E0A14'; g.beginPath(); g.ellipse(0, ry * 0.55, rx * 1.04, ry * 1.12, 0, 0, TAU); g.fill();
    var dg = g.createRadialGradient(0, -ry * 0.3, 0, 0, 0, rx);
    dg.addColorStop(0, '#3A2D4C'); dg.addColorStop(0.7, '#221A2E'); dg.addColorStop(1, '#16101E');
    g.fillStyle = dg; g.beginPath(); g.ellipse(0, 0, rx, ry, 0, 0, TAU); g.fill();
    g.strokeStyle = 'rgba(255,203,87,0.35)'; g.lineWidth = 1.5; g.stroke();
    g.strokeStyle = 'rgba(0,0,0,0.5)'; g.lineWidth = 1; g.beginPath(); g.ellipse(0, 0, rx * 0.8, ry * 0.8, 0, 0, TAU); g.stroke();
    g.restore();
    // vignette + bottom blend
    var vgn = g.createRadialGradient(w / 2, h * 0.42, mn(w, h) * 0.3, w / 2, h * 0.5, mx(w, h) * 0.78);
    vgn.addColorStop(0, 'rgba(5,3,8,0)'); vgn.addColorStop(1, 'rgba(5,3,8,0.88)');
    g.fillStyle = vgn; g.fillRect(0, 0, w, h);
    var bb = g.createLinearGradient(0, h - 26, 0, h);
    bb.addColorStop(0, 'rgba(9,7,13,0)'); bb.addColorStop(1, 'rgba(9,7,13,0.9)');
    g.fillStyle = bb; g.fillRect(0, h - 26, w, 26);
    BGC[key] = cv; BGK.push(key);
    while (BGK.length > 6) delete BGC[BGK.shift()];
    return cv;
  }
  /* animated stage layers + hero. st = { look, rar, k, floorPad, tint, face, turn, act, flash, embers, … } */
  function stageDraw(st, ctx, w, h, t) {
    var dt = st.lastT ? clamp(t - st.lastT, 0, 0.05) : 0.016; st.lastT = t;
    var floorY = h - st.floorPad, cx = w / 2 + (st.cxOff || 0), dpr = DPR();
    ctx.drawImage(velvet(w, h, floorY, st.tint, dpr), 0, 0, w, h);
    var col = rarOf(st.rar).col, inten = 0.5 + 0.1 * st.rar;
    ctx.globalCompositeOperation = 'lighter';
    // flickering key light
    ctx.globalAlpha = 0.18 + 0.05 * sin(t * 2.3) + 0.03 * sin(t * 7.7);
    ctx.drawImage(softSpr('#FFC98A'), cx - w * 0.5, floorY - h * 0.95, w, h * 0.9);
    // floor glow + rune ring
    ctx.globalAlpha = (0.45 + 0.15 * sin(t * 1.7)) * inten;
    var rx = mn(w * 0.34, 150);
    ctx.drawImage(softSpr(col), cx - rx * 1.3, floorY - rx * 0.35, rx * 2.6, rx * 0.7);
    ctx.save(); ctx.translate(cx, floorY + 2); ctx.scale(1, 0.24); ctx.rotate(RM ? 0 : t * 0.22);
    ctx.globalAlpha = (0.5 + 0.25 * sin(t * 2.1)) * mn(1, inten + 0.25);
    var R = rx * 0.92; ctx.drawImage(runeRing(col), -R, -R, R * 2, R * 2);
    ctx.rotate(RM ? 0 : -t * 0.5); ctx.globalAlpha *= 0.5; ctx.drawImage(runeRing(col), -R * 0.6, -R * 0.6, R * 1.2, R * 1.2);
    ctx.restore();
    // aura beam behind the hero
    var k = st.k || 2;
    ctx.globalAlpha = (0.35 + 0.2 * sin(t * 1.3)) * inten;
    ctx.drawImage(beamSpr(col), cx - 58 * k * 0.6, floorY - 118 * k, 116 * k * 0.6, 120 * k);
    ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
    // hero (turning paper doll)
    var face = st.face || 1, sx = 1;
    if (st.turn) {
      st.turn.p += dt / 0.55;
      if (st.turn.p >= 1) { st.face = face = st.turn.to; st.turn = null; }
      else { var p = st.turn.p; sx = mx(0.08, abs(cos(p * PI))); face = p < 0.5 ? st.turn.from : st.turn.to; }
    } else if (!RM && st.autoTurn !== false) {
      st.turnT = (st.turnT || 0) + dt;
      if (st.turnT > (st.turnNext || 8)) { st.turnT = 0; st.turnNext = 8 + Math.random() * 6; st.turn = { p: 0, from: face, to: -face }; }
    }
    var anim = 'idle', atkP = 0;
    if (st.act) { st.act.t += dt; if (st.act.t >= st.act.d) st.act = null; else { anim = st.act.anim; atkP = st.act.t / st.act.d; } }
    var dh = art('drawHero');
    ctx.save(); ctx.translate(cx, 0); ctx.scale(sx, 1); ctx.translate(-cx, 0);
    if (dh) dh(ctx, cx, floorY, k, { look: st.look, t: t, anim: anim, atkP: atkP, dir: face, glow: true, shadow: true });
    else {
      ctx.fillStyle = '#2A2040'; ctx.beginPath(); ctx.ellipse(cx, floorY - 70 * k, 24 * k, 24 * k, 0, 0, TAU); ctx.fill();
      ctx.fillRect(cx - 16 * k, floorY - 48 * k, 32 * k, 48 * k);
    }
    ctx.restore();
    if (anim === 'attack' && atkP > 0.25 && atkP < 0.85 && GM.Art && GM.Art.fx && typeof GM.Art.fx.slash === 'function') {
      safe(function () { GM.Art.fx.slash(ctx, cx + 24 * k * face, floorY - 42 * k, 44 * k, face > 0 ? -0.25 : PI + 0.25, 2.2, (atkP - 0.25) / 0.6, col); }, 'fx.slash');
    }
    // equip flash
    ctx.globalCompositeOperation = 'lighter';
    if (st.flash > 0) {
      st.flash = mx(0, st.flash - dt * 1.5);
      ctx.globalAlpha = st.flash * 0.9;
      var fs = 120 * k;
      ctx.drawImage(softSpr(st.flashCol || '#FFFFFF'), cx - fs * 0.5, floorY - 55 * k - fs * 0.5, fs, fs);
    }
    // embers + dust
    var E = st.embers || (st.embers = []);
    if (!RM && E.length < 18 + st.rar * 3 && Math.random() < dt * (7 + st.rar * 2)) {
      var ember = Math.random() < 0.55;
      E.push({ x: cx + (Math.random() - 0.5) * rx * 2.2, y: floorY - Math.random() * 10, vy: 14 + Math.random() * 26, vx: (Math.random() - 0.5) * 8,
        age: 0, life: 2 + Math.random() * 2.5, s: 1.2 + Math.random() * 1.8, col: ember ? (Math.random() < 0.5 ? '#FF7A2F' : '#FFCB57') : col, ph: Math.random() * 6 });
    }
    for (var i = E.length - 1; i >= 0; i--) {
      var q = E[i]; q.age += dt;
      if (q.age > q.life) { E.splice(i, 1); continue; }
      q.y -= q.vy * dt; q.x += (q.vx + sin(t * 1.6 + q.ph) * 6) * dt;
      ctx.globalAlpha = sin(q.age / q.life * PI) * 0.85;
      var ss = q.s * 4; ctx.drawImage(glowSpr(q.col), q.x - ss, q.y - ss, ss * 2, ss * 2);
    }
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
  }
  /* tap = poke (attack / victory), horizontal drag = turn the hero around */
  function stageInput(el, getSt) {
    var x0 = null, y0 = 0, id = null;
    el.addEventListener('pointerdown', function (e) { x0 = e.clientX; y0 = e.clientY; id = e.pointerId; });
    el.addEventListener('pointerup', function (e) {
      if (x0 == null || e.pointerId !== id) return;
      var dx = e.clientX - x0, dy = e.clientY - y0, st = getSt(); x0 = null;
      if (!st) return;
      if (abs(dx) > 22 && abs(dx) > abs(dy)) {
        var to = dx > 0 ? 1 : -1, face = st.turn ? st.turn.to : (st.face || 1);
        if (to !== face) { st.turn = { p: 0, from: face, to: to }; st.turnT = 0; snd('whoosh'); }
      } else if (abs(dx) < 10 && abs(dy) < 10) poke(st);
    });
    el.addEventListener('pointercancel', function () { x0 = null; });
    el.addEventListener('click', function (e) { if (e.detail === 0) { var st = getSt(); if (st) poke(st); } });
  }
  function poke(st) {
    if (!st || st.act) return;
    var r = Math.random();
    st.act = r < 0.6 ? { anim: 'attack', t: 0, d: 0.62 } : { anim: 'victory', t: 0, d: 1.3 };
    snd(st.act.anim === 'attack' ? 'slash' : 'whoosh');
  }

  /* ============================================================================================
   * EKİPMAN screen
   * ========================================================================================== */
  var EQ = null;
  var LEFT = ['silah', 'kafa', 'yuz', 'boyun', 'omuz', 'gogus'], RIGHT = ['kol', 'eldiven', 'kemer', 'pantolon', 'dizlik', 'ayak'];
  var SORTS = [{ id: 'rar', n: 'Nadirlik' }, { id: 'lvl', n: 'Seviye' }, { id: 'slot', n: 'Yuva' }];
  var KSTATS = [{ k: 'atk', n: 'Saldırı', g: 'silah', c: '#FF7A5A' }, { k: 'hp', n: 'Can', g: 'heart', c: '#FF5C7A' },
    { k: 'def', n: 'Savunma', g: 'shield', c: '#6FB6FF' }, { k: 'crit', n: 'Kritik', g: 'crit', c: '#FFCB57' }];
  var UIS = { filter: 'all', sort: 'rar' };   // remembered between visits (session only)

  function eqMount(root, params) {
    params = params || {};
    root.classList.add('mt-scr', 'mt-eq');
    var slotBtn = function (id) {
      var sd = slotDef(id) || { n: id };
      return '<button class="mt-slot" type="button" data-slot="' + id + '" aria-label="' + esc(sd.n) + '">' +
        '<span class="mt-slot-cv"></span><span class="mt-slot-gl">' + gl(id) + '<em>' + esc(sd.n) + '</em></span>' +
        '<span class="lv"></span><b class="mt-sdot" hidden></b></button>';
    };
    root.innerHTML =
      '<div class="mt-stage">' +
        '<div class="mt-stage-cv"></div>' +
        '<button class="mt-hero-hit" type="button" aria-label="Kahraman"></button>' +
        '<div class="mt-pow"><i class="mt-pow-ic">' + ui('swords') + '</i><b class="num mt-pow-v">0</b><small>Savaş Gücü</small></div>' +
        '<div class="mt-hname"></div>' +
        '<div class="mt-col mt-col-l">' + LEFT.map(slotBtn).join('') + '</div>' +
        '<div class="mt-col mt-col-r">' + RIGHT.map(slotBtn).join('') + '</div>' +
        '<div class="mt-kstats">' + KSTATS.map(function (s) {
          return '<div class="mt-ks" data-k="' + s.k + '" style="--kc:' + s.c + '" title="' + esc(s.n) + '">' + gl(s.g) + '<b class="num">0</b></div>';
        }).join('') + '</div>' +
      '</div>' +
      '<div class="mt-setbar"><div class="mt-sets"></div><button class="mt-tb mt-bestb" type="button" aria-label="En iyisini kuşan">' + gl('up') + '<span>En İyi</span><b class="dot" hidden></b></button></div>' +
      '<div class="mt-bagbar">' +
        '<div class="mt-filters"></div>' +
        '<button class="mt-tb mt-sortb" type="button" aria-label="Sırala">' + gl('sort') + '<span></span></button>' +
        '<button class="mt-tb mt-mergeb" type="button">' + gl('anvil') + '<span>Birleştir</span><b class="dot" hidden></b></button>' +
      '</div>' +
      '<div class="mt-bag scroll"><div class="mt-grid"></div>' +
        '<div class="mt-bag-empty" hidden></div></div>' +
      '<div class="mt-mbar" hidden>' +
        '<div class="mt-mb-hint"></div>' +
        '<div class="mt-mb-row">' +
          '<div class="mt-mb-pick"><span class="mt-mb-s"></span><span class="mt-mb-s"></span><span class="mt-mb-s"></span>' +
          '<span class="mt-mb-arr">' + gl('back') + '</span><span class="mt-mb-res"><span class="mt-mb-q">?</span></span></div>' +
          '<div class="mt-mb-btns"><button class="btn btn-dark btn-sm mt-mb-auto" type="button">Otomatik</button>' +
          '<button class="btn btn-gold btn-sm mt-mb-go" type="button">' + gl('anvil') + 'Dövün</button></div>' +
        '</div>' +
        '<button class="mt-mb-x" type="button" aria-label="Birleştirmeden çık">' + gl('plus') + '</button>' +
      '</div>';

    EQ = {
      root: root, cvs: [], cells: {}, slots: {}, merge: null, rev: -2, first: true, mbCvs: [],
      grid: $('.mt-grid', root), bag: $('.mt-bag', root), filtersEl: $('.mt-filters', root), setsEl: $('.mt-sets', root),
      powEl: $('.mt-pow-v', root), mbar: $('.mt-mbar', root),
      st: { look: look(), rar: 0, k: 2, floorPad: 40, tint: '#3A0F24', face: 1, flash: 0, turnNext: 5 }
    };
    // stage canvas
    EQ.cvs.push(cvs($('.mt-stage-cv', root), function (ctx, w, h, t) { stageDraw(EQ.st, ctx, w, h, t); }));
    stageInput($('.mt-hero-hit', root), function () { return EQ && EQ.st; });
    // slots
    $$('.mt-slot', root).forEach(function (b) {
      var id = b.getAttribute('data-slot'), rec = { id: id, btn: b, item: null };
      EQ.slots[id] = rec;
      EQ.cvs.push(cvs($('.mt-slot-cv', b), function (ctx, w, h, t) {
        var it = rec.item; if (!it) return;
        var f = art('drawItemIcon'); if (f) f(ctx, 0, 0, mn(w, h), { slot: it.slot, rar: it.rar, set: it.set, wt: it.wt, skin: rec.skin }, t);
      }, { fps: 24 }));
      tap(b, function () { slotTap(id); });
    });
    // filters
    var fh = '<button class="mt-fc" type="button" data-f="all"><span>Tümü</span></button>';
    slots().forEach(function (sd) { fh += '<button class="mt-fc mt-fci" type="button" data-f="' + sd.id + '" aria-label="' + esc(sd.n) + '" title="' + esc(sd.n) + '">' + gl(sd.id) + '<b></b></button>'; });
    EQ.filtersEl.innerHTML = fh;
    $$('.mt-fc', EQ.filtersEl).forEach(function (b) {
      tap(b, function () { UIS.filter = b.getAttribute('data-f'); renderFilters(); renderBag(true); EQ.bag.scrollTop = 0; }, 'tab');
    });
    tap($('.mt-sortb', root), function () {
      var i = 0; SORTS.forEach(function (s, j) { if (s.id === UIS.sort) i = j; });
      UIS.sort = SORTS[(i + 1) % SORTS.length].id; renderSortBtn(); renderBag(true);
      toast('Sıralama: ' + SORTS[(i + 1) % SORTS.length].n, 'info');
    }, 'tab');
    tap($('.mt-mergeb', root), function () { if (EQ.merge) mergeExit(); else mergeEnter(null); });
    tap($('.mt-bestb', root), function () { if (EQ.merge) mergeExit(); bestEquip(); }, false);
    tap($('.mt-mb-x', root), function () { mergeExit(); });
    tap($('.mt-mb-auto', root), mergeAuto);
    tap($('.mt-mb-go', root), mergeGo, false);
    EQ.unsub = onChange(function () { EQ && (EQ.dirty = true); });
    EQ.unobs = observe(root, eqLayout);
    eqLayout();
    renderSortBtn();
    eqRefresh(true);
    if (params.merge) mergeEnter(params.merge === true ? null : params.merge);
    if (params.uid) setTimeout(function () { openItem(params.uid); }, 60);
  }
  function eqUnmount() {
    if (!EQ) return;
    stopAll(EQ.cvs); stopAll(EQ.mbCvs);
    for (var k in EQ.cells) if (EQ.cells[k].cv) safe(EQ.cells[k].cv.stop, 'stop');
    if (EQ.unsub) EQ.unsub();
    if (EQ.unobs) EQ.unobs();
    // items the player has now seen lose their "Yeni" marker
    var p = P();
    if (p && p.items && p.items.some(function (it) { return it.new; })) call('markSeen', 'all');
    EQ = null;
  }
  function eqFrame() { if (EQ && EQ.dirty) eqRefresh(false); }
  function eqLayout() {
    if (!EQ) return;
    var H = EQ.root.clientHeight || 600, W = EQ.root.clientWidth || 390;
    var stageH = round(clamp(H * 0.5, 250, 392));
    var gap = H < 640 ? 4 : 6;
    var slot = floor(clamp((stageH - 14 - gap * 5) / 6, 36, 60));
    EQ.root.style.setProperty('--mt-stage-h', stageH + 'px');
    EQ.root.style.setProperty('--mt-slot', slot + 'px');
    EQ.root.style.setProperty('--mt-sgap', gap + 'px');
    EQ.root.style.setProperty('--mt-cell', floor((W - 24 - 4 * 8) / 5) + 'px');
    var centerW = W - 2 * (slot + 16);
    var floorPad = 42;
    EQ.st.floorPad = floorPad;
    EQ.st.k = clamp(mn((stageH - floorPad - 78) / 108, centerW / 94), 1.2, 2.6);
  }

  /* ---------- data helpers ---------- */
  function slotSkin(it) {
    if (!it) return null;
    var tg = it.slot === 'silah' ? 'silah:' + it.wt : 'slot:' + it.slot;
    return call('skinFor', tg) || null;
  }
  function bagList() {
    var p = P(); if (!p || !p.items) return [];
    var arr = p.items.filter(function (it) { return it && p.equip[it.slot] !== it.uid; });
    if (UIS.filter !== 'all') arr = arr.filter(function (it) { return it.slot === UIS.filter; });
    var so = UIS.sort;
    arr.sort(function (a, b) {
      if (so === 'lvl') return (b.lvl - a.lvl) || (b.rar - a.rar) || (slotIndex(a.slot) - slotIndex(b.slot)) || (a.uid < b.uid ? -1 : 1);
      if (so === 'slot') return (slotIndex(a.slot) - slotIndex(b.slot)) || (b.rar - a.rar) || (b.lvl - a.lvl) || (a.uid < b.uid ? -1 : 1);
      return (b.rar - a.rar) || (slotIndex(a.slot) - slotIndex(b.slot)) || (b.lvl - a.lvl) || (a.uid < b.uid ? -1 : 1);
    });
    return arr;
  }
  function mergeKey(it) { return it.slot + '|' + it.rar + '|' + (it.slot === 'silah' ? it.wt : ''); }
  /* uid -> power gain if equipped (only items that would raise the active hero's power); cached per revision */
  var BETTER = { rev: -9, map: {} };
  function betterMap() {
    var r = rev();
    if (r === BETTER.rev && r !== -1) return BETTER.map;
    var p = P(), map = {}, base = power();
    if (p && p.items) p.items.forEach(function (it) {
      if (p.equip[it.slot] === it.uid) return;
      var v = call('powerIf', it.uid);
      if (typeof v === 'number' && v > base) map[it.uid] = v - base;
    });
    BETTER.rev = r; BETTER.map = map;
    return map;
  }
  function bestEquip() {
    var p = P(); if (!p) return;
    var before = power(), changed = [];
    var run = function () {
      slots().forEach(function (sd) {
        var cur = power(), best = null, bestPw = cur;
        p.items.forEach(function (it) {
          if (it.slot !== sd.id || p.equip[sd.id] === it.uid) return;
          var v = call('powerIf', it.uid);
          if (typeof v === 'number' && v > bestPw) { bestPw = v; best = it; }
        });
        if (best && call('equip', best.uid)) changed.push({ slot: sd.id, rar: best.rar });
      });
    };
    var st = S();
    if (st && typeof st.batch === 'function') { try { st.batch(run); } catch (e) { report(e, 'batch'); } } else run();
    if (!changed.length) { toast('En güçlü ekipman zaten kuşanılı', 'info'); return; }
    var after = power();
    snd('equip');
    toast(changed.length + ' eşya kuşanıldı · Savaş Gücü +' + fmt(after - before), 'ok');
    if (!EQ) return;
    eqRefresh(true);
    EQ.st.flash = 1.1; EQ.st.flashCol = '#7CF28A'; EQ.st.act = { anim: 'victory', t: 0, d: 1.2 };
    changed.forEach(function (c, i) {
      setTimeout(function () {
        if (!EQ) return; var rec = EQ.slots[c.slot]; if (!rec) return;
        restart(rec.btn, 'mt-pop'); burst(rec.btn, { col: rarOf(c.rar).col, n: 14, speed: 130 });
        snd('click', { pitch: 1 + i * 0.1 });
      }, 90 * i);
    });
    floatNum(EQ.powEl, '+' + fmt(after - before), '#5BD16E');
  }
  function mergeCounts() {
    var p = P(), c = {}; if (!p) return c;
    p.items.forEach(function (it) { if (it.rar < maxRar() && p.equip[it.slot] !== it.uid) c[mergeKey(it)] = (c[mergeKey(it)] || 0) + 1; });
    return c;
  }

  /* ---------- refresh ---------- */
  function eqRefresh(force) {
    if (!EQ) return;
    var r = rev();
    if (!force && r === EQ.rev && r !== -1) { EQ.dirty = false; return; }
    EQ.rev = r; EQ.dirty = false;
    EQ.st.look = look();
    var hs = heroDef(activeId());
    setHTML($('.mt-hname', EQ.root), hs ? '<b>' + esc(hs.n) + '</b><span>' + esc(hs.cls || '') + '</span>' : '');
    renderSlots(); renderStats(); renderSets(); renderFilters(); renderBag(false); renderMergeBar();
    var mb = $('.mt-mergeb .dot', EQ.root), groups = call('mergeGroups');
    if (mb) mb.hidden = !(groups && groups.length) || !!EQ.merge;
    var bd = $('.mt-bestb .dot', EQ.root); if (bd) bd.hidden = !Object.keys(betterMap()).length;
    EQ.first = false;
  }
  function renderSlots() {
    var best = 0;
    slots().forEach(function (sd) {
      var rec = EQ.slots[sd.id]; if (!rec) return;
      var it = equippedItem(sd.id), b = rec.btn;
      var was = rec.item ? rec.item.uid + '|' + rec.item.rar : '', now2 = it ? it.uid + '|' + it.rar : '';
      rec.item = it; rec.skin = slotSkin(it);
      b.className = 'mt-slot' + (it ? ' rf rf' + it.rar : ' mt-empty');
      setText($('.lv', b), it ? 'Sv.' + it.lvl : '');
      var up = it ? call('canUpgrade', it) : null;
      $('.mt-sdot', b).hidden = !(up && up.ok);
      if (it && it.rar > best) best = it.rar;
      if (was !== now2 && !EQ.first && it) { restart(b, 'mt-pop'); }
    });
    EQ.st.rar = best;
  }
  function renderStats() {
    var sh = stats(), pw = power();
    tweenTo(EQ.powEl, pw, fmt, 700);
    KSTATS.forEach(function (s) {
      var el = $('.mt-ks[data-k="' + s.k + '"] b', EQ.root); if (!el || !sh) return;
      var v = sh[s.k] || 0;
      if (s.k === 'crit') tweenTo(el, v * 100, function (x) { return '%' + fmtD(x, 1); }, 600);
      else tweenTo(el, v, fmt, 600);
    });
  }
  function renderSets() {
    var list = call('setBonuses') || [], el = EQ.setsEl;
    var key = JSON.stringify(list.map(function (s) { return [s.id, s.count]; }));
    if (el.__k === key) return; el.__k = key;
    if (!list.length) { el.innerHTML = '<div class="mt-set-hint">' + gl('info') + 'Aynı setten 4 ve 8 zırh parçası kuşan: set bonusu açılır.</div>'; return; }
    el.innerHTML = list.map(function (s) {
      var tiers = (s.tiers || []).map(function (ti) { return '<i class="' + (ti.on ? 'on' : '') + '">' + ti.need + '</i>'; }).join('');
      var on = (s.tiers || []).some(function (ti) { return ti.on; });
      return '<button class="mt-set' + (on ? ' on' : '') + '" type="button" data-set="' + s.id + '" style="--sc:' + setCol(s.id) + '">' +
        '<span class="mt-set-n">' + esc(s.n) + '</span><b class="num">' + s.count + '/8</b><span class="mt-tiers">' + tiers + '</span></button>';
    }).join('');
    $$('.mt-set', el).forEach(function (b) { tap(b, function () { openSet(b.getAttribute('data-set')); }, 'open'); });
  }
  function renderFilters() {
    var p = P(), cnt = {}; if (!p) return;
    p.items.forEach(function (it) { if (p.equip[it.slot] !== it.uid) cnt[it.slot] = (cnt[it.slot] || 0) + 1; });
    $$('.mt-fc', EQ.filtersEl).forEach(function (b) {
      var f = b.getAttribute('data-f');
      tog(b, 'on', f === UIS.filter);
      if (f !== 'all') { tog(b, 'zero', !cnt[f]); setText($('b', b), cnt[f] ? cnt[f] : ''); }
    });
  }
  function renderSortBtn() { var s = SORTS.filter(function (x) { return x.id === UIS.sort; })[0] || SORTS[0]; setText($('.mt-sortb span', EQ.root), s.n); }

  function makeCell(it) {
    var b = mk('button', 'mt-cell rf rf' + it.rar);
    b.type = 'button';
    b.innerHTML = '<span class="mt-cell-cv"></span><span class="lv"></span><span class="new" hidden>Yeni</span>' +
      '<i class="mt-better" hidden>' + gl('up') + '</i><i class="mt-m3" hidden>' + gl('anvil') + '</i><i class="mt-ck" hidden>' + gl('check') + '</i>';
    var c = { el: b, uid: it.uid, item: it };
    c.cv = iconCv($('.mt-cell-cv', b), function () { var x = c.item; return x ? { slot: x.slot, rar: x.rar, set: x.set, wt: x.wt, skin: slotSkin(x) } : null; });
    tap(b, function () { cellTap(c.uid, b); }, false);
    return c;
  }
  function renderBag(force) {
    if (!EQ) return;
    var items = bagList(), grid = EQ.grid, keep = {}, mc = mergeCounts(), better = betterMap();
    var M = EQ.merge, base = M && M.sel.length ? getItem(M.sel[0]) : null, bkey = base ? mergeKey(base) : null;
    var stagger = 0;
    items.forEach(function (it, idx) {
      var key = it.uid + '|' + it.rar, c = EQ.cells[key];
      if (!c) {
        c = makeCell(it); EQ.cells[key] = c;
        if (!RM) { c.el.classList.add('mt-in'); c.el.style.animationDelay = mn(stagger++ * 0.025, 0.4) + 's'; }
      }
      c.item = it; keep[key] = 1;
      var b = c.el;
      setText($('.lv', b), 'Sv.' + it.lvl);
      $('.new', b).hidden = !it.new;
      $('.mt-better', b).hidden = !better[it.uid] || !!M;
      var canM = it.rar < maxRar() && (mc[mergeKey(it)] || 0) >= 3;
      $('.mt-m3', b).hidden = !canM || !!M;
      var sel = M ? M.sel.indexOf(it.uid) >= 0 : false;
      $('.mt-ck', b).hidden = !sel;
      tog(b, 'mt-sel', sel);
      var dim = false, cand = false;
      if (M) {
        if (!base) dim = !(it.rar < maxRar() && (mc[mergeKey(it)] || 0) >= 3);
        else { cand = !sel && mergeKey(it) === bkey; dim = !sel && !cand; }
      }
      tog(b, 'mt-dim', dim); tog(b, 'mt-cand', cand && M.sel.length < 3);
      if (grid.children[idx] !== b) grid.insertBefore(b, grid.children[idx] || null);
    });
    for (var k in EQ.cells) if (!keep[k]) {
      var c2 = EQ.cells[k];
      if (c2.el.parentNode) c2.el.parentNode.removeChild(c2.el);
      if (c2.cv) safe(c2.cv.stop, 'stop');
      delete EQ.cells[k];
    }
    var em = $('.mt-bag-empty', EQ.root);
    em.hidden = items.length > 0;
    if (!items.length) {
      setHTML(em, gl('anvil') + '<b>' + (UIS.filter === 'all' ? 'Çanta boş' : 'Bu yuvada eşya yok') + '</b><span>' +
        (UIS.filter === 'all' ? 'Savaşlardan, Metin taşlarından ve sandıklardan ekipman düşer.' : 'Başka bir yuva seç ya da savaşa gidip ganimet topla.') + '</span>');
    }
  }

  /* ---------- interactions ---------- */
  function slotTap(id) {
    var rec = EQ && EQ.slots[id]; if (!rec) return;
    if (EQ.merge) { if (rec.item) mergePick(rec.item.uid); return; }
    if (rec.item) { openItem(rec.item.uid); return; }
    var p = P(), has = p && p.items.some(function (it) { return it.slot === id && p.equip[id] !== it.uid; });
    UIS.filter = id; renderFilters(); renderBag(true); EQ.bag.scrollTop = 0;
    restart(EQ.bag, 'mt-flash');
    var sd = slotDef(id);
    if (!has) toast((sd ? sd.n : 'Bu yuva') + ' için çantada eşya yok', 'info');
  }
  function cellTap(uid, el) {
    if (EQ && EQ.merge) { mergePick(uid, el); return; }
    snd('open');
    openItem(uid);
  }
  /* equip + juice (slot pop, hero flash, power float) */
  function doEquip(uid) {
    var it = getItem(uid); if (!it) return false;
    var before = power();
    if (!call('equip', uid)) { toast('Kuşanılamadı', 'warn'); return false; }
    snd('equip');
    var after = power();
    if (EQ) {
      eqRefresh(true);
      EQ.st.flash = 1; EQ.st.flashCol = rarOf(it.rar).col;
      if (!EQ.st.act) EQ.st.act = { anim: 'victory', t: 0, d: 1.1 };
      var rec = EQ.slots[it.slot];
      if (rec) { restart(rec.btn, 'mt-pop'); burst(rec.btn, { col: rarOf(it.rar).col, n: 16 + it.rar * 4, speed: 140 }); }
      if (after !== before) floatNum(EQ.powEl, (after > before ? '+' : '−') + fmt(abs(after - before)), after > before ? '#5BD16E' : '#E8394D');
    }
    return true;
  }
  function doUnequip(slot) {
    var before = power();
    if (!call('unequip', slot)) return false;
    snd('unequip');
    var after = power();
    if (EQ) {
      eqRefresh(true);
      if (after !== before) floatNum(EQ.powEl, '−' + fmt(abs(after - before)), '#E8394D');
      var rec = EQ.slots[slot]; if (rec) restart(rec.btn, 'mt-pop');
    }
    return true;
  }

  /* ---------- set info ---------- */
  function openSet(id) {
    var sd = setDef(id); if (!sd) return;
    var list = call('setBonuses') || [], cnt = 0;
    list.forEach(function (s) { if (s.id === id) cnt = s.count; });
    var pieces = slots().filter(function (s) { return s.id !== 'silah'; }).map(function (s) {
      var e = equippedItem(s.id), on = !!(e && e.set === id);
      return '<span class="mt-sp' + (on ? ' on' : '') + '" title="' + esc(s.n) + '">' + gl(s.id) + '</span>';
    }).join('');
    var tiers = Object.keys(sd.bonus || {}).sort(function (a, b) { return a - b; }).map(function (need) {
      var eff = sd.bonus[need], on = cnt >= +need;
      return '<div class="mt-tier' + (on ? ' on' : '') + '"><b>' + need + ' parça</b><span>' + Object.keys(eff).map(function (k) { return esc(statN(k)) + ' <em>' + svs(k, eff[k]) + '</em>'; }).join(' · ') + '</span>' + (on ? gl('check') : gl('lock')) + '</div>';
    }).join('');
    var html = '<div class="mt-setm" style="--sc:' + setCol(id) + '"><div class="mt-setm-h"><span class="mt-setm-gem"></span><div><div class="ttl mt-setm-n">' + esc(sd.n) + '</div>' +
      '<small>' + esc(sd.lore || 'Set parçaları zırh yuvalarında sayılır.') + '</small></div></div>' +
      '<div class="mt-setm-c"><b class="num">' + cnt + '</b>/8 parça kuşanılı</div><div class="mt-sps">' + pieces + '</div>' + tiers + '</div>';
    modal(html, { cls: 'mt-modal mt-setmodal' });
  }

  /* ============================================================================================
   * Merge mode (pick 3 identical → forge)
   * ========================================================================================== */
  function mergeEnter(uid) {
    if (!EQ) { go('ekipman', { merge: uid || true }); return; }
    EQ.merge = { sel: [] };
    EQ.root.classList.add('mt-merging');
    if (uid) {
      var it = getItem(uid);
      if (it && it.rar < maxRar()) { EQ.merge.sel = [uid]; UIS.filter = it.slot; }
    }
    snd('open');
    renderFilters(); renderBag(true); renderMergeBar();
    var mb = $('.mt-mergeb .dot', EQ.root); if (mb) mb.hidden = true;
  }
  function mergeExit() {
    if (!EQ || !EQ.merge) return;
    EQ.merge = null;
    EQ.root.classList.remove('mt-merging');
    renderBag(true); renderMergeBar(); eqRefresh(true);
  }
  function mergePick(uid, el) {
    var M = EQ && EQ.merge; if (!M) return;
    var it = getItem(uid); if (!it) return;
    var i = M.sel.indexOf(uid);
    if (i >= 0) { M.sel.splice(i, 1); snd('click'); }
    else {
      if (it.rar >= maxRar()) { toast('Mitik eşyalar daha fazla birleştirilemez', 'info'); return; }
      if (!M.sel.length) {
        var cands = call('mergeCandidates', uid) || [];
        if (cands.length < 2) { toast('Birleştirmek için aynı eşyadan 3 tane gerekir', 'warn'); if (el) restart(el, 'mt-shake'); return; }
        M.sel.push(uid);
      } else {
        var base = getItem(M.sel[0]);
        if (!base || mergeKey(it) !== mergeKey(base)) { toast('Aynı yuva, aynı nadirlik' + (it.slot === 'silah' ? ' ve aynı silah türü' : '') + ' olmalı', 'warn'); if (el) restart(el, 'mt-shake'); return; }
        if (M.sel.length >= 3) { toast('Zaten 3 eşya seçildi', 'info'); return; }
        if (isEquipped(it) && M.sel.some(function (u) { return isEquipped(getItem(u)); })) { toast('Kuşanılı yalnızca bir eşya olabilir', 'warn'); return; }
        M.sel.push(uid);
      }
      snd('click', { pitch: 1 + M.sel.length * 0.12 });
      if (el) burst(el, { col: rarOf(it.rar).col, n: 8, speed: 90, ring: true });
    }
    renderBag(true); renderMergeBar();
  }
  function mergeAuto() {
    if (!EQ || !EQ.merge) return;
    var groups = call('mergeGroups') || [];
    if (!groups.length) { toast('Birleştirilecek 3 aynı eşya yok', 'info'); return; }
    var M = EQ.merge, base = M.sel.length ? getItem(M.sel[0]) : null, pick = null;
    groups.forEach(function (g) {
      if (pick) return;
      var a = getItem(g[0]); if (!a) return;
      if (base) { if (mergeKey(a) === mergeKey(base)) pick = g; }
      else if (UIS.filter === 'all' || a.slot === UIS.filter) pick = g;
    });
    if (!pick && base) {
      // base may be equipped: complete it with candidates from the bag
      var c = call('mergeCandidates', base.uid) || [];
      if (c.length >= 2) pick = [base.uid, c[0], c[1]];
    }
    if (!pick) pick = groups[0];
    M.sel = pick.slice(0, 3);
    var f = getItem(M.sel[0]); if (f && UIS.filter !== 'all' && f.slot !== UIS.filter) UIS.filter = f.slot;
    snd('click');
    renderFilters(); renderBag(true); renderMergeBar();
  }
  function renderMergeBar() {
    if (!EQ) return;
    var M = EQ.merge, bar = EQ.mbar;
    bar.hidden = !M;
    tog($('.mt-mergeb', EQ.root), 'on', !!M);
    if (!M) { stopAll(EQ.mbCvs); bar.__k = ''; return; }
    M.sel = M.sel.filter(function (u) { return !!getItem(u); });
    var base = M.sel.length ? getItem(M.sel[0]) : null, n = M.sel.length;
    setText($('.mt-mb-hint', bar), !n ? 'Birleştirmek için bir eşya seç: aynı yuva ve nadirlikten 3 adet.' :
      n < 3 ? 'Aynı eşyadan ' + (3 - n) + ' tane daha seç.' : 'Hazır! ' + rarOf(base.rar).n + ' → ' + rarOf(base.rar + 1).n);
    var key = M.sel.join(',');
    if (bar.__k !== key) {
      bar.__k = key;
      stopAll(EQ.mbCvs);
      $$('.mt-mb-s', bar).forEach(function (s, i) {
        s.innerHTML = ''; s.className = 'mt-mb-s';
        var it = getItem(M.sel[i]);
        if (it) { s.className = 'mt-mb-s rf rf' + it.rar; iconCv(s, function () { return { slot: it.slot, rar: it.rar, set: it.set, wt: it.wt }; }, EQ.mbCvs); restart(s, 'mt-pop'); }
      });
      var res = $('.mt-mb-res', bar);
      res.innerHTML = '';
      if (base) {
        var nr = mn(base.rar + 1, maxRar());
        res.className = 'mt-mb-res rf rf' + nr + (n === 3 ? ' ready' : '');
        iconCv(res, function () { return { slot: base.slot, rar: nr, set: base.set, wt: base.wt }; }, EQ.mbCvs, true);
        res.insertAdjacentHTML('beforeend', '<span class="mt-mb-rn" style="color:' + rarOf(nr).col + '">' + esc(rarOf(nr).n) + '</span>');
      } else { res.className = 'mt-mb-res'; res.innerHTML = '<span class="mt-mb-q">?</span>'; }
    }
    var gob = $('.mt-mb-go', bar);
    tog(gob, 'off', n !== 3); tog(gob, 'mt-ready', n === 3);
    requestAnimationFrame(mergeReveal);
  }
  /* keep the picked cells visible above the merge bar */
  function mergeReveal() {
    if (!EQ || !EQ.merge || !EQ.merge.sel.length) return;
    var top = EQ.mbar.getBoundingClientRect().top - 8, br = EQ.bag.getBoundingClientRect(), low = null;
    $$('.mt-cell.mt-sel', EQ.grid).forEach(function (c) { var r = c.getBoundingClientRect(); if (!low || r.bottom > low.bottom) low = r; });
    if (!low) return;
    if (low.bottom > top) EQ.bag.scrollBy({ top: low.bottom - top, behavior: RM ? 'auto' : 'smooth' });
    else if (low.top < br.top) EQ.bag.scrollBy({ top: low.top - br.top - 6, behavior: RM ? 'auto' : 'smooth' });
  }
  function mergeGo() {
    var M = EQ && EQ.merge;
    if (!M || M.sel.length !== 3) { snd('error'); toast('Önce aynı eşyadan 3 tane seç', 'warn'); return; }
    var items = M.sel.map(getItem);
    if (items.some(function (x) { return !x; })) { M.sel = []; renderMergeBar(); renderBag(true); return; }
    var srcEls = $$('.mt-mb-s', EQ.mbar);
    var rects = srcEls.map(function (e) { return relPt(e); });
    var seeds = items.map(function (x) { return { slot: x.slot, rar: x.rar, set: x.set, wt: x.wt }; });
    var fromRar = items[0].rar;
    var before = {}; items.forEach(function (x) { (x.subs || []).forEach(function (s) { before[s.k] = 1; }); });
    var baseSubs = {}; ((items.filter(isEquipped)[0] || items[0]).subs || []).forEach(function (s) { baseSubs[s.k] = 1; });
    var res = call('merge', M.sel.slice());
    if (!res) { snd('error'); toast('Birleştirme başarısız', 'warn'); return; }
    var added = (res.subs || []).filter(function (s) { return !baseSubs[s.k]; });
    M.sel = [];
    forge({ seeds: seeds, rects: rects, fromRar: fromRar, item: res, added: added });
    renderMergeBar();
  }

  /* ============================================================================================
   * Forge overlay: items fly into the anvil, three hammer strikes (flash + sparks), then a beam
   * reveals the new rarity.
   * ========================================================================================== */
  function drawAnvil(c, x, y, s, heat) {
    c.save(); c.translate(x, y); c.scale(s, s);
    c.lineJoin = 'round';
    c.beginPath();
    c.moveTo(-62, 0); c.lineTo(52, 0); c.lineTo(58, 6); c.lineTo(58, 14); c.lineTo(34, 18);
    c.quadraticCurveTo(22, 26, 24, 40); c.lineTo(46, 58); c.lineTo(46, 68); c.lineTo(-46, 68); c.lineTo(-46, 58); c.lineTo(-24, 40);
    c.quadraticCurveTo(-22, 26, -36, 18); c.quadraticCurveTo(-78, 16, -104, 4); c.quadraticCurveTo(-84, 0, -62, 0); c.closePath();
    var g = c.createLinearGradient(0, 0, 0, 68);
    g.addColorStop(0, '#5A5068'); g.addColorStop(0.25, '#2E2738'); g.addColorStop(1, '#14101B');
    c.fillStyle = g; c.fill();
    c.lineWidth = 3.4; c.strokeStyle = '#120C18'; c.stroke();
    c.globalCompositeOperation = 'lighter';
    var hg = c.createLinearGradient(-60, 0, 56, 0);
    hg.addColorStop(0, rgba('#FF7A2F', 0)); hg.addColorStop(0.5, rgba('#FFB050', 0.5 * heat + 0.15)); hg.addColorStop(1, rgba('#FF7A2F', 0));
    c.fillStyle = hg; c.fillRect(-60, -1, 116, 6);
    c.globalCompositeOperation = 'source-over';
    c.strokeStyle = 'rgba(255,255,255,0.22)'; c.lineWidth = 2; c.beginPath(); c.moveTo(-58, 3); c.lineTo(48, 3); c.stroke();
    c.strokeStyle = 'rgba(255,203,87,0.4)'; c.lineWidth = 1.5; c.beginPath(); c.moveTo(-40, 60); c.lineTo(40, 60); c.stroke();
    c.restore();
  }
  function drawHammer(c, px, py, ang, s) {
    c.save(); c.translate(px, py); c.rotate(ang); c.scale(s, s);
    c.lineJoin = 'round';
    c.fillStyle = '#6B4426'; c.strokeStyle = '#120C18'; c.lineWidth = 3;
    c.beginPath(); c.rect(0, -4.5, 92, 9); c.fill(); c.stroke();
    c.fillStyle = '#FFCB57'; c.fillRect(10, -4.5, 6, 9); c.fillRect(70, -4.5, 5, 9);
    var g = c.createLinearGradient(0, -24, 0, 24);
    g.addColorStop(0, '#8C8698'); g.addColorStop(0.5, '#4A4356'); g.addColorStop(1, '#221C2B');
    c.fillStyle = g; c.beginPath(); c.rect(84, -24, 26, 48); c.fill(); c.stroke();
    c.fillStyle = 'rgba(255,255,255,0.3)'; c.fillRect(87, -21, 4, 42);
    c.restore();
  }
  function forge(o) {
    var L = layerEl(); if (!L) return;
    var R = rootEl(), W = R ? R.clientWidth : 390, H = R ? R.clientHeight : 844;
    var toRar = o.item.rar, fromRar = o.fromRar, tc = rarOf(toRar).col, fc = rarOf(fromRar).col;
    var ov = mk('div', 'mt-forge');
    ov.innerHTML = '<div class="mt-forge-cv"></div>' +
      '<div class="mt-forge-res" hidden>' +
        '<div class="mt-forge-rar" style="--rc:' + tc + '">' + esc(rarOf(toRar).n) + '!</div>' +
        '<div class="mt-forge-name" style="color:' + tc + '">' + esc(itemName(o.item)) + '</div>' +
        '<div class="mt-forge-sub">' + (o.added.length ? o.added.map(function (s) { return '<span>' + gl('plus') + 'Yeni özellik: ' + esc(statN(s.k)) + ' <b>' + svs(s.k, s.v) + '</b></span>'; }).join('') :
          '<span>Ana özellik ×' + fmtD(rarOf(toRar).mult / mx(0.01, rarOf(fromRar).mult), 2) + ' · En yüksek seviye ' + rarOf(toRar).maxLv + '</span>') + '</div>' +
        '<div class="mt-row"><button class="btn btn-dark mt-forge-see" type="button">İncele</button><button class="btn btn-gold mt-forge-ok" type="button">Harika!</button></div>' +
      '</div><div class="mt-forge-skip">Geçmek için dokun</div>';
    L.appendChild(ov);
    var F = { t0: -1, strikes: [0.85, 1.2, 1.55], hit: -1, sparks: [], revealT: 2.15, revealed: false, shake: 0, flash: 0, done: false };
    var cvRec = null;
    function reveal() {
      if (F.revealed) return; F.revealed = true;
      snd('merge');
      snd(toRar >= 4 ? 'legendary' : toRar >= 3 ? 'rare' : 'reward');
      var res = $('.mt-forge-res', ov); res.hidden = false;
      $('.mt-forge-skip', ov).hidden = true;
      burst({ x: W / 2, y: H * 0.42 }, { col: tc, n: 40 + toRar * 8, speed: 260, up: 40, size: 9, ringK: 3 });
    }
    function finish(openAfter) {
      if (F.done) return; F.done = true;
      document.removeEventListener('keydown', onKey, true);
      ov.classList.add('mt-out');
      setTimeout(function () { if (cvRec) cvRec.stop(); if (ov.parentNode) ov.parentNode.removeChild(ov); }, 260);
      if (EQ) {
        eqRefresh(true);
        var groups = call('mergeGroups') || [];
        if (!groups.length && EQ.merge) mergeExit();
      }
      if (openAfter) setTimeout(function () { openItem(o.item.uid); }, 120);
    }
    ov.addEventListener('click', function (e) {
      if (!F.revealed && F.t0 >= 0) { F.skip = true; return; }
      if (e.target === ov || e.target.closest('.mt-forge-cv')) return;
    });
    var onKey = function (e) {
      if (e.key !== 'Escape' && e.key !== 'Enter' && e.key !== ' ') return;
      e.stopPropagation(); e.preventDefault();
      if (!F.revealed) F.skip = true; else finish(false);
    };
    document.addEventListener('keydown', onKey, true);
    tap($('.mt-forge-ok', ov), function () { finish(false); });
    tap($('.mt-forge-see', ov), function () { finish(true); });
    snd('whoosh');
    cvRec = cvs($('.mt-forge-cv', ov), function (c, w, h, t) {
      if (F.t0 < 0) F.t0 = t;
      if (F.skip && !F.revealed) { F.t0 = t - F.revealT; F.skip = false; }
      var T = t - F.t0, dt = F.lt ? clamp(t - F.lt, 0, 0.05) : 0.016; F.lt = t;
      var ax = w / 2, ay = h * 0.6, s = clamp(w / 360, 0.8, 1.25);
      // strikes
      for (var i = 0; i < F.strikes.length; i++) {
        if (F.hit < i && T >= F.strikes[i] && !F.revealed) {
          F.hit = i; F.flash = 0.75; F.shake = RM ? 0 : 7;
          snd('hit', { pitch: 0.8 + i * 0.12 }); snd('upgrade', { pitch: 0.7 + i * 0.15, vol: 0.6 });
          for (var k = 0; k < (RM ? 10 : 34); k++) {
            var a = -PI / 2 + (Math.random() - 0.5) * 2.6, v = 160 + Math.random() * 320;
            F.sparks.push({ x: ax + (Math.random() - 0.5) * 30 * s, y: ay - 6 * s, vx: cos(a) * v, vy: sin(a) * v, age: 0, life: 0.5 + Math.random() * 0.6, col: Math.random() < 0.3 ? lerpCol(fc, tc, i / 2) : (Math.random() < 0.5 ? '#FFB050' : '#FFE9A3') });
          }
        }
      }
      if (T >= F.revealT && !F.revealed) reveal();
      F.flash = mx(0, F.flash - dt * 2.4); F.shake = mx(0, F.shake - dt * 30);
      var shx = F.shake ? (Math.random() - 0.5) * F.shake : 0, shy = F.shake ? (Math.random() - 0.5) * F.shake : 0;
      c.save(); c.translate(shx, shy);
      // forge glow
      c.globalCompositeOperation = 'lighter';
      var heat = clamp((F.hit + 1) / 3, 0, 1);
      c.globalAlpha = 0.35 + heat * 0.4 + 0.08 * sin(T * 9);
      c.drawImage(softSpr('#FF7A2F'), ax - 180 * s, ay - 120 * s, 360 * s, 240 * s);
      c.globalCompositeOperation = 'source-over'; c.globalAlpha = 1;
      // anvil rises in
      var rise = eOut(T / 0.4), sink = F.revealed ? eIn((T - F.revealT) / 0.45) : 0;
      if (sink < 1) { c.globalAlpha = 1 - sink; drawAnvil(c, ax + 6 * s, ay + (1 - rise) * 160 + sink * 70, s * 1.1, heat + F.flash); c.globalAlpha = 1; }
      // flying items → orb
      var orbCol = lerpCol(fc, tc, heat);
      var gather = clamp((T - 0.15) / 0.6, 0, 1);
      if (gather < 1) {
        var di = art('drawItemIcon');
        o.rects.forEach(function (r, j) {
          var k2 = eIn(clamp(gather * 1.15 - j * 0.07, 0, 1));
          var cx2 = lerp(r.x, ax, k2), cy2 = lerp(r.y, ay - 34 * s, k2) - sin(k2 * PI) * 90 * s;
          var sz = lerp(r.w || 48, 26 * s, k2);
          c.save(); c.translate(cx2, cy2); c.rotate(k2 * (j - 1) * 2.4);
          if (di) di(c, -sz / 2, -sz / 2, sz, o.seeds[j], t);
          c.restore();
        });
      } else if (!F.revealed) {
        var pr = 18 * s + heat * 14 * s + sin(T * (10 + heat * 16)) * 3 * s;
        c.globalCompositeOperation = 'lighter';
        c.globalAlpha = 0.95; c.drawImage(glowSpr(orbCol), ax - pr * 2, ay - 34 * s - pr * 2, pr * 4, pr * 4);
        c.globalAlpha = 0.5; c.drawImage(softSpr(orbCol), ax - pr * 5, ay - 34 * s - pr * 5, pr * 10, pr * 10);
        c.globalCompositeOperation = 'source-over'; c.globalAlpha = 1;
      }
      // hammer
      if (!F.revealed) {
        var RA = PI + 1.3, SA = PI, ang = RA + 0.07 * sin(T * 4);
        for (var q = 0; q < F.strikes.length; q++) {
          var d = T - F.strikes[q];
          if (d > -0.16 && d <= 0) ang = lerp(RA, SA, eIn((d + 0.16) / 0.16));
          else if (d > 0 && d < 0.24) ang = lerp(SA, RA, eOut(d / 0.24));
        }
        var hIn = eOut((T - 0.1) / 0.4);
        c.globalAlpha = clamp(hIn, 0, 1);
        drawHammer(c, ax + 112 * s + (1 - hIn) * 80, ay - 25 * s, ang, s);
        c.globalAlpha = 1;
      }
      // sparks
      c.globalCompositeOperation = 'lighter';
      for (var m = F.sparks.length - 1; m >= 0; m--) {
        var p = F.sparks[m]; p.age += dt;
        if (p.age > p.life) { F.sparks.splice(m, 1); continue; }
        p.vy += 620 * dt; p.x += p.vx * dt; p.y += p.vy * dt;
        var al = 1 - p.age / p.life;
        c.globalAlpha = al; c.strokeStyle = p.col; c.lineWidth = 2.2 * al + 0.6;
        c.beginPath(); c.moveTo(p.x, p.y); c.lineTo(p.x - p.vx * 0.03, p.y - p.vy * 0.03); c.stroke();
      }
      // reveal: rays + beam + icon
      if (F.revealed) {
        var rk = clamp((T - F.revealT) / 0.5, 0, 1), cy = h * 0.42;
        c.globalAlpha = 0.55 * rk; c.drawImage(beamSpr(tc), ax - 90 * s, -h * 0.1, 180 * s, ay + h * 0.1);
        c.save(); c.translate(ax, cy); c.rotate(RM ? 0 : T * 0.3);
        var rgr = c.createRadialGradient(0, 0, 30 * s, 0, 0, 250 * s);
        rgr.addColorStop(0, rgba(tc, 0.5)); rgr.addColorStop(0.5, rgba(tc, 0.16)); rgr.addColorStop(1, rgba(tc, 0));
        c.globalAlpha = rk; c.fillStyle = rgr;
        for (var r2 = 0; r2 < 16; r2++) { c.rotate(TAU / 16); var rw = (r2 % 2 ? 9 : 18) * s; c.beginPath(); c.moveTo(-2, 0); c.lineTo(2, 0); c.lineTo(rw, -250 * s); c.lineTo(-rw, -250 * s); c.closePath(); c.fill(); }
        c.restore();
        c.globalAlpha = 0.8 * rk; var gs = 220 * s; c.drawImage(softSpr(tc), ax - gs / 2, cy - gs / 2, gs, gs);
        c.globalCompositeOperation = 'source-over'; c.globalAlpha = 1;
        var isz = 112 * s * eBack(rk), dI = art('drawItemIcon');
        if (dI && isz > 2) dI(c, ax - isz / 2, cy - isz / 2 + sin(T * 2) * 3, isz, { slot: o.item.slot, rar: toRar, set: o.item.set, wt: o.item.wt }, t);
      }
      c.globalCompositeOperation = 'source-over'; c.globalAlpha = 1;
      c.restore();
      if (F.flash > 0) {
        c.globalCompositeOperation = 'lighter'; c.globalAlpha = F.flash * (RM ? 0.25 : 0.42);
        c.drawImage(softSpr('#FFB060'), ax - w, ay - h * 0.8, w * 2, h * 1.4);
        c.globalAlpha = F.flash * 0.18; c.fillStyle = '#FF9A4A'; c.fillRect(0, 0, w, h);
        c.globalAlpha = 1; c.globalCompositeOperation = 'source-over';
      }
    });
  }
  function lerpCol(a, b, k) { return mixHex(a, b, clamp(k, 0, 1)); }

  /* ============================================================================================
   * Item detail modal
   * ========================================================================================== */
  var ID = null;
  function closeItem() { if (ID && ID.m) ID.m.close(); }
  function openItem(uid) {
    var it = getItem(uid);
    if (!it) { toast('Eşya bulunamadı', 'warn'); return; }
    if (ID) closeItem();
    if (it.new) call('markSeen', uid);
    var el = mk('div', 'mt-id');
    el.innerHTML =
      '<div class="mt-id-top">' +
        '<div class="mt-id-ic"><span class="mt-id-rays"></span><span class="mt-id-frame rf"><span class="mt-id-cv"></span></span><span class="mt-id-eq" hidden>Kuşanılı</span></div>' +
        '<div class="mt-id-hd"><div class="mt-id-n"></div><div class="mt-id-tags"></div>' +
          '<div class="mt-id-lv"><div class="mt-id-lvt">Seviye <b class="num"></b><i></i></div><div class="pbar"><i></i></div></div>' +
          '<div class="mt-id-pw">' + ui('swords') + '<span>Eşya Gücü</span><b class="num"></b></div></div>' +
      '</div>' +
      '<div class="mt-id-main"><span class="mt-id-mk"></span><span class="mt-id-mn"></span><b class="num mt-id-mv"></b><span class="mt-id-mnx"></span></div>' +
      '<div class="mt-id-sec mt-id-subs"><h4>Ek Özellikler</h4><div class="mt-id-sl"></div></div>' +
      '<div class="mt-id-sec mt-id-set"></div>' +
      '<div class="mt-id-sec mt-id-cmp"></div>' +
      '<div class="mt-id-acts">' +
        '<div class="mt-row mt-row3"><button class="btn btn-dark btn-sm mt-id-skin" type="button">' + gl('brush') + '<span>Görünüm</span></button>' +
        '<button class="btn btn-dark btn-sm mt-id-merge" type="button">' + gl('anvil') + '<span>Birleştir</span></button>' +
        '<button class="btn btn-dark btn-sm mt-id-sell" type="button">' + gl('sell') + '<span>Sat</span></button></div>' +
        '<div class="mt-row"><button class="btn mt-id-eqb" type="button"></button>' +
        '<button class="btn btn-gold mt-id-up" type="button"><span class="mt-up-t">Yükselt</span><span class="mt-up-c"></span></button></div>' +
        '<div class="mt-id-own"></div>' +
      '</div>';
    ID = { uid: uid, el: el, cvs: [] };
    var me = ID;
    ID.m = modal(el, { cls: 'mt-modal mt-idm', onClose: function () { stopAll(me.cvs); if (me.unsub) me.unsub(); if (ID === me) ID = null; } });
    iconCv($('.mt-id-cv', el), function () { var x = getItem(me.uid); return x ? { slot: x.slot, rar: x.rar, set: x.set, wt: x.wt, skin: slotSkin(x) } : null; }, ID.cvs, true);
    tap($('.mt-id-eqb', el), function () {
      var x = getItem(me.uid); if (!x) return;
      if (isEquipped(x)) { if (doUnequip(x.slot)) closeItem(); }
      else if (doEquip(x.uid)) closeItem();
    }, false);
    holdable($('.mt-id-up', el), function (n) { return doUpgrade(me, n); });
    tap($('.mt-id-skin', el), function () {
      var x = getItem(me.uid); if (!x) return;
      var tg = x.slot === 'silah' ? 'silah:' + x.wt : 'slot:' + x.slot;
      if (!skinsFor(tg).length) { toast('Bu yuva için henüz görünüm yok', 'info'); return; }
      openSkins(tg, x);
    }, 'open');
    tap($('.mt-id-merge', el), function () {
      var x = getItem(me.uid); if (!x) return;
      closeItem();
      if (EQ) mergeEnter(x.uid); else go('ekipman', { merge: x.uid });
    });
    tap($('.mt-id-sell', el), function () { doSell(me); }, false);
    ID.unsub = onChange(function () { if (ID === me) idRender(me); });
    idRender(me, true);
    return ID;
  }
  function idRender(me, first) {
    var it = getItem(me.uid), el = me.el;
    if (!it) { if (me.m) me.m.close(); return; }
    var rd = rarOf(it.rar), sd = slotDef(it.slot) || { n: '' }, eqd = isEquipped(it), maxLv = rd.maxLv;
    el.style.setProperty('--rc', rd.col); el.style.setProperty('--rd', rd.dark);
    $('.mt-id-frame', el).className = 'mt-id-frame rf rf' + it.rar;
    tog($('.mt-id-ic', el), 'mt-glow', it.rar >= 3);
    $('.mt-id-eq', el).hidden = !eqd;
    setText($('.mt-id-n', el), itemName(it));
    var tags = rarPill(it.rar) + '<span class="mt-tag">' + gl(it.slot) + esc(it.slot === 'silah' ? (weaponDef(it.wt) || { n: 'Silah' }).n : sd.n) + '</span>';
    if (it.set && setDef(it.set)) tags += '<span class="mt-tag mt-tag-set" style="--sc:' + setCol(it.set) + '">' + esc(setDef(it.set).n) + '</span>';
    setHTML($('.mt-id-tags', el), tags);
    var lvB = $('.mt-id-lvt b', el);
    if (first) { lvB.__mtv = it.lvl; lvB.textContent = it.lvl; } else tweenTo(lvB, it.lvl, fmt, 380);
    setText($('.mt-id-lvt i', el), '/' + maxLv);
    $('.mt-id-lv .pbar>i', el).style.width = (100 * it.lvl / maxLv) + '%';
    tweenTo($('.mt-id-pw b', el), itemPower(it), fmt, 500);
    // main stat
    var m = itemMain(it);
    setHTML($('.mt-id-mk', el), gl(m.k === 'hp' ? 'heart' : m.k === 'def' ? 'shield' : m.k === 'crit' ? 'crit' : m.k === 'spdPct' ? 'speed' : 'silah'));
    setText($('.mt-id-mn', el), statN(m.k));
    var mv = $('.mt-id-mv', el);
    if (first) { mv.__mtv = m.v; mv.textContent = svs(m.k, m.v); } else tweenTo(mv, m.v, function (v) { return svs(m.k, v); }, 420);
    setHTML($('.mt-id-mnx', el), it.lvl < maxLv ? 'Sv.' + (it.lvl + 1) + ': <b>' + svs(m.k, mainAt(it, it.lvl + 1)) + '</b>' : '<b class="mt-max">EN YÜKSEK</b>');
    // subs
    var subs = it.subs || [], sh = '';
    subs.forEach(function (s) { sh += '<div class="mt-sub"><i></i><span>' + esc(statN(s.k)) + '</span><b>' + svs(s.k, s.v) + '</b></div>'; });
    var nr = it.rar + 1;
    if (nr <= maxRar() && rarOf(nr).subs > subs.length) sh += '<div class="mt-sub mt-sub-lock">' + gl('lock') + '<span>' + esc(rarOf(nr).n) + ' olunca +' + (rarOf(nr).subs - subs.length) + ' yeni özellik</span></div>';
    if (!subs.length && !sh) sh = '<div class="mt-sub mt-sub-lock"><span>Ek özellik yok</span></div>';
    if (!subs.length && it.rar === 0) sh = '<div class="mt-sub mt-sub-none"><span>Sıradan eşyaların ek özelliği yoktur.</span></div>' + sh;
    setHTML($('.mt-id-sl', el), sh);
    // set or weapon section
    setHTML($('.mt-id-set', el), it.slot === 'silah' ? weaponHtml(it) : setHtml(it, eqd));
    // compare
    var cmp = $('.mt-id-cmp', el);
    cmp.hidden = eqd;
    if (!eqd) setHTML(cmp, compareHtml(it));
    // actions
    var eb = $('.mt-id-eqb', el);
    eb.className = 'btn mt-id-eqb ' + (eqd ? 'btn-dark' : 'btn-violet');
    setHTML(eb, eqd ? gl('swap') + '<span>Çıkar</span>' : gl('check') + '<span>Kuşan</span>');
    var c = call('upgradeCost', it) || { gold: 0, scroll: 0, scrollType: 'zirh' };
    var chk = call('canUpgrade', it) || { ok: false, code: 'none' };
    var ub = $('.mt-id-up', el), p = P() || { scrolls: {} };
    var maxed = it.lvl >= maxLv || chk.code === 'max';
    tog(ub, 'off', !chk.ok); tog(ub, 'mt-maxed', maxed);
    setText($('.mt-up-t', ub), maxed ? 'En Yüksek' : 'Yükselt');
    var have = +(p.scrolls && p.scrolls[c.scrollType]) || 0;
    setHTML($('.mt-up-c', ub), maxed ? '' : '<span class="mt-uc' + (gold() < c.gold ? ' no' : '') + '">' + ui('gold') + fmt(c.gold) + '</span>' +
      '<span class="mt-uc mt-uc-s' + (have < c.scroll ? ' no' : '') + '" style="color:' + scrollGroup(c.scrollType).col + '">' + ui('scroll') + '<b>' + fmt(c.scroll) + '</b></span>');
    setHTML($('.mt-id-own', el), '<span>' + ui('scroll', 'mt-sc-' + c.scrollType) + esc(scrollGroup(c.scrollType).n) + ': <b class="num">' + fmt(have) + '</b></span>' +
      '<span>' + ui('gold') + '<b class="num">' + fmt(gold()) + '</b></span>');
    var mergeable = it.rar < maxRar() && (call('mergeCandidates', it.uid) || []).length >= 2;
    var mb = $('.mt-id-merge', el); tog(mb, 'off', !mergeable); mb.hidden = it.rar >= maxRar();
    $('.mt-id-sell', el).hidden = eqd;
    var tg = it.slot === 'silah' ? 'silah:' + it.wt : 'slot:' + it.slot, sk = skinsFor(tg);
    var skb = $('.mt-id-skin', el); tog(skb, 'off', !sk.length);
    setHTML($('.mt-id-skin span', el), 'Görünüm' + (sk.length ? ' <small>' + sk.length + '</small>' : ''));
  }
  function setHtml(it, eqd) {
    var sd = setDef(it.set); if (!sd) return '';
    var list = call('setBonuses') || [], cnt = 0;
    list.forEach(function (s) { if (s.id === it.set) cnt = s.count; });
    var ifEq = cnt;
    if (!eqd) { var cur = equippedItem(it.slot); if (!cur || cur.set !== it.set) ifEq = cnt + 1; }
    var tiers = Object.keys(sd.bonus || {}).sort(function (a, b) { return a - b; }).map(function (need) {
      var eff = sd.bonus[need], on = cnt >= +need, soon = !on && ifEq >= +need;
      return '<div class="mt-tier' + (on ? ' on' : soon ? ' soon' : '') + '"><b>' + need + '</b><span>' +
        Object.keys(eff).map(function (k) { return esc(statN(k)) + ' <em>' + svs(k, eff[k]) + '</em>'; }).join(' · ') + '</span>' + (on ? gl('check') : soon ? '<small>kuşanınca</small>' : '') + '</div>';
    }).join('');
    return '<h4 style="--sc:' + setCol(it.set) + '"><span class="mt-sdot2"></span>Set · ' + esc(sd.n) + '<span class="num mt-setc">' + cnt + '/8</span></h4>' + tiers;
  }
  function weaponHtml(it) {
    var wd = weaponDef(it.wt) || { n: 'Silah', desc: '' }, hid = activeId(), hd = heroDef(hid);
    var masters = heroDefs().filter(function (h) { return h.weapon === it.wt; }).map(function (h) { return h.n; });
    var aff = '';
    if (hd && hd.weapon === it.wt) {
      var v = hd.passive && hd.passive['w_' + it.wt];
      aff = '<div class="mt-aff on">' + gl('check') + '<span><b>' + esc(hd.n) + '</b> bu silahta usta' + (v ? ': ' + esc(statN('w_' + it.wt)) + ' <em>' + svs('w_' + it.wt, v) + '</em>' : '') + '</span></div>';
    } else {
      aff = '<div class="mt-aff">' + gl('info') + '<span>Her kahraman her silahı kullanabilir.' + (masters.length ? ' Uzmanı: <b>' + esc(masters.join(', ')) + '</b>' : '') + '</span></div>';
      var hv = hd && hd.passive && hd.passive['w_' + hd.weapon];
      if (hd && hv) aff += '<div class="mt-aff warn">' + gl('crit') + '<span><b>' + esc(hd.n) + '</b> ' + esc((weaponDef(hd.weapon) || { n: '' }).n.toLocaleLowerCase('tr-TR')) +
        ' ustası: bu silahla ' + esc(statN('w_' + hd.weapon)) + ' <em>' + svs('w_' + hd.weapon, hv) + '</em> bonusu işlemez.</span></div>';
    }
    return '<h4>' + gl(weaponIcon(it.wt) === 'bow' ? 'speed' : 'silah') + 'Silah Türü · ' + esc(wd.n) + '<span class="mt-wk">' + (wd.kind === 'ranged' ? 'Uzak menzil' : 'Yakın dövüş') + '</span></h4>' +
      '<p class="mt-wdesc">' + esc(wd.desc || '') + '</p>' + aff;
  }
  function compareHtml(it) {
    var cur = equippedItem(it.slot), pw = power(), pif = call('powerIf', it.uid);
    var dp = typeof pif === 'number' ? pif - pw : 0;
    var rows = [];
    function row(n, d, txt) { rows.push('<div class="mt-cr ' + (d > 0 ? 'up' : d < 0 ? 'dn' : '') + '"><span>' + esc(n) + '</span><b>' + txt + '</b>' + (d ? gl(d > 0 ? 'up' : 'down') : '') + '</div>'); }
    row('Savaş Gücü', dp, (dp >= 0 ? '+' : '−') + fmt(abs(dp)));
    var a = {}, b = {};
    var m1 = itemMain(it); a[m1.k] = (a[m1.k] || 0) + m1.v;
    (it.subs || []).forEach(function (s) { a[s.k] = (a[s.k] || 0) + s.v; });
    if (cur) { var m2 = itemMain(cur); b[m2.k] = (b[m2.k] || 0) + m2.v; (cur.subs || []).forEach(function (s) { b[s.k] = (b[s.k] || 0) + s.v; }); }
    var keys = Object.keys(a); Object.keys(b).forEach(function (k) { if (keys.indexOf(k) < 0) keys.push(k); });
    keys.slice(0, 6).forEach(function (k) {
      var d = (a[k] || 0) - (b[k] || 0);
      if (abs(d) < 1e-6) return;
      row(statN(k), d, svs(k, d));
    });
    return '<h4>' + gl('swap') + (cur ? 'Kuşanılı ile kıyasla <small>' + esc(itemName(cur)) + ' · Sv.' + cur.lvl + '</small>' : 'Bu yuva boş') + '</h4><div class="mt-crs">' + rows.join('') + '</div>';
  }
  function doUpgrade(me, n) {
    var it = getItem(me.uid); if (!it) return false;
    var chk = call('canUpgrade', it);
    if (!chk || !chk.ok) {
      if (n === 0 || (chk && chk.code !== 'max')) toast(chk ? chk.reason || 'Yükseltilemez' : 'Yükseltilemez', chk && chk.code === 'max' ? 'info' : 'warn');
      return false;
    }
    var eqd = isEquipped(it), pb = power(), ib = itemPower(it);
    if (!call('upgradeItem', it.uid)) return false;
    var it2 = getItem(me.uid) || it, maxLv = rarOf(it2.rar).maxLv;
    snd('upgrade', { pitch: 1 + mn(n, 24) * 0.025 });
    var icon = $('.mt-id-frame', me.el);
    burst(icon, { col: rarOf(it2.rar).col, n: 12 + mn(n, 10), speed: 150, ringK: 0.7 });
    restart(icon, 'mt-pulse');
    var gain = eqd ? power() - pb : itemPower(it2) - ib;
    if (gain > 0) floatNum(icon, '+' + fmt(gain) + (eqd ? '' : ' güç'), '#5BD16E');
    idRender(me, false);
    if (it2.lvl >= maxLv) { toast(itemName(it2) + ' en yüksek seviyede!', 'rare'); burst(icon, { col: '#FFCB57', n: 40, speed: 240 }); return false; }
    return true;
  }
  function doSell(me) {
    var it = getItem(me.uid); if (!it) return;
    if (isEquipped(it)) { toast('Kuşanılı eşya satılamaz', 'warn'); return; }
    var val = call('sellValue', it); if (typeof val !== 'number') val = 20 * (it.rar + 1) * mx(1, it.lvl);
    var proceed = function () {
      var g = call('sell', it.uid);
      if (!g) { toast('Satılamadı', 'warn'); return; }
      snd('gold');
      toast(itemName(it) + ' satıldı: +' + fmt(g) + ' altın', 'ok');
      closeItem();
    };
    if (it.rar >= 2 || it.lvl > 1) {
      confirmBox({ title: 'Eşyayı sat', text: itemName(it) + ' (' + rarOf(it.rar).n + ', Sv.' + it.lvl + ') ' + fmt(val) + ' altına satılsın mı? Bu işlem geri alınamaz.', ok: 'Sat', cancel: 'Vazgeç', danger: true, icon: 'gold' })
        .then(function (y) { if (y) proceed(); });
    } else proceed();
  }

  /* ============================================================================================
   * Skin picker (slot / weapon / hero targets) with a live hero preview
   * ========================================================================================== */
  function previewLook(target, item, skinId) {
    var L;
    if (target.indexOf('hero:') === 0) { L = cloneLook(look(target.slice(5))); L.heroSkin = skinId || null; return L; }
    L = cloneLook(look());
    if (target.indexOf('silah:') === 0) {
      var wt = target.slice(6), w = L.weapon;
      L.weapon = { wt: wt, rar: item && item.slot === 'silah' ? item.rar : (w && w.wt === wt ? w.rar : 2), skin: skinId || null };
    } else if (target.indexOf('slot:') === 0) {
      var s = target.slice(5), g = L.gear[s];
      L.gear[s] = { rar: item ? item.rar : (g ? g.rar : 2), set: item && item.set ? item.set : (g ? g.set : 'kurt'), skin: skinId || null };
    }
    return L;
  }
  function openSkins(target, item, pre) {
    var list = skinsFor(target);
    if (!list.length) { toast('Bu yuva için henüz görünüm yok', 'info'); return; }
    var isHero = target.indexOf('hero:') === 0, hid = isHero ? target.slice(5) : activeId();
    var cur = call('skinFor', target) || null, prev = pre !== undefined ? pre : cur;
    var el = mk('div', 'mt-skm');
    var tname = isHero ? ((heroDef(hid) || { n: '' }).n + ' görünümleri') : target.indexOf('silah:') === 0 ? (weaponDef(target.slice(6)) || { n: 'Silah' }).n + ' görünümleri' : (slotDef(target.slice(5)) || { n: '' }).n + ' görünümleri';
    el.innerHTML = '<div class="mt-skm-h"><div class="ttl">' + esc(tname) + '</div><small>Görünümler yalnızca süstür: güce etki etmez.</small></div>' +
      '<div class="mt-skm-stage"><span class="mt-skm-cv"></span><div class="mt-skm-badge"></div></div>' +
      '<div class="mt-skm-info"><b class="mt-skm-n"></b><p class="mt-skm-d"></p></div>' +
      '<div class="mt-skm-grid"></div>' +
      '<div class="mt-row"><button class="btn btn-gold mt-skm-act" type="button"></button></div>';
    var me = { cvs: [], prev: prev, target: target };
    var st = { look: previewLook(target, item, prev), rar: item ? item.rar : 3, k: 1.7, floorPad: 22, tint: '#2A1240', face: 1, turnNext: 3, autoTurn: true };
    var m = modal(el, { cls: 'mt-modal mt-skmodal', onClose: function () { stopAll(me.cvs); if (me.unsub) me.unsub(); } });
    me.cvs.push(cvs($('.mt-skm-cv', el), function (ctx, w, h, t) { st.k = clamp((h - 34) / 108, 1, 2.2); stageDraw(st, ctx, w, h, t); }));
    stageInput($('.mt-skm-stage', el), function () { return st; });
    var grid = $('.mt-skm-grid', el);
    var cards = [{ id: null, n: 'Varsayılan', rar: item ? item.rar : 0, desc: 'Eşyanın ve setin kendi görünümü.' }].concat(list);
    cards.forEach(function (sk) {
      var b = mk('button', 'mt-skc rf rf' + clamp(sk.rar | 0, 0, 5)); b.type = 'button';
      b.innerHTML = '<span class="mt-skc-cv"></span><span class="mt-skc-st"></span><span class="mt-skc-n">' + esc(sk.n) + '</span>';
      b.__sk = sk;
      var host = $('.mt-skc-cv', b);
      if (isHero) {
        me.cvs.push(cvs(host, function (ctx, w, h, t) { var f = art('drawHeroPortrait'); if (f) f(ctx, 0, 0, mn(w, h), hid, t, sk.id); }, { fps: 12 }));
      } else {
        var sd = target.indexOf('silah:') === 0 ? { slot: 'silah', wt: target.slice(6) } : { slot: target.slice(5) };
        iconCv(host, function () { return { slot: sd.slot, wt: sd.wt, rar: sk.id ? sk.rar : (item ? item.rar : 0), set: item && item.set ? item.set : (sd.slot === 'silah' ? null : 'kurt'), skin: sk.id || '' }; }, me.cvs, !!sk.id && sk.rar >= 3);
      }
      tap(b, function () { me.prev = sk.id; st.look = previewLook(target, item, sk.id); st.flash = 0.8; st.flashCol = rarOf(sk.rar | 0).col; restart(b, 'mt-pop'); render(); });
      grid.appendChild(b);
    });
    tap($('.mt-skm-act', el), function () {
      var id = me.prev, sk = id ? skinDef(id) : null;
      var owned = !id || call('ownsSkin', id);
      if (id === (call('skinFor', target) || null)) return;
      if (!owned) {
        var cost = sk && sk.cost && sk.cost.gems || 0;
        if (gems() < cost) { toast('Yetersiz elmas: ' + fmt(cost) + ' gerekiyor', 'warn'); return; }
        confirmBox({ title: 'Görünüm satın al', text: sk.n + ' görünümü ' + fmt(cost) + ' elmasa satın alınsın mı?', ok: 'Satın Al', cancel: 'Vazgeç', icon: 'gem' }).then(function (y) {
          if (!y) return;
          if (call('buySkin', id)) {
            snd('buy'); snd('rare'); toast(sk.n + ' artık senin!', 'rare');
            var card = $$('.mt-skc', grid).filter(function (c) { return c.__sk.id === id; })[0];
            if (card) burst(card, { col: rarOf(sk.rar).col, n: 30, speed: 200 });
            render();
          } else toast('Satın alınamadı', 'warn');
        });
        return;
      }
      if (call('setSkin', target, id || null) !== false) {
        snd('equip'); toast(id ? (sk ? sk.n : 'Görünüm') + ' kullanılıyor' : 'Varsayılan görünüm', 'ok');
        st.act = { anim: 'victory', t: 0, d: 1.1 };
        render();
      }
    }, false);
    function render() {
      var curS = call('skinFor', target) || null, id = me.prev, sk = id ? skinDef(id) : null;
      $$('.mt-skc', grid).forEach(function (b) {
        var s = b.__sk, owned = !s.id || call('ownsSkin', s.id), sel = (s.id || null) === curS;
        tog(b, 'on', (s.id || null) === id); tog(b, 'locked', !owned);
        setHTML($('.mt-skc-st', b), sel ? gl('check') + 'Seçili' : owned ? 'Sahip' : ui('gem') + fmt(s.cost && s.cost.gems || 0));
      });
      setText($('.mt-skm-n', el), sk ? sk.n : 'Varsayılan');
      $('.mt-skm-n', el).style.color = sk ? rarOf(sk.rar).col : '';
      setText($('.mt-skm-d', el), sk ? sk.desc || '' : 'Eşyanın kendi set görünümü kullanılır.');
      setHTML($('.mt-skm-badge', el), sk ? rarPill(sk.rar) : '');
      var act = $('.mt-skm-act', el), owned2 = !id || call('ownsSkin', id);
      act.className = 'btn mt-skm-act ' + (id === curS ? 'btn-dark off' : owned2 ? 'btn-violet' : 'btn-gold');
      setHTML(act, id === curS ? gl('check') + 'Kullanılıyor' : owned2 ? (id ? 'Kullan' : 'Varsayılana Dön') :
        'Satın Al <span class="cost">' + ui('gem') + fmt(sk && sk.cost && sk.cost.gems || 0) + '</span>');
    }
    me.unsub = onChange(render);
    render();
    return m;
  }

  /* ============================================================================================
   * KAHRAMANLAR — roster
   * ========================================================================================== */
  var HR = null;
  var ULT_ICON = { kasirga: 'sword', okYagmuru: 'bow', golgePatlama: 'skull', firtina: 'bolt', ejderNefesi: 'flame' };
  function heroBadge(id) {
    var hs = heroSt(id); if (!hs || !hs.owned) return 0;
    var n = 0, tp = call('talentPoints', id), lv = call('canLevelHero', id), stc = call('canStarUp', id);
    if (tp && tp.free > 0) n++;
    if (lv && lv.ok) n++;
    if (stc && stc.ok) n++;
    return n;
  }
  function glyphCv(host, name, col, list, fps) {
    var r = cvs(host, function (ctx, w, h, t) { var f = art('drawTalentIcon'); if (f) f(ctx, 0, 0, mn(w, h), name, col, t); }, fps ? { fps: fps } : { once: true });
    if (list) list.push(r);
    return r;
  }
  function heroesMount(root) {
    root.classList.add('mt-scr', 'mt-heroes');
    root.innerHTML = '<header class="mt-hd mt-hd-tab"><div class="mt-hd-t"><h2 class="ttl">Kahramanlar</h2><small class="mt-hr-sub"></small></div>' +
      '<div class="mt-hd-r"><span class="mt-chip-pow">' + ui('swords') + '<b class="num"></b></span></div></header>' +
      '<div class="mt-hr-body scroll"><div class="mt-hgrid"></div>' +
      '<div class="mt-tipc">' + gl('info') + '<span>Her kahraman her silahı kullanabilir; ama kendi silah türünde ustadır ve ona özel bonuslar verir. Ekipman bütün kahramanlarla paylaşılır.</span></div></div>';
    HR = { root: root, cvs: [], cards: {}, rev: -2, unsub: onChange(function () { if (HR) HR.dirty = true; }) };
    var grid = $('.mt-hgrid', root);
    heroDefs().forEach(function (h, i) {
      var b = mk('button', 'mt-hc rf rf' + clamp(h.rar | 0, 0, 5)); b.type = 'button';
      b.style.setProperty('--hc', (h.look && h.look.cloth) || '#8E2F2F');
      if (!RM) { b.classList.add('mt-in'); b.style.animationDelay = (i * 0.06) + 's'; }
      b.innerHTML = '<span class="mt-hc-cv"></span><span class="mt-hc-shade"></span>' +
        '<span class="mt-hc-top">' + rarPill(h.rar) + '<span class="mt-hc-w" title="' + esc((weaponDef(h.weapon) || { n: '' }).n + ' ustası') + '"></span></span>' +
        '<span class="mt-hc-act">Aktif</span>' +
        '<span class="mt-hc-bot"><b class="mt-hc-n">' + esc(h.n) + '</b><span class="mt-hc-c">' + esc(h.cls || '') + '</span>' +
        '<span class="mt-hc-row"><span class="mt-hc-st"></span><span class="mt-hc-lv num"></span></span></span>' +
        '<span class="mt-hc-lock"><i>' + gl('lock') + '</i><span class="mt-hc-price"></span></span>' +
        '<b class="dot" hidden></b>';
      HR.cvs.push(cvs($('.mt-hc-cv', b), function (ctx, w, h2, t) {
        var f = art('drawHeroPortrait'); if (!f) return;
        var hs = heroSt(h.id), s = mn(w * 1.06, h2);
        f(ctx, (w - s) / 2, 0, s, h.id, t, hs && hs.skin ? hs.skin : (call('skinFor', 'hero:' + h.id) || null));
      }, { fps: 15 }));
      glyphCv($('.mt-hc-w', b), weaponIcon(h.weapon), '#FFCB57', HR.cvs);
      tap(b, function () { go('kahraman-detay', { id: h.id }); }, 'open');
      grid.appendChild(b);
      HR.cards[h.id] = b;
    });
    if (!heroDefs().length) grid.innerHTML = '<p class="muted">Kahraman verisi yüklenemedi.</p>';
    heroesRefresh(true);
  }
  function heroesUnmount() { if (!HR) return; stopAll(HR.cvs); if (HR.unsub) HR.unsub(); HR = null; }
  function heroesRefresh(force) {
    if (!HR) return;
    var r = rev(); if (!force && r === HR.rev && r !== -1) { HR.dirty = false; return; }
    HR.rev = r; HR.dirty = false;
    var owned = 0, act = activeId();
    heroDefs().forEach(function (h) {
      var b = HR.cards[h.id]; if (!b) return;
      var hs = heroSt(h.id) || { owned: false, lvl: 1, stars: 1 };
      if (hs.owned) owned++;
      tog(b, 'locked', !hs.owned); tog(b, 'active', act === h.id);
      setHTML($('.mt-hc-st', b), starsHtml(hs.stars || 1));
      setText($('.mt-hc-lv', b), 'Sv.' + (hs.lvl || 1));
      var price = h.unlock && h.unlock.type === 'gems' ? h.unlock.cost || 0 : 0;
      setHTML($('.mt-hc-price', b), hs.owned ? '' : price ? ui('gem') + '<b class="num">' + fmt(price) + '</b>' : 'Kilitli');
      tog($('.mt-hc-price', b), 'can', !hs.owned && price && gems() >= price);
      var n = heroBadge(h.id), d = $('.dot', b);
      d.hidden = !(n > 0); d.textContent = n;
    });
    setText($('.mt-hr-sub', HR.root), owned + '/' + heroDefs().length + ' kahraman · Aktif: ' + ((heroDef(act) || { n: '-' }).n));
    tweenTo($('.mt-chip-pow b', HR.root), power(), fmt, 500);
  }

  /* ============================================================================================
   * Hero detail
   * ========================================================================================== */
  var HD = null;
  function hdMount(root, params) {
    root.classList.add('mt-scr', 'mt-hdet');
    HD = { root: root, cvs: [], rev: -2, id: null, unsub: onChange(function () { if (HD) HD.dirty = true; }) };
    hdBuild((params && params.id) || activeId(), 0);
  }
  function hdUnmount() { if (!HD) return; stopAll(HD.cvs); if (HD.unsub) HD.unsub(); HD = null; }
  function hdBuild(id, dir) {
    var root = HD.root, h = heroDef(id);
    stopAll(HD.cvs);
    if (!h) { root.innerHTML = backHeader('Kahraman', '') + '<p class="muted mt-pad">Kahraman bulunamadı.</p>'; bindBack(root); return; }
    HD.id = id; HD.preview = undefined; HD.rev = -2;
    var ult = h.ult || { n: 'Nihai Güç', desc: '' };
    root.innerHTML = backHeader(h.n, h.title || h.cls, '<span class="mt-chip-pow">' + ui('swords') + '<b class="num mt-hd-pw"></b></span>') +
      '<div class="mt-hd-body scroll">' +
        '<div class="mt-hstage' + (dir ? (dir > 0 ? ' mt-slide-l' : ' mt-slide-r') : '') + '" style="--hc:' + ((h.look && h.look.cloth) || '#8E2F2F') + '">' +
          '<span class="mt-hstage-cv"></span>' +
          '<div class="mt-hs-tl">' + rarPill(h.rar) + '<span class="mt-tag">' + esc(h.cls || '') + '</span></div>' +
          '<div class="mt-hs-w"><span class="mt-hs-wi"></span><span><small>Silah Uzmanlığı</small><b>' + esc((weaponDef(h.weapon) || { n: '' }).n) + '</b></span></div>' +
          '<button class="mt-hs-nav mt-hs-prev" type="button" aria-label="Önceki kahraman">' + gl('back') + '</button>' +
          '<button class="mt-hs-nav mt-hs-next" type="button" aria-label="Sonraki kahraman">' + gl('back') + '</button>' +
          '<div class="mt-hs-b"><div class="mt-hs-st"></div><div class="mt-hs-role">' + esc(h.role || '') + '</div></div>' +
          '<div class="mt-hs-active">' + gl('check') + 'Aktif</div>' +
        '</div>' +
        '<div class="mt-hd-acts"><button class="btn btn-violet mt-hd-activate" type="button"></button>' +
          '<button class="btn btn-dark mt-hd-tree" type="button">' + gl('tree') + '<span>Yetenek Ağacı</span><b class="dot" hidden></b></button></div>' +
        '<div class="panel mt-hp mt-hp-unlock" hidden></div>' +
        '<div class="panel mt-hp mt-hp-lv"><div class="mt-hp-h"><span class="mt-hp-k">Seviye</span><b class="num mt-lv-v"></b><i class="mt-lv-m"></i>' +
          '<span class="mt-hp-x">Her seviye: +1 yetenek puanı · statlar +%' + fmtD(heroProg().lvlStatGrow * 100, 1) + '</span></div>' +
          '<div class="pbar mt-lv-bar"><i></i></div><div class="mt-hp-note mt-lv-note"></div>' +
          '<button class="btn btn-gold mt-lv-btn" type="button"><span class="mt-bt">Seviye Yükselt</span><span class="mt-bc"></span></button></div>' +
        '<div class="panel mt-hp mt-hp-star"><div class="mt-hp-h"><span class="mt-hp-k">Yıldız</span><span class="mt-big-stars"></span></div>' +
          '<div class="mt-sh"><i class="mt-sh-ic">' + ui('shard') + '</i><div class="pbar violet"><i></i></div><b class="num mt-sh-v"></b></div>' +
          '<div class="mt-hp-note mt-st-note"></div>' +
          '<button class="btn btn-violet mt-st-btn" type="button"><span class="mt-bt">Yıldız Yükselt</span><span class="mt-bc"></span></button></div>' +
        '<div class="mt-hstats"></div>' +
        '<div class="panel mt-hp mt-hp-pass"><h4>' + gl('star') + 'Kahraman Bonusları</h4><div class="mt-pass"></div></div>' +
        '<button class="mt-ult" type="button" style="--uc:' + (ult.col || '#FFCB57') + '"><span class="mt-ult-ic"></span><span class="mt-ult-play">' + gl('eye') + 'Önizle</span><span class="mt-ult-t"><small>Nihai Güç' + (ult.dur ? ' · ' + ult.dur + ' sn' : '') + '</small><b>' + esc(ult.n) + '</b><span class="mt-ult-d">' + esc(ult.desc || '') + '</span></span></button>' +
        '<div class="panel mt-hp mt-hp-skins"><h4>' + gl('brush') + 'Görünümler</h4><div class="mt-hsk"></div><button class="btn btn-sm mt-hsk-act" type="button"></button></div>' +
        '<div class="panel mt-hp mt-hp-lore"><h4>' + gl('info') + 'Hikâye</h4><p>' + esc(h.desc || '') + '</p>' + (h.quote ? '<blockquote>' + esc(h.quote) + '</blockquote>' : '') + '</div>' +
      '</div>';
    bindBack(root);
    // stage
    var st = HD.st = { look: look(id), rar: clamp(h.rar | 0, 0, 5), k: 2.2, floorPad: 34, tint: mixHex((h.look && h.look.cloth) || '#3A0F24', '#1A0820', 0.55), face: 1, turnNext: 6 };
    HD.cvs.push(cvs($('.mt-hstage-cv', root), function (ctx, w, hh, t) {
      st.k = clamp(mn((hh - st.floorPad - 40) / 104, w / 110), 1.3, 2.6);
      var hs = heroSt(HD && HD.id);
      if (hs && !hs.owned) { ctx.save(); stageDraw(st, ctx, w, hh, t); ctx.restore(); ctx.fillStyle = 'rgba(9,7,13,0.35)'; ctx.fillRect(0, 0, w, hh); }
      else stageDraw(st, ctx, w, hh, t);
    }));
    stageInput($('.mt-hstage-cv', root), function () { return st; });
    glyphCv($('.mt-hs-wi', root), weaponIcon(h.weapon), '#FFCB57', HD.cvs);
    glyphCv($('.mt-ult-ic', root), ULT_ICON[ult.id] || 'star', ult.col || '#FFCB57', HD.cvs, 12);
    tap($('.mt-ult', root), function () {
      var body = $('.mt-hd-body', root), delay = body.scrollTop > 40 ? 320 : 0;
      if (delay) body.scrollTo({ top: 0, behavior: RM ? 'auto' : 'smooth' });
      setTimeout(function () {
        if (!HD || HD.st !== st) return;
        st.act = { anim: 'cast', t: 0, d: 1.4 }; st.flash = 1.3; st.flashCol = ult.col || '#FFCB57';
        snd('ult'); burst($('.mt-hstage', root), { col: ult.col || '#FFCB57', n: 46, speed: 240, ringK: 0.5, cols: [ult.col || '#FFCB57', '#FFFFFF'] });
        var b2 = mk('div', 'mt-ultban', '<small>Nihai Güç</small><b>' + esc(ult.n) + '</b>');
        b2.style.setProperty('--uc', ult.col || '#FFCB57');
        var stg = $('.mt-hstage', root); if (stg) { stg.appendChild(b2); setTimeout(function () { if (b2.parentNode) b2.parentNode.removeChild(b2); }, 1600); }
      }, delay);
    }, false);
    var H = heroDefs(), idx = 0; H.forEach(function (x, i) { if (x.id === id) idx = i; });
    tap($('.mt-hs-prev', root), function () { hdBuild(H[(idx - 1 + H.length) % H.length].id, -1); }, 'tab');
    tap($('.mt-hs-next', root), function () { hdBuild(H[(idx + 1) % H.length].id, 1); }, 'tab');
    tap($('.mt-hd-activate', root), function () { hdActivate(); }, false);
    tap($('.mt-hd-tree', root), function () {
      var hs = heroSt(HD.id); if (!hs || !hs.owned) { toast('Önce kahramanın kilidini aç', 'warn'); return; }
      go('yetenek', { id: HD.id });
    }, 'open');
    holdable($('.mt-lv-btn', root), function (n) { return hdLevel(n); });
    tap($('.mt-st-btn', root), function () { hdStar(); }, false);
    // passives
    var pt = (h.passiveText && h.passiveText.length) ? h.passiveText : (GM.D && GM.D.effLines ? GM.D.effLines(h.passive) : Object.keys(h.passive || {}).map(function (k) { return statN(k) + ' ' + svs(k, h.passive[k]); }));
    setHTML($('.mt-pass', root), pt.map(function (s, i) { return '<div class="mt-pl" style="animation-delay:' + (i * 0.05) + 's">' + gl('check') + '<span>' + esc(s) + '</span></div>'; }).join(''));
    // skins row
    var sk = [{ id: null, n: 'Varsayılan', rar: h.rar }].concat(skinsFor('hero:' + id)), row = $('.mt-hsk', root);
    sk.forEach(function (s) {
      var b = mk('button', 'mt-hskc rf rf' + clamp(s.rar | 0, 0, 5)); b.type = 'button'; b.__sk = s;
      b.innerHTML = '<span class="mt-hskc-cv"></span><span class="mt-hskc-n">' + esc(s.n) + '</span><span class="mt-hskc-st"></span>';
      HD.cvs.push(cvs($('.mt-hskc-cv', b), function (ctx, w, hh, t) { var f = art('drawHeroPortrait'); if (f) f(ctx, 0, 0, mn(w, hh), id, t, s.id); }, { fps: 10 }));
      tap(b, function () {
        HD.preview = s.id; st.look = cloneLook(look(id)); st.look.heroSkin = s.id || null;
        st.flash = 0.9; st.flashCol = rarOf(s.rar | 0).col; st.act = { anim: 'victory', t: 0, d: 1.1 };
        restart(b, 'mt-pop'); hdRender(true);
      });
      row.appendChild(b);
    });
    tap($('.mt-hsk-act', root), function () { hdSkinAct(); }, false);
    hdRender(true);
  }
  function hdFrame() { if (HD && HD.dirty) hdRender(false); }
  function hdRender(force) {
    if (!HD || !HD.id) return;
    var r = rev(); if (!force && r === HD.rev && r !== -1) { HD.dirty = false; return; }
    HD.rev = r; HD.dirty = false;
    var root = HD.root, id = HD.id, h = heroDef(id), hs = heroSt(id) || { owned: false, lvl: 1, stars: 1 }, prog = heroProg();
    if (!h) return;
    var owned = !!hs.owned, act = activeId() === id;
    if (HD.preview === undefined) HD.st.look = look(id);
    tog(root, 'mt-locked', !owned);
    $('.mt-hs-active', root).hidden = !act;
    setHTML($('.mt-hs-st', root), starsHtml(hs.stars || 1));
    tweenTo($('.mt-hd-pw', root), power(id), fmt, 600);
    // activate / tree buttons
    var ab = $('.mt-hd-activate', root);
    ab.className = 'btn mt-hd-activate ' + (!owned ? 'btn-gold' : act ? 'btn-dark off' : 'btn-violet');
    var price = h.unlock && h.unlock.type === 'gems' ? h.unlock.cost || 0 : 0;
    setHTML(ab, !owned ? gl('lock') + '<span>Kilidi Aç</span><span class="cost">' + ui('gem') + fmt(price) + '</span>' : act ? gl('check') + '<span>Aktif Kahraman</span>' : gl('swap') + '<span>Aktif Yap</span>');
    var tp = call('talentPoints', id) || { free: 0, total: 0, used: 0 };
    var td = $('.mt-hd-tree .dot', root); td.hidden = !(owned && tp.free > 0); td.textContent = tp.free;
    tog($('.mt-hd-tree', root), 'off', !owned);
    // unlock panel
    var up = $('.mt-hp-unlock', root);
    up.hidden = owned;
    if (!owned) setHTML(up, '<div class="mt-unl">' + gl('lock') + '<div><b>' + esc(h.n) + ' kilitli</b><span>' +
      (price ? fmt(price) + ' elmasla kalıcı olarak açılır. Açılınca kendi yetenek ağacı ve silah uzmanlığı seninle olur.' : 'Bu kahraman ileride açılacak.') + '</span></div></div>');
    $('.mt-hp-lv', root).hidden = !owned;
    $('.mt-hp-star', root).hidden = !owned;
    // level
    var maxLv = call('heroMaxLv', id) || prog.maxLvByStar[hs.stars] || 20;
    var lb = $('.mt-lv-v', root);
    tweenTo(lb, hs.lvl, fmt, 380);
    setText($('.mt-lv-m', root), '/' + maxLv);
    $('.mt-lv-bar>i', root).style.width = (100 * hs.lvl / maxLv) + '%';
    var cl = call('canLevelHero', id) || { ok: false, code: 'none' }, cost = call('heroLevelCost', id) || 0;
    var lvb = $('.mt-lv-btn', root), capped = cl.code === 'cap' || cl.code === 'max';
    tog(lvb, 'off', !cl.ok);
    setText($('.mt-lv-btn .mt-bt', root), capped ? (cl.code === 'max' ? 'En Yüksek Seviye' : 'Seviye Sınırı') : 'Seviye Yükselt');
    setHTML($('.mt-lv-btn .mt-bc', root), capped ? '' : '<span class="cost' + (gold() < cost ? ' no' : '') + '">' + ui('gold') + fmt(cost) + '</span>');
    var nextCap = prog.maxLvByStar[(hs.stars || 1) + 1];
    setHTML($('.mt-lv-note', root), cl.code === 'cap' ? gl('lock') + '<span>Seviye sınırı <b>' + maxLv + '</b>. Yıldız yükselterek sınırı <b>' + (nextCap || maxLv) + '</b> seviyeye çıkar.</span>' :
      cl.code === 'max' ? gl('crown') + '<span>Bu kahraman zirvede.</span>' : '<span class="dim">Seviye sınırı yıldızla artar: ' + prog.maxLvByStar.slice(1).join(' · ') + '</span>');
    // stars
    var stars = hs.stars || 1, maxS = prog.maxLvByStar.length - 1, sc = call('starCost', id) || 0, shards = (P() && P().shards && P().shards[id]) || 0;
    var bs = ''; for (var i = 1; i <= maxS; i++) bs += '<i class="' + (i <= stars ? 'on' : '') + '">' + gl('star') + '</i>';
    setHTML($('.mt-big-stars', root), bs);
    var full = stars >= maxS;
    $('.mt-sh .pbar>i', root).style.width = full ? '100%' : (100 * clamp(shards / mx(1, sc), 0, 1)) + '%';
    setText($('.mt-sh-v', root), full ? fmt(shards) : fmt(shards) + '/' + fmt(sc));
    var cs = call('canStarUp', id) || { ok: false, code: 'none' };
    tog($('.mt-st-btn', root), 'off', !cs.ok); tog($('.mt-st-btn', root), 'mt-ready', !!cs.ok);
    setText($('.mt-st-btn .mt-bt', root), full ? 'En Yüksek Yıldız' : 'Yıldız Yükselt');
    setHTML($('.mt-st-btn .mt-bc', root), full ? '' : '<span class="cost' + (shards < sc ? ' no' : '') + '">' + ui('shard') + fmt(sc) + '</span>');
    setHTML($('.mt-st-note', root), full ? '<span>Bütün yıldızlar açıldı.</span>' :
      '<span>' + (stars + 1) + '. yıldız: seviye sınırı <b>' + (nextCap || '') + '</b>, temel statlar <b>+%' + fmtD(prog.starStatGrow * 100, 0) + '</b>. Parçalar savaşlardan düşer.</span>');
    // stats
    var sh = stats(id);
    if (sh) {
      var tiles = [['atk', 'Saldırı', 'silah', '#FF7A5A'], ['hp', 'Can', 'heart', '#FF5C7A'], ['def', 'Savunma', 'shield', '#6FB6FF'], ['crit', 'Kritik', 'crit', '#FFCB57']];
      var box = $('.mt-hstats', root);
      if (!box.__b) {
        box.__b = 1;
        box.innerHTML = tiles.map(function (x) { return '<div class="mt-hst" style="--kc:' + x[3] + '">' + gl(x[2]) + '<span>' + x[1] + '</span><b class="num" data-k="' + x[0] + '"></b></div>'; }).join('');
      }
      tiles.forEach(function (x) {
        var e = $('b[data-k="' + x[0] + '"]', box);
        if (x[0] === 'crit') tweenTo(e, sh.crit * 100, function (v) { return '%' + fmtD(v, 1); }, 500); else tweenTo(e, sh[x[0]], fmt, 500);
      });
    }
    // skins row
    var cur = call('skinFor', 'hero:' + id) || null, pv = HD.preview === undefined ? cur : HD.preview;
    $$('.mt-hskc', root).forEach(function (b) {
      var s = b.__sk, own = !s.id || call('ownsSkin', s.id);
      tog(b, 'on', (s.id || null) === pv); tog(b, 'locked', !own);
      setHTML($('.mt-hskc-st', b), (s.id || null) === cur ? gl('check') : own ? '' : ui('gem') + fmt(s.cost && s.cost.gems || 0));
    });
    var sa = $('.mt-hsk-act', root), psk = pv ? skinDef(pv) : null, pown = !pv || call('ownsSkin', pv);
    sa.className = 'btn btn-sm mt-hsk-act ' + (pv === cur ? 'btn-dark off' : pown ? 'btn-violet' : 'btn-gold');
    setHTML(sa, pv === cur ? gl('check') + (psk ? esc(psk.n) : 'Varsayılan') + ' kullanılıyor' : pown ? (psk ? esc(psk.n) + ': Kullan' : 'Varsayılana Dön') :
      esc(psk.n) + ' · Satın Al <span class="cost">' + ui('gem') + fmt(psk.cost && psk.cost.gems || 0) + '</span>');
  }
  function hdActivate() {
    var id = HD.id, h = heroDef(id), hs = heroSt(id);
    if (!h) return;
    if (!hs || !hs.owned) {
      var price = h.unlock && h.unlock.type === 'gems' ? h.unlock.cost || 0 : 0;
      if (!price) { toast('Bu kahraman henüz açılamaz', 'info'); return; }
      if (gems() < price) { snd('error'); toast('Yetersiz elmas: ' + fmt(price) + ' gerekiyor', 'warn'); return; }
      confirmBox({ title: h.n + ' kilidini aç', text: h.n + ' (' + (h.cls || '') + ') ' + fmt(price) + ' elmasla açılsın mı?', ok: 'Kilidi Aç', cancel: 'Vazgeç', icon: 'gem' }).then(function (y) {
        if (!y || !HD || HD.id !== id) return;
        if (call('unlockHero', id)) {
          snd('legendary'); toast(h.n + ' saflarına katıldı!', 'rare');
          HD.st.flash = 1.2; HD.st.flashCol = rarOf(h.rar).col; HD.st.act = { anim: 'victory', t: 0, d: 1.4 };
          burst($('.mt-hstage', HD.root), { col: rarOf(h.rar).col, n: 60, speed: 280, ringK: 0.6, cols: [rarOf(h.rar).col, '#FFCB57', '#FFFFFF'] });
          hdRender(true); uiRefresh();
        } else toast('Kilit açılamadı', 'warn');
      });
      return;
    }
    if (activeId() === id) { toast(h.n + ' zaten aktif', 'info'); return; }
    if (call('setActive', id)) {
      snd('equip'); toast(h.n + ' artık aktif kahraman', 'ok');
      HD.st.act = { anim: 'victory', t: 0, d: 1.2 }; HD.st.flash = 0.8; HD.st.flashCol = '#FFCB57';
      burst($('.mt-hd-activate', HD.root), { col: '#9D6BFF', n: 22, speed: 160 });
      hdRender(true); uiRefresh();
    }
  }
  function hdLevel(n) {
    var id = HD && HD.id; if (!id) return false;
    var cl = call('canLevelHero', id);
    if (!cl || !cl.ok) {
      if (n === 0 || (cl && cl.code === 'gold')) toast(cl ? (cl.code === 'cap' ? 'Seviye sınırına ulaştın: yıldız yükselt' : cl.reason) : 'Seviye yükseltilemez', cl && cl.code === 'cap' ? 'info' : 'warn');
      if (cl && cl.code === 'cap') restart($('.mt-hp-star', HD.root), 'mt-flash');
      return false;
    }
    var pb = power(id);
    if (!call('levelUpHero', id)) return false;
    snd('levelup', { pitch: 1 + mn(n, 20) * 0.02 });
    var hs = heroSt(id), pa = power(id);
    HD.st.flash = 0.7; HD.st.flashCol = '#FFCB57';
    if (!HD.st.act && n % 4 === 0) HD.st.act = { anim: 'victory', t: 0, d: 1 };
    burst($('.mt-lv-bar', HD.root), { col: '#FFCB57', n: 10, speed: 120, ring: false });
    floatNum($('.mt-hstage', HD.root), 'Sv.' + hs.lvl + (pa > pb ? '  +' + fmt(pa - pb) : ''), '#FFCB57');
    hdRender(true);
    return true;
  }
  function hdStar() {
    var id = HD && HD.id; if (!id) return;
    var cs = call('canStarUp', id);
    if (!cs || !cs.ok) { snd('error'); toast(cs ? cs.reason : 'Yıldız yükseltilemez', 'warn'); return; }
    if (!call('starUpHero', id)) return;
    var hs = heroSt(id);
    snd('legendary'); toast((heroDef(id) || { n: '' }).n + ' ' + hs.stars + ' yıldız oldu!', 'rare');
    HD.st.flash = 1.2; HD.st.flashCol = '#B565FF'; HD.st.act = { anim: 'victory', t: 0, d: 1.3 };
    hdRender(true);
    var star = $$('.mt-big-stars i', HD.root)[hs.stars - 1];
    if (star) { restart(star, 'mt-starpop'); burst(star, { col: '#FFCB57', n: 34, speed: 220 }); }
  }
  function hdSkinAct() {
    var id = HD.id, tg = 'hero:' + id, cur = call('skinFor', tg) || null, pv = HD.preview === undefined ? cur : HD.preview;
    if (pv === cur) return;
    var sk = pv ? skinDef(pv) : null;
    if (pv && !call('ownsSkin', pv)) {
      var cost = sk && sk.cost && sk.cost.gems || 0;
      if (gems() < cost) { snd('error'); toast('Yetersiz elmas: ' + fmt(cost) + ' gerekiyor', 'warn'); return; }
      confirmBox({ title: 'Görünüm satın al', text: sk.n + ' görünümü ' + fmt(cost) + ' elmasa satın alınsın mı?', ok: 'Satın Al', cancel: 'Vazgeç', icon: 'gem' }).then(function (y) {
        if (!y || !HD) return;
        if (call('buySkin', pv)) {
          snd('buy'); snd('rare'); toast(sk.n + ' artık senin!', 'rare');
          HD.preview = undefined; HD.st.flash = 1; HD.st.flashCol = rarOf(sk.rar).col;
          burst($('.mt-hstage', HD.root), { col: rarOf(sk.rar).col, n: 40, speed: 220, ringK: 0.5 });
          hdRender(true); uiRefresh();
        } else toast('Satın alınamadı', 'warn');
      });
      return;
    }
    if (call('setSkin', tg, pv || null) !== false) {
      snd('equip'); toast(pv ? sk.n + ' kullanılıyor' : 'Varsayılan görünüm', 'ok');
      HD.preview = undefined; hdRender(true); uiRefresh();
    }
  }

  /* ============================================================================================
   * Talent tree (RoK style)
   * ========================================================================================== */
  var TL = null, svgN = 0;
  function tlMount(root, params) {
    params = params || {};
    var id = params.id || activeId(), h = heroDef(id);
    root.classList.add('mt-scr', 'mt-tal');
    if (!h) { root.innerHTML = backHeader('Yetenek Ağacı', '') + '<p class="muted mt-pad">Kahraman bulunamadı.</p>'; bindBack(root); TL = null; return; }
    var gid = 'mtg' + (++svgN);
    root.innerHTML = backHeader('Yetenek Ağacı', h.n + ' · ' + (h.cls || ''), '<span class="mt-pts"><small>Puan</small><b class="num"></b></span>') +
      '<div class="mt-tl-tabs"></div><div class="mt-tl-desc"></div>' +
      '<div class="mt-tl-tree scroll"><div class="mt-tl-grid">' +
        '<svg class="mt-tl-svg" xmlns="http://www.w3.org/2000/svg"><defs><filter id="' + gid + '" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="3.2"/></filter></defs><g class="mt-tl-g"></g></svg>' +
        '<div class="mt-tl-gates"></div><div class="mt-tl-nodes"></div></div></div>' +
      '<footer class="mt-tl-foot"><div class="mt-tl-sum"></div><button class="btn btn-dark btn-sm mt-tl-reset" type="button">' + gl('swap') + '<span>Sıfırla</span><span class="cost">' + ui('gem') + fmt(resetGems()) + '</span></button></footer>' +
      '<div class="mt-tl-pop" hidden></div>';
    bindBack(root);
    TL = { root: root, id: id, h: h, b: clamp(+params.b || 0, 0, (h.talents || []).length - 1), cvs: [], nodeCvs: [], nodes: {}, rev: -2, gid: gid, sel: null,
      unsub: onChange(function () { if (TL) TL.dirty = true; }) };
    var tabs = $('.mt-tl-tabs', root);
    (h.talents || []).forEach(function (br, i) {
      var b = mk('button', 'mt-tlt'); b.type = 'button'; b.style.setProperty('--bc', br.col || '#FFCB57');
      b.innerHTML = '<span class="mt-tlt-ic"></span><span class="mt-tlt-t"><b>' + esc(br.n) + '</b><small class="num"></small></span>';
      glyphCv($('.mt-tlt-ic', b), br.icon || 'star', br.col || '#FFCB57', TL.cvs);
      tap(b, function () { if (TL.b === i) return; TL.b = i; tlClosePop(); tlBuildBranch(); }, 'tab');
      tabs.appendChild(b);
    });
    tap($('.mt-tl-reset', root), tlReset, false);
    TL.unobs = observe($('.mt-tl-tree', root), function () { tlLayout(); });
    TL.lit = null;
    tlBuildBranch();
  }
  function tlUnmount() { if (!TL) return; stopAll(TL.cvs); stopAll(TL.nodeCvs); if (TL.unsub) TL.unsub(); if (TL.unobs) TL.unobs(); TL = null; }
  function tlFrame() { if (TL && TL.dirty) tlRender(false); }
  function tlBranch() { return TL && TL.h.talents ? TL.h.talents[TL.b] : null; }
  function tlBuildBranch() {
    var br = tlBranch(); if (!br) return;
    stopAll(TL.nodeCvs); TL.nodes = {}; TL.lit = null;
    var root = TL.root, wrap = $('.mt-tl-nodes', root);
    wrap.innerHTML = '';
    root.style.setProperty('--bc', br.col || '#FFCB57');
    setText($('.mt-tl-desc', root), br.desc || '');
    $$('.mt-tlt', root).forEach(function (b, i) { tog(b, 'on', i === TL.b); });
    (br.nodes || []).forEach(function (nd, i) {
      var b = mk('button', 'mt-tn' + (nd.big ? ' big' : '')); b.type = 'button';
      b.innerHTML = '<span class="mt-tn-ring"></span><span class="mt-tn-cv"></span><span class="mt-tn-rk num"></span><span class="mt-tn-lk">' + gl('lock') + '</span>';
      var lab = mk('span', 'mt-tn-n', esc(nd.n));
      if (!RM) { b.style.animationDelay = (nd.row * 0.05 + nd.col * 0.02) + 's'; b.classList.add('mt-in'); }
      TL.nodeCvs.push(cvs($('.mt-tn-cv', b), function (ctx, w, h, t) { var f = art('drawTalentIcon'); if (f) f(ctx, w * 0.12, h * 0.12, mn(w, h) * 0.76, nd.icon || 'star', br.col, t); }, { fps: 12 }));
      tap(b, function () { tlOpenPop(nd.id); }, 'click');
      wrap.appendChild(b); wrap.appendChild(lab);
      TL.nodes[nd.id] = { nd: nd, el: b, lab: lab };
    });
    var tree = $('.mt-tl-tree', root); tree.scrollTop = 0;
    tlLayout();
    tlRender(true);
  }
  function tlLayout() {
    if (!TL) return;
    var br = tlBranch(); if (!br) return;
    var tree = $('.mt-tl-tree', TL.root), W = tree.clientWidth || 360;
    var maxRow = 0; (br.nodes || []).forEach(function (nd) { if (nd.row > maxRow) maxRow = nd.row; });
    var TH = tree.clientHeight || 520, top = 42;
    var gut = 34, colW = (W - gut - 10) / 3, rowH = clamp(mn(colW * 0.92, (TH - top - 74) / mx(1, maxRow)), 80, 104);
    var nodeS = clamp(mn(colW * 0.5, rowH * 0.62), 46, 60);
    var Hh = top + maxRow * rowH + 74;
    TL.geo = { gut: gut, colW: colW, rowH: rowH, top: top, W: W, H: Hh, nodeS: nodeS };
    var grid = $('.mt-tl-grid', TL.root);
    grid.style.height = Hh + 'px';
    TL.root.style.setProperty('--tn', nodeS + 'px');
    for (var k in TL.nodes) {
      var o = TL.nodes[k], x = tlX(o.nd.col), y = tlY(o.nd.row);
      o.el.style.left = x + 'px'; o.el.style.top = y + 'px';
      o.lab.style.left = x + 'px'; o.lab.style.top = (y + nodeS * (o.nd.big ? 0.66 : 0.5) + (o.nd.big ? 11 : 8)) + 'px';
      o.lab.style.width = (colW - 6) + 'px';
    }
    var svg = $('.mt-tl-svg', TL.root); svg.setAttribute('width', W); svg.setAttribute('height', Hh); svg.setAttribute('viewBox', '0 0 ' + W + ' ' + Hh);
    TL.linesKey = '';
    tlRender(true);
  }
  function tlX(col) { var g = TL.geo; return g.gut + g.colW * (col + 0.5); }
  function tlY(row) { var g = TL.geo; return g.top + row * g.rowH; }
  function tlState(nd) {
    var r = call('talentRank', TL.id, nd.id) || 0, max = nd.max || 1;
    var c = call('canRank', TL.id, nd.id) || { ok: false, code: 'none' };
    var reqOk = (nd.req || []).every(function (q) { return (call('talentRank', TL.id, q) || 0) >= 1; });
    var spent = call('branchSpent', TL.id, tlBranch().id) || 0, rowOk = spent >= nd.row * 3;
    var st = r >= max ? 'max' : r > 0 ? 'part' : (reqOk && rowOk) ? (c.ok ? 'avail' : 'open') : 'locked';
    return { r: r, max: max, c: c, reqOk: reqOk, rowOk: rowOk, st: st, spent: spent };
  }
  function tlRender(force) {
    if (!TL || !TL.geo) return;
    var r = rev(); if (!force && r === TL.rev && r !== -1) { TL.dirty = false; return; }
    TL.rev = r; TL.dirty = false;
    var root = TL.root, br = tlBranch(), id = TL.id;
    var tp = call('talentPoints', id) || { free: 0, used: 0, total: 0 };
    var pts = $('.mt-pts', root); tweenTo($('b', pts), tp.free, fmt, 300); tog(pts, 'has', tp.free > 0);
    (TL.h.talents || []).forEach(function (b2, i) { setText($$('.mt-tlt small', root)[i], fmt(call('branchSpent', id, b2.id) || 0) + ' puan'); });
    var spent = call('branchSpent', id, br.id) || 0, cap = 0; (br.nodes || []).forEach(function (nd) { cap += nd.max || 1; });
    setHTML($('.mt-tl-sum', root), '<span>Bu dal <b class="num">' + spent + '/' + cap + '</b></span><span>Toplam <b class="num">' + tp.used + '/' + tp.total + '</b></span>');
    // nodes
    var states = {};
    for (var k in TL.nodes) {
      var o = TL.nodes[k], s = tlState(o.nd); states[k] = s;
      o.el.className = 'mt-tn' + (o.nd.big ? ' big' : '') + ' st-' + s.st + (TL.sel === k ? ' sel' : '');
      o.el.style.setProperty('--p', (s.r / s.max * 100) + '%');
      setText($('.mt-tn-rk', o.el), s.r + '/' + s.max);
      tog(o.lab, 'on', s.r > 0); tog(o.lab, 'lk', s.st === 'locked');
      if (o.last != null && s.r > o.last) { restart(o.el, 'mt-tpop'); }
      o.last = s.r;
    }
    // row gates
    var maxRow = 0; (br.nodes || []).forEach(function (nd) { if (nd.row > maxRow) maxRow = nd.row; });
    var gh = '';
    for (var row = 1; row <= maxRow; row++) {
      var need = row * 3, ok = spent >= need, y = tlY(row), g = TL.geo;
      gh += '<div class="mt-gate' + (ok ? ' ok' : '') + '" style="top:' + y + 'px">' + (ok ? gl('check') : gl('lock')) + '<b class="num">' + need + '</b></div>' +
        '<div class="mt-gline' + (ok ? ' ok' : '') + '" style="top:' + round(((y - g.rowH + g.nodeS * 0.56 + 18) + (y - g.nodeS * 0.5 - 5)) / 2) + 'px;left:' + (g.gut - 4) + 'px"></div>';
    }
    setHTML($('.mt-tl-gates', root), gh);
    // connectors
    var lines = '', g2 = TL.geo, key = '', lit = {}, prevLit = TL.lit;
    (br.nodes || []).forEach(function (nd) {
      (nd.req || []).forEach(function (q) {
        var a = TL.nodes[q]; if (!a) return;
        var on = (states[q] && states[q].r >= 1), full = on && states[nd.id] && states[nd.id].r >= 1;
        key += q + nd.id + (on ? 1 : 0) + (full ? 1 : 0);
        var x1 = tlX(a.nd.col), y1 = tlY(a.nd.row), x2 = tlX(nd.col), y2 = tlY(nd.row);
        var d = x1 === x2 ? 'M' + x1 + ' ' + y1 + 'L' + x2 + ' ' + y2 : 'M' + x1 + ' ' + y1 + 'C' + x1 + ' ' + (y1 + (y2 - y1) * 0.55) + ' ' + x2 + ' ' + (y1 + (y2 - y1) * 0.45) + ' ' + x2 + ' ' + y2;
        lines += '<path class="mt-ln-b" d="' + d + '"/>';
        if (on) {
          lit[q + '>' + nd.id] = 1;
          var nw = prevLit && !prevLit[q + '>' + nd.id] ? ' new' : '';
          lines += '<path class="mt-ln-g' + (full ? ' full' : '') + nw + '" d="' + d + '" filter="url(#' + TL.gid + ')"/><path class="mt-ln-l' + (full ? ' full' : '') + nw + '" d="' + d + '"/>';
        }
        else lines += '<path class="mt-ln-o" d="' + d + '"/>';
      });
    });
    if (key !== TL.linesKey) { TL.linesKey = key; $('.mt-tl-g', root).innerHTML = lines; }
    TL.lit = lit;
    if (TL.sel) tlPopRender();
  }
  function tlOpenPop(nid) {
    if (!TL) return;
    TL.sel = nid;
    var pop = $('.mt-tl-pop', TL.root), o = TL.nodes[nid]; if (!o) return;
    var br = tlBranch();
    pop.innerHTML = '<div class="mt-tp-h"><span class="mt-tp-ic"></span><div class="mt-tp-ht"><b class="mt-tp-n"></b><small class="mt-tp-r"></small></div><button class="mt-tp-x" type="button" aria-label="Kapat">' + gl('plus') + '</button></div>' +
      '<div class="mt-tp-eff"></div><div class="mt-tp-tot"></div><p class="mt-tp-txt" hidden></p><div class="mt-tp-req"></div>' +
      '<button class="btn btn-gold mt-tp-go" type="button">' + gl('plus') + '<span>Puan Ver</span></button>';
    stopAll(TL.popCvs || (TL.popCvs = []));
    glyphCv($('.mt-tp-ic', pop), o.nd.icon || 'star', br.col, TL.popCvs, 15);
    tap($('.mt-tp-x', pop), tlClosePop, 'close');
    holdable($('.mt-tp-go', pop), function (n) { return tlRank(n); });
    pop.hidden = false; TL.root.classList.add('mt-popopen');
    restart(pop, 'mt-popin');
    tlRender(true);
    tlKeepVisible(o);
  }
  /* keep the selected node visible above the bottom sheet (the grid gets a matching bottom margin) */
  function tlKeepVisible(o) {
    if (!TL || !o) return;
    var tree = $('.mt-tl-tree', TL.root), pop = $('.mt-tl-pop', TL.root), grid = $('.mt-tl-grid', TL.root);
    var tr = tree.getBoundingClientRect(), pr = pop.getBoundingClientRect();
    var covered = mx(0, tr.bottom - pr.top + 10);
    grid.style.marginBottom = covered + 'px';
    var y = tlY(o.nd.row), half = TL.geo.nodeS * (o.nd.big ? 0.66 : 0.5) + 24;
    var visTop = tree.scrollTop, visBot = tree.scrollTop + tree.clientHeight - covered;
    var target = null;
    if (y + half > visBot) target = y + half - (tree.clientHeight - covered) + 8;
    else if (y - half < visTop) target = y - half - 8;
    if (target != null) requestAnimationFrame(function () { tree.scrollTo({ top: mx(0, target), behavior: RM ? 'auto' : 'smooth' }); });
  }
  function tlClosePop() {
    if (!TL) return;
    TL.sel = null; var pop = $('.mt-tl-pop', TL.root); if (pop) pop.hidden = true; TL.root.classList.remove('mt-popopen');
    var grid = $('.mt-tl-grid', TL.root); if (grid) grid.style.marginBottom = '';
    stopAll(TL.popCvs);
    for (var k in TL.nodes) TL.nodes[k].el.classList.remove('sel');
  }
  function tlPopRender() {
    var o = TL.nodes[TL.sel]; if (!o) return;
    var pop = $('.mt-tl-pop', TL.root), nd = o.nd, s = tlState(nd), br = tlBranch();
    pop.style.setProperty('--bc', br.col);
    setText($('.mt-tp-n', pop), nd.n + (nd.big ? ' ★' : ''));
    setText($('.mt-tp-r', pop), (nd.big ? 'Zirve yeteneği · ' : '') + 'Seviye ' + s.r + '/' + s.max);
    var effKeys = Object.keys(nd.eff || {});
    setHTML($('.mt-tp-eff', pop), effKeys.map(function (k) { return '<span>' + (s.max > 1 ? 'Her seviye: ' : '') + esc(statN(k)) + ' <b>' + svs(k, nd.eff[k]) + '</b></span>'; }).join(''));
    setHTML($('.mt-tp-tot', pop), s.max > 1 ? effKeys.map(function (k) {
      return '<span>Şu an <b>' + svs(k, nd.eff[k] * s.r) + '</b></span>' + (s.r < s.max ? '<i>' + gl('back') + '</i><span class="nx">Sonraki <b>' + svs(k, nd.eff[k] * (s.r + 1)) + '</b></span>' : '<span class="mx">En yüksek</span>');
    }).slice(0, 2).join('') : '');
    var tx = $('.mt-tp-txt', pop); tx.hidden = !nd.text; setText(tx, nd.text || '');
    var req = '';
    (nd.req || []).forEach(function (q) {
      var qn = TL.nodes[q], ok = (call('talentRank', TL.id, q) || 0) >= 1;
      req += '<span class="' + (ok ? 'ok' : 'no') + '">' + gl(ok ? 'check' : 'lock') + 'Gerekli: ' + esc(qn ? qn.nd.n : q) + '</span>';
    });
    if (nd.row > 0) req += '<span class="' + (s.rowOk ? 'ok' : 'no') + '">' + gl(s.rowOk ? 'check' : 'lock') + 'Bu dalda ' + nd.row * 3 + ' puan (' + mn(s.spent, nd.row * 3) + '/' + nd.row * 3 + ')</span>';
    setHTML($('.mt-tp-req', pop), req);
    var go2 = $('.mt-tp-go', pop), tp = call('talentPoints', TL.id) || { free: 0 };
    tog(go2, 'off', !s.c.ok); tog(go2, 'mt-maxd', s.r >= s.max);
    setHTML($('span', go2), s.r >= s.max ? 'En Yüksek Seviye' : !s.c.ok && s.c.code === 'points' ? 'Puan yok · Seviye atla' : 'Puan Ver <small>(' + tp.free + ')</small>');
    for (var k in TL.nodes) tog(TL.nodes[k].el, 'sel', k === TL.sel);
  }
  function tlRank(n) {
    if (!TL || !TL.sel) return false;
    var o = TL.nodes[TL.sel], nd = o.nd, c = call('canRank', TL.id, nd.id);
    if (!c || !c.ok) {
      if (n === 0 || (c && c.code === 'points')) toast(c ? c.reason : 'Puan verilemez', c && c.code === 'max' ? 'info' : 'warn');
      if (c && c.code === 'req') { var q = TL.nodes[c.need]; if (q) restart(q.el, 'mt-shake'); }
      return false;
    }
    if (!call('rankTalent', TL.id, nd.id)) return false;
    var br = tlBranch(), r = call('talentRank', TL.id, nd.id) || 0;
    if (nd.big) { snd('legendary'); toast(nd.n + ' açıldı!', 'rare'); burst(o.el, { col: br.col, n: 50, speed: 260, cols: [br.col, '#FFCB57', '#FFFFFF'], ringK: 1.6 }); }
    else { snd('upgrade', { pitch: 1 + r * 0.08 }); burst(o.el, { col: br.col, n: 14 + r * 2, speed: 140 }); }
    tlRender(true);
    return r < (nd.max || 1);
  }
  function tlReset() {
    if (!TL) return;
    var tp = call('talentPoints', TL.id) || { used: 0 }, cost = resetGems();
    if (!tp.used) { toast('Sıfırlanacak puan yok', 'info'); return; }
    if (gems() < cost) { snd('error'); toast('Yetersiz elmas: ' + fmt(cost) + ' gerekiyor', 'warn'); return; }
    var hid = TL.id;
    confirmBox({ title: 'Yetenekleri sıfırla', text: TL.h.n + ' kahramanının bütün yetenek puanları (' + tp.used + ') iade edilecek. Bedeli ' + fmt(cost) + ' elmas.', ok: 'Sıfırla', cancel: 'Vazgeç', danger: true, icon: 'warn' }).then(function (y) {
      if (!y || !TL || TL.id !== hid) return;
      if (call('resetTalents', hid)) {
        snd('whoosh'); toast(tp.used + ' yetenek puanı iade edildi', 'ok');
        for (var k in TL.nodes) { TL.nodes[k].last = 0; restart(TL.nodes[k].el, 'mt-tfade'); }
        tlClosePop(); tlRender(true);
      } else toast('Sıfırlanamadı', 'warn');
    });
  }

  /* ============================================================================================
   * GELİŞİM — Eğitim (gold) + Nitelikler (GTA-style, grow only by playing)
   * ========================================================================================== */
  var GE = null;
  var TR_COL = { atk: '#FF7A5A', hp: '#FF5C7A', def: '#6FB6FF', crit: '#FFCB57' };
  var AT_COL = { dayaniklilik: '#FF4D6A', guc: '#FF9A3C', nisan: '#5BD16E', ceviklik: '#3EDBC8', buyu: '#B57BFF', hayatta: '#FFCB57' };
  function trInfo(t) {
    var i = call('trainInfo', t.id); if (i) return i;
    var p = P(), lvl = p && p.train ? +p.train[t.id] || 0 : 0, cost = call('trainCost', t.id) || round(t.costBase * Math.pow(t.costGrow, lvl));
    return { id: t.id, lvl: lvl, max: t.max, per: t.per, bonus: t.per * lvl, next: t.per * mn(t.max, lvl + 1), cost: cost, maxed: lvl >= t.max, ok: lvl < t.max && gold() >= cost };
  }
  function attrNeedL(a, L) { var v = call('attrNeed', a.id, L); return typeof v === 'number' && v > 0 ? v : round((a.base || 3) * Math.pow(L + 1, 1.6)); }
  function attrEff(a, L) {
    var out = [];
    if (a.eff && a.eff.key) out.push({ k: a.eff.key, v: a.eff.per * L });
    if (a.eff2 && a.eff2.key) out.push({ k: a.eff2.key, v: a.eff2.per * L });
    return out;
  }
  function geMount(root, params) {
    params = params || {};
    root.classList.add('mt-scr', 'mt-gel');
    if (params.tab) UIS.gtab = params.tab === 'nitelik' || params.tab === 'Nitelikler' ? 'nitelik' : 'egitim';
    root.innerHTML = '<header class="mt-hd mt-hd-tab"><div class="mt-hd-t"><h2 class="ttl">Gelişim</h2><small>Altınla eğit · Savaşarak ustalaş</small></div>' +
      '<div class="mt-hd-r"><span class="mt-chip-pow">' + ui('swords') + '<b class="num"></b></span></div></header>' +
      '<div class="tabs mt-gtabs"><button class="tab" type="button" data-t="egitim">Eğitim<b class="dot" hidden></b></button>' +
      '<button class="tab" type="button" data-t="nitelik">Nitelikler</button></div>' +
      '<div class="mt-gbody scroll"><div class="mt-gp mt-gp-tr"></div><div class="mt-gp mt-gp-at"></div></div>';
    GE = { root: root, cvs: [], rev: -2, rows: {}, cards: {}, unsub: onChange(function () { if (GE) GE.dirty = true; }) };
    $$('.mt-gtabs .tab', root).forEach(function (b) { tap(b, function () { geTab(b.getAttribute('data-t')); }, 'tab'); });
    geBuildTraining(); geBuildAttrs();
    geTab(UIS.gtab || 'egitim', true);
  }
  function geUnmount() { if (!GE) return; stopAll(GE.cvs); if (GE.unsub) GE.unsub(); GE = null; }
  function geFrame() { if (GE && GE.dirty) geRender(false); }
  function geTab(t, first) {
    if (!GE) return;
    UIS.gtab = t;
    $$('.mt-gtabs .tab', GE.root).forEach(function (b) { tog(b, 'on', b.getAttribute('data-t') === t); });
    var tr = $('.mt-gp-tr', GE.root), at = $('.mt-gp-at', GE.root);
    tr.hidden = t !== 'egitim'; at.hidden = t !== 'nitelik';
    $('.mt-gbody', GE.root).scrollTop = 0;
    restart(t === 'egitim' ? tr : at, 'mt-panein');
    if (t === 'nitelik') { GE.atAnim = true; }
    geRender(true);
  }
  function geBuildTraining() {
    var pane = $('.mt-gp-tr', GE.root);
    var head = '<div class="panel mt-trhead"><div class="mt-trh-t">' + gl('silah') + '<div><b>Kışla</b><span>Altınla kalıcı eğitim. Bütün kahramanlarda geçerli; savaştan bağımsız, anında güç.</span></div></div>' +
      '<div class="mt-trh-sum">' + trainings().map(function (t) {
        return '<span style="--tc:' + (TR_COL[t.id] || '#FFCB57') + '">' + gl(t.id === 'atk' ? 'silah' : t.id === 'hp' ? 'heart' : t.id === 'def' ? 'shield' : 'crit') + '<b class="num" data-s="' + t.id + '"></b></span>';
      }).join('') + '</div></div>';
    pane.innerHTML = head;
    trainings().forEach(function (t, i) {
      var col = TR_COL[t.id] || '#FFCB57';
      var r = mk('div', 'mt-tr'); r.style.setProperty('--tc', col);
      if (!RM) { r.classList.add('mt-in'); r.style.animationDelay = (i * 0.05) + 's'; }
      r.innerHTML = '<span class="mt-tr-ic"></span>' +
        '<div class="mt-tr-m"><div class="mt-tr-n"><b>' + esc(t.n) + '</b><span class="num mt-tr-lv"></span></div>' +
        '<div class="pbar mt-tr-bar"><i></i></div>' +
        '<div class="mt-tr-b"><span>' + esc(statN(t.key)) + '</span><b class="num mt-tr-c"></b><i class="mt-tr-ar">' + gl('back') + '</i><b class="num mt-tr-x"></b></div>' +
        (t.desc ? '<div class="mt-tr-d">' + esc(t.desc) + '</div>' : '') + '</div>' +
        '<button class="btn btn-gold btn-sm mt-tr-go" type="button"><span class="mt-bt">Geliştir</span><span class="mt-bc"></span></button>';
      glyphCv($('.mt-tr-ic', r), t.icon || 'star', col, GE.cvs, 10);
      holdable($('.mt-tr-go', r), function (n) { return geTrain(t, r, n); });
      pane.appendChild(r);
      GE.rows[t.id] = r;
    });
  }
  function geTrain(t, row, n) {
    var inf = trInfo(t);
    if (inf.maxed) { if (n === 0) toast(t.n + ' en yüksek seviyede', 'info'); return false; }
    if (gold() < inf.cost) { toast('Yetersiz altın: ' + fmt(inf.cost) + ' gerekiyor', 'warn'); return false; }
    if (!call('train', t.id)) return false;
    snd('upgrade', { pitch: 1 + mn(n, 24) * 0.025 });
    var ic = $('.mt-tr-ic', row);
    burst(ic, { col: TR_COL[t.id] || '#FFCB57', n: 10 + mn(n, 8), speed: 120 });
    restart(ic, 'mt-pulse');
    floatNum(ic, svs(t.key, t.per), TR_COL[t.id] || '#FFCB57');
    geRender(true);
    var i2 = trInfo(t);
    if (i2.maxed) { toast(t.n + ' tamamlandı!', 'rare'); return false; }
    return true;
  }
  function geBuildAttrs() {
    var pane = $('.mt-gp-at', GE.root);
    pane.innerHTML = '<div class="panel mt-athead"><div class="mt-ath-top"><span class="mt-ath-ic">' + ui('clock') + '</span><div><b>Yalnızca savaşarak gelişir</b>' +
      '<p>Nitelikler altınla ya da elmasla alınamaz. Koş, öldür, nişan al, kıl payı kaç, hayatta kal: her savaş seni biraz daha usta yapar. ' +
      '100. seviye yüzlerce savaş süren gerçek bir ustalıktır.</p></div></div>' +
      '<div class="mt-ath-tot"><span>Toplam ustalık</span><div class="pbar teal"><i></i></div><b class="num"></b></div></div>';
    attrDefs().forEach(function (a, i) {
      var col = a.col || AT_COL[a.id] || '#FFCB57';
      var c = mk('div', 'mt-at'); c.style.setProperty('--ac', col);
      if (!RM) { c.classList.add('mt-in'); c.style.animationDelay = (i * 0.05) + 's'; }
      var segs = ''; for (var s = 0; s < 10; s++) segs += '<i><b></b></i>';
      c.innerHTML = '<div class="mt-at-top"><span class="mt-at-ic"></span><div class="mt-at-t"><b>' + esc(a.n) + '</b><small>' +
        attrEff(a, 1).map(function (e) { return esc(statN(e.k)); }).join(' · ') + '</small></div>' +
        '<div class="mt-at-lv"><b class="num">0</b><i>/' + attrMax() + '</i></div></div>' +
        '<div class="mt-seg">' + segs + '</div><div class="mt-seg-l"><span>0</span><span>25</span><span>50</span><span>75</span><span>100</span></div>' +
        '<div class="mt-at-xp"><span>Sonraki seviye</span><div class="pbar"><i></i></div><b class="num"></b></div>' +
        '<div class="mt-at-eff"><div class="mt-ae-now"><small>Şu anki etki</small><b></b></div><div class="mt-ae-nx"><small></small><b></b></div></div>' +
        '<div class="mt-at-how">' + gl('info') + '<span><b>Nasıl gelişir?</b> ' + esc(a.how || '') + '</span></div>' +
        '<div class="mt-at-tot"></div>';
      var draw = function (ctx, w, h, t) { var f = art('drawAttrIcon'); if (f) f(ctx, 0, 0, mn(w, h), a.icon || 'star', t); };
      GE.cvs.push(cvs($('.mt-at-ic', c), draw, { fps: 10 }));
      pane.appendChild(c);
      GE.cards[a.id] = c;
    });
  }
  function fmtTotal(a, v) {
    v = +v || 0;
    if (a.src === 'distance') return fmt(v / (a.unitDiv || 50)) + ' m';
    if (a.src === 'time') {
      var h = floor(v / 3600), m = floor(v % 3600 / 60);
      return h > 0 ? fmt(h) + ' sa ' + m + ' dk' : m + ' dk ' + round(v % 60) + ' sn';
    }
    return fmt(v);
  }
  function geRender(force) {
    if (!GE) return;
    var r = rev(); if (!force && r === GE.rev && r !== -1) { GE.dirty = false; return; }
    GE.rev = r; GE.dirty = false;
    var root = GE.root;
    tweenTo($('.mt-hd-r .mt-chip-pow b', root), power(), fmt, 500);
    // training
    var anyOk = false;
    trainings().forEach(function (t) {
      var row = GE.rows[t.id]; if (!row) return;
      var inf = trInfo(t);
      if (inf.ok) anyOk = true;
      setHTML($('.mt-tr-lv', row), 'Sv. ' + fmt(inf.lvl) + '<i>/' + fmt(inf.max) + '</i>');
      $('.mt-tr-bar>i', row).style.width = (100 * inf.lvl / inf.max) + '%';
      var cEl = $('.mt-tr-c', row);
      tweenTo(cEl, inf.bonus, function (v) { return svs(t.key, v); }, 380);
      setText($('.mt-tr-x', row), inf.maxed ? 'EN YÜKSEK' : svs(t.key, inf.next));
      $('.mt-tr-ar', row).hidden = inf.maxed;
      var b = $('.mt-tr-go', row);
      tog(b, 'off', !inf.ok); tog(row, 'maxed', inf.maxed);
      setText($('.mt-bt', b), inf.maxed ? 'Tamam' : 'Geliştir');
      setHTML($('.mt-bc', b), inf.maxed ? '' : '<span class="cost' + (gold() < inf.cost ? ' no' : '') + '">' + ui('gold') + fmt(inf.cost) + '</span>');
      var se = $('.mt-trh-sum b[data-s="' + t.id + '"]', root);
      if (se) setText(se, svs(t.key, inf.bonus));
    });
    var td = $('.mt-gtabs .tab[data-t="egitim"] .dot', root); if (td) { td.hidden = !anyOk; td.textContent = ''; }
    // attributes
    var tot = 0, AM = attrMax(), A = attrDefs(), p = P();
    A.forEach(function (a) {
      var c = GE.cards[a.id]; if (!c) return;
      var at = call('attr', a.id) || { lvl: 0, xp: 0, need: attrNeedL(a, 0), pct: 0 };
      var L = at.lvl || 0, pct = L >= AM ? 1 : clamp(+at.pct || 0, 0, 1);
      tot += L;
      var lb = $('.mt-at-lv b', c);
      if (GE.atAnim && !RM) { lb.__mtv = 0; }
      tweenTo(lb, L, fmt, 900);
      var segs = $$('.mt-seg i', c), prog = (L + pct) / 10;
      segs.forEach(function (sg, i) {
        var f = clamp(prog - i, 0, 1);
        var bEl = sg.firstChild;
        if (GE.atAnim && !RM) { bEl.style.transition = 'none'; bEl.style.width = '0%'; }
        sg.className = f >= 1 ? 'done' : f > 0 ? 'cur' : '';
        bEl.__w = (f * 100) + '%';
      });
      $('.mt-at-xp .pbar>i', c).style.width = (pct * 100) + '%';
      setText($('.mt-at-xp b', c), L >= AM ? 'Ustalık tamam' : fmt(at.xp) + ' / ' + fmt(at.need) + ' TP');
      var now2 = attrEff(a, L), nx = attrEff(a, mn(AM, L + 1));
      setHTML($('.mt-ae-now b', c), now2.map(function (e) { return esc(statN(e.k)) + ' <em>' + svs(e.k, e.v) + '</em>'; }).join('<br>'));
      setText($('.mt-ae-nx small', c), L >= AM ? 'En yüksek seviye' : 'Seviye ' + (L + 1));
      setHTML($('.mt-ae-nx b', c), L >= AM ? '★' : nx.map(function (e) { return svs(e.k, e.v); }).join('<br>'));
      // lifetime totals + estimate
      var total = at.total != null ? at.total : (p && p.totals ? +p.totals[a.src === 'time' ? 'playSec' : a.src] || 0 : 0);
      var remain = 0; for (var q = L; q < AM; q++) remain += attrNeedL(a, q);
      remain = mx(0, remain - (+at.xp || 0));
      var per = (a.est || 0) * (a.factor || 0), runs = per > 0 ? Math.ceil(remain / per) : 0;
      setHTML($('.mt-at-tot', c), '<span>' + esc(a.srcN || 'Toplam') + ': <b class="num">' + fmtTotal(a, total) + '</b></span>' +
        (L >= AM ? '<span class="mt-done">' + gl('crown') + 'Usta</span>' : runs ? '<span>100. seviyeye ≈ <b class="num">' + fmt(runs) + '</b> savaş</span>' : ''));
    });
    $('.mt-ath-tot .pbar>i', root).style.width = (100 * tot / (A.length * AM)) + '%';
    setHTML($('.mt-ath-tot b', root), fmt(tot) + '<i>/' + fmt(A.length * AM) + '</i>');
    // play the bar fill-in after layout
    var anim = GE.atAnim; GE.atAnim = false;
    requestAnimationFrame(function () {
      if (!GE) return;
      $$('.mt-seg i>b', GE.root).forEach(function (bEl, i) {
        if (anim && !RM) { bEl.style.transition = ''; bEl.style.transitionDelay = (i % 10) * 0.05 + 's'; }
        if (bEl.__w != null) bEl.style.width = bEl.__w;
      });
    });
  }

  /* ============================================================================================
   * Nav badges
   * ========================================================================================== */
  function badges() {
    var out = { ekipman: 0, kahraman: 0, gelisim: 0 };
    var p = P(); if (!p) return out;
    try {
      var nc = call('newCount');
      if (typeof nc !== 'number') { nc = 0; (p.items || []).forEach(function (it) { if (it.new && p.equip[it.slot] !== it.uid) nc++; }); }
      out.ekipman = nc;
      var up = 0;
      slots().forEach(function (sd) { var it = equippedItem(sd.id); if (it) { var c = call('canUpgrade', it); if (c && c.ok) up++; } });
      if (up) out.ekipman += 1;
      var mg = call('mergeGroups'); if (mg && mg.length) out.ekipman += 1;
      heroDefs().forEach(function (h) { if (heroBadge(h.id) > 0) out.kahraman++; });
      trainings().forEach(function (t) { if (trInfo(t).ok) out.gelisim++; });
    } catch (e) { report(e, 'badges'); }
    return out;
  }

  /* ============================================================================================
   * Registration + public namespace
   * ========================================================================================== */
  var SCREENS = {
    ekipman: { title: 'Ekipman', tab: 'ekipman', bg: 'dim', mount: eqMount, unmount: eqUnmount, frame: eqFrame, refresh: function () { eqRefresh(false); } },
    kahraman: { title: 'Kahramanlar', tab: 'kahraman', bg: 'dim', mount: heroesMount, unmount: heroesUnmount,
      frame: function () { if (HR && HR.dirty) heroesRefresh(false); }, refresh: function () { heroesRefresh(false); } },
    'kahraman-detay': { title: 'Kahraman', tab: 'kahraman', bg: 'dim', mount: hdMount, unmount: hdUnmount, frame: hdFrame, refresh: function () { hdRender(false); } },
    yetenek: { title: 'Yetenek Ağacı', tab: 'kahraman', bg: 'dim', mount: tlMount, unmount: tlUnmount, frame: tlFrame, refresh: function () { tlRender(false); } },
    gelisim: { title: 'Gelişim', tab: 'gelisim', bg: 'dim', mount: geMount, unmount: geUnmount, frame: geFrame, refresh: function () { geRender(false); } }
  };
  // every lifecycle hook is wrapped so one bad frame never takes the lobby down
  Object.keys(SCREENS).forEach(function (id) {
    var d = SCREENS[id];
    ['mount', 'unmount', 'frame', 'refresh'].forEach(function (k) {
      var f = d[k]; if (typeof f !== 'function') return;
      d[k] = function (a, b) { try { return f(a, b); } catch (e) { report(e, id + '.' + k); } return undefined; };
    });
  });
  var inited = false, registered = false, tries = 0;
  function register() {
    if (registered) return;
    if (!(GM.UI && typeof GM.UI.reg === 'function')) {
      if (tries++ < 600) { if (window.requestAnimationFrame) requestAnimationFrame(register); else setTimeout(register, 16); }
      return;
    }
    registered = true;
    Object.keys(SCREENS).forEach(function (id) { safe(function () { GM.UI.reg(id, SCREENS[id]); }, 'reg ' + id); });
    uiRefresh();
  }

  GM.UIMeta = {
    init: function () {
      if (inited) return; inited = true;
      register();
      if (!registered && document.readyState === 'loading') document.addEventListener('DOMContentLoaded', register);
    },
    badges: badges,
    openItem: function (uid) { return openItem(uid); },
    openSkins: function (target, item) { return openSkins(target, item || null); },
    openMerge: function (uid) { mergeEnter(uid || null); },
    openHero: function (id) { go('kahraman-detay', { id: id }); },
    openTalents: function (id) { go('yetenek', { id: id }); },
    openSet: openSet,
    burst: burst,
    screens: SCREENS
  };
})(window.GM = window.GM || {});
