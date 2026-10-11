/* GÖLGE MUHAFIZLARI — art-hero.js  (owner: art-hero)
 * Hero-side art for GM.Art (SPEC §4.1). Pure procedural Canvas 2D, no assets.
 *
 *  GM.Art.drawHero(ctx, x, y, scale, o)
 *      Feet at (x, y). scale 1 ≈ 100 px tall, head ≈ 45 % of the height.
 *      o = { look:LOOK, t, anim:'idle'|'walk'|'attack'|'hurt'|'victory'|'cast', dir:1|-1, atkP:0..1,
 *            glow:true, shadow:true, lite:false,
 *            moving:false  (optional extra: legs keep walking while anim === 'attack'),
 *            hurtP:0..1    (optional extra: progress of the 'hurt' reaction; otherwise it loops on t) }
 *      Both modes render the body through an LRU frame cache keyed by look + anim frame bucket + device scale
 *      (vector art is drawn once per bucket, then blitted). lite:true = coarse buckets + pre-rendered aura loops
 *      (battle: ~5-10 µs per call); full = fine buckets + live aura/particles (lobby, paper-doll, hero screens).
 *      Idle breathing is applied continuously at blit time; missing buckets of an anim are prewarmed in idle time.
 *      Never throws: an internal error is stored in GM.Art._heroErr and the call draws nothing.
 *  GM.Art.drawItemIcon(ctx, x, y, size, item|seed, t)          (x, y) = TOP-LEFT corner of the square
 *  GM.Art.drawHeroPortrait(ctx, x, y, size, heroId, t, heroSkin) (x, y) = top-left; bust centred so a circle crop works
 *  GM.Art.drawTalentIcon(ctx, x, y, size, iconName, color, t)    (x, y) = top-left; transparent background glyph
 *  GM.Art.drawAttrIcon(ctx, x, y, size, iconName, t)              (x, y) = top-left; same glyph set, own colours
 *  Extras: GM.Art.heroLook(heroId, heroSkin) -> minimal LOOK (no gear), GM.Art.clearHeroCache(), GM.Art._stats()
 */
(function (GM) {
  'use strict';
  var Art = GM.Art = GM.Art || {};

  // ------------------------------------------------------------------------------------------ math
  var PI = Math.PI, TAU = PI * 2, HP = PI / 2;
  var sin = Math.sin, cos = Math.cos, abs = Math.abs, mn = Math.min, mx = Math.max, sqrt = Math.sqrt;
  var atan2 = Math.atan2, floor = Math.floor, round = Math.round, pow = Math.pow;
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function lerp(a, b, k) { return a + (b - a) * k; }
  function sm(k) { k = clamp(k, 0, 1); return k * k * (3 - 2 * k); }
  function eOut(k) { k = 1 - clamp(k, 0, 1); return 1 - k * k * k; }
  function seg(p, a, b) { return clamp((p - a) / (b - a), 0, 1); }
  function fract(v) { return v - floor(v); }
  function hstr(s) { var h = 2166136261 >>> 0; s = String(s); for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
  function noise1(x) { return sin(x * 1.7) * 0.5 + sin(x * 3.13 + 1.3) * 0.3 + sin(x * 7.1 + 0.4) * 0.2; }

  // ------------------------------------------------------------------------------------------ colour
  var OUT = '#120C18';
  var RGB = Object.create(null), MIX = Object.create(null), RGBA = Object.create(null);
  function rgb(h) {
    var c = RGB[h]; if (c) return c;
    var m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(h || '').trim());
    if (m) {
      var s = m[1]; if (s.length === 3) s = s[0] + s[0] + s[1] + s[1] + s[2] + s[2];
      var n = parseInt(s, 16); c = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    } else c = [128, 128, 128];
    RGB[h] = c; return c;
  }
  function hx(r, g, b) { return '#' + ((1 << 24) | (clamp(round(r), 0, 255) << 16) | (clamp(round(g), 0, 255) << 8) | clamp(round(b), 0, 255)).toString(16).slice(1); }
  function mix(a, b, k) {
    var key = a + b + k, v = MIX[key]; if (v) return v;
    var A = rgb(a), B = rgb(b);
    v = hx(A[0] + (B[0] - A[0]) * k, A[1] + (B[1] - A[1]) * k, A[2] + (B[2] - A[2]) * k);
    MIX[key] = v; return v;
  }
  function dk(h, k) { return mix(h, '#140B1E', k); }          // shadows lean violet-black (dark fantasy)
  function lt(h, k) { return mix(h, '#FFF7EA', k); }          // highlights lean warm (torch light)
  function rgba(h, a) {
    a = round(clamp(a, 0, 1) * 100) / 100;
    var key = h + a, v = RGBA[key]; if (v) return v;
    var c = rgb(h); v = 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + a + ')';
    RGBA[key] = v; return v;
  }

  // ------------------------------------------------------------------------------------------ canvas helpers
  function mkCv(w, h) { var cv = document.createElement('canvas'); cv.width = mx(1, w | 0); cv.height = mx(1, h | 0); return cv; }
  function devScale(c) {
    try { var m = c.getTransform(); var s = sqrt(m.a * m.a + m.b * m.b); return s > 0 ? s : 1; } catch (e) { return 1; }
  }
  var GLOW = Object.create(null);
  function glowSpr(col) {
    var cv = GLOW[col]; if (cv) return cv;
    cv = mkCv(64, 64); var g = cv.getContext('2d');
    var gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, rgba(col, 0.95)); gr.addColorStop(0.18, rgba(col, 0.62)); gr.addColorStop(0.45, rgba(col, 0.22));
    gr.addColorStop(0.75, rgba(col, 0.06)); gr.addColorStop(1, rgba(col, 0));
    g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
    GLOW[col] = cv; return cv;
  }
  // soft additive-ready blob (caller chooses composite op)
  function glow(c, x, y, rx, ry, col, a) {
    if (!(a > 0.01)) return;
    var ga = c.globalAlpha; c.globalAlpha = ga * mn(1, a);
    c.drawImage(glowSpr(col), x - rx, y - ry, rx * 2, ry * 2);
    c.globalAlpha = ga;
  }
  function addOn(c) { c.globalCompositeOperation = 'lighter'; }
  function addOff(c) { c.globalCompositeOperation = 'source-over'; }
  function spark(c, x, y, r, col, a) {
    if (!(a > 0.02)) return;
    var ga = c.globalAlpha; c.globalAlpha = ga * mn(1, a);
    c.fillStyle = col; c.beginPath();
    c.moveTo(x, y - r); c.quadraticCurveTo(x, y, x + r * 0.8, y); c.quadraticCurveTo(x, y, x, y + r);
    c.quadraticCurveTo(x, y, x - r * 0.8, y); c.quadraticCurveTo(x, y, x, y - r); c.fill();
    c.fillStyle = '#FFFFFF'; c.beginPath(); c.arc(x, y, r * 0.2, 0, TAU); c.fill();
    c.globalAlpha = ga;
  }
  // paths
  function E(c, x, y, rx, ry, r) { r = r || 0; c.moveTo(x + rx * cos(r), y + rx * sin(r)); c.ellipse(x, y, rx, ry, r, 0, TAU); }
  function Ci(c, x, y, r) { c.moveTo(x + r, y); c.arc(x, y, r, 0, TAU); }
  function RR(c, x, y, w, h, r) {
    r = mn(r, w / 2, h / 2);
    c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r);
    c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath();
  }
  function CAP(c, x1, y1, x2, y2, r1, r2) {
    if (r2 == null) r2 = r1;
    var a = atan2(y2 - y1, x2 - x1);
    c.moveTo(x2 + cos(a - HP) * r2, y2 + sin(a - HP) * r2);
    c.arc(x2, y2, r2, a - HP, a + HP);
    c.arc(x1, y1, r1, a + HP, a + PI + HP);
    c.closePath();
  }
  // Cel shading: light rim (top-left) + base + shade band (bottom-right) + sticker outline. fn(c) builds the path.
  function cel(c, fn, base, shade, light, s, h, noLine) {
    if (s == null) s = 2.4; if (h == null) h = 1.1;
    c.beginPath(); fn(c); c.fillStyle = light || base; c.fill();
    if (light || shade) {
      c.save(); c.clip();
      if (light) { c.translate(h, h * 1.1); c.beginPath(); fn(c); c.fillStyle = base; c.fill(); c.translate(-h, -h * 1.1); }
      if (shade) { c.beginPath(); fn(c); c.translate(-s, -s * 1.15); fn(c); c.fillStyle = shade; c.fill('evenodd'); }
      c.restore();
    }
    if (!noLine) { c.beginPath(); fn(c); c.stroke(); }
  }
  // flat fill + outline
  function fl(c, fn, col, noLine) { c.beginPath(); fn(c); c.fillStyle = col; c.fill(); if (!noLine) c.stroke(); }
  function line(c, x1, y1, x2, y2, col, w) { c.beginPath(); c.moveTo(x1, y1); c.lineTo(x2, y2); var s = c.strokeStyle, lw = c.lineWidth; c.strokeStyle = col; c.lineWidth = w; c.stroke(); c.strokeStyle = s; c.lineWidth = lw; }
  function strokeW(c, col, w) { var s = c.strokeStyle, lw = c.lineWidth; c.strokeStyle = col; c.lineWidth = w; c.stroke(); c.strokeStyle = s; c.lineWidth = lw; }
  // thick stroked curve with a sticker outline (bows, straps, tails)
  function rope(c, fn, col, w, lw) { c.beginPath(); fn(c); strokeW(c, OUT, w + lw * 2); strokeW(c, col, w); }

  // ------------------------------------------------------------------------------------------ data (SPEC values as fallback)
  var FB_RAR = [
    { col: '#A7ADB7', dark: '#5D6370' }, { col: '#5BD16E', dark: '#2C7A3A' }, { col: '#4BA3FF', dark: '#1F5DA8' },
    { col: '#B565FF', dark: '#6A2BB0' }, { col: '#FFB020', dark: '#A8620A' }, { col: '#FF3D4F', dark: '#8E1324' }];
  var RF = [['#6E737D', '#2E3138'], ['#3B9A4B', '#123A1C'], ['#2F78C9', '#0F2A4D'], ['#8A44D6', '#2D0F52'], ['#D9861A', '#4A2405'], ['#D42438', '#3D0410']];
  var ARMOR = ['kafa', 'yuz', 'boyun', 'omuz', 'gogus', 'kol', 'eldiven', 'kemer', 'pantolon', 'dizlik', 'ayak'];
  var WTS = { kilic: 1, yay: 1, orak: 1, asa: 1 };
  var SET_BY_RAR = [['kurt'], ['kurt', 'gece'], ['gece', 'kor'], ['kor', 'ejder'], ['ejder', 'golge'], ['golge']];
  function rarE(r) { var R = GM.D && GM.D.RARITIES; return (R && R[r]) || FB_RAR[r] || FB_RAR[0]; }
  function rarCol(r) { return rarE(r).col || FB_RAR[clamp(r, 0, 5)].col; }
  function rarDark(r) { return rarE(r).dark || FB_RAR[clamp(r, 0, 5)].dark; }
  function defaultSet(r) { var S = (GM.D && GM.D.SET_BY_RARITY) || SET_BY_RAR; var a = S[r] || SET_BY_RAR[r] || ['kurt']; return MAT[a[0]] ? a[0] : 'kurt'; }

  var FB_HERO = {   // mirrors GM.D.HEROES[].look (used only if data.js is missing)
    bora: { skin: '#F2C7A5', hair: '#5A3424', cloth: '#8E2F2F', accent: '#C9CED8', eye: '#3A2A20', extra: 'headband' },
    ela: { skin: '#F5D2B8', hair: '#C46A2B', cloth: '#2F6B4A', accent: '#D9B26A', eye: '#2F7A4F', extra: 'feathers' },
    yaman: { skin: '#D8AE8E', hair: '#20172B', cloth: '#3B1E4E', accent: '#E8394D', eye: '#B565FF', extra: 'scar' },
    ayaz: { skin: '#EED9C8', hair: '#D8E6F2', cloth: '#2B5C8A', accent: '#3EDBC8', eye: '#4BA3FF', extra: 'hood' },
    alaz: { skin: '#F0C4A0', hair: '#C2321F', cloth: '#5C1A1A', accent: '#FFB020', eye: '#FF7A2F', extra: 'horns' }
  };
  var EXTRA2HERO = { headband: 'bora', feathers: 'ela', scar: 'yaman', hood: 'ayaz', horns: 'alaz' };
  // per-hero silhouette choices (art only)
  var STY = {
    bora: { hair: 'spiky', cape: 'scarf', pants: '#3E2E30', shoe: '#4B3326', belt: '#5C3B26' },
    ela: { hair: 'pony', cape: 'mantle', back: 'quiver', pants: '#5A4330', shoe: '#5E412D', belt: '#6B4A2E', lash: true },
    yaman: { hair: 'long', cape: 'tatter', pants: '#231B30', shoe: '#2B2234', belt: '#3A2A44', glowEye: true },
    ayaz: { hair: 'braid', cape: 'fur', pants: '#34485E', shoe: '#5B4636', belt: '#6A4B32' },
    alaz: { hair: 'flame', cape: 'royal', pants: '#2C1B20', shoe: '#3A2420', belt: '#4A2A1E' }
  };
  // hero skins (cosmetic): palette overrides + silhouette extras
  var HSKIN = {
    sk_bora_kurt: { hero: 'bora', pal: { cloth: '#4D5568', accent: '#E3E8F0', eye: '#59B8FF', hair: '#4A2C1E' }, glowEye: true, hood: 'wolf', cape: 'wolfpelt', aura: '#8FC2FF', pants: '#2B2F3A', shoe: '#3A3F4C', belt: '#2E2A30' },
    sk_ela_gece: { hero: 'ela', pal: { cloth: '#1E2758', accent: '#D5DEFF', hair: '#4A3486', eye: '#62E8FF' }, glowEye: true, hood: 'night', cape: 'night', aura: '#62E8FF', pants: '#171C3A', shoe: '#20264A', belt: '#2C2F55' },
    sk_yaman_kan: { hero: 'yaman', pal: { cloth: '#5E1522', accent: '#FF4A5E', eye: '#FF4A5E' }, glowEye: true, hood: 'bear', cape: 'bear', paint: true, aura: '#FF4A5E', pants: '#2A1216', shoe: '#3A1A1A', belt: '#3E1F1C' },
    sk_ayaz_kis: { hero: 'ayaz', pal: { cloth: '#BFE4F7', accent: '#FFFFFF', hair: '#E3F3FF', eye: '#7FF3FF', skin: '#EED9CF' }, glowEye: true, hood: 'frost', cape: 'frost', frost: true, aura: '#8AF6FF', pants: '#6F9CBC', shoe: '#A9CDE3', belt: '#7FA9C7' },
    sk_alaz_kara: { hero: 'alaz', pal: { cloth: '#221B2B', accent: '#FF3D4F', hair: '#1E1726', eye: '#FF3D4F' }, glowEye: true, hairTip: '#FF3D4F', hornCol: '#2B2333', wings: 'dragon', cape: 'royal', capeCol: '#1A1420', capeIn: '#8E1324', aura: '#FF3D4F', pants: '#18131E', shoe: '#221A28', belt: '#2A1E26' }
  };
  // armour set materials. b/s/l = base/shade/light, a/aS = secondary (fur, navy cloth, ember, gold, rune), m/mS = metal fittings
  var MAT = {
    kurt: { b: '#8A5634', s: '#5A341E', l: '#B97F52', a: '#DCC49A', aS: '#9A7C56', m: '#C48A45', mS: '#7A5222', gem: '#E8743A' },
    gece: { b: '#6F7C90', s: '#414B5D', l: '#B9C5D6', a: '#283A6C', aS: '#162042', m: '#DCE4EF', mS: '#8792A3', gem: '#5FB3FF' },
    kor: { b: '#33292C', s: '#1A1417', l: '#5A4C50', a: '#FF7A2F', aS: '#C2410C', m: '#62534F', mS: '#2A2224', gem: '#FF8A3A' },
    ejder: { b: '#B42235', s: '#731326', l: '#EC566C', a: '#FFCB57', aS: '#B07A22', m: '#FFCB57', mS: '#B07A22', gem: '#FF3D4F', horn: '#F2E4C4', hornS: '#BFA47A' },
    golge: { b: '#271D36', s: '#120D1A', l: '#4B3C6A', a: '#B57BFF', aS: '#6A2BB0', m: '#3E3254', mS: '#1B1426', gem: '#B57BFF', r2: '#FF3D4F' }
  };
  function heroDef(id) {
    var H = GM.D && GM.D.HEROES;
    if (H && H.length) for (var i = 0; i < H.length; i++) if (H[i] && H[i].id === id) return H[i];
    return null;
  }

  // ------------------------------------------------------------------------------------------ look resolution (cached per look key)
  var RCACHE = new Map();
  function gk(g) { return g ? ((g.rar | 0) + (g.set || '') + (g.skin || '')) : '-'; }
  function lookKey(L) {
    var k = (L.heroId || 'bora') + '/' + (L.heroSkin || '') + '/';
    var w = L.weapon; k += w ? (w.wt || 'kilic') + (w.rar | 0) + (w.skin || '') : '-';
    var G = L.gear || {};
    for (var i = 0; i < ARMOR.length; i++) k += '/' + gk(G[ARMOR[i]]);
    return k;
  }
  function gearEntry(e, slot) {
    if (!e) return null;
    var rar = clamp(e.rar | 0, 0, 5);
    var set = MAT[e.set] ? e.set : defaultSet(rar);
    return { slot: slot, rar: rar, set: set, skin: e.skin || null, m: MAT[set], tc: rarCol(rar), td: rarDark(rar) };
  }
  function resolve(look) {
    if (!look) look = { heroId: 'bora' };
    if (typeof look === 'string') look = { heroId: look };
    var key = lookKey(look);
    var R = RCACHE.get(key); if (R) return R;
    var id = look.heroId || 'bora';
    var def = heroDef(id);
    var lk = (def && def.look) || FB_HERO[id] || FB_HERO.bora;
    var hid = STY[id] ? id : (EXTRA2HERO[lk.extra] || 'bora');
    var fb = FB_HERO[hid];
    var hs = look.heroSkin && HSKIN[look.heroSkin] || null;
    if (hs && hs.hero !== hid) hs = null;
    var sty = STY[hid];
    var pal = {};
    ['skin', 'hair', 'cloth', 'accent', 'eye'].forEach(function (k) { pal[k] = (hs && hs.pal[k]) || lk[k] || fb[k]; });
    pal.skinS = mix(pal.skin, '#9A4A5A', 0.32); pal.skinL = lt(pal.skin, 0.45); pal.blush = '#FF6F8E';
    pal.hairS = dk(pal.hair, 0.42); pal.hairL = lt(pal.hair, 0.42);
    pal.clothS = dk(pal.cloth, 0.38); pal.clothL = lt(pal.cloth, 0.28); pal.clothD = dk(pal.cloth, 0.6);
    pal.accS = dk(pal.accent, 0.35); pal.accL = lt(pal.accent, 0.45);
    pal.eyeL = lt(pal.eye, 0.55); pal.eyeD = dk(pal.eye, 0.55);
    pal.pants = (hs && hs.pants) || sty.pants; pal.pantsS = dk(pal.pants, 0.4); pal.pantsL = lt(pal.pants, 0.2);
    pal.shoe = (hs && hs.shoe) || sty.shoe; pal.shoeS = dk(pal.shoe, 0.42); pal.shoeL = lt(pal.shoe, 0.22);
    pal.belt = (hs && hs.belt) || sty.belt;
    R = { key: key, id: hid, sty: sty, hs: hs, extra: lk.extra || fb.extra, pal: pal,
      glowEye: hs ? !!hs.glowEye : !!sty.glowEye, g: {}, w: null, wt: null, maxRar: -1,
      ph: (hstr(id) % 628) / 100, n: 0 };
    var G = look.gear || {};
    for (var i = 0; i < ARMOR.length; i++) {
      var ge = gearEntry(G[ARMOR[i]], ARMOR[i]);
      R.g[ARMOR[i]] = ge;
      if (ge) { R.n++; if (ge.rar > R.maxRar) R.maxRar = ge.rar; }
    }
    var w = look.weapon;
    if (w) {
      var wr = clamp(w.rar | 0, 0, 5);
      R.w = { wt: WTS[w.wt] ? w.wt : 'kilic', rar: wr, skin: w.skin || null, tc: rarCol(wr), td: rarDark(wr) };
      R.wt = R.w.wt; if (wr > R.maxRar) R.maxRar = wr;
    }
    R.aura = R.maxRar >= 5 ? rarCol(5) : R.maxRar >= 4 ? rarCol(4) : R.maxRar >= 3 ? rarCol(3) : null;
    if (RCACHE.size > 80) RCACHE.delete(RCACHE.keys().next().value);
    RCACHE.set(key, R);
    return R;
  }

  // ------------------------------------------------------------------------------------------ pose
  // Local units (scale 1), hero faces +x, feet at (0,0), y up is negative.
  var HEAD_X = 1.5, HEAD_Y = -76, HRX = 23.5, HRY = 21.5, FX = 3.5;
  var SHO_X = 10, SHO_Y = -47, HIP_X = 4.6, HIP_Y = -19, LEG_L = 12;
  var ANIMS = { idle: 1, walk: 1, attack: 1, hurt: 1, victory: 1, cast: 1 };
  var WSC = 1.2, BOWS = 1.2;   // weapons are drawn a bit oversized (chunky mobile-game look)

  function idleArms(P, wt) {
    if (wt === 'kilic') { P.hFx = 12.5; P.hFy = -31; P.wA = 2.42; }
    else if (wt === 'yay') { P.hFx = 15.5; P.hFy = -31; P.bowR = 0.42; }
    else if (wt === 'orak') { P.hFx = 13.5; P.hFy = -33; P.wA = 2.78; }
    else if (wt === 'asa') { P.hFx = 17; P.hFy = -33; P.wA = 2.86; }
    else { P.hFx = 12; P.hFy = -30.5; }
    P.hBx = -12; P.hBy = -30.5;
  }
  function pose(anim, t, o, wt, ph) {
    var P = {
      bob: 0, lift: 0, drop: 0, lean: 0, sx: 1, sy: 1, legF: 0, legB: 0, liftF: 0, liftB: 0,
      hFx: 12, hFy: -31, hBx: -12, hBy: -31, wA: 2.4, bowR: 0, pull: 0, arrow: false, armBFront: false,
      wBehind: false, spin: null, orb: 0, burst: 0, smear: null, headT: 0, hair: 0, cape: 0,
      eyes: 'open', mouth: 'smile', brow: 0, flash: 0, cast: 0, walk: 0, wph: 0, t: t
    };
    idleArms(P, wt);
    var walking = anim === 'walk' || (anim === 'attack' && o.moving);
    var idleish = anim === 'idle' || anim === 'hurt';
    var br = idleish && !o._nobreath ? sin(t * TAU / 2.6 + ph) : 0;
    P.bob = br * 0.75; P.hFy += br * 0.45; P.hBy += br * 0.45;
    P.hair = sin(t * TAU / 2.6 + ph + 0.9) * 0.35 * (idleish ? 1 : 0.4); P.cape = sin(t * TAU / 2.6 + ph + 2) * 0.3 * (idleish ? 1 : 0.4);
    P.headT = sin(t * TAU / 2.6 + ph + 0.5) * 0.025 * (idleish ? 1 : 0);
    if (walking) {
      var wp = t * TAU / 0.56 + ph, s = sin(wp);
      P.walk = 1; P.wph = wp;
      P.legF = s * 0.55; P.legB = -s * 0.55;
      P.liftF = mx(0, cos(wp)) * 2.8; P.liftB = mx(0, -cos(wp)) * 2.8;
      P.drop = (1 - cos(0.55 * s)) * LEG_L;
      P.bob = abs(s) * 1.5 - 0.9; P.lean = 0.09; P.headT = -0.03 + sin(wp * 2) * 0.02;
      P.hair = -0.75 + sin(wp * 2) * 0.22; P.cape = -0.85 + sin(wp * 2) * 0.22;
      P.hBx += -s * 3.4; P.hBy += -abs(s) * 0.6; P.hFx += s * 1.4;
    }
    if (anim === 'attack') atkPose(P, wt, clamp(+o.atkP || 0, 0, 1));
    else if (anim === 'hurt') {
      var hp = o.hurtP != null ? clamp(+o.hurtP, 0, 1) : fract(t / 0.45);
      var k = (1 - hp) * (1 - hp);
      P.sx = 1 + 0.14 * k; P.sy = 1 - 0.12 * k; P.lean = -0.22 * k; P.headT = -0.12 * k;
      P.hFx += 3 * k; P.hFy -= 5 * k; P.hBx -= 4 * k; P.hBy -= 6 * k; P.wA += 0.4 * k;
      P.eyes = 'hurt'; P.mouth = 'wavy'; P.flash = clamp((1 - hp) * 1.5 - 0.25, 0, 1); P.hair = 0.6 * k; P.cape = 0.5 * k;
    } else if (anim === 'victory') {
      var vp = t * TAU / 1.15, j = mx(0, sin(vp));
      var land = mx(0, -sin(vp));
      P.lift = j * 6.5; P.sy = 1 - land * 0.06 + j * 0.03; P.sx = 1 + land * 0.06 - j * 0.02;
      P.hFx = 20; P.hFy = -59 - j * 2; P.wA = 2.72; P.bowR = -0.3;
      P.hBx = -17; P.hBy = -58 - j * 3 + sin(vp * 2) * 1.5;
      P.eyes = 'happy'; P.mouth = 'open'; P.hair = -j * 0.6 + 0.2; P.cape = -j * 0.5; P.headT = sin(vp) * 0.05;
      if (wt === 'orak') { P.wA = 2.62; P.hFy = -57; }
      if (wt === 'asa') { P.orb = 0.6 + j * 0.4; }
    } else if (anim === 'cast') {
      var cp = t * TAU / 1.0;
      P.hFx = 21; P.hFy = -55 + sin(cp) * 1.4; P.hBx = -15; P.hBy = -55 + sin(cp + 1.2) * 1.4;
      P.wA = 2.8; P.bowR = -0.2; P.cast = 0.75 + 0.25 * sin(cp * 2); P.eyes = 'focus'; P.mouth = 'o'; P.orb = 0.8;
      P.hair = sin(cp) * 0.2 - 0.2; P.cape = sin(cp) * 0.25 - 0.4; P.lift = 1.5 + sin(cp) * 1.2;
    }
    // blink (not during expressive faces)
    if (P.eyes === 'open' && fract((t + ph * 0.77) / 3.4) < 0.045) P.eyes = 'blink';
    if (o._blink === 1) P.eyes = P.eyes === 'open' ? 'blink' : P.eyes;
    else if (o._blink === 0 && P.eyes === 'blink') P.eyes = 'open';
    // clamp arm reach
    clampHand(P, 'F', SHO_X); clampHand(P, 'B', -SHO_X);
    return P;
  }
  function clampHand(P, s, sx) {
    var x = P['h' + s + 'x'], y = P['h' + s + 'y'], dx = x - sx, dy = y - SHO_Y, d = sqrt(dx * dx + dy * dy), L = 18;
    if (d > L) { P['h' + s + 'x'] = sx + dx * L / d; P['h' + s + 'y'] = SHO_Y + dy * L / d; }
  }
  function atkPose(P, wt, p) {
    var k;
    if (wt === 'kilic' || !wt) {
      var a0 = P.wA, x0 = P.hFx, y0 = P.hFy;
      if (p < 0.3) {
        k = eOut(p / 0.3);
        P.wA = lerp(a0, 3.78, k); P.hFx = lerp(x0, 15, k); P.hFy = lerp(y0, -63, k);
        P.lean -= 0.1 * k; P.sy = 1 + 0.04 * k; P.sx = 1 - 0.03 * k; P.headT -= 0.05 * k;
      } else if (p < 0.48) {
        k = eOut(seg(p, 0.3, 0.48));
        P.wA = lerp(3.78, 0.35, k); P.hFx = lerp(15, 18, k); P.hFy = lerp(-63, -29, k);
        P.lean += lerp(-0.1, 0.16, k); P.sx = 1 + 0.06 * k; P.sy = 1 - 0.05 * k;
      } else {
        k = sm(seg(p, 0.48, 1));
        P.wA = lerp(0.35, a0, k); P.hFx = lerp(18, x0, k); P.hFy = lerp(-29, y0, k);
        P.lean += 0.16 * (1 - k); P.sx = 1 + 0.06 * (1 - k); P.sy = 1 - 0.05 * (1 - k);
      }
      if (p > 0.34 && p < 0.66) {
        var aNow = mn(P.wA, 3.3), pb = mx(0.3, p - 0.12), kb = eOut(seg(pb, 0.3, 0.48));
        var aBack = mn(3.3, p < 0.48 ? lerp(3.78, 0.35, kb) : 0.35 + (P.wA - 0.35) * 0.2);
        P.smear = { a0: aBack, a1: aNow, al: (1 - seg(p, 0.46, 0.66)) * seg(p, 0.34, 0.38), kind: 'arc' };
      }
      P.hBx = -14; P.hBy = -36 - 4 * sin(p * PI);
      if (!wt) { P.wA = 2.4; }
    } else if (wt === 'yay') {
      var r0 = P.bowR, fx = P.hFx, fy = P.hFy;
      if (p < 0.15) { k = eOut(p / 0.15); P.hFx = lerp(fx, 25, k); P.hFy = lerp(fy, -45, k); P.bowR = lerp(r0, 0, k); P.pull = 0; P.arrow = k > 0.5; }
      else if (p < 0.6) { P.hFx = 25; P.hFy = -45; P.bowR = 0; P.pull = eOut(seg(p, 0.15, 0.6)); P.arrow = true; P.lean -= 0.04 * P.pull; }
      else if (p < 0.7) { k = seg(p, 0.6, 0.7); P.hFx = 25 - 2 * sin(k * PI); P.hFy = -45; P.bowR = 0; P.pull = mx(0, 1 - k * 4) * (1 - k); P.arrow = false; P.lean -= 0.06 * (1 - k); }
      else { k = sm(seg(p, 0.7, 1)); P.hFx = lerp(25, fx, k); P.hFy = lerp(-45, fy, k); P.bowR = lerp(0, r0, k); P.pull = 0; }
      if (p < 0.7) {
        P.armBFront = true;
        var sx = (-5.5 - P.pull * 13) * BOWS;   // string nock point (bow-local, scaled)
        P.hBx = P.hFx + cos(P.bowR) * sx; P.hBy = P.hFy + sin(P.bowR) * sx;
        if (p > 0.15) { P.eyes = 'aim'; P.mouth = 'grit'; }
      } else { P.hBx = lerp(-8, -12, seg(p, 0.7, 1)); P.hBy = lerp(-46, -31, seg(p, 0.7, 1)); }
    } else if (wt === 'orak') {
      var phi, wx = P.hFx, wy = P.hFy, wa = P.wA;
      if (p < 0.2) {
        k = eOut(p / 0.2); phi = PI;
        P.hFx = lerp(wx, -14, k); P.hFy = lerp(wy, -38, k); P.wA = lerp(wa, 4.3, k);
        P.lean -= 0.1 * k; P.sy = 1 - 0.05 * k; P.sx = 1 + 0.03 * k;
      } else if (p < 0.78) {
        k = eOut(seg(p, 0.2, 0.78)); phi = PI - k * TAU;
        var hx2 = cos(phi) * 15, hy2 = -37 + sin(phi) * 3.5;
        P.hFx = hx2; P.hFy = hy2;
        P.spin = { phi: phi, f: mx(0.35, abs(cos(phi))) };
        P.wBehind = sin(phi) < -0.05;
        P.sx = 1 - 0.07 * abs(sin(phi)); P.lean = 0.05 * cos(phi);
        P.smear = { phi: phi, al: 1 - seg(p, 0.6, 0.78), kind: 'ring', dir: -1 };
      } else {
        k = sm(seg(p, 0.78, 1));
        P.hFx = lerp(-15, wx, k); P.hFy = lerp(-37, wy, k); P.wA = lerp(4.3 + 0.0, wa, k);
      }
      P.hBx = -12 + 2 * sin(p * TAU); P.hBy = -40;
      P.eyes = p > 0.1 && p < 0.85 ? 'focus' : P.eyes; P.mouth = p > 0.15 && p < 0.8 ? 'grit' : P.mouth;
    } else if (wt === 'asa') {
      var ax = P.hFx, ay = P.hFy, aa = P.wA;
      if (p < 0.3) { k = eOut(p / 0.3); P.hFx = lerp(ax, 12, k); P.hFy = lerp(ay, -58, k); P.wA = lerp(aa, 3.1, k); P.orb = k; P.lean -= 0.06 * k; P.sy = 1 + 0.03 * k; }
      else if (p < 0.45) { k = eOut(seg(p, 0.3, 0.45)); P.hFx = lerp(12, 21, k); P.hFy = lerp(-58, -48, k); P.wA = lerp(3.1, 2.45, k); P.orb = 1 + k * 0.6; P.burst = k; P.lean += 0.12 * k; }
      else { k = sm(seg(p, 0.45, 1)); P.hFx = lerp(21, ax, k); P.hFy = lerp(-48, ay, k); P.wA = lerp(2.45, aa, k); P.orb = 1.6 * (1 - k); P.burst = p < 0.7 ? 1 + seg(p, 0.45, 0.7) : 0; P.lean += 0.12 * (1 - k); }
      P.hBx = -15; P.hBy = -40 - 6 * sin(p * PI);
      P.eyes = p > 0.05 && p < 0.7 ? 'focus' : P.eyes; P.mouth = p > 0.3 && p < 0.6 ? 'o' : P.mouth;
    }
    if (P.eyes === 'open' && p > 0.05 && p < 0.7) P.eyes = 'focus';
  }

  // ------------------------------------------------------------------------------------------ body paths
  function torsoPath(c) {
    c.moveTo(-10.5, -51.5);
    c.quadraticCurveTo(0, -54, 10.5, -51.5);
    c.quadraticCurveTo(14.2, -45, 12.8, -37);
    c.quadraticCurveTo(11.9, -31, 11.6, -25.5);
    c.lineTo(-11.6, -25.5);
    c.quadraticCurveTo(-11.9, -31, -12.8, -37);
    c.quadraticCurveTo(-14.2, -45, -10.5, -51.5);
    c.closePath();
  }
  function pelvisPath(c) {
    c.moveTo(-11.4, -29); c.lineTo(11.4, -29);
    c.quadraticCurveTo(12.8, -21.5, 10.8, -15.5); c.lineTo(2.4, -15.5);
    c.quadraticCurveTo(0, -18.8, -2.4, -15.5); c.lineTo(-10.8, -15.5);
    c.quadraticCurveTo(-12.8, -21.5, -11.4, -29); c.closePath();
  }
  function beltPath(c) {
    c.moveTo(-12.2, -30.8); c.quadraticCurveTo(0, -28.9, 12.2, -30.8);
    c.lineTo(12.4, -25.4); c.quadraticCurveTo(0, -23.5, -12.4, -25.4); c.closePath();
  }
  function bootPath(c) {
    c.moveTo(-4.7, -3.6); c.lineTo(4.5, -3.6);
    c.lineTo(4.9, 1.1);
    c.quadraticCurveTo(11, 1.2, 11, 5.4);
    c.lineTo(10.8, 7.6); c.lineTo(-5.1, 7.6);
    c.quadraticCurveTo(-5.9, 2.5, -4.7, -3.6); c.closePath();
  }
  function ub(c, P) { c.translate(0, HIP_Y); c.rotate(P.lean); c.translate(0, -HIP_Y + P.bob); }

  // ------------------------------------------------------------------------------------------ body assembly
  function drawBody(c, R, P, Q) {
    c.lineJoin = 'round'; c.lineCap = 'round'; c.strokeStyle = OUT; c.lineWidth = Q.lw;
    c.save();
    c.scale(P.sx, P.sy);
    c.translate(0, P.drop - P.lift);
    if (P.cast > 0 && Q.fx) castCircle(c, R, P, Q);
    c.save(); ub(c, P); backLayer(c, R, P, Q); c.restore();
    c.save(); ub(c, P);
    if (P.wBehind) { weapon(c, R, P, Q); }
    if (!P.armBFront) arm(c, R, P, Q, 0);
    c.restore();
    leg(c, R, P, Q, 0); leg(c, R, P, Q, 1);
    c.save(); ub(c, P);
    pelvis(c, R, P, Q);
    torso(c, R, P, Q);
    belt(c, R, P, Q);
    shoulder(c, R, P, Q, 0);
    necklace(c, R, P, Q);
    head(c, R, P, Q);
    if (!P.wBehind) weapon(c, R, P, Q);
    if (P.armBFront) arm(c, R, P, Q, 0);
    arm(c, R, P, Q, 1);
    shoulder(c, R, P, Q, 1);
    if (P.smear && Q.fx) smear(c, R, P, Q);
    c.restore();
    c.restore();
  }

  // ------------------------------------------------------------------------------------------ legs / pelvis
  function legMat(R, front) {
    var gp = R.g.pantolon, p = R.pal, b, s, l;
    if (gp) {
      if (gp.set === 'gece') { b = gp.m.a; s = gp.m.aS; l = lt(gp.m.a, 0.3); }
      else { b = gp.m.b; s = gp.m.s; l = gp.m.l; }
    } else { b = p.pants; s = p.pantsS; l = p.pantsL; }
    if (!front) { b = dk(b, 0.16); l = dk(l, 0.14); }
    return [b, s, l];
  }
  function leg(c, R, P, Q, side) {
    var f = side === 1, hx = f ? HIP_X : -HIP_X, hy = HIP_Y;
    var a = f ? P.legF : P.legB, lift = f ? P.liftF : P.liftB, L = LEG_L - lift;
    var ax = hx + sin(a) * L, ay = hy + cos(a) * L;
    var m = legMat(R, f);
    cel(c, function (c) { CAP(c, hx, hy, ax, ay, 5, 4.5); }, m[0], m[1], m[2], 2.2, 1);
    if (R.g.pantolon && Q.lod > 0) { c.save(); c.translate(hx, hy); c.rotate(-a); pantsLegDeco(c, R.g.pantolon, L, Q, P.t, f); c.restore(); }
    if (R.g.dizlik) { c.save(); c.translate(lerp(hx, ax, 0.56), lerp(hy, ay, 0.56)); c.rotate(-a); pieceKnee(c, R.g.dizlik, Q, P.t, f); c.restore(); }
    c.save(); c.translate(ax, ay); c.rotate(-a * 0.55);
    if (R.g.ayak) pieceBoot(c, R.g.ayak, Q, P.t, f, P);
    else { var p = R.pal, b = f ? p.shoe : dk(p.shoe, 0.15); cel(c, bootPath, b, p.shoeS, f ? p.shoeL : null, 2, 1); line(c, -4.6, 6.4, 10.4, 6.4, dk(p.shoe, 0.6), 1.4); if (Q.lod > 0) line(c, -1, -1.2, 3.6, -1.2, p.shoeL, 1); }
    c.restore();
  }
  function pelvis(c, R, P, Q) {
    var m = legMat(R, true);
    cel(c, pelvisPath, m[0], m[1], m[2], 2.2, 1);
    if (R.g.pantolon) piecePantsTop(c, R.g.pantolon, Q, P.t);
  }

  // ------------------------------------------------------------------------------------------ torso / clothes
  function torso(c, R, P, Q) {
    var p = R.pal;
    fl(c, function (c) { RR(c, -2.6, -58, 9.2, 9, 3.2); }, p.skinS);
    if (R.g.gogus) pieceChest(c, R.g.gogus, Q, P.t, R);
    else clothes(c, R, P, Q);
    collar(c, R, P, Q);
  }
  function clothes(c, R, P, Q) {
    var p = R.pal, id = R.id, hs = R.hs;
    cel(c, torsoPath, p.cloth, p.clothS, p.clothL, 3.2, 1.2);
    c.save(); c.beginPath(); torsoPath(c); c.clip();
    // hem band
    fl(c, function (c) { c.moveTo(-14, -29.5); c.quadraticCurveTo(0, -27.5, 14, -29.5); c.lineTo(14, -24); c.lineTo(-14, -24); c.closePath(); }, p.clothS, true);
    if (id === 'bora') {
      fl(c, function (c) { c.moveTo(-4.5, -54); c.lineTo(8.5, -54); c.lineTo(2.5, -44.5); c.closePath(); }, dk(p.cloth, 0.62));
      fl(c, function (c) { c.moveTo(-3, -54); c.lineTo(7, -54); c.lineTo(2.3, -47.5); c.closePath(); }, p.skin, true);
      fl(c, function (c) { c.moveTo(13, -52); c.lineTo(17, -48); c.lineTo(-10, -26); c.lineTo(-14, -30); c.closePath(); }, hs ? dk(p.accent, 0.45) : '#5C3B26');
      fl(c, function (c) { Ci(c, 2, -39, 3.2); }, p.accent);
      if (Q.lod > 0) fl(c, function (c) { Ci(c, 1.2, -39.8, 1.1); }, p.accL, true);
    } else if (id === 'ela') {
      fl(c, function (c) { c.moveTo(-16, -50); c.lineTo(-12, -54); c.lineTo(15, -29); c.lineTo(11, -25); c.closePath(); }, dk(p.accent, 0.3));
      if (Q.lod > 0) { c.save(); c.setLineDash([1.6, 1.6]); line(c, -12.5, -50.5, 12.5, -28.2, p.accL, 0.8); c.setLineDash([]); c.restore(); }
      fl(c, function (c) { Ci(c, 0.5, -40.5, 2.6); }, p.accent);
      fl(c, function (c) { c.moveTo(-6, -53); c.quadraticCurveTo(2, -45, 9, -53); c.closePath(); }, p.clothS, true);
    } else if (id === 'yaman') {
      fl(c, function (c) { c.moveTo(-8, -55); c.lineTo(10, -55); c.lineTo(9, -48); c.quadraticCurveTo(1, -45, -7, -48); c.closePath(); }, p.clothD);
      line(c, 1.5, -47, 1.5, -26, p.accent, 1.6);
      line(c, 1.5, -47, 1.5, -26, OUT, 0.5);
      if (Q.lod > 0) { for (var i = 0; i < 3; i++) fl(c, function (c) { Ci(c, 1.5, -43 + i * 5.5, 1.1); }, p.accL, true); }
      if (hs && hs.paint) { line(c, -11, -44, -4, -36, p.accent, 1.4); line(c, -11, -40, -5, -33, p.accent, 1.4); }
    } else if (id === 'ayaz') {
      var zz = function (c) { c.moveTo(-14, -39); for (var i = 0; i <= 14; i++) c.lineTo(-14 + i * 2, i % 2 ? -36.5 : -39.5); c.lineTo(14, -34); for (var j = 14; j >= 0; j--) c.lineTo(-14 + j * 2, j % 2 ? -31.5 : -34.5); c.closePath(); };
      fl(c, zz, hs && hs.frost ? '#FFFFFF' : p.accent, true);
      line(c, -14, -40, 14, -40, p.clothS, 0.8);
    } else if (id === 'alaz') {
      fl(c, function (c) { c.moveTo(-3, -54); c.lineTo(7, -54); c.lineTo(10, -26); c.lineTo(-6, -26); c.closePath(); }, p.clothD);
      line(c, -3, -54, -6, -26, p.accent, 1.8); line(c, 7, -54, 10, -26, p.accent, 1.8);
      fl(c, function (c) { c.moveTo(2, -45); c.lineTo(5.2, -41); c.lineTo(2, -37); c.lineTo(-1.2, -41); c.closePath(); }, p.accent);
      if (Q.lod > 0) fl(c, function (c) { Ci(c, 2, -41, 1.3); }, '#FF3D4F', true);
    }
    c.restore();
    c.beginPath(); torsoPath(c); c.stroke();
  }
  // hero-specific collars / mantles over the chest (stay visible over armour so heroes stay recognisable)
  function collar(c, R, P, Q) {
    var p = R.pal, hs = R.hs, kind = hs && hs.hood ? hs.hood : R.id;
    if (kind === 'ela' || kind === 'night') {
      var hc = kind === 'night' ? '#141A3C' : p.cloth;
      cel(c, function (c) { c.moveTo(-13, -53); c.quadraticCurveTo(0, -57, 14, -53); c.quadraticCurveTo(13, -47, 3, -43.5); c.quadraticCurveTo(-8, -46, -13, -53); c.closePath(); }, hc, dk(hc, 0.4), lt(hc, 0.22), 2, 1);
      fl(c, function (c) { Ci(c, 3, -46.2, 2.2); }, kind === 'night' ? '#D5DEFF' : p.accent);
      if (kind === 'night' && Q.lod > 0) fl(c, function (c) { c.arc(3, -46.2, 1.5, 0.6, 5.2); c.arc(3.8, -46.6, 1.1, 5.0, 0.8, true); c.closePath(); }, '#62E8FF', true);
    } else if (kind === 'ayaz' || kind === 'frost') {
      var fc = kind === 'frost' ? '#FFFFFF' : '#EEF3F8', fs = kind === 'frost' ? '#9FD8F2' : '#B5C2D2';
      furRow(c, -13, -52.5, 14, -52.5, 5, 3.2, fc, fs, Q, -2);
    } else if (kind === 'wolf') {
      furRow(c, -14, -52, 15, -52, 6, 3.6, '#9AA3B2', '#5E6676', Q, -2.5);
    } else if (kind === 'bear') {
      furRow(c, -14, -52, 15, -52, 6, 3.6, '#6B3428', '#3E1A16', Q, -2.5);
    }
  }
  // a row of fur tufts between two points (sag = vertical bow)
  function furRow(c, x1, y1, x2, y2, n, r, col, colS, Q, sag) {
    var f = function (c) {
      for (var i = 0; i <= n; i++) {
        var k = i / n, x = lerp(x1, x2, k), y = lerp(y1, y2, k) - sin(k * PI) * (sag || 0);
        Ci(c, x, y, r * (0.85 + 0.15 * sin(i * 2.3)));
      }
    };
    c.beginPath(); f(c); c.save(); c.lineWidth = c.lineWidth * 2; c.stroke(); c.restore();
    c.fillStyle = colS; c.fill();
    c.save(); c.translate(-0.6, -0.9); c.beginPath(); f(c); c.fillStyle = col; c.fill(); c.restore();
  }
  function belt(c, R, P, Q) {
    if (R.g.kemer) { pieceBelt(c, R.g.kemer, Q, P.t); return; }
    var b = R.pal.belt;
    cel(c, beltPath, b, dk(b, 0.42), lt(b, 0.22), 1.4, 0.7);
    fl(c, function (c) { RR(c, 0.2, -31.2, 6, 6.4, 1.4); }, '#C9A66B');
    fl(c, function (c) { RR(c, 1.9, -29.6, 2.6, 3.2, 0.6); }, dk(b, 0.3), true);
  }
  function necklace(c, R, P, Q) {
    if (R.g.boyun) { pieceNeck(c, R.g.boyun, Q, P.t); return; }
    if (R.id === 'ayaz') {
      c.beginPath(); c.moveTo(-7, -51); c.quadraticCurveTo(2, -42, 10, -51); strokeW(c, OUT, 1.2);
      var cols = ['#E8394D', '#3EDBC8', '#FFCB57', '#3EDBC8', '#E8394D'];
      for (var i = 0; i < 5; i++) { var k = (i + 0.5) / 5, x = lerp(-6, 9, k), y = -50.5 + sin(k * PI) * 7; fl(c, function (c) { Ci(c, x, y, 1.5); }, cols[i]); }
      fl(c, function (c) { c.moveTo(1.5, -44); c.lineTo(3.6, -40); c.lineTo(1.5, -37); c.lineTo(-0.6, -40); c.closePath(); }, '#F2E4C4');
    }
  }

  // ------------------------------------------------------------------------------------------ arms / hands / shoulders
  function arm(c, R, P, Q, side) {
    var f = side === 1, sx = f ? SHO_X : -SHO_X, sy = SHO_Y;
    var hx = f ? P.hFx : P.hBx, hy = f ? P.hFy : P.hBy;
    var p = R.pal, base = f ? p.cloth : dk(p.cloth, 0.2);
    var ang = atan2(hy - sy, hx - sx), d = sqrt((hx - sx) * (hx - sx) + (hy - sy) * (hy - sy));
    cel(c, function (c) { CAP(c, sx, sy, hx, hy, 4.5, 3.8); }, base, p.clothS, f ? p.clothL : null, 2, 1);
    if (R.g.kol) { c.save(); c.translate(lerp(sx, hx, 0.4), lerp(sy, hy, 0.4)); c.rotate(ang - HP); pieceBracer(c, R.g.kol, Q, P.t, d * 0.5, f); c.restore(); }
    else if (Q.lod > 0) { c.save(); c.translate(lerp(sx, hx, 0.78), lerp(sy, hy, 0.78)); c.rotate(ang - HP); fl(c, function (c) { RR(c, -4.3, -1.4, 8.6, 2.8, 1.2); }, f ? p.accS : dk(p.accS, 0.2)); c.restore(); }
    c.save(); c.translate(hx, hy); c.rotate(ang - HP);
    if (R.g.eldiven) pieceGlove(c, R.g.eldiven, Q, P.t, f);
    else cel(c, function (c) { Ci(c, 0, 0.8, 4.2); E(c, 2.8, -0.6, 1.9, 2.4, 0.4); }, f ? p.skin : dk(p.skin, 0.12), p.skinS, f ? p.skinL : null, 1.4, 0.7);
    c.restore();
  }
  function shoulder(c, R, P, Q, side) {
    var g = R.g.omuz; if (!g) return;
    var f = side === 1;
    var hy = f ? P.hFy : P.hBy, lift = clamp((SHO_Y - hy) / 20, 0, 1);
    c.save(); c.translate(f ? SHO_X + 0.6 : -SHO_X - 0.6, SHO_Y - 1.2 - lift * 2);
    if (!f) c.scale(-1, 1);
    c.rotate(-lift * 0.35);
    pieceShoulder(c, g, Q, P.t, f);
    c.restore();
  }

  // ------------------------------------------------------------------------------------------ head
  function head(c, R, P, Q) {
    c.save();
    c.translate(HEAD_X, HEAD_Y);
    c.translate(0, 20); c.rotate(P.headT); c.translate(0, -20);
    var gk2 = R.g.kafa, crown = gk2 && gk2.skin === 'sk_kafa_tac', helm = !!gk2 && !crown;
    var gy = R.g.yuz, eyeMask = gy && (gy.skin ? false : gy.set === 'ejder');
    var lowMask = gy && !eyeMask;
    hairBehind(c, R, P, Q, helm);
    headShape(c, R, P, Q);
    if (eyeMask) pieceMask(c, gy, Q, P.t, 'eyes');
    face(c, R, P, Q, lowMask);
    hairFront(c, R, P, Q, helm);
    brows(c, R, P, Q);
    if (!helm) headwear(c, R, P, Q, crown);
    if (lowMask) pieceMask(c, gy, Q, P.t, 'low');
    if (gk2) pieceHelmet(c, gk2, Q, P.t, R);
    if (R.extra === 'horns' || R.id === 'alaz') horns(c, R, P, Q, helm);
    c.restore();
  }
  function headShape(c, R, P, Q) {
    var p = R.pal;
    cel(c, function (c) { E(c, -21.3, 3.5, 4.3, 5.8); }, p.skin, p.skinS, null, 1.8, 0);
    if (Q.lod > 0) fl(c, function (c) { E(c, -21.6, 3.8, 1.8, 3); }, p.skinS, true);
    c.beginPath(); E(c, 0, 0, HRX, HRY); c.fillStyle = p.skinS; c.fill();
    c.save(); c.clip();
    c.beginPath(); E(c, 2.2, -1.8, HRX - 0.4, HRY - 0.6); c.fillStyle = p.skin; c.fill();
    if (Q.lod > 0) { c.beginPath(); E(c, 8, -6, 10, 7); c.fillStyle = rgba(p.skinL, 0.35); c.fill(); }
    c.restore();
    c.beginPath(); E(c, 0, 0, HRX, HRY); c.stroke();
  }
  function face(c, R, P, Q, lowMask) {
    var p = R.pal, e1 = FX - 8.6, e2 = FX + 9.4, ey = 4;
    if (!lowMask) {
      c.fillStyle = rgba(p.blush, 0.36);
      c.beginPath(); E(c, FX - 12.6, 11.2, 3.8, 2.2); E(c, FX + 15.3, 10.6, 3, 2.1); c.fill();
    }
    eye(c, R, P, Q, e1, ey, 4.3, 6.1, true);
    eye(c, R, P, Q, e2, ey, 4.8, 6.4, false);
    if (!lowMask) mouth(c, R, P, Q, FX + 2.4, 14.2);
    if (R.extra === 'scar' || (R.id === 'yaman')) {
      c.beginPath(); c.moveTo(e1 - 4.4, -7); c.lineTo(e1 + 1.6, 13); strokeW(c, '#B85A66', 1.6);
      if (Q.lod > 0) { line(c, e1 - 4, -2.5, e1 - 0.6, -3.4, '#B85A66', 1); line(c, e1 - 2.8, 3.5, e1 + 0.8, 2.6, '#B85A66', 1); line(c, e1 - 1.4, 9, e1 + 2, 8.2, '#B85A66', 1); }
    }
    if (R.hs && R.hs.paint && !lowMask) { line(c, FX + 12, 9, FX + 19, 8, '#C41E3A', 1.5); line(c, FX + 12.5, 12, FX + 18.5, 11.5, '#C41E3A', 1.5); line(c, FX - 15, 9.5, FX - 10, 9.2, '#C41E3A', 1.5); }
  }
  function eye(c, R, P, Q, x, y, rx, ry, back) {
    var p = R.pal, e = P.eyes;
    if (e === 'aim') e = back ? 'blink' : 'focus';
    c.save();
    if (e === 'blink') {
      c.beginPath(); c.moveTo(x - rx, y + 1); c.quadraticCurveTo(x, y + 4, x + rx, y + 1); strokeW(c, OUT, 1.9);
      if (R.sty.lash) line(c, x + rx, y + 1, x + rx + 1.8, y - 0.4, OUT, 1.4);
    } else if (e === 'happy') {
      c.beginPath(); c.moveTo(x - rx, y + 3); c.quadraticCurveTo(x, y - 5, x + rx, y + 3); strokeW(c, OUT, 2.1);
    } else if (e === 'hurt') {
      var s = back ? -1 : 1;
      c.beginPath(); c.moveTo(x - rx * s, y - 3.5); c.lineTo(x + rx * 0.7 * s, y + 0.5); c.lineTo(x - rx * s, y + 4.5); strokeW(c, OUT, 2.1);
    } else {
      var foc = e === 'focus';
      if (foc) { y += 1.2; ry *= 0.74; }
      c.beginPath(); E(c, x, y, rx, ry); c.fillStyle = '#1A1024'; c.fill();
      c.save(); c.clip();
      c.beginPath(); E(c, x, y + ry * 0.36, rx * 0.95, ry * 0.78); c.fillStyle = p.eye; c.fill();
      c.beginPath(); E(c, x, y + ry * 0.82, rx * 0.66, ry * 0.36); c.fillStyle = p.eyeL; c.fill();
      if (Q.lod > 0) { c.beginPath(); E(c, x + rx * 0.05, y + ry * 0.2, rx * 0.36, ry * 0.42); c.fillStyle = rgba('#120A1A', 0.55); c.fill(); }
      c.restore();
      c.fillStyle = '#FFFFFF';
      c.beginPath(); E(c, x - rx * 0.3, y - ry * 0.34, rx * 0.44, ry * 0.31, -0.3); c.fill();
      c.beginPath(); Ci(c, x + rx * 0.4, y + ry * 0.4, rx * 0.19); c.fill();
      c.beginPath(); c.ellipse(x, y, rx + 0.2, ry + 0.2, 0, PI * 1.06, PI * 1.94); strokeW(c, OUT, foc ? 2.4 : 2);
      if (R.sty.lash && !back) { line(c, x + rx * 0.8, y - ry * 0.55, x + rx + 2.2, y - ry * 0.9, OUT, 1.5); }
      if (R.glowEye && Q.fx) { addOn(c); glow(c, x, y + 1, rx * 2.4, ry * 2, p.eye, 0.45 + 0.1 * sin(P.t * 5 + x)); addOff(c); }
    }
    c.restore();
  }
  function brows(c, R, P, Q) {
    var p = R.pal, e = P.eyes, col = dk(p.hair, 0.25);
    if (R.hs && R.hs.frost) col = '#9FD8F2';
    var x1 = FX - 8.6, x2 = FX + 9.4, y = -4.6, tilt = 0;
    if (e === 'focus' || e === 'aim') tilt = 1.6; else if (e === 'hurt') tilt = -1.6; else if (e === 'happy') y -= 1;
    c.beginPath(); c.moveTo(x1 - 3.4, y - tilt * 0.4); c.quadraticCurveTo(x1, y - 1.6, x1 + 3, y + tilt);
    c.moveTo(x2 - 3, y + tilt); c.quadraticCurveTo(x2, y - 1.8, x2 + 3.8, y - tilt * 0.4);
    strokeW(c, col, 1.8);
  }
  function mouth(c, R, P, Q, x, y) {
    var m = P.mouth;
    c.save();
    if (m === 'open') {
      c.beginPath(); c.moveTo(x - 3.4, y - 1); c.quadraticCurveTo(x, y + 6, x + 3.4, y - 1); c.closePath();
      c.fillStyle = '#5A1A2A'; c.fill();
      c.save(); c.clip(); c.beginPath(); E(c, x, y + 3.6, 2.4, 1.8); c.fillStyle = '#FF7A8A'; c.fill(); c.restore();
      c.lineWidth = 1.4; c.stroke();
    } else if (m === 'grit') {
      c.beginPath(); RR(c, x - 3, y - 1.2, 6, 3.2, 1.2); c.fillStyle = '#FFFFFF'; c.fill(); c.lineWidth = 1.3; c.stroke();
      line(c, x - 2.6, y + 0.4, x + 2.6, y + 0.4, '#8A7A90', 0.6);
    } else if (m === 'wavy') {
      c.beginPath(); c.moveTo(x - 3.4, y + 0.6); c.lineTo(x - 1.7, y - 0.8); c.lineTo(x, y + 0.6); c.lineTo(x + 1.7, y - 0.8); c.lineTo(x + 3.4, y + 0.6); strokeW(c, OUT, 1.4);
    } else if (m === 'o') {
      c.beginPath(); E(c, x, y + 0.6, 1.8, 2.2); c.fillStyle = '#5A1A2A'; c.fill(); c.lineWidth = 1.2; c.stroke();
    } else {
      c.beginPath(); c.moveTo(x - 2.8, y - 0.6); c.quadraticCurveTo(x, y + 2.6, x + 2.8, y - 0.6); strokeW(c, OUT, 1.5);
    }
    c.restore();
  }
  function rimHead(c, R, Q) {
    if (!Q.fx) return;
    c.save(); c.beginPath(); E(c, 0, 0, HRX + 0.4, HRY + 0.4); c.clip(); addOn(c);
    c.beginPath(); c.ellipse(0, 0, HRX, HRY, 0, PI * 0.62, PI * 1.18);
    strokeW(c, rgba('#8E7BFF', 0.38), 3.4);
    c.restore();
  }

  // ------------------------------------------------------------------------------------------ hair
  function hairPath(style, sw) {
    if (style === 'spiky') return function (c) {
      c.moveTo(-23, 9);
      c.quadraticCurveTo(-27.5, 1, -32 + sw, -4);
      c.quadraticCurveTo(-27, -8, -27, -12);
      c.quadraticCurveTo(-32 + sw, -18, -31 + sw, -25);
      c.quadraticCurveTo(-23, -23, -19, -24);
      c.quadraticCurveTo(-20, -32, -14 + sw * 0.7, -37);
      c.quadraticCurveTo(-8, -30, -3, -29);
      c.quadraticCurveTo(1, -37, 9 + sw * 0.4, -38);
      c.quadraticCurveTo(10, -31, 12, -28);
      c.quadraticCurveTo(20, -32, 27.5, -27);
      c.quadraticCurveTo(23, -21, 25, -15);
      c.quadraticCurveTo(28, -8, 25.5, -1);
      c.lineTo(21, -6); c.lineTo(18.6, -0.5); c.lineTo(14.5, -7); c.lineTo(10.4, -1.5);
      c.lineTo(6, -8); c.lineTo(1.2, -2.5); c.lineTo(-3, -8.5);
      c.quadraticCurveTo(-11, -7, -15, -2);
      c.quadraticCurveTo(-18, 3, -17.5, 10);
      c.quadraticCurveTo(-20.5, 11, -23, 9);
      c.closePath();
    };
    if (style === 'pony') return function (c) {
      c.moveTo(-23, 10);
      c.quadraticCurveTo(-27, -12, -12, -22);
      c.quadraticCurveTo(4, -29, 18, -20);
      c.quadraticCurveTo(26, -13, 25.5, 2);
      c.quadraticCurveTo(24, 8, 23 + sw * 0.4, 13);
      c.quadraticCurveTo(21, 3, 19, -2);
      c.quadraticCurveTo(14, -1, 9, 1);
      c.quadraticCurveTo(11, -5, 7, -8.5);
      c.quadraticCurveTo(0, -2, -8, -1);
      c.quadraticCurveTo(-6, -6, -8, -9);
      c.quadraticCurveTo(-15, -4, -17, 3);
      c.quadraticCurveTo(-18, 8, -18, 14);
      c.quadraticCurveTo(-21, 13, -23, 10);
      c.closePath();
    };
    if (style === 'long') return function (c) {
      c.moveTo(-24, 14);
      c.quadraticCurveTo(-30, -14, -12, -25);
      c.quadraticCurveTo(6, -32, 20, -22);
      c.quadraticCurveTo(28.5, -12, 26.5, 4);
      c.quadraticCurveTo(25.5, 14, 24 + sw * 0.6, 24);
      c.quadraticCurveTo(20.5, 11, 19.6, 2);
      c.quadraticCurveTo(16, -1, 12, 0.5);
      c.quadraticCurveTo(13, -5, 10, -8.5);
      c.quadraticCurveTo(3, -2, -5, 2.5);
      c.quadraticCurveTo(-1.5, -5, -5, -9.5);
      c.quadraticCurveTo(-13, -4, -16, 4);
      c.quadraticCurveTo(-18, 13, -17.5 + sw * 0.4, 22);
      c.quadraticCurveTo(-21.5, 17, -24, 14);
      c.closePath();
    };
    if (style === 'braid') return function (c) {
      c.moveTo(-23.5, 9);
      c.quadraticCurveTo(-27.5, -14, -10, -23.5);
      c.quadraticCurveTo(5, -29, 18.5, -20.5);
      c.quadraticCurveTo(26.5, -13, 25, 5);
      c.quadraticCurveTo(21.5, 0, 19.5, -5);
      c.quadraticCurveTo(12, -6.5, 6.5, -10.5);
      c.quadraticCurveTo(-3, -5, -12.5, -4);
      c.quadraticCurveTo(-17.5, 0, -18, 10);
      c.closePath();
    };
    // flame
    return function (c) {
      c.moveTo(-23, 8);
      c.quadraticCurveTo(-28, -4, -34 + sw, -10);
      c.quadraticCurveTo(-27, -13, -26, -17);
      c.quadraticCurveTo(-31 + sw, -27, -27 + sw, -35);
      c.quadraticCurveTo(-20, -27, -15, -27);
      c.quadraticCurveTo(-14, -36, -6 + sw * 0.6, -42);
      c.quadraticCurveTo(-4, -32, 1, -29);
      c.quadraticCurveTo(6, -37, 14 + sw * 0.4, -38);
      c.quadraticCurveTo(13, -30, 15, -26);
      c.quadraticCurveTo(22, -26, 27.5, -21);
      c.quadraticCurveTo(25, -14, 26, -5);
      c.quadraticCurveTo(26.5, 1, 24.5, 5);
      c.quadraticCurveTo(22, -2, 19, -4);
      c.quadraticCurveTo(16, 1, 12, 2);
      c.quadraticCurveTo(13, -4, 9, -7);
      c.quadraticCurveTo(6, -2, 1, 0);
      c.quadraticCurveTo(2, -5, -2, -8);
      c.quadraticCurveTo(-11, -6, -15, -1);
      c.quadraticCurveTo(-18, 4, -17.5, 10);
      c.quadraticCurveTo(-20.5, 11, -23, 8);
      c.closePath();
    };
  }
  function hairBehind(c, R, P, Q, helm) {
    var p = R.pal, hs = R.hs, hood = !helm && heroHood(R);
    if (hood) hoodBack(c, R, P, Q, hood);
  }
  function heroHood(R) {
    if (R.hs && R.hs.hood) return R.hs.hood;
    if (R.id === 'ela') return 'ela';
    if (R.id === 'ayaz') return 'ayaz';
    return null;
  }
  function hairFront(c, R, P, Q, helm) {
    var p = R.pal, sw = P.hair * 2.2, style = R.sty.hair;
    var f = hairPath(style, sw);
    c.save();
    if (helm) { c.beginPath(); c.rect(-40, -8, 80, 60); c.clip(); }
    // hair shadow on the forehead
    c.save(); c.beginPath(); E(c, 0, 0, HRX - 0.5, HRY - 0.5); c.clip(); c.translate(1, 2.6); c.beginPath(); f(c); c.fillStyle = rgba(p.skinS, 0.75); c.fill(); c.restore();
    cel(c, f, p.hair, p.hairS, p.hairL, 3, 1.3);
    if (Q.lod > 0) {
      c.save(); c.beginPath(); f(c); c.clip();
      c.beginPath(); c.ellipse(-1, -3, 19, 16, 0, PI * 1.12, PI * 1.5); strokeW(c, rgba(p.hairL, 0.75), 2.4);
      c.beginPath(); c.ellipse(-1, -3, 19, 16, 0, PI * 1.56, PI * 1.66); strokeW(c, rgba(p.hairL, 0.75), 2.4);
      if (R.hs && R.hs.hairTip) { addOn(c); glow(c, -6, -40, 22, 14, R.hs.hairTip, 0.9); glow(c, -28, -32, 12, 10, R.hs.hairTip, 0.7); addOff(c); }
      c.restore();
    }
    c.restore();
    if (style === 'braid') braid(c, R, P, Q, 20.5, 3, 1);
  }
  function braid(c, R, P, Q, x, y, front) {
    var p = R.pal, sw = P.hair * 1.4;
    for (var i = 0; i < 5; i++) {
      var yy = y + i * 4.6, xx = x + sw * i * 0.4 + (i % 2 ? 0.6 : -0.6);
      cel(c, function (c) { E(c, xx, yy, 3.2 - i * 0.12, 3); }, p.hair, p.hairS, p.hairL, 1.2, 0.6);
    }
    var by = y + 25, bx = x + sw * 2;
    fl(c, function (c) { Ci(c, bx, by - 1.5, 2); }, R.hs && R.hs.frost ? '#BFF6FF' : '#3EDBC8');
    fl(c, function (c) { c.moveTo(bx - 1.5, by); c.lineTo(bx + 1.5, by); c.lineTo(bx + 0.8 + sw, by + 5); c.lineTo(bx - 0.8 + sw, by + 5); c.closePath(); }, p.hair);
  }
  // hoods: back part (behind the head) and front rim (frames the face)
  function hoodCols(R, kind) {
    var p = R.pal;
    if (kind === 'night') return ['#18204A', '#0C1030', '#2C3874', '#D5DEFF'];
    if (kind === 'ayaz') return ['#5D86A6', '#36546F', '#86AECB', '#EEF3F8'];
    if (kind === 'frost') return ['#DDF4FF', '#93C9E6', '#FFFFFF', '#FFFFFF'];
    if (kind === 'wolf') return ['#8B93A3', '#545B6A', '#B9C0CC', '#DDE2EA'];
    if (kind === 'bear') return ['#6B3428', '#3C1914', '#8E4A3A', '#C9806A'];
    return [p.cloth, p.clothS, p.clothL, p.accent];
  }
  function hoodBack(c, R, P, Q, kind) {
    var C = hoodCols(R, kind), sw = P.hair * 2.5;
    if (kind === 'wolf' || kind === 'bear') return;
    cel(c, function (c) {
      c.moveTo(21, -22); c.bezierCurveTo(10, -35, -14, -35, -26, -22);
      c.quadraticCurveTo(-34 + sw, -23, -39 + sw * 1.6, -30);
      c.quadraticCurveTo(-35 + sw * 0.5, -14, -31, 0);
      c.quadraticCurveTo(-30, 18, -19, 26); c.lineTo(22, 24);
      c.quadraticCurveTo(31, 8, 28, -6); c.quadraticCurveTo(27, -16, 21, -22); c.closePath();
    }, C[1], dk(C[1], 0.35), null, 2.5, 0);
  }
  function hoodFront(c, R, P, Q, kind) {
    var C = hoodCols(R, kind);
    var f = function (c) {
      c.moveTo(-27.5, 15); c.bezierCurveTo(-32, -15, -16, -32.5, 2, -32.5);
      c.bezierCurveTo(20, -32.5, 32, -16, 28.5, 12);
      c.lineTo(23.5, 12); c.bezierCurveTo(25.5, -5, 16, -15.5, 3.5, -15.5);
      c.bezierCurveTo(-9, -15.5, -21, -7, -20.5, 15); c.closePath();
    };
    cel(c, f, C[0], C[1], C[2], 3, 1.3);
    if (kind === 'ayaz' || kind === 'frost') {
      var fur = kind === 'frost' ? '#FFFFFF' : '#EEF3F8', furS = kind === 'frost' ? '#9FD8F2' : '#B5C2D2';
      var pts = [];
      for (var i = 0; i <= 11; i++) { var a = PI * (0.98 + i * 0.1); pts.push([3.5 + cos(a) * 23, 1 + sin(a) * 17.5]); }
      pts.unshift([-21.5, 13]); pts.push([25, 12]);
      var ff = function (c) { for (var j = 0; j < pts.length; j++) Ci(c, pts[j][0], pts[j][1], 3.6 + (j % 2) * 0.5); };
      c.beginPath(); ff(c); c.save(); c.lineWidth *= 2; c.stroke(); c.restore(); c.fillStyle = furS; c.fill();
      c.save(); c.translate(-0.5, -0.8); c.beginPath(); ff(c); c.fillStyle = fur; c.fill(); c.restore();
      if (kind === 'frost') {
        for (var k = 0; k < 5; k++) {
          var ax = -14 + k * 8, ay = -31 + abs(k - 2) * 2.2, hh = 9 - abs(k - 2) * 2;
          cel(c, function (c) { c.moveTo(ax - 2.6, ay + 3); c.lineTo(ax, ay - hh); c.lineTo(ax + 2.6, ay + 3); c.closePath(); }, '#BFF6FF', '#6FC8E8', '#FFFFFF', 1.2, 0.6);
        }
        if (Q.fx) { addOn(c); glow(c, 2, -38, 24, 12, '#8AF6FF', 0.5 + 0.15 * sin(P.t * 3)); addOff(c); }
      }
    } else {
      c.beginPath(); c.moveTo(23.5, 12); c.bezierCurveTo(25.5, -5, 16, -15.5, 3.5, -15.5); c.bezierCurveTo(-9, -15.5, -21, -7, -20.5, 15);
      strokeW(c, C[3], 1.5);
      if (kind === 'night' && Q.lod > 0) {
        for (var s = 0; s < 4; s++) spark(c, -18 + s * 11, -24 + (s % 2) * 5, 1.8, '#D5DEFF', 0.5 + 0.5 * sin(P.t * 3 + s * 1.7));
      }
    }
  }
  function headwear(c, R, P, Q, crown) {
    var hood = heroHood(R), p = R.pal;
    if (hood === 'wolf') { beastHead(c, R, P, Q, 'wolf'); }
    else if (hood === 'bear') { beastHead(c, R, P, Q, 'bear'); }
    else if (hood) {
      hoodFront(c, R, P, Q, hood);
      if (hood === 'ayaz' || hood === 'frost') { feathers(c, R, P, Q); beads(c, R, P, Q); braid(c, R, P, Q, 21, 6, 1); }
      if ((hood === 'ela' || hood === 'night') && R.extra === 'feathers') featherOne(c, P, 20, -24, 0.55, hood === 'night' ? ['#D5DEFF', '#62E8FF'] : ['#F2E2C0', '#C8402E']);
    }
    if (!hood && (R.extra === 'headband' || R.id === 'bora')) headband(c, R, P, Q);
  }
  function headband(c, R, P, Q) {
    var p = R.pal, sw = P.hair;
    var tail = function (c, o, len) {
      c.moveTo(-23, -6); c.quadraticCurveTo(-31, -6 + o + sw * 3, -36 - len + sw * 6, o + 2 - sw * 4);
      c.lineTo(-35 - len + sw * 6, o + 7 - sw * 4); c.quadraticCurveTo(-30, o + 2 + sw * 2, -22.5, -2); c.closePath();
    };
    cel(c, function (c) { tail(c, -2, 4); }, dk(p.cloth, 0.15), p.clothS, null, 1.5, 0);
    cel(c, function (c) { tail(c, 4, 0); }, p.cloth, p.clothS, p.clothL, 1.5, 0.6);
    cel(c, function (c) { c.moveTo(-24.4, -5.5); c.quadraticCurveTo(0, -16.5, 25.5, -10); c.lineTo(25.8, -5); c.quadraticCurveTo(0, -11, -24.6, -0.5); c.closePath(); }, p.cloth, p.clothS, p.clothL, 1.6, 0.7);
    cel(c, function (c) { RR(c, 6.5, -13.6, 9, 6.2, 1.6); }, p.accent, p.accS, p.accL, 1.2, 0.6);
    if (Q.lod > 0) fl(c, function (c) { c.moveTo(11, -12.4); c.lineTo(12.6, -10.5); c.lineTo(11, -8.6); c.lineTo(9.4, -10.5); c.closePath(); }, '#E8394D', true);
    fl(c, function (c) { Ci(c, -23.4, -3.4, 2.6); }, p.cloth);
  }
  function feathers(c, R, P, Q) {
    var sw = P.hair, frost = R.hs && R.hs.frost;
    var cols = frost ? [['#FFFFFF', '#8AF6FF'], ['#E6F7FF', '#BFF6FF']] : [['#F4F1EA', '#2F8F86'], ['#E7DCC8', '#C8402E']];
    for (var i = 0; i < 2; i++) {
      c.save(); c.translate(-20, -18 + i * 5); c.rotate(-0.9 - i * 0.45 + sw * 0.25);
      var col = cols[i];
      cel(c, function (c) { c.moveTo(0, 0); c.quadraticCurveTo(-4.5, -9, 0, -19); c.quadraticCurveTo(4.5, -9, 0, 0); c.closePath(); }, col[0], dk(col[0], 0.3), null, 1.2, 0);
      fl(c, function (c) { c.moveTo(0, -12); c.quadraticCurveTo(-3.6, -15, 0, -19); c.quadraticCurveTo(3.6, -15, 0, -12); c.closePath(); }, col[1], true);
      line(c, 0, 0, 0, -16, dk(col[0], 0.45), 0.7);
      c.restore();
    }
  }
  function featherOne(c, P, x, y, rot, col) {
    c.save(); c.translate(x, y); c.rotate(rot + P.hair * 0.2);
    cel(c, function (c) { c.moveTo(0, 0); c.quadraticCurveTo(-4.8, -10, 0, -21); c.quadraticCurveTo(4.8, -10, 0, 0); c.closePath(); }, col[0], dk(col[0], 0.3), null, 1.2, 0);
    fl(c, function (c) { c.moveTo(0, -13); c.quadraticCurveTo(-3.8, -16.5, 0, -21); c.quadraticCurveTo(3.8, -16.5, 0, -13); c.closePath(); }, col[1], true);
    line(c, 0, 1, 0, -18, dk(col[0], 0.45), 0.7);
    c.restore();
  }
  function beads(c, R, P, Q) {
    var sw = P.hair * 1.5, frost = R.hs && R.hs.frost;
    var cols = frost ? ['#BFF6FF', '#FFFFFF', '#8AF6FF'] : ['#E8394D', '#FFCB57', '#3EDBC8'];
    line(c, -20, 10, -21 + sw, 21, '#3A2A20', 0.8);
    for (var i = 0; i < 3; i++) fl(c, function (c) { Ci(c, -20.3 + sw * (i + 1) * 0.3, 13 + i * 3.6, 1.7); }, cols[i]);
  }
  function horns(c, R, P, Q, helm) {
    var black = R.hs && R.hs.hornCol, base = black ? '#3E3050' : '#F2E4C4', sh = black ? '#16101E' : '#BFA47A', li = black ? '#8A6CA8' : '#FFF8E6';
    var big = black ? 1.6 : 1.38;
    var hy = helm ? -30 : -22;
    for (var i = 0; i < 2; i++) {
      var x = i ? 11 : -9, y = hy - (i ? 1 : 0), s = (i ? 1 : 0.85) * big;
      c.save(); c.translate(x, y); c.scale(s, s);
      cel(c, function (c) { c.moveTo(-3.6, 1.5); c.quadraticCurveTo(-4.2, -8, -13, -13); c.quadraticCurveTo(-6, -6.5, 3.4, 0.8); c.closePath(); }, base, sh, li, 1.4, 0.7);
      if (Q.lod > 0) { line(c, -3.3, -2.5, 0.2, -1.2, black ? '#FF3D4F' : '#FFCB57', 1.1); line(c, -6.4, -5.8, -4.2, -4.3, black ? '#FF3D4F' : '#FFCB57', 1); }
      c.restore();
    }
    if (black && Q.fx) { addOn(c); glow(c, -16, -30, 8, 8, '#FF3D4F', 0.4); glow(c, 2, -33, 8, 8, '#FF3D4F', 0.4); addOff(c); }
  }
  function beastHead(c, R, P, Q, kind) {
    var C = hoodCols(R, kind), wolf = kind === 'wolf';
    // ears
    for (var i = 0; i < 2; i++) {
      var ex = i ? 12 : -14, ey = -26;
      c.save(); c.translate(ex, ey); c.rotate(i ? 0.25 : -0.3);
      if (wolf) {
        cel(c, function (c) { c.moveTo(-6, 4); c.lineTo(-1, -12); c.lineTo(6, 4); c.closePath(); }, C[0], C[1], C[2], 1.8, 0.8);
        fl(c, function (c) { c.moveTo(-3, 2.5); c.lineTo(-0.8, -7); c.lineTo(2.8, 2.5); c.closePath(); }, '#E7B9B0', true);
      } else {
        cel(c, function (c) { Ci(c, 0, -2, 5.5); }, C[0], C[1], C[2], 1.8, 0.8);
        fl(c, function (c) { Ci(c, 0, -2, 2.8); }, C[3], true);
      }
      c.restore();
    }
    // pelt dome
    cel(c, function (c) {
      c.moveTo(-27, 10); c.bezierCurveTo(-31, -16, -16, -31, 2, -31); c.bezierCurveTo(20, -31, 31, -17, 28, 4);
      c.quadraticCurveTo(24, -6, 18, -9); c.quadraticCurveTo(4, -12, -10, -9); c.quadraticCurveTo(-20, -6, -21, 12); c.closePath();
    }, C[0], C[1], C[2], 3, 1.3);
    // muzzle over the brow
    cel(c, function (c) {
      if (wolf) { c.moveTo(4, -21); c.quadraticCurveTo(22, -24, 33, -15); c.quadraticCurveTo(34, -10, 30, -9); c.quadraticCurveTo(18, -8, 6, -10); c.closePath(); }
      else { c.moveTo(6, -22); c.quadraticCurveTo(24, -24, 29, -15); c.quadraticCurveTo(28, -9, 22, -9); c.quadraticCurveTo(12, -8, 6, -11); c.closePath(); }
    }, C[0], C[1], C[2], 1.8, 0.8);
    fl(c, function (c) { E(c, wolf ? 31.5 : 27.5, -14.5, 2.4, 1.8); }, '#1A1018');
    // fangs on the brow line
    for (var k = 0; k < 3; k++) fl(c, function (c) { var fx = 10 + k * 6; c.moveTo(fx - 1.6, -9.6); c.lineTo(fx, -5.2 + (k % 2) * 0.8); c.lineTo(fx + 1.6, -9.6); c.closePath(); }, '#F6EEDC');
    // beast eye
    fl(c, function (c) { E(c, 14, -17, 2.4, 1.3, -0.2); }, kind === 'wolf' ? '#59B8FF' : '#FF4A5E');
    if (Q.fx) { addOn(c); glow(c, 14, -17, 7, 5, kind === 'wolf' ? '#59B8FF' : '#FF4A5E', 0.6); addOff(c); }
  }

  // ------------------------------------------------------------------------------------------ back layer: capes, wings, quiver, long hair, ponytail
  function backLayer(c, R, P, Q) {
    var cape = (R.hs && R.hs.cape) || R.sty.cape, p = R.pal, sw = P.cape;
    var gg = R.g.gogus;
    if (gg && gg.skin === 'sk_gogus_kanat') featherWings(c, gg, P, Q);
    if (R.hs && R.hs.wings === 'dragon') dragonWings(c, R, P, Q);
    if (R.sty.hair === 'long') longHairBack(c, R, P, Q);
    if (cape === 'tatter' || cape === 'royal' || cape === 'bear' || cape === 'wolfpelt' || cape === 'night' || cape === 'frost') capeDraw(c, R, P, Q, cape);
    if (cape === 'mantle') capeDraw(c, R, P, Q, 'mantle');
    if (cape === 'mantle' || cape === 'night') quiver(c, R, P, Q);
    if (cape === 'fur') capeDraw(c, R, P, Q, 'fur');
    if (R.sty.hair === 'pony' && !(R.g.kafa && R.g.kafa.skin !== 'sk_kafa_tac' && false)) ponytail(c, R, P, Q);
  }
  function capeCols(R, kind) {
    var p = R.pal, hs = R.hs;
    if (kind === 'royal') return hs && hs.capeCol ? [hs.capeCol, '#0C0810', hs.capeIn, p.accent] : [p.cloth, p.clothS, dk(p.cloth, 0.5), p.accent];
    if (kind === 'tatter') return [p.clothD, '#0E0A14', p.cloth, p.accent];
    if (kind === 'bear') return ['#5E2C22', '#2E1210', '#8E4A3A', '#C9806A'];
    if (kind === 'wolfpelt') return ['#7E8696', '#474E5C', '#A9B1BF', '#DDE2EA'];
    if (kind === 'night') return ['#141A3C', '#080B1E', '#2A3570', '#D5DEFF'];
    if (kind === 'frost') return ['#CFEFFF', '#7FBFE0', '#FFFFFF', '#FFFFFF'];
    if (kind === 'fur') return ['#EEF3F8', '#A9B7C8', '#FFFFFF', '#FFFFFF'];
    return [p.cloth, p.clothS, p.clothL, p.accent];
  }
  function capeDraw(c, R, P, Q, kind) {
    var C = capeCols(R, kind), sw = P.cape, t = P.t;
    var len = kind === 'mantle' ? 26 : kind === 'fur' ? 20 : kind === 'royal' || kind === 'tatter' ? 46 : 40;
    var by = -52 + len, fl2 = 3 + abs(sw) * 4;
    var jag = kind === 'tatter' || kind === 'bear' || kind === 'wolfpelt' || kind === 'frost';
    var f = function (c) {
      c.moveTo(-9, -53);
      c.quadraticCurveTo(-16 + sw * 3, -40, -18 + sw * 8 - fl2, by - 2);
      if (jag) {
        var x0 = -18 + sw * 8 - fl2, x1 = 7 + sw * 3, n = 6;
        for (var i = 1; i <= n; i++) {
          var k = i / n, x = lerp(x0, x1, k), y = by + (i % 2 ? 5 + 2 * sin(t * 3 + i) : -1) + sin(k * PI) * 2;
          c.lineTo(x, y);
        }
      } else c.quadraticCurveTo(-5 + sw * 5, by + 5, 7 + sw * 3, by);
      c.quadraticCurveTo(12, -38, 9, -53);
      c.closePath();
    };
    cel(c, f, C[0], C[1], C[2], 3, 1);
    if (kind === 'royal' || kind === 'night') {
      c.save(); c.beginPath(); f(c); c.clip();
      c.beginPath(); c.moveTo(-18 + sw * 8 - fl2, by - 2); c.quadraticCurveTo(-5 + sw * 5, by + 5, 7 + sw * 3, by); strokeW(c, C[3], 3);
      c.beginPath(); c.moveTo(-9, -53); c.quadraticCurveTo(-16 + sw * 3, -40, -18 + sw * 8 - fl2, by - 2); strokeW(c, C[2], 3);
      c.restore();
      if (kind === 'night' && Q.lod > 0) for (var s = 0; s < 3; s++) spark(c, -14 + sw * 5 + s * 4, -36 + s * 9, 1.6, '#D5DEFF', 0.4 + 0.5 * sin(t * 2.5 + s * 2));
    }
    if (kind === 'tatter') {
      c.save(); c.beginPath(); f(c); c.clip();
      c.beginPath(); c.moveTo(-9, -53); c.quadraticCurveTo(-16 + sw * 3, -40, -18 + sw * 8 - fl2, by - 2); strokeW(c, C[3], 2.2);
      c.restore();
    }
    if (kind === 'frost' && Q.fx) { addOn(c); glow(c, -10 + sw * 5, by - 8, 14, 12, '#8AF6FF', 0.35); addOff(c); }
    if (kind === 'bear' || kind === 'wolfpelt' || kind === 'fur') furRow(c, -12, -51, 8, -52, 4, 3, C[2], C[1], Q, 1);
  }
  function quiver(c, R, P, Q) {
    var night = R.hs && R.hs.cape === 'night';
    c.save(); c.translate(-8, -42); c.rotate(-0.55 + P.cape * 0.05);
    var b = night ? '#2A2F5E' : '#7A4B2C';
    for (var i = 0; i < 3; i++) {
      var x = -3 + i * 3;
      line(c, x, -10, x, -20, '#D8C8A8', 1.2);
      fl(c, function (c) { c.moveTo(x, -18); c.lineTo(x - 2.4, -24); c.lineTo(x, -22.5); c.lineTo(x + 2.4, -24); c.closePath(); }, i === 1 ? (night ? '#62E8FF' : '#E8394D') : '#F4F1EA');
    }
    cel(c, function (c) { RR(c, -5.5, -12, 11, 26, 3.5); }, b, dk(b, 0.4), lt(b, 0.2), 2, 0.9);
    line(c, -5.5, -8.5, 5.5, -8.5, night ? '#D5DEFF' : '#C9A15A', 1.6);
    c.restore();
  }
  function ponytail(c, R, P, Q) {
    var p = R.pal, b = P.hair * 6;
    c.save(); c.translate(HEAD_X - 16, HEAD_Y + 4);
    cel(c, function (c) {
      c.moveTo(4, -8); c.quadraticCurveTo(-16 + b * 0.3, -10, -19 + b, 8);
      c.quadraticCurveTo(-20 + b * 1.2, 22, -11 + b * 1.5, 34);
      c.quadraticCurveTo(-12 + b, 21, -7 + b * 0.5, 11);
      c.quadraticCurveTo(-3, 3, 5, 2); c.closePath();
    }, p.hair, p.hairS, p.hairL, 2.2, 1);
    if (Q.lod > 0) { c.beginPath(); c.moveTo(-8 + b * 0.4, 0); c.quadraticCurveTo(-15 + b, 12, -12 + b * 1.4, 26); strokeW(c, rgba(p.hairL, 0.7), 1.2); }
    fl(c, function (c) { RR(c, -4, -9, 7, 7, 2); }, R.hs ? '#62E8FF' : p.accent);
    c.restore();
  }
  function longHairBack(c, R, P, Q) {
    var p = R.pal, sw = P.hair * 3;
    c.save(); c.translate(HEAD_X, HEAD_Y);
    cel(c, function (c) {
      c.moveTo(-18, -20); c.quadraticCurveTo(-34, -8, -30 + sw, 20);
      c.lineTo(-27 + sw * 1.4, 33); c.lineTo(-21 + sw, 25); c.lineTo(-16 + sw * 1.2, 35); c.lineTo(-10 + sw * 0.6, 24);
      c.lineTo(-2, 30); c.lineTo(4, 22); c.lineTo(14, 26); c.lineTo(20, 16);
      c.quadraticCurveTo(28, 0, 18, -20); c.closePath();
    }, dk(p.hair, 0.12), p.hairS, null, 3, 0);
    c.restore();
  }
  function featherWings(c, g, P, Q) {
    var t = P.t, flap = sin(t * 4.2) * 0.16 + (P.cape || 0) * 0.1;
    var wing = function (c) {
      c.moveTo(0, 0); c.quadraticCurveTo(-4, -20, -2, -35);
      c.quadraticCurveTo(-9, -36, -15, -32); c.lineTo(-12, -27.5);
      c.quadraticCurveTo(-20, -29, -25, -24); c.lineTo(-20, -19.5);
      c.quadraticCurveTo(-28, -19, -31, -12); c.lineTo(-25, -9);
      c.quadraticCurveTo(-31, -5, -31, 1); c.lineTo(-22, 0);
      c.quadraticCurveTo(-10, 5, 0, 0); c.closePath();
    };
    for (var i = 0; i < 2; i++) {
      var back = i === 0;
      c.save(); c.translate(back ? -2 : -6, -47); c.rotate((back ? -0.3 : -0.75) - flap * (back ? 0.6 : 1)); if (back) c.scale(0.86, 0.86);
      cel(c, wing, back ? '#C7D0E4' : '#FFFFFF', '#8E9CC0', back ? null : '#FFFFFF', 2.6, 0);
      if (Q.lod > 0) { line(c, -6, -26, -11, -9, '#B7C2DC', 0.9); line(c, -14, -20, -19, -6, '#B7C2DC', 0.9); }
      c.beginPath(); c.moveTo(0, 0); c.quadraticCurveTo(-4, -20, -2, -35); strokeW(c, g.tc, 1.6);
      c.restore();
    }
    if (Q.fx) { addOn(c); glow(c, -20, -68, 22, 20, '#FFE6A8', 0.3 + 0.1 * sin(t * 3)); addOff(c); }
  }
  function dragonWings(c, R, P, Q) {
    var t = P.t, flap = sin(t * 3.4) * 0.2 + P.cape * 0.1;
    for (var i = 0; i < 2; i++) {
      var back = i === 0;
      c.save(); c.translate(back ? -3 : -7, -47); c.rotate((back ? -0.25 : -0.7) - flap * (back ? 0.6 : 1)); if (back) c.scale(0.85, 0.85);
      var f = function (c) {
        c.moveTo(0, 0); c.lineTo(-6, -24); c.lineTo(-26, -18);
        c.quadraticCurveTo(-22, -12, -24, -7); c.quadraticCurveTo(-18, -8, -15, -3); c.quadraticCurveTo(-10, -5, -7, 1); c.closePath();
      };
      cel(c, f, back ? '#2A1F33' : '#3A2A47', '#14101C', null, 2.4, 0);
      line(c, 0, 0, -6, -24, '#120C18', 1.6); line(c, -6, -24, -24, -7, rgba('#FF3D4F', 0.7), 0.9); line(c, -6, -24, -15, -3, rgba('#FF3D4F', 0.7), 0.9);
      fl(c, function (c) { c.moveTo(-6, -24); c.lineTo(-8, -29); c.lineTo(-4, -25); c.closePath(); }, '#FFCB57');
      c.restore();
    }
  }
  function smear(c, R, P, Q) {
    var S = P.smear, col = R.w ? (R.w.rar >= 2 ? R.w.tc : '#FFFFFF') : '#FFFFFF';
    if (R.w && R.w.skin === 'sk_kilic_buz') col = '#9BE8FF';
    if (R.w && R.w.skin === 'sk_kilic_ejder') col = '#FFB020';
    c.save(); addOn(c);
    if (S.kind === 'arc') {
      var th0 = HP - S.a0, th1 = HP - S.a1, cx = SHO_X - 2, cy = SHO_Y + 2, r1 = 60, r0 = 34;
      if (th1 < th0) { var tt = th0; th0 = th1; th1 = tt; }
      c.beginPath(); c.arc(cx, cy, r1, th0, th1); c.arc(cx, cy, r0, th1, th0, true); c.closePath();
      c.fillStyle = rgba(col, 0.32 * S.al); c.fill();
      c.beginPath(); c.arc(cx, cy, r1 - 1, th0 + (th1 - th0) * 0.3, th1); strokeW(c, rgba('#FFFFFF', 0.85 * S.al), 2.4);
    } else if (S.kind === 'ring') {
      c.beginPath(); c.ellipse(0, -36, 54, 13, 0, 0, TAU); strokeW(c, rgba(col, 0.35 * S.al), 5);
      c.beginPath(); c.ellipse(0, -36, 54, 13, 0, S.phi - 1.6, S.phi); strokeW(c, rgba('#FFFFFF', 0.8 * S.al), 2.4);
    }
    c.restore();
  }
  function castCircle(c, R, P, Q) {
    var col = R.hs ? R.hs.aura : (R.aura || R.pal.accent), t = P.t, a = P.cast;
    c.save();
    c.translate(0, P.lift - P.drop);
    addOn(c);
    glow(c, 0, 0, 40, 12, col, 0.5 * a);
    c.beginPath(); c.ellipse(0, 0, 32, 9, 0, 0, TAU); strokeW(c, rgba(col, 0.75 * a), 1.6);
    c.beginPath(); c.ellipse(0, 0, 24, 6.6, 0, 0, TAU); strokeW(c, rgba(col, 0.5 * a), 1);
    for (var i = 0; i < 8; i++) {
      var an = t * 1.2 + i * TAU / 8, x = cos(an) * 28, y = sin(an) * 7.8;
      c.beginPath(); c.moveTo(x - 1.6, y); c.lineTo(x, y - 2.8); c.lineTo(x + 1.6, y); strokeW(c, rgba('#FFFFFF', 0.7 * a), 1);
    }
    addOff(c);
    c.restore();
  }
  // ------------------------------------------------------------------------------------------ gear helpers
  var EMBER2 = '#FFE08A';
  function halo(c, g, x, y, rx, ry, Q, t) {
    if (g.rar < 3 || !Q.fx) return;
    var a = (g.rar === 3 ? 0.42 : g.rar === 4 ? 0.5 : 0.58) * (0.82 + 0.18 * sin(t * 3 + x * 0.3));
    addOn(c); glow(c, x, y, rx, ry, g.tc, a); addOff(c);
  }
  function twinkle(c, g, x, y, Q, t, s) {
    if (g.rar < 2 || Q.lod < 1 || Q.icon) return;
    var k = pow(mx(0, sin(t * 1.9 + x * 0.37 + y * 0.53)), 10);
    if (k > 0.04) { addOn(c); spark(c, x, y, (s || 3) * (0.5 + 0.7 * k), '#FFFFFF', k); addOff(c); }
  }
  function edge(c, fn, col, w) { c.beginPath(); fn(c); strokeW(c, rgba(OUT, 0.7), w * 0.75 + 1.1); strokeW(c, col, w * 0.72); }
  function rivets(c, pts, r, col, Q) {
    if (Q.lod < 1) return;
    c.beginPath(); for (var i = 0; i < pts.length; i += 2) Ci(c, pts[i], pts[i + 1], r);
    c.fillStyle = col; c.fill();
    c.beginPath(); for (var j = 0; j < pts.length; j += 2) Ci(c, pts[j] - r * 0.3, pts[j + 1] - r * 0.3, r * 0.4);
    c.fillStyle = '#FFFFFF'; c.fill();
  }
  function crack(c, pts, Q, t, col) {
    col = col || '#FF7A2F';
    var pulse = 0.7 + 0.3 * sin(t * 4.2 + pts[0] * 0.7);
    var f = function (c) { c.moveTo(pts[0], pts[1]); for (var i = 2; i < pts.length; i += 2) c.lineTo(pts[i], pts[i + 1]); };
    if (Q.fx) { c.save(); addOn(c); c.beginPath(); f(c); strokeW(c, rgba(col, 0.26 * pulse), 2.6); c.restore(); }
    c.beginPath(); f(c); strokeW(c, rgba(col, 0.95 * pulse), 0.95);
    if (Q.lod > 0) { c.beginPath(); f(c); strokeW(c, rgba(EMBER2, 0.9 * pulse), 0.36); }
  }
  // fish-scale texture: one cached pattern tile per colour (one fill instead of dozens of arc strokes)
  var SCALEPAT = Object.create(null), PAT_OK = typeof DOMMatrix !== 'undefined';
  function scalePat(c, col) {
    var p = SCALEPAT[col];
    if (p === undefined) {
      p = null;
      try {
        var cv = mkCv(40, 38), g = cv.getContext('2d');
        g.strokeStyle = col; g.lineWidth = 6.4; g.lineCap = 'round';
        var rows = [[-19, 20], [0, 0], [19, 20], [38, 0], [-38, 0]];
        g.beginPath();
        for (var i = 0; i < rows.length; i++) for (var x = rows[i][1] - 40; x <= 80; x += 40) { g.moveTo(x + 20, rows[i][0]); g.arc(x, rows[i][0], 20, 0, PI); }
        g.stroke();
        p = c.createPattern(cv, 'repeat');
        if (!p || !p.setTransform) p = null;
      } catch (e) { p = null; }
      SCALEPAT[col] = p;
    }
    return p;
  }
  function scaleRows(c, x0, y0, x1, y1, r, col) {
    var pat = PAT_OK ? scalePat(c, col) : null;
    if (pat) {
      var k = r / 20;
      try { pat.setTransform(new DOMMatrix([k, 0, 0, k, x0, y0])); c.fillStyle = pat; c.fillRect(x0 - r, y0 - r, x1 - x0 + r * 2, y1 - y0 + r * 2); return; } catch (e) { }
    }
    c.beginPath();
    for (var row = 0, y = y0; y <= y1; y += r * 0.95, row++) {
      for (var x = x0 + (row % 2) * r; x <= x1 + r; x += r * 2) { c.moveTo(x + r, y); c.arc(x, y, r, 0, PI); }
    }
    strokeW(c, col, 0.85);
  }
  function rune(c, x, y, s, col, k) {
    c.beginPath();
    k = (k | 0) % 4;
    if (k === 0) { c.moveTo(x, y - s); c.lineTo(x + s * 0.6, y); c.lineTo(x, y + s); c.lineTo(x - s * 0.6, y); c.closePath(); c.moveTo(x, y - s * 0.35); c.lineTo(x, y + s * 0.35); }
    else if (k === 1) { c.moveTo(x, y + s); c.lineTo(x, y - s); c.moveTo(x - s * 0.65, y - s * 0.7); c.quadraticCurveTo(x - s * 0.6, y, x, y + s * 0.1); c.quadraticCurveTo(x + s * 0.6, y, x + s * 0.65, y - s * 0.7); }
    else if (k === 2) { c.moveTo(x - s * 0.85, y); c.quadraticCurveTo(x, y - s * 0.85, x + s * 0.85, y); c.quadraticCurveTo(x, y + s * 0.85, x - s * 0.85, y); c.moveTo(x + s * 0.22, y); c.arc(x, y, s * 0.22, 0, TAU); }
    else { c.moveTo(x + s * 0.35, y - s * 0.75); c.arc(x, y, s * 0.82, -1.15, 1.15, true); c.moveTo(x + s * 0.32, y); c.arc(x + s * 0.12, y, s * 0.2, 0, TAU); }
    strokeW(c, col, 1.05);
  }
  function runeGlow(c, x, y, s, col, Q, t, k) {
    var a = 0.75 + 0.25 * sin(t * 3 + k * 1.3);
    if (Q.fx) { addOn(c); glow(c, x, y, s * 3, s * 3, col, 0.55 * a); addOff(c); }
    rune(c, x, y, s, rgba(lt(col, 0.4), a), k);
  }
  function gemAt(c, x, y, r, col, Q, t, glowA) {
    cel(c, function (c) { c.moveTo(x, y - r); c.lineTo(x + r * 0.85, y); c.lineTo(x, y + r); c.lineTo(x - r * 0.85, y); c.closePath(); }, col, dk(col, 0.45), lt(col, 0.55), r * 0.5, r * 0.25);
    if (glowA && Q.fx) { addOn(c); glow(c, x, y, r * 3.2, r * 3.2, col, glowA * (0.8 + 0.2 * sin(t * 4 + x))); addOff(c); }
  }

  // ------------------------------------------------------------------------------------------ helmet (head-local)
  function domePath(top, rc, rs) {
    return function (c) {
      c.moveTo(-26.6, rs);
      c.bezierCurveTo(-29.5, -16, -16, top, 1, top);
      c.bezierCurveTo(18, top, 30.5, -16, 27.8, rs - 2);
      c.quadraticCurveTo(15, rc - 1, 2, rc);
      c.quadraticCurveTo(-14, rc - 0.5, -26.6, rs);
      c.closePath();
    };
  }
  function rimPath(rc, rs, w) {
    return function (c) {
      c.moveTo(-26.6, rs); c.quadraticCurveTo(-14, rc - 0.5, 2, rc); c.quadraticCurveTo(15, rc - 1, 27.8, rs - 2);
      c.lineTo(28, rs - 2 - w); c.quadraticCurveTo(15, rc - 1 - w, 2, rc - w); c.quadraticCurveTo(-14, rc - 0.5 - w, -26.9, rs - w); c.closePath();
    };
  }
  function pieceHelmet(c, g, Q, t, R) {
    if (g.skin === 'sk_kafa_tac') { shadowCrown(c, g, Q, t); return; }
    c.save(); c.translate(0, -3); helmetBody(c, g, Q, t, R); c.restore();
  }
  function helmetBody(c, g, Q, t, R) {
    var m = g.m, set = g.set, sk = g.skin;
    var sw = Q.P ? Q.P.hair || 0 : 0;
    halo(c, g, 1, -16, 40, 28, Q, t);
    if (sk === 'sk_kafa_boynuz') {
      for (var i = 0; i < 2; i++) {
        c.save(); c.translate(i ? 24 : -24, -12); c.scale(i ? 1 : -1, 1);
        cel(c, function (c) { c.moveTo(-3, 3); c.quadraticCurveTo(10, 2, 14, -10); c.quadraticCurveTo(16, -18, 11, -26); c.quadraticCurveTo(12, -14, 4, -8); c.quadraticCurveTo(0, -6, -3, -4); c.closePath(); }, '#F2E4C4', '#B89C70', '#FFF8E6', 2, 0.8);
        if (Q.lod > 0) { line(c, 6, -2, 9, -6, '#B89C70', 1); line(c, 10, -9, 13, -12, '#B89C70', 1); }
        c.restore();
      }
      var dp = domePath(-31, -6, 5);
      cel(c, dp, '#7C8597', '#4A5162', '#B6BFCF', 3, 1.3);
      edge(c, function (c) { c.moveTo(1, -31); c.lineTo(2, -6); }, '#4A5162', 3.2);
      cel(c, rimPath(-6, 5, 4.2), g.tc, g.td, lt(g.tc, 0.4), 1.4, 0.6);
      rivets(c, [-20, -2.5, -10, -6.5, 12, -7.5, 22, -4], 1.1, '#D8DEE8', Q);
      twinkle(c, g, -8, -24, Q, t);
      return;
    }
    var top = -31, rc = -6, rs = 5;
    if (set === 'kurt') {
      for (var e = 0; e < 2; e++) {
        c.save(); c.translate(e ? 13 : -13, -27); c.rotate(e ? 0.3 : -0.35);
        cel(c, function (c) { c.moveTo(-5.5, 4); c.lineTo(-0.5, -10); c.lineTo(5.5, 4); c.closePath(); }, m.b, m.s, m.l, 1.6, 0.7);
        fl(c, function (c) { c.moveTo(-2.6, 2.5); c.lineTo(-0.5, -5); c.lineTo(2.6, 2.5); c.closePath(); }, m.a, true);
        c.restore();
      }
      var dk1 = domePath(top, rc, rs);
      cel(c, dk1, m.b, m.s, m.l, 3, 1.3);
      if (Q.lod > 0) { c.save(); c.setLineDash([1.6, 1.5]); edge(c, function (c) { c.moveTo(1, -30); c.quadraticCurveTo(3, -18, 2, -9); }, m.l, 0.8); c.restore(); }
      furRow(c, -27, rs - 4.5, 28, rs - 6.5, 10, 2.8, m.a, m.aS, Q, 7.5);
      cel(c, function (c) { c.moveTo(2, -17); c.lineTo(7, -13); c.lineTo(2, -8.5); c.lineTo(-3, -13); c.closePath(); }, g.tc, g.td, lt(g.tc, 0.45), 1.2, 0.5);
      twinkle(c, g, 2, -13, Q, t);
    } else if (set === 'gece') {
      var dp2 = domePath(-30, -7, 3);
      // plume
      c.save(); c.translate(1, -29); c.rotate(-0.25 + sw * 0.12);
      var plume = function (c) { c.moveTo(-2, 1); c.quadraticCurveTo(-6, -12, -20, -14); c.quadraticCurveTo(-12, -9, -14, -4); c.quadraticCurveTo(-8, -4, 3, 1); c.closePath(); };
      cel(c, plume, '#3D5AA8', '#1E2E66', '#6F8FE0', 2, 0.8);
      c.save(); c.beginPath(); plume(c); c.clip(); fl(c, function (c) { Ci(c, -20, -14, 6.5); }, g.tc, true); c.restore(); c.beginPath(); plume(c); c.stroke();
      c.restore();
      cel(c, dp2, m.b, m.s, m.l, 3, 1.3);
      edge(c, function (c) { c.moveTo(1.5, -30); c.quadraticCurveTo(3, -18, 2, -8); }, m.l, 1.4);
      // brim
      cel(c, function (c) { c.moveTo(-31, 2); c.quadraticCurveTo(-14, -10, 2, -9.5); c.quadraticCurveTo(19, -10, 33, -1); c.quadraticCurveTo(20, -3, 2, -4); c.quadraticCurveTo(-15, -3.5, -31, 2); c.closePath(); }, m.b, m.s, m.l, 1.5, 0.8);
      edge(c, function (c) { c.moveTo(-30, 1.5); c.quadraticCurveTo(-15, -3.8, 2, -4.3); c.quadraticCurveTo(20, -3.3, 32, -1.2); }, g.tc, 1.5);
      rivets(c, [-20, -5.5, -10, -8, 2, -8.6, 14, -8.1, 24, -5.2], 1, m.m, Q);
      twinkle(c, g, -10, -22, Q, t);
    } else if (set === 'kor') {
      var dp3 = function (c) {
        c.moveTo(-27, 12); c.bezierCurveTo(-30, -16, -16, -32, 1, -32); c.bezierCurveTo(18, -32, 31, -16, 28.5, 10);
        c.lineTo(23.5, 12); c.quadraticCurveTo(22, -2, 15, -5.5); c.quadraticCurveTo(2, -8.5, -10, -6);
        c.quadraticCurveTo(-18, -3, -20.5, 13); c.closePath();
      };
      cel(c, function (c) { c.moveTo(-6, -29); c.quadraticCurveTo(0, -40, 10, -42); c.quadraticCurveTo(6, -34, 8, -29); c.closePath(); }, m.b, m.s, m.l, 1.5, 0.6);
      cel(c, dp3, m.b, m.s, m.l, 3, 1.3);
      crack(c, [-19, -19, -16.5, -16.8, -17.5, -14.2, -14.6, -12.6, -15, -10], Q, t);
      crack(c, [8, -28, 10, -25.5, 9.2, -22.4, 12, -20, 11.4, -17.2], Q, t);
      crack(c, [24, 1, 25.2, 3.6, 24, 6.4], Q, t);
      edge(c, function (c) { c.moveTo(23.5, 12); c.quadraticCurveTo(22, -2, 15, -5.5); c.quadraticCurveTo(2, -8.5, -10, -6); c.quadraticCurveTo(-18, -3, -20.5, 13); }, g.tc, 1.6);
      twinkle(c, g, -6, -25, Q, t);
    } else if (set === 'ejder') {
      var dp4 = domePath(top, rc, rs);
      cel(c, dp4, m.b, m.s, m.l, 3, 1.3);
      if (Q.lod > 0) { c.save(); c.beginPath(); dp4(c); c.clip(); scaleRows(c, -26, -28, 28, -6, 3, rgba(m.s, 0.9)); c.restore(); }
      for (var h = 0; h < 2; h++) {
        c.save(); c.translate(h ? 12 : -17, h ? -24 : -21); c.scale(h ? 1.2 : 1.05, h ? 1.2 : 1.05);
        cel(c, function (c) { c.moveTo(-3, 2); c.quadraticCurveTo(-6, -9, -18, -13); c.quadraticCurveTo(-8, -10, 4, 0); c.closePath(); }, m.horn, m.hornS, '#FFFFFF', 1.4, 0.6);
        if (Q.lod > 0) { line(c, -4.5, -3, -2, -1, m.hornS, 0.8); line(c, -9, -7.5, -7, -5.5, m.hornS, 0.8); }
        c.restore();
      }
      cel(c, rimPath(rc, rs, 4), m.a, m.aS, lt(m.a, 0.5), 1.3, 0.6);
      edge(c, function (c) { c.moveTo(-26.6, rs - 4); c.quadraticCurveTo(-14, rc - 4.5, 2, rc - 4); c.quadraticCurveTo(15, rc - 5, 28, rs - 6); }, g.tc, 1.2);
      cel(c, function (c) { c.moveTo(2, -20); c.lineTo(7.5, -12.5); c.lineTo(2, -6.5); c.lineTo(-3.5, -12.5); c.closePath(); }, m.a, m.aS, lt(m.a, 0.5), 1.2, 0.5);
      gemAt(c, 2, -12.8, 2.6, m.gem, Q, t, g.rar >= 3 ? 0.6 : 0);
      twinkle(c, g, -12, -20, Q, t);
    } else { // golge
      var sp = function (c) {
        c.moveTo(-26.6, rs); c.bezierCurveTo(-29.5, -14, -22, -24, -16, -27);
        c.lineTo(-17, -38); c.lineTo(-9, -30); c.lineTo(-4, -44); c.lineTo(2, -31); c.lineTo(10, -42); c.lineTo(12, -29);
        c.lineTo(22, -35); c.lineTo(21.5, -24);
        c.bezierCurveTo(28, -18, 30.5, -10, 27.8, rs - 2);
        c.quadraticCurveTo(15, rc - 1, 2, rc); c.quadraticCurveTo(-14, rc - 0.5, -26.6, rs); c.closePath();
      };
      cel(c, sp, m.b, m.s, m.l, 3, 1.3);
      edge(c, rimPath(rc, rs, 0), g.tc, 1.6);
      runeGlow(c, -14, -14, 2.4, m.a, Q, t, 0); runeGlow(c, 16, -16, 2.4, m.a, Q, t, 1);
      gemAt(c, 2, -14, 3.6, m.a, Q, t, 0.8);
      if (Q.lod > 0) fl(c, function (c) { E(c, 2, -14, 0.8, 2.2); }, m.r2, true);
      twinkle(c, g, -4, -36, Q, t);
    }
  }
  function shadowCrown(c, g, Q, t) {
    var bob = sin(t * 2.2) * 1.2, y = -27 + bob;
    if (Q.fx) { addOn(c); glow(c, 2, y - 6, 34, 18, '#9D6BFF', 0.5 + 0.12 * sin(t * 3)); addOff(c); }
    var f = function (c) {
      c.moveTo(-17, y + 4); c.lineTo(-19, y - 9); c.lineTo(-11, y - 3); c.lineTo(-7, y - 15); c.lineTo(-1, y - 4);
      c.lineTo(3, y - 19); c.lineTo(7, y - 4); c.lineTo(13, y - 15); c.lineTo(16, y - 3); c.lineTo(23, y - 9); c.lineTo(21, y + 4);
      c.quadraticCurveTo(2, y + 8, -17, y + 4); c.closePath();
    };
    cel(c, f, '#2A2040', '#120C1E', '#5A4884', 2.4, 1);
    edge(c, function (c) { c.moveTo(-17, y + 1.5); c.quadraticCurveTo(2, y + 5.2, 21, y + 1.5); }, g.tc, 1.4);
    gemAt(c, 3, y - 1, 2.8, '#B57BFF', Q, t, 0.9);
    gemAt(c, -9, y + 0.5, 1.8, '#FF3D4F', Q, t, 0.5); gemAt(c, 14, y + 0.5, 1.8, '#FF3D4F', Q, t, 0.5);
    if (Q.lod > 0) for (var i = 0; i < 3; i++) { var k = fract(t * 0.6 + i / 3); spark(c, -12 + i * 13, y - 16 - k * 10, 1.8, '#C9A8FF', sin(k * PI) * 0.9); }
  }

  // ------------------------------------------------------------------------------------------ mask (head-local)
  function lowMaskPath(c) {
    c.moveTo(-20.4, 12.2);
    c.quadraticCurveTo(-8, 10.8, 2, 11.4);
    c.quadraticCurveTo(6, 8.8, 10, 11.4);
    c.quadraticCurveTo(18, 11.6, 22.6, 9.6);
    c.ellipse(0, 0, 24.2, 22.2, 0, 0.41, PI - 0.56);
    c.closePath();
  }
  function maskChin(c) { c.moveTo(-15, 19.6); c.quadraticCurveTo(2, 24.4, 19, 18.6); }
  function pieceMask(c, g, Q, t, mode) {
    var m = g.m, set = g.set, sk = g.skin;
    if (mode === 'eyes') {
      halo(c, g, 4, 4, 30, 14, Q, t);
      var f = function (c) {
        c.moveTo(-22, -3); c.quadraticCurveTo(-14, -9, -6, -6.5); c.quadraticCurveTo(3, -4, 6, -1.5); c.quadraticCurveTo(9, -4, 14, -6.5);
        c.quadraticCurveTo(24, -9, 29, -6); c.quadraticCurveTo(26, 4, 22, 9.5); c.quadraticCurveTo(14, 13.5, 8, 8);
        c.quadraticCurveTo(5, 5.5, 2.5, 8); c.quadraticCurveTo(-6, 13.5, -13, 10); c.quadraticCurveTo(-19, 6, -22, -3); c.closePath();
      };
      cel(c, f, m.b, m.s, m.l, 2.2, 1);
      if (Q.lod > 0) { c.save(); c.beginPath(); f(c); c.clip(); scaleRows(c, -22, -7, 29, 12, 2.4, rgba(m.s, 0.9)); c.restore(); }
      edge(c, f, g.tc, 1.2);
      c.fillStyle = m.a; c.beginPath(); E(c, FX - 8.6, 4, 5.6, 7.3); E(c, FX + 9.4, 4, 6.1, 7.6); c.fill();
      cel(c, function (c) { c.moveTo(26, -6); c.quadraticCurveTo(31, -10, 32, -16); c.quadraticCurveTo(29, -9, 23, -6.5); c.closePath(); }, m.horn, m.hornS, null, 1, 0);
      twinkle(c, g, 26, 0, Q, t, 2.6);
      return;
    }
    halo(c, g, 2, 15, 28, 14, Q, t);
    if (sk === 'sk_yuz_iblis') {
      cel(c, lowMaskPath, '#A3141F', '#5A0911', '#E8434F', 2.2, 1);
      fl(c, function (c) { c.moveTo(-12, 15.4); c.quadraticCurveTo(3, 23.5, 18, 14.6); c.quadraticCurveTo(3, 18.2, -12, 15.4); c.closePath(); }, '#1A0408');
      fl(c, function (c) { for (var i = 0; i < 6; i++) { var x = -8.5 + i * 4.6, y0 = 15.9 + sin((i + 0.5) / 6 * PI) * 1.9; c.moveTo(x - 1.5, y0); c.lineTo(x, y0 + (i === 0 || i === 5 ? 4.2 : 2.4)); c.lineTo(x + 1.5, y0); c.closePath(); } }, '#FFF3E0', true);
      line(c, -6, 12.4, -1.5, 13.6, '#FFCB57', 1.1); line(c, 13.5, 12, 9, 13.4, '#FFCB57', 1.1);
      for (var tk = 0; tk < 2; tk++) cel(c, function (c) { var x = tk ? 18.5 : -12.5, d = tk ? 1 : -1; c.moveTo(x - d * 1.6, 16.6); c.quadraticCurveTo(x + d * 2.4, 14.6, x + d * 2.2, 9.4); c.quadraticCurveTo(x + d * 0.6, 13, x - d * 1.4, 14.2); c.closePath(); }, '#F6EEDC', '#B8A88A', null, 0.6, 0);
      edge(c, maskChin, g.tc, 1.3);
      for (var h = 0; h < 2; h++) cel(c, function (c) { var hx = h ? 15 : -5; c.moveTo(hx - 2.6, -8); c.quadraticCurveTo(hx - 1, -15, hx + 2.5, -17.5); c.quadraticCurveTo(hx + 1, -12, hx + 2.6, -8); c.closePath(); }, '#A3141F', '#5A0911', null, 1, 0);
      if (Q.fx) { addOn(c); glow(c, 3, 17, 12, 6, '#FF3D4F', 0.4); addOff(c); }
      return;
    }
    cel(c, lowMaskPath, m.b, m.s, m.l, 2.2, 1);
    if (set === 'kurt') {
      for (var k = 0; k < 5; k++) { var fx = -13 + k * 7.2, fy = 11.6 - (k === 3 ? 1.4 : 0); fl(c, function (c) { c.moveTo(fx - 1.7, fy); c.lineTo(fx, fy + 3.8); c.lineTo(fx + 1.7, fy); c.closePath(); }, '#F6EEDC'); }
      if (Q.lod > 0) { c.save(); c.setLineDash([1.4, 1.4]); edge(c, function (c) { c.moveTo(-17, 17.5); c.quadraticCurveTo(3, 21.5, 21, 15.5); }, m.l, 0.8); c.restore(); }
      edge(c, maskChin, g.tc, 1.3);
    } else if (set === 'gece') {
      for (var s2 = 0; s2 < 3; s2++) line(c, 4 + s2 * 0.4, 14.2 + s2 * 2.5, 16.5 - s2, 13.8 + s2 * 2.5, OUT, 1.1);
      rivets(c, [-14, 14.5, -8.5, 18, 19.5, 13.6], 0.9, m.m, Q);
      edge(c, maskChin, g.tc, 1.3);
    } else if (set === 'kor') {
      crack(c, [3, 14.6, 8, 15.2, 12, 14.4, 17, 14.8], Q, t); crack(c, [-13, 13.2, -11, 15.6, -12.4, 17.6], Q, t);
      edge(c, maskChin, g.tc, 1.3);
    } else if (set === 'golge') {
      var zz = function (c) { c.moveTo(-9, 16); for (var i = 0; i < 9; i++) c.lineTo(-9 + i * 3.4, i % 2 ? 13.8 : 17.4); };
      if (Q.fx) { addOn(c); c.beginPath(); zz(c); strokeW(c, rgba(m.a, 0.4), 3); addOff(c); }
      c.beginPath(); zz(c); strokeW(c, lt(m.a, 0.3), 1.1);
      gemAt(c, -14.5, 14.8, 1.7, m.r2, Q, t, 0.5);
      edge(c, maskChin, g.tc, 1.3);
    } else {
      if (Q.lod > 0) { c.save(); c.beginPath(); lowMaskPath(c); c.clip(); scaleRows(c, -22, 11, 24, 22, 2.4, rgba(m.s, 0.9)); c.restore(); }
      edge(c, maskChin, m.a, 1.5);
    }
    twinkle(c, g, -10, 15, Q, t, 2.6);
  }

  // ------------------------------------------------------------------------------------------ necklace (body coords)
  function pieceNeck(c, g, Q, t) {
    var m = g.m, set = g.set, px = 1.5, py = -43.8;
    var chainCol = set === 'kurt' ? '#5A3A26' : set === 'gece' ? '#DCE4EF' : set === 'kor' ? '#6A5A56' : set === 'ejder' ? '#FFCB57' : '#4B3C6A';
    c.beginPath(); c.moveTo(-7, -51.8); c.quadraticCurveTo(px, -40.5, 10, -51.8); strokeW(c, OUT, 2.4); strokeW(c, chainCol, 1.2);
    if (Q.lod > 0 && set !== 'kurt') { c.save(); c.setLineDash([0.8, 1.1]); c.beginPath(); c.moveTo(-7, -51.8); c.quadraticCurveTo(px, -40.5, 10, -51.8); strokeW(c, dk(chainCol, 0.5), 0.8); c.restore(); }
    halo(c, g, px, py, 10, 10, Q, t);
    if (set === 'kurt') {
      for (var i = -1; i <= 1; i += 2) fl(c, function (c) { var x = px + i * 4.2, y = py - 2.4; c.moveTo(x - 1.2, y); c.quadraticCurveTo(x + i * 0.6, y + 3.2, x + i * 0.2, y + 4.6); c.quadraticCurveTo(x + 1, y + 2, x + 1.2, y); c.closePath(); }, '#F6EEDC');
      cel(c, function (c) { c.moveTo(px - 1.8, py - 1); c.quadraticCurveTo(px - 1.6, py + 4, px + 0.8, py + 6.5); c.quadraticCurveTo(px + 2.2, py + 3, px + 1.8, py - 1); c.closePath(); }, '#F6EEDC', '#C9B898', null, 0.8, 0);
      fl(c, function (c) { Ci(c, px, py - 1.6, 1.6); }, g.tc);
    } else if (set === 'gece') {
      cel(c, function (c) { c.moveTo(px, py - 3.8); c.lineTo(px + 3.4, py); c.lineTo(px, py + 3.8); c.lineTo(px - 3.4, py); c.closePath(); }, g.tc, g.td, lt(g.tc, 0.5), 0.8, 0.4);
      gemAt(c, px, py, 2, m.gem, Q, t, g.rar >= 2 ? 0.5 : 0);
    } else if (set === 'kor') {
      fl(c, function (c) { c.moveTo(px - 3.4, py - 3); c.lineTo(px - 1.5, py + 3.6); c.lineTo(px, py + 1.5); c.lineTo(px + 1.5, py + 3.6); c.lineTo(px + 3.4, py - 3); c.closePath(); }, '#2A2224');
      fl(c, function (c) { Ci(c, px, py - 0.3, 2.2); }, m.a);
      if (Q.fx) { addOn(c); glow(c, px, py, 7, 7, m.a, 0.7 + 0.2 * sin(t * 5)); addOff(c); }
      edge(c, function (c) { c.arc(px, py - 0.3, 3, 0, TAU); }, g.tc, 0.9);
    } else if (set === 'ejder') {
      cel(c, function (c) { Ci(c, px, py, 3.6); }, m.a, m.aS, lt(m.a, 0.5), 0.9, 0.5);
      fl(c, function (c) { E(c, px, py, 2.4, 2.6); }, m.gem, true);
      fl(c, function (c) { E(c, px, py, 0.6, 2.1); }, '#1A0A10', true);
      edge(c, function (c) { c.arc(px, py, 3.6, 0, TAU); }, g.tc, 0.8);
      if (g.rar >= 3 && Q.fx) { addOn(c); glow(c, px, py, 7, 7, m.gem, 0.6); addOff(c); }
    } else {
      fl(c, function (c) { c.moveTo(px, py - 5); c.lineTo(px + 3.6, py - 1); c.lineTo(px + 2, py + 4.5); c.lineTo(px, py + 2.6); c.lineTo(px - 2, py + 4.5); c.lineTo(px - 3.6, py - 1); c.closePath(); }, '#2A2040');
      gemAt(c, px, py - 0.4, 2.2, m.a, Q, t, 0.8);
      edge(c, function (c) { c.moveTo(px - 3.6, py - 1); c.lineTo(px, py - 5); c.lineTo(px + 3.6, py - 1); }, g.tc, 0.9);
    }
    twinkle(c, g, px + 2, py - 2, Q, t, 2.4);
  }

  // ------------------------------------------------------------------------------------------ shoulder pads (shoulder-local, +x outward)
  function padPath(c) {
    c.moveTo(-6.5, 3); c.quadraticCurveTo(-6.5, -8.5, 3, -9); c.quadraticCurveTo(11.5, -8.5, 13, 2);
    c.quadraticCurveTo(13.4, 6.2, 10.2, 7.8); c.quadraticCurveTo(3, 5, -6.5, 3); c.closePath();
  }
  function pieceShoulder(c, g, Q, t, front) {
    var m = g.m, set = g.set, sk = g.skin;
    var b = front ? m.b : dk(m.b, 0.12);
    halo(c, g, 4, -1, 16, 14, Q, t);
    if (sk === 'sk_omuz_kafatasi') {
      c.save(); c.translate(1, 1); c.scale(0.84, 0.84);
      cel(c, function (c) { c.moveTo(-6, 4); c.quadraticCurveTo(-7, -10, 4, -10.5); c.quadraticCurveTo(14, -10, 13.5, 1); c.quadraticCurveTo(13, 5, 10, 5.5); c.lineTo(10, 8.5); c.lineTo(0, 8.5); c.lineTo(0, 5.5); c.closePath(); }, '#EFE6D2', '#A8977A', '#FFFFFF', 2, 0.8);
      fl(c, function (c) { E(c, 2.5, -1.5, 2.6, 3); E(c, 9, -1.8, 2.4, 2.8); c.moveTo(5.8, 2); c.lineTo(7, 4.5); c.lineTo(4.6, 4.5); c.closePath(); }, '#1A1018', true);
      if (Q.lod > 0) { line(c, 2, 6, 2, 8.4, '#A8977A', 0.8); line(c, 5, 6, 5, 8.4, '#A8977A', 0.8); line(c, 8, 6, 8, 8.4, '#A8977A', 0.8); }
      fl(c, function (c) { Ci(c, 2.8, -1.2, 0.9); Ci(c, 9.2, -1.5, 0.9); }, '#FF3D4F', true);
      if (Q.fx) { addOn(c); glow(c, 2.8, -1.2, 4, 4, '#FF3D4F', 0.8); glow(c, 9.2, -1.5, 4, 4, '#FF3D4F', 0.8); addOff(c); }
      edge(c, function (c) { c.moveTo(-6.2, 5.5); c.lineTo(12.5, 9.4); }, g.tc, 1.6);
      twinkle(c, g, 0, -7, Q, t, 2.6);
      c.restore();
      return;
    }
    if (set === 'kurt') {
      cel(c, padPath, b, m.s, m.l, 2, 0.8);
      if (Q.lod > 0) { c.save(); c.setLineDash([1.4, 1.4]); edge(c, function (c) { c.moveTo(-4, 1.5); c.quadraticCurveTo(3, -5.5, 10.5, 2.5); }, m.l, 0.8); c.restore(); }
      furRow(c, -5.5, -5.5, 11, -4, 4, 2.7, m.a, m.aS, Q, 3.2);
      fl(c, function (c) { RR(c, -1, 3.4, 12, 2.4, 1); }, m.s);
      fl(c, function (c) { RR(c, 3.6, 2.8, 3.2, 3.4, 0.8); }, g.tc);
    } else if (set === 'gece') {
      for (var i = 2; i >= 0; i--) {
        c.save(); c.translate(i * 1.1, i * 3.4); c.scale(1 - i * 0.12, 1 - i * 0.18);
        cel(c, padPath, i ? dk(b, 0.08 * i) : b, m.s, m.l, 1.8, 0.8);
        if (i === 2) edge(c, function (c) { c.moveTo(-6, 4); c.quadraticCurveTo(3, 6, 10.4, 8.2); }, g.tc, 2);
        c.restore();
      }
      rivets(c, [0, -4, 7, -5, 11, 0], 0.9, m.m, Q);
    } else if (set === 'kor') {
      cel(c, function (c) { c.moveTo(1, -7.5); c.lineTo(5, -19); c.lineTo(8.5, -7); c.closePath(); }, m.b, m.s, m.l, 1.2, 0.6);
      cel(c, padPath, b, m.s, m.l, 2, 0.8);
      crack(c, [-1.5, -5, 0.5, -3, -0.4, -0.6, 2.4, 1.4], Q, t); crack(c, [9.2, -5.6, 10.2, -3, 9.4, -0.4], Q, t);
      edge(c, function (c) { c.moveTo(-6.3, 3); c.quadraticCurveTo(3, 5, 10, 7.6); }, g.tc, 1.6);
    } else if (set === 'ejder') {
      cel(c, function (c) { c.moveTo(4, -8); c.quadraticCurveTo(10, -14, 9, -21); c.quadraticCurveTo(13, -14, 10, -6); c.closePath(); }, m.horn, m.hornS, null, 1, 0);
      cel(c, padPath, b, m.s, m.l, 2, 0.8);
      if (Q.lod > 0) { c.save(); c.beginPath(); padPath(c); c.clip(); scaleRows(c, -6, -8, 13, 7, 2.4, rgba(m.s, 0.95)); c.restore(); }
      cel(c, function (c) { c.moveTo(-6.5, 3); c.quadraticCurveTo(3, 5, 10.2, 7.8); c.lineTo(10.6, 5); c.quadraticCurveTo(3, 2.4, -6.6, 0.6); c.closePath(); }, m.a, m.aS, null, 0.8, 0);
      edge(c, function (c) { c.moveTo(-6.4, 1.8); c.quadraticCurveTo(3, 3.8, 10.4, 6.4); }, g.tc, 0.9);
    } else {
      cel(c, function (c) { c.moveTo(-1, -8); c.lineTo(-2, -18); c.lineTo(4, -9); c.closePath(); c.moveTo(6, -8.5); c.lineTo(11, -17); c.lineTo(11, -6); c.closePath(); }, m.b, m.s, m.l, 1.2, 0.5);
      cel(c, function (c) { c.moveTo(-6.5, 3); c.lineTo(-5, -8); c.lineTo(4, -9.5); c.lineTo(12.5, -4); c.lineTo(13.5, 3); c.lineTo(10.2, 8); c.closePath(); }, b, m.s, m.l, 2, 0.8);
      runeGlow(c, 4, -2, 2.4, m.a, Q, t, 2);
      edge(c, function (c) { c.moveTo(-6.3, 3); c.lineTo(10.2, 7.8); c.lineTo(13.3, 3); }, g.tc, 1.5);
    }
    twinkle(c, g, 3, -6, Q, t, 2.6);
  }

  // ------------------------------------------------------------------------------------------ chest (body coords)
  function chestPath(c) {
    c.moveTo(-12, -52.6); c.lineTo(-5.5, -53.6);
    c.quadraticCurveTo(1.5, -46.6, 9, -53.6); c.lineTo(12.6, -52.6);
    c.quadraticCurveTo(15.6, -45, 14, -37); c.quadraticCurveTo(13, -31, 12.6, -26.2);
    c.quadraticCurveTo(0, -23.4, -12.6, -26.2);
    c.quadraticCurveTo(-13, -31, -14, -37); c.quadraticCurveTo(-15.6, -45, -12, -52.6); c.closePath();
  }
  function hemPath(c) { c.moveTo(-12.6, -26.2); c.quadraticCurveTo(0, -23.4, 12.6, -26.2); }
  function neckPath(c) { c.moveTo(-5.5, -53.6); c.quadraticCurveTo(1.5, -46.6, 9, -53.6); }
  function pieceChest(c, g, Q, t, R) {
    var m = g.m, set = g.set, sk = g.skin;
    halo(c, g, 0, -40, 24, 22, Q, t);
    if (sk === 'sk_gogus_kanat') {
      cel(c, chestPath, '#E8EDF6', '#9AA6BE', '#FFFFFF', 3, 1.2);
      c.save(); c.beginPath(); chestPath(c); c.clip();
      fl(c, function (c) { c.moveTo(-14, -36); c.quadraticCurveTo(0, -33, 14, -36); c.lineTo(14, -33); c.quadraticCurveTo(0, -30, -14, -33); c.closePath(); }, '#C8D0E0', true);
      c.restore();
      for (var w = -1; w <= 1; w += 2) fl(c, function (c) { c.moveTo(1.5, -41); c.quadraticCurveTo(1.5 + w * 6, -47, 1.5 + w * 10, -45); c.quadraticCurveTo(1.5 + w * 7, -42, 1.5 + w * 8, -39); c.quadraticCurveTo(1.5 + w * 4, -39, 1.5, -38); c.closePath(); }, '#FFCB57');
      gemAt(c, 1.5, -40.5, 2.2, g.tc, Q, t, 0.6);
      edge(c, hemPath, g.tc, 1.8); edge(c, neckPath, g.tc, 1.4);
      twinkle(c, g, -6, -46, Q, t);
      return;
    }
    if (set === 'kurt') {
      cel(c, chestPath, m.b, m.s, m.l, 3, 1.2);
      c.save(); c.beginPath(); chestPath(c); c.clip();
      if (Q.lod > 0) {
        c.save(); c.setLineDash([1.5, 1.5]);
        edge(c, function (c) { c.moveTo(-10, -48); c.quadraticCurveTo(-12, -36, -10, -28); c.moveTo(12, -48); c.quadraticCurveTo(13, -36, 11, -28); }, m.l, 0.8);
        c.restore();
      }
      for (var i = 0; i < 4; i++) { var y = -44 + i * 4.2; line(c, -0.6, y, 3.6, y + 2.6, '#E7D3AC', 1); line(c, 3.6, y, -0.6, y + 2.6, '#E7D3AC', 1); }
      c.restore();
      furRow(c, -12.5, -52.4, 13, -52.4, 7, 3, m.a, m.aS, Q, -2);
      edge(c, hemPath, g.tc, 2);
    } else if (set === 'gece') {
      cel(c, chestPath, m.b, m.s, m.l, 3, 1.2);
      c.save(); c.beginPath(); chestPath(c); c.clip();
      fl(c, function (c) { c.moveTo(-3.4, -49); c.lineTo(6.4, -49); c.lineTo(6.4, -22); c.lineTo(1.5, -19.5); c.lineTo(-3.4, -22); c.closePath(); }, m.a);
      line(c, -3.4, -49, -3.4, -22, m.aS, 1); line(c, 6.4, -49, 6.4, -22, m.aS, 1);
      edge(c, function (c) { c.moveTo(-15, -37); c.quadraticCurveTo(1.5, -34, 16, -37); }, m.s, 1.4);
      edge(c, function (c) { c.moveTo(-15, -36); c.quadraticCurveTo(1.5, -33, 16, -36); }, m.l, 0.7);
      c.restore();
      fl(c, function (c) { c.moveTo(-3.4, -26.5); c.lineTo(6.4, -26.5); c.lineTo(6.4, -22); c.lineTo(1.5, -19); c.lineTo(-3.4, -22); c.closePath(); }, m.a);
      edge(c, function (c) { c.moveTo(-3.4, -22); c.lineTo(1.5, -19); c.lineTo(6.4, -22); }, g.tc, 1.2);
      if (Q.lod > 0) fl(c, function (c) { c.moveTo(1.5, -46); c.lineTo(3.3, -43); c.lineTo(1.5, -40); c.lineTo(-0.3, -43); c.closePath(); }, '#DCE4EF', true);
      rivets(c, [-11, -49, -12.6, -42, -12, -31, 13.4, -49, 14.4, -42, 13, -31], 0.9, m.m, Q);
      edge(c, hemPath, g.tc, 1.8); edge(c, neckPath, g.tc, 1.5);
    } else if (set === 'kor') {
      cel(c, chestPath, m.b, m.s, m.l, 3, 1.2);
      cel(c, function (c) { c.moveTo(-11.5, -49); c.quadraticCurveTo(-5, -50, 0.6, -46); c.quadraticCurveTo(1, -38, -3, -36); c.quadraticCurveTo(-10, -36, -12.6, -40); c.closePath(); }, m.b, m.s, m.l, 1.6, 0.8);
      cel(c, function (c) { c.moveTo(14, -49); c.quadraticCurveTo(8, -50, 2.4, -46); c.quadraticCurveTo(2, -38, 6, -36); c.quadraticCurveTo(13, -36, 14.6, -40); c.closePath(); }, m.b, m.s, m.l, 1.6, 0.8);
      crack(c, [-10, -33.5, -8, -31.8, -8.6, -29.6, -6.4, -28], Q, t); crack(c, [8.5, -33, 10.4, -31, 9.6, -28.4], Q, t);
      crack(c, [-8.5, -47, -6.8, -45, -7.4, -42.6, -5.6, -41], Q, t);
      fl(c, function (c) { Ci(c, 1.5, -31, 2.8); }, '#2A2224');
      fl(c, function (c) { Ci(c, 1.5, -31, 1.8); }, m.a, true);
      if (Q.fx) { addOn(c); glow(c, 1.5, -31, 9, 9, m.a, 0.75 + 0.25 * sin(t * 5)); addOff(c); }
      edge(c, hemPath, g.tc, 1.8); edge(c, neckPath, g.tc, 1.4);
    } else if (set === 'ejder') {
      cel(c, chestPath, m.b, m.s, m.l, 3, 1.2);
      if (Q.lod > 0) { c.save(); c.beginPath(); chestPath(c); c.clip(); scaleRows(c, -15, -50, 16, -25, 2.7, rgba(m.s, 0.95)); c.restore(); }
      cel(c, function (c) { c.moveTo(-6, -53.8); c.quadraticCurveTo(1.5, -46.6, 9.5, -53.8); c.lineTo(10.5, -50.5); c.quadraticCurveTo(1.5, -42.5, -7, -50.5); c.closePath(); }, m.a, m.aS, lt(m.a, 0.5), 1, 0.5);
      cel(c, function (c) { c.moveTo(1.5, -44); c.lineTo(6.5, -38); c.lineTo(1.5, -31); c.lineTo(-3.5, -38); c.closePath(); }, m.a, m.aS, lt(m.a, 0.5), 1.2, 0.6);
      gemAt(c, 1.5, -37.8, 2.6, m.gem, Q, t, g.rar >= 3 ? 0.7 : 0.2);
      edge(c, hemPath, m.a, 2.4); edge(c, hemPath, g.tc, 1);
    } else {
      cel(c, chestPath, m.b, m.s, m.l, 3, 1.2);
      c.save(); c.beginPath(); chestPath(c); c.clip();
      fl(c, function (c) { c.moveTo(1.5, -49); c.lineTo(9, -40); c.lineTo(1.5, -26); c.lineTo(-6, -40); c.closePath(); }, m.s, true);
      c.restore();
      if (Q.fx) { addOn(c); glow(c, 1.5, -39, 12, 12, m.a, 0.55 + 0.15 * sin(t * 2.5)); addOff(c); }
      c.beginPath(); c.arc(1.5, -39, 5.4, 0, TAU); strokeW(c, rgba(lt(m.a, 0.3), 0.9), 1);
      for (var r = 0; r < 4; r++) { var an = t * 0.8 + r * HP; rune(c, 1.5 + cos(an) * 5.4, -39 + sin(an) * 5.4, 1.3, lt(m.a, 0.5), r); }
      gemAt(c, 1.5, -39, 2.2, m.r2, Q, t, 0.6);
      edge(c, hemPath, g.tc, 1.8); edge(c, neckPath, g.tc, 1.4);
    }
    twinkle(c, g, -7, -46, Q, t);
  }

  // ------------------------------------------------------------------------------------------ belt (body coords)
  function pieceBelt(c, g, Q, t) {
    var m = g.m, set = g.set;
    halo(c, g, 1.5, -28, 16, 8, Q, t);
    var band = set === 'gece' ? m.b : set === 'ejder' ? m.b : m.b;
    if (set === 'kurt') cel(c, function (c) { RR(c, -12, -27, 6, 7, 2); }, m.b, m.s, m.l, 1.2, 0.5);
    cel(c, beltPath, band, m.s, m.l, 1.4, 0.7);
    edge(c, function (c) { c.moveTo(-12, -30); c.quadraticCurveTo(0, -28.1, 12, -30); }, g.tc, 0.9);
    edge(c, function (c) { c.moveTo(-12.2, -26.2); c.quadraticCurveTo(0, -24.3, 12.2, -26.2); }, g.tc, 0.9);
    if (set === 'kurt') {
      cel(c, function (c) { Ci(c, 3.2, -28, 3.6); }, m.m, m.mS, lt(m.m, 0.5), 1, 0.5);
      fl(c, function (c) { Ci(c, 3.2, -28, 1.6); }, m.s, true);
    } else if (set === 'gece') {
      if (Q.lod > 0) for (var i = -2; i <= 2; i++) if (i) line(c, 3 + i * 4.5, -30, 3 + i * 4.5, -25.6, m.s, 0.9);
      cel(c, function (c) { RR(c, -0.4, -31.4, 7.2, 7, 1.4); }, m.m, m.mS, '#FFFFFF', 1, 0.5);
      gemAt(c, 3.2, -27.9, 1.8, m.gem, Q, t, g.rar >= 2 ? 0.4 : 0);
    } else if (set === 'kor') {
      cel(c, function (c) { c.moveTo(-1, -32); c.lineTo(7.4, -32); c.lineTo(6.4, -24.5); c.lineTo(3.2, -23); c.lineTo(0, -24.5); c.closePath(); }, '#2A2224', '#120C10', '#4A3E42', 1, 0.5);
      fl(c, function (c) { RR(c, 0.8, -29.4, 4.8, 1.6, 0.6); }, m.a, true);
      if (Q.fx) { addOn(c); glow(c, 3.2, -28.6, 7, 4, m.a, 0.8); addOff(c); }
    } else if (set === 'ejder') {
      cel(c, function (c) { c.moveTo(3.2, -33); c.lineTo(8.4, -28); c.lineTo(3.2, -23); c.lineTo(-2, -28); c.closePath(); }, m.a, m.aS, lt(m.a, 0.5), 1, 0.5);
      gemAt(c, 3.2, -28, 2, m.gem, Q, t, g.rar >= 3 ? 0.6 : 0.2);
    } else {
      c.beginPath(); c.moveTo(-6, -26); c.quadraticCurveTo(-2, -20, 3, -24.5); strokeW(c, OUT, 2); strokeW(c, '#6B5A8E', 1);
      fl(c, function (c) { Ci(c, 3.2, -28, 3.6); }, '#2A2040');
      gemAt(c, 3.2, -28, 2.2, m.a, Q, t, 0.7);
    }
    twinkle(c, g, 5, -29.5, Q, t, 2.4);
  }

  // ------------------------------------------------------------------------------------------ pants (body coords top + leg-local deco)
  function piecePantsTop(c, g, Q, t) {
    var m = g.m, set = g.set;
    halo(c, g, 0, -20, 18, 12, Q, t);
    var flap = function (x0, x1, y1) { return function (c) { c.moveTo(x0, -27.5); c.lineTo(x1, -27.5); c.lineTo(x1 + 0.6, y1 - 1.5); c.quadraticCurveTo((x0 + x1) / 2, y1 + 1.5, x0 - 0.6, y1 - 1.5); c.closePath(); }; };
    if (set === 'kurt') {
      cel(c, flap(-10.5, -1.5, -16), m.b, m.s, m.l, 1.4, 0.6); cel(c, flap(2.5, 11.5, -16.5), m.b, m.s, m.l, 1.4, 0.6);
      if (Q.lod > 0) { c.save(); c.setLineDash([1.3, 1.3]); edge(c, function (c) { c.moveTo(-9.5, -18.6); c.lineTo(-2.5, -18.6); c.moveTo(3.5, -19); c.lineTo(10.5, -19); }, m.l, 0.7); c.restore(); }
      rivets(c, [-6, -25, 7, -25], 1, m.m, Q);
      edge(c, function (c) { c.moveTo(-10.6, -16.8); c.quadraticCurveTo(-6, -15, -1.4, -16.8); c.moveTo(2.4, -17.3); c.quadraticCurveTo(7, -15.5, 11.6, -17.3); }, g.tc, 1.1);
    } else if (set === 'gece') {
      cel(c, flap(-12, -2.2, -17), m.b, m.s, m.l, 1.4, 0.6); cel(c, flap(4.8, 12.8, -17.5), m.b, m.s, m.l, 1.4, 0.6);
      rivets(c, [-7, -24.5, 8.8, -24.5], 0.9, m.m, Q);
      edge(c, function (c) { c.moveTo(-12.5, -18.6); c.quadraticCurveTo(-7, -16.6, -1.7, -18.6); c.moveTo(4.3, -19); c.quadraticCurveTo(8.8, -17, 13.4, -19); }, g.tc, 1.4);
    } else if (set === 'kor') {
      cel(c, flap(-12, 13, -18), m.b, m.s, m.l, 1.6, 0.7);
      cel(c, flap(-11, 12, -21.5), dk(m.b, 0.1), m.s, m.l, 1.2, 0.6);
      crack(c, [-6, -26.5, -4.6, -24.6, -5.4, -22.4, -4, -20.6], Q, t); crack(c, [8, -26, 7, -24, 7.6, -22], Q, t);
      edge(c, function (c) { c.moveTo(-12.4, -19.4); c.quadraticCurveTo(0.5, -15.6, 13.4, -19.4); }, g.tc, 1.4);
    } else if (set === 'ejder') {
      var sc = function (c) { for (var i = 0; i < 6; i++) { var x = -10.5 + i * 4.4; c.moveTo(x - 2.6, -24); c.lineTo(x + 2.6, -24); c.lineTo(x + 2.4, -19); c.quadraticCurveTo(x, -15.6, x - 2.4, -19); c.closePath(); } };
      cel(c, sc, m.b, m.s, m.l, 1.2, 0.6);
      cel(c, function (c) { c.moveTo(-12, -27.6); c.lineTo(13, -27.6); c.lineTo(13, -24); c.lineTo(-12, -24); c.closePath(); }, m.a, m.aS, lt(m.a, 0.5), 0.8, 0.4);
      edge(c, function (c) { c.moveTo(-12, -24.2); c.lineTo(13, -24.2); }, g.tc, 0.9);
    } else {
      var tat = function (c) { c.moveTo(-12, -27.5); c.lineTo(13, -27.5); c.lineTo(13.5, -19); c.lineTo(10, -14); c.lineTo(8, -18); c.lineTo(5, -13); c.lineTo(3, -17.5); c.lineTo(-2, -17.5); c.lineTo(-4, -13); c.lineTo(-6.5, -18); c.lineTo(-9.5, -13.5); c.lineTo(-12.5, -19); c.closePath(); };
      cel(c, tat, m.b, m.s, m.l, 1.5, 0.6);
      runeGlow(c, -6.5, -22.5, 1.9, m.a, Q, t, 1); runeGlow(c, 8.5, -22.5, 1.9, m.a, Q, t, 2);
      edge(c, function (c) { c.moveTo(-12, -27); c.lineTo(13, -27); }, g.tc, 1.3);
    }
    twinkle(c, g, -6, -24, Q, t, 2.4);
  }
  function pantsLegDeco(c, g, L, Q, t, front) {
    var m = g.m, set = g.set;
    if (set === 'kurt') { c.save(); c.setLineDash([1.3, 1.3]); line(c, 2.6, 1, 2.6, L - 1, m.l, 0.8); c.restore(); }
    else if (set === 'kor') crack(c, [1.6, 1.5, 0.4, 3.6, 1.4, 5.6, 0.2, 7.6], Q, t);
    else if (set === 'ejder') { c.save(); c.beginPath(); CAP(c, 0, 0, 0, L, 4.6, 4.2); c.clip(); scaleRows(c, -5, 1, 5, L, 2.2, rgba(m.s, 0.95)); c.restore(); }
    else if (set === 'golge') { line(c, 2.4, 0, 2.4, L, rgba(m.a, 0.85), 1); if (Q.fx) { addOn(c); line(c, 2.4, 0, 2.4, L, rgba(m.a, 0.3), 2.8); addOff(c); } }
    else if (set === 'gece') line(c, 3, 0, 3, L - 1, m.aS, 1.2);
  }

  // ------------------------------------------------------------------------------------------ knee pads (knee-local, +y along leg, +x forward)
  function kneePath(c) { c.moveTo(-5.2, -3.8); c.quadraticCurveTo(0, -6.8, 5.8, -3.8); c.quadraticCurveTo(6.8, 2, 0.4, 6); c.quadraticCurveTo(-6.2, 2, -5.2, -3.8); c.closePath(); }
  function pieceKnee(c, g, Q, t, front) {
    var m = g.m, set = g.set, b = front ? m.b : dk(m.b, 0.15);
    halo(c, g, 0, 0, 9, 9, Q, t);
    if (set === 'kor' || set === 'golge') cel(c, function (c) { c.moveTo(4, -3); c.lineTo(11, -1); c.lineTo(4.5, 2.5); c.closePath(); }, m.b, m.s, m.l, 0.8, 0.4);
    if (set === 'ejder') cel(c, function (c) { c.moveTo(3.5, -4); c.quadraticCurveTo(8, -7, 10, -11); c.quadraticCurveTo(9, -4, 5, -0.5); c.closePath(); }, m.horn, m.hornS, null, 0.8, 0);
    cel(c, kneePath, b, m.s, m.l, 1.4, 0.7);
    if (set === 'kurt') { if (Q.lod > 0) { line(c, -2.4, -2, 2.6, 2.6, m.l, 0.8); line(c, 2.6, -2, -2.4, 2.6, m.l, 0.8); } }
    else if (set === 'gece') { line(c, 0.3, -5.5, 0.3, 5, m.l, 1); rivets(c, [-2.6, -1.5, 3, -1.5], 0.7, m.m, Q); }
    else if (set === 'kor') { crack(c, [-1.6, -3.2, -0.4, -1, -1.2, 1.2, 0.2, 3], Q, t); }
    else if (set === 'ejder') { if (Q.lod > 0) { c.save(); c.beginPath(); kneePath(c); c.clip(); scaleRows(c, -6, -5, 6, 6, 1.8, rgba(m.s, 0.95)); c.restore(); } }
    else { gemAt(c, 0.3, -0.5, 1.6, m.a, Q, t, 0.6); }
    edge(c, function (c) { c.moveTo(-5.2, -3.8); c.quadraticCurveTo(0, -6.8, 5.8, -3.8); }, g.tc, 1.3);
    twinkle(c, g, 1, -2, Q, t, 2);
  }

  // ------------------------------------------------------------------------------------------ boots (ankle-local, toe +x)
  function pieceBoot(c, g, Q, t, front, P) {
    var m = g.m, set = g.set, sk = g.skin, b = front ? m.b : dk(m.b, 0.15);
    halo(c, g, 3, 2, 12, 10, Q, t);
    if (sk === 'sk_ayak_alev') {
      var fl1 = function (c) {
        for (var i = 0; i < 4; i++) {
          var x = -4 + i * 3, h = 6 + 3 * noise1(t * 7 + i * 1.9 + (front ? 0 : 3));
          c.moveTo(x - 2, -2.5); c.quadraticCurveTo(x - 1.5, -2.5 - h * 0.6, x + 0.3, -2.5 - h); c.quadraticCurveTo(x + 1.2, -2.5 - h * 0.4, x + 2, -2.5);
        }
      };
      if (Q.fx) { addOn(c); glow(c, 1, -6, 12, 10, '#FF7A2F', 0.6); addOff(c); }
      c.beginPath(); fl1(c); c.fillStyle = '#FF7A2F'; c.fill();
      c.save(); c.translate(0.3, 1.5); c.scale(0.7, 0.7); c.beginPath(); fl1(c); c.fillStyle = '#FFE08A'; c.fill(); c.restore();
      cel(c, bootPath, front ? '#2A1A1E' : '#1E1216', '#120A0E', '#4A2A30', 2, 1);
      line(c, -4.6, 6.4, 10.4, 6.4, '#FF7A2F', 1.6);
      crack(c, [6, 2, 8, 4, 10.4, 3.6], Q, t);
      cel(c, function (c) { RR(c, -5.4, -4.6, 10.6, 3.6, 1.4); }, g.tc, g.td, lt(g.tc, 0.4), 0.8, 0.4);
      return;
    }
    var path = bootPath;
    if (set === 'kor' || set === 'golge') path = function (c) {
      c.moveTo(-4.7, -3.6); c.lineTo(4.5, -3.6); c.lineTo(4.9, 1.1);
      c.quadraticCurveTo(10, 1, 13.5, set === 'golge' ? 1.5 : 4.5);
      if (set === 'golge') c.quadraticCurveTo(12.5, 4.5, 10.8, 5.6);
      c.lineTo(10.8, 7.6); c.lineTo(-5.1, 7.6); c.quadraticCurveTo(-5.9, 2.5, -4.7, -3.6); c.closePath();
    };
    if (set === 'ejder') cel(c, function (c) { c.moveTo(-4.5, -1); c.quadraticCurveTo(-9, -3, -11, -8); c.quadraticCurveTo(-7, -5, -4, -4); c.closePath(); }, m.horn, m.hornS, null, 0.8, 0);
    cel(c, path, b, m.s, m.l, 2, 1);
    line(c, -4.6, 6.4, 10.4, 6.4, dk(m.b, 0.6), 1.4);
    if (set === 'kurt') {
      if (Q.lod > 0) { line(c, 0, -1, 3.5, 1.5, m.a, 0.8); line(c, 3.5, -1, 0, 1.5, m.a, 0.8); }
      furRow(c, -5.4, -3.8, 5.2, -3.8, 3, 2.4, m.a, m.aS, Q, 0);
      edge(c, function (c) { c.moveTo(-4.4, 5); c.lineTo(10.6, 5); }, g.tc, 1.1);
    } else if (set === 'gece') {
      edge(c, function (c) { c.moveTo(5, 1.4); c.quadraticCurveTo(7.5, 3, 7.5, 6); c.moveTo(7.8, 1.6); c.quadraticCurveTo(10, 3, 10.2, 6); }, m.s, 1);
      cel(c, function (c) { RR(c, -5.3, -4.6, 10.4, 3.6, 1.2); }, m.a, m.aS, lt(m.a, 0.3), 0.8, 0.4);
      rivets(c, [-2.5, 1.5, 2, 2], 0.8, m.m, Q);
      edge(c, function (c) { c.moveTo(-5, -1); c.lineTo(5, -1); }, g.tc, 1.2);
    } else if (set === 'kor') {
      crack(c, [-1.6, -2, -0.4, 0, -1.2, 2.2, 0, 4.2], Q, t); crack(c, [7, 2.8, 8.6, 3.6, 10.4, 3.4], Q, t);
      cel(c, function (c) { c.moveTo(-5.4, -3.6); c.lineTo(-8.5, -7); c.lineTo(-3.5, -4.2); c.closePath(); }, m.b, m.s, null, 0.6, 0);
      edge(c, function (c) { c.moveTo(-4.8, -2.6); c.lineTo(4.6, -2.6); }, g.tc, 1.4);
    } else if (set === 'ejder') {
      if (Q.lod > 0) { c.save(); c.beginPath(); bootPath(c); c.clip(); scaleRows(c, -5, -3, 6, 5, 2, rgba(m.s, 0.95)); c.restore(); }
      cel(c, function (c) { c.moveTo(6.5, 1.2); c.quadraticCurveTo(11, 1.4, 11, 5.4); c.lineTo(10.8, 7.6); c.lineTo(6.5, 7.6); c.closePath(); }, m.a, m.aS, lt(m.a, 0.5), 0.8, 0.4);
      cel(c, function (c) { RR(c, -5.3, -4.6, 10.4, 3.2, 1.2); }, m.a, m.aS, lt(m.a, 0.5), 0.8, 0.4);
      edge(c, function (c) { c.moveTo(-5, -1.6); c.lineTo(5, -1.6); }, g.tc, 1);
    } else {
      runeGlow(c, 0, 1.8, 1.8, m.a, Q, t, 0);
      cel(c, function (c) { c.moveTo(-5.4, -3.6); c.lineTo(-4, -8); c.lineTo(-1.5, -3.6); c.moveTo(1.5, -3.6); c.lineTo(3.5, -7.5); c.lineTo(5, -3.6); }, m.b, m.s, null, 0.6, 0);
      edge(c, function (c) { c.moveTo(-4.8, -2.6); c.lineTo(4.6, -2.6); }, g.tc, 1.4);
    }
    twinkle(c, g, 7, 2.5, Q, t, 2.2);
  }

  // ------------------------------------------------------------------------------------------ bracers (forearm-local, +y toward hand)
  function pieceBracer(c, g, Q, t, len, front) {
    var m = g.m, set = g.set, b = front ? m.b : dk(m.b, 0.15);
    len = clamp(len, 5, 13);
    halo(c, g, 0, len / 2, 9, 9, Q, t);
    var f = function (c) { c.moveTo(-4.7, -0.6); c.lineTo(4.7, -0.6); c.lineTo(5.4, len + 0.6); c.lineTo(-5.4, len + 0.6); c.closePath(); };
    if (set === 'kor' || set === 'golge') cel(c, function (c) { c.moveTo(4.5, 1); c.lineTo(9.5, 2.6); c.lineTo(5, 4.6); c.closePath(); c.moveTo(4.8, len * 0.55); c.lineTo(9, len * 0.7); c.lineTo(5.2, len * 0.85); c.closePath(); }, m.b, m.s, m.l, 0.6, 0.3);
    cel(c, f, b, m.s, m.l, 1.4, 0.7);
    if (set === 'kurt') {
      line(c, -5, len * 0.35, 5.2, len * 0.35, m.s, 1.4); line(c, -5.2, len * 0.75, 5.3, len * 0.75, m.s, 1.4);
      rivets(c, [0, len * 0.35, 0, len * 0.75], 0.9, m.m, Q);
    } else if (set === 'gece') {
      line(c, 0, 0.5, 0, len, m.l, 1.1); rivets(c, [-2.8, len * 0.5, 2.8, len * 0.5], 0.7, m.m, Q);
      fl(c, function (c) { RR(c, -5.2, len - 1.4, 10.6, 2.2, 0.8); }, m.a);
    } else if (set === 'kor') {
      crack(c, [-1.2, 1, 0.2, len * 0.3, -0.6, len * 0.55, 0.6, len - 0.8], Q, t);
    } else if (set === 'ejder') {
      if (Q.lod > 0) { c.save(); c.beginPath(); f(c); c.clip(); scaleRows(c, -6, 0, 6, len, 1.8, rgba(m.s, 0.95)); c.restore(); }
      fl(c, function (c) { RR(c, -5.2, len * 0.45, 10.6, 1.8, 0.6); }, m.a);
    } else {
      runeGlow(c, 0, len * 0.5, 1.8, m.a, Q, t, 1);
    }
    edge(c, function (c) { c.moveTo(-4.8, 0.2); c.lineTo(4.8, 0.2); c.moveTo(-5.3, len); c.lineTo(5.3, len); }, g.tc, 1.2);
    if (Q.icon) { fl(c, function (c) { E(c, 0, -0.6, 4.7, 1.7); }, dk(m.s, 0.5)); c.beginPath(); c.ellipse(0, len + 0.6, 5.4, 1.8, 0, 0, PI); c.stroke(); }
    twinkle(c, g, 1, len * 0.3, Q, t, 2);
  }

  // ------------------------------------------------------------------------------------------ gloves (hand-local, +y = fingers)
  function pieceGlove(c, g, Q, t, front) {
    var m = g.m, set = g.set, b = front ? m.b : dk(m.b, 0.15);
    halo(c, g, 0, 0, 9, 9, Q, t);
    cel(c, function (c) { c.moveTo(-4.6, -6.5); c.lineTo(4.6, -6.5); c.lineTo(5.8, -2.4); c.lineTo(-5.8, -2.4); c.closePath(); }, b, m.s, m.l, 1, 0.5);
    if (set === 'golge') fl(c, function (c) { for (var i = 0; i < 3; i++) { var x = -3 + i * 3; c.moveTo(x - 1.2, 4); c.lineTo(x, 8.2); c.lineTo(x + 1.2, 4); c.closePath(); } }, '#B9A8D9');
    cel(c, function (c) { RR(c, -5, -3.2, 10, 8.6, 3.6); E(c, 4.4, -0.8, 2.2, 2.8, 0.3); }, b, m.s, m.l, 1.4, 0.7);
    if (set === 'kurt') { if (Q.lod > 0) { c.save(); c.setLineDash([1.2, 1.2]); line(c, -4.5, -4.5, 4.5, -4.5, m.l, 0.7); c.restore(); } fl(c, function (c) { Ci(c, 0, 1.6, 1.3); }, m.m, true); }
    else if (set === 'gece') { line(c, -3.8, 1.4, 3.8, 1.4, m.l, 1); line(c, -3.8, 3.2, 3.8, 3.2, m.s, 0.8); rivets(c, [0, -4.5], 0.8, m.m, Q); }
    else if (set === 'kor') { cel(c, function (c) { for (var i = 0; i < 3; i++) { var x = -3 + i * 3; c.moveTo(x - 1.1, 4.6); c.lineTo(x, 7.6); c.lineTo(x + 1.1, 4.6); c.closePath(); } }, m.m, m.mS, null, 0.5, 0); crack(c, [-2.4, -1.2, -0.8, 0.4, 0.6, -0.6, 2.2, 0.6], Q, t); }
    else if (set === 'ejder') { fl(c, function (c) { RR(c, -4.4, 2, 8.8, 2.4, 1); }, m.a); }
    else { runeGlow(c, 0, 0.5, 1.6, m.a, Q, t, 2); }
    if (Q.lod > 0 && set !== 'golge') { var fc2 = dk(m.s, 0.3); line(c, -1.7, 2.6, -1.7, 5.2, fc2, 0.7); line(c, 1.1, 2.6, 1.1, 5.2, fc2, 0.7); if (Q.icon) line(c, -4.2, 2.6, -4.2, 4.8, fc2, 0.7); }
    edge(c, function (c) { c.moveTo(-5.6, -2.8); c.lineTo(5.6, -2.8); }, g.tc, 1.2);
    twinkle(c, g, -1, 0, Q, t, 1.8);
  }
  // ------------------------------------------------------------------------------------------ weapons
  // blade palettes by rarity: base, shade, light, edge
  var BLADE = [
    ['#9C7E6A', '#6A4A3A', '#C9AC96', '#B8A698'],
    ['#B9C2CF', '#7D8797', '#EEF3FA', '#FFFFFF'],
    ['#93B8E6', '#4F6FA0', '#D8EAFF', '#E8F4FF'],
    ['#3D3236', '#1E181B', '#6E5E64', '#FF7A2F'],
    ['#F4E6C6', '#C2A57A', '#FFFFFF', '#FFE6A0'],
    ['#45111B', '#1C0509', '#86222F', '#FF3D4F']];
  var GRIP = ['#6A4630', '#5A3A26', '#2B3354', '#2A1F22', '#7A1E2A', '#1A0A10'];
  var FITTING = [['#7A6A5E', '#4E4038'], ['#9AA3B0', '#5E6672'], ['#D8E2F0', '#8792A3'], ['#5A4C50', '#2A2224'], ['#FFCB57', '#B07A22'], ['#3A2A30', '#16090D']];
  function weapon(c, R, P, Q) {
    var w = R.w; if (!w) return;
    c.save();
    c.translate(P.hFx, P.hFy);
    if (w.wt === 'yay') { c.rotate(P.bowR); c.scale(BOWS, BOWS); c.lineWidth /= BOWS; pieceBow(c, w, Q, P.t, P.pull, P.arrow); }
    else {
      if (P.spin) {
        var phi = P.spin.phi, dx = cos(phi), dy = -0.32 + sin(phi) * 0.22;
        c.rotate(atan2(dx, -dy)); c.scale(1, P.spin.f);
      } else c.rotate(PI - P.wA);
      c.scale(WSC, WSC); c.lineWidth /= WSC;
      if (w.wt === 'kilic') pieceSword(c, w, Q, P.t);
      else if (w.wt === 'orak') pieceScythe(c, w, Q, P.t);
      else pieceStaff(c, w, Q, P.t, P.orb, P.burst);
    }
    c.restore();
  }
  function weaponHalo(c, w, x, y, rx, ry, Q, t, col) {
    if (!Q.fx) return;
    var r = w.rar, a = w.skin ? 0.5 : r >= 5 ? 0.6 : r >= 4 ? 0.5 : r >= 3 ? 0.42 : r >= 2 ? 0.16 : 0;
    if (a <= 0) return;
    addOn(c); glow(c, x, y, rx, ry, col || w.tc, a * (0.8 + 0.2 * sin(t * 3.3))); addOff(c);
  }
  function pieceSword(c, w, Q, t) {
    var r = w.rar, sk = w.skin;
    var L = [30, 32, 34, 36, 38, 41][r], W = [3.1, 3.2, 3.4, 3.6, 3.8, 4.5][r], b0 = -5.4;
    var bc = BLADE[r];
    if (sk === 'sk_kilic_ejder') { L = 41; W = 4.3; bc = ['#C8232F', '#7A0E1A', '#FF7070', '#FFCB57']; }
    if (sk === 'sk_kilic_buz') { L = 40; W = 4.1; bc = ['#A6ECFF', '#4FB0DA', '#FFFFFF', '#FFFFFF']; }
    var tip = b0 - L;
    weaponHalo(c, w, 0, b0 - L * 0.55, W * 4, L * 0.75, Q, t, sk === 'sk_kilic_buz' ? '#8AF6FF' : sk === 'sk_kilic_ejder' ? '#FF7A2F' : null);
    // grip + pommel
    cel(c, function (c) { CAP(c, 0, 6.5, 0, -3, 1.9); }, GRIP[r], dk(GRIP[r], 0.4), lt(GRIP[r], 0.25), 0.9, 0.5);
    if (Q.lod > 0) { line(c, -1.8, 3.6, 1.8, 2.4, dk(GRIP[r], 0.5), 0.8); line(c, -1.8, 0.8, 1.8, -0.4, dk(GRIP[r], 0.5), 0.8); }
    var fc = sk === 'sk_kilic_ejder' ? ['#FFCB57', '#B07A22'] : sk === 'sk_kilic_buz' ? ['#DFF8FF', '#7FC8E8'] : FITTING[r];
    cel(c, function (c) { Ci(c, 0, 8, r >= 4 || sk ? 2.8 : 2.3); }, fc[0], fc[1], lt(fc[0], 0.5), 0.9, 0.5);
    if (r >= 2 || sk) fl(c, function (c) { Ci(c, 0, 8, 1.2); }, sk === 'sk_kilic_buz' ? '#FFFFFF' : r === 2 ? '#5FB3FF' : r === 3 ? '#FF7A2F' : '#FF3D4F', true);
    // blade
    var blade;
    if (sk === 'sk_kilic_ejder') blade = function (c) {
      c.moveTo(-W, b0);
      for (var i = 1; i <= 4; i++) { var y = b0 - L * i / 4.6; c.quadraticCurveTo(-W - 2.2, y + L / 9.2, -W * (1 - i * 0.12), y); }
      c.lineTo(0.5, tip - 3); c.lineTo(W * 0.5, b0 - L * 0.88);
      for (var j = 4; j >= 1; j--) { var y2 = b0 - L * j / 4.6; c.quadraticCurveTo(W + 2.2, y2 + L / 9.2, W * (1 - (j - 1) * 0.1), y2 + L / 4.6); }
      c.lineTo(W, b0); c.closePath();
    };
    else if (sk === 'sk_kilic_buz') blade = function (c) {
      c.moveTo(-W, b0); c.lineTo(-W - 1.2, b0 - L * 0.35); c.lineTo(-W + 0.4, b0 - L * 0.45); c.lineTo(-W - 0.8, b0 - L * 0.75);
      c.lineTo(0, tip - 4); c.lineTo(W + 0.8, b0 - L * 0.7); c.lineTo(W - 0.4, b0 - L * 0.55); c.lineTo(W + 1.2, b0 - L * 0.3); c.lineTo(W, b0); c.closePath();
    };
    else if (r === 4) blade = function (c) { c.moveTo(-W, b0); c.quadraticCurveTo(-W - 4, b0 - L * 0.55, 3, tip - 3); c.quadraticCurveTo(W + 0.5, b0 - L * 0.5, W, b0); c.closePath(); };
    else if (r === 5) blade = function (c) {
      c.moveTo(-W, b0);
      for (var i = 1; i <= 5; i++) { var y = b0 - (L - 6) * i / 5; c.lineTo(-W - (i % 2 ? 1.8 : 0), y + 2); c.lineTo(-W + 0.4, y); }
      c.lineTo(0, tip - 4);
      for (var j = 5; j >= 1; j--) { var y2 = b0 - (L - 6) * j / 5; c.lineTo(W - 0.4, y2); c.lineTo(W + (j % 2 ? 1.8 : 0), y2 + 2); }
      c.lineTo(W, b0); c.closePath();
    };
    else blade = function (c) { c.moveTo(-W, b0); c.lineTo(-W * 0.92, tip + W * 1.3); c.lineTo(0, tip - W * 0.6); c.lineTo(W * 0.92, tip + W * 1.3); c.lineTo(W, b0); c.closePath(); };
    var ga = c.globalAlpha;
    if (sk === 'sk_kilic_buz') c.globalAlpha = ga * 0.92;
    c.beginPath(); blade(c); c.fillStyle = bc[0]; c.fill();
    c.save(); c.clip();
    fl(c, function (c) { c.rect(0.3, tip - 6, W + 4, L + 8); }, bc[1], true);
    fl(c, function (c) { c.rect(-W - 4, tip - 6, W + 3.2, L + 8); }, rgba(bc[2], 0.55), true);
    if (r === 0 && !sk) { c.fillStyle = '#7A4A2E'; c.beginPath(); Ci(c, -1.5, b0 - 8, 1.3); Ci(c, 1.6, b0 - 17, 1.6); Ci(c, -0.8, b0 - 24, 1); c.fill(); }
    if (r === 2 && !sk) line(c, 0, b0 - 1, 0, tip + 7, '#3A5580', 1.6);
    if (r >= 3 && !sk) {
      var rc = r === 3 ? '#FF7A2F' : r === 4 ? '#FFB020' : '#FF3D4F';
      if (r !== 4) { for (var k = 0; k < 4; k++) runeGlow(c, 0, b0 - 5 - k * (L - 10) / 4, 1.5, rc, Q, t, k); }
      else { line(c, -0.5, b0 - 2, 1, tip + 4, '#C2A57A', 1); }
    }
    if (sk === 'sk_kilic_buz') { line(c, -W * 0.4, b0 - 3, 1, tip, '#FFFFFF', 0.9); line(c, W * 0.5, b0 - 6, W * 0.2, b0 - L * 0.6, '#FFFFFF', 0.7); }
    if (sk === 'sk_kilic_ejder') { line(c, 0, b0 - 2, 0.5, tip + 4, '#FFCB57', 1.2); }
    c.restore();
    c.beginPath(); blade(c); c.stroke();
    c.globalAlpha = ga;
    if ((r === 3 || r === 5) && !sk) { // glowing edge
      var ec = bc[3];
      c.save(); if (Q.fx) addOn(c);
      c.beginPath(); c.moveTo(-W + 0.8, b0 - 1); c.lineTo(-W * 0.85, tip + W * 1.4); c.lineTo(0, tip - W * 0.3);
      strokeW(c, rgba(ec, 0.85), 1.2);
      c.restore();
    }
    if (sk === 'sk_kilic_ejder' && Q.fx) { c.save(); addOn(c); c.beginPath(); blade(c); strokeW(c, rgba('#FFB020', 0.6), 1.2); c.restore(); }
    // guard
    var gc = fc;
    if (sk === 'sk_kilic_ejder') {
      cel(c, function (c) { c.moveTo(-8, -3); c.quadraticCurveTo(-10, -9, -6, -11); c.quadraticCurveTo(-6, -7, -3, -6); c.lineTo(3, -6); c.quadraticCurveTo(6, -7, 6, -11); c.quadraticCurveTo(10, -9, 8, -3); c.quadraticCurveTo(0, 0, -8, -3); c.closePath(); }, gc[0], gc[1], '#FFF3C4', 1.2, 0.6);
      gemAt(c, 0, -4.2, 2, '#FF3D4F', Q, t, 0.6);
    } else if (sk === 'sk_kilic_buz') {
      cel(c, function (c) { c.moveTo(-9, -6); c.lineTo(-4, -3); c.lineTo(0, -6.5); c.lineTo(4, -3); c.lineTo(9, -6); c.lineTo(5, -1); c.lineTo(-5, -1); c.closePath(); }, '#DFF8FF', '#7FC8E8', '#FFFFFF', 1, 0.5);
    } else if (r <= 1) {
      cel(c, function (c) { RR(c, -6.5, -5.6, 13, 3.4, 1.4); }, gc[0], gc[1], lt(gc[0], 0.4), 0.9, 0.5);
    } else if (r === 2) {
      cel(c, function (c) { c.moveTo(-8, -7.5); c.quadraticCurveTo(-4, -3.5, 0, -4.5); c.quadraticCurveTo(4, -3.5, 8, -7.5); c.lineTo(8.5, -5); c.quadraticCurveTo(4, -1, 0, -1.8); c.quadraticCurveTo(-4, -1, -8.5, -5); c.closePath(); }, gc[0], gc[1], '#FFFFFF', 1, 0.5);
      gemAt(c, 0, -3.4, 1.6, '#5FB3FF', Q, t, 0.3);
    } else if (r === 3) {
      cel(c, function (c) { c.moveTo(-9, -8); c.lineTo(-4, -4.8); c.lineTo(4, -4.8); c.lineTo(9, -8); c.lineTo(6, -1.5); c.lineTo(-6, -1.5); c.closePath(); }, gc[0], gc[1], lt(gc[0], 0.3), 1, 0.5);
      gemAt(c, 0, -3.3, 1.7, '#FF7A2F', Q, t, 0.6);
    } else if (r === 4) {
      cel(c, function (c) { c.moveTo(-10, -9); c.quadraticCurveTo(-6, -4, -2.5, -5); c.lineTo(2.5, -5); c.quadraticCurveTo(6, -4, 10, -9); c.quadraticCurveTo(9, -2, 4, -1.4); c.lineTo(-4, -1.4); c.quadraticCurveTo(-9, -2, -10, -9); c.closePath(); }, gc[0], gc[1], '#FFF3C4', 1.1, 0.6);
      gemAt(c, 0, -3.3, 2, '#FF3D4F', Q, t, 0.5);
    } else {
      cel(c, function (c) { c.moveTo(-11, -11); c.quadraticCurveTo(-7, -4, -3, -5.5); c.lineTo(3, -5.5); c.quadraticCurveTo(7, -4, 11, -11); c.quadraticCurveTo(10, -2, 4, -0.8); c.lineTo(-4, -0.8); c.quadraticCurveTo(-10, -2, -11, -11); c.closePath(); }, gc[0], gc[1], '#6A4A50', 1.1, 0.6);
      fl(c, function (c) { E(c, 0, -3.2, 2.6, 2.2); }, '#E8DCC8');
      fl(c, function (c) { Ci(c, -0.9, -3.4, 0.7); Ci(c, 0.9, -3.4, 0.7); }, '#FF3D4F', true);
      if (Q.fx) { addOn(c); glow(c, 0, -3.3, 6, 6, '#FF3D4F', 0.6); addOff(c); }
    }
    if (r >= 2 || sk) { var k2 = pow(mx(0, sin(t * 1.6 + 1)), 14); if (k2 > 0.04 && Q.lod > 0) { addOn(c); spark(c, -W * 0.5, tip + 6, 4 * k2 + 1, '#FFFFFF', k2); addOff(c); } }
  }
  function pieceBow(c, w, Q, t, pull, arrow) {
    var r = w.rar, sk = w.skin, H = [22, 23, 24, 25, 26, 27][r];
    var cols = ['#A0703F', '#8A5A32', '#4E3426', '#2E2629', '#FFCB57', '#4A121C'];
    var col = cols[r], colS = dk(col, 0.4), str = r === 3 ? '#FF9A4A' : r === 5 ? '#FF4A5E' : r === 4 ? '#FFF1C4' : '#E8E0D0';
    if (sk === 'sk_yay_kemik') { col = '#EFE6D2'; colS = '#A8977A'; str = '#D8D0C0'; H = 26; }
    if (sk === 'sk_yay_ay') { col = '#E6EEFF'; colS = '#8EA2D8'; str = '#9BEFFF'; H = 27; }
    var nx = -5.5 - pull * 13;
    weaponHalo(c, w, 0, 0, 16, H * 1.3, Q, t, sk === 'sk_yay_ay' ? '#9BEFFF' : null);
    // string
    c.beginPath(); c.moveTo(-5.5, -H); c.lineTo(nx, 0); c.lineTo(-5.5, H);
    if (r >= 3 || sk === 'sk_yay_ay') { if (Q.fx) { c.save(); addOn(c); strokeW(c, rgba(str, 0.45), 2.6); c.restore(); } }
    strokeW(c, str, 0.9);
    var limb = function (c) { c.moveTo(-5.5, -H); c.bezierCurveTo(3.5, -H * 0.78, 4.8, -H * 0.3, 0.6, 0); c.bezierCurveTo(4.8, H * 0.3, 3.5, H * 0.78, -5.5, H); };
    if (sk === 'sk_yay_ay') {
      cel(c, function (c) { c.moveTo(-5.5, -H); c.bezierCurveTo(9, -H * 0.8, 10, H * 0.8, -5.5, H); c.bezierCurveTo(4, H * 0.6, 4, -H * 0.6, -5.5, -H); c.closePath(); }, col, colS, '#FFFFFF', 1.4, 0.8);
      if (Q.fx) { addOn(c); glow(c, 4, 0, 10, H, '#9BEFFF', 0.35 + 0.1 * sin(t * 3)); addOff(c); }
      for (var s = 0; s < 3; s++) spark(c, 6 - s * 1.5, -H * 0.5 + s * H * 0.5, 1.6, '#FFFFFF', 0.5 + 0.5 * sin(t * 3 + s * 2));
    } else if (sk === 'sk_yay_kemik') {
      rope(c, limb, col, 3.2, c.lineWidth);
      var segs = 9;
      for (var i = 0; i <= segs; i++) {
        var k = i / segs, yy = lerp(-H, H, k), xx = -5.5 + sin(k * PI) * 7.2;
        fl(c, function (c) { E(c, xx, yy, 2.2, 1.3); }, col);
      }
      fl(c, function (c) { E(c, 1.6, 0, 3.6, 4); }, col);
      fl(c, function (c) { Ci(c, 2.6, -1, 1); Ci(c, 2.6, 1.4, 1); }, '#1A1018', true);
    } else {
      rope(c, limb, col, r >= 4 ? 4 : 3.4, c.lineWidth);
      c.save(); c.translate(-0.7, -0.5); c.beginPath(); limb(c); strokeW(c, rgba(lt(col, 0.5), 0.8), 1); c.restore();
      if (r >= 2) { // recurve tips
        for (var e = -1; e <= 1; e += 2) fl(c, function (c) { c.moveTo(-5.5, e * H); c.quadraticCurveTo(-3, e * (H + 4), 1, e * (H + 3)); c.quadraticCurveTo(-2.5, e * (H + 1.5), -4, e * (H - 1.5)); c.closePath(); }, r === 4 ? '#FFF3C4' : r === 2 ? '#D8E2F0' : r === 3 ? '#FF7A2F' : '#FF3D4F');
      }
      if (r === 4) { // gold wings near the grip
        for (var e2 = -1; e2 <= 1; e2 += 2) cel(c, function (c) { c.moveTo(2.5, e2 * 5); c.quadraticCurveTo(10, e2 * 8, 11, e2 * 15); c.quadraticCurveTo(7, e2 * 12, 3, e2 * 10); c.closePath(); }, '#FFE6A0', '#B07A22', '#FFFFFF', 0.8, 0.4);
      }
      if (r === 3 || r === 5) { var rc = r === 3 ? '#FF7A2F' : '#FF3D4F'; runeGlow(c, 3.4, -H * 0.42, 1.4, rc, Q, t, 0); runeGlow(c, 3.4, H * 0.42, 1.4, rc, Q, t, 1); }
      if (r === 0 && Q.lod > 0) { line(c, 2.5, -9, 3.5, -12, dk(col, 0.4), 0.7); }
    }
    // grip
    cel(c, function (c) { RR(c, -1.6, -4.2, 4.6, 8.4, 1.5); }, GRIP[r], dk(GRIP[r], 0.4), lt(GRIP[r], 0.3), 0.8, 0.4);
    if (arrow) {
      var ax = nx, tipC = r >= 3 ? (r === 3 ? '#FF7A2F' : r === 4 ? '#FFB020' : '#FF3D4F') : '#C9CED8';
      if (sk === 'sk_yay_ay') tipC = '#9BEFFF';
      line(c, ax, 0, 18, 0, OUT, 2.6); line(c, ax, 0, 18, 0, '#D8C8A8', 1.2);
      fl(c, function (c) { c.moveTo(17, -2.6); c.lineTo(23, 0); c.lineTo(17, 2.6); c.closePath(); }, tipC);
      fl(c, function (c) { c.moveTo(ax + 1, 0); c.lineTo(ax - 2.5, -2.8); c.lineTo(ax + 4, 0); c.lineTo(ax - 2.5, 2.8); c.closePath(); }, r >= 2 ? w.tc : '#F4F1EA');
      if ((r >= 3 || sk) && Q.fx) { addOn(c); glow(c, 20, 0, 6, 5, tipC, 0.7); addOff(c); }
    }
  }
  function pieceScythe(c, w, Q, t) {
    var r = w.rar, sk = w.skin, bl = [23, 24, 26, 28, 30, 33][r], bc = BLADE[r];
    if (sk === 'sk_orak_ruh') { bl = 32; bc = ['#7FF3E0', '#2FA898', '#E6FFFA', '#BFFFF4']; }
    var shaftC = r >= 3 ? '#2A2028' : r === 2 ? '#3A3446' : '#7A5434';
    if (sk === 'sk_orak_ruh') shaftC = '#1E2A33';
    weaponHalo(c, w, bl * 0.45, -40, bl * 0.9, 18, Q, t, sk === 'sk_orak_ruh' ? '#7FF3E0' : null);
    cel(c, function (c) { CAP(c, 0, 17, 0, -41, 2.3); }, shaftC, dk(shaftC, 0.45), lt(shaftC, 0.3), 1, 0.5);
    var fc = FITTING[r];
    for (var i = 0; i < 2; i++) fl(c, function (c) { RR(c, -2.6, (i ? -8 : 12) - 1.4, 5.2, 2.8, 1); }, fc[0]);
    if (r >= 3 || sk) cel(c, function (c) { c.moveTo(-2, 16); c.lineTo(0, 23); c.lineTo(2, 16); c.closePath(); }, fc[0], fc[1], null, 0.6, 0);
    var blade = function (c) { c.moveTo(-2.5, -43.5); c.quadraticCurveTo(bl * 0.55, -54, bl, -35); c.quadraticCurveTo(bl * 0.42, -43, 1, -36.5); c.closePath(); };
    if (r === 4 && !sk) cel(c, function (c) { c.moveTo(-1, -40); c.quadraticCurveTo(-9, -47, -14, -38); c.quadraticCurveTo(-8, -41, -1, -37); c.closePath(); }, bc[0], bc[1], bc[2], 0.8, 0.4);
    var ga = c.globalAlpha; if (sk === 'sk_orak_ruh') c.globalAlpha = ga * 0.9;
    cel(c, blade, bc[0], bc[1], bc[2], 1.8, 0.9);
    c.save(); c.beginPath(); blade(c); c.clip();
    if (r === 0 && !sk) { c.fillStyle = '#7A4A2E'; c.beginPath(); Ci(c, bl * 0.4, -44, 1.5); Ci(c, bl * 0.7, -41, 1.2); c.fill(); }
    if (r >= 3 && !sk) { var rc = r === 3 ? '#B57BFF' : r === 4 ? '#FFB020' : '#FF3D4F'; for (var k = 0; k < 3; k++) runeGlow(c, bl * (0.25 + k * 0.22), -44 + k * 2.2, 1.3, rc, Q, t, k); }
    c.restore();
    c.globalAlpha = ga;
    // inner edge highlight
    c.beginPath(); c.moveTo(1.5, -37); c.quadraticCurveTo(bl * 0.42, -43, bl - 1, -35.6); strokeW(c, rgba(bc[3], 0.9), 1);
    if ((r === 3 || r === 5 || sk) && Q.fx) { c.save(); addOn(c); c.beginPath(); c.moveTo(1.5, -37); c.quadraticCurveTo(bl * 0.42, -43, bl - 1, -35.6); strokeW(c, rgba(sk ? '#7FF3E0' : r === 3 ? '#B57BFF' : '#FF3D4F', 0.5), 2.6); c.restore(); }
    // collar
    cel(c, function (c) { RR(c, -3.4, -45, 6.8, 6, 1.6); }, fc[0], fc[1], lt(fc[0], 0.4), 0.8, 0.4);
    if (r === 5 && !sk) { fl(c, function (c) { E(c, 0, -42, 2.6, 2.4); }, '#E8DCC8'); fl(c, function (c) { Ci(c, -0.9, -42.3, 0.6); Ci(c, 0.9, -42.3, 0.6); }, '#FF3D4F', true); }
    else if (r >= 2 || sk) gemAt(c, 0, -42, 1.6, sk ? '#7FF3E0' : r === 2 ? '#5FB3FF' : r === 3 ? '#B57BFF' : '#FF3D4F', Q, t, r >= 3 ? 0.6 : 0.2);
    if (sk === 'sk_orak_ruh' && Q.lod > 0) {
      for (var s = 0; s < 3; s++) { var kk = fract(t * 0.7 + s / 3); var x = bl * (0.3 + s * 0.25), y = -42 - kk * 12; c.save(); if (Q.fx) addOn(c); glow(c, x, y, 3.5, 3.5, '#7FF3E0', sin(kk * PI) * 0.9); c.restore(); }
    }
  }
  function pieceStaff(c, w, Q, t, orb, burst) {
    var r = w.rar, sk = w.skin, top = -37, hy = -43, bot = Q.icon ? 6 : 20;
    orb = orb || 0;
    var shaftC = r === 0 ? '#7A5434' : r === 1 ? '#6A4630' : r === 2 ? '#4A3A30' : r === 3 ? '#2E2238' : r === 4 ? '#FFCB57' : '#1E1418';
    if (sk === 'sk_asa_kristal') shaftC = '#3A3F66';
    var oc = sk === 'sk_asa_kristal' ? '#8AF6FF' : ['#B9C0CC', '#5BD16E', '#5FB3FF', '#B57BFF', '#FFE6A0', '#FF3D4F'][r];
    var orbR = sk ? 5.6 : [4.4, 4.6, 5, 5.6, 5.8, 6.2][r];
    if (Q.fx && (r >= 1 || sk)) { addOn(c); glow(c, 0, hy, orbR * (3 + orb * 2), orbR * (3 + orb * 2), oc, (r >= 3 || sk ? 0.55 : 0.28) * (0.8 + 0.2 * sin(t * 4)) + orb * 0.3); addOff(c); }
    if (r === 0 && !sk) {
      var wob = function (c) { c.moveTo(0, bot); c.quadraticCurveTo(-2.4, 8, 0.6, -4); c.quadraticCurveTo(2.6, -18, -0.6, -28); c.quadraticCurveTo(-1.6, -33, 0, top); };
      rope(c, wob, shaftC, 4.2, c.lineWidth);
      line(c, -0.6, 6, 0.4, -6, lt(shaftC, 0.3), 0.8);
    } else {
      cel(c, function (c) { CAP(c, 0, bot, 0, top, 2.5); }, shaftC, dk(shaftC, 0.45), lt(shaftC, 0.35), 0.9, 0.5);
      var fc = FITTING[r];
      fl(c, function (c) { RR(c, -2.4, 3, 4.8, 3, 1); }, sk ? '#BFF6FF' : fc[0]);
      if (r >= 2 || sk) fl(c, function (c) { c.moveTo(-2, bot - 1); c.lineTo(0, bot + 4); c.lineTo(2, bot - 1); c.closePath(); }, sk ? '#BFF6FF' : fc[0]);
    }
    if (sk === 'sk_asa_kristal') {
      cel(c, function (c) { c.moveTo(0, hy - 10); c.lineTo(3.6, hy - 3); c.lineTo(3, hy + 5); c.lineTo(0, hy + 8); c.lineTo(-3, hy + 5); c.lineTo(-3.6, hy - 3); c.closePath(); }, '#9BEFFF', '#3FA8D0', '#FFFFFF', 1.2, 0.6);
      line(c, 0, hy - 9, 0, hy + 7, rgba('#FFFFFF', 0.8), 0.7);
      for (var i = 0; i < 3; i++) {
        var an = t * 1.6 + i * TAU / 3, cx = cos(an) * 9, cy = hy + sin(an) * 3.2, s = 0.85 + 0.25 * sin(an);
        if (sin(an) < 0 || true) cel(c, function (c) { c.moveTo(cx, cy - 4 * s); c.lineTo(cx + 2 * s, cy); c.lineTo(cx, cy + 4 * s); c.lineTo(cx - 2 * s, cy); c.closePath(); }, i === 1 ? '#FF9AD5' : '#BFF6FF', '#5FA8D0', '#FFFFFF', 0.6, 0.3);
      }
    } else if (r <= 1) {
      cel(c, function (c) { c.moveTo(0, top + 1); c.quadraticCurveTo(-6, top - 2, -5, hy - 4); c.quadraticCurveTo(-3, hy, 0, top - 1); c.quadraticCurveTo(3, hy, 5, hy - 4); c.quadraticCurveTo(6, top - 2, 0, top + 1); c.closePath(); }, shaftC, dk(shaftC, 0.4), lt(shaftC, 0.3), 0.8, 0.4);
      cel(c, function (c) { Ci(c, 0, hy, orbR); }, r ? oc : '#9AA0AA', dk(r ? oc : '#9AA0AA', 0.4), '#FFFFFF', 1.4, 0.7);
    } else if (r === 2) {
      cel(c, function (c) { RR(c, -3.6, top - 3, 7.2, 4, 1.2); }, '#D8E2F0', '#8792A3', '#FFFFFF', 0.8, 0.4);
      cel(c, function (c) { c.moveTo(0, hy - 8); c.lineTo(3.6, hy); c.lineTo(0, hy + 5); c.lineTo(-3.6, hy); c.closePath(); }, oc, dk(oc, 0.4), '#FFFFFF', 1.2, 0.6);
    } else if (r === 3) {
      cel(c, function (c) { Ci(c, 0, hy, orbR); }, oc, dk(oc, 0.45), '#FFFFFF', 1.6, 0.8);
      for (var ri = 0; ri < 2; ri++) { c.beginPath(); c.ellipse(0, hy, 8.5, 2.6, t * 1.2 + ri * HP, 0, TAU); strokeW(c, OUT, 2.2); strokeW(c, '#D9B8FF', 1); }
      cel(c, function (c) { c.moveTo(-4, top + 1); c.lineTo(-6.5, hy + 2); c.lineTo(-2, top - 2); c.closePath(); c.moveTo(4, top + 1); c.lineTo(6.5, hy + 2); c.lineTo(2, top - 2); c.closePath(); }, '#2E2238', '#120C18', null, 0.5, 0);
    } else if (r === 4) {
      for (var e = -1; e <= 1; e += 2) cel(c, function (c) { c.moveTo(e * 3, top); c.quadraticCurveTo(e * 11, top - 4, e * 13, hy - 6); c.quadraticCurveTo(e * 8, hy - 1, e * 3.6, top - 3); c.closePath(); }, '#FFE6A0', '#B07A22', '#FFFFFF', 0.8, 0.4);
      if (Q.lod > 0) for (var ray = 0; ray < 8; ray++) { var ra = ray * TAU / 8 + t * 0.5; line(c, cos(ra) * (orbR + 1), hy + sin(ra) * (orbR + 1), cos(ra) * (orbR + 3.6), hy + sin(ra) * (orbR + 3.6), '#FFF1C4', 1); }
      cel(c, function (c) { Ci(c, 0, hy, orbR); }, '#FFF1C4', '#FFB020', '#FFFFFF', 1.6, 0.8);
    } else {
      cel(c, function (c) { c.moveTo(-1.5, top); c.quadraticCurveTo(-8, hy + 2, -6, hy - 7); c.lineTo(-4, hy - 2); c.quadraticCurveTo(-3, top - 2, 0, top - 2); c.quadraticCurveTo(3, top - 2, 4, hy - 2); c.lineTo(6, hy - 7); c.quadraticCurveTo(8, hy + 2, 1.5, top); c.closePath(); }, '#2A1A22', '#0E080B', '#4A3038', 0.8, 0.4);
      var fy = hy + sin(t * 2.4) * 1.2;
      cel(c, function (c) { Ci(c, 0, fy, orbR); }, oc, '#8E1324', '#FFB0B8', 1.8, 0.8);
      if (Q.lod > 0) { c.save(); c.globalAlpha *= 0.85; for (var k = 0; k < 6; k++) { var an2 = -t * 1.4 + k * TAU / 6; rune(c, cos(an2) * 10, fy + sin(an2) * 10, 1.3, '#FF8A95', k); } c.restore(); }
    }
    if (burst > 0 && Q.fx) {
      var bp = burst > 1 ? burst - 1 : 0, br = 6 + bp * 22, ba = burst > 1 ? 1 - bp : burst;
      addOn(c); c.beginPath(); c.arc(0, hy, br, 0, TAU); strokeW(c, rgba(oc, 0.8 * ba), 2.4); glow(c, 0, hy, br * 1.4, br * 1.4, oc, 0.5 * ba); addOff(c);
    }
    if (Q.lod > 0 && (r >= 2 || sk)) { var k3 = pow(mx(0, sin(t * 1.7 + 2)), 12); if (k3 > 0.05) { addOn(c); spark(c, -orbR * 0.4, hy - orbR * 0.4, 3.4 * k3 + 1, '#FFFFFF', k3); addOff(c); } }
  }
  // ------------------------------------------------------------------------------------------ aura + particles (per call, never cached)
  // particle anchors on the silhouette edge (never over the face)
  var ANCH = { kafa: [-12, -101], yuz: [-24, -66], boyun: [-12, -50], omuz: [19, -53], gogus: [-15, -40], kol: [19, -37], eldiven: [-16, -31], kemer: [13, -27], pantolon: [-12, -19], dizlik: [10, -12], ayak: [-7, -3] };
  function flameShape(c, x, y, w, h, lean) {
    c.moveTo(x - w, y);
    c.quadraticCurveTo(x - w * 1.15, y - h * 0.55, x + lean, y - h);
    c.quadraticCurveTo(x + w * 1.15, y - h * 0.5, x + w, y);
    c.quadraticCurveTo(x, y + w * 0.9, x - w, y);
    c.closePath();
  }
  function auraBack(c, R, t, lite, lift) {
    var hs = R.hs, col = R.aura, r = R.maxRar;
    if (hs && hs.aura) { addOn(c); glow(c, 0, -50 - lift, 42, 58, hs.aura, 0.15 + 0.05 * sin(t * TAU / 2.4)); addOff(c); }
    if (!col) return;
    var a = r >= 5 ? 0.5 : r >= 4 ? 0.36 : 0.15, pulse = 0.82 + 0.18 * sin(t * TAU / 1.2);
    addOn(c);
    glow(c, 0, -48 - lift, 44, 60, col, a * pulse);
    glow(c, 0, 0.5, 36, 10, col, a * 1.3 * pulse);
    addOff(c);
    if (r >= 4 && !lite) {
      c.beginPath(); c.ellipse(0, 0.5, 30 + 2 * sin(t * TAU / 1.2), 8, 0, 0, TAU);
      addOn(c); strokeW(c, rgba(col, 0.35 * pulse), 1.4); addOff(c);
    }
    if (r >= 5) mythicFlames(c, t, lite, lift);
  }
  function mythicFlames(c, t, lite, lift) {
    var n = lite ? 5 : 9, i, k, a, x, y, h, lean, al;
    for (i = 0; i < n; i++) {
      k = fract(t / 1.2 + i * 0.381); a = PI * (0.92 + 1.16 * i / (n - 1));
      x = cos(a) * 28; y = -50 - lift + sin(a) * 48 + 8;
      h = (14 + 14 * sin(k * PI)) * (lite ? 0.9 : 1); lean = sin(t * TAU / 0.8 + i * 2) * 3.5; al = sin(k * PI);
      c.beginPath(); flameShape(c, x, y - k * 7, 5.4, h, lean); c.fillStyle = rgba('#2A0510', 0.78 * al); c.fill();
      addOn(c); c.beginPath(); flameShape(c, x, y - k * 7 + 1, 3.2, h * 0.75, lean * 0.8); c.fillStyle = rgba('#FF3D4F', 0.7 * al); c.fill();
      c.beginPath(); flameShape(c, x, y - k * 7 + 1.5, 1.5, h * 0.42, lean * 0.6); c.fillStyle = rgba('#FFB0A0', 0.6 * al); c.fill(); addOff(c);
    }
  }
  function auraFront(c, R, t, lite, lift) {
    var r = R.maxRar, cnt = 0, max = lite ? 4 : 10, i, s, g, A, k, x, y, ph;
    if (r >= 4) {
      addOn(c);
      var nm = lite ? 3 : 6, col = r >= 5 ? '#FF6A78' : '#FFE08A';
      for (i = 0; i < nm; i++) {
        k = fract(t / 2.4 + i / nm); x = sin(i * 2.3 + t * TAU / 2.4) * 24; y = -8 - k * 92 - lift;
        spark(c, x, y, 2.2 + (i % 2), col, sin(k * PI) * 0.9);
      }
      addOff(c);
    }
    for (i = 0; i < ARMOR.length && cnt < max; i++) {
      s = ARMOR[i]; g = R.g[s]; if (!g) continue;
      var smoke = g.set === 'golge' && !g.skin;
      if (g.rar < 5 && !smoke) continue;
      A = ANCH[s]; ph = i * 1.37; k = fract(t / 1.2 + ph);
      x = A[0] + sin(ph * 3 + t * TAU / 2.4) * 4; y = A[1] - lift - k * 16;
      if (g.rar >= 5) {
        var fh = 11 * sin(k * PI) + 3, fl2 = sin(t * TAU / 0.6 + i * 2) * 2.2, fa = sin(k * PI);
        c.beginPath(); flameShape(c, x, y, 2.6, fh, fl2); c.fillStyle = rgba('#1A0408', 0.72 * fa); c.fill();
        addOn(c); c.beginPath(); flameShape(c, x, y + 0.8, 1.5, fh * 0.72, fl2 * 0.8); c.fillStyle = rgba('#FF3D4F', 0.85 * fa); c.fill();
        if (!lite) spark(c, x + fl2, y - fh - 2 - k * 4, 1.3, '#FF9A8A', fa * 0.8); addOff(c);
        cnt++;
      }
      if (smoke && cnt < max) { var k2 = fract(t / 2.4 + ph * 0.5); glow(c, x - 2, A[1] - lift - k2 * 20, 5 + k2 * 6, 4 + k2 * 5, '#6B5A8E', 0.4 * sin(k2 * PI)); cnt++; }
    }
    if (R.hs && R.hs.frost) {
      for (i = 0; i < 5; i++) { k = fract(t / 2.4 + i / 5); spark(c, sin(i * 3.1 + t * TAU / 2.4) * 30, -100 + k * 96 - lift, 1.8, '#E6FBFF', sin(k * PI) * 0.8); }
    }
    if (R.hs && R.hs.hairTip) {
      addOn(c);
      for (i = 0; i < 4; i++) { k = fract(t / 1.2 + i / 4); glow(c, sin(i * 2.7) * 18, -60 - k * 50 - lift, 2.5, 2.5, '#FF3D4F', sin(k * PI)); }
      addOff(c);
    }
  }
  function shadowAt(c, lift) { var s = 1 - mn(lift, 14) / 28; glow(c, 0, 0.5, 25 * s, 7.5 * s, '#05030A', 0.62 * s); }
  function lwFor(scale) { return clamp(2 * pow(scale, 0.6), 1.15, 4.6) / scale; }

  // ------------------------------------------------------------------------------------------ frame rendering + cache
  // Every hero is rendered into a cached frame canvas (look + anim frame bucket + device scale) and blitted.
  // lite = coarse buckets (battle), full = fine buckets (lobby, paper-doll). Aura/particles are drawn live per call.
  var FCACHE = new Map(), FPX = 0, FMAX = 6e6, FLASHBUF = null;   // ~24 MB of frames max (LRU)
  var QL = { idle: [6, 2.6], walk: [8, 0.56], victory: [10, 1.15], cast: [8, 1.0], hurt: [6, 0.45], attack: [12, 0], legs: 4 };
  var QF = { idle: [12, 2.6], walk: [12, 0.56], victory: [14, 1.15], cast: [12, 1.0], hurt: [8, 0.45], attack: [18, 0], legs: 6 };
  var BOXES = Object.create(null);
  function boxFor(anim, wt) {
    var key = anim + (wt || '-'), b = BOXES[key];
    if (b) return b;
    var x0 = -48, x1 = wt === 'orak' ? 80 : 60, y0 = -134, y1 = 8;
    if (anim === 'attack') {
      y0 = -138;
      if (wt === 'orak') { x0 = -80; x1 = 80; }
      else if (wt === 'asa') { x1 = 98; y0 = -140; }
      else if (wt === 'yay') x1 = 72;
      else { x1 = 78; y1 = 26; }
    } else if (anim === 'victory') y0 = -140;
    else if (anim === 'hurt') { x0 = -54; x1 += 6; }
    b = BOXES[key] = { x0: x0, y0: y0, w: x1 - x0, h: y1 - y0 };
    return b;
  }
  function renderFrame(R, P, Q, es, flash, reuse, box) {
    var W = Math.ceil(box.w * es), H = Math.ceil(box.h * es), cv;
    if (reuse) {
      if (!FLASHBUF) FLASHBUF = mkCv(W, H);
      cv = FLASHBUF;
      if (cv.width < W || cv.height < H) { cv.width = mx(cv.width, W); cv.height = mx(cv.height, H); }
    } else cv = mkCv(W, H);
    var g = cv.getContext('2d');
    g.setTransform(1, 0, 0, 1, 0, 0);
    if (reuse) g.clearRect(0, 0, W, H);
    g.globalAlpha = 1; g.globalCompositeOperation = 'source-over';
    g.setTransform(es, 0, 0, es, -box.x0 * es, -box.y0 * es);
    drawBody(g, R, P, Q);
    postFx(cv, W, H, es, flash, Q.lw);
    return { cv: cv, sw: W, sh: H, x0: box.x0, y0: box.y0, dw: W / es, dh: H / es, px: reuse ? 0 : W * H, lift: P.lift };
  }
  // Silhouette rim light: a cool band just inside the sticker outline on the back/top edges (mask shift trick),
  // then the white hit flash. Works on any rendered hero canvas.
  var RIMBUF = null, RIMCOL = '#8F7DFF';
  function postFx(cv, W, H, es, flash, lw) {
    var g = cv.getContext('2d');
    g.setTransform(1, 0, 0, 1, 0, 0); g.globalAlpha = 1;
    if (es >= 0.45) {
      if (!RIMBUF) RIMBUF = mkCv(W, H);
      if (RIMBUF.width < W || RIMBUF.height < H) { RIMBUF.width = mx(RIMBUF.width, W); RIMBUF.height = mx(RIMBUF.height, H); }
      var r = RIMBUF.getContext('2d'), k = mx(1, (lw || 2) * es), o = k + clamp(1.05 * es, 1, 4);
      r.setTransform(1, 0, 0, 1, 0, 0); r.globalAlpha = 1;
      r.globalCompositeOperation = 'source-over'; r.clearRect(0, 0, W, H);
      r.drawImage(cv, 0, 0, W, H, k, k * 0.75, W, H);
      r.globalCompositeOperation = 'destination-out'; r.drawImage(cv, 0, 0, W, H, o, o * 0.75, W, H);
      r.globalCompositeOperation = 'destination-in'; r.drawImage(cv, 0, 0, W, H, 0, 0, W, H);
      r.globalCompositeOperation = 'source-in'; r.fillStyle = RIMCOL; r.fillRect(0, 0, W, H);
      r.globalCompositeOperation = 'source-over';
      g.globalCompositeOperation = 'lighter'; g.globalAlpha = 0.3; g.drawImage(RIMBUF, 0, 0, W, H, 0, 0, W, H);
      g.globalAlpha = 1; g.globalCompositeOperation = 'source-over';
    }
    if (flash > 0.01) {
      g.globalCompositeOperation = 'source-atop'; g.fillStyle = rgba('#FFFFFF', flash * 0.9); g.fillRect(0, 0, W, H);
      g.globalCompositeOperation = 'source-over';
    }
  }
  // frame spec: which bucket of which anim, and the pose inputs that reproduce it
  function specOf(anim, idx, Qt, moving, li, blink) {
    var S = { anim: anim, idx: idx, li: li | 0, t: 0, o: { moving: false, hurtP: null, atkP: 0, _blink: blink ? 1 : 0 }, k: '' }, n = Qt[anim][0];
    if (anim === 'attack') {
      S.o.atkP = idx / n; S.k = 'a' + idx;
      if (moving) { S.o.moving = true; S.t = li / Qt.legs * 0.56; S.k += 'm' + li; }
    } else if (anim === 'hurt') { S.o.hurtP = (idx + 0.5) / n; S.k = 'h' + idx; }
    else { S.t = idx / n * Qt[anim][1]; S.k = anim.charAt(0) + idx; }
    if (anim === 'idle') S.o._nobreath = true;   // breathing is applied continuously at blit time
    if (blink) S.k += 'b';
    return S;
  }
  function frameSpec(anim, t, o, R, Qt) {
    var q = Qt[anim], n = q[0], ph = R.ph, idx, li = 0, blink = false, moving = !!o.moving;
    if (anim === 'attack') {
      idx = round(clamp(+o.atkP || 0, 0, 1) * n);
      if (moving) li = floor(fract(t / 0.56 + ph) * Qt.legs);
    } else if (anim === 'hurt') {
      idx = mn(n - 1, floor((o.hurtP != null ? clamp(+o.hurtP || 0, 0, 1) : fract(t / q[1])) * n));
    } else {
      var u = t / q[1] + ph;
      idx = floor(fract(u) * n);
      if (anim === 'idle') blink = floor(u) % 2 === 1 && idx === (n >> 1);
      else if (anim === 'walk') blink = floor(u) % 6 === 5 && idx === (n >> 1);
    }
    return specOf(anim, idx, Qt, moving, li, blink);
  }
  function buildFrame(R, S, es, scale, fx, key) {
    var P = pose(S.anim, S.t, S.o, R.wt, 0);
    var Q = { es: es, lod: es >= 0.7 ? 1 : 0, fx: fx, lw: lwFor(scale), P: P };
    var F = renderFrame(R, P, Q, es, P.flash, false, boxFor(S.anim, R.wt));
    FCACHE.set(key, F); FPX += F.px;
    while (FPX > FMAX && FCACHE.size > 1) { var k0 = FCACHE.keys().next().value; FPX -= FCACHE.get(k0).px; FCACHE.delete(k0); }
    return F;
  }
  // idle-time prewarm of the remaining buckets of an animation (keeps the first loop of a new anim smooth)
  var WARMQ = [], WARMKEYS = new Set(), warmOn = false;
  var ric = typeof requestIdleCallback === 'function' ? function (f) { requestIdleCallback(f, { timeout: 300 }); } : function (f) { setTimeout(function () { f(null); }, 40); };
  function warmAll(R, S0, Qt, es, scale, fx, base) {
    var n = Qt[S0.anim][0] + (S0.anim === 'attack' ? 1 : 0);
    for (var i = 0; i < n; i++) {
      var S = specOf(S0.anim, i, Qt, S0.o.moving, S0.li, false);
      var key = base + S.k;
      if (FCACHE.has(key) || WARMKEYS.has(key)) continue;
      WARMKEYS.add(key); WARMQ.push([R, S, es, scale, fx, key]);
    }
    if (WARMQ.length > 120) { var drop = WARMQ.splice(0, WARMQ.length - 120); drop.forEach(function (j) { WARMKEYS.delete(j[5]); }); }
    if (!warmOn && WARMQ.length) { warmOn = true; ric(warmTick); }
  }
  function warmTick(dl) {
    var t0 = Date.now(), built = 0;
    while (WARMQ.length && built < 3) {
      if (dl && dl.timeRemaining && dl.timeRemaining() < 5 && !dl.didTimeout) break;
      if (!dl && Date.now() - t0 > 6) break;
      var j = WARMQ.shift(); WARMKEYS.delete(j[5]);
      if (!FCACHE.has(j[5])) { try { buildFrame(j[0], j[1], j[2], j[3], j[4], j[5]); } catch (e) { Art._heroErr = e; } built++; }
    }
    if (WARMQ.length) ric(warmTick); else warmOn = false;
  }
  var buildLog = [];
  function drawCached(c, R, o, t, anim, dir, es, scale, fx, full) {
    var Qt = full ? QF : QL;
    var esC = full ? clamp(round(es * 4) / 4, 0.5, 4.5) : clamp(round(es * 8) / 8, 0.25, 3);
    var S = frameSpec(anim, t, o, R, Qt);
    var base = R.key + (full ? '|F' : '|L') + (fx ? 'g' : 'n') + esC + '|';
    var key = base + S.k;
    var F = FCACHE.get(key);
    if (F) { FCACHE.delete(key); FCACHE.set(key, F); }
    else {
      var now = Date.now();
      while (buildLog.length && now - buildLog[0] > 1000) buildLog.shift();
      if (full && buildLog.length > 30) {
        // the working set does not fit: draw this one directly instead of thrashing the cache
        var P = pose(anim, t, o, R.wt, R.ph);
        var Q = { es: clamp(es, 0.25, 6), lod: es >= 0.7 ? 1 : 0, fx: fx, lw: lwFor(scale), P: P };
        F = renderFrame(R, P, Q, Q.es, P.flash, true, boxFor(anim, R.wt));
      } else {
        buildLog.push(now);
        F = buildFrame(R, S, esC, scale, fx, key);
        warmAll(R, S, Qt, esC, scale, fx, base);
      }
    }
    if (o.shadow !== false) shadowAt(c, F.lift);
    if (dir < 0) c.scale(-1, 1);
    var needB = fx && auraNeedB(R), needF = fx && auraNeedF(R);
    var br = anim === 'idle' ? sin((t / 2.6 + R.ph) * TAU) : 0;
    if (full) { if (needB) auraBack(c, R, t, false, F.lift); }
    else { var ai = floor(fract(t / 2.4) * 16), lf = round(F.lift); if (needB) auraSprite(c, R, ai, esC, 0, lf); }
    if (br) { c.save(); c.scale(1 - 0.007 * br, 1 + 0.013 * br); }
    c.drawImage(F.cv, 0, 0, F.sw, F.sh, F.x0, F.y0, F.dw, F.dh);
    if (br) c.restore();
    if (full) { if (needF) auraFront(c, R, t, false, F.lift); }
    else if (needF) auraSprite(c, R, ai, esC, 1, lf);
  }
  function auraNeedB(R) { return !!(R.aura || (R.hs && R.hs.aura)); }
  function auraNeedF(R) {
    if (R.maxRar >= 4 || (R.hs && (R.hs.frost || R.hs.hairTip))) return true;
    for (var i = 0; i < ARMOR.length; i++) { var g = R.g[ARMOR[i]]; if (g && g.set === 'golge' && !g.skin) return true; }
    return false;
  }
  // lite: aura layers pre-rendered as a 16-frame / 2.4 s loop (all aura timings are periodic in 2.4 s)
  var ABOX = { x0: -62, y0: -146, w: 124, h: 162 };
  function auraSprite(c, R, ai, es, front, lift) {
    var key = R.key + '|A' + front + ai + '|' + es + '|' + lift, F = FCACHE.get(key);
    if (!F) {
      var W = Math.ceil(ABOX.w * es), H = Math.ceil(ABOX.h * es), cv = mkCv(W, H), g = cv.getContext('2d');
      g.setTransform(es, 0, 0, es, -ABOX.x0 * es, -ABOX.y0 * es);
      g.lineJoin = 'round'; g.lineCap = 'round';
      if (front) auraFront(g, R, ai / 16 * 2.4, true, lift); else auraBack(g, R, ai / 16 * 2.4, true, lift);
      F = { cv: cv, sw: W, sh: H, dw: W / es, dh: H / es, px: W * H, lift: lift };
      FCACHE.set(key, F); FPX += F.px;
      while (FPX > FMAX && FCACHE.size > 1) { var k0 = FCACHE.keys().next().value; FPX -= FCACHE.get(k0).px; FCACHE.delete(k0); }
    }
    c.drawImage(F.cv, 0, 0, F.sw, F.sh, ABOX.x0, ABOX.y0, F.dw, F.dh);
  }
  var lastLook = null, lastR = null, lastT = 0;
  function getR(look) {
    if (look && typeof look === 'object') {
      var now = Date.now();
      if (look === lastLook && now - lastT < 250) return lastR;
      lastR = resolve(look); lastLook = look; lastT = now; return lastR;
    }
    return resolve(look);
  }
  function drawHero(ctx, x, y, scale, o) {
    if (!ctx) return;
    o = o || {};
    scale = +scale; if (!(scale > 0)) scale = 1;
    var t = +o.t || 0, anim = ANIMS[o.anim] ? o.anim : 'idle', dir = o.dir < 0 ? -1 : 1, fx = o.glow !== false;
    ctx.save();
    try {
      var R = getR(o.look);
      var es = devScale(ctx) * scale;
      ctx.translate(+x || 0, +y || 0); ctx.scale(scale, scale);
      drawCached(ctx, R, o, t, anim, dir, es, scale, fx, !o.lite);
    } catch (e) { Art._heroErr = e; }
    ctx.restore();
  }

  // ------------------------------------------------------------------------------------------ item icons
  var ICACHE = new Map(), IPX = 0, IMAX = 3e6, SWEEP = null;
  function sweepSpr() {
    if (SWEEP) return SWEEP;
    SWEEP = mkCv(64, 8); var g = SWEEP.getContext('2d'), gr = g.createLinearGradient(0, 0, 64, 0);
    gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(0.5, 'rgba(255,255,255,0.9)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 64, 8); return SWEEP;
  }
  function iconOutline(px) { return clamp(2 + 120 / px, 2.2, 4.4); }
  // place a piece whose local axis midpoint (mx0,my0) lands on (cx,cy) after rotation+scale
  function placeAt(c, cx, cy, rot, k, mx0, my0) {
    var cr = cos(rot), sr = sin(rot);
    c.translate(cx - (mx0 * cr - my0 * sr) * k, cy - (mx0 * sr + my0 * cr) * k);
    c.rotate(rot); c.scale(k, k);
  }
  function iconPiece(c, slot, set, wt, rar, skin, px) {
    var g = { slot: slot, rar: rar, set: set, skin: skin || null, m: MAT[set], tc: rarCol(rar), td: rarDark(rar) };
    var LW = iconOutline(px), u = px / 100, t = 0;
    var Q = { es: u, lod: 1, fx: true, lw: 1, icon: true, P: { hair: -0.2, cape: 0, t: 0 } };
    c.lineJoin = 'round'; c.lineCap = 'round'; c.strokeStyle = OUT;
    function at(cx, cy, rot, k, mx0, my0, fn) { c.save(); placeAt(c, cx, cy, rot, k, mx0, my0); c.lineWidth = LW / k; Q.es = u * k; fn(); c.restore(); }
    // floor shadow
    glow(c, 50, 80, 34, 8, '#000000', 0.45);
    if (slot === 'silah') {
      var w = { wt: wt, rar: rar, skin: skin || null, tc: g.tc, td: g.td };
      if (wt === 'kilic') { var L = [30, 32, 34, 36, 38, 41][rar] + (skin ? 3 : 0); at(50, 51, PI / 4, 96 / (L + 16), 0, -(L - 4) / 2, function () { pieceSword(c, w, Q, t); }); }
      else if (wt === 'yay') { var H = [22, 23, 24, 25, 26, 27][rar] + (skin ? 1 : 0); at(48, 52, -PI / 4, 90 / (2 * H + 8), 6, 0, function () { pieceBow(c, w, Q, t, 0.35, true); }); }
      else if (wt === 'orak') at(50, 52, PI / 7, 1.32, 9, -17, function () { pieceScythe(c, w, Q, t); });
      else at(50, 50, PI / 7, 1.62, 0, -20, function () { pieceStaff(c, w, Q, t, 0.3, 0); });
      return;
    }
    if (slot === 'kafa') {
      if (skin === 'sk_kafa_tac') { at(50, 58, 0, 2.15, 2, -32, function () { shadowCrown(c, g, Q, t); }); return; }
      at(50, 57, 0, skin === 'sk_kafa_boynuz' ? 1.22 : 1.36, 1, -14, function () {
        fl(c, function (c) { E(c, 1, 3, 21, 14); }, '#0B0710', true);
        pieceHelmet(c, g, Q, t, null);
      });
    } else if (slot === 'yuz') {
      if (!skin && set === 'ejder') {
        at(50, 50, 0, 1.6, 3.5, 2, function () {
          pieceMask(c, g, Q, t, 'eyes');
          fl(c, function (c) { E(c, FX - 8.6, 4, 4, 5.6); E(c, FX + 9.4, 4, 4.4, 5.9); }, '#0B0710', true);
        });
      } else at(50, 54, 0, skin ? 1.6 : 1.68, 1, skin ? 8 : 14, function () {
        var sc = g.set === 'kurt' ? '#5A341E' : g.set === 'gece' ? '#283A6C' : '#2A2224';
        for (var sd = -1; sd <= 1; sd += 2) { c.beginPath(); c.moveTo(sd * 21, 11.5); c.quadraticCurveTo(sd * 27, 8, sd * 29, 3); strokeW(c, OUT, 4.2); strokeW(c, sc, 2.2); fl(c, function (c) { Ci(c, sd * 21.8, 12.6, 1.6); }, g.tc); }
        pieceMask(c, g, Q, t, 'low');
      });
    } else if (slot === 'boyun') {
      at(50, 50, 0, 3.6, 1.5, -47, function () { pieceNeck(c, g, Q, t); });
    } else if (slot === 'omuz') {
      at(30, 56, 0, 2.3, 3, -2, function () { c.scale(-1, 1); pieceShoulder(c, g, Q, t, false); });
      at(70, 56, 0, 2.3, 3, -2, function () { pieceShoulder(c, g, Q, t, true); });
    } else if (slot === 'gogus') {
      at(50, 52, 0, 2.3, 1, -39, function () {
        if (skin === 'sk_gogus_kanat') { c.save(); c.translate(2, 4); featherWings(c, g, { t: 0.25, cape: 0 }, Q); c.restore(); }
        pieceChest(c, g, Q, t, null);
      });
    } else if (slot === 'kol') {
      at(35, 50, 0.22, 3.4, 0, 6.5, function () { pieceBracer(c, g, Q, t, 13, false); });
      at(65, 50, -0.22, 3.4, 0, 6.5, function () { pieceBracer(c, g, Q, t, 13, true); });
    } else if (slot === 'eldiven') {
      at(34, 52, -0.3, 3.5, 0, -0.5, function () { c.scale(-1, 1); pieceGlove(c, g, Q, t, false); });
      at(66, 50, 0.3, 3.5, 0, -0.5, function () { pieceGlove(c, g, Q, t, true); });
    } else if (slot === 'kemer') {
      at(50, 50, 0, 3.3, 1, -28, function () {
        c.beginPath(); c.ellipse(0, -29, 12.6, 4.6, 0, PI * 1.02, PI * 1.98); strokeW(c, OUT, 5.4 + c.lineWidth * 2); strokeW(c, dk(g.m.b, 0.35), 5.4);
        pieceBelt(c, g, Q, t);
      });
    } else if (slot === 'pantolon') {
      at(50, 50, 0, 2.7, 0, -18.5, function () {
        var gp = g, mm = gp.set === 'gece' ? [gp.m.a, gp.m.aS, lt(gp.m.a, 0.3)] : [gp.m.b, gp.m.s, gp.m.l];
        for (var s = -1; s <= 1; s += 2) {
          var hx = s * HIP_X, ax = s * 5.6;
          cel(c, function (c) { CAP(c, hx, HIP_Y, ax, -6, 5, 4.5); }, s < 0 ? dk(mm[0], 0.12) : mm[0], mm[1], mm[2], 2.2, 1);
          c.save(); c.translate(hx, HIP_Y); c.rotate(-0.08 * s); pantsLegDeco(c, gp, 13, Q, t, true); c.restore();
        }
        cel(c, pelvisPath, mm[0], mm[1], mm[2], 2.2, 1);
        piecePantsTop(c, gp, Q, t);
      });
    } else if (slot === 'dizlik') {
      at(33, 52, -0.15, 3.9, 1, 0, function () { pieceKnee(c, g, Q, t, false); });
      at(66, 50, 0.1, 4.2, 1, 0, function () { pieceKnee(c, g, Q, t, true); });
    } else if (slot === 'ayak') {
      at(37, 45, 0, 2.6, 3, 2, function () { pieceBoot(c, g, Q, t, false, null); });
      at(56, 60, 0, 2.8, 3, 2, function () { pieceBoot(c, g, Q, t, true, null); });
    }
  }
  function buildIcon(slot, set, wt, rar, skin, px) {
    var cv = mkCv(px, px), c = cv.getContext('2d'), u = px / 100, rc = rarCol(rar);
    c.scale(u, u);
    c.save();
    c.beginPath(); RR(c, 1, 1, 98, 98, 16); c.clip();
    var gr = c.createRadialGradient(50, 22, 4, 50, 42, 86);
    gr.addColorStop(0, lt(RF[rar][0], 0.08)); gr.addColorStop(0.55, RF[rar][0]); gr.addColorStop(1, RF[rar][1]);
    c.fillStyle = gr; c.fillRect(0, 0, 100, 100);
    // backdrop motif: rays + rune ring (stronger with rarity)
    c.save(); c.translate(50, 48);
    var ra = 0.05 + rar * 0.025;
    c.fillStyle = rgba('#FFFFFF', ra);
    for (var i = 0; i < 12; i++) { c.rotate(TAU / 12); c.beginPath(); c.moveTo(-3, 0); c.lineTo(3, 0); c.lineTo(9, -80); c.lineTo(-9, -80); c.closePath(); c.fill(); }
    if (rar >= 2) {
      c.lineWidth = 1.2; c.strokeStyle = rgba(lt(rc, 0.4), 0.18 + rar * 0.03);
      c.beginPath(); c.arc(0, 0, 36, 0, TAU); c.stroke(); c.beginPath(); c.arc(0, 0, 31, 0, TAU); c.stroke();
      for (var k = 0; k < 10; k++) { var an = k * TAU / 10; rune(c, cos(an) * 33.5, sin(an) * 33.5, 1.6, rgba(lt(rc, 0.5), 0.3 + rar * 0.04), k); }
    }
    c.restore();
    var vg = c.createRadialGradient(50, 46, 26, 50, 50, 74);
    vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(6,3,10,0.55)');
    c.fillStyle = vg; c.fillRect(0, 0, 100, 100);
    if (rar >= 3) { addOn(c); glow(c, 50, 50, 44, 40, rc, 0.32); addOff(c); }
    c.save(); iconPiece(c, slot, set, wt, rar, skin, px); c.restore();
    // corner shine
    var sh = c.createLinearGradient(0, 0, 42, 42);
    sh.addColorStop(0, 'rgba(255,255,255,0.30)'); sh.addColorStop(1, 'rgba(255,255,255,0)');
    c.fillStyle = sh; c.beginPath(); c.moveTo(0, 0); c.lineTo(56, 0); c.quadraticCurveTo(22, 14, 0, 56); c.closePath(); c.fill();
    c.restore();
    // bevel + border
    c.lineJoin = 'round';
    c.beginPath(); RR(c, 3.2, 3.2, 93.6, 93.6, 14); c.lineWidth = 3.6; c.strokeStyle = rc; c.stroke();
    c.beginPath(); RR(c, 5.6, 5.6, 88.8, 88.8, 11.5); c.lineWidth = 1.4; c.strokeStyle = 'rgba(255,255,255,0.28)'; c.stroke();
    c.beginPath(); c.moveTo(12, 93.6); c.lineTo(88, 93.6); c.lineWidth = 2; c.strokeStyle = rgba(rarDark(rar), 0.9); c.stroke();
    c.beginPath(); RR(c, 1, 1, 98, 98, 16); c.lineWidth = 1.8; c.strokeStyle = OUT; c.stroke();
    // corner studs
    c.fillStyle = lt(rc, 0.35);
    c.beginPath(); Ci(c, 9.5, 9.5, 1.8); Ci(c, 90.5, 9.5, 1.8); Ci(c, 9.5, 90.5, 1.8); Ci(c, 90.5, 90.5, 1.8); c.fill();
    return cv;
  }
  function iconFx(c, x, y, s, rar, t, seed) {
    if (rar < 2) return;
    var u = s / 100, rc = rarCol(rar), i, k;
    c.translate(x, y); c.scale(u, u);
    c.beginPath(); RR(c, 1, 1, 98, 98, 16); c.clip();
    addOn(c);
    if (rar >= 3) glow(c, 50, 50, 46, 44, rc, (rar === 3 ? 0.13 : 0.2) * (0.6 + 0.4 * sin(t * 2.2 + seed)));
    var n = rar >= 4 ? 4 : rar >= 3 ? 3 : 1;
    for (i = 0; i < n; i++) {
      k = fract(t * 0.38 + i / n + seed * 0.1);
      var px2 = 50 + sin(i * 2.4 + seed) * 30, py2 = 50 + cos(i * 1.7 + seed) * 28;
      spark(c, px2, py2, 3 + 4 * sin(k * PI), i % 2 ? lt(rc, 0.6) : '#FFFFFF', pow(sin(k * PI), 3));
    }
    if (rar >= 4) {
      var sp = fract(t / 3.2 + seed * 0.07) * 260 - 80;
      if (sp < 140) { c.save(); c.translate(sp, 50); c.rotate(0.45); c.globalAlpha = 0.28; c.drawImage(sweepSpr(), -16, -90, 32, 180); c.restore(); }
    }
    if (rar >= 5) {
      for (i = 0; i < 5; i++) { k = fract(t * 0.55 + i * 0.23); glow(c, 14 + i * 18 + sin(t * 2 + i) * 4, 94 - k * 84, 3.5, 3.5, i % 2 ? '#FF3D4F' : '#FF9A4A', sin(k * PI) * 0.9); }
    }
    if (rar >= 3) { c.beginPath(); RR(c, 3.2, 3.2, 93.6, 93.6, 14); c.lineWidth = 2.4; c.strokeStyle = rgba(rc, 0.3 + 0.25 * sin(t * 2.6 + seed)); c.stroke(); }
    addOff(c);
  }
  function drawItemIcon(ctx, x, y, size, it, t) {
    if (!ctx || !(size > 0)) return;
    it = it || {};
    t = +t || 0;
    ctx.save();
    try {
      var rar = clamp(it.rar | 0, 0, 5);
      var slot = it.slot || (it.wt ? 'silah' : 'gogus');
      var set = MAT[it.set] ? it.set : defaultSet(rar);
      var wt = WTS[it.wt] ? it.wt : 'kilic';
      var skin = it.skin || '';
      var px = clamp(round(size * devScale(ctx)), 12, 512);
      var key = slot + '|' + (slot === 'silah' ? wt : set) + '|' + rar + '|' + skin + '|' + px;
      var cv = ICACHE.get(key);
      if (!cv) {
        cv = buildIcon(slot, set, wt, rar, skin, px);
        ICACHE.set(key, cv); IPX += px * px;
        while (IPX > IMAX && ICACHE.size > 1) { var k0 = ICACHE.keys().next().value; var o0 = ICACHE.get(k0); IPX -= o0.width * o0.height; ICACHE.delete(k0); }
      }
      ctx.drawImage(cv, x, y, size, size);
      iconFx(ctx, x, y, size, rar, t, (hstr(key) % 100) / 10);
    } catch (e) { Art._iconErr = e; }
    ctx.restore();
  }

  // ------------------------------------------------------------------------------------------ portraits
  var PCACHE = new Map();
  function portraitBg(R, px) {
    var cv = mkCv(px, px), c = cv.getContext('2d'), u = px / 100;
    c.scale(u, u);
    var acc = (R.hs && R.hs.aura) || R.pal.eye;
    var gr = c.createRadialGradient(50, 36, 4, 50, 50, 78);
    gr.addColorStop(0, mix(R.pal.cloth, '#3A2B4F', 0.35)); gr.addColorStop(0.6, '#1A1424'); gr.addColorStop(1, '#09070D');
    c.fillStyle = gr; c.fillRect(0, 0, 100, 100);
    c.save(); c.translate(50, 40); c.fillStyle = rgba(lt(acc, 0.3), 0.07);
    for (var i = 0; i < 10; i++) { c.rotate(TAU / 10); c.beginPath(); c.moveTo(-2, 0); c.lineTo(2, 0); c.lineTo(10, -90); c.lineTo(-10, -90); c.closePath(); c.fill(); }
    c.restore();
    addOn(c); glow(c, 50, 40, 46, 42, acc, 0.35); addOff(c);
    return cv;
  }
  function portraitBust(R, px, blink) {
    var H = round(px * 1.12), cv = mkCv(px, H), c = cv.getContext('2d');
    var k = px / 74;
    c.setTransform(k, 0, 0, k, px / 2 - HEAD_X * k, 110 * k);
    var P = pose('idle', 0, { _blink: blink ? 1 : 0 }, null, 0);
    P.hFx = 14; P.hFy = -30; P.hBx = -14; P.hBy = -30;
    var Q = { es: k, lod: 1, fx: true, lw: clamp(px * 0.022, 1.6, 5) / k, P: P };
    drawBody(c, R, P, Q);
    postFx(cv, px, H, k, 0, Q.lw);
    return cv;
  }
  function drawHeroPortrait(ctx, x, y, size, heroId, t, heroSkin) {
    if (!ctx || !(size > 0)) return;
    t = +t || 0;
    ctx.save();
    try {
      var px = clamp(round(size * devScale(ctx)), 16, 640);
      var R = resolve({ heroId: heroId || 'bora', heroSkin: heroSkin || null });
      var key = R.key + '|' + px, E2 = PCACHE.get(key);
      if (!E2) {
        E2 = { bg: portraitBg(R, px), b0: null, b1: null }; PCACHE.set(key, E2);
        if (PCACHE.size > 40) PCACHE.delete(PCACHE.keys().next().value);
      }
      var blink = fract((t + R.ph * 0.77) / 3.8) < 0.04;
      var bust = blink ? (E2.b1 || (E2.b1 = portraitBust(R, px, 1))) : (E2.b0 || (E2.b0 = portraitBust(R, px, 0)));
      ctx.beginPath(); ctx.rect(x, y, size, size); ctx.clip();
      ctx.drawImage(E2.bg, x, y, size, size);
      var bob = sin(t * TAU / 2.6 + R.ph) * size * 0.007;
      ctx.drawImage(bust, x, y + bob, size, size * 1.12);
      var acc = (R.hs && R.hs.aura) || R.pal.eye, u = size / 100;
      addOn(ctx);
      for (var i = 0; i < 3; i++) { var k = fract(t * 0.25 + i / 3); spark(ctx, x + (20 + i * 30 + sin(t + i) * 5) * u, y + (96 - k * 80) * u, 1.6 * u + 0.6, lt(acc, 0.5), sin(k * PI) * 0.7); }
      addOff(ctx);
    } catch (e) { Art._portraitErr = e; }
    ctx.restore();
  }

  // ------------------------------------------------------------------------------------------ talent / attribute glyphs (100-unit box)
  function star5(c, cx, cy, r1, r2, n) {
    n = n || 5;
    for (var i = 0; i < n * 2; i++) { var a = -HP + i * PI / n, r = i % 2 ? r2 : r1; if (i) c.lineTo(cx + cos(a) * r, cy + sin(a) * r); else c.moveTo(cx + cos(a) * r, cy + sin(a) * r); }
    c.closePath();
  }
  var GLYPH = {
    sword: { p: function (c) { c.save(); c.translate(50, 50); c.rotate(PI / 4); c.moveTo(-6, 12); c.lineTo(-6, -32); c.lineTo(0, -42); c.lineTo(6, -32); c.lineTo(6, 12); c.closePath(); RR(c, -17, 12, 34, 7, 3.5); RR(c, -4, 19, 8, 13, 2); Ci(c, 0, 36, 5.5); c.restore(); },
      d: function (c, col) { c.save(); c.translate(50, 50); c.rotate(PI / 4); line(c, 0, 10, 0, -34, rgba('#FFFFFF', 0.55), 2.2); c.restore(); } },
    bow: { p: function (c) { c.save(); c.translate(48, 52); c.rotate(-PI / 4); c.moveTo(-8, -40); c.quadraticCurveTo(32, 0, -8, 40); c.quadraticCurveTo(12, 0, -8, -40); c.closePath(); c.moveTo(-24, -2.6); c.lineTo(30, -2.6); c.lineTo(30, -7); c.lineTo(42, 0); c.lineTo(30, 7); c.lineTo(30, 2.6); c.lineTo(-24, 2.6); c.closePath(); c.restore(); },
      d: function (c) { c.save(); c.translate(48, 52); c.rotate(-PI / 4); line(c, -8, -38, -8, 38, rgba('#FFFFFF', 0.8), 1.6); c.restore(); } },
    scythe: { p: function (c) { c.save(); c.translate(52, 52); c.rotate(PI / 7); RR(c, -4, -38, 8, 76, 4); c.moveTo(-2, -40); c.quadraticCurveTo(26, -56, 44, -26); c.quadraticCurveTo(22, -40, 2, -30); c.closePath(); c.restore(); }, d: null },
    staff: { p: function (c) { c.save(); c.translate(50, 54); c.rotate(PI / 10); RR(c, -4.5, -20, 9, 60, 4.5); c.moveTo(-5, -16); c.quadraticCurveTo(-20, -24, -14, -44); c.quadraticCurveTo(-12, -30, -2, -24); c.closePath(); c.moveTo(5, -16); c.quadraticCurveTo(20, -24, 14, -44); c.quadraticCurveTo(12, -30, 2, -24); c.closePath(); Ci(c, 0, -32, 12); c.restore(); },
      d: function (c) { c.save(); c.translate(50, 52); c.rotate(PI / 9); fl(c, function (c) { Ci(c, -4, -36, 4.5); }, rgba('#FFFFFF', 0.75), true); c.restore(); } },
    fist: { p: function (c) { RR(c, 22, 20, 56, 50, 16); RR(c, 30, 66, 40, 20, 6); },
      d: function (c, col) {
        var d2 = dk(col, 0.5);
        line(c, 36, 23, 36, 44, d2, 2.4); line(c, 50, 22, 50, 44, d2, 2.4); line(c, 64, 23, 64, 44, d2, 2.4);
        cel(c, function (c) { CAP(c, 24, 54, 58, 50, 9, 8); }, col, dk(col, 0.35), lt(col, 0.4), 2.5, 1.2);
        c.lineWidth = 3; c.beginPath(); CAP(c, 24, 54, 58, 50, 9, 8); c.stroke();
        fl(c, function (c) { E(c, 30, 28, 4, 3); E(c, 44, 27, 4, 3); E(c, 58, 27, 4, 3); }, rgba('#FFFFFF', 0.45), true);
        line(c, 32, 75, 68, 75, d2, 2.4);
      } },
    shield: { p: function (c) { c.moveTo(18, 18); c.quadraticCurveTo(50, 8, 82, 18); c.quadraticCurveTo(84, 62, 50, 90); c.quadraticCurveTo(16, 62, 18, 18); c.closePath(); },
      d: function (c, col) { fl(c, function (c) { c.moveTo(50, 26); c.lineTo(68, 40); c.lineTo(50, 74); c.lineTo(32, 40); c.closePath(); }, dk(col, 0.4), true); fl(c, function (c) { c.moveTo(50, 34); c.lineTo(60, 42); c.lineTo(50, 62); c.lineTo(40, 42); c.closePath(); }, rgba('#FFFFFF', 0.55), true); } },
    heart: { p: function (c) { c.moveTo(50, 86); c.bezierCurveTo(14, 62, 8, 40, 20, 26); c.bezierCurveTo(32, 13, 46, 20, 50, 32); c.bezierCurveTo(54, 20, 68, 13, 80, 26); c.bezierCurveTo(92, 40, 86, 62, 50, 86); c.closePath(); },
      d: function (c) { fl(c, function (c) { E(c, 32, 34, 7, 5, -0.6); }, rgba('#FFFFFF', 0.7), true); } },
    boot: { p: function (c) { c.moveTo(30, 18); c.lineTo(58, 18); c.lineTo(58, 58); c.quadraticCurveTo(84, 58, 86, 74); c.lineTo(86, 84); c.lineTo(26, 84); c.lineTo(28, 50); c.closePath(); c.moveTo(30, 30); c.quadraticCurveTo(12, 22, 6, 30); c.quadraticCurveTo(14, 32, 10, 38); c.quadraticCurveTo(20, 38, 30, 42); c.closePath(); },
      d: function (c, col) { line(c, 28, 76, 86, 76, dk(col, 0.45), 3); line(c, 32, 28, 56, 28, rgba('#FFFFFF', 0.5), 3); } },
    clock: { p: function (c) { Ci(c, 50, 54, 33); RR(c, 43, 12, 14, 10, 3); },
      d: function (c, col) { fl(c, function (c) { Ci(c, 50, 54, 25); }, lt(col, 0.75), true); for (var i = 0; i < 12; i++) { var a = i * TAU / 12; line(c, 50 + cos(a) * 20, 54 + sin(a) * 20, 50 + cos(a) * 23, 54 + sin(a) * 23, dk(col, 0.5), i % 3 ? 1.4 : 2.6); } line(c, 50, 54, 50, 38, OUT, 3.4); line(c, 50, 54, 62, 60, OUT, 3.4); fl(c, function (c) { Ci(c, 50, 54, 3.2); }, OUT, true); } },
    star: { p: function (c) { star5(c, 50, 54, 40, 17); }, d: function (c) { fl(c, function (c) { star5(c, 50, 54, 15, 7); }, rgba('#FFFFFF', 0.55), true); } },
    skull: { p: function (c) { c.moveTo(22, 50); c.bezierCurveTo(18, 16, 82, 16, 78, 50); c.quadraticCurveTo(78, 62, 68, 66); c.lineTo(68, 80); c.lineTo(32, 80); c.lineTo(32, 66); c.quadraticCurveTo(22, 62, 22, 50); c.closePath(); },
      d: function (c) { fl(c, function (c) { E(c, 38, 50, 8, 9); E(c, 62, 50, 8, 9); c.moveTo(50, 58); c.lineTo(54, 66); c.lineTo(46, 66); c.closePath(); }, '#1A1018', true); line(c, 42, 72, 42, 80, '#1A1018', 2); line(c, 50, 72, 50, 80, '#1A1018', 2); line(c, 58, 72, 58, 80, '#1A1018', 2); } },
    flame: { p: function (c) { c.moveTo(50, 90); c.bezierCurveTo(22, 90, 16, 66, 28, 48); c.quadraticCurveTo(30, 60, 38, 62); c.bezierCurveTo(30, 40, 46, 22, 54, 10); c.quadraticCurveTo(56, 28, 68, 40); c.bezierCurveTo(84, 58, 80, 90, 50, 90); c.closePath(); },
      d: function (c) { fl(c, function (c) { c.moveTo(50, 84); c.bezierCurveTo(36, 84, 34, 70, 42, 60); c.quadraticCurveTo(46, 68, 50, 66); c.quadraticCurveTo(50, 54, 56, 46); c.bezierCurveTo(66, 60, 66, 84, 50, 84); c.closePath(); }, rgba('#FFF4C4', 0.9), true); } },
    snow: { p: function (c) { for (var i = 0; i < 6; i++) { var a = i * PI / 3; c.save(); c.translate(50, 50); c.rotate(a); RR(c, -4, -40, 8, 40, 3); c.save(); c.translate(0, -24); c.rotate(PI / 4); RR(c, -3, -12, 6, 13, 2.5); c.restore(); c.save(); c.translate(0, -24); c.rotate(-PI / 4); RR(c, -3, -12, 6, 13, 2.5); c.restore(); c.restore(); } Ci(c, 50, 50, 10); },
      d: function (c) { fl(c, function (c) { Ci(c, 50, 50, 4.5); }, rgba('#FFFFFF', 0.9), true); } },
    bolt: { p: function (c) { c.moveTo(58, 8); c.lineTo(24, 54); c.lineTo(46, 54); c.lineTo(38, 92); c.lineTo(78, 40); c.lineTo(55, 40); c.lineTo(66, 8); c.closePath(); },
      d: function (c) { line(c, 56, 16, 38, 46, rgba('#FFFFFF', 0.7), 2.4); } },
    drop: { p: function (c) { c.moveTo(50, 10); c.bezierCurveTo(56, 30, 78, 46, 78, 64); c.bezierCurveTo(78, 82, 64, 90, 50, 90); c.bezierCurveTo(36, 90, 22, 82, 22, 64); c.bezierCurveTo(22, 46, 44, 30, 50, 10); c.closePath(); },
      d: function (c) { fl(c, function (c) { E(c, 38, 62, 5, 9, 0.3); }, rgba('#FFFFFF', 0.7), true); } },
    eye: { p: function (c) { c.moveTo(8, 50); c.quadraticCurveTo(50, 8, 92, 50); c.quadraticCurveTo(50, 92, 8, 50); c.closePath(); },
      d: function (c, col) { fl(c, function (c) { Ci(c, 50, 50, 19); }, '#F4EEFF', false); fl(c, function (c) { Ci(c, 50, 50, 13); }, dk(col, 0.2), true); fl(c, function (c) { E(c, 50, 50, 4, 11); }, '#120C18', true); fl(c, function (c) { Ci(c, 44, 44, 4); }, '#FFFFFF', true); } },
    crown: { p: function (c) { c.moveTo(14, 76); c.lineTo(10, 28); c.lineTo(32, 48); c.lineTo(50, 18); c.lineTo(68, 48); c.lineTo(90, 28); c.lineTo(86, 76); c.closePath(); RR(c, 14, 72, 72, 12, 4); },
      d: function (c) { fl(c, function (c) { Ci(c, 50, 58, 6); }, '#E8394D', true); fl(c, function (c) { Ci(c, 28, 62, 4); Ci(c, 72, 62, 4); }, '#4BA3FF', true); fl(c, function (c) { Ci(c, 10, 28, 4); Ci(c, 50, 18, 4); Ci(c, 90, 28, 4); }, '#FFFFFF', true); } },
    wing: { p: function (c) { c.moveTo(16, 70); c.quadraticCurveTo(22, 22, 84, 14); c.quadraticCurveTo(80, 30, 68, 36); c.quadraticCurveTo(80, 40, 74, 50); c.quadraticCurveTo(62, 52, 58, 56); c.quadraticCurveTo(66, 62, 56, 70); c.quadraticCurveTo(40, 72, 34, 80); c.quadraticCurveTo(22, 82, 16, 70); c.closePath(); },
      d: function (c, col) { line(c, 30, 62, 66, 34, dk(col, 0.4), 2); line(c, 34, 70, 56, 56, dk(col, 0.4), 2); line(c, 26, 54, 60, 24, rgba('#FFFFFF', 0.6), 2); } }
  };
  var GCACHE = new Map();
  function glyphCanvas(name, col, px) {
    var key = name + col + px, cv = GCACHE.get(key);
    if (cv) return cv;
    var G = GLYPH[name] || GLYPH.star;
    cv = mkCv(px, px); var c = cv.getContext('2d'), u = px / 100;
    c.scale(u, u); c.lineJoin = 'round'; c.lineCap = 'round';
    var ow = clamp(3 + 160 / px, 4, 9);
    c.save(); c.translate(0, 3.5); c.beginPath(); G.p(c); c.lineWidth = ow * 2; c.strokeStyle = 'rgba(0,0,0,0.45)'; c.stroke(); c.fillStyle = 'rgba(0,0,0,0.45)'; c.fill(); c.restore();
    c.beginPath(); G.p(c); c.lineWidth = ow * 2; c.strokeStyle = OUT; c.stroke();
    var gr = c.createLinearGradient(0, 8, 0, 92);
    gr.addColorStop(0, lt(col, 0.6)); gr.addColorStop(0.45, col); gr.addColorStop(1, dk(col, 0.4));
    c.fillStyle = gr; c.fill();
    c.save(); c.clip();
    c.beginPath(); c.ellipse(36, 22, 34, 16, -0.4, 0, TAU); c.fillStyle = 'rgba(255,255,255,0.18)'; c.fill();
    c.restore();
    c.strokeStyle = OUT; c.lineWidth = 1.5;
    if (G.d) G.d(c, col);
    GCACHE.set(key, cv);
    if (GCACHE.size > 300) GCACHE.delete(GCACHE.keys().next().value);
    return cv;
  }
  function drawGlyph(ctx, x, y, size, name, col, t) {
    if (!ctx || !(size > 0)) return;
    ctx.save();
    try {
      var px = clamp(round(size * devScale(ctx)), 8, 512);
      ctx.drawImage(glyphCanvas(GLYPH[name] ? name : 'star', col, px), x, y, size, size);
      var k = pow(mx(0, sin((+t || 0) * 1.25 + (hstr(name) % 7))), 16);
      if (k > 0.05) { addOn(ctx); spark(ctx, x + size * 0.32, y + size * 0.26, size * 0.12 * (0.4 + k), '#FFFFFF', k); addOff(ctx); }
    } catch (e) { Art._glyphErr = e; }
    ctx.restore();
  }
  var ATTR_COL = { heart: '#FF4D6A', fist: '#FF9A3C', bow: '#5BD16E', boot: '#3EDBC8', star: '#B57BFF', clock: '#FFCB57', sword: '#E8394D', shield: '#4BA3FF',
    scythe: '#B57BFF', staff: '#3EDBC8', skull: '#C9CED8', flame: '#FF7A2F', snow: '#9BE8FF', bolt: '#FFE14D', drop: '#E8394D', eye: '#9D6BFF', crown: '#FFCB57', wing: '#E6EEFF' };
  function drawTalentIcon(ctx, x, y, size, name, color, t) {
    var col = typeof color === 'string' && /^#?[0-9a-f]{3,6}$/i.test(color) ? color : (ATTR_COL[name] || '#FFCB57');
    drawGlyph(ctx, x, y, size, name, col, t);
  }
  function drawAttrIcon(ctx, x, y, size, name, t) { drawGlyph(ctx, x, y, size, name, ATTR_COL[name] || '#FFCB57', t); }

  // ------------------------------------------------------------------------------------------ export (add to GM.Art, never replace it)
  Art.drawHero = drawHero;
  Art.drawItemIcon = drawItemIcon;
  Art.drawHeroPortrait = drawHeroPortrait;
  Art.drawTalentIcon = drawTalentIcon;
  Art.drawAttrIcon = drawAttrIcon;
  Art.heroLook = function (heroId, heroSkin) { return { heroId: heroId || 'bora', heroSkin: heroSkin || null, weapon: null, gear: {} }; };
  Art._stats = function () { return { frames: FCACHE.size, px: FPX, builds: buildLog.length, warmQ: WARMQ.length }; };
  Art.clearHeroCache = function () { FCACHE.clear(); FPX = 0; ICACHE.clear(); IPX = 0; PCACHE.clear(); GCACHE.clear(); RCACHE.clear(); lastLook = null; };
})(window.GM = window.GM || {});
