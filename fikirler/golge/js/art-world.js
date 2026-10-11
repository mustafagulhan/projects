/* GÖLGE MUHAFIZLARI — art-world.js  (owner: art-world)
 * World-side art for GM.Art (SPEC §4.2). Pure procedural Canvas 2D, no assets, no network.
 * Style: cute-creepy dark fantasy — chibi monsters with big glowing eyes, cel shading, #120C18 sticker
 * outline, additive ('lighter') glows for magic / fire / souls. Never overwrites art-hero's functions.
 *
 *  GM.Art.drawEnemy(ctx, e, t)   e = { type, x, y, r, dir, hitT, hpPct, elite, frozen, burning, poisoned, dying, id? }
 *      (x, y) = collision centre. Blits baked sprites (1 drawImage for a normal enemy; flash, ice, flames,
 *      bubbles, squash and dissolve are all baked variants), plus elite aura + crown and rising souls.
 *      Optional e.id (number) desyncs the walk cycle; without it a random phase is stored on e._aw once.
 *      e.moving === false holds the walk cycle on frame 0.
 *      Fast path: when e.r equals ENEMIES[type].r and the canvas transform scale equals the bake scale
 *      (devicePixelRatio capped at 2, camera zoom 1) the blit is pixel-snapped 1:1 (no filtering).
 *  GM.Art.bakeEnemy(type, frames=8|6) -> { frames:[canvas], flash:[canvas], w, h, ox, oy, fps, k, r, n }
 *      Sprites face RIGHT (dir 1), cropped to their content, ground shadow baked in. w/h = canvas px / k.
 *      Draw: ctx.drawImage(frames[i], x - ox, y - oy, w, h); walk cycle i = floor(t * fps) % n.
 *      flash[i] = white hit-flash pose (with squash). Prefer GM.Art.blitEnemy (snapped + pre-mirrored):
 *  GM.Art.blitEnemy(ctx, sprite, i, x, y, dir, flash, t)   cheapest way to draw a baked enemy frame.
 *  GM.Art.warmEnemy(type)        pre-builds the lazy variants (frozen, burn, poison, die) of a type.
 *  GM.Art.setBakeScale(k)        optional: bake at k (= dpr * camera zoom) instead of auto; clears caches.
 *  GM.Art.bake(drawFn, w, h, frames) -> { frames:[canvas], w, h, k }   drawFn(ctx, cx, cy, frameT 0..1) in CSS px.
 *  GM.Art.drawBoss(ctx, b, t)    live vector drawing; phases idle|move|dash|cast|enrage (+castP 0..1), hit flash,
 *      hpPct < .5 shows damage (cracked crown / bones, more molten cracks). (x, y) = collision centre.
 *  GM.Art.drawMetin(ctx, m, t)   (x, y) = base of the obelisk on the ground; ~3.2·r tall. Cracks grow with 1 - hpPct.
 *  GM.Art.ground(theme)          -> 512×512 seamless canvas, cached per theme (orman, mezarlik, kor, kale).
 *  GM.Art.chunkProps(theme, cx, cy, size=512) -> [{ kind, x, y, s, v, f, layer, light?, lx, ly, theme }] sorted by y
 *      Deterministic per (theme, cx, cy). x, y are WORLD coordinates (chunk origin = cx*size, cy*size);
 *      lx, ly = same point local to the chunk. layer 'floor' (flat decal: draw under entities) | 'tall'
 *      (upright: y-sort with entities). light = { r, col, flick } for emitters (torch, brazier, candles,
 *      lantern, lava, crystals, glowing mushrooms, soul fire, ember vents).
 *  GM.Art.drawProp(ctx, p, t)    (p.x, p.y) = base point of the prop on the ground.
 *  GM.Art.drawPickup(ctx, kind, x, y, t)   kinds: xp1 xp2 xp3 gold heal magnet bomb chest   (x, y) = centre on ground
 *  GM.Art.drawSkillIcon(ctx, x, y, size, skillId, t)   (x, y) = TOP-LEFT of the square (same as art-hero icons);
 *      cached per (id, pixel size); evolutions get a gold frame + animated shine when t is given.
 *  GM.Art.fx.*                   see SPEC; each helper restores globalAlpha / composite op; glows are cached sprites.
 *  Extras: GM.Art.soulColor(type), GM.Art.themeColor(theme), GM.Art.clearWorldCache()
 *
 *  Perf (headless Chromium, software raster, 390×844 @2x): 300 enemies via blitEnemy/drawEnemy ≈ 2.5 ms;
 *  the same 300 frames drawn at float positions ≈ 11–13 ms (filtered path) — snap or use blitEnemy.
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
  function eIn(k) { k = clamp(k, 0, 1); return k * k; }
  function seg(p, a, b) { return clamp((p - a) / (b - a), 0, 1); }
  function fract(v) { return v - floor(v); }
  function hstr(s) { var h = 2166136261 >>> 0; s = String(s); for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
  function hashN(n) { n = Math.imul((n | 0) ^ 0x9E3779B9, 0x85EBCA6B); n ^= n >>> 13; n = Math.imul(n, 0xC2B2AE35); n ^= n >>> 16; return (n >>> 0) / 4294967296; }
  function rng(seed) {            // mulberry32 — deterministic
    var a = seed >>> 0;
    return function () { a = (a + 0x6D2B79F5) | 0; var t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }
  function flick(t, s) { return 0.82 + 0.1 * sin(t * 13.1 + s) + 0.08 * sin(t * 23.7 + s * 2.3); }

  // ------------------------------------------------------------------------------------------ colour
  var OUT = '#120C18';
  var RGB = Object.create(null), MIX = Object.create(null), RGBA = Object.create(null);
  function rgb(h) {
    var c = RGB[h]; if (c) return c;
    var m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(h || '').trim());
    if (m) { var s = m[1]; if (s.length === 3) s = s[0] + s[0] + s[1] + s[1] + s[2] + s[2]; var n = parseInt(s, 16); c = [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
    else c = [128, 128, 128];
    RGB[h] = c; return c;
  }
  function hx(r, g, b) { return '#' + ((1 << 24) | (clamp(round(r), 0, 255) << 16) | (clamp(round(g), 0, 255) << 8) | clamp(round(b), 0, 255)).toString(16).slice(1); }
  function mix(a, b, k) {
    var key = a + b + k, v = MIX[key]; if (v) return v;
    var A = rgb(a), B = rgb(b);
    v = hx(A[0] + (B[0] - A[0]) * k, A[1] + (B[1] - A[1]) * k, A[2] + (B[2] - A[2]) * k);
    MIX[key] = v; return v;
  }
  function dk(h, k) { return mix(h, '#140B1E', k); }
  function lt(h, k) { return mix(h, '#FFF7EA', k); }
  function rgba(h, a) {
    a = round(clamp(a, 0, 1) * 100) / 100;
    var key = h + a, v = RGBA[key]; if (v) return v;
    var c = rgb(h); v = 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + a + ')';
    RGBA[key] = v; return v;
  }

  // ------------------------------------------------------------------------------------------ data fallbacks (SPEC values)
  var FB_EN = {
    yarasa: { r: 12 }, kurt: { r: 18 }, mantar: { r: 22 }, iskelet: { r: 16 }, hayalet: { r: 16 }, orumcek: { r: 11 },
    korCini: { r: 13 }, golem: { r: 38, elite: true }, buyucu: { r: 24, elite: true },
    kurtKral: { r: 48, boss: true }, kemikEjder: { r: 56, boss: true }, korIblisi: { r: 54, boss: true }, metin: { r: 34 }
  };
  function enDef(type) { var E = GM.D && GM.D.ENEMIES; return (E && E[type]) || FB_EN[type] || null; }
  var EL_COL = { none: '#C9CED8', ates: '#FF7A2F', buz: '#7FD8FF', yildirim: '#FFE45C', zehir: '#8BE04E', golge: '#9D6BFF' };
  function elCol(el) { var E = GM.D && GM.D.ELEMENTS; return (E && E[el] && E[el].col) || EL_COL[el] || EL_COL.none; }
  var THEME = {
    orman: { col: '#7CFF6B', rune: '#B07CFF', fog: '#2E4A3A' },
    mezarlik: { col: '#7DF5C8', rune: '#5CFFD6', fog: '#55607A' },
    kor: { col: '#FF7A2F', rune: '#FF8A2A', fog: '#5A2418' },
    kale: { col: '#FF3D6E', rune: '#FF4D7A', fog: '#3A2A4A' }
  };
  function th(theme) { return THEME[theme] || THEME.orman; }

  // ------------------------------------------------------------------------------------------ canvas helpers
  var HAS_DOC = typeof document !== 'undefined';
  function mkCv(w, h) {
    var cv = HAS_DOC ? document.createElement('canvas') : null;
    if (!cv) return null;
    cv.width = mx(1, Math.ceil(w)); cv.height = mx(1, Math.ceil(h)); return cv;
  }
  var BAKE_K = 0;      // 0 = auto (devicePixelRatio capped at 2); Art.setBakeScale() overrides
  function bakeK() { if (BAKE_K > 0) return BAKE_K; var d = (typeof window !== 'undefined' && window.devicePixelRatio) || 1; return clamp(d, 1, 2); }
  var GLOW = Object.create(null);
  // radial glow sprite; hot = white-hot core (for fire / magic)
  function glowSpr(col, hot) {
    var key = hot ? col + 'h' : col, cv = GLOW[key]; if (cv) return cv;
    cv = mkCv(64, 64); var g = cv.getContext('2d');
    var gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    if (hot) {
      gr.addColorStop(0, rgba(mix(col, '#FFFFFF', 0.75), 1)); gr.addColorStop(0.16, rgba(mix(col, '#FFFFFF', 0.3), 0.85));
      gr.addColorStop(0.38, rgba(col, 0.38)); gr.addColorStop(0.7, rgba(col, 0.08)); gr.addColorStop(1, rgba(col, 0));
    } else {
      gr.addColorStop(0, rgba(col, 0.95)); gr.addColorStop(0.2, rgba(col, 0.6)); gr.addColorStop(0.45, rgba(col, 0.22));
      gr.addColorStop(0.75, rgba(col, 0.06)); gr.addColorStop(1, rgba(col, 0));
    }
    g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
    GLOW[key] = cv; return cv;
  }
  function glow(c, x, y, rx, ry, col, a, hot) {
    if (!(a > 0.01) || !(rx > 0.2)) return;
    var ga = c.globalAlpha; c.globalAlpha = ga * mn(1, a);
    c.drawImage(glowSpr(col, hot), x - rx, y - ry, rx * 2, ry * 2);
    c.globalAlpha = ga;
  }
  // additive glow that restores the composite op
  function aglow(c, x, y, rx, ry, col, a, hot) {
    var op = c.globalCompositeOperation; c.globalCompositeOperation = 'lighter';
    glow(c, x, y, rx, ry, col, a, hot); c.globalCompositeOperation = op;
  }
  var SHADOW = null;
  function shadowSpr() {
    if (SHADOW) return SHADOW;
    SHADOW = mkCv(64, 32); var g = SHADOW.getContext('2d');
    g.setTransform(1, 0, 0, 0.5, 0, 0);
    var gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, 'rgba(4,2,8,0.62)'); gr.addColorStop(0.55, 'rgba(4,2,8,0.42)'); gr.addColorStop(1, 'rgba(4,2,8,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
    return SHADOW;
  }
  function shadow(c, x, y, rx, ry, a) {
    var ga = c.globalAlpha; if (a != null) c.globalAlpha = ga * a;
    c.drawImage(shadowSpr(), x - rx, y - ry, rx * 2, ry * 2);
    c.globalAlpha = ga;
  }
  // 4-point sparkle
  function spark(c, x, y, r, col, a) {
    if (!(a > 0.02)) return;
    var ga = c.globalAlpha; c.globalAlpha = ga * mn(1, a);
    c.fillStyle = col; c.beginPath();
    c.moveTo(x, y - r); c.quadraticCurveTo(x, y, x + r * 0.75, y); c.quadraticCurveTo(x, y, x, y + r);
    c.quadraticCurveTo(x, y, x - r * 0.75, y); c.quadraticCurveTo(x, y, x, y - r); c.fill();
    c.globalAlpha = ga;
  }
  // paths
  function E(c, x, y, rx, ry, r) { r = r || 0; c.moveTo(x + rx * cos(r), y + rx * sin(r)); c.ellipse(x, y, mx(0.01, rx), mx(0.01, ry), r, 0, TAU); }
  function Ci(c, x, y, r) { c.moveTo(x + r, y); c.arc(x, y, mx(0.01, r), 0, TAU); }
  function RR(c, x, y, w, h, r) {
    r = mn(r, w / 2, h / 2);
    c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r);
    c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath();
  }
  function P(c, pts) { c.moveTo(pts[0], pts[1]); for (var i = 2; i < pts.length; i += 2) c.lineTo(pts[i], pts[i + 1]); c.closePath(); }
  function CAP(c, x1, y1, x2, y2, r1, r2) {
    if (r2 == null) r2 = r1;
    var a = atan2(y2 - y1, x2 - x1);
    c.moveTo(x2 + cos(a - HP) * r2, y2 + sin(a - HP) * r2);
    c.arc(x2, y2, r2, a - HP, a + HP);
    c.arc(x1, y1, r1, a + HP, a + PI + HP);
    c.closePath();
  }
  // cel shading: base + highlight crescent (top-left) + shade crescent (bottom-right) + inner line
  function cel(c, fn, base, shade, hi, so, ho, noLine) {
    c.beginPath(); fn(c); c.fillStyle = base; c.fill();
    if (shade || hi) {
      c.save(); c.clip();
      if (shade) { if (so == null) so = 2.2; c.beginPath(); c.rect(-3000, -3000, 6000, 6000); c.translate(-so, -so * 1.15); fn(c); c.translate(so, so * 1.15); c.fillStyle = shade; c.fill('evenodd'); }
      if (hi) { if (ho == null) ho = 1.3; c.beginPath(); c.rect(-3000, -3000, 6000, 6000); c.translate(ho * 0.8, ho * 1.2); fn(c); c.translate(-ho * 0.8, -ho * 1.2); c.fillStyle = hi; c.fill('evenodd'); }
      c.restore();
    }
    if (!noLine) { c.beginPath(); fn(c); c.stroke(); }
  }
  // union-of-shapes with only an OUTER sticker outline (stroke wide first, then fill + cel shading)
  function blob(c, fn, base, shade, hi, lw, so, ho) {
    if (so == null) so = 2.2; if (ho == null) ho = 1.3;
    c.beginPath(); fn(c); strokeW(c, OUT, (lw || c.lineWidth) * 2);
    c.save(); c.beginPath(); fn(c); c.clip();
    c.fillStyle = shade || base; c.fillRect(-3000, -3000, 6000, 6000);
    c.translate(-so, -so * 1.15); c.beginPath(); fn(c); c.fillStyle = hi || base; c.fill();
    if (hi) { c.translate(ho * 0.8, ho * 1.2); c.beginPath(); fn(c); c.fillStyle = base; c.fill(); }
    c.restore();
  }
  function fl(c, fn, col, noLine) { c.beginPath(); fn(c); c.fillStyle = col; c.fill(); if (!noLine) c.stroke(); }
  function ln(c, x1, y1, x2, y2, col, w) { var s = c.strokeStyle, lw = c.lineWidth; c.beginPath(); c.moveTo(x1, y1); c.lineTo(x2, y2); c.strokeStyle = col; c.lineWidth = w; c.stroke(); c.strokeStyle = s; c.lineWidth = lw; }
  function strokeW(c, col, w) { var s = c.strokeStyle, lw = c.lineWidth; c.strokeStyle = col; c.lineWidth = w; c.stroke(); c.strokeStyle = s; c.lineWidth = lw; }
  // thick curve with a sticker outline (tails, staffs, bones)
  function rope(c, fn, col, w, lw) { c.beginPath(); fn(c); strokeW(c, OUT, w + (lw == null ? 1.2 : lw) * 2); strokeW(c, col, w); }
  function setLine(c, w) { c.lineWidth = w; c.strokeStyle = OUT; c.lineJoin = 'round'; c.lineCap = 'round'; }
  // big glossy eye: white sclera optional, glowing iris, pupil, highlight
  function eye(c, x, y, rx, ry, iris, pupil, opt) {
    opt = opt || {};
    fl(c, function (c) { E(c, x, y, rx, ry); }, opt.white || OUT, !!opt.noLine);
    if (iris) {
      var ix = x + (opt.lx || 0) * rx * 0.25, iy = y + (opt.ly || 0) * ry * 0.2;
      fl(c, function (c) { E(c, ix, iy, rx * (opt.ir || 0.78), ry * (opt.ir || 0.8)); }, iris, true);
      fl(c, function (c) { E(c, ix, iy + ry * 0.25, rx * (opt.ir || 0.78) * 0.85, ry * 0.45); }, lt(iris, 0.35), true);
      if (pupil) fl(c, function (c) { opt.slit ? E(c, ix + rx * 0.08, iy, rx * 0.16, ry * 0.62) : E(c, ix + rx * 0.08, iy, rx * 0.36, ry * 0.4); }, pupil, true);
    }
    fl(c, function (c) { Ci(c, x - rx * 0.3, y - ry * 0.38, mx(rx, ry) * 0.27); }, '#FFFFFF', true);
    fl(c, function (c) { Ci(c, x + rx * 0.32, y + ry * 0.3, mx(rx, ry) * 0.12); }, 'rgba(255,255,255,0.8)', true);
  }

  // ==========================================================================================
  // BAKE — generic sprite cache helper
  // ==========================================================================================
  Art.bake = function (drawFn, w, h, frames) {
    frames = mx(1, frames | 0 || 1);
    var k = bakeK(), out = [];
    for (var i = 0; i < frames; i++) {
      var cv = mkCv(w * k, h * k); if (!cv) break;
      var g = cv.getContext('2d'); g.setTransform(k, 0, 0, k, 0, 0);
      try { drawFn(g, w / 2, h / 2, i / frames); } catch (err) { if (typeof console !== 'undefined') console.error('[GM.Art.bake]', err); }
      out.push(cv);
    }
    // w, h = exact CSS size of the canvases (px / k), so a 1:1 blit can hit the fast path
    return { frames: out, w: out.length ? out[0].width / k : w, h: out.length ? out[0].height / k : h, k: k };
  };

  // ==========================================================================================
  // ENEMIES — designed at r = 16 "design units"; (0,0) = collision centre, facing right.
  //   body(c, f) draws solids (gets a sticker outline), glow(c, f) draws emissive extras after the outline.
  //   bx/ty/by = sprite extents (design units), sh = shadow y / rx, top = crown anchor, soul = death colour.
  // ==========================================================================================
  var ED = Object.create(null);

  // ---------- Kan Yarasası: red bat, flapping
  function batWing(c, s, bob, k) {
    var ak = abs(k);
    var sx = s * 4.5, sy = bob - 3;
    var ex = s * (13.5 - ak * 1.5), ey = bob - 9 - k * 7.5;
    var tx = s * (24 - ak * 5), ty = bob - 3 - k * 13;
    var f1x = s * (19 - ak * 3), f1y = bob + 5 - k * 8;
    var f2x = s * (11.5 - ak), f2y = bob + 7.5 - k * 3.5;
    var bx = s * 4.5, by = bob + 4;
    c.moveTo(sx, sy);
    c.quadraticCurveTo(s * 8, ey - 2.5, ex, ey);
    c.lineTo(tx, ty);
    c.quadraticCurveTo(lerp(tx, f1x, 0.5) + (ex - lerp(tx, f1x, 0.5)) * 0.3, lerp(ty, f1y, 0.5) + (ey - lerp(ty, f1y, 0.5)) * 0.3, f1x, f1y);
    c.quadraticCurveTo(lerp(f1x, f2x, 0.5) + (ex - lerp(f1x, f2x, 0.5)) * 0.3, lerp(f1y, f2y, 0.5) + (ey - lerp(f1y, f2y, 0.5)) * 0.3, f2x, f2y);
    c.quadraticCurveTo(lerp(f2x, bx, 0.5) + (ex - lerp(f2x, bx, 0.5)) * 0.25, lerp(f2y, by, 0.5) + (ey - lerp(f2y, by, 0.5)) * 0.25, bx, by);
    c.closePath();
    return [ex, ey, tx, ty, f1x, f1y, f2x, f2y];
  }
  ED.yarasa = {
    bx: 27, ty: -31, by: 18, sh: [15, 9], top: -20, fps: 16, n: 8, fly: true, soul: '#FF5A6E',
    body: function (c, f) {
      var a = f * TAU, k = cos(a), bob = -8 - sin(a) * 2.4;
      var B = '#C2304A', S = '#7A1630', H = '#F06A84', W = '#5E1734', WS = '#3A0C22';
      for (var s = -1; s <= 1; s += 2) {
        var j;
        c.beginPath(); j = batWing(c, s, bob, k); c.fillStyle = W; c.fill(); c.stroke();
        // membrane sheen near the arm
        c.save(); c.beginPath(); batWing(c, s, bob, k); c.clip();
        c.beginPath(); c.moveTo(s * 4, bob - 3); c.lineTo(j[0], j[1]); c.lineTo(j[2], j[3]); c.lineTo(j[4] * 0.92, j[5] - 2); c.closePath(); c.fillStyle = '#7E2244'; c.fill();
        c.restore();
        // finger bones
        ln(c, j[0], j[1], j[4], j[5], WS, 1.1); ln(c, j[0], j[1], j[6], j[7], WS, 1.1);
        ln(c, s * 4, bob - 3, j[0], j[1], '#2A0718', 1.6); ln(c, j[0], j[1], j[2], j[3], '#2A0718', 1.4);
      }
      // ears
      for (s = -1; s <= 1; s += 2) {
        cel(c, function (c) { P(c, [s * 2.2 + 0.6, bob - 6, s * 8 + 0.6, bob - 16.5, s * 7.6 + 0.6, bob - 4.5]); }, B, S, H, 1.2, 0.8);
        fl(c, function (c) { P(c, [s * 4 + 0.6, bob - 7, s * 7.1 + 0.6, bob - 13.5, s * 6.6 + 0.6, bob - 6]); }, '#FF8FA6', true);
      }
      // fuzzy body
      cel(c, function (c) {
        E(c, 0.5, bob, 8.6, 8);
        for (var i = 0; i < 5; i++) { var ang = 0.55 + i * 0.5; c.moveTo(0.5 + cos(ang) * 7.6, bob + sin(ang) * 7.2); c.lineTo(0.5 + cos(ang + 0.2) * 10, bob + sin(ang + 0.2) * 9.6); c.lineTo(0.5 + cos(ang + 0.42) * 7.6, bob + sin(ang + 0.42) * 7.2); }
      }, B, S, H, 2.4, 1.4);
      // belly
      fl(c, function (c) { E(c, 1.4, bob + 3.4, 4.6, 3.6); }, '#E25A72', true);
      // little feet
      fl(c, function (c) { E(c, -1.8, bob + 8.3, 1.4, 1.8); E(c, 3.2, bob + 8.3, 1.4, 1.8); }, '#3A0C22');
      // eyes (big, glowing gold)
      eye(c, -2.1, bob - 1.2, 3.1, 3.6, '#FFC93A', '#2A0A10', { lx: 0.6, slit: true });
      eye(c, 4.4, bob - 1.2, 3.1, 3.6, '#FFC93A', '#2A0A10', { lx: 0.6, slit: true });
      // brows (mean little V)
      ln(c, -4.4, bob - 5.6, -0.6, bob - 4.2, OUT, 1.3); ln(c, 6.8, bob - 5.6, 3.0, bob - 4.2, OUT, 1.3);
      // mouth + fangs
      c.beginPath(); c.moveTo(-0.6, bob + 3.3); c.quadraticCurveTo(1.2, bob + 4.6, 3.2, bob + 3.3); strokeW(c, OUT, 1.1);
      fl(c, function (c) { P(c, [-0.2, bob + 3.6, 0.5, bob + 5.8, 1.0, bob + 3.9]); P(c, [2.0, bob + 3.9, 2.6, bob + 5.8, 3.1, bob + 3.6]); }, '#FFFFFF', true);
    },
    glow: function (c, f) {
      var bob = -8 - sin(f * TAU) * 2.4;
      c.globalCompositeOperation = 'lighter';
      glow(c, -2.1, bob - 1.2, 5.5, 5.5, '#FFB020', 0.55); glow(c, 4.4, bob - 1.2, 5.5, 5.5, '#FFB020', 0.55);
      c.globalCompositeOperation = 'source-over';
    }
  };

  // ---------- Gölge Kurdu: shadow wolf with ember eyes, trotting
  ED.kurt = {
    bx: 29, ty: -30, by: 17, sh: [14, 15], top: -27, topX: 10, fps: 13, n: 8, soul: '#A08CFF',
    body: function (c, f) {
      var a = f * TAU, bob = -abs(sin(a)) * 1.6, nod = sin(a * 2) * 0.6;
      var B = '#4C4669', S = '#2B2642', H = '#77709C', BEL = '#9C95C2', D = '#1E1A2E';
      function leg(x, ph, near) {
        var sw = sin(a + ph), lift = mx(0, -cos(a + ph)) * 3.2;
        var fx = x + sw * 3.6, fy = 12.2 - lift;
        cel(c, function (c) { CAP(c, x, bob + 1, fx, fy - 1.2, 3.1, 2.3); }, near ? B : S, near ? S : D, near ? H : null, 1.4, 0.7);
        cel(c, function (c) { E(c, fx + 1, fy, 3, 2); }, near ? '#5E577F' : '#3A3454', D, null, 0.8);
      }
      // far legs
      leg(-9.5, PI, false); leg(6.5, 0, false);
      // tail (bushy, swishing)
      var tw = sin(a) * 2.2;
      cel(c, function (c) {
        c.moveTo(-12, bob - 3);
        c.quadraticCurveTo(-20, bob - 3 + tw * 0.3, -24.5, bob - 11 + tw);
        c.quadraticCurveTo(-22, bob - 13.5 + tw, -21.5, bob - 11 + tw * 0.8);
        c.quadraticCurveTo(-19, bob - 15 + tw, -17.5, bob - 10.5 + tw * 0.6);
        c.quadraticCurveTo(-15, bob - 9, -11, bob - 7.5); c.closePath();
      }, B, S, H, 1.8, 1);
      // body
      cel(c, function (c) { E(c, -2, bob - 1.5, 13.2, 7.6, -0.04); }, B, S, H, 2.8, 1.6);
      // back fur spikes
      cel(c, function (c) { P(c, [-8, bob - 8, -6, bob - 11.5, -4, bob - 8.6, -2, bob - 12, 0, bob - 8.8, 2, bob - 11.2, 4, bob - 8.2]); }, B, S, null, 1.2);
      // belly / chest fluff
      fl(c, function (c) { c.moveTo(-7, bob + 4.5); c.quadraticCurveTo(0, bob + 7.4, 7, bob + 4.2); c.lineTo(9.5, bob + 1); c.lineTo(5, bob + 3.2); c.quadraticCurveTo(-1, bob + 4.2, -7, bob + 4.5); }, BEL, true);
      // near legs
      leg(-12, 0, true); leg(4.5, PI, true);
      // head group
      var hy = bob - 9 + nod, hx = 11;
      // back ear
      cel(c, function (c) { P(c, [hx - 5.5, hy - 4, hx - 5, hy - 13.2, hx - 1, hy - 6]); }, S, D, null, 1);
      // cheek ruff
      cel(c, function (c) { P(c, [hx - 7.5, hy + 1, hx - 9.8, hy - 2.5, hx - 7, hy - 3.5, hx - 9.5, hy - 6, hx - 5, hy - 6, hx - 3, hy + 3]); }, H, B, null, 1.1);
      cel(c, function (c) { Ci(c, hx, hy, 7.6); }, B, S, H, 2.4, 1.3);
      // snout
      cel(c, function (c) { c.moveTo(hx + 2, hy - 2.6); c.quadraticCurveTo(hx + 9, hy - 3.6, hx + 10.4, hy + 0.4); c.quadraticCurveTo(hx + 10, hy + 3.6, hx + 4.5, hy + 3.8); c.quadraticCurveTo(hx + 1.5, hy + 3.5, hx + 1.4, hy + 1); c.closePath(); }, '#8D86B4', '#4C4669', '#B3ADD6', 1.3, 0.8);
      fl(c, function (c) { E(c, hx + 10.2, hy - 1.4, 1.9, 1.5); }, OUT, true);
      fl(c, function (c) { Ci(c, hx + 9.7, hy - 1.9, 0.6); }, '#8D86B4', true);
      // mouth + fang
      c.beginPath(); c.moveTo(hx + 4, hy + 2.2); c.quadraticCurveTo(hx + 7, hy + 3.2, hx + 9.4, hy + 1.6); strokeW(c, OUT, 1);
      fl(c, function (c) { P(c, [hx + 5.6, hy + 2.6, hx + 6.3, hy + 5.2, hx + 7, hy + 2.7]); }, '#FFFFFF');
      // front ear
      cel(c, function (c) { P(c, [hx - 2.6, hy - 5.2, hx - 0.6, hy - 15, hx + 3.4, hy - 6.4]); }, B, S, H, 1.1, 0.7);
      fl(c, function (c) { P(c, [hx - 1.4, hy - 6.4, hx - 0.4, hy - 12.3, hx + 1.8, hy - 6.8]); }, '#2A1F3C', true);
      // glowing ember eye with angry brow
      eye(c, hx + 2.8, hy - 1.6, 2.6, 2.9, '#FF7A2F', '#3A0A00', { lx: 0.7, slit: true });
      ln(c, hx - 0.4, hy - 5.3, hx + 5.6, hy - 3.6, OUT, 1.5);
    },
    glow: function (c, f) {
      var a = f * TAU, bob = -abs(sin(a)) * 1.6, nod = sin(a * 2) * 0.6, hy = bob - 9 + nod;
      c.globalCompositeOperation = 'lighter';
      glow(c, 13.8, hy - 1.6, 6.5, 5.5, '#FF6A1F', 0.75);
      // smoky shadow wisps trailing from the back
      for (var i = 0; i < 3; i++) {
        var p = fract(f + i / 3), wx = -10 - p * 13 + i * 3, wy = bob - 9 - p * 7 - i;
        glow(c, wx, wy, 4 + p * 3, 4 + p * 3, '#7A5CFF', 0.35 * (1 - p));
      }
      c.globalCompositeOperation = 'source-over';
    }
  };

  // ---------- Zehirli Mantar: toxic mushroom, sleepy face, waddle
  ED.mantar = {
    bx: 22, ty: -31, by: 17, sh: [14, 13], top: -29, fps: 9, n: 8, soul: '#9BFF6A',
    body: function (c, f) {
      var a = f * TAU, rock = sin(a) * 0.07, hop = abs(sin(a)), sq = 1 - hop * 0.05;
      c.save(); c.translate(0, 13); c.rotate(rock); c.scale(1 + (1 - sq) * 0.6, sq); c.translate(0, -13 - hop * 1.4);
      var C = '#8E3FB0', CS = '#55206E', CH = '#C47BE6', ST = '#EADFCB', STS = '#B9A68E', STH = '#FFF8EC';
      // feet
      var st = sin(a);
      cel(c, function (c) { E(c, -5 + st * 0.8, 12 - mx(0, st) * 1.6, 3.8, 2.4); }, '#D8C8AE', '#9E8A6E', null, 1);
      cel(c, function (c) { E(c, 5 + st * 0.8, 12 - mx(0, -st) * 1.6, 3.8, 2.4); }, '#D8C8AE', '#9E8A6E', null, 1);
      // stem body
      cel(c, function (c) { c.moveTo(-8.5, -6); c.bezierCurveTo(-12.5, 2, -11, 11.5, 0, 11.5); c.bezierCurveTo(11, 11.5, 12.5, 2, 8.5, -6); c.closePath(); }, ST, STS, STH, 2.6, 1.4);
      // sleepy face
      eye(c, -3.8, 1.6, 2.6, 2.4, '#B6FF5A', '#163006', { lx: 0.5 });
      eye(c, 4.6, 1.6, 2.6, 2.4, '#B6FF5A', '#163006', { lx: 0.5 });
      // heavy lids (sleepy)
      fl(c, function (c) { c.moveTo(-6.6, 1.4); c.quadraticCurveTo(-3.8, -2.6, -1.0, 1.4); c.quadraticCurveTo(-3.8, 0.4, -6.6, 1.4); }, STS);
      fl(c, function (c) { c.moveTo(1.8, 1.4); c.quadraticCurveTo(4.6, -2.6, 7.4, 1.4); c.quadraticCurveTo(4.6, 0.4, 1.8, 1.4); }, STS);
      // cheeks + mouth + drool
      fl(c, function (c) { E(c, -6.4, 4.4, 1.8, 1.1); E(c, 7.2, 4.4, 1.8, 1.1); }, 'rgba(255,120,150,0.55)', true);
      fl(c, function (c) { E(c, 0.8, 5.6, 1.5, 1.2); }, '#4A1A2A');
      fl(c, function (c) { c.moveTo(2, 6); c.quadraticCurveTo(2.6, 8.6, 2.2, 9.4); c.arc(2.2, 9.4, 0.9, 0, PI); c.quadraticCurveTo(1.4, 8, 1.6, 6.2); }, '#9BFF6A');
      // gills (dark under-cap)
      fl(c, function (c) { E(c, 0, -6.6, 14, 3.4); }, '#3B1A4A');
      // cap
      cel(c, function (c) { c.moveTo(-16.5, -6.5); c.bezierCurveTo(-17.5, -21, -8, -27.5, 0, -27.5); c.bezierCurveTo(8, -27.5, 17.5, -21, 16.5, -6.5); c.quadraticCurveTo(8, -3.2, 0, -4.6); c.quadraticCurveTo(-8, -3.2, -16.5, -6.5); c.closePath(); }, C, CS, CH, 3.2, 1.8);
      // spots
      var spots = [[-8, -15, 3.4], [2, -21.5, 3], [9.5, -13, 2.6], [-1.5, -11, 2.1], [12.5, -19, 1.5], [-12.5, -9.5, 1.6]];
      for (var i = 0; i < spots.length; i++) {
        var sp = spots[i];
        cel(c, function (c) { E(c, sp[0], sp[1], sp[2], sp[2] * 0.85); }, '#D6FF8A', '#8FD14A', '#F6FFD8', 0.7, 0.5);
      }
      c.restore();
    },
    glow: function (c, f) {
      var a = f * TAU, hop = abs(sin(a));
      c.globalCompositeOperation = 'lighter';
      glow(c, 0, -6 - hop, 15, 5, '#7CFF4A', 0.35);
      glow(c, -8, -15 - hop, 5, 5, '#B6FF5A', 0.35); glow(c, 2, -21.5 - hop, 4.5, 4.5, '#B6FF5A', 0.3);
      // floating spores
      for (var i = 0; i < 4; i++) {
        var p = fract(f + i * 0.25), sx = sin(i * 2.1 + p * 4) * 13, sy = -10 - p * 20;
        glow(c, sx, sy, 2.2, 2.2, '#B6FF5A', 0.9 * sin(p * PI));
      }
      c.globalCompositeOperation = 'source-over';
    }
  };

  // ---------- İskelet Er: skeleton soldier with a little shield
  ED.iskelet = {
    bx: 20, ty: -31, by: 17, sh: [14, 11], top: -29, topX: 1, fps: 11, n: 8, soul: '#7FE8FF',
    body: function (c, f) {
      var a = f * TAU, bob = -abs(sin(a)) * 1.3;
      var BN = '#ECE4CF', BS = '#A99C80', BH = '#FFFBEF', IR = '#7E8796', IRS = '#4A5160';
      function leg(x, ph, near) {
        var sw = sin(a + ph), lift = mx(0, -cos(a + ph)) * 2.6;
        var kx = x + sw * 1.8 + 1, ky = 7 + bob - lift * 0.5, fx = x + sw * 3.2, fy = 12.4 - lift;
        var col = near ? BN : BS;
        rope(c, function (c) { c.moveTo(x, 2.5 + bob); c.lineTo(kx, ky); c.lineTo(fx, fy - 1); }, col, 2, 0.9);
        cel(c, function (c) { E(c, kx, ky, 1.5, 1.4); }, col, BS, null, 0.6);
        cel(c, function (c) { E(c, fx + 1.2, fy, 2.6, 1.5); }, col, BS, null, 0.7);
      }
      leg(-2.5, PI, false);
      // back arm with rusty sword
      var sw2 = sin(a + PI) * 0.35;
      var shx = -3, shy = -7 + bob, hx = shx - 4 + sin(a + PI) * 2.5, hy = shy + 7;
      c.save(); c.translate(hx, hy); c.rotate(-0.9 + sw2);
      cel(c, function (c) { P(c, [-1.1, 0, 1.1, 0, 1.0, -12, 0, -14.5, -1.0, -12]); }, '#9DA6B5', '#5E6574', '#E4EAF2', 0.9, 0.5);
      fl(c, function (c) { RR(c, -3.2, -0.6, 6.4, 1.6, 0.8); }, '#6B4A2A');
      fl(c, function (c) { RR(c, -0.8, 0.8, 1.6, 3.6, 0.8); }, '#4A3220');
      fl(c, function (c) { E(c, 0.2, -6.5, 0.8, 1.8); }, 'rgba(160,80,40,0.55)', true);
      c.restore();
      rope(c, function (c) { c.moveTo(shx, shy); c.lineTo(hx + 0.4, hy - 3.4); c.lineTo(hx, hy); }, BS, 1.8, 0.9);
      // pelvis + spine
      cel(c, function (c) { c.moveTo(-4, 1 + bob); c.quadraticCurveTo(0, -0.5 + bob, 4, 1 + bob); c.lineTo(3, 4 + bob); c.quadraticCurveTo(0, 2.6 + bob, -3, 4 + bob); c.closePath(); }, BN, BS, null, 1);
      rope(c, function (c) { c.moveTo(0, 1 + bob); c.lineTo(0, -6 + bob); }, BN, 2, 0.9);
      // ribcage
      cel(c, function (c) { E(c, 0.6, -6.2 + bob, 5.6, 4.9); }, BN, BS, BH, 1.6, 0.8);
      for (var i = 0; i < 3; i++) {
        var ry = -8.2 + i * 2.2 + bob;
        c.beginPath(); c.moveTo(-3.8 + i * 0.4, ry); c.quadraticCurveTo(0.6, ry + 1.4, 5 - i * 0.4, ry); strokeW(c, '#3A2E2E', 1);
      }
      leg(1.8, 0, true);
      // skull (big)
      var sy = -17 + bob + sin(a * 2) * 0.4;
      cel(c, function (c) { c.moveTo(-6.2, sy + 1.5); c.bezierCurveTo(-7.4, sy - 9.5, 8.6, sy - 10.5, 8.2, sy + 1); c.quadraticCurveTo(8, sy + 4.5, 5, sy + 5); c.lineTo(-3.5, sy + 5); c.quadraticCurveTo(-6.4, sy + 4.4, -6.2, sy + 1.5); c.closePath(); }, BN, BS, BH, 2, 1.2);
      // jaw + teeth (chattering)
      var jaw = mx(0, sin(a * 2)) * 1.1;
      cel(c, function (c) { RR(c, -2.4, sy + 4.2 + jaw, 8.4, 3.4, 1.4); }, BN, BS, null, 0.8);
      for (i = 0; i < 4; i++) ln(c, -0.6 + i * 1.8, sy + 4.4 + jaw, -0.6 + i * 1.8, sy + 6 + jaw, '#3A2E2E', 0.7);
      // eye sockets
      fl(c, function (c) { E(c, -1.6, sy - 0.6, 2.4, 2.8); E(c, 4.6, sy - 0.6, 2.4, 2.8); }, '#1A1018', true);
      fl(c, function (c) { Ci(c, -1.2, sy - 0.4, 1.15); Ci(c, 5.0, sy - 0.4, 1.15); }, '#FF5A6A', true);
      fl(c, function (c) { Ci(c, -1.5, sy - 0.8, 0.45); Ci(c, 4.7, sy - 0.8, 0.45); }, '#FFFFFF', true);
      fl(c, function (c) { P(c, [1.4, sy + 1.6, 2.2, sy + 3.2, 0.6, sy + 3.2]); }, '#1A1018', true);
      ln(c, 6.4, sy - 6.4, 4.6, sy - 3.4, '#8A7C62', 0.8);
      // dented helmet
      cel(c, function (c) { c.moveTo(-7.4, sy - 3.4); c.bezierCurveTo(-7.2, sy - 12, 8.4, sy - 12.6, 8.8, sy - 4); c.lineTo(-7.4, sy - 3.4); c.closePath(); }, IR, IRS, '#B8C0CC', 1.4, 0.8);
      fl(c, function (c) { RR(c, -8.2, sy - 4.6, 17.6, 2.2, 1); }, '#5B6372');
      fl(c, function (c) { Ci(c, 0.6, sy - 10.6, 1.2); }, '#B8C0CC');
      // round shield (near arm)
      var shY = -4 + bob + sin(a) * 0.6;
      cel(c, function (c) { Ci(c, 6.4, shY, 6.4); }, '#7A4E2C', '#4A2C16', '#A8754A', 1.6, 0.9);
      c.beginPath(); Ci(c, 6.4, shY, 5.1); strokeW(c, '#9AA2B0', 1.5);
      ln(c, 6.4, shY - 5, 6.4, shY + 5, '#4A2C16', 0.8);
      cel(c, function (c) { Ci(c, 6.4, shY, 1.8); }, '#C9CED8', '#7E8796', '#FFFFFF', 0.6, 0.4);
      fl(c, function (c) { P(c, [3.2, shY - 3.4, 4.4, shY - 1, 2.6, shY - 0.6]); }, '#C2304A', true);
    },
    glow: function (c, f) {
      var a = f * TAU, bob = -abs(sin(a)) * 1.3, sy = -17 + bob + sin(a * 2) * 0.4;
      c.globalCompositeOperation = 'lighter';
      glow(c, -1.2, sy - 0.4, 3.6, 3.6, '#FF3D4F', 0.8); glow(c, 5.0, sy - 0.4, 3.6, 3.6, '#FF3D4F', 0.8);
      c.globalCompositeOperation = 'source-over';
    }
  };

  // ---------- Ağlayan Hayalet: weeping ghost, translucent tail (tail is drawn in the glow pass: no outline)
  ED.hayalet = {
    bx: 18, ty: -32, by: 18, sh: [15, 8], top: -28, fps: 10, n: 8, fly: true, soul: '#7DF5C8',
    body: function (c, f) {
      var a = f * TAU, bob = -6 + sin(a) * 2, sw = sin(a + 1) * 1.6;
      var B = '#C6FFEA', S = '#6FD8B5', H = '#FFFFFF';
      // little arms covering the face (weeping)
      cel(c, function (c) { c.moveTo(-10.5, bob - 2); c.quadraticCurveTo(-15, bob - 3 + sw, -12.5, bob - 7.5 + sw); c.quadraticCurveTo(-10, bob - 6, -8.4, bob - 5); c.closePath(); }, B, S, null, 1);
      // head + short skirt (wavy lower edge)
      cel(c, function (c) {
        c.moveTo(-11.2, bob + 4);
        c.bezierCurveTo(-12.4, bob - 9, -7, bob - 19.5, 0.5, bob - 19.5);
        c.bezierCurveTo(8, bob - 19.5, 13.2, bob - 9, 11.8, bob + 4);
        c.quadraticCurveTo(9.5, bob + 7 + sw, 6.5, bob + 4.6);
        c.quadraticCurveTo(3.4, bob + 7.4 - sw, 0.4, bob + 4.6);
        c.quadraticCurveTo(-2.8, bob + 7.4 + sw, -5.6, bob + 4.6);
        c.quadraticCurveTo(-8.4, bob + 7.2 - sw, -11.2, bob + 4); c.closePath();
      }, B, S, H, 3, 1.5);
      // sad eyes
      eye(c, -3.6, bob - 9, 3.1, 3.9, '#1E5A58', '#0A1A1E', { lx: 0.4, ly: 0.4, ir: 0.86 });
      eye(c, 5.0, bob - 9, 3.1, 3.9, '#1E5A58', '#0A1A1E', { lx: 0.4, ly: 0.4, ir: 0.86 });
      // sad brows (inner ends raised)
      ln(c, -6.6, bob - 13.2, -1.6, bob - 14.8, OUT, 1.2); ln(c, 8.2, bob - 13.2, 3.0, bob - 14.8, OUT, 1.2);
      // wailing mouth
      fl(c, function (c) { c.moveTo(-0.8, bob - 1.4); c.quadraticCurveTo(0.8, bob - 4.6, 2.6, bob - 1.4); c.quadraticCurveTo(2.6, bob + 2.2, 0.9, bob + 2.2); c.quadraticCurveTo(-0.8, bob + 2.2, -0.8, bob - 1.4); }, '#14322E');
      fl(c, function (c) { E(c, 0.9, bob + 1, 1.1, 0.7); }, '#E86A8A', true);
      // blush
      fl(c, function (c) { E(c, -6.6, bob - 4.2, 1.8, 1); E(c, 8.4, bob - 4.2, 1.8, 1); }, 'rgba(120,200,255,0.6)', true);
      // front arm
      cel(c, function (c) { c.moveTo(10.8, bob - 1); c.quadraticCurveTo(16, bob - 2 - sw, 13.4, bob - 7 - sw); c.quadraticCurveTo(10.8, bob - 5.4, 9.2, bob - 4.6); c.closePath(); }, B, S, null, 1);
    },
    glow: function (c, f) {
      var a = f * TAU, bob = -6 + sin(a) * 2;
      // translucent wavy tail (no outline)
      var g = c.createLinearGradient(0, bob + 2, 0, bob + 21);
      g.addColorStop(0, 'rgba(180,255,230,0.78)'); g.addColorStop(0.55, 'rgba(110,230,190,0.32)'); g.addColorStop(1, 'rgba(90,220,180,0)');
      c.fillStyle = g; c.beginPath();
      var w1 = sin(a * 1 + 0.6) * 3, w2 = sin(a + 2.2) * 4;
      c.moveTo(-10.6, bob + 4.4);
      c.bezierCurveTo(-9.5 + w1, bob + 11, -4 + w2, bob + 15, -3 + w2 * 1.2, bob + 21);
      c.bezierCurveTo(2 + w2, bob + 16, 9 + w1, bob + 11, 11.2, bob + 4.4);
      c.closePath(); c.fill();
      c.globalCompositeOperation = 'lighter';
      glow(c, 0.5, bob - 6, 17, 17, '#3EDBC8', 0.32);
      // tears: streams + falling drops
      for (var s = 0; s < 2; s++) {
        var ex = s ? 5.4 : -3.2;
        var p = fract(f * 2 + s * 0.5);
        c.fillStyle = 'rgba(190,240,255,0.85)';
        c.beginPath(); c.moveTo(ex - 0.6, bob - 6); c.quadraticCurveTo(ex - 1.2, bob - 3, ex - 0.4, bob - 1); c.lineTo(ex + 0.5, bob - 1.2); c.quadraticCurveTo(ex + 0.2, bob - 3, ex + 0.6, bob - 6); c.fill();
        var dy = bob - 1 + p * 9;
        c.beginPath(); c.arc(ex, dy, 0.95 * (1 - p * 0.4), 0, TAU); c.fill();
        glow(c, ex, dy, 2.4, 2.4, '#8FE8FF', 0.6 * (1 - p));
      }
      c.globalCompositeOperation = 'source-over';
    }
  };

  // ---------- Mağara Örümceği: cave spider, many eyes, scuttling (front 3/4 view, looking right)
  ED.orumcek = {
    bx: 24, ty: -27, by: 18, sh: [14, 15], top: -20, topX: 1, fps: 16, n: 8, soul: '#D07BFF',
    body: function (c, f) {
      var a = f * TAU, bob = -abs(sin(a * 2)) * 0.9;
      var B = '#4A2C5E', S = '#27143A', H = '#7A4E96', L = '#6A4486', LS = '#3A2050';
      function legs(far) {
        for (var s = -1; s <= 1; s += 2) {
          for (var i = 0; i < 4; i++) {
            if ((i === 0 || i === 3) !== far) continue;     // outer pairs behind, inner pairs in front
            var ph = a + i * HP + (s > 0 ? PI : 0), lift = mx(0, sin(ph)) * 3.2, sw = cos(ph) * 1.6;
            var hx = s * (2.5 + i * 0.6), hy = -3 + bob;
            var kx = s * (9 + i * 2.6), ky = -12 + abs(i - 1.5) * 2.2 - lift * 0.7 + bob;
            var fx = s * (11.5 + i * 3.4) + sw, fy = 11.5 - lift;
            rope(c, function (c) { c.moveTo(hx, hy); c.quadraticCurveTo(kx - s * 2, ky - 1.5, kx, ky); c.quadraticCurveTo(kx + s * 1.5, ky + 4, fx, fy); }, far ? LS : L, far ? 2.2 : 2.6, 1);
            fl(c, function (c) { Ci(c, kx, ky, far ? 1.3 : 1.6); }, far ? '#5A3876' : '#A47AC4', true);
            fl(c, function (c) { Ci(c, fx, fy, 1); }, '#1A0E26', true);
          }
        }
      }
      legs(true);
      // abdomen (behind, fuzzy)
      cel(c, function (c) {
        E(c, -2.5, -8 + bob, 10, 8.4);
        for (var i = 0; i < 9; i++) { var ang = -3.0 + i * 0.36; c.moveTo(-2.5 + cos(ang) * 9.4, -8 + bob + sin(ang) * 7.8); c.lineTo(-2.5 + cos(ang + 0.18) * 11.4, -8 + bob + sin(ang + 0.18) * 9.6); c.lineTo(-2.5 + cos(ang + 0.36) * 9.4, -8 + bob + sin(ang + 0.36) * 7.8); }
      }, B, S, H, 2.6, 1.5);
      // glowing chevrons on the abdomen
      c.beginPath(); c.moveTo(-8, -12.5 + bob); c.lineTo(-2.5, -9.8 + bob); c.lineTo(3, -12.5 + bob); c.moveTo(-7, -9 + bob); c.lineTo(-2.5, -6.6 + bob); c.lineTo(2, -9 + bob);
      strokeW(c, '#FF4A8A', 1.6);
      legs(false);
      // head
      cel(c, function (c) { E(c, 1.5, 0.5 + bob, 7.6, 6.4); }, H, B, '#A47AC4', 1.8, 1.1);
      // fangs
      cel(c, function (c) { c.moveTo(-0.6, 5.2 + bob); c.quadraticCurveTo(-0.4, 8.8 + bob, 0.8, 9.4 + bob); c.quadraticCurveTo(1.2, 7.6 + bob, 1.6, 5.4 + bob); c.closePath(); c.moveTo(3.6, 5.4 + bob); c.quadraticCurveTo(3.8, 8.8 + bob, 5, 9.4 + bob); c.quadraticCurveTo(5.4, 7.6 + bob, 5.8, 5.2 + bob); c.closePath(); }, '#F2E6FA', '#A890B8', null, 0.6);
      // eyes: 2 big + 4 small above
      eye(c, -1.4, 0.2 + bob, 2.5, 2.8, '#FF3D4F', '#2A0008', { lx: 0.7 });
      eye(c, 4.6, 0.2 + bob, 2.5, 2.8, '#FF3D4F', '#2A0008', { lx: 0.7 });
      var sm4 = [[-3.2, -4.0, 1.1], [0.2, -4.8, 1.25], [3.6, -4.8, 1.25], [6.6, -3.8, 1.1]];
      for (var i = 0; i < 4; i++) {
        fl(c, function (c) { Ci(c, sm4[i][0], sm4[i][1] + bob, sm4[i][2]); }, '#FF6A7A');
        fl(c, function (c) { Ci(c, sm4[i][0] - 0.3, sm4[i][1] - 0.35 + bob, 0.4); }, '#FFFFFF', true);
      }
    },
    glow: function (c, f) {
      var a = f * TAU, bob = -abs(sin(a * 2)) * 0.9;
      c.globalCompositeOperation = 'lighter';
      glow(c, -2.5, -10 + bob, 8, 6, '#FF3D8A', 0.5);
      glow(c, 1.6, -0.5 + bob, 9, 6, '#FF3D4F', 0.45);
      c.globalCompositeOperation = 'source-over';
    }
  };

  // ---------- Kor Cini: fire imp with flame hair, hopping
  function impFlame(c, x, y, s, f, i) {
    var w = sin(f * TAU * 2 + i * 1.7) * 1.4;
    c.moveTo(x - 2.6 * s, y);
    c.quadraticCurveTo(x - 2.8 * s, y - 4 * s, x + w * 0.6, y - (7.5 + sin(f * TAU * 3 + i) * 1.6) * s);
    c.quadraticCurveTo(x + 2.8 * s, y - 4 * s, x + 2.6 * s, y);
    c.closePath();
  }
  ED.korCini = {
    bx: 18, ty: -34, by: 17, sh: [14, 10], top: -32, fps: 12, n: 8, soul: '#FFB04A',
    body: function (c, f) {
      var a = f * TAU, hop = abs(sin(a)), land = 1 - hop, sq = 1 + (land > 0.85 ? (land - 0.85) * 1.2 : 0);
      c.save(); c.translate(0, 12.5); c.scale(sq, 1 / sq); c.translate(0, -12.5 - hop * 5);
      var B = '#E24A2A', S = '#8E1E1A', H = '#FF9A5A', BEL = '#FFC46A';
      // flame tail
      rope(c, function (c) { c.moveTo(-6, 4); c.quadraticCurveTo(-12, 6 + sin(a) * 2, -13, 0 + sin(a) * 2); }, '#B8301E', 1.6, 0.9);
      // legs
      cel(c, function (c) { CAP(c, -3, 6, -3.6 - hop * 1.5, 11.6, 2.1, 2); CAP(c, 3.4, 6, 4 + hop * 1.5, 11.6, 2.1, 2); }, '#B8301E', '#6E1410', null, 0.9);
      fl(c, function (c) { E(c, -3.8 - hop * 1.5, 12, 2.6, 1.4); E(c, 4.6 + hop * 1.5, 12, 2.6, 1.4); }, '#3A1414');
      // body
      cel(c, function (c) { E(c, 0, -1, 9.6, 9.2); }, B, S, H, 2.6, 1.5);
      fl(c, function (c) { E(c, 0.8, 3, 5.4, 4.2); }, BEL, true);
      // horns
      cel(c, function (c) { c.moveTo(-6, -7.5); c.quadraticCurveTo(-9.6, -10, -8.6, -14.6); c.quadraticCurveTo(-6.6, -11, -3.6, -9.4); c.closePath(); c.moveTo(6.6, -7.5); c.quadraticCurveTo(10.2, -10, 9.2, -14.6); c.quadraticCurveTo(7.2, -11, 4.2, -9.4); c.closePath(); }, '#3A2228', '#1E1014', '#6A4A52', 1, 0.6);
      // arms (flailing)
      var aw = sin(a * 2) * 2.4;
      cel(c, function (c) { CAP(c, -8, 0, -12.6, -3 - aw, 1.9, 1.7); CAP(c, 8, 0, 12.6, -3 + aw, 1.9, 1.7); }, B, S, null, 0.9);
      // eyes (yellow, mischievous)
      eye(c, -3.2, -2.6, 3, 3.3, '#FFF27A', '#3A1000', { lx: 0.6, slit: true, white: '#FFF6C8' });
      eye(c, 4.2, -2.6, 3, 3.3, '#FFF27A', '#3A1000', { lx: 0.6, slit: true, white: '#FFF6C8' });
      ln(c, -6.2, -6.8, -1.2, -5.2, OUT, 1.3); ln(c, 7.2, -6.8, 2.2, -5.2, OUT, 1.3);
      // grin with teeth
      fl(c, function (c) { c.moveTo(-3.6, 2.2); c.quadraticCurveTo(0.6, 7.2, 5, 2.2); c.quadraticCurveTo(0.6, 3.8, -3.6, 2.2); }, '#3A0A0A');
      fl(c, function (c) { P(c, [-2.2, 2.8, -1.4, 4.4, -0.6, 3.2]); P(c, [2.0, 3.2, 2.8, 4.4, 3.6, 2.8]); }, '#FFFFFF', true);
      c.restore();
    },
    glow: function (c, f) {
      var a = f * TAU, hop = abs(sin(a));
      var oy = -hop * 5;
      // flame hair
      c.globalCompositeOperation = 'lighter';
      glow(c, 0.5, -10 + oy, 13, 11, '#FF6A1F', 0.55);
      c.globalCompositeOperation = 'source-over';
      var fx = [-4.5, -1.2, 2.2, 5.4], fs = [0.75, 1.0, 1.15, 0.8];
      for (var pass = 0; pass < 3; pass++) {
        c.fillStyle = pass === 0 ? '#E8401E' : pass === 1 ? '#FF9A2A' : '#FFF0A0';
        var sc = pass === 0 ? 1 : pass === 1 ? 0.72 : 0.42;
        c.beginPath();
        for (var i = 0; i < 4; i++) impFlame(c, fx[i], -8.6 + oy, fs[i] * sc + (pass === 0 ? 0.08 : 0), f, i);
        c.fill();
      }
      // tail flame
      c.globalCompositeOperation = 'lighter';
      glow(c, -13, 0 + sin(a) * 2 + oy, 4.5, 4.5, '#FF8A2A', 0.9, true);
      glow(c, -3.2, -2.6 + oy, 4.5, 4.5, '#FFD84A', 0.35); glow(c, 4.2, -2.6 + oy, 4.5, 4.5, '#FFD84A', 0.35);
      c.globalCompositeOperation = 'source-over';
    }
  };

  // ---------- Taş Golem (elite): moss + rune stone golem, heavy stomp
  ED.golem = {
    bx: 21, ty: -27, by: 16, sh: [14, 15], top: -26, topX: 2, fps: 7, n: 6, soul: '#B07CFF',
    body: function (c, f) {
      var a = f * TAU, st = sin(a), bob = -abs(st) * 0.9, rock = st * 0.035;
      c.save(); c.translate(0, 13); c.rotate(rock); c.translate(0, -13);
      var B = '#7A6E8A', S = '#4A4058', H = '#A398B5', D = '#342C40', M = '#4F8A3A', MH = '#86C95E', MS = '#2E5A24';
      // legs (stumpy pillars)
      cel(c, function (c) { RR(c, -9 - st * 0.6, 3 + bob - mx(0, st) * 1.2, 7, 10.5, 2.4); }, S, D, B, 1.4, 0.8);
      cel(c, function (c) { RR(c, 2.6 + st * 0.6, 3 + bob - mx(0, -st) * 1.2, 7, 10.5, 2.4); }, B, S, H, 1.4, 0.8);
      // back arm
      var sw = st * 2.2;
      cel(c, function (c) { CAP(c, -11, -10 + bob, -14 - sw * 0.4, 1 + bob, 4.4, 3.6); }, S, D, null, 1.4);
      cel(c, function (c) { E(c, -14.5 - sw * 0.4, 3 + bob, 5.4, 4.8); }, S, D, B, 1.4, 0.8);
      // back crystals
      cel(c, function (c) { P(c, [-9, -14 + bob, -12.5, -24 + bob, -6.5, -16 + bob]); P(c, [-5, -16 + bob, -5.8, -26.5 + bob, -1.8, -17 + bob]); }, '#9D6BFF', '#5A2BB0', '#E2CCFF', 1.1, 0.7);
      // torso boulder
      cel(c, function (c) { c.moveTo(-12, -2 + bob); c.bezierCurveTo(-14.5, -15, -7, -19.5, 1, -19.5); c.bezierCurveTo(9, -19.5, 15, -15, 13, -2 + bob); c.quadraticCurveTo(10, 6 + bob, 0.5, 6 + bob); c.quadraticCurveTo(-9, 6 + bob, -12, -2 + bob); c.closePath(); }, B, S, H, 3.4, 1.8);
      // plate seams
      c.beginPath(); c.moveTo(-10, -9 + bob); c.lineTo(-5, -7 + bob); c.lineTo(-6, 0 + bob); c.moveTo(7, -15 + bob); c.lineTo(5, -9 + bob); c.lineTo(10, -5 + bob); c.moveTo(-2, 2 + bob); c.lineTo(3, 4.5 + bob); strokeW(c, D, 1);
      // rune (carved)
      c.beginPath(); c.moveTo(1, -12 + bob); c.lineTo(1, -2 + bob); c.moveTo(-2.4, -9.5 + bob); c.lineTo(1, -6.4 + bob); c.lineTo(4.4, -9.5 + bob); c.moveTo(-1.8, -3.5 + bob); c.lineTo(3.8, -3.5 + bob); strokeW(c, '#2A1A44', 2.6);
      // moss on shoulders/head
      cel(c, function (c) { c.moveTo(-12.5, -10 + bob); c.bezierCurveTo(-12, -18, -3, -21, 3, -20); c.bezierCurveTo(9, -20, 13.5, -16, 13.2, -11 + bob); c.quadraticCurveTo(11.6, -13, 10.4, -10.6 + bob); c.quadraticCurveTo(9, -13.6, 6.4, -14); c.quadraticCurveTo(3, -12, 1, -14.6); c.quadraticCurveTo(-3, -12.6, -6, -14.4); c.quadraticCurveTo(-8.4, -11, -10.4, -12.4); c.quadraticCurveTo(-11.4, -9, -12.5, -10 + bob); c.closePath(); }, M, MS, MH, 1.4, 0.9);
      // head (small, sunk between shoulders)
      cel(c, function (c) { RR(c, -3.4, -24.5 + bob, 11.6, 8.6, 3.4); }, B, S, H, 1.6, 1);
      fl(c, function (c) { RR(c, -2.2, -21.6 + bob, 9.4, 3.4, 1.7); }, '#1A1222');
      fl(c, function (c) { E(c, 0.4, -19.9 + bob, 1.6, 1.1); E(c, 5.4, -19.9 + bob, 1.6, 1.1); }, '#9CFFF0', true);
      fl(c, function (c) { E(c, 0, -25 + bob, 4, 1.3); }, M, true);
      // front arm + fist
      cel(c, function (c) { CAP(c, 11, -11 + bob, 14 + sw * 0.4, 0 + bob, 4.6, 3.8); }, B, S, H, 1.6, 0.9);
      cel(c, function (c) { E(c, 14.8 + sw * 0.4, 3 + bob, 5.8, 5.2); }, B, S, H, 1.8, 1);
      c.beginPath(); c.moveTo(12.6 + sw * 0.4, 0.6 + bob); c.lineTo(13.2 + sw * 0.4, 4.6 + bob); c.moveTo(15.8 + sw * 0.4, 0.2 + bob); c.lineTo(16.4 + sw * 0.4, 4.4 + bob); strokeW(c, D, 0.9);
      fl(c, function (c) { E(c, 13, -14.4 + bob, 3.6, 1.6); }, MH, true);
      c.restore();
    },
    glow: function (c, f) {
      var a = f * TAU, st = sin(a), bob = -abs(st) * 0.9, pulse = 0.75 + 0.25 * sin(a * 2);
      c.save(); c.translate(0, 13); c.rotate(st * 0.035); c.translate(0, -13);
      c.beginPath(); c.moveTo(1, -12 + bob); c.lineTo(1, -2 + bob); c.moveTo(-2.4, -9.5 + bob); c.lineTo(1, -6.4 + bob); c.lineTo(4.4, -9.5 + bob); c.moveTo(-1.8, -3.5 + bob); c.lineTo(3.8, -3.5 + bob);
      c.lineCap = 'round'; c.strokeStyle = '#E8D4FF'; c.lineWidth = 1.1; c.stroke();
      c.globalCompositeOperation = 'lighter';
      glow(c, 1, -7 + bob, 9 * pulse, 9 * pulse, '#9D6BFF', 0.8);
      glow(c, 0.4, -19.9 + bob, 3.5, 3, '#3EDBC8', 0.9); glow(c, 5.4, -19.9 + bob, 3.5, 3, '#3EDBC8', 0.9);
      glow(c, -8, -20 + bob, 6, 6, '#B07CFF', 0.4 * pulse);
      c.globalCompositeOperation = 'source-over';
      c.restore();
    }
  };

  // ---------- Kemik Büyücü (elite): bone mage in a hood with a floating skull staff
  ED.buyucu = {
    bx: 24, ty: -34, by: 17, sh: [15, 13], top: -30, topX: 1, fps: 9, n: 8, fly: true, soul: '#C9A0FF',
    body: function (c, f) {
      var a = f * TAU, bob = -3 + sin(a) * 1.5, sw = sin(a + 0.8);
      var R = '#3A2352', RS = '#21122F', RH = '#5E3E80', TR = '#C9A24A', BN = '#ECE4CF', BS = '#A99C80';
      // floating skull staff (behind on the right)
      var sx = 14, sy = -10 + sin(a + 1.6) * 2.2;
      rope(c, function (c) { c.moveTo(sx - 1.2, sy + 18); c.quadraticCurveTo(sx + 1.4, sy + 6, sx, sy - 4); }, '#5A3A2A', 2, 1);
      cel(c, function (c) { c.moveTo(sx - 4, sy - 7); c.bezierCurveTo(sx - 4.6, sy - 13.5, sx + 4.6, sy - 13.5, sx + 4, sy - 7); c.quadraticCurveTo(sx + 3.4, sy - 4, sx + 1.6, sy - 3.4); c.lineTo(sx - 1.6, sy - 3.4); c.quadraticCurveTo(sx - 3.4, sy - 4, sx - 4, sy - 7); c.closePath(); }, BN, BS, '#FFFBEF', 1, 0.6);
      fl(c, function (c) { E(c, sx - 1.6, sy - 8.2, 1.2, 1.4); E(c, sx + 1.6, sy - 8.2, 1.2, 1.4); }, '#2A0E3A', true);
      // robe body (tattered hem)
      cel(c, function (c) {
        c.moveTo(-6.5, -14 + bob);
        c.quadraticCurveTo(-12, -2 + bob, -13 + sw, 10 + bob);
        c.lineTo(-9.6 + sw, 7.6 + bob); c.lineTo(-7.6 + sw * 0.8, 12 + bob); c.lineTo(-4.4 + sw * 0.6, 8.4 + bob); c.lineTo(-1.6 + sw * 0.5, 12.6 + bob);
        c.lineTo(1.4 + sw * 0.5, 8.6 + bob); c.lineTo(4.6 + sw * 0.6, 12 + bob); c.lineTo(7 + sw * 0.7, 8 + bob); c.lineTo(10 + sw, 10.6 + bob);
        c.quadraticCurveTo(10, -2 + bob, 7, -14 + bob); c.closePath();
      }, R, RS, RH, 3, 1.4);
      // robe front opening with ribs
      fl(c, function (c) { c.moveTo(-2, -10 + bob); c.lineTo(2.6, -10 + bob); c.lineTo(3.6, 3 + bob); c.lineTo(-3, 3 + bob); c.closePath(); }, '#1A0E26');
      for (var i = 0; i < 3; i++) { var ry = -7.6 + i * 2.6 + bob; c.beginPath(); c.moveTo(-1.6, ry); c.quadraticCurveTo(0.4, ry + 1, 2.6, ry); strokeW(c, BS, 1.1); }
      // gold trim + belt rune
      c.beginPath(); c.moveTo(-2.2, -10 + bob); c.lineTo(-3.2, 3 + bob); c.moveTo(2.8, -10 + bob); c.lineTo(3.8, 3 + bob); strokeW(c, TR, 1.1);
      fl(c, function (c) { RR(c, -6.5, 1.5 + bob, 13.5, 2.6, 1.2); }, '#5A3A1A');
      fl(c, function (c) { Ci(c, 0.4, 2.8 + bob, 1.6); }, '#B565FF');
      // shoulder skulls / bone pauldrons
      cel(c, function (c) { E(c, -7, -12.5 + bob, 4.2, 3.2); E(c, 7.8, -12.5 + bob, 4.2, 3.2); }, BN, BS, '#FFFBEF', 1, 0.6);
      fl(c, function (c) { Ci(c, -7.6, -12.6 + bob, 0.9); Ci(c, -5.6, -12.6 + bob, 0.9); Ci(c, 7.2, -12.6 + bob, 0.9); Ci(c, 9.2, -12.6 + bob, 0.9); }, '#2A1A2E', true);
      // hood
      cel(c, function (c) { c.moveTo(-7.2, -12 + bob); c.bezierCurveTo(-9.6, -24, -3, -30 + bob * 0.2, 2, -30.5 + bob * 0.2); c.quadraticCurveTo(5.5, -28, 5, -25 + bob); c.bezierCurveTo(9.5, -23, 9.4, -15, 7.8, -12 + bob); c.closePath(); }, R, RS, RH, 2.2, 1.2);
      // face in hood shadow
      fl(c, function (c) { E(c, 1.4, -18 + bob, 5.4, 5.6); }, '#120A1C');
      cel(c, function (c) { c.moveTo(-2.6, -17.6 + bob); c.bezierCurveTo(-3, -23, 6.4, -23, 6, -17.6 + bob); c.quadraticCurveTo(5.6, -14.6, 3.6, -14.2 + bob); c.lineTo(-0.6, -14.2 + bob); c.quadraticCurveTo(-2.4, -15, -2.6, -17.6 + bob); c.closePath(); }, '#D8CFB8', '#8E8068', null, 1, 0.6);
      fl(c, function (c) { E(c, 0, -18.4 + bob, 1.5, 1.7); E(c, 3.8, -18.4 + bob, 1.5, 1.7); }, '#1A0A26', true);
      fl(c, function (c) { Ci(c, 0.2, -18.4 + bob, 0.8); Ci(c, 4, -18.4 + bob, 0.8); }, '#F2DAFF', true);
      c.beginPath(); c.moveTo(0, -15.4 + bob); c.lineTo(3.8, -15.4 + bob); strokeW(c, '#5A4E3A', 0.7);
      // bony hand reaching toward the staff
      rope(c, function (c) { c.moveTo(6.5, -9 + bob); c.quadraticCurveTo(10, -6 + bob, sx - 2.2, sy + 1.5); }, R, 2.6, 1);
      fl(c, function (c) { E(c, sx - 2.2, sy + 1.5, 1.8, 1.5); }, BN);
    },
    glow: function (c, f) {
      var a = f * TAU, bob = -3 + sin(a) * 1.5, sy = -10 + sin(a + 1.6) * 2.2, sx = 14, pulse = 0.8 + 0.2 * sin(a * 2);
      c.globalCompositeOperation = 'lighter';
      glow(c, 0.2, -18.4 + bob, 3.6, 3.6, '#C08CFF', 0.95); glow(c, 4, -18.4 + bob, 3.6, 3.6, '#C08CFF', 0.95);
      glow(c, sx, sy - 13, 9 * pulse, 10 * pulse, '#9D6BFF', 0.75, true);
      glow(c, sx - 1.6, sy - 8.2, 2.4, 2.4, '#E2B8FF', 0.9); glow(c, sx + 1.6, sy - 8.2, 2.4, 2.4, '#E2B8FF', 0.9);
      glow(c, 0, 9 + bob, 14, 5, '#6A2BB0', 0.45);
      c.globalCompositeOperation = 'source-over';
      // violet skull flame
      for (var pass = 0; pass < 2; pass++) {
        c.fillStyle = pass ? '#F4E6FF' : '#B57BFF';
        var s = pass ? 0.5 : 1;
        c.beginPath(); impFlame(c, sx, sy - 11.6, s, f, 0); c.fill();
      }
    }
  };

  // generic fallback (unknown enemy type): a little shadow blob
  ED._blob = {
    bx: 18, ty: -24, by: 17, sh: [14, 11], top: -20, fps: 8, n: 6, soul: '#B07CFF',
    body: function (c, f) {
      var a = f * TAU, sq = 1 + sin(a) * 0.06;
      cel(c, function (c) { c.moveTo(-11 * sq, 12); c.bezierCurveTo(-13 * sq, -4, -6, -14 / sq, 0, -14 / sq); c.bezierCurveTo(6, -14 / sq, 13 * sq, -4, 11 * sq, 12); c.closePath(); }, '#3B2E50', '#241B31', '#57426F', 2.6, 1.4);
      eye(c, -3, -2, 3, 3.4, '#B07CFF', '#120C18', { lx: 0.5 }); eye(c, 4.4, -2, 3, 3.4, '#B07CFF', '#120C18', { lx: 0.5 });
    },
    glow: function (c, f) { c.globalCompositeOperation = 'lighter'; glow(c, 0.7, -2, 10, 7, '#9D6BFF', 0.4); c.globalCompositeOperation = 'source-over'; }
  };

  function edFor(type) {
    if (ED[type]) return ED[type];
    var d = enDef(type); if (d && d.art && ED[d.art]) return ED[d.art];
    return ED._blob;
  }

  // ------------------------------------------------------------------------------------------ enemy sprite baking
  var SPR = Object.create(null);
  function outlineW(r) { return clamp(1.45 + r * 0.022, 1.6, 2.4); }
  // renders the body of frame i into tmp (K-scaled), returns tmp
  function renderBody(S, i, tmp, qx, qy) {
    var g = tmp.getContext('2d');
    g.setTransform(1, 0, 0, 1, 0, 0); g.globalCompositeOperation = 'source-over'; g.globalAlpha = 1;
    g.clearRect(0, 0, tmp.width, tmp.height);
    g.setTransform(S.k * S.u, 0, 0, S.k * S.u, S.fox * S.k, S.foy * S.k);
    if (qx) { var fy = S.def.sh[0]; g.translate(0, fy); g.scale(qx, qy); g.translate(0, -fy); }
    setLine(g, 1.15);
    try { S.def.body(g, i / S.n); } catch (err) { if (typeof console !== 'undefined') console.error('[GM.Art] enemy body', S.type, err); }
    return tmp;
  }
  function tintOf(src, col, tmp) {          // solid-colour silhouette of src
    var g = tmp.getContext('2d');
    g.setTransform(1, 0, 0, 1, 0, 0); g.globalCompositeOperation = 'source-over'; g.globalAlpha = 1;
    g.clearRect(0, 0, tmp.width, tmp.height);
    g.drawImage(src, 0, 0);
    g.globalCompositeOperation = 'source-in'; g.fillStyle = col; g.fillRect(0, 0, tmp.width, tmp.height);
    g.globalCompositeOperation = 'source-over';
    return tmp;
  }
  function stampOutline(g, sil, ow) {     // dilate the silhouette = sticker outline
    for (var j = 0; j < 8; j++) { var an = j / 8 * TAU; g.drawImage(sil, cos(an) * ow, sin(an) * ow); }
  }
  function drawSprShadow(g, S, ph) {
    var d = S.def, u = S.u, k = S.k;
    var lift = d.fly ? 0.82 + 0.18 * sin(ph * TAU) : 1;
    g.setTransform(k, 0, 0, k, S.fox * k, S.foy * k);
    shadow(g, 0, d.sh[0] * u, d.sh[1] * u * lift, d.sh[1] * u * 0.34 * lift, d.fly ? 0.7 : 0.9);
    g.setTransform(1, 0, 0, 1, 0, 0);
  }
  function buildSprite(type, n) {
    var d = edFor(type), ed = enDef(type) || {}, r = ed.r || (FB_EN[type] && FB_EN[type].r) || 16;
    var u = r / 16, k = bakeK(), ow = outlineW(r), pad = ow + 2;
    // keep big sprites inside a sane pixel budget (memory on phones)
    var wCss = 2 * d.bx * u + 2 * pad, hCss = (d.by - d.ty) * u + 2 * pad;
    if (wCss * hCss * k * k > 150000) k = mx(1, sqrt(150000 / (wCss * hCss)));
    var S = { type: type, def: d, r: r, u: u, k: k, n: n, fps: d.fps || 10, ow: ow,
      w: wCss, h: hCss, fox: d.bx * u + pad, foy: -d.ty * u + pad, ox: 0, oy: 0,
      top: (d.top || d.ty + 4) * u, topX: (d.topX || 0) * u, soul: d.soul || '#B07CFF', frames: [], flash: [], v: {} };
    var W = Math.ceil(wCss * k), H = Math.ceil(hCss * k);
    var tmpB = mkCv(W, H), tmpS = mkCv(W, H);
    if (!tmpB) return S;
    for (var i = 0; i < n; i++) {
      renderBody(S, i, tmpB); tintOf(tmpB, OUT, tmpS);
      var cv = mkCv(W, H), g = cv.getContext('2d');
      drawSprShadow(g, S, i / n);
      stampOutline(g, tmpS, ow * k);
      g.drawImage(tmpB, 0, 0);
      g.setTransform(k * u, 0, 0, k * u, S.fox * k, S.foy * k); setLine(g, 1.15);
      try { d.glow(g, i / n); } catch (err) { if (typeof console !== 'undefined') console.error('[GM.Art] enemy glow', type, err); }
      g.setTransform(1, 0, 0, 1, 0, 0); g.globalCompositeOperation = 'source-over';
      S.frames.push(cv);
      // flash: white body, dark outline, no glow, baked with the hit squash (1:1 blit stays fast)
      renderBody(S, i, tmpB, 1.16, 0.86); tintOf(tmpB, OUT, tmpS);
      var fc = mkCv(W, H), fg = fc.getContext('2d');
      drawSprShadow(fg, S, i / n);
      stampOutline(fg, tmpS, ow * k);
      tintOf(tmpB, '#FFFFFF', tmpS);
      fg.drawImage(tmpS, 0, 0);
      fg.globalAlpha = 0.18; fg.drawImage(tmpB, 0, 0); fg.globalAlpha = 1;
      S.flash.push(fc);
    }
    S._tmpW = W; S._tmpH = H;
    // crop every frame to the union alpha bounds (fewer pixels to blit), exact CSS size = px / k
    var rect = bboxOf(S.frames.concat(S.flash));
    S.frames = cropArr(S, S.frames, rect); S.flash = cropArr(S, S.flash, rect);
    S.ox = S.frames.ox; S.oy = S.frames.oy; S.w = S.frames.w; S.h = S.frames.h;
    return S;
  }
  function bboxOf(arr) {
    if (!arr.length || !HAS_DOC) return null;
    var W = arr[0].width, H = arr[0].height, acc = document.createElement('canvas');
    acc.width = W; acc.height = H;
    var ag = acc.getContext('2d', { willReadFrequently: true });
    for (var i = 0; i < arr.length; i++) ag.drawImage(arr[i], 0, 0);
    var ad = ag.getImageData(0, 0, W, H).data, x0 = W, y0 = H, x1 = -1, y1 = -1, x, y;
    for (y = 0; y < H; y++) for (x = 0; x < W; x++) if (ad[(y * W + x) * 4 + 3] > 3) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    if (x1 < x0) return null;
    x0 = mx(0, x0 - 2); y0 = mx(0, y0 - 2); x1 = mn(W - 1, x1 + 2); y1 = mn(H - 1, y1 + 2);
    return [x0, y0, x1 - x0 + 1, y1 - y0 + 1];
  }
  // crop a full-size frame array to rect; the array carries its own anchor (ox, oy) and CSS size (w, h)
  function cropArr(S, arr, rect) {
    var out = rect ? arr.map(function (f) { var cv = mkCv(rect[2], rect[3]); cv.getContext('2d').drawImage(f, -rect[0], -rect[1]); return cv; }) : arr.slice();
    var k = S.k;
    out.ox = S.fox - (rect ? rect[0] : 0) / k; out.oy = S.foy - (rect ? rect[1] : 0) / k;
    out.w = (out.length ? out[0].width : 1) / k; out.h = (out.length ? out[0].height : 1) / k;
    return out;
  }
  // mirrored copies (dir -1) so blits stay translate-only (fast path); built lazily per array
  function flipArr(S, key, arr) {
    S.L = S.L || {};
    if (S.L[key]) return S.L[key];
    var L = arr.map(function (f) { var cv = mkCv(f.width, f.height), g = cv.getContext('2d'); g.translate(f.width, 0); g.scale(-1, 1); g.drawImage(f, 0, 0); return cv; });
    L.ox = arr.w - arr.ox; L.oy = arr.oy; L.w = arr.w; L.h = arr.h;     // anchor mirrored
    S.L[key] = L;
    return L;
  }
  // lazily built variants: frozen (1 frame, ice-encased), burn / poison (tinted walk cycles), die (dissolve steps)
  function variant(S, kind) {
    var v = S.v[kind]; if (v) return v;
    var W = S._tmpW, H = S._tmpH, k = S.k, u = S.u, ow = S.ow, d = S.def, i, g, cv;
    var tmpB = mkCv(W, H), tmpS = mkCv(W, H), tmpT = mkCv(W, H);
    v = [];
    if (kind === 'frozen') {
      renderBody(S, 0, tmpB); tintOf(tmpB, OUT, tmpS);
      cv = mkCv(W, H); g = cv.getContext('2d');
      drawSprShadow(g, S, 0);
      tintOf(tmpB, '#1E4A6E', tmpT); stampOutline(g, tmpT, ow * k);
      g.drawImage(tmpB, 0, 0);
      tintOf(tmpB, '#8FDFFF', tmpT); g.globalAlpha = 0.62; g.drawImage(tmpT, 0, 0); g.globalAlpha = 1;
      // ice shell: crystals around the base + glossy facets
      g.setTransform(k * u, 0, 0, k * u, S.fox * k, S.foy * k); setLine(g, 1);
      g.strokeStyle = '#1E4A6E';
      var R = rng(hstr(S.type + 'ice'));
      for (i = 0; i < 6; i++) {
        var bx = (i / 5 - 0.5) * d.bx * 1.3, hh = 5 + R() * 9, ww = 2.4 + R() * 2.6, by = d.sh[0] - 1 - R() * 3, lean = (R() - 0.5) * 4;
        cel(g, function (c) { P(c, [bx - ww, by, bx + lean, by - hh, bx + ww, by]); }, 'rgba(170,235,255,0.82)', 'rgba(80,170,230,0.85)', 'rgba(255,255,255,0.9)', 1.2, 0.8);
      }
      g.globalCompositeOperation = 'lighter';
      glow(g, 0, -4, d.bx * 0.8, d.bx * 0.7, '#4FC3FF', 0.35);
      g.globalCompositeOperation = 'source-over';
      g.setTransform(1, 0, 0, 1, 0, 0);
      // frosty highlight streaks clipped to the body
      tintOf(tmpB, '#FFFFFF', tmpT);
      var tg = tmpT.getContext('2d'); tg.globalCompositeOperation = 'destination-in';
      tg.setTransform(k * u, 0, 0, k * u, S.fox * k, S.foy * k);
      tg.beginPath(); for (i = 0; i < 2; i++) { var gx = -d.bx * 0.45 + i * d.bx * 0.38; tg.moveTo(gx - 3, d.ty); tg.lineTo(gx + 1 + i * 2, d.ty); tg.lineTo(gx + 10 + i * 2, d.by); tg.lineTo(gx + 7, d.by); tg.closePath(); }
      tg.fillStyle = '#FFFFFF'; tg.fill(); tg.setTransform(1, 0, 0, 1, 0, 0); tg.globalCompositeOperation = 'source-over';
      g.globalAlpha = 0.28; g.drawImage(tmpT, 0, 0); g.globalAlpha = 1;
      v.push(cv);
    } else if (kind === 'burn' || kind === 'poison') {
      var tc = kind === 'burn' ? '#FF5A1A' : '#7CFF3A', ta = kind === 'burn' ? 0.36 : 0.4, oc = kind === 'burn' ? '#3A0A00' : '#0E2A06';
      for (i = 0; i < S.n; i++) {
        renderBody(S, i, tmpB);
        cv = mkCv(W, H); g = cv.getContext('2d');
        drawSprShadow(g, S, i / S.n);
        tintOf(tmpB, oc, tmpT); stampOutline(g, tmpT, ow * k);
        g.drawImage(tmpB, 0, 0);
        tintOf(tmpB, tc, tmpT); g.globalAlpha = ta; g.drawImage(tmpT, 0, 0); g.globalAlpha = 1;
        g.setTransform(k * u, 0, 0, k * u, S.fox * k, S.foy * k); setLine(g, 1.15);
        try { d.glow(g, i / S.n); } catch (err) { /* ignore */ }
        var ft = i / S.n;
        if (kind === 'burn') {
          // licking flames over the body (baked: zero runtime cost)
          g.globalCompositeOperation = 'lighter';
          glow(g, 0, -4, 16, 14, '#FF5A1A', 0.45);
          var fpos = [[-7, 4, 0.8], [0.5, -9, 1.05], [7.5, 3, 0.85], [-2, 10, 0.6]];
          for (var j = 0; j < fpos.length; j++) { var fp = fpos[j]; flames(g, fp[0], fp[1], 3.6 * fp[2], (11 + 3 * sin(ft * TAU * 2 + j * 1.7)) * fp[2], ft * 1.6, j * 2.3 + 1); }
        } else {
          // rising toxic bubbles
          for (j = 0; j < 3; j++) {
            var bp = fract(ft + j / 3), br = (1.6 + j * 0.6) * (0.6 + 0.4 * sin(bp * PI)), bx = (j - 1) * 8 + sin(bp * 6 + j) * 2, by = d.ty * 0.55 - bp * 12 + 6;
            g.globalAlpha = sin(bp * PI);
            g.beginPath(); g.arc(bx, by, br, 0, TAU); g.fillStyle = 'rgba(140,255,80,0.8)'; g.fill(); g.lineWidth = 0.8; g.strokeStyle = '#2A6A12'; g.stroke();
            g.beginPath(); g.arc(bx - br * 0.35, by - br * 0.35, br * 0.3, 0, TAU); g.fillStyle = '#F2FFD8'; g.fill();
            g.globalAlpha = 1;
          }
        }
        g.setTransform(1, 0, 0, 1, 0, 0); g.globalCompositeOperation = 'source-over';
        v.push(cv);
      }
    } else if (kind === 'die') {
      // 6 dissolve steps from frame 0: value-noise threshold (feet first), burning soul-coloured edge
      var base = mkCv(W, H), bg = base.getContext('2d', { willReadFrequently: true }), sc = rgb(S.soul);
      var NS = 7 * k * u, seed = hstr(S.type);
      var nv = new Float32Array(W * H), px, py;
      for (py = 0; py < H; py++) for (px = 0; px < W; px++) {
        var o = py * W + px;
        var fx = px / NS, fy = py / NS, x0 = floor(fx), y0 = floor(fy), tx = sm(fx - x0), ty = sm(fy - y0);
        var n00 = hashN(seed + x0 * 73 + y0 * 9151), n10 = hashN(seed + (x0 + 1) * 73 + y0 * 9151), n01 = hashN(seed + x0 * 73 + (y0 + 1) * 9151), n11 = hashN(seed + (x0 + 1) * 73 + (y0 + 1) * 9151);
        var nn = lerp(lerp(n00, n10, tx), lerp(n01, n11, tx), ty);
        var f2x = fx * 2.3, f2y = fy * 2.3, x1 = floor(f2x), y1 = floor(f2y);
        nn = nn * 0.7 + 0.3 * lerp(lerp(hashN(seed + 5 + x1 * 37 + y1 * 4099), hashN(seed + 5 + (x1 + 1) * 37 + y1 * 4099), sm(f2x - x1)), lerp(hashN(seed + 5 + x1 * 37 + (y1 + 1) * 4099), hashN(seed + 5 + (x1 + 1) * 37 + (y1 + 1) * 4099), sm(f2x - x1)), sm(f2y - y1));
        nv[o] = nn * 0.72 + 0.28 * (1 - py / H);
      }
      for (var st = 0; st < 6; st++) {
        var thr = 0.06 + st / 5 * 0.86, edge = 0.075, dp = (st + 0.5) / 6;
        // stretch upward + thin as it dissolves (baked so the runtime blit stays 1:1)
        renderBody(S, 0, tmpB, 1 - dp * 0.25, 1 + dp * 0.35); tintOf(tmpB, OUT, tmpS);
        bg.setTransform(1, 0, 0, 1, 0, 0); bg.clearRect(0, 0, W, H);
        stampOutline(bg, tmpS, ow * k); bg.drawImage(tmpB, 0, 0);
        var sd = bg.getImageData(0, 0, W, H).data;
        cv = mkCv(W, H); g = cv.getContext('2d');
        var id = g.createImageData(W, H), dd = id.data;
        for (var o2 = 0; o2 < W * H; o2++) {
          var al = sd[o2 * 4 + 3]; if (al < 4) continue;
          var nn2 = nv[o2], j4 = o2 * 4;
          if (nn2 < thr - edge) continue;
          if (nn2 < thr) {                       // glowing rim
            var kk = (nn2 - (thr - edge)) / edge;
            dd[j4] = lerp(255, sc[0], kk); dd[j4 + 1] = lerp(255, sc[1], kk); dd[j4 + 2] = lerp(255, sc[2], kk); dd[j4 + 3] = al;
          } else {
            var m2 = nn2 < thr + 0.08 ? (1 - (nn2 - thr) / 0.08) * 0.55 : 0;
            dd[j4] = lerp(sd[j4], sc[0], m2); dd[j4 + 1] = lerp(sd[j4 + 1], sc[1], m2); dd[j4 + 2] = lerp(sd[j4 + 2], sc[2], m2); dd[j4 + 3] = al;
          }
        }
        g.putImageData(id, 0, 0);
        v.push(cv);
      }
    }
    v = cropArr(S, v, bboxOf(v));
    S.v[kind] = v;
    return v;
  }

  Art.bakeEnemy = function (type, frames) {
    var n = frames | 0; if (!(n > 0)) n = (edFor(type).n || 8);
    n = clamp(n, 1, 24);
    var key = type + '|' + n, S = SPR[key];
    if (!S) { S = SPR[key] = buildSprite(type, n); if (!SPR[type]) SPR[type] = S; }
    return S;
  };
  function sprFor(type) { return SPR[type] || Art.bakeEnemy(type); }
  Art.soulColor = function (type) { return (edFor(type).soul) || '#B07CFF'; };

  // small cached overlay sprites (crown, flame, bubble, elite ring)
  var OVL = Object.create(null);
  function crownSpr() {
    if (OVL.crown) return OVL.crown;
    OVL.crown = Art.bake(function (c, cx, cy) {
      setLine(c, 1.1); c.translate(cx, cy + 1);
      cel(c, function (c) { P(c, [-6, 3, -6.6, -3.2, -3.2, -0.4, 0, -5, 3.2, -0.4, 6.6, -3.2, 6, 3]); }, '#FFCB57', '#C07A1A', '#FFF1C4', 1.2, 0.8);
      fl(c, function (c) { Ci(c, 0, 1, 1.2); }, '#FF3D4F');
      fl(c, function (c) { Ci(c, -6.6, -3.6, 1); Ci(c, 0, -5.4, 1.1); Ci(c, 6.6, -3.6, 1); }, '#FFF1C4');
    }, 18, 14, 1);
    return OVL.crown;
  }
  function eliteRingSpr() {
    if (OVL.ring) return OVL.ring;
    OVL.ring = Art.bake(function (c, cx, cy) {
      c.translate(cx, cy); c.scale(1, 0.38);
      var gr = c.createRadialGradient(0, 0, 10, 0, 0, 30);
      gr.addColorStop(0, 'rgba(255,61,79,0)'); gr.addColorStop(0.7, 'rgba(255,90,60,0.35)'); gr.addColorStop(0.86, 'rgba(255,190,80,0.8)'); gr.addColorStop(1, 'rgba(255,61,79,0)');
      c.fillStyle = gr; c.beginPath(); c.arc(0, 0, 30, 0, TAU); c.fill();
      c.strokeStyle = 'rgba(255,220,140,0.85)'; c.lineWidth = 1.4;
      for (var i = 0; i < 12; i++) { var a0 = i / 12 * TAU; c.beginPath(); c.arc(0, 0, 26, a0, a0 + 0.3); c.stroke(); }
    }, 64, 26, 1);
    return OVL.ring;
  }

  // ------------------------------------------------------------------------------------------ pixel-snapped blits
  // Software (and many GPU) canvas paths are several times faster when a sprite lands on whole device pixels
  // at 1:1 scale (no filtering). The ctx transform is read once per (ctx, t) and cached; a stale cache can
  // only shift a sprite by < 0.5 device px, never more.
  var TF = { ctx: null, t: NaN, a: 1, d: 1, e: 0, f: 0, ok: false };
  function devT(ctx, t) {
    if (TF.ctx !== ctx || TF.t !== t) {
      TF.ctx = ctx; TF.t = t; TF.ok = false;
      if (ctx.getTransform) { var m = ctx.getTransform(); TF.a = m.a; TF.d = m.d; TF.e = m.e; TF.f = m.f; TF.ok = m.b === 0 && m.c === 0 && m.a > 0 && m.d > 0; }
    }
    return TF;
  }
  function blitSnap(ctx, img, x, y, w, h, k, t) {
    var T = devT(ctx, t);
    if (T.ok) { x = (round(T.a * x + T.e) - T.e) / T.a; y = (round(T.d * y + T.f) - T.f) / T.d; }
    ctx.drawImage(img, x, y, w, h);
  }
  // convenience for battle: blit frame i of a bakeEnemy() sprite at enemy position (x, y), facing dir
  Art.blitEnemy = function (ctx, S, i, x, y, dir, flash, t) {
    if (!S || !S.frames || !S.frames.length) return;
    var arr = flash ? S.flash : S.frames;
    if (dir < 0) arr = flipArr(S, flash ? 'flash' : 'base', arr);
    var img = arr[((i | 0) % arr.length + arr.length) % arr.length];
    blitSnap(ctx, img, x - arr.ox, y - arr.oy, arr.w, arr.h, S.k, t);
  };

  // ------------------------------------------------------------------------------------------ drawEnemy
  var FROST_GLINT = '#E8FBFF';
  Art.drawEnemy = function (ctx, e, t) {
    if (!e) return;
    var S = sprFor(e.type); if (!S || !S.frames.length) return;
    t = t || 0;
    var sc = e.r > 0 ? e.r / S.r : 1;
    var x = e.x, y = e.y, dir = e.dir < 0 ? -1 : 1;
    var ph = e._aw;
    if (ph === undefined) ph = e._aw = (e.id != null ? hashN(e.id | 0) : Math.random());
    var dying = e.dying > 0 ? mn(1, e.dying) : 0;
    var frozen = !!e.frozen && !dying;
    var n = S.n, fi = (frozen || e.moving === false) ? 0 : (floor(t * S.fps + ph * n) % n);
    var ga = ctx.globalAlpha, op = ctx.globalCompositeOperation;
    // elite: ground sigil + aura (under)
    if (e.elite && !dying) {
      var pul = 0.75 + 0.25 * sin(t * 4 + ph * 6);
      var rw = (1.25 * e.r * (S.def.bx / 20) + e.r * 0.9) * (0.92 + 0.08 * pul);
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = ga * (0.4 + 0.2 * pul);
      ctx.drawImage(eliteRingSpr().frames[0], x - rw, y + S.def.sh[0] * S.u * sc - rw * 0.41, rw * 2, rw * 0.82);
      ctx.globalAlpha = ga;
      glow(ctx, x, y - e.r * 0.3, e.r * 1.7, e.r * 1.6, '#FF4A3A', 0.16 * pul);
      ctx.globalCompositeOperation = op;
    }
    // pick the image (dir -1 uses pre-mirrored copies so the blit stays translate-only)
    var img, arr, key, sx = 1, sy = 1, alpha = 1;
    var ht = e.hitT;
    if (dying) {
      arr = variant(S, 'die'); key = 'die';
      fi = mn(arr.length - 1, floor(dying * arr.length));
      alpha = 1 - dying * dying;
    } else if (ht != null && ht >= 0 && ht < 0.09) {
      arr = S.flash; key = 'flash';
    } else {
      if (frozen) { arr = variant(S, 'frozen'); key = 'frozen'; fi = 0; }
      else if (e.burning) { arr = variant(S, 'burn'); key = 'burn'; }
      else if (e.poisoned) { arr = variant(S, 'poison'); key = 'poison'; }
      else { arr = S.frames; key = 'base'; }
      if (ht != null && ht >= 0.09 && ht < 0.2 && S.r >= 30) { var q2 = sin(seg(ht, 0.09, 0.2) * PI); sx = 1 - 0.05 * q2; sy = 1 + 0.06 * q2; }   // big ones wobble back
    }
    if (dir < 0) arr = flipArr(S, key, arr);
    img = arr[fi] || arr[0];
    // each frame array carries its own anchor (crop) — mirrored arrays have the anchor mirrored already
    var aw = arr.w || S.w, ah = arr.h || S.h, aox = arr.ox != null ? arr.ox : S.ox, aoy = arr.oy != null ? arr.oy : S.oy;
    if (alpha < 1) ctx.globalAlpha = ga * alpha;
    if (sx === 1 && sy === 1 && sc === 1) blitSnap(ctx, img, x - aox, y - aoy, aw, ah, S.k, t);
    else {
      // squash/stretch anchored at the feet (only rescaled / big wobbling enemies)
      var footY = y + S.def.sh[0] * S.u * sc;
      ctx.drawImage(img, x - aox * sc * sx, footY - (footY - (y - aoy * sc)) * sy, aw * sc * sx, ah * sc * sy);
    }
    ctx.globalAlpha = ga;
    // dying: rising souls
    if (dying) {
      ctx.globalCompositeOperation = 'lighter';
      var soul = S.soul, top = y + S.top * sc;
      for (var i = 0; i < 3; i++) {
        var pp = clamp(dying * 1.25 - i * 0.1, 0, 1);
        var px = x + sin(i * 2.4 + pp * 5) * e.r * 0.7, py = lerp(y, top - e.r * 1.2, pp) - i * 3;
        glow(ctx, px, py, 4 + i, 4 + i, soul, (1 - pp) * 0.9, true);
      }
      var sp = dying, syy = y - e.r * 0.4 - eOut(sp) * e.r * 2.2;
      glow(ctx, x, syy, e.r * 0.9, e.r * 1.1, soul, sin(sp * PI) * 0.9, true);
      ctx.globalCompositeOperation = op;
      return;
    }
    // status overlays
    var top2 = y + S.top * sc;
    if (frozen) {
      ctx.globalCompositeOperation = 'lighter';
      var gl = fract(t * 0.7 + ph);
      spark(ctx, x + (ph - 0.5) * e.r, top2 + e.r * 0.6 + gl * e.r, 3 * sin(gl * PI) + 0.5, FROST_GLINT, sin(gl * PI));
      ctx.globalCompositeOperation = op;
    }
    // elite crown
    if (e.elite) {
      var cr = crownSpr(), cw = 15 + e.r * 0.12, ch = cw * 14 / 18;
      var bobc = sin(t * 3 + ph * 5) * 1.5;
      ctx.drawImage(cr.frames[0], x + S.topX * sc * dir - cw / 2, top2 - ch - 3 + bobc, cw, ch);
    }
  };

  // ==========================================================================================
  // BOSSES — live vector drawing (one on screen at a time). Designed at r = 48 units, (0,0) = collision
  // centre, ground at y = +40, facing right. Hit flash = palette lerped to white (quantised, cached).
  // ==========================================================================================
  function palF(P, q) {
    if (!q) return P;
    var key = '_f' + q; if (P[key]) return P[key];
    var o = {}; for (var k in P) if (typeof P[k] === 'string' && P[k][0] === '#') o[k] = mix(P[k], '#FFFFFF', q);
    P[key] = o; return o;
  }
  function flamePath(c, x, y, w, h, sway) {
    c.moveTo(x - w, y);
    c.quadraticCurveTo(x - w * 1.1, y - h * 0.5, x + sway, y - h);
    c.quadraticCurveTo(x + w * 1.1, y - h * 0.5, x + w, y);
    c.quadraticCurveTo(x, y + w * 0.5, x - w, y);
  }
  // 3-layer cartoon flame (outer, mid, core)
  function flames(c, x, y, w, h, t, seed, cols) {
    cols = cols || FIRE_COLS;
    for (var L = 0; L < 3; L++) {
      var k = L === 0 ? 1 : L === 1 ? 0.68 : 0.38;
      var hh = h * k * (0.86 + 0.14 * sin(t * 11 + seed * 3.1 + L)), sway = sin(t * 7 + seed * 1.7) * w * 0.5 * k;
      c.beginPath(); flamePath(c, x, y, w * k, hh, sway); c.fillStyle = cols[L]; c.fill();
    }
  }
  var FIRE_COLS = ['#E8401E', '#FF9A2A', '#FFF0A0'];
  var SOUL_COLS = ['#1FA866', '#5CFFA0', '#E6FFF0'];
  var VIOLET_COLS = ['#6A2BB0', '#B57BFF', '#F4E6FF'];

  var BOSS = Object.create(null);

  // ---------- Kurt Kral: crowned alpha wolf with a huge mane and Metin shards in his back
  BOSS.kurtKral = {
    shR: 1.05,
    P: { B: '#5A5A82', S: '#36365A', H: '#8E8EBC', D: '#1F1E33', BEL: '#B4B4D8', SAD: '#3A3858', M: '#2A2742', MS: '#14122A', MH: '#5E6290', MT: '#D8E0F6',
      SN: '#A2A2CA', SNS: '#62628C', CR: '#FFCB57', CRS: '#B8721A', CRH: '#FFF1C4', GEM: '#FF3D4F', CLAW: '#EEE6D2', CY: '#9D6BFF', CYS: '#5A2BB0', CYH: '#E2CCFF',
      MOUTH: '#4A0E1A', TEETH: '#FFFFFF', EYE: '#FFD23A', EYE2: '#FF3D3D', SCAR: '#2A2440' },
    draw: function (c, t, ph, cp, hp, Q, enr) {
      var mv = ph === 'move' || ph === 'enrage', dash = ph === 'dash', cast = ph === 'cast';
      var g = t * (enr ? 10 : 7.5), br = sin(t * (enr ? 5.5 : 2.2));
      var bob = mv ? -abs(sin(g)) * 4 : dash ? 2 : br * 1.2;
      var howl = cast ? sm(cp * 3) : 0, i;
      if (dash) {
        c.globalCompositeOperation = 'lighter';
        for (i = 0; i < 6; i++) {
          var yy = -28 + i * 10 + sin(i * 7.3) * 3, len = 50 + (i % 3) * 22, ph2 = fract(t * 3 + i * 0.37);
          c.globalAlpha = 0.35 * (1 - ph2); c.fillStyle = i % 2 ? '#9D8BFF' : '#D2DAF2';
          c.beginPath(); c.moveTo(-46 - ph2 * 30, yy - 1.5); c.lineTo(-46 - ph2 * 30 - len, yy); c.lineTo(-46 - ph2 * 30, yy + 1.5); c.fill();
        }
        c.globalAlpha = 1; c.globalCompositeOperation = 'source-over';
      }
      if (enr) aglow(c, 0, -14, 100, 72, '#FF2A2A', 0.42 + 0.12 * br);
      c.save(); c.translate(0, 40); c.rotate(dash ? 0.05 : cast ? -0.08 * howl : 0); c.scale(dash ? 1.12 : 1, dash ? 0.9 : 1); c.translate(0, -40);
      function paw(x, y, near) {
        cel(c, function (c) { E(c, x + 2, y - 1, 8, 4.6); }, near ? Q.SN : Q.S, near ? Q.SNS : Q.D, null, 1.6);
        for (var j = 0; j < 3; j++) fl(c, function (c) { c.moveTo(x + 4 + j * 2.6, y - 2); c.quadraticCurveTo(x + 8.4 + j * 2.6, y - 1, x + 8 + j * 2.6, y + 2.6); c.lineTo(x + 5.4 + j * 2.6, y + 0.8); c.closePath(); }, Q.CLAW);
      }
      // hind leg: haunch blob + hock + paw
      function hind(x, lph, near) {
        var sw = mv ? sin(g + lph) * 10 : dash ? -14 : 0, lift = mv ? mx(0, -cos(g + lph)) * 7 : 0;
        var col = near ? Q.B : Q.S, sh = near ? Q.S : Q.D, hi = near ? Q.H : null;
        var hx = x - 6 + sw * 0.5, hy = 26 + bob * 0.4 - lift * 0.5, fx = x + sw, fy = 38 - lift;
        cel(c, function (c) { CAP(c, x - 2, bob + 6, hx, hy, 9, 5); }, col, sh, hi, 2.6, 1.4);
        cel(c, function (c) { CAP(c, hx, hy, fx, fy - 3, 5, 4.4); }, col, sh, hi, 2, 1);
        paw(fx, fy, near);
        cel(c, function (c) { E(c, x + 1, bob + 1, 12.5, 13.5, -0.25); }, col, sh, hi, 3.4, 1.8, true);   // haunch (shading only, no seam)
        c.beginPath(); c.arc(x + 1, bob + 1, 12.8, PI * 0.95, PI * 1.45); strokeW(c, sh, 1.6);
      }
      function fore(x, lph, near) {
        var sw = mv ? sin(g + lph) * 11 : dash ? 15 : 0, lift = mv ? mx(0, -cos(g + lph)) * 7 : 0;
        var col = near ? Q.B : Q.S, sh = near ? Q.S : Q.D, hi = near ? Q.H : null;
        var kx = x + sw * 0.55, ky = 24 + bob * 0.5 - lift * 0.4, fx = x + sw + 2, fy = 38 - lift;
        cel(c, function (c) { CAP(c, x, bob + 4, kx, ky, 8.4, 5.4); }, col, sh, hi, 2.6, 1.4);
        cel(c, function (c) { CAP(c, kx, ky, fx, fy - 3, 5.4, 4.6); }, col, sh, hi, 2, 1);
        // fur tuft at the elbow
        fl(c, function (c) { P(c, [kx - 6, ky - 6, kx - 9, ky + 1, kx - 4, ky - 1]); }, col);
        paw(fx, fy, near);
      }
      // far legs
      hind(-30, PI, false); fore(18, 0, false);
      // big fluffy plume tail (chain of puffs, outer outline only)
      var tw = sin(t * (mv ? 8 : 2.4)) * (mv ? 5 : 3.5) + (dash ? 6 : 0);
      function tail(c) {
        for (var j = 0; j < 7; j++) {
          var s2 = j / 6, tx = -38 - s2 * 36, ty = bob - 8 - sin(s2 * 2.2) * 12 + s2 * s2 * tw * 1.4 - s2 * 4;
          Ci(c, tx, ty, 7 + sin(s2 * PI) * 4.5 - s2 * 1.5);
        }
      }
      blob(c, tail, Q.B, Q.S, Q.H, 2.6, 3, 1.6);
      fl(c, function (c) { var tx = -74, ty = bob - 8 - sin(2.2) * 12 + tw * 1.4 - 4; Ci(c, tx - 1, ty - 1, 5.2); Ci(c, tx + 4, ty - 3, 3.6); }, Q.MT, true);
      // body
      function body(c) {
        c.moveTo(-42, bob - 8);
        c.bezierCurveTo(-34, bob - 22, -8, bob - 24, 12, bob - 22);
        c.quadraticCurveTo(30, bob - 18, 30, bob - 2);
        c.quadraticCurveTo(28, bob + 12, 16, bob + 14);
        c.quadraticCurveTo(-4, bob + 9, -22, bob + 13);
        c.quadraticCurveTo(-42, bob + 14, -46, bob + 2);
        c.quadraticCurveTo(-47, bob - 4, -42, bob - 8);
        c.closePath();
      }
      cel(c, body, Q.B, Q.S, Q.H, 5, 2.4);
      // dark saddle along the back + light belly
      c.save(); c.beginPath(); body(c); c.clip();
      fl(c, function (c) { c.moveTo(-46, bob - 6); c.bezierCurveTo(-30, bob - 26, 0, bob - 26, 20, bob - 20); c.quadraticCurveTo(0, bob - 12, -20, bob - 10); c.quadraticCurveTo(-36, bob - 8, -46, bob - 2); c.closePath(); }, Q.SAD, true);
      fl(c, function (c) { c.moveTo(-26, bob + 14); c.quadraticCurveTo(-4, bob + 6, 18, bob + 15); c.lineTo(18, bob + 20); c.lineTo(-26, bob + 20); c.closePath(); }, Q.BEL, true);
      c.restore();
      // fur strokes
      c.beginPath(); c.moveTo(-30, bob - 4); c.lineTo(-24, bob - 1); c.moveTo(-14, bob - 6); c.lineTo(-8, bob - 3); c.moveTo(-20, bob + 5); c.lineTo(-14, bob + 7); strokeW(c, Q.S, 1.4);
      // Metin shards embedded in the back
      var cgl = 0.7 + 0.3 * sin(t * 3) + (hp < 0.4 ? 0.3 : 0);
      var shards = [[-28, bob - 18, -0.55, 13], [-16, bob - 21, -0.3, 18], [-4, bob - 21, -0.05, 12]];
      for (i = 0; i < shards.length; i++) {
        var sh = shards[i];
        c.save(); c.translate(sh[0], sh[1]); c.rotate(sh[2]);
        cel(c, function (c) { P(c, [-4, 3, -3.4, -sh[3] * 0.65, 0, -sh[3], 3.4, -sh[3] * 0.65, 4, 3]); }, Q.CY, Q.CYS, Q.CYH, 2, 1.2);
        ln(c, 0, -sh[3] + 2, 0, 0, Q.CYH, 0.9);
        c.restore();
        aglow(c, sh[0], sh[1] - sh[3] * 0.5, 14, 14, '#9D6BFF', 0.45 * cgl);
      }
      // near legs
      hind(-36, 0, true); fore(12, PI, true);
      // ---- mane + head (pivot at the neck)
      var hr = cast ? -0.8 * howl : dash ? 0.14 : mv ? sin(g * 2) * 0.04 : br * 0.03;
      var jaw = cast ? 0.6 * howl * (0.85 + 0.15 * sin(t * 18)) : dash ? 0.34 : enr ? 0.2 + 0.08 * sin(t * 6) : 0.05;
      var mr = 30 + br * 0.8;
      function mane(c, rad, n, off, wob) {
        var cx = 22, cy = bob - 16;
        for (var j = 0; j <= n; j++) {
          var an = -PI * 1.05 + j / n * PI * 1.9 + off;
          var rr = rad * (1 + 0.07 * sin(t * 3 + j * 1.7) * wob) * (an > 0.2 && an < 1.4 ? 0.8 : 1);
          var x1 = cx + cos(an - 0.11) * rad * 0.68, y1 = cy + sin(an - 0.11) * rad * 0.68;
          if (j === 0) c.moveTo(x1, y1); else c.lineTo(x1, y1);
          c.quadraticCurveTo(cx + cos(an - 0.03) * rr * 0.92, cy + sin(an - 0.03) * rr * 0.92, cx + cos(an + 0.05) * rr, cy + sin(an + 0.05) * rr);
        }
        c.closePath();
      }
      cel(c, function (c) { mane(c, mr, 15, 0, 1); }, Q.M, Q.MS, Q.MH, 4, 2);
      // silver tips
      c.save(); c.beginPath(); mane(c, mr, 15, 0, 1); c.clip();
      c.beginPath(); mane(c, mr * 0.84, 15, 0.04, 1); c.rect(-200, -200, 400, 400); c.fillStyle = Q.MT; c.fill('evenodd');
      c.restore();
      c.beginPath(); mane(c, mr, 15, 0, 1); c.stroke();
      if (enr) {
        c.globalCompositeOperation = 'lighter';
        for (i = 0; i < 6; i++) { var fa = -PI * 0.95 + i * 0.4; flames(c, 22 + cos(fa) * mr * 0.92, bob - 16 + sin(fa) * mr * 0.92 + 4, 4.5, 16, t, i, ['#B8181E', '#FF4A2A', '#FFC07A']); }
        c.globalCompositeOperation = 'source-over';
      }
      c.save(); c.translate(26, bob - 20); c.rotate(hr); c.scale(1.15, 1.15);
      // back ear
      cel(c, function (c) { P(c, [-3, -16, -1, -36, 7, -19]); }, Q.S, Q.D, null, 2);
      // lower jaw (rotates)
      c.save(); c.translate(14, 3); c.rotate(jaw);
      fl(c, function (c) { c.moveTo(0, -2); c.lineTo(22, -2); c.quadraticCurveTo(24, 3, 18, 5); c.lineTo(2, 6); c.closePath(); }, Q.MOUTH);
      fl(c, function (c) { E(c, 12, 0.5, 6, 2); }, '#E8566E', true);
      cel(c, function (c) { c.moveTo(-2, 0); c.quadraticCurveTo(10, 1.5, 23, -0.5); c.quadraticCurveTo(24.5, 4, 19, 7); c.quadraticCurveTo(8, 9, 0, 6.5); c.closePath(); }, Q.SN, Q.SNS, null, 1.6);
      fl(c, function (c) { P(c, [8, 0.5, 9.5, -4.2, 11, 0.6]); P(c, [17, 0, 18.4, -4.2, 19.6, -0.2]); }, Q.TEETH);
      c.restore();
      // skull
      cel(c, function (c) { c.moveTo(-10, 4); c.bezierCurveTo(-14, -14, 0, -24, 10, -22); c.bezierCurveTo(20, -20, 24, -12, 22, -4); c.lineTo(14, 6); c.quadraticCurveTo(0, 12, -10, 4); c.closePath(); }, Q.B, Q.S, Q.H, 4, 2);
      // cheek fur tufts
      fl(c, function (c) { P(c, [-4, 6, -12, 8, -8, 2, -13, -1, -8, -2]); }, Q.H);
      // snout
      cel(c, function (c) { c.moveTo(12, -13); c.quadraticCurveTo(30, -14, 39, -5); c.quadraticCurveTo(41, 2, 36, 4); c.lineTo(14, 5); c.quadraticCurveTo(8, 3, 8, -3); c.closePath(); }, Q.SN, Q.SNS, '#CACAEA', 2.2, 1.2);
      if (jaw > 0.12) fl(c, function (c) { c.moveTo(16, 4); c.lineTo(36, 3.6); c.quadraticCurveTo(30, 7, 18, 7); c.closePath(); }, Q.MOUTH, true);
      fl(c, function (c) { P(c, [20, 4, 21.4, 9.5, 23, 4]); P(c, [30, 3.6, 31.2, 8.4, 32.6, 3.4]); }, Q.TEETH);
      fl(c, function (c) { E(c, 39, -5.5, 4.4, 3.4); }, '#120C18');
      fl(c, function (c) { E(c, 38, -7.2, 1.6, 0.9); }, '#9A9AC4', true);
      // eye + heavy brow
      var ec = enr ? Q.EYE2 : Q.EYE;
      eye(c, 14, -8, 5.6, 5.2, ec, '#3A0800', { lx: 0.7, slit: true, white: '#FFF6D8' });
      fl(c, function (c) { c.moveTo(5, -16); c.quadraticCurveTo(14, -18, 22, -11); c.lineTo(20, -9.5); c.quadraticCurveTo(13, -14, 6, -13); c.closePath(); }, Q.SAD);
      // claw scars on the forehead (do not cross the eye)
      c.lineCap = 'round';
      c.beginPath(); c.moveTo(2, -21); c.lineTo(7, -15); c.moveTo(6, -23); c.lineTo(11, -17); if (hp < 0.5) { c.moveTo(-2, -18); c.lineTo(2, -12.5); } strokeW(c, Q.SCAR, 2.2);
      c.beginPath(); c.moveTo(2.6, -20.6); c.lineTo(6.4, -15.8); c.moveTo(6.6, -22.6); c.lineTo(10.4, -17.8); strokeW(c, '#C8486A', 0.8);
      // front ear (notched)
      cel(c, function (c) { P(c, [0, -18, 3, -41, 7.5, -34, 10, -37, 14, -19]); }, Q.B, Q.S, Q.H, 2, 1.1);
      fl(c, function (c) { P(c, [3.6, -20, 4.6, -33, 10, -21]); }, '#2A2440', true);
      // crown between the ears (tilted; cracked + gem lost when hurt)
      c.save(); c.translate(-3, -22); c.rotate(-0.28 - (hp < 0.5 ? 0.1 : 0));
      cel(c, function (c) { P(c, [-10, 3, -12, -9, -6, -3, -2, -13, 2, -4, 7, -14, 9, -3, 13, -10, 12, 3]); }, Q.CR, Q.CRS, Q.CRH, 2, 1.2);
      fl(c, function (c) { RR(c, -11, 0, 23, 4.4, 1.6); }, Q.CRS);
      fl(c, function (c) { Ci(c, 1, 2.2, 2); }, Q.GEM);
      if (hp >= 0.5) fl(c, function (c) { Ci(c, -6, 2.2, 1.4); Ci(c, 7.6, 2.2, 1.4); }, '#4BA3FF');
      else { fl(c, function (c) { Ci(c, -6, 2.2, 1.4); }, '#4BA3FF'); fl(c, function (c) { Ci(c, 7.6, 2.2, 1.4); }, '#120C18', true); c.beginPath(); c.moveTo(3, -4); c.lineTo(4.5, 0); c.lineTo(3.2, 3); strokeW(c, '#120C18', 1.1); }
      fl(c, function (c) { Ci(c, -12, -9.6, 1.4); Ci(c, -2, -13.6, 1.5); Ci(c, 7, -14.6, 1.5); Ci(c, 13, -10.6, 1.4); }, Q.CRH);
      c.restore();
      c.globalCompositeOperation = 'lighter';
      glow(c, 14.5, -8, 16, 13, enr ? '#FF2A2A' : '#FFB020', 0.7);
      if (dash) { for (i = 1; i < 5; i++) glow(c, 14.5 - i * 9, -8 + i * 0.6, 7 - i, 4, enr ? '#FF2A2A' : '#FFB020', 0.5 - i * 0.1); }
      c.globalCompositeOperation = 'source-over';
      if (cast && howl > 0.2) {
        c.globalCompositeOperation = 'lighter'; c.lineCap = 'round';
        for (i = 0; i < 4; i++) {
          var pp = fract(t * 1.6 + i / 4), rr2 = 10 + pp * 64;
          c.globalAlpha = (1 - pp) * 0.75 * howl; c.strokeStyle = i % 2 ? '#C9B6FF' : '#FFFFFF'; c.lineWidth = 4 * (1 - pp) + 1;
          c.beginPath(); c.arc(42, 0, rr2, -0.6, 0.6); c.stroke();
        }
        c.globalAlpha = 1; c.globalCompositeOperation = 'source-over';
      }
      c.restore();
      c.restore();
    }
  };

  // ---------- Kemik Ejder: bone dragon with green soul fire in the ribcage and eyes
  function boneLine(c, x1, y1, x2, y2, w, Q) {
    rope(c, function (c) { c.moveTo(x1, y1); c.lineTo(x2, y2); }, Q.BN, w, 1.4);
    fl(c, function (c) { Ci(c, x1, y1, w * 0.75); Ci(c, x2, y2, w * 0.75); }, Q.BN);
    ln(c, x1 + (x2 - x1) * 0.2, y1 + (y2 - y1) * 0.2 - w * 0.2, x1 + (x2 - x1) * 0.8, y1 + (y2 - y1) * 0.8 - w * 0.2, Q.BH, w * 0.28);
  }
  function boneWing(c, sx, sy, flap, Q, far, t) {
    var ex = sx - 18, ey = sy - 40 + flap, wx = ex - 26, wy = ey - 10 + flap * 0.5;
    var tips = [[wx - 26, wy + 30], [wx - 14, wy + 40], [wx + 2, wy + 44], [ex + 4, ey + 40]];
    // tattered membrane
    c.beginPath(); c.moveTo(sx, sy); c.lineTo(ex, ey); c.lineTo(wx, wy);
    for (var i = 0; i < tips.length; i++) {
      var tp = tips[i], prev = i ? tips[i - 1] : [wx, wy];
      if (i) { var mx1 = (prev[0] + tp[0]) / 2 + 4, my1 = (prev[1] + tp[1]) / 2 - 8; c.quadraticCurveTo(mx1, my1, tp[0], tp[1]); }
      else c.lineTo(tp[0], tp[1]);
    }
    c.quadraticCurveTo(sx - 6, sy + 4, sx, sy); c.closePath();
    c.fillStyle = far ? 'rgba(14,26,24,0.88)' : 'rgba(26,44,40,0.86)'; c.fill(); c.stroke();
    // holes / tears
    c.fillStyle = far ? '#0A1412' : '#0E1C18';
    c.beginPath(); E(c, wx - 6, wy + 24, 3, 5, 0.4); E(c, ex - 8, ey + 22, 2.4, 3.6, -0.3); c.fill();
    // soul glow veins
    c.globalCompositeOperation = 'lighter';
    glow(c, wx - 4, wy + 18, 20, 18, '#2BFF8A', far ? 0.12 : 0.2);
    c.globalCompositeOperation = 'source-over';
    var BP = far ? { BN: Q.BS, BH: Q.BN } : Q;
    boneLine(c, sx, sy, ex, ey, 4.4, BP); boneLine(c, ex, ey, wx, wy, 3.6, BP);
    for (i = 0; i < tips.length; i++) boneLine(c, wx, wy, tips[i][0], tips[i][1], 2.2, BP);
    fl(c, function (c) { P(c, [wx - 2, wy - 2, wx + 3, wy - 9, wx + 4, wy]); }, BP.BN);
  }
  BOSS.kemikEjder = {
    shR: 1.1,
    P: { BN: '#EDE6D2', BS: '#A99C80', BH: '#FFFBEF', D: '#2A2222', IN: '#0C1A14', HORN: '#3A3230', HORNH: '#6A5E58' },
    draw: function (c, t, ph, cp, hp, Q, enr) {
      var mv = ph === 'move' || ph === 'enrage', dash = ph === 'dash', cast = ph === 'cast';
      var g = t * (enr ? 7 : 5), br = sin(t * 2);
      var bob = mv ? -abs(sin(g)) * 3 : br * 1.4;
      var breath = cast ? sm(cp * 2.2) : 0;
      var flap = cast ? -12 * breath + sin(t * 9) * 3 : sin(t * (mv ? 5 : 2.2)) * 7;
      var P2 = Q;
      if (enr) aglow(c, 0, -30, 110, 80, '#1FFF7A', 0.28 + 0.1 * br);
      c.save(); c.translate(0, 40); c.rotate(dash ? 0.08 : 0); c.translate(0, -40);
      // far wing
      boneWing(c, 2, bob - 26, flap + 4, P2, true, t);
      // tail (vertebrae chain)
      var n = 11, pts = [];
      for (var i = 0; i < n; i++) {
        var s = i / (n - 1);
        pts.push([-26 - s * 56, bob - 6 + sin(s * 3.2 - t * (mv ? 5 : 2)) * 6 * s - s * 14 + s * s * 12, 6.2 * (1 - s * 0.72)]);
      }
      for (i = n - 1; i >= 0; i--) {
        var pt = pts[i];
        cel(c, function (c) { P(c, [pt[0] - pt[2] * 0.5, pt[1] - pt[2] * 0.7, pt[0], pt[1] - pt[2] * 2.1, pt[0] + pt[2] * 0.5, pt[1] - pt[2] * 0.7]); }, P2.BS, P2.D, null, 1);
        cel(c, function (c) { E(c, pt[0], pt[1], pt[2], pt[2] * 0.85); }, P2.BN, P2.BS, P2.BH, 1.4, 0.8);
      }
      fl(c, function (c) { var tp = pts[n - 1]; P(c, [tp[0] + 1, tp[1] - 3, tp[0] - 10, tp[1] - 1, tp[0] + 1, tp[1] + 3]); }, P2.BN);
      // legs
      function leg(x, lph, near, front) {
        var sw = mv ? sin(g + lph) * 9 : dash ? (front ? 10 : -10) : 0, lift = mv ? mx(0, -cos(g + lph)) * 6 : 0;
        var hx = x, hy = bob + 2, kx = x + (front ? -6 : 8) + sw * 0.4, ky = 20 + bob * 0.4 - lift * 0.4, fx = x + sw, fy = 37 - lift;
        var BP = near ? P2 : { BN: P2.BS, BH: P2.BN, BS: P2.D };
        boneLine(c, hx, hy, kx, ky, near ? 5 : 4.4, BP); boneLine(c, kx, ky, fx, fy - 2, near ? 4.2 : 3.6, BP);
        for (var j = 0; j < 3; j++) fl(c, function (c) { c.moveTo(fx - 2 + j * 3.5, fy - 2); c.quadraticCurveTo(fx + 3 + j * 3.5, fy - 1, fx + 4 + j * 3.6, fy + 2.4); c.lineTo(fx + j * 3.5, fy + 1); c.closePath(); }, BP.BN);
      }
      leg(-24, PI, false, false); leg(16, 0, false, true);
      // ribcage interior + soul fire
      var rx0 = -4, ry0 = bob - 8;
      fl(c, function (c) { E(c, rx0, ry0, 25, 16); }, P2.IN, true);
      c.globalCompositeOperation = 'lighter';
      glow(c, rx0, ry0 + 2, 30, 22, '#2BFF8A', 0.75 + 0.15 * sin(t * 6) + enr * 0.2, true);
      c.globalCompositeOperation = 'source-over';
      c.save(); c.beginPath(); E(c, rx0, ry0, 25, 16); c.clip();
      for (i = 0; i < 5; i++) flames(c, rx0 - 16 + i * 8, ry0 + 15, 5.5, 18 + (i % 2) * 6 + enr * 8, t, i + 3, SOUL_COLS);
      c.restore();
      // spine + spikes
      for (i = 0; i < 9; i++) {
        var sx2 = -28 + i * 6, sy2 = bob - 22 - sin(i / 8 * PI) * 4;
        cel(c, function (c) { P(c, [sx2 - 2.4, sy2, sx2 - 1, sy2 - 7 - (i % 2) * 2, sx2 + 2.4, sy2]); }, P2.BS, P2.D, null, 1);
        cel(c, function (c) { E(c, sx2, sy2, 3.4, 2.8); }, P2.BN, P2.BS, P2.BH, 1, 0.6);
        if (enr) { c.globalCompositeOperation = 'lighter'; flames(c, sx2, sy2 - 4, 2.4, 10, t, i, SOUL_COLS); c.globalCompositeOperation = 'source-over'; }
      }
      // ribs
      for (i = 0; i < 6; i++) {
        var rbx = -22 + i * 7.6, rtop = bob - 22 - sin((i + 1) / 7 * PI) * 3.5, rbot = ry0 + 14 - abs(i - 2.5) * 1.4;
        rope(c, function (c) { c.moveTo(rbx, rtop); c.bezierCurveTo(rbx - 9, rtop + 8, rbx - 8, rbot - 4, rbx + 2, rbot); }, P2.BN, 3.4, 1.3);
        ln(c, rbx - 1, rtop + 3, rbx - 5.5, rtop + 10, P2.BH, 1);
      }
      // sternum
      rope(c, function (c) { c.moveTo(-22, ry0 + 13); c.quadraticCurveTo(-2, ry0 + 18, 16, ry0 + 10); }, P2.BS, 3, 1.3);
      // pelvis + scapula
      cel(c, function (c) { c.moveTo(-34, bob - 16); c.quadraticCurveTo(-26, bob - 24, -20, bob - 14); c.quadraticCurveTo(-22, bob - 4, -30, bob - 2); c.quadraticCurveTo(-37, bob - 8, -34, bob - 16); c.closePath(); }, P2.BN, P2.BS, P2.BH, 2, 1);
      cel(c, function (c) { c.moveTo(8, bob - 24); c.quadraticCurveTo(20, bob - 26, 22, bob - 14); c.quadraticCurveTo(14, bob - 8, 8, bob - 12); c.closePath(); }, P2.BN, P2.BS, P2.BH, 2, 1);
      leg(-30, 0, true, false); leg(12, PI, true, true);
      // near wing
      boneWing(c, 8, bob - 24, flap, P2, false, t);
      // neck (vertebrae) + head
      var lunge = dash ? 1 : 0, rear = breath;
      var hx = 40 + lunge * 10 - rear * 4, hy = bob - 46 + lunge * 12 - rear * 8;
      for (i = 0; i < 6; i++) {
        var s2 = i / 5, nx = lerp(16, hx - 6, s2) + sin(s2 * PI) * -6, ny = lerp(bob - 22, hy + 4, s2) - sin(s2 * PI) * 4;
        cel(c, function (c) { P(c, [nx - 2.4, ny - 2, nx - 1, ny - 9, nx + 2.4, ny - 2]); }, P2.BS, P2.D, null, 1);
        cel(c, function (c) { E(c, nx, ny, 4.6 - s2, 4 - s2 * 0.8); }, P2.BN, P2.BS, P2.BH, 1.2, 0.7);
      }
      var jaw = cast ? 0.75 * breath : dash ? 0.38 : enr ? 0.22 + 0.08 * sin(t * 5) : 0.06 + 0.04 * br;
      c.save(); c.translate(hx, hy); c.rotate(dash ? 0.12 : cast ? -0.12 * breath : br * 0.03); c.scale(1.22, 1.22);
      // horns (back)
      cel(c, function (c) { c.moveTo(-6, -8); c.bezierCurveTo(-14, -16, -24, -14, -30, -6); c.quadraticCurveTo(-22, -12, -10, -4); c.closePath(); }, P2.HORN, '#1E1818', P2.HORNH, 1.4, 0.8);
      // lower jaw
      c.save(); c.translate(0, 4); c.rotate(jaw);
      fl(c, function (c) { c.moveTo(-2, -1); c.lineTo(22, 0); c.lineTo(20, -5); c.lineTo(0, -6); c.closePath(); }, '#0C1A14', true);
      cel(c, function (c) { c.moveTo(-5, -1); c.lineTo(24, 0.5); c.quadraticCurveTo(28, 3, 24, 7); c.quadraticCurveTo(10, 9, -3, 7); c.closePath(); }, P2.BN, P2.BS, P2.BH, 1.6, 0.8);
      for (i = 0; i < 5; i++) fl(c, function (c) { P(c, [4 + i * 4, 0.2, 5.2 + i * 4, -3.6, 6.4 + i * 4, 0.4]); }, P2.BH);
      c.restore();
      // mouth glow while breathing
      if (cast || enr) {
        c.globalCompositeOperation = 'lighter';
        glow(c, 14, 4 + jaw * 8, 16 + breath * 20, 10 + breath * 14, '#2BFF8A', 0.5 + breath * 0.5, true);
        if (breath > 0.5) { c.save(); c.translate(20, 3 + jaw * 6); c.rotate(jaw * 0.5 - HP); for (i = 0; i < 3; i++) flames(c, (i - 1) * 3, 4, 3.4, 10 + breath * 12, t, i + 20, SOUL_COLS); c.restore(); }
        c.globalCompositeOperation = 'source-over';
      }
      // skull (big cranium, long snout)
      cel(c, function (c) { c.moveTo(-8, 2); c.bezierCurveTo(-12, -14, 4, -18, 10, -10); c.quadraticCurveTo(20, -8, 28, -3); c.quadraticCurveTo(31, 0, 28, 3); c.lineTo(2, 4.5); c.quadraticCurveTo(-6, 6, -8, 2); c.closePath(); }, P2.BN, P2.BS, P2.BH, 2.4, 1.2);
      for (i = 0; i < 5; i++) fl(c, function (c) { P(c, [5 + i * 4.4, 3.6, 6.2 + i * 4.4, 7.6, 7.4 + i * 4.4, 3.4]); }, P2.BH);
      // nostrils, cheek hole
      fl(c, function (c) { E(c, 25, -2, 1.5, 1); E(c, 6, 0, 3.4, 2); }, '#1A1414', true);
      // front horn
      cel(c, function (c) { c.moveTo(-2, -12); c.bezierCurveTo(-8, -24, -20, -26, -28, -20); c.quadraticCurveTo(-16, -20, -8, -8); c.closePath(); }, P2.HORN, '#1E1818', P2.HORNH, 1.6, 0.9);
      // eye socket + soul fire
      fl(c, function (c) { E(c, 1, -6.5, 5.6, 5); }, '#0A1410');
      c.globalCompositeOperation = 'lighter';
      glow(c, 1.4, -6.5, 12, 11, '#2BFF8A', 0.85 + enr * 0.15, true);
      flames(c, 1.6, -4, 2.8, 12 + enr * 6, t, 1, SOUL_COLS);
      c.globalCompositeOperation = 'source-over';
      fl(c, function (c) { Ci(c, 2, -6.4, 1.8); }, '#E6FFF0', true);
      // cracks when hurt
      if (hp < 0.5) { c.beginPath(); c.moveTo(-6, -10); c.lineTo(-2, -4); c.lineTo(-5, 0); strokeW(c, '#3A2E2A', 1); }
      c.restore();
      // breath charge: soul motes spiralling into the mouth
      if (cast && breath > 0.05) {
        c.globalCompositeOperation = 'lighter';
        for (i = 0; i < 10; i++) {
          var pp = fract(t * 1.4 + i / 10), ang = i * 2.4 + t * 2, rad = (1 - pp) * 46;
          glow(c, hx + 16 + cos(ang) * rad, hy + 6 + sin(ang) * rad * 0.6, 4, 4, '#5CFFA0', pp * breath);
        }
        c.globalCompositeOperation = 'source-over';
      }
      c.restore();
    }
  };

  // ---------- Kor İblisi: ember demon with molten cracks, ram horns and a flame mane
  var KOR_CRACKS = [
    [[-4, -32], [-6, -26], [-3, -21], [-7, -15], [-5, -9], [-8, -5]], [[13, -28], [15, -22], [11, -17], [15, -11], [13, -6]],
    [[-6, -26], [-11, -23], [-14, -24]], [[11, -17], [6, -14], [4, -16]], [[-22, -16], [-18, -11], [-21, -6], [-17, -1]],
    [[23, -14], [20, -8], [24, -3], [22, 2]], [[-27, 0], [-23, 5], [-26, 10], [-23, 14]], [[26, 4], [22, 9], [25, 14]],
    [[-12, -36], [-7, -33], [-3, -36]], [[4, -37], [8, -33], [12, -35]], [[-17, -1], [-12, 1]], [[-23, 14], [-18, 17]]];
  BOSS.korIblisi = {
    shR: 1.0,
    P: { SK: '#3E2428', SKS: '#1F1014', SKH: '#6A4448', BEL: '#5A2A24', BELH: '#7E3E30', HORN: '#EDE0C8', HORNS: '#A8946E', HORNH: '#FFFFFF', HD: '#2A1E1E',
      WING: '#5A1A22', WINGS: '#2E0C12', LAVA: '#FF7A2F', LAVA2: '#FFD27A', MOUTH: '#3A0A06', TEETH: '#FFF4E0', HOOF: '#1E1418' },
    draw: function (c, t, ph, cp, hp, Q, enr) {
      var mv = ph === 'move' || ph === 'enrage', dash = ph === 'dash', cast = ph === 'cast';
      var g = t * (enr ? 8 : 5.5), br = sin(t * (enr ? 5 : 2));
      var step = mv ? sin(g) : 0, bob = mv ? -abs(sin(g)) * 3.5 : br * 1.5;
      var raise = cast ? sm(cp * 2.5) : 0;
      var heat = enr ? 1 : 0.55 + (1 - hp) * 0.35;
      // lava pool glow under
      c.globalCompositeOperation = 'lighter';
      glow(c, 0, 38, 62, 18, '#FF5A1A', 0.45 + 0.15 * sin(t * 3) + enr * 0.25);
      if (enr) glow(c, 0, -20, 100, 85, '#FF2A1A', 0.3 + 0.1 * br);
      c.globalCompositeOperation = 'source-over';
      c.save(); c.translate(0, 40); c.rotate((dash ? 0.16 : 0) + step * 0.03); c.translate(0, -40);
      // wings
      var wf = sin(t * (mv ? 6 : 2.6)) * 0.12 + (cast ? -0.25 * raise : 0);
      for (var s = -1; s <= 1; s += 2) {
        c.save(); c.translate(s * 18, bob - 20); c.rotate(s * wf); c.scale(s, 1);
        cel(c, function (c) { c.moveTo(0, 0); c.lineTo(18, -26); c.lineTo(38, -32); c.quadraticCurveTo(34, -22, 40, -12); c.quadraticCurveTo(30, -14, 30, -4); c.quadraticCurveTo(22, -8, 18, 4); c.quadraticCurveTo(10, -2, 0, 8); c.closePath(); }, Q.WING, Q.WINGS, null, 2.4);
        rope(c, function (c) { c.moveTo(0, 0); c.lineTo(18, -26); c.lineTo(38, -32); }, Q.SKH, 2.6, 1.2);
        c.restore();
      }
      // tail with flame tip
      var tw = sin(t * 3) * 5;
      rope(c, function (c) { c.moveTo(-10, bob + 14); c.bezierCurveTo(-30, bob + 22, -40, bob + 10 + tw, -46, bob - 2 + tw); }, Q.SK, 4.4, 1.4);
      c.globalCompositeOperation = 'lighter'; glow(c, -46, bob - 4 + tw, 9, 9, '#FF7A2F', 0.8, true); c.globalCompositeOperation = 'source-over';
      flames(c, -46, bob - 1 + tw, 3.6, 13, t, 7);
      // legs (digitigrade, hooves)
      function leg(sx, lph) {
        var lift = mv ? mx(0, sin(g + lph)) * 6 : 0, fw = dash ? -6 : 0;
        var hx = sx * 13, hy = bob + 10, kx = sx * 18 + fw, ky = 24 + bob * 0.5 - lift * 0.5, fx = sx * 15 + fw * 1.5, fy = 37 - lift;
        cel(c, function (c) { CAP(c, hx, hy, kx, ky, 9, 6.5); }, Q.SK, Q.SKS, Q.SKH, 2.6, 1.4);
        cel(c, function (c) { CAP(c, kx, ky, fx, fy - 2, 6.5, 5); }, Q.SK, Q.SKS, Q.SKH, 2.2, 1.1);
        cel(c, function (c) { RR(c, fx - 6, fy - 4, 12, 6, 2.6); }, Q.HOOF, '#000000', '#4A3A40', 1.2);
        ln(c, fx, fy - 3.4, fx, fy + 1.6, '#000000', 1);
      }
      leg(-1, 0); leg(1, PI);
      // arms
      function arm(sx) {
        var shx = sx * 27, shy = bob - 16;
        var ex = sx * (38 - raise * 4), ey = lerp(bob + 0, bob - 36, raise), fx = sx * lerp(38 + (mv ? sin(g + (sx > 0 ? 0 : PI)) * 4 : 0), 20, raise), fy = lerp(bob + 16, bob - 58, raise);
        if (dash) { fx = sx * 30 + 10; fy = bob + 10; ex = sx * 34 + 6; ey = bob - 2; }
        cel(c, function (c) { CAP(c, shx, shy, ex, ey, 10, 8); }, Q.SK, Q.SKS, Q.SKH, 2.6, 1.4);
        cel(c, function (c) { CAP(c, ex, ey, fx, fy, 8, 7); }, Q.SK, Q.SKS, Q.SKH, 2.4, 1.2);
        // molten fist
        cel(c, function (c) { Ci(c, fx, fy, 9.5); }, Q.SK, Q.SKS, Q.SKH, 2.4, 1.2);
        c.beginPath(); c.moveTo(fx - 5, fy - 3); c.lineTo(fx - 1, fy + 1); c.lineTo(fx + 4, fy - 4); c.moveTo(fx - 2, fy + 6); c.lineTo(fx + 2, fy + 2);
        strokeW(c, Q.LAVA, 2.2);
        c.globalCompositeOperation = 'lighter'; glow(c, fx, fy, 16, 16, '#FF6A1F', 0.55 * heat + 0.2, true); c.globalCompositeOperation = 'source-over';
        // shoulder spike pad
        cel(c, function (c) { c.moveTo(shx - sx * 9, shy - 4); c.quadraticCurveTo(shx, shy - 14, shx + sx * 10, shy - 2); c.lineTo(shx + sx * 4, shy + 6); c.closePath(); }, Q.HD, '#120C10', Q.SKH, 1.6);
        cel(c, function (c) { P(c, [shx - sx * 2, shy - 9, shx + sx * 3, shy - 20, shx + sx * 5, shy - 7]); }, Q.HORN, Q.HORNS, null, 1);
      }
      arm(-1);
      // torso
      cel(c, function (c) { c.moveTo(-28, bob - 18); c.bezierCurveTo(-34, bob - 44, 34, bob - 44, 28, bob - 18); c.bezierCurveTo(36, bob + 4, 24, bob + 20, 0, bob + 20); c.bezierCurveTo(-24, bob + 20, -36, bob + 4, -28, bob - 18); c.closePath(); }, Q.SK, Q.SKS, Q.SKH, 5, 2.4);
      cel(c, function (c) { E(c, 2, bob + 4, 17, 14); }, Q.BEL, Q.SKS, Q.BELH, 2.4, 1.2);
      // belly plates
      c.beginPath(); c.moveTo(-12, bob - 2); c.quadraticCurveTo(2, bob + 2, 16, bob - 2); c.moveTo(-14, bob + 6); c.quadraticCurveTo(2, bob + 10, 18, bob + 6); c.moveTo(-10, bob + 13); c.quadraticCurveTo(2, bob + 16, 14, bob + 13);
      strokeW(c, Q.SKS, 1.4);
      // molten cracks (more appear as HP drops)
      var nCr = 3 + round((1 - hp) * (KOR_CRACKS.length - 3));
      var ccol = enr ? '#FFF2C0' : Q.LAVA2;
      c.lineCap = 'round'; c.lineJoin = 'round';
      for (var i = 0; i < nCr; i++) {
        var cr = KOR_CRACKS[i];
        c.beginPath(); c.moveTo(cr[0][0], cr[0][1] + bob); for (var j = 1; j < cr.length; j++) c.lineTo(cr[j][0], cr[j][1] + bob);
        strokeW(c, Q.LAVA, 2.6); strokeW(c, ccol, 0.9);
      }
      c.lineWidth = 2.6;
      // chest core (Metin shard)
      cel(c, function (c) { P(c, [0, bob - 22, 6, bob - 14, 0, bob - 4, -6, bob - 14]); }, '#FF8A2A', '#B8300E', '#FFF0A0', 1.6, 1);
      c.globalCompositeOperation = 'lighter';
      glow(c, 0, bob - 14, 22, 22, '#FF6A1F', 0.55 + 0.25 * sin(t * 4) + enr * 0.3, true);
      for (i = 0; i < nCr; i += 2) { var cr2 = KOR_CRACKS[i]; glow(c, cr2[1][0], cr2[1][1] + bob, 9, 9, '#FF6A1F', 0.4 * heat); }
      c.globalCompositeOperation = 'source-over';
      arm(1);
      // head
      var hx = dash ? 8 : 3, hy = bob - 38 + (dash ? 6 : 0);
      c.save(); c.translate(hx, hy); c.scale(1.14, 1.14); c.translate(-hx, -hy);
      // flame mane behind
      c.globalCompositeOperation = 'lighter';
      glow(c, hx, hy - 12, 34, 30, '#FF5A1A', 0.5 + enr * 0.25);
      c.globalCompositeOperation = 'source-over';
      for (i = 0; i < 5; i++) flames(c, hx - 14 + i * 7, hy - 4, 6, 22 + (i % 2) * 8 + enr * 10 - abs(i - 2) * 3, t, i, enr ? ['#FF2A1A', '#FF9A2A', '#FFFFFF'] : FIRE_COLS);
      // horns (ram curl)
      for (s = -1; s <= 1; s += 2) {
        cel(c, function (c) {
          c.moveTo(hx + s * 8, hy - 8);
          c.bezierCurveTo(hx + s * 22, hy - 30, hx + s * 42, hy - 24, hx + s * 40, hy - 8);
          c.quadraticCurveTo(hx + s * 39, hy, hx + s * 33, hy - 2);
          c.quadraticCurveTo(hx + s * 36, hy - 8, hx + s * 33, hy - 14);
          c.bezierCurveTo(hx + s * 28, hy - 20, hx + s * 20, hy - 14, hx + s * 14, hy - 2);
          c.closePath();
        }, Q.HORN, Q.HORNS, Q.HORNH, 2.4, 1.2);
        c.beginPath(); c.moveTo(hx + s * 20, hy - 20); c.lineTo(hx + s * 24, hy - 14); c.moveTo(hx + s * 28, hy - 24); c.lineTo(hx + s * 30, hy - 17); c.moveTo(hx + s * 36, hy - 21); c.lineTo(hx + s * 34, hy - 15); strokeW(c, Q.HORNS, 1.2);
      }
      // face
      cel(c, function (c) { c.moveTo(hx - 15, hy); c.bezierCurveTo(hx - 16, hy - 20, hx + 16, hy - 20, hx + 15, hy); c.quadraticCurveTo(hx + 14, hy + 13, hx, hy + 14); c.quadraticCurveTo(hx - 14, hy + 13, hx - 15, hy); c.closePath(); }, Q.SK, Q.SKS, Q.SKH, 2.6, 1.3);
      // eyes: white-hot, angry
      var ex2 = hx + 3, ec = enr ? '#FFFFFF' : '#FFF2A0';
      fl(c, function (c) { c.moveTo(ex2 - 11, hy - 6); c.lineTo(ex2 - 3, hy - 3.5); c.lineTo(ex2 - 4, hy + 0.5); c.quadraticCurveTo(ex2 - 9, hy + 1, ex2 - 11, hy - 6); c.closePath(); c.moveTo(ex2 + 10, hy - 6); c.lineTo(ex2 + 2, hy - 3.5); c.lineTo(ex2 + 3, hy + 0.5); c.quadraticCurveTo(ex2 + 8, hy + 1, ex2 + 10, hy - 6); c.closePath(); }, ec);
      fl(c, function (c) { Ci(c, ex2 - 5.5, hy - 2.2, 1.4); Ci(c, ex2 + 5.6, hy - 2.2, 1.4); }, '#7A1A00', true);
      ln(c, ex2 - 13, hy - 9.5, ex2 - 2, hy - 5, OUT, 2.8); ln(c, ex2 + 12, hy - 9.5, ex2 + 1, hy - 5, OUT, 2.8);
      // grin + fangs, glowing mouth
      var mo = cast ? 2 + raise * 3 : dash ? 3 : 1.2 + br * 0.4;
      fl(c, function (c) { c.moveTo(ex2 - 9, hy + 5); c.quadraticCurveTo(ex2, hy + 9 + mo * 1.4, ex2 + 9, hy + 5); c.quadraticCurveTo(ex2, hy + 7, ex2 - 9, hy + 5); }, Q.MOUTH);
      c.globalCompositeOperation = 'lighter'; glow(c, ex2, hy + 7, 8, 4 + mo, '#FF6A1F', 0.7); c.globalCompositeOperation = 'source-over';
      fl(c, function (c) { P(c, [ex2 - 7, hy + 5.4, ex2 - 5.6, hy + 9.6, ex2 - 4.2, hy + 6]); P(c, [ex2 + 4.2, hy + 6, ex2 + 5.6, hy + 9.6, ex2 + 7, hy + 5.4]); P(c, [ex2 - 2, hy + 6.6, ex2 - 1, hy + 9, ex2, hy + 6.8]); P(c, [ex2 + 0.6, hy + 6.8, ex2 + 1.6, hy + 9, ex2 + 2.6, hy + 6.6]); }, Q.TEETH);
      c.globalCompositeOperation = 'lighter';
      glow(c, ex2 - 6, hy - 3, 9, 7, enr ? '#FF3A1A' : '#FFB020', 0.8); glow(c, ex2 + 6, hy - 3, 9, 7, enr ? '#FF3A1A' : '#FFB020', 0.8);
      c.globalCompositeOperation = 'source-over';
      c.restore();
      // cast: a round fireball grows above the raised fists
      if (cast && raise > 0.1) {
        var fr = 5 + raise * 15 + sin(t * 14) * 1.2, fy2 = bob - 80;
        c.globalCompositeOperation = 'lighter';
        glow(c, 0, fy2, fr * 3.4, fr * 3.4, '#FF5A1A', 0.8 * raise, true);
        c.globalCompositeOperation = 'source-over';
        for (i = 0; i < 6; i++) { var fa2 = -PI / 2 + (i - 2.5) * 0.42; flames(c, cos(fa2) * fr * 0.7, fy2 + sin(fa2) * fr * 0.7 + fr * 0.2, fr * 0.36, fr * 1.15, t, i + 11); }
        fl(c, function (c) { Ci(c, 0, fy2, fr); }, '#E8401E', true);
        fl(c, function (c) { Ci(c, -fr * 0.12, fy2 - fr * 0.1, fr * 0.76); }, '#FF9A2A', true);
        fl(c, function (c) { Ci(c, -fr * 0.22, fy2 - fr * 0.2, fr * 0.46); }, '#FFF0A0', true);
        c.globalCompositeOperation = 'lighter';
        glow(c, 0, fy2, fr * 1.5, fr * 1.5, '#FFD27A', 0.6 * raise, true);
        for (i = 0; i < 8; i++) { var an2 = t * 3 + i * TAU / 8, rr3 = fr * (1.7 + 0.4 * sin(t * 5 + i)); glow(c, cos(an2) * rr3, fy2 + sin(an2) * rr3, 4, 4, '#FFB04A', 0.7 * raise); }
        c.globalCompositeOperation = 'source-over';
      }
      // rising embers
      c.globalCompositeOperation = 'lighter';
      for (i = 0; i < 8; i++) {
        var ep = fract(t * 0.45 + i * 0.137), exx = sin(i * 12.9 + ep * 3) * 34, eyy = bob + 10 - ep * 90;
        glow(c, exx, eyy, 3, 3, i % 3 ? '#FF9A2A' : '#FFE07A', (1 - ep) * 0.9);
      }
      c.globalCompositeOperation = 'source-over';
      c.restore();
    }
  };

  Art.drawBoss = function (ctx, b, t) {
    if (!b) return;
    t = t || 0;
    var def = enDef(b.type) || {};
    var B = BOSS[b.type] || BOSS[def.art] || BOSS.kurtKral;
    var r = b.r || def.r || 48, u = r / 48, dir = b.dir < 0 ? -1 : 1;
    var ph = b.phase || 'idle', cp = clamp(b.castP || 0, 0, 1), enr = ph === 'enrage' ? 1 : 0;
    var hp = b.hpPct == null ? 1 : clamp(b.hpPct, 0, 1);
    var ht = b.hitT, fq = 0, sx = 1, sy = 1;
    if (ht != null && ht >= 0 && ht < 0.1) fq = round((1 - ht / 0.1) * 3) / 4;
    if (ht != null && ht >= 0 && ht < 0.22) { var q = sin(ht / 0.22 * PI) * (1 - ht / 0.22); sx = 1 + 0.07 * q; sy = 1 - 0.06 * q; }
    var ga = ctx.globalAlpha, op = ctx.globalCompositeOperation;
    ctx.save();
    var jx = enr ? (hashN(floor(t * 30)) - 0.5) * 2.2 : 0;
    ctx.translate(b.x + jx, b.y);
    shadow(ctx, 0, 40 * u, 54 * u * B.shR, 13 * u, 1);
    ctx.translate(0, 40 * u); ctx.scale(dir * u * sx, u * sy); ctx.translate(0, -40);
    setLine(ctx, 2.6);
    try { B.draw(ctx, t, ph, cp, hp, palF(B.P, fq), enr); }
    catch (err) { if (typeof console !== 'undefined' && !B._err) { B._err = 1; console.error('[GM.Art.drawBoss]', err); } }
    ctx.restore();
    ctx.globalAlpha = ga; ctx.globalCompositeOperation = op;
  };

  // ==========================================================================================
  // METIN STONE — cursed obelisk (Metin2 homage). (x, y) = base on the ground. Designed at r = 34.
  // ==========================================================================================
  var METIN_PAL = {
    orman: { s: '#2E2840', sS: '#191424', sH: '#4E4468', rune: '#C49BFF', glow: '#9D6BFF', moss: '#3A5A2A' },
    mezarlik: { s: '#2C3238', sS: '#15191E', sH: '#4E5A64', rune: '#7DFFE0', glow: '#2BE8B0', moss: '#3E4A48' },
    kor: { s: '#33201E', sS: '#1A0E0E', sH: '#5A3A34', rune: '#FFC27A', glow: '#FF6A1F', moss: '#4A2A1A' },
    kale: { s: '#2E2234', sS: '#170F1C', sH: '#503C5A', rune: '#FF7AA0', glow: '#FF2A5A', moss: '#3A2A3E' }
  };
  // crack polylines on the faces (design units); revealed in order as HP drops
  var METIN_CRACKS = [
    [[-6, -30], [-3, -38], [-7, -46], [-4, -54]], [[8, -20], [5, -28], [9, -35]], [[-12, -10], [-8, -16], [-11, -22], [-7, -27]],
    [[4, -60], [7, -67], [4, -74], [6, -80]], [[-2, -8], [1, -14], [-1, -20]], [[10, -44], [7, -50], [10, -57], [8, -62]],
    [[-9, -64], [-6, -70], [-8, -76]], [[0, -84], [2, -90], [0, -96]], [[-14, -2], [-10, -6]], [[13, -8], [10, -13], [12, -17]]];
  var METIN_RUNES = [
    function (c) { c.moveTo(0, -6); c.lineTo(3.4, 0); c.lineTo(0, 6); c.lineTo(-3.4, 0); c.closePath(); c.moveTo(0, -2); c.lineTo(0, 2); },
    function (c) { c.moveTo(3, 0); c.arc(0, 0, 3, 0, TAU); c.moveTo(0, -6); c.lineTo(0, -3); c.moveTo(0, 3); c.lineTo(0, 6); c.moveTo(-4.4, 4); c.lineTo(-2, 2); },
    function (c) { c.moveTo(0, 6); c.lineTo(0, -6); c.moveTo(-3.6, -6); c.lineTo(-3.6, -2); c.lineTo(3.6, -2); c.lineTo(3.6, -6); c.moveTo(-2.4, 3); c.lineTo(2.4, 3); },
    function (c) { c.moveTo(-3.4, -5.4); c.lineTo(3.4, -5.4); c.lineTo(-3.4, 5.4); c.lineTo(3.4, 5.4); c.moveTo(-1.4, 0); c.arc(0, 0, 1.4, PI, PI * 3); },
    function (c) { c.moveTo(-4, 0); c.quadraticCurveTo(0, -5, 4, 0); c.quadraticCurveTo(0, 5, -4, 0); c.moveTo(1.2, 0); c.arc(0, 0, 1.2, 0, TAU); c.moveTo(0, -6.4); c.lineTo(0, -4); }
  ];
  function metinFaces(c, which) {
    if (which === 0) { c.moveTo(-17, 0); c.lineTo(2, 5); c.lineTo(2, -84); c.lineTo(-11, -86); c.closePath(); }
    else if (which === 1) { c.moveTo(2, 5); c.lineTo(18, -1); c.lineTo(12, -88); c.lineTo(2, -84); c.closePath(); }
    else if (which === 2) { c.moveTo(-11, -86); c.lineTo(2, -84); c.lineTo(1, -108); c.closePath(); }
    else { c.moveTo(2, -84); c.lineTo(12, -88); c.lineTo(1, -108); c.closePath(); }
  }
  function metinShard(c, i, x, y, a, sz, M, front) {
    c.save(); c.translate(x, y); c.rotate(a);
    cel(c, function (c) { P(c, [-sz, 0, -sz * 0.4, -sz * 1.2, sz * 0.7, -sz * 0.7, sz, sz * 0.3, 0, sz * 0.9]); }, front ? M.sH : M.s, front ? M.s : M.sS, front ? mix(M.sH, '#FFFFFF', 0.3) : null, 1.2, 0.8);
    ln(c, -sz * 0.4, -sz * 0.9, sz * 0.5, -sz * 0.5, M.rune, 0.9);
    c.restore();
  }
  Art.drawMetin = function (ctx, m, t) {
    if (!m) return;
    t = t || 0;
    var M = METIN_PAL[m.theme] || METIN_PAL.orman;
    var r = m.r || 34, u = r / 34, hp = m.hpPct == null ? 1 : clamp(m.hpPct, 0, 1);
    var ht = m.hitT, hit = (ht != null && ht >= 0 && ht < 0.18) ? 1 - ht / 0.18 : 0;
    var ga = ctx.globalAlpha, op = ctx.globalCompositeOperation;
    var pulse = 0.75 + 0.25 * sin(t * 2.6) + hit * 0.6 + (1 - hp) * 0.25;
    var shake = (hp < 0.35 ? (0.35 - hp) * 3 : 0) + hit * 1.2;
    var jx = shake ? (hashN(floor(t * 40)) - 0.5) * shake * 2 : 0;
    ctx.save();
    ctx.translate(m.x, m.y); ctx.scale(u, u);
    // ground: rune circle (additive, slowly rotating)
    ctx.globalCompositeOperation = 'lighter';
    glow(ctx, 0, 0, 70, 26, M.glow, 0.38 * pulse);
    ctx.lineCap = 'round';
    ctx.strokeStyle = M.rune; ctx.lineWidth = 1.6; ctx.globalAlpha = ga * 0.55 * pulse;
    ctx.beginPath(); ctx.ellipse(0, 0, 56, 18, 0, 0, TAU); ctx.stroke();
    ctx.lineWidth = 1; ctx.globalAlpha = ga * 0.35 * pulse;
    ctx.beginPath(); ctx.ellipse(0, 0, 47, 15, 0, 0, TAU); ctx.stroke();
    ctx.lineWidth = 1.6; ctx.globalAlpha = ga * 0.7 * pulse;
    for (var i = 0; i < 12; i++) {
      var a = i / 12 * TAU + t * 0.35, cx = cos(a) * 51.5, cy = sin(a) * 16.5;
      ctx.beginPath(); ctx.moveTo(cx - 2.4, cy - 1.4); ctx.lineTo(cx, cy + 1.4); ctx.lineTo(cx + 2.4, cy - 1.4); ctx.stroke();
    }
    // inner star
    ctx.globalAlpha = ga * 0.3 * pulse; ctx.beginPath();
    for (i = 0; i <= 5; i++) { var a2 = -HP + i * TAU * 2 / 5 - t * 0.2; var px = cos(a2) * 46, py = sin(a2) * 14.6; if (i) ctx.lineTo(px, py); else ctx.moveTo(px, py); }
    ctx.stroke();
    ctx.globalAlpha = ga; ctx.globalCompositeOperation = op;
    shadow(ctx, 0, 2, 30, 9, 1);
    ctx.translate(jx, 0);
    var sc = 1 + hit * 0.05; ctx.scale(sc, 1 + hit * 0.03);
    setLine(ctx, 2.4);
    // aura behind
    ctx.globalCompositeOperation = 'lighter';
    glow(ctx, 1, -54, 46, 74, M.glow, 0.45 * pulse);
    ctx.globalCompositeOperation = op;
    // floating debris (back half)
    var deb = [];
    for (i = 0; i < 6; i++) {
      var da = t * 0.7 + i * TAU / 6, dy = -26 - i * 13 - sin(t * 1.3 + i) * 4;
      deb.push([cos(da) * (27 + (i % 2) * 6), dy + sin(da) * 7, sin(da), da * 1.7, 3 + (i % 3) * 1.4]);
    }
    for (i = 0; i < deb.length; i++) if (deb[i][2] < 0) { metinShard(ctx, i, deb[i][0], deb[i][1], deb[i][3], deb[i][4], M, false); }
    // base rubble
    var rub = [[-20, 2, 7, 5], [19, 1, 6, 4.5], [-9, 6, 5, 3.5], [11, 6, 6, 3.8], [-27, 4, 4, 3]];
    for (i = 0; i < rub.length; i++) { var rb = rub[i]; cel(ctx, function (c) { P(c, [rb[0] - rb[2], rb[1], rb[0] - rb[2] * 0.6, rb[1] - rb[3] * 1.4, rb[0] + rb[2] * 0.5, rb[1] - rb[3] * 1.5, rb[0] + rb[2], rb[1] - rb[3] * 0.2, rb[0] + rb[2] * 0.6, rb[1] + rb[3] * 0.6]); }, M.s, M.sS, M.sH, 1.6, 0.9); }
    // obelisk faces
    var fw = hit > 0.3 ? 0.55 * hit : 0;
    var F0 = fw ? mix(M.sH, '#FFFFFF', fw) : M.sH, F1 = fw ? mix(M.s, '#FFFFFF', fw) : M.s, F2 = fw ? mix(M.sS, '#FFFFFF', fw) : M.sS;
    fl(ctx, function (c) { metinFaces(c, 1); }, F2);
    fl(ctx, function (c) { metinFaces(c, 0); }, F1);
    fl(ctx, function (c) { metinFaces(c, 2); }, F0);
    fl(ctx, function (c) { metinFaces(c, 3); }, F1);
    // edge highlight + chisel marks
    ln(ctx, 2, 4, 2, -84, mix(M.sH, '#FFFFFF', 0.25), 1.4);
    ln(ctx, -11, -86, 1, -108, mix(M.sH, '#FFFFFF', 0.35), 1.2);
    ctx.beginPath(); ctx.moveTo(-14, -20); ctx.lineTo(-9, -22); ctx.moveTo(-12, -48); ctx.lineTo(-8, -49); ctx.moveTo(8, -30); ctx.lineTo(13, -29); ctx.moveTo(9, -66); ctx.lineTo(12, -64); strokeW(ctx, M.sS, 1);
    // moss / theme dressing at the base
    fl(ctx, function (c) { c.moveTo(-17, 0); c.quadraticCurveTo(-12, -8, -6, -3); c.quadraticCurveTo(-2, -9, 2, 4); c.closePath(); c.moveTo(2, 5); c.quadraticCurveTo(8, -5, 12, 0); c.quadraticCurveTo(15, -4, 18, -1); c.closePath(); }, M.moss, true);
    // runes carved down the front face (dark groove, then glowing core)
    var rg = clamp(pulse, 0.2, 1.6);
    for (i = 0; i < 5; i++) {
      var ry = -74 + i * 13.5, rx = -5 + i * 0.35;
      ctx.save(); ctx.translate(rx, ry); ctx.scale(0.95, 0.95);
      ctx.beginPath(); METIN_RUNES[i](ctx); strokeW(ctx, '#07050B', 3.2);
      ctx.beginPath(); METIN_RUNES[i](ctx); strokeW(ctx, M.rune, 1.3);
      ctx.restore();
    }
    // cracks (grow as HP drops)
    var nc = (1 - hp) * METIN_CRACKS.length, full = floor(nc), part = nc - full;
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    for (i = 0; i < mn(METIN_CRACKS.length, full + 1); i++) {
      var cr = METIN_CRACKS[i], k = i < full ? 1 : part; if (k <= 0.02) continue;
      var segs = (cr.length - 1) * k;
      ctx.beginPath(); ctx.moveTo(cr[0][0], cr[0][1]);
      for (var j = 1; j < cr.length; j++) {
        if (j - 1 >= segs) break;
        var kk = mn(1, segs - (j - 1));
        ctx.lineTo(lerp(cr[j - 1][0], cr[j][0], kk), lerp(cr[j - 1][1], cr[j][1], kk));
      }
      strokeW(ctx, '#07050B', 2.6); strokeW(ctx, M.rune, 1);
    }
    ctx.lineWidth = 2.4;
    // glow over runes + cracks
    ctx.globalCompositeOperation = 'lighter';
    for (i = 0; i < 5; i++) glow(ctx, -5 + i * 0.35, -74 + i * 13.5, 9, 9, M.glow, 0.55 * rg * (0.8 + 0.2 * sin(t * 3 - i)));
    for (i = 0; i < mn(METIN_CRACKS.length, full); i++) glow(ctx, METIN_CRACKS[i][1][0], METIN_CRACKS[i][1][1], 8, 10, M.glow, 0.5);
    glow(ctx, 1, -108, 14, 14, M.rune, 0.6 * pulse, true);
    if (hit) glow(ctx, 1, -54, 40, 66, '#FFFFFF', 0.35 * hit);
    // rising energy motes
    for (i = 0; i < 7; i++) {
      var ep = fract(t * 0.5 + i / 7), ex = sin(i * 9.1 + ep * 4) * 20, ey = -6 - ep * 110;
      glow(ctx, ex, ey, 3.4, 3.4, i % 2 ? M.rune : M.glow, sin(ep * PI) * 0.9);
    }
    ctx.globalCompositeOperation = op;
    // floating debris (front half)
    for (i = 0; i < deb.length; i++) if (deb[i][2] >= 0) {
      metinShard(ctx, i, deb[i][0], deb[i][1], deb[i][3], deb[i][4], M, true);
      ctx.globalCompositeOperation = 'lighter'; glow(ctx, deb[i][0], deb[i][1] + 3, 6, 4, M.glow, 0.5); ctx.globalCompositeOperation = op;
    }
    ctx.restore();
    ctx.globalAlpha = ga; ctx.globalCompositeOperation = op;
  };

  // ==========================================================================================
  // GROUND — 512×512 seamless tiles (periodic value noise + wrapped vector details), cached per theme
  // ==========================================================================================
  var TILE = 512, GROUND = Object.create(null);
  function pnoise(x, y, period, seed) {          // periodic value noise, x,y in cells
    var x0 = floor(x), y0 = floor(y), tx = x - x0, ty = y - y0;
    tx = tx * tx * (3 - 2 * tx); ty = ty * ty * (3 - 2 * ty);
    var xa = ((x0 % period) + period) % period, xb = (xa + 1) % period, ya = ((y0 % period) + period) % period, yb = (ya + 1) % period;
    var a = hashN(seed + xa * 374761 + ya * 668265), b = hashN(seed + xb * 374761 + ya * 668265);
    var c = hashN(seed + xa * 374761 + yb * 668265), d = hashN(seed + xb * 374761 + yb * 668265);
    return lerp(lerp(a, b, tx), lerp(c, d, tx), ty);
  }
  function fbm(px, py, base, oct, seed) {
    var v = 0, amp = 0.5, tot = 0, p = base;
    for (var o = 0; o < oct; o++) { v += pnoise(px / TILE * p, py / TILE * p, p, seed + o * 1013) * amp; tot += amp; amp *= 0.5; p *= 2; }
    return v / tot;
  }
  // draw fn at (x,y) and at its wrapped copies when it crosses an edge (rad = extent)
  function wrap(c, x, y, rad, fn) {
    for (var ox = -1; ox <= 1; ox++) for (var oy = -1; oy <= 1; oy++) {
      var X = x + ox * TILE, Y = y + oy * TILE;
      if (X + rad < 0 || X - rad > TILE || Y + rad < 0 || Y - rad > TILE) continue;
      fn(X, Y);
    }
  }
  var GROUND_DEF = {
    orman: { c1: '#2A281C', c2: '#1A1A12', c3: '#2E3A20', c4: '#3A4A26', seed: 11 },
    mezarlik: { c1: '#2E3036', c2: '#1E2026', c3: '#383A3E', c4: '#2A2E2C', seed: 23 },
    kor: { c1: '#2A1C1C', c2: '#160E10', c3: '#34221E', c4: '#1E1414', seed: 37 },
    kale: { c1: '#3A3446', c2: '#28232F', c3: '#443E50', c4: '#2E3A2E', seed: 51 }
  };
  function groundPixels(g, theme, D) {
    var id = g.createImageData(TILE, TILE), d = id.data;
    var C1 = rgb(D.c1), C2 = rgb(D.c2), C3 = rgb(D.c3), C4 = rgb(D.c4), o;
    // kor: toroidal voronoi plates + glowing lava veins
    var pts = null, hot = null, NV = theme === 'kale' ? 6 : 7, isKale = theme === 'kale';
    if (theme === 'kor' || isKale) {
      var R = rng(D.seed * 7), jit = isKale ? 0.32 : 0.7; pts = []; hot = [];
      for (var gy = 0; gy < NV; gy++) for (var gx = 0; gx < NV; gx++) { pts.push([(gx + (1 - jit) / 2 + R() * jit + (isKale && gy % 2 ? 0.5 : 0)) % NV * TILE / NV, (gy + (1 - jit) / 2 + R() * jit) * TILE / NV]); hot.push(R()); }
    }
    for (var y = 0; y < TILE; y++) {
      for (var x = 0; x < TILE; x++) {
        var n = fbm(x, y, 4, 4, D.seed), m = fbm(x, y, 8, 3, D.seed + 500), q = pnoise(x / TILE * 64, y / TILE * 64, 64, D.seed + 900);
        var r, gg, b, k = clamp((n - 0.3) * 2.2, 0, 1);
        r = lerp(C2[0], C1[0], k); gg = lerp(C2[1], C1[1], k); b = lerp(C2[2], C1[2], k);
        var mk = clamp((m - 0.55) * 4, 0, 1);              // patches (moss / pale soil / ash / worn stone)
        r = lerp(r, C3[0], mk * 0.8); gg = lerp(gg, C3[1], mk * 0.8); b = lerp(b, C3[2], mk * 0.8);
        var mk2 = clamp((0.42 - m) * 5, 0, 1);
        r = lerp(r, C4[0], mk2 * 0.6); gg = lerp(gg, C4[1], mk2 * 0.6); b = lerp(b, C4[2], mk2 * 0.6);
        var grain = (q - 0.5) * 6 + (hashN(x * 7 + y * 3001 + D.seed) - 0.5) * 9;
        r += grain; gg += grain; b += grain;
        if (pts) {
          // nearest + second nearest plate centre on the torus
          var cx = floor(x / TILE * NV), cy = floor(y / TILE * NV), d1 = 1e9, d2 = 1e9, i1 = 0;
          for (var oy = -1; oy <= 1; oy++) for (var ox = -1; ox <= 1; ox++) {
            var ix = (cx + ox + NV) % NV, iy = (cy + oy + NV) % NV, pi = iy * NV + ix;
            var px = pts[pi][0] + (cx + ox < 0 ? -TILE : cx + ox >= NV ? TILE : 0), py = pts[pi][1] + (cy + oy < 0 ? -TILE : cy + oy >= NV ? TILE : 0);
            var dd = (px - x) * (px - x) + (py - y) * (py - y);
            if (dd < d1) { d2 = d1; d1 = dd; i1 = pi; } else if (dd < d2) d2 = dd;
          }
          var edge = sqrt(d2) - sqrt(d1);
          var plateShade = (hot[i1] - 0.5) * (isKale ? 22 : 12);
          r += plateShade; gg += plateShade * 0.8; b += plateShade * (isKale ? 0.95 : 0.7);
          if (isKale) {
            // mortar + bevel (light top-left rim, dark bottom-right rim)
            var pcx = pts[i1][0], pcy = pts[i1][1], ddx = x - pcx, ddy = y - pcy;
            if (ddx > TILE / 2) ddx -= TILE; else if (ddx < -TILE / 2) ddx += TILE;
            if (ddy > TILE / 2) ddy -= TILE; else if (ddy < -TILE / 2) ddy += TILE;
            if (edge < 3.2) { r = r * 0.32 + 4; gg = gg * 0.3 + 3; b = b * 0.34 + 6; }
            else if (edge < 7) { var bv = (-(ddx + ddy) / (abs(ddx) + abs(ddy) + 1)) * (1 - (edge - 3.2) / 3.8) * 16; r += bv; gg += bv; b += bv * 1.1; }
            o = (y * TILE + x) * 4; d[o] = r; d[o + 1] = gg; d[o + 2] = b; d[o + 3] = 255;
            continue;
          }
          if (edge < 2.2) { r *= 0.45; gg *= 0.45; b *= 0.45; }
          // lava in some seams (wobbly, fbm-gated)
          var lavaGate = fbm(x, y, 4, 2, D.seed + 77);
          if (lavaGate > 0.55) {
            var w = (lavaGate - 0.55) * 26 + 0.6, hotk = clamp(1 - edge / w, 0, 1);
            if (hotk > 0) {
              var hk = hotk * hotk;
              r = lerp(r, 255, hk); gg = lerp(gg, 90 + 150 * hk * hk, hk); b = lerp(b, 20 + 80 * hk * hk * hk, hk * 0.8);
            }
            var gl = clamp(1 - edge / (w * 4 + 6), 0, 1) * 0.5;
            r += gl * 90; gg += gl * 26;
          }
        }
        o = (y * TILE + x) * 4;
        d[o] = r; d[o + 1] = gg; d[o + 2] = b; d[o + 3] = 255;
      }
    }
    g.putImageData(id, 0, 0);
  }
  function leaf(c, x, y, a, s, col) {
    c.save(); c.translate(x, y); c.rotate(a); c.scale(s, s);
    c.beginPath(); c.moveTo(-5, 0); c.quadraticCurveTo(0, -3.2, 5, 0); c.quadraticCurveTo(0, 3.2, -5, 0); c.fillStyle = col; c.fill();
    c.strokeStyle = 'rgba(0,0,0,0.35)'; c.lineWidth = 0.6; c.beginPath(); c.moveTo(-4.4, 0); c.lineTo(4.4, 0); c.stroke();
    c.restore();
  }
  function groundDetails(g, theme, D) {
    var R = rng(D.seed * 131), i, n;
    g.lineCap = 'round'; g.lineJoin = 'round';
    function dots(count, cols, rmin, rmax, alpha) {
      for (var j = 0; j < count; j++) {
        var x = R() * TILE, y = R() * TILE, rr = rmin + R() * (rmax - rmin), col = cols[(R() * cols.length) | 0];
        wrap(g, x, y, rr + 2, function (X, Y) {
          g.globalAlpha = alpha; g.fillStyle = 'rgba(0,0,0,0.35)'; g.beginPath(); g.ellipse(X + 0.6, Y + 0.8, rr, rr * 0.75, 0, 0, TAU); g.fill();
          g.fillStyle = col; g.beginPath(); g.ellipse(X, Y, rr, rr * 0.75, 0, 0, TAU); g.fill();
          g.fillStyle = 'rgba(255,255,255,0.12)'; g.beginPath(); g.ellipse(X - rr * 0.3, Y - rr * 0.3, rr * 0.4, rr * 0.3, 0, 0, TAU); g.fill();
          g.globalAlpha = 1;
        });
      }
    }
    function tufts(count, cols, h) {
      for (var j = 0; j < count; j++) {
        var x = R() * TILE, y = R() * TILE, col = cols[(R() * cols.length) | 0], bl = 3 + (R() * 4 | 0), hh = h * (0.6 + R() * 0.6);
        wrap(g, x, y, hh + 4, function (X, Y) {
          g.strokeStyle = col; g.lineWidth = 1.3;
          for (var b = 0; b < bl; b++) { var bx = X + (b - bl / 2) * 1.6; g.beginPath(); g.moveTo(bx, Y); g.quadraticCurveTo(bx + (b - bl / 2) * 0.6, Y - hh * 0.6, bx + (b - bl / 2) * 1.4, Y - hh); g.stroke(); }
        });
      }
    }
    function cracks(count, col, len, w) {
      for (var j = 0; j < count; j++) {
        var x = R() * TILE, y = R() * TILE, a = R() * TAU, segs = 3 + (R() * 3 | 0), pts = [[x, y]];
        for (var s = 0; s < segs; s++) { a += (R() - 0.5) * 1.2; var l = len * (0.5 + R() * 0.6); pts.push([pts[s][0] + cos(a) * l, pts[s][1] + sin(a) * l]); }
        wrap(g, x, y, len * segs, function (X, Y) {
          g.beginPath(); g.moveTo(X, Y); for (var s = 1; s < pts.length; s++) g.lineTo(pts[s][0] - x + X, pts[s][1] - y + Y);
          g.strokeStyle = col; g.lineWidth = w; g.stroke();
        });
      }
    }
    if (theme === 'orman') {
      cracks(10, 'rgba(10,8,4,0.45)', 14, 1.4);
      // roots
      for (i = 0; i < 7; i++) {
        var rx = R() * TILE, ry = R() * TILE, ra = R() * TAU, rl = 40 + R() * 50;
        (function (rx, ry, ra, rl) {
          wrap(g, rx, ry, rl + 10, function (X, Y) {
            var pts = [[X, Y]], a = ra;
            for (var s = 0; s < 5; s++) { a += (R() - 0.5) * 0.9; pts.push([pts[s][0] + cos(a) * rl / 5, pts[s][1] + sin(a) * rl / 5]); }
            for (var pass = 0; pass < 2; pass++) {
              g.beginPath(); g.moveTo(pts[0][0], pts[0][1]);
              for (s = 1; s < pts.length; s++) g.lineTo(pts[s][0], pts[s][1]);
              g.strokeStyle = pass ? '#4A3622' : '#120C08'; g.lineWidth = pass ? 3.2 : 5.6; g.stroke();
            }
            g.beginPath(); g.moveTo(pts[0][0], pts[0][1] - 1); for (s = 1; s < pts.length; s++) g.lineTo(pts[s][0], pts[s][1] - 1);
            g.strokeStyle = 'rgba(160,120,80,0.35)'; g.lineWidth = 0.9; g.stroke();
          });
        })(rx, ry, ra, rl);
      }
      dots(46, ['#4A443A', '#3A362E', '#55504A'], 1.4, 3.2, 0.9);
      tufts(70, ['#3C5A28', '#4E7232', '#2E4A20'], 7);
      // fallen leaves (muted autumn + dark green)
      for (i = 0; i < 160; i++) {
        var lx = R() * TILE, ly = R() * TILE, la = R() * TAU, ls = 0.7 + R() * 0.6, lc = ['#7A3E1A', '#8A5A20', '#6A2A1E', '#4A5A22', '#9A6A2A'][(R() * 5) | 0];
        (function (lx, ly, la, ls, lc) { wrap(g, lx, ly, 8, function (X, Y) { g.globalAlpha = 0.85; leaf(g, X, Y, la, ls, lc); g.globalAlpha = 1; }); })(lx, ly, la, ls, lc);
      }
      // tiny pale flowers
      for (i = 0; i < 10; i++) { var fx = R() * TILE, fy = R() * TILE; wrap(g, fx, fy, 4, function (X, Y) { g.fillStyle = '#8E80B8'; for (var p = 0; p < 4; p++) { g.beginPath(); g.arc(X + cos(p * HP) * 1.4, Y + sin(p * HP) * 1.4, 1, 0, TAU); g.fill(); } g.fillStyle = '#FFE07A'; g.beginPath(); g.arc(X, Y, 0.8, 0, TAU); g.fill(); }); }
    } else if (theme === 'mezarlik') {
      cracks(22, 'rgba(8,8,12,0.55)', 16, 1.3);
      dots(90, ['#4A4C52', '#55575E', '#3A3C42', '#605E58'], 1, 2.6, 0.9);
      tufts(40, ['#4A4A36', '#5A5840', '#3A3C2E'], 7);
      // scattered small bones + rare skulls
      for (i = 0; i < 26; i++) {
        var bx = R() * TILE, by = R() * TILE, ba = R() * TAU, bl = 5 + R() * 5;
        (function (bx, by, ba, bl) {
          wrap(g, bx, by, 12, function (X, Y) {
            g.save(); g.translate(X, Y); g.rotate(ba);
            g.strokeStyle = 'rgba(0,0,0,0.4)'; g.lineWidth = 3.4; g.beginPath(); g.moveTo(-bl, 1); g.lineTo(bl, 1); g.stroke();
            g.strokeStyle = '#B8B09A'; g.lineWidth = 2; g.beginPath(); g.moveTo(-bl, 0); g.lineTo(bl, 0); g.stroke();
            g.fillStyle = '#C9C1AA'; g.beginPath(); g.arc(-bl, -1, 1.5, 0, TAU); g.arc(-bl, 1, 1.5, 0, TAU); g.arc(bl, -1, 1.5, 0, TAU); g.arc(bl, 1, 1.5, 0, TAU); g.fill();
            g.restore();
          });
        })(bx, by, ba, bl);
      }
      for (i = 0; i < 4; i++) {
        var sx = R() * TILE, sy = R() * TILE;
        wrap(g, sx, sy, 10, function (X, Y) {
          g.fillStyle = 'rgba(0,0,0,0.4)'; g.beginPath(); g.ellipse(X + 1, Y + 2, 5.4, 4, 0, 0, TAU); g.fill();
          g.fillStyle = '#C9C1AA'; g.beginPath(); g.arc(X, Y, 4.6, 0, TAU); g.fill(); g.fillRect(X - 2.6, Y + 2, 5.2, 3);
          g.fillStyle = '#2A2428'; g.beginPath(); g.arc(X - 1.7, Y, 1.3, 0, TAU); g.arc(X + 1.7, Y, 1.3, 0, TAU); g.fill();
        });
      }
      // cold fog patches
      for (i = 0; i < 12; i++) { var gx2 = R() * TILE, gy2 = R() * TILE, gr = 40 + R() * 60; wrap(g, gx2, gy2, gr, function (X, Y) { glow(g, X, Y, gr, gr * 0.55, '#8E9AB8', 0.1); }); }
    } else if (theme === 'kor') {
      dots(110, ['#3A2A28', '#2A1E1E', '#4A3632'], 0.8, 2.4, 0.8);
      // ash speckles + embers
      for (i = 0; i < 160; i++) { var ax = R() * TILE, ay = R() * TILE, ar = 0.4 + R() * 0.9, ac = R() < 0.12 ? '#FF8A3A' : 'rgba(150,140,140,0.35)'; g.fillStyle = ac; g.beginPath(); g.arc(ax, ay, ar, 0, TAU); g.fill(); }
      g.globalCompositeOperation = 'lighter';
      for (i = 0; i < 10; i++) { var hx = R() * TILE, hy = R() * TILE; wrap(g, hx, hy, 40, function (X, Y) { glow(g, X, Y, 34, 24, '#FF4A1A', 0.08); }); }
      g.globalCompositeOperation = 'source-over';
    } else if (theme === 'kale') {
      cracks(16, 'rgba(6,4,10,0.6)', 12, 1.2);
      // moss in some seams + old blood stains + an engraved rune
      for (i = 0; i < 26; i++) { var mx2 = R() * TILE, my2 = R() * TILE; wrap(g, mx2, my2, 20, function (X, Y) { g.fillStyle = 'rgba(70,96,52,0.55)'; for (var p = 0; p < 6; p++) { g.beginPath(); g.ellipse(X + (p - 3) * 3, Y + sin(p * 2.1) * 1.5, 2.6, 1.6, 0, 0, TAU); g.fill(); } }); }
      for (i = 0; i < 4; i++) { var bx2 = R() * TILE, by2 = R() * TILE; wrap(g, bx2, by2, 30, function (X, Y) { glow(g, X, Y, 22, 14, '#5A0A16', 0.35); }); }
      dots(30, ['#3A3644', '#2E2A36'], 1, 2.4, 0.8);
    }
    // subtle vignette-free light variation (keeps tiles from looking flat)
    for (i = 0; i < 8; i++) { var lx2 = R() * TILE, ly2 = R() * TILE, lr = 60 + R() * 80; wrap(g, lx2, ly2, lr, function (X, Y) { glow(g, X, Y, lr, lr, '#000000', 0.12); }); }
  }
  Art.ground = function (theme) {
    theme = GROUND_DEF[theme] ? theme : 'orman';
    if (GROUND[theme]) return GROUND[theme];
    var cv = mkCv(TILE, TILE); if (!cv) return null;
    var g = cv.getContext('2d');
    try { groundPixels(g, theme, GROUND_DEF[theme]); groundDetails(g, theme, GROUND_DEF[theme]); }
    catch (err) { if (typeof console !== 'undefined') console.error('[GM.Art.ground]', err); g.fillStyle = GROUND_DEF[theme].c1; g.fillRect(0, 0, TILE, TILE); }
    GROUND[theme] = cv; return cv;
  };
  Art.themeColor = function (theme) { return th(theme).col; };

  // ==========================================================================================
  // PROPS — static body baked once per (kind, variant); animated parts (fire, glow, sway) drawn live.
  //   def: { w, h, oy (base y inside sprite from top), layer, light?:{r,col,flick}, draw(c, v), anim?(c, t, v, s) }
  //   draw/anim work in local px with (0,0) = base point on the ground.
  // ==========================================================================================
  var PROP = Object.create(null);
  function torchFlame(c, x, y, s, t, seed, cols) {
    var op = c.globalCompositeOperation;
    c.globalCompositeOperation = 'lighter';
    glow(c, x, y - 6 * s, 26 * s, 26 * s, (cols && cols[1]) || '#FF8A2A', 0.55 * flick(t, seed), true);
    c.globalCompositeOperation = op;
    flames(c, x, y, 4.2 * s, 15 * s, t, seed, cols);
  }
  function candle(c, x, y, h, w) {
    cel(c, function (c) { RR(c, x - w / 2, y - h, w, h, 1.2); }, '#E8DCC0', '#A89878', '#FFFBEA', 1, 0.6);
    fl(c, function (c) { c.moveTo(x - w / 2, y - h + 2); c.quadraticCurveTo(x - w / 2 - 1, y - h + 6, x - w / 2 + 0.6, y - h + 7); c.lineTo(x - w / 2 + 1, y - h + 2); c.closePath(); }, '#F6EEDA', true);
    ln(c, x, y - h, x, y - h - 2.4, '#2A1A10', 1);
  }
  // theme rock palettes
  var ROCK = { orman: ['#4A4652', '#2C2934', '#6E6878', '#3E5A2A'], mezarlik: ['#5A5E66', '#363A42', '#80868E', '#4A5448'], kor: ['#2A2228', '#141016', '#4A3E48', '#4A2418'], kale: ['#4A4452', '#2C2834', '#6A6474', '#3A4430'] };
  function rockShape(c, w, h, v) {
    var R = rng(v * 97 + 3), n = 7, pts = [];
    for (var i = 0; i < n; i++) { var a = PI + i / (n - 1) * PI, rr = 0.82 + R() * 0.25; pts.push(cos(a) * w * rr, sin(a) * h * rr * (i === 0 || i === n - 1 ? 0.2 : 1)); }
    c.moveTo(-w, 0); for (i = 0; i < pts.length; i += 2) c.lineTo(pts[i], pts[i + 1]); c.lineTo(w, 0); c.quadraticCurveTo(0, h * 0.25, -w, 0); c.closePath();
  }
  PROP.rock = { w: 60, h: 46, oy: 38, layer: 'tall', draw: function (c, v, theme) {
    var p = ROCK[theme] || ROCK.orman, s = 0.8 + (v % 3) * 0.2;
    cel(c, function (c) { rockShape(c, 22 * s, 26 * s, v); }, p[0], p[1], p[2], 4, 2);
    c.beginPath(); c.moveTo(-6 * s, -18 * s); c.lineTo(-2 * s, -10 * s); c.lineTo(-5 * s, -4 * s); strokeW(c, p[1], 1.2);
    fl(c, function (c) { c.moveTo(-18 * s, -12 * s); c.quadraticCurveTo(-6 * s, -26 * s, 10 * s, -20 * s); c.quadraticCurveTo(2 * s, -17 * s, -6 * s, -14 * s); c.quadraticCurveTo(-12 * s, -9 * s, -18 * s, -12 * s); }, p[3], true);
  } };
  PROP.tree = { w: 120, h: 150, oy: 140, layer: 'tall', draw: function (c, v) {
    var lean = ((v % 5) - 2) * 0.04;
    c.rotate(lean);
    // roots
    cel(c, function (c) { c.moveTo(-26, 2); c.quadraticCurveTo(-14, -6, -9, -22); c.lineTo(9, -22); c.quadraticCurveTo(14, -6, 28, 3); c.quadraticCurveTo(14, 0, 8, -2); c.quadraticCurveTo(2, 3, -4, -2); c.quadraticCurveTo(-12, 0, -26, 2); c.closePath(); }, '#3A2A22', '#1E140F', '#5A4232', 3, 1.6);
    // gnarled trunk
    cel(c, function (c) { c.moveTo(-10, -20); c.bezierCurveTo(-14, -50, -4, -60, -8, -86); c.lineTo(8, -88); c.bezierCurveTo(4, -60, 14, -48, 10, -20); c.closePath(); }, '#3A2A22', '#1E140F', '#5A4232', 4, 2);
    c.beginPath(); c.moveTo(-2, -26); c.quadraticCurveTo(-5, -46, 0, -64); c.moveTo(4, -30); c.quadraticCurveTo(6, -40, 3, -50); strokeW(c, '#1E140F', 1.2);
    // hollow with glowing eyes (cute-creepy)
    fl(c, function (c) { E(c, 0, -44, 4.2, 6); }, '#0C0806');
    // canopy (dark, layered blobs)
    blob(c, function (c) { Ci(c, -26, -96, 22); Ci(c, 24, -98, 22); Ci(c, 0, -116, 26); Ci(c, -12, -84, 18); Ci(c, 14, -82, 18); }, '#24402E', '#142619', '#3A6044', 2.2, 5, 2.4);
    blob(c, function (c) { Ci(c, -14, -112, 13); Ci(c, 12, -120, 12); Ci(c, 30, -104, 10); }, '#30543A', '#1C3424', '#4E7A54', 2, 3, 1.6);
    // hanging moss
    c.strokeStyle = '#5E7A3E'; c.lineWidth = 1.4;
    for (var i = 0; i < 6; i++) { var mx2 = -30 + i * 12, my2 = -78 + abs(i - 2.5) * 3; c.beginPath(); c.moveTo(mx2, my2); c.quadraticCurveTo(mx2 + 2, my2 + 8, mx2 - 1, my2 + 12 + (i % 2) * 6); c.stroke(); }
    c.strokeStyle = OUT; c.lineWidth = 2;
  }, anim: function (c, t, v) {
    var op = c.globalCompositeOperation; c.globalCompositeOperation = 'lighter';
    var bl = fract(t * 0.25 + v * 0.37) < 0.06 ? 0.15 : 1;      // blink
    glow(c, -1.6, -45, 3, 3 * bl, '#FFD84A', 0.95); glow(c, 1.8, -45, 3, 3 * bl, '#FFD84A', 0.95);
    for (var i = 0; i < 4; i++) { var p = fract(t * 0.15 + i * 0.27 + v * 0.1); glow(c, sin(i * 4 + t * 0.7) * 34, -40 - p * 70, 3.4, 3.4, '#C8FF6A', sin(p * PI) * 0.8); }
    c.globalCompositeOperation = op;
  } };
  PROP.stump = { w: 50, h: 40, oy: 32, layer: 'tall', draw: function (c, v) {
    cel(c, function (c) { c.moveTo(-15, 0); c.lineTo(-13, -16); c.lineTo(13, -16); c.lineTo(15, 0); c.quadraticCurveTo(0, 4, -15, 0); c.closePath(); }, '#4A3428', '#2A1C14', '#6A4C38', 3, 1.4);
    cel(c, function (c) { E(c, 0, -16, 13, 4.4); }, '#A88458', '#7A5A38', '#C8A474', 1.4, 0.8);
    c.beginPath(); c.ellipse(0, -16, 8, 2.6, 0, 0, TAU); c.moveTo(4, -16); c.ellipse(0, -16, 4, 1.3, 0, 0, TAU); strokeW(c, '#7A5A38', 0.9);
    for (var i = 0; i < 3; i++) { var mx2 = 11 + i * 4, my2 = -3 - i * 3; cel(c, function (c) { c.moveTo(mx2 - 3.4, my2); c.quadraticCurveTo(mx2, my2 - 5, mx2 + 3.4, my2); c.closePath(); }, '#E2574A', '#9A2A28', '#FF9A8A', 1, 0.6); }
  } };
  PROP.bush = { w: 56, h: 40, oy: 34, layer: 'tall', draw: function (c, v) {
    blob(c, function (c) { Ci(c, -11, -10, 11); Ci(c, 9, -11, 12); Ci(c, 0, -18, 12); Ci(c, -18, -4, 7); Ci(c, 18, -4, 7); }, '#2A4A32', '#17301E', '#3E6A46', 2, 3, 1.6);
    var R = rng(v * 13 + 7);
    for (var i = 0; i < 5; i++) { var bx = (R() - 0.5) * 30, by = -6 - R() * 18; fl(c, function (c) { Ci(c, bx, by, 1.9); }, '#E8394D'); fl(c, function (c) { Ci(c, bx - 0.6, by - 0.6, 0.6); }, '#FFFFFF', true); }
  } };
  PROP.fern = { w: 44, h: 34, oy: 30, layer: 'tall', draw: function (c, v) {
    for (var i = 0; i < 5; i++) {
      var a = -PI / 2 + (i - 2) * 0.45, L = 22 - abs(i - 2) * 3;
      c.save(); c.rotate(a + PI / 2);
      rope(c, function (c) { c.moveTo(0, 0); c.quadraticCurveTo(3, -L * 0.6, 1, -L); }, '#3E6A34', 1.6, 0.9);
      for (var j = 1; j < 6; j++) { var yy = -j * L / 6.2; fl(c, function (c) { E(c, -3.4, yy, 3.2, 1.3, -0.4); E(c, 4.4, yy - 1, 3.2, 1.3, 0.4); }, j % 2 ? '#4E8A3E' : '#3E7432', true); }
      c.restore();
    }
  } };
  PROP.mushrooms = { w: 44, h: 40, oy: 34, layer: 'tall', light: { r: 90, col: '#3EDBC8', flick: 0.15 }, draw: function (c, v) {
    var ms = [[-9, 0, 7, 12], [5, 0, 9, 18], [14, 1, 5, 9]];
    for (var i = 0; i < ms.length; i++) {
      var m = ms[i];
      cel(c, function (c) { RR(c, m[0] - m[2] * 0.3, -m[3], m[2] * 0.6, m[3], 2); }, '#D8E6E0', '#8AA8A0', null, 1);
      cel(c, function (c) { c.moveTo(m[0] - m[2], -m[3] + 1); c.quadraticCurveTo(m[0] - m[2], -m[3] - m[2] * 0.9, m[0], -m[3] - m[2] * 0.9); c.quadraticCurveTo(m[0] + m[2], -m[3] - m[2] * 0.9, m[0] + m[2], -m[3] + 1); c.quadraticCurveTo(m[0], -m[3] + 3, m[0] - m[2], -m[3] + 1); c.closePath(); }, '#3EDBC8', '#1E8A8A', '#B8FFF4', 1.6, 1);
      fl(c, function (c) { Ci(c, m[0] - m[2] * 0.4, -m[3] - m[2] * 0.4, m[2] * 0.15); Ci(c, m[0] + m[2] * 0.3, -m[3] - m[2] * 0.55, m[2] * 0.12); }, '#E8FFFA', true);
    }
  }, anim: function (c, t, v) {
    var op = c.globalCompositeOperation; c.globalCompositeOperation = 'lighter';
    var p = 0.6 + 0.4 * sin(t * 1.6 + v);
    glow(c, 4, -20, 26, 20, '#3EDBC8', 0.45 * p); glow(c, 5, -24, 8, 6, '#B8FFF4', 0.5 * p);
    for (var i = 0; i < 3; i++) { var q = fract(t * 0.3 + i / 3 + v * 0.1); glow(c, sin(i * 3 + q * 5) * 14, -14 - q * 40, 2.4, 2.4, '#8FFFF0', sin(q * PI)); }
    c.globalCompositeOperation = op;
  } };
  PROP.roots = { w: 90, h: 40, oy: 22, layer: 'floor', draw: function (c, v) {
    var R = rng(v * 31 + 1);
    for (var k = 0; k < 3; k++) {
      var a = (R() - 0.5) * 0.8 + (k - 1) * 0.4, L = 30 + R() * 14, pts = [[0, 0]];
      for (var s = 1; s < 5; s++) { a += (R() - 0.5) * 0.7; pts.push([pts[s - 1][0] + cos(a) * L / 4 * (k === 1 ? 1 : -1 * (k - 1)), pts[s - 1][1] + sin(a) * L / 8]); }
      for (var pass = 0; pass < 2; pass++) {
        c.beginPath(); c.moveTo(pts[0][0], pts[0][1]); for (s = 1; s < pts.length; s++) c.lineTo(pts[s][0], pts[s][1]);
        strokeW(c, pass ? '#5A402A' : OUT, pass ? 4.4 - k * 0.6 : 7 - k * 0.6);
      }
    }
    cel(c, function (c) { E(c, 0, 0, 7, 4); }, '#5A402A', '#2A1C12', '#7A5A3A', 1.4, 0.8);
  } };
  PROP.leafpile = { w: 60, h: 30, oy: 15, layer: 'floor', draw: function (c, v) {
    var R = rng(v * 17 + 5);
    for (var i = 0; i < 22; i++) { leaf(c, (R() - 0.5) * 40, (R() - 0.5) * 14, R() * TAU, 1 + R() * 0.5, ['#8A4A1E', '#A8682A', '#6A2A1E', '#B8862E'][(R() * 4) | 0]); }
  } };
  PROP.torch = { w: 34, h: 74, oy: 64, layer: 'tall', light: { r: 150, col: '#FF9A3A', flick: 0.25 }, draw: function (c, v) {
    cel(c, function (c) { c.moveTo(-6, 0); c.lineTo(-2.4, -6); c.lineTo(2.4, -6); c.lineTo(6, 0); c.closePath(); }, '#4A3428', '#2A1C14', null, 1);
    cel(c, function (c) { RR(c, -2.4, -44, 4.8, 40, 1.6); }, '#5A3E2A', '#33221A', '#7A5A3E', 1.4, 0.8);
    fl(c, function (c) { RR(c, -3.4, -36, 6.8, 3, 1); RR(c, -3.4, -18, 6.8, 3, 1); }, '#2A2A32');
    cel(c, function (c) { c.moveTo(-6, -46); c.lineTo(6, -46); c.lineTo(4, -41); c.lineTo(-4, -41); c.closePath(); }, '#5A5A66', '#2A2A32', '#8A8A96', 1, 0.6);
    fl(c, function (c) { E(c, 0, -47, 5, 2); }, '#2A1A10');
  }, anim: function (c, t, v) { torchFlame(c, 0, -47, 1, t, v); } };
  PROP.crystal = { w: 50, h: 56, oy: 48, layer: 'tall', light: { r: 110, col: '#9D6BFF', flick: 0.1 }, draw: function (c, v) {
    var cs = [[-8, 0, -0.35, 22, 5], [3, 0, 0.05, 34, 6.5], [12, 1, 0.4, 18, 4.4], [-15, 2, -0.6, 12, 3.4]];
    for (var i = 0; i < cs.length; i++) {
      var k = cs[i];
      c.save(); c.translate(k[0], k[1]); c.rotate(k[2]);
      cel(c, function (c) { P(c, [-k[4], 0, -k[4], -k[3] * 0.75, 0, -k[3], k[4], -k[3] * 0.75, k[4], 0]); }, '#8A5AE6', '#4A2A9A', '#E2CCFF', 2, 1.2);
      ln(c, 0, -k[3] + 2, 0, -2, 'rgba(255,255,255,0.55)', 1);
      c.restore();
    }
    cel(c, function (c) { rockShape(c, 18, 7, v); }, '#3A3444', '#1E1A26', '#5A5468', 1.6, 0.8);
  }, anim: function (c, t, v) {
    var op = c.globalCompositeOperation; c.globalCompositeOperation = 'lighter';
    var p = 0.65 + 0.35 * sin(t * 2.2 + v);
    glow(c, 2, -20, 30, 34, '#9D6BFF', 0.5 * p, true);
    var q = fract(t * 0.6 + v * 0.13); spark(c, -4 + q * 10, -34 + q * 8, 3.2 * sin(q * PI), '#FFFFFF', sin(q * PI));
    c.globalCompositeOperation = op;
  } };
  // --- mezarlık
  PROP.grave = { w: 50, h: 56, oy: 48, layer: 'tall', draw: function (c, v) {
    var k = v % 3, tilt = ((v >> 2) % 3 - 1) * 0.08;
    fl(c, function (c) { E(c, 0, -1, 18, 5); }, '#2A2420', true);
    c.save(); c.rotate(tilt);
    if (k === 0) cel(c, function (c) { c.moveTo(-12, 0); c.lineTo(-12, -26); c.quadraticCurveTo(-12, -40, 0, -40); c.quadraticCurveTo(12, -40, 12, -26); c.lineTo(12, 0); c.closePath(); }, '#6A6E78', '#3A3E48', '#9AA0AA', 3.4, 1.6);
    else if (k === 1) cel(c, function (c) { P(c, [-4, 0, -4, -24, -13, -24, -13, -31, -4, -31, -4, -42, 4, -42, 4, -31, 13, -31, 13, -24, 4, -24, 4, 0]); }, '#6A6E78', '#3A3E48', '#9AA0AA', 2.6, 1.4);
    else cel(c, function (c) { c.moveTo(-14, 0); c.lineTo(-13, -30); c.lineTo(-9, -34); c.lineTo(9, -34); c.lineTo(13, -30); c.lineTo(14, 0); c.closePath(); }, '#5E626C', '#34383F', '#8E949E', 3.2, 1.6);
    if (k !== 1) {
      c.beginPath(); c.moveTo(0, -32); c.lineTo(0, -18); c.moveTo(-5, -27); c.lineTo(5, -27); strokeW(c, '#2A2E36', 2);
      c.beginPath(); c.moveTo(-7, -12); c.lineTo(7, -12); c.moveTo(-5, -8); c.lineTo(5, -8); strokeW(c, '#3A3E48', 1);
      c.beginPath(); c.moveTo(8, -36); c.lineTo(5, -28); c.lineTo(8, -22); strokeW(c, '#2A2E36', 1);
    }
    fl(c, function (c) { c.moveTo(-12, 0); c.quadraticCurveTo(-8, -7, -2, -2); c.quadraticCurveTo(4, -6, 9, 0); c.closePath(); }, '#4A5A44', true);
    c.restore();
  } };
  PROP.cross = { w: 40, h: 56, oy: 50, layer: 'tall', draw: function (c, v) {
    c.rotate(((v % 5) - 2) * 0.1);
    cel(c, function (c) { RR(c, -2.6, -40, 5.2, 42, 1.2); RR(c, -11, -32, 22, 5, 1.2); }, '#5A4232', '#33241A', '#7A5E46', 1.4, 0.8);
    fl(c, function (c) { RR(c, -3.4, -31.6, 6.8, 4.2, 1); }, '#3A2A1E');
    rope(c, function (c) { c.moveTo(-8, -29); c.quadraticCurveTo(-9, -22, -7, -16); }, '#8A7A5A', 1, 0.7);
  } };
  PROP.candles = { w: 40, h: 40, oy: 32, layer: 'tall', light: { r: 110, col: '#FFC27A', flick: 0.3 }, draw: function (c, v) {
    fl(c, function (c) { E(c, 0, 0, 14, 4); }, '#D8CCB0', true);
    candle(c, -7, 0, 12, 5); candle(c, 2, 1, 18, 5.6); candle(c, 9, 0, 9, 4.4);
  }, anim: function (c, t, v) {
    var hs = [[-7, -14.4], [2, -19.4], [9, -11.4]];
    var op = c.globalCompositeOperation; c.globalCompositeOperation = 'lighter';
    glow(c, 1, -14, 26, 20, '#FFB04A', 0.4 * flick(t, v));
    c.globalCompositeOperation = op;
    for (var i = 0; i < 3; i++) flames(c, hs[i][0], hs[i][1], 1.8, 6.5, t, v + i);
  } };
  PROP.deadTree = { w: 96, h: 120, oy: 112, layer: 'tall', draw: function (c, v, theme) {
    var col = theme === 'kor' ? ['#2A2024', '#140E10', '#4A3A40'] : ['#4A4448', '#2A2428', '#6A6268'];
    c.rotate(((v % 5) - 2) * 0.05);
    cel(c, function (c) { c.moveTo(-12, 2); c.quadraticCurveTo(-6, -4, -6, -20); c.bezierCurveTo(-8, -50, -2, -62, -6, -76); c.lineTo(4, -78); c.bezierCurveTo(4, -60, 8, -50, 6, -20); c.quadraticCurveTo(6, -4, 14, 2); c.closePath(); }, col[0], col[1], col[2], 3, 1.4);
    var br = [[-4, -50, -30, -72, -36, -88], [2, -62, 26, -80, 34, -98], [-4, -72, -14, -96, -10, -106], [4, -40, 22, -50, 30, -46], [-5, -36, -20, -42, -26, -36]];
    for (var i = 0; i < br.length; i++) { var b = br[i]; rope(c, function (c) { c.moveTo(b[0], b[1]); c.quadraticCurveTo(b[2], b[3], b[4], b[5]); }, col[0], 3.4 - i * 0.3, 1.1); }
    if (theme !== 'kor') { rope(c, function (c) { c.moveTo(26, -80); c.lineTo(26, -66); }, '#8A7A5A', 0.8, 0.5); fl(c, function (c) { Ci(c, 26, -63, 3); }, '#C9C1AA'); fl(c, function (c) { Ci(c, 25, -63.4, 0.8); Ci(c, 27.2, -63.4, 0.8); }, '#1A1414', true); }
  } };
  PROP.lantern = { w: 40, h: 84, oy: 76, layer: 'tall', light: { r: 140, col: '#C8FF8A', flick: 0.12 }, draw: function (c, v) {
    cel(c, function (c) { RR(c, -2.2, -66, 4.4, 66, 1.4); }, '#3A3440', '#1E1A24', '#5A5466', 1.2, 0.7);
    rope(c, function (c) { c.moveTo(0, -64); c.lineTo(12, -64); c.lineTo(12, -58); }, '#3A3440', 2, 1);
  }, anim: function (c, t, v) {
    var sw = sin(t * 1.6 + v) * 0.12;
    c.save(); c.translate(12, -58); c.rotate(sw);
    var op = c.globalCompositeOperation; c.globalCompositeOperation = 'lighter';
    glow(c, 0, 10, 22, 22, '#9DFF6A', 0.5 * flick(t, v)); c.globalCompositeOperation = op;
    setLine(c, 1.4);
    fl(c, function (c) { P(c, [-5, 3, 5, 3, 6.4, 17, -6.4, 17]); }, 'rgba(200,255,150,0.55)');
    fl(c, function (c) { P(c, [-6, 1, 0, -3, 6, 1, 5, 3, -5, 3]); P(c, [-7, 17, 7, 17, 5, 20, -5, 20]); }, '#3A3440');
    ln(c, 0, 3, 0, 17, '#3A3440', 1.2);
    c.globalCompositeOperation = 'lighter'; glow(c, 0, 11, 6, 7, '#E8FFC8', 0.9, true); c.globalCompositeOperation = op;
    c.restore();
  } };
  PROP.bones = { w: 56, h: 30, oy: 18, layer: 'floor', draw: function (c, v) {
    var R = rng(v * 7 + 11);
    for (var i = 0; i < 4; i++) {
      var bx = (R() - 0.5) * 34, by = (R() - 0.5) * 10, a = R() * PI, L = 6 + R() * 5;
      c.save(); c.translate(bx, by); c.rotate(a);
      rope(c, function (c) { c.moveTo(-L, 0); c.lineTo(L, 0); }, '#D8D0BA', 2.4, 0.9);
      fl(c, function (c) { Ci(c, -L, -1.4, 1.8); Ci(c, -L, 1.4, 1.8); Ci(c, L, -1.4, 1.8); Ci(c, L, 1.4, 1.8); }, '#D8D0BA');
      c.restore();
    }
    cel(c, function (c) { Ci(c, 6, -3, 6); }, '#E2DAC4', '#A89E86', '#FFFBEF', 1.4, 0.8);
    fl(c, function (c) { RR(c, 3, 1, 7, 3.6, 1); }, '#E2DAC4');
    fl(c, function (c) { Ci(c, 4, -3, 1.7); Ci(c, 8.4, -3, 1.7); }, '#1A1414', true);
  } };
  PROP.soulFire = { w: 50, h: 70, oy: 30, layer: 'tall', light: { r: 120, col: '#5CFFB0', flick: 0.2 }, draw: function (c, v) {
    var R = rng(v + 99);
    for (var i = 0; i < 3; i++) { var bx = (i - 1) * 9, by = -2 + (i % 2) * 2; cel(c, function (c) { Ci(c, bx, by - 5, 5.6); }, '#E2DAC4', '#A89E86', '#FFFBEF', 1.4, 0.8); fl(c, function (c) { Ci(c, bx - 2, by - 5, 1.5); Ci(c, bx + 2, by - 5, 1.5); }, '#1A1414', true); }
    cel(c, function (c) { Ci(c, 0, -13, 6); }, '#E2DAC4', '#A89E86', '#FFFBEF', 1.4, 0.8);
    fl(c, function (c) { Ci(c, -2.2, -13, 1.6); Ci(c, 2.2, -13, 1.6); }, '#1A1414', true);
    R();
  }, anim: function (c, t, v) {
    var y = -34 + sin(t * 2 + v) * 3, op = c.globalCompositeOperation;
    c.globalCompositeOperation = 'lighter'; glow(c, 0, y, 20, 22, '#2BFF8A', 0.6, true);
    flames(c, 0, y + 8, 5, 18, t, v, SOUL_COLS);
    glow(c, -2.2, -13, 3, 3, '#5CFFA0', 0.8); glow(c, 2.2, -13, 3, 3, '#5CFFA0', 0.8);
    c.globalCompositeOperation = op;
  } };
  PROP.fence = { w: 70, h: 44, oy: 36, layer: 'tall', draw: function (c, v) {
    c.rotate(((v % 3) - 1) * 0.06);
    for (var i = 0; i < 4; i++) { var x = -24 + i * 16, h = 26 + (i % 2) * 4 - (i === 3 ? 8 : 0); cel(c, function (c) { P(c, [x - 2, 0, x - 2, -h, x, -h - 5, x + 2, -h, x + 2, 0]); }, '#3A3440', '#1E1A24', '#5A5466', 1.2, 0.7); }
    ln(c, -28, -20, 26, -18, '#2A2630', 2.6); ln(c, -28, -8, 26, -7, '#2A2630', 2.6);
  } };
  // --- kor
  PROP.lavaCrack = { w: 100, h: 44, oy: 22, layer: 'floor', light: { r: 130, col: '#FF6A1F', flick: 0.12 }, draw: function (c, v) {
    var R = rng(v * 41 + 2), pts = [], i, pass;
    for (i = 0; i < 13; i++) pts.push([-42 + i * 7, (R() - 0.5) * 7 + sin(i * 0.9 + v) * 3]);
    var br = [[4, 1, 7, 12], [8, -1, 6, -11]];
    // charred rim, molten body, hot core — tapered toward both ends
    for (pass = 0; pass < 3; pass++) {
      for (i = 1; i < pts.length; i++) {
        var k = sin(i / (pts.length - 1) * PI), w = (pass === 0 ? 7 : pass === 1 ? 3.6 : 1.2) * (0.35 + 0.65 * k);
        c.beginPath(); c.moveTo(pts[i - 1][0], pts[i - 1][1]); c.lineTo(pts[i][0], pts[i][1]);
        strokeW(c, pass === 0 ? '#120A0A' : pass === 1 ? '#E8501A' : '#FFC86A', w);
      }
      for (var j = 0; j < br.length; j++) {
        var bb = br[j], p0 = pts[bb[0]];
        c.beginPath(); c.moveTo(p0[0], p0[1]); c.quadraticCurveTo(p0[0] + bb[1] * 3, p0[1] + bb[3] * 0.5, p0[0] + bb[2], p0[1] + bb[3]);
        strokeW(c, pass === 0 ? '#120A0A' : pass === 1 ? '#C8401A' : '#FF9A4A', pass === 0 ? 4.4 : pass === 1 ? 2 : 0.7);
      }
    }
  }, anim: function (c, t, v) {
    var op = c.globalCompositeOperation; c.globalCompositeOperation = 'lighter';
    var p = 0.6 + 0.4 * sin(t * 1.4 + v);
    glow(c, -20, 0, 34, 16, '#FF5A1A', 0.45 * p); glow(c, 18, 0, 34, 16, '#FF5A1A', 0.45 * (1.4 - p));
    for (var i = 0; i < 3; i++) { var q = fract(t * 0.5 + i / 3 + v * 0.07); glow(c, -30 + i * 26 + sin(q * 6) * 3, -q * 34, 2.4, 2.4, '#FFB04A', sin(q * PI)); }
    c.globalCompositeOperation = op;
  } };
  PROP.obsidian = { w: 60, h: 64, oy: 54, layer: 'tall', draw: function (c, v) {
    var sh = [[-10, 0, -0.3, 30, 7], [4, 0, 0.1, 42, 8], [14, 1, 0.5, 22, 6]];
    for (var i = 0; i < sh.length; i++) {
      var k = sh[i];
      c.save(); c.translate(k[0], k[1]); c.rotate(k[2]);
      cel(c, function (c) { P(c, [-k[4], 0, -k[4] * 0.6, -k[3] * 0.7, 0, -k[3], k[4] * 0.7, -k[3] * 0.6, k[4], 0]); }, '#221C2A', '#0C0810', '#4A3E5E', 2.4, 1.4);
      ln(c, -k[4] * 0.3, -k[3] * 0.65, 0, -k[3] + 3, '#8A7AB0', 1);
      c.restore();
    }
  } };
  PROP.brazier = { w: 44, h: 64, oy: 52, layer: 'tall', light: { r: 170, col: '#FF8A2A', flick: 0.22 }, draw: function (c, v) {
    rope(c, function (c) { c.moveTo(-10, 0); c.lineTo(-4, -22); c.moveTo(10, 0); c.lineTo(4, -22); c.moveTo(0, 2); c.lineTo(0, -22); }, '#4A4450', 2.2, 1);
    cel(c, function (c) { c.moveTo(-14, -30); c.quadraticCurveTo(-12, -18, 0, -18); c.quadraticCurveTo(12, -18, 14, -30); c.closePath(); }, '#5A5462', '#2A2630', '#8A8496', 2, 1);
    fl(c, function (c) { E(c, 0, -30, 14, 3.6); }, '#2A1410');
    fl(c, function (c) { Ci(c, -6, -30, 2.4); Ci(c, 1, -31, 2.8); Ci(c, 7, -30, 2.2); }, '#FF7A2F', true);
    for (var i = -1; i <= 1; i += 2) fl(c, function (c) { P(c, [i * 14, -30, i * 17, -36, i * 12, -31]); }, '#5A5462');
  }, anim: function (c, t, v) {
    var op = c.globalCompositeOperation; c.globalCompositeOperation = 'lighter';
    glow(c, 0, -40, 36, 36, '#FF7A2A', 0.55 * flick(t, v), true);
    c.globalCompositeOperation = op;
    flames(c, -5, -29, 5, 18, t, v); flames(c, 5, -29, 5, 16, t, v + 2); flames(c, 0, -29, 6.5, 24, t, v + 4);
    c.globalCompositeOperation = 'lighter';
    for (var i = 0; i < 4; i++) { var q = fract(t * 0.8 + i / 4 + v * 0.1); glow(c, sin(i * 5 + q * 5) * 8, -40 - q * 40, 2, 2, '#FFD27A', 1 - q); }
    c.globalCompositeOperation = op;
  } };
  PROP.emberVent = { w: 50, h: 40, oy: 30, layer: 'tall', light: { r: 100, col: '#FF5A1A', flick: 0.3 }, draw: function (c, v) {
    cel(c, function (c) { c.moveTo(-18, 0); c.quadraticCurveTo(-10, -6, -6, -16); c.lineTo(6, -16); c.quadraticCurveTo(10, -6, 18, 0); c.quadraticCurveTo(0, 4, -18, 0); c.closePath(); }, '#2E2226', '#141012', '#4A3A40', 3, 1.4);
    fl(c, function (c) { E(c, 0, -16, 6.4, 2.4); }, '#FF8A2A');
    fl(c, function (c) { E(c, 0, -16, 3.6, 1.2); }, '#FFE07A', true);
  }, anim: function (c, t, v) {
    var op = c.globalCompositeOperation; c.globalCompositeOperation = 'lighter';
    glow(c, 0, -18, 18, 12, '#FF6A1F', 0.6 * flick(t, v), true);
    for (var i = 0; i < 6; i++) { var q = fract(t * 0.7 + i / 6 + v * 0.11); glow(c, sin(i * 7 + q * 4) * 6 * q, -18 - q * 46, 2.6 - q, 2.6 - q, i % 2 ? '#FFB04A' : '#FF6A1F', 1 - q); }
    c.globalCompositeOperation = op;
  } };
  PROP.fireCrystal = { w: 50, h: 56, oy: 48, layer: 'tall', light: { r: 110, col: '#FF7A2F', flick: 0.1 }, draw: function (c, v) {
    var cs = [[-8, 0, -0.35, 20, 5], [3, 0, 0.05, 30, 6.5], [12, 1, 0.4, 16, 4.4]];
    for (var i = 0; i < cs.length; i++) {
      var k = cs[i];
      c.save(); c.translate(k[0], k[1]); c.rotate(k[2]);
      cel(c, function (c) { P(c, [-k[4], 0, -k[4], -k[3] * 0.75, 0, -k[3], k[4], -k[3] * 0.75, k[4], 0]); }, '#FF7A2F', '#B8300E', '#FFE0A0', 2, 1.2);
      ln(c, 0, -k[3] + 2, 0, -2, 'rgba(255,255,255,0.6)', 1);
      c.restore();
    }
    cel(c, function (c) { rockShape(c, 18, 7, v); }, '#2E2226', '#141012', '#4A3A40', 1.6, 0.8);
  }, anim: function (c, t, v) {
    var op = c.globalCompositeOperation; c.globalCompositeOperation = 'lighter';
    glow(c, 2, -18, 28, 30, '#FF6A1F', 0.5 * (0.7 + 0.3 * sin(t * 2.4 + v)), true);
    c.globalCompositeOperation = op;
  } };
  PROP.skullPile = { w: 50, h: 36, oy: 28, layer: 'tall', draw: function (c, v) {
    var sk = [[-10, 0], [0, 1], [10, 0], [-5, -8], [5, -8], [0, -16]];
    for (var i = 0; i < sk.length; i++) { var s = sk[i]; cel(c, function (c) { Ci(c, s[0], s[1] - 5, 5.6); }, '#E2DAC4', '#A89E86', '#FFFBEF', 1.4, 0.8); fl(c, function (c) { Ci(c, s[0] - 2, s[1] - 5, 1.5); Ci(c, s[0] + 2, s[1] - 5, 1.5); }, '#1A1414', true); }
  } };
  PROP.spikes = { w: 50, h: 40, oy: 32, layer: 'tall', draw: function (c, v) {
    for (var i = 0; i < 4; i++) { var x = -14 + i * 9, h = 14 + ((i * 7 + v) % 3) * 6; cel(c, function (c) { P(c, [x - 4, 0, x + (i - 1.5) * 1.2, -h, x + 4, 0]); }, '#2A2228', '#120C10', '#5A4A54', 1.6, 0.9); }
    fl(c, function (c) { E(c, 0, 0, 20, 3.4); }, '#1A1214', true);
  } };
  // --- kale
  PROP.pillar = { w: 50, h: 140, oy: 130, layer: 'tall', draw: function (c, v) {
    var broken = v % 3 === 2, h = broken ? 52 + (v % 5) * 6 : 108;
    cel(c, function (c) { RR(c, -17, -9, 34, 9, 2); }, '#4A4452', '#2A2632', '#6A6474', 2, 1);
    if (broken) cel(c, function (c) { c.moveTo(-12, -8); c.lineTo(-12, -h + 6); c.lineTo(-6, -h); c.lineTo(0, -h + 8); c.lineTo(5, -h + 2); c.lineTo(12, -h + 10); c.lineTo(12, -8); c.closePath(); }, '#5A5462', '#34303C', '#7A7484', 4, 2);
    else cel(c, function (c) { RR(c, -12, -h, 24, h - 8, 2); }, '#5A5462', '#34303C', '#7A7484', 4, 2);
    for (var i = -1; i <= 1; i++) ln(c, i * 6, -10, i * 6, -h + (broken ? 12 : 4), 'rgba(20,14,26,0.55)', 1.2);
    if (!broken) {
      cel(c, function (c) { RR(c, -16, -h - 8, 32, 9, 2); }, '#4A4452', '#2A2632', '#6A6474', 2, 1);
      fl(c, function (c) { c.moveTo(-12, -h + 30); c.quadraticCurveTo(-4, -h + 18, 4, -h + 26); c.quadraticCurveTo(10, -h + 40, 12, -h + 60); c.lineTo(12, -h + 28); c.quadraticCurveTo(4, -h + 12, -12, -h + 22); c.closePath(); }, 'rgba(70,96,52,0.8)', true);
    } else {
      cel(c, function (c) { rockShape(c, 9, 7, v); }, '#5A5462', '#34303C', '#7A7484', 1.6, 0.8);
    }
  } };
  PROP.banner = { w: 50, h: 120, oy: 112, layer: 'tall', draw: function (c, v) {
    cel(c, function (c) { RR(c, -2.4, -104, 4.8, 104, 1.4); }, '#3A3440', '#1E1A24', '#5A5466', 1.2, 0.7);
    cel(c, function (c) { RR(c, -16, -104, 32, 4, 1.4); }, '#8A6A2A', '#5A4214', '#C8A04A', 1, 0.6);
    fl(c, function (c) { Ci(c, 0, -108, 3); }, '#FFCB57');
  }, anim: function (c, t, v) {
    var w1 = sin(t * 2 + v) * 2.4, w2 = sin(t * 2 + v + 1.2) * 3.4;
    setLine(c, 2);
    function cloth(c) { c.moveTo(-14, -100); c.lineTo(14, -100); c.quadraticCurveTo(15 + w1, -76, 14 + w2, -52); c.lineTo(6 + w2, -58); c.lineTo(0 + w2, -48); c.lineTo(-6 + w2, -58); c.lineTo(-14 + w2, -52); c.quadraticCurveTo(-15 + w1, -76, -14, -100); c.closePath(); }
    cel(c, cloth, '#8E1324', '#5A0A16', '#C8304A', 2.4, 1.2);
    c.beginPath(); c.moveTo(-11, -97); c.lineTo(11, -97); strokeW(c, '#FFCB57', 1.4);
    // emblem: violet eye-rune (Gölge)
    var ex = w1 * 0.6, ey = -80;
    fl(c, function (c) { c.moveTo(ex - 8, ey); c.quadraticCurveTo(ex, ey - 7, ex + 8, ey); c.quadraticCurveTo(ex, ey + 7, ex - 8, ey); }, '#FFCB57');
    fl(c, function (c) { Ci(c, ex, ey, 2.6); }, '#3A0A16', true);
  } };
  PROP.rubble = { w: 64, h: 40, oy: 30, layer: 'tall', draw: function (c, v) {
    var R = rng(v * 23 + 9);
    for (var i = 0; i < 5; i++) {
      var bx = (R() - 0.5) * 36, by = (R() - 0.5) * 8, bw = 6 + R() * 6, bh = 5 + R() * 5, a = (R() - 0.5) * 0.6;
      c.save(); c.translate(bx, by); c.rotate(a);
      cel(c, function (c) { RR(c, -bw, -bh * 2, bw * 2, bh * 2, 1.6); }, '#5A5462', '#34303C', '#7A7484', 1.8, 1);
      c.restore();
    }
  } };
  PROP.candelabra = { w: 50, h: 90, oy: 82, layer: 'tall', light: { r: 150, col: '#FFC27A', flick: 0.25 }, draw: function (c, v) {
    cel(c, function (c) { c.moveTo(-10, 0); c.lineTo(-3, -6); c.lineTo(3, -6); c.lineTo(10, 0); c.closePath(); }, '#3A3440', '#1E1A24', '#5A5466', 1);
    rope(c, function (c) { c.moveTo(0, -6); c.lineTo(0, -56); c.moveTo(-14, -56); c.quadraticCurveTo(-14, -44, 0, -44); c.quadraticCurveTo(14, -44, 14, -56); }, '#3A3440', 2.6, 1);
    candle(c, -14, -56, 9, 4); candle(c, 0, -58, 12, 4.4); candle(c, 14, -56, 9, 4);
  }, anim: function (c, t, v) {
    var hs = [[-14, -67.4], [0, -72.4], [14, -67.4]];
    var op = c.globalCompositeOperation; c.globalCompositeOperation = 'lighter';
    glow(c, 0, -68, 34, 26, '#FFB04A', 0.42 * flick(t, v)); c.globalCompositeOperation = op;
    for (var i = 0; i < 3; i++) flames(c, hs[i][0], hs[i][1], 1.8, 6.5, t, v + i);
  } };
  PROP.barrel = { w: 40, h: 48, oy: 42, layer: 'tall', draw: function (c, v) {
    cel(c, function (c) { c.moveTo(-11, 0); c.quadraticCurveTo(-15, -15, -11, -30); c.lineTo(11, -30); c.quadraticCurveTo(15, -15, 11, 0); c.closePath(); }, '#6A4A30', '#3A2618', '#8E6A48', 3, 1.4);
    c.beginPath(); c.moveTo(-13.4, -8); c.lineTo(13.4, -8); c.moveTo(-13.4, -22); c.lineTo(13.4, -22); strokeW(c, '#3A3440', 2.4);
    cel(c, function (c) { E(c, 0, -30, 11, 3.4); }, '#7A5A3A', '#4A3220', null, 1);
  } };
  PROP.crate = { w: 44, h: 46, oy: 40, layer: 'tall', draw: function (c, v) {
    cel(c, function (c) { RR(c, -13, -26, 26, 26, 1.6); }, '#6A4A30', '#3A2618', '#8E6A48', 3, 1.4);
    c.beginPath(); c.moveTo(-11, -24); c.lineTo(11, -2); c.moveTo(-13, -13); c.lineTo(13, -13); strokeW(c, '#3A2618', 2);
    fl(c, function (c) { P(c, [-13, -26, -9, -31, 17, -31, 13, -26]); }, '#8E6A48');
    fl(c, function (c) { P(c, [13, -26, 17, -31, 17, -5, 13, 0]); }, '#4A3220');
  } };
  PROP.rug = { w: 110, h: 60, oy: 30, layer: 'floor', draw: function (c, v) {
    c.scale(1, 0.5);
    cel(c, function (c) { RR(c, -46, -40, 92, 80, 6); }, '#6A1424', '#40080F', '#8E2436', 4, 2, true);
    c.beginPath(); RR(c, -40, -34, 80, 68, 4); strokeW(c, '#C8A04A', 2.4);
    c.beginPath(); c.moveTo(0, -24); c.lineTo(16, 0); c.lineTo(0, 24); c.lineTo(-16, 0); c.closePath(); strokeW(c, '#C8A04A', 2);
    fl(c, function (c) { Ci(c, 0, 0, 5); }, '#C8A04A', true);
  } };

  var THEME_PROPS = {
    orman: [['tree', 1.4], ['rock', 1.6], ['bush', 2], ['fern', 2], ['stump', 1], ['mushrooms', 1.3], ['torch', 0.55], ['roots', 1.4], ['leafpile', 1.4], ['crystal', 0.35]],
    mezarlik: [['grave', 3], ['cross', 1.4], ['candles', 1.2], ['deadTree', 1.1], ['lantern', 0.7], ['bones', 1.6], ['soulFire', 0.45], ['fence', 0.9], ['rock', 0.8]],
    kor: [['lavaCrack', 1.8], ['obsidian', 2], ['brazier', 0.7], ['emberVent', 0.9], ['fireCrystal', 0.7], ['skullPile', 0.8], ['spikes', 1.2], ['deadTree', 0.6], ['rock', 1.2], ['bones', 0.7]],
    kale: [['pillar', 1.6], ['banner', 0.9], ['brazier', 0.8], ['rubble', 1.8], ['candelabra', 0.8], ['barrel', 1], ['crate', 1], ['rug', 0.6], ['torch', 0.5], ['bones', 0.5]]
  };
  Art.chunkProps = function (theme, cx, cy, size) {
    theme = THEME_PROPS[theme] ? theme : 'orman';
    size = size > 0 ? size : TILE;
    var list = THEME_PROPS[theme], tot = 0, i;
    for (i = 0; i < list.length; i++) tot += list[i][1];
    var R = rng(hstr(theme + ':' + (cx | 0) + ':' + (cy | 0)) ^ 0x5bd1e995);
    var count = round((size * size) / (512 * 512) * (6 + R() * 5));
    var out = [], minD = 70, tries = 0;
    while (out.length < count && tries < count * 8) {
      tries++;
      var lx = 30 + R() * (size - 60), ly = 30 + R() * (size - 60), ok = true;
      for (var j = 0; j < out.length; j++) { var dx = out[j].lx - lx, dy = out[j].ly - ly; if (dx * dx + dy * dy < minD * minD) { ok = false; break; } }
      if (!ok) continue;
      var pick = R() * tot, kind = list[0][0];
      for (i = 0; i < list.length; i++) { pick -= list[i][1]; if (pick <= 0) { kind = list[i][0]; break; } }
      var def = PROP[kind], s = 0.85 + R() * 0.35, v = (R() * 997) | 0;
      var p = { kind: kind, x: cx * size + lx, y: cy * size + ly, s: round(s * 100) / 100, lx: lx, ly: ly, v: v, theme: theme, layer: def.layer, f: R() < 0.5 ? -1 : 1 };
      if (def.light) p.light = { r: round(def.light.r * s), col: def.light.col, flick: def.light.flick };
      out.push(p);
    }
    out.sort(function (a, b) { return a.y - b.y; });
    return out;
  };
  var PSPR = Object.create(null);
  function propSprite(kind, v, theme) {
    var def = PROP[kind]; if (!def) return null;
    var vv = (v | 0) % 6, key = kind + '|' + vv + '|' + theme, S = PSPR[key];
    if (S) return S;
    var k = bakeK();
    S = Art.bake(function (c) { c.translate(def.w / 2, def.oy); setLine(c, 2); def.draw(c, vv, theme); }, def.w, def.h, 1);
    S.ox = def.w / 2; S.oy = def.oy; S.img = S.frames[0];
    PSPR[key] = S; return S;
  }
  Art.drawProp = function (ctx, p, t) {
    if (!p) return;
    var def = PROP[p.kind]; if (!def) return;
    var S = propSprite(p.kind, p.v || 0, p.theme || 'orman'); if (!S || !S.img) return;
    var s = p.s || 1, f = p.f < 0 && def.layer !== 'floor' ? -1 : 1;
    var ga = ctx.globalAlpha, op = ctx.globalCompositeOperation;
    if (def.layer === 'tall') shadow(ctx, p.x, p.y, S.w * 0.36 * s, S.w * 0.1 * s, 0.85);
    if (f < 0) { ctx.scale(-1, 1); ctx.drawImage(S.img, -p.x - (S.w - S.ox) * s, p.y - S.oy * s, S.w * s, S.h * s); ctx.scale(-1, 1); }
    else ctx.drawImage(S.img, p.x - S.ox * s, p.y - S.oy * s, S.w * s, S.h * s);
    if (def.anim) {
      ctx.save(); ctx.translate(p.x, p.y); ctx.scale(s * f, s); setLine(ctx, 2);
      try { def.anim(ctx, t || 0, (p.v | 0) % 6); } catch (err) { /* decorative only */ }
      ctx.restore();
    }
    ctx.globalAlpha = ga; ctx.globalCompositeOperation = op;
  };

  // ==========================================================================================
  // PICKUPS — baked sprites + cheap live sparkle/bob. (x, y) = centre on the ground.
  // ==========================================================================================
  var PKS = Object.create(null);
  var GEM = { xp1: ['#5BD16E', 6.5], xp2: ['#4BA3FF', 8.5], xp3: ['#B565FF', 11] };
  function gemShape(c, w, h) { c.moveTo(0, -h); c.lineTo(w, -h * 0.15); c.lineTo(0, h * 0.85); c.lineTo(-w, -h * 0.15); c.closePath(); }
  function pickupSprite(kind) {
    if (PKS[kind]) return PKS[kind];
    var S;
    if (GEM[kind]) {
      var col = GEM[kind][0], sz = GEM[kind][1], w = sz * 0.72, h = sz;
      S = Art.bake(function (c, cx, cy) {
        c.translate(cx, cy); setLine(c, 1.3);
        c.globalCompositeOperation = 'lighter'; glow(c, 0, 0, sz * 2, sz * 2, col, 0.55); c.globalCompositeOperation = 'source-over';
        fl(c, function (c) { gemShape(c, w, h); }, col);
        fl(c, function (c) { c.moveTo(0, -h); c.lineTo(-w, -h * 0.15); c.lineTo(-w * 0.35, -h * 0.1); c.closePath(); }, lt(col, 0.55), true);
        fl(c, function (c) { c.moveTo(0, -h); c.lineTo(w, -h * 0.15); c.lineTo(w * 0.35, -h * 0.1); c.closePath(); }, lt(col, 0.2), true);
        fl(c, function (c) { c.moveTo(-w, -h * 0.15); c.lineTo(0, h * 0.85); c.lineTo(-w * 0.35, -h * 0.1); c.closePath(); }, dk(col, 0.15), true);
        fl(c, function (c) { c.moveTo(w, -h * 0.15); c.lineTo(0, h * 0.85); c.lineTo(w * 0.35, -h * 0.1); c.closePath(); }, dk(col, 0.45), true);
        fl(c, function (c) { c.moveTo(-w * 0.35, -h * 0.1); c.lineTo(w * 0.35, -h * 0.1); c.lineTo(0, h * 0.85); c.closePath(); }, dk(col, 0.25), true);
        c.beginPath(); gemShape(c, w, h); c.stroke();
        fl(c, function (c) { E(c, -w * 0.38, -h * 0.45, w * 0.18, h * 0.22, -0.5); }, '#FFFFFF', true);
      }, sz * 4, sz * 4, 1);
    } else if (kind === 'gold') {
      S = Art.bake(function (c, cx, cy, ft) {
        c.translate(cx, cy); setLine(c, 1.2);
        var sx = cos(ft * TAU), aw = abs(sx) * 0.86 + 0.14, edge = 1.6 * (1 - abs(sx));
        c.globalCompositeOperation = 'lighter'; glow(c, 0, 0, 13, 13, '#FFB020', 0.45); c.globalCompositeOperation = 'source-over';
        fl(c, function (c) { E(c, edge * (sx < 0 ? -1 : 1), 0, 7.4 * aw + edge, 7.4); }, '#A8620A');
        fl(c, function (c) { E(c, 0, 0, 7.4 * aw, 7.4); }, '#FFCB57');
        fl(c, function (c) { E(c, 0, 0, 5.4 * aw, 5.4); }, '#E39A2D', true);
        if (aw > 0.4) fl(c, function (c) { P(c, [0, -3, 0.9 * aw, -0.9, 3 * aw, 0, 0.9 * aw, 0.9, 0, 3, -0.9 * aw, 0.9, -3 * aw, 0, -0.9 * aw, -0.9]); }, '#FFF1C4', true);
        fl(c, function (c) { E(c, -2.4 * aw, -2.6, 1.3 * aw, 1.6, -0.5); }, '#FFFFFF', true);
      }, 28, 28, 8);
    } else if (kind === 'heal') {
      S = Art.bake(function (c, cx, cy) {
        c.translate(cx, cy + 1); c.rotate(-0.5); setLine(c, 1.5);
        rope(c, function (c) { c.moveTo(2, 0); c.lineTo(11, 0); }, '#F2EAD6', 3, 1.3);
        fl(c, function (c) { Ci(c, 11.6, -1.8, 2.4); Ci(c, 11.6, 1.8, 2.4); }, '#F2EAD6');
        cel(c, function (c) { c.moveTo(4, -4); c.bezierCurveTo(0, -10, -13, -9, -12, 0); c.bezierCurveTo(-11, 8, 0, 9, 4, 4); c.closePath(); }, '#C8502E', '#8A2A16', '#F08A5A', 2.4, 1.3);
        fl(c, function (c) { E(c, -6, -2.6, 3, 1.6, -0.3); }, '#FFB48A', true);
        c.beginPath(); c.moveTo(-9, 3); c.quadraticCurveTo(-5, 5, -1, 4); strokeW(c, '#8A2A16', 1);
      }, 34, 30, 1);
    } else if (kind === 'magnet') {
      S = Art.bake(function (c, cx, cy) {
        c.translate(cx, cy + 1); c.rotate(0.35); setLine(c, 1.5);
        c.beginPath(); c.arc(0, -1, 7.5, PI, 0); c.lineTo(7.5, 7); c.moveTo(-7.5, 7); c.lineTo(-7.5, -1);
        strokeW(c, OUT, 8.4); strokeW(c, '#E8394D', 5.6);
        c.beginPath(); c.arc(0, -1, 7.5, PI * 1.1, PI * 1.5); strokeW(c, '#FF8A95', 1.6);
        cel(c, function (c) { RR(c, -10.3, 4, 5.6, 5, 1); RR(c, 4.7, 4, 5.6, 5, 1); }, '#D8DEE8', '#8A92A0', '#FFFFFF', 1, 0.6);
      }, 30, 30, 1);
    } else if (kind === 'bomb') {
      S = Art.bake(function (c, cx, cy) {
        c.translate(cx, cy + 2); setLine(c, 1.5);
        cel(c, function (c) { Ci(c, 0, 0, 8.4); }, '#2E2A3A', '#141018', '#5A5470', 2.4, 1.3);
        fl(c, function (c) { E(c, -3, -3.4, 2.4, 1.6, -0.6); }, '#9A94B0', true);
        cel(c, function (c) { RR(c, -2.8, -11, 5.6, 3.4, 1); }, '#6A6478', '#3A3448', null, 0.8);
        rope(c, function (c) { c.moveTo(0, -11); c.quadraticCurveTo(2, -15, 5, -15); }, '#C8A46A', 1.4, 0.8);
        // skull decal
        fl(c, function (c) { Ci(c, 0.6, 1, 3.2); RR(c, -1.2, 3, 3.6, 2.2, 0.6); }, '#E8E2D0', true);
        fl(c, function (c) { Ci(c, -0.6, 0.8, 0.9); Ci(c, 1.8, 0.8, 0.9); }, '#2E2A3A', true);
      }, 30, 32, 1);
    } else if (kind === 'chest') {
      S = Art.bake(function (c, cx, cy) {
        c.translate(cx, cy + 6); setLine(c, 1.8);
        c.globalCompositeOperation = 'lighter'; glow(c, 0, -6, 26, 20, '#FFB020', 0.5); c.globalCompositeOperation = 'source-over';
        cel(c, function (c) { RR(c, -14, -10, 28, 16, 2); }, '#7A4A2A', '#4A2A16', '#A86A3E', 2.4, 1.2);
        cel(c, function (c) { c.moveTo(-14, -10); c.lineTo(-14, -15); c.quadraticCurveTo(0, -25, 14, -15); c.lineTo(14, -10); c.closePath(); }, '#8A5632', '#5A3218', '#B87A4A', 2, 1.1);
        // gold bands + lock
        fl(c, function (c) { RR(c, -11, -21, 4, 27, 1); RR(c, 7, -21, 4, 27, 1); RR(c, -14.6, -11.4, 29.2, 3, 1); }, '#FFCB57');
        c.beginPath(); RR(c, -11, -21, 4, 27, 1); RR(c, 7, -21, 4, 27, 1); RR(c, -14.6, -11.4, 29.2, 3, 1); c.stroke();
        cel(c, function (c) { RR(c, -3.6, -13, 7.2, 8.4, 1.6); }, '#FFE07A', '#C08A2A', '#FFF6D6', 1.2, 0.7);
        fl(c, function (c) { Ci(c, 0, -10, 1.3); RR(c, -0.6, -10, 1.2, 3, 0.4); }, '#4A2A10', true);
        fl(c, function (c) { Ci(c, -9, -17, 1.1); Ci(c, 9, -17, 1.1); }, '#FFF6D6', true);
      }, 44, 40, 1);
    }
    PKS[kind] = S || null;
    return PKS[kind];
  }
  Art.drawPickup = function (ctx, kind, x, y, t) {
    var S = pickupSprite(kind); if (!S || !S.frames.length) return;
    t = t || 0;
    var ph = (x * 0.071 + y * 0.053), bob = sin(t * 3 + ph) * 1.6, w = S.w, h = S.h, img = S.frames[0];
    var ga = ctx.globalAlpha, op = ctx.globalCompositeOperation;
    if (kind === 'gold') { img = S.frames[floor(t * 12 + ph * 3) % S.frames.length]; }
    var lift = kind === 'chest' ? 0 : 3 + bob;
    shadow(ctx, x, y + (kind === 'chest' ? 5 : 4), w * 0.24 * (1 - lift * 0.03), w * 0.08, 0.8);
    if (kind === 'chest') {
      var pz = 0.7 + 0.3 * sin(t * 3 + ph);
      ctx.globalCompositeOperation = 'lighter';
      for (var i = 0; i < 6; i++) {
        var ra = -HP + (i - 2.5) * 0.32 + sin(t * 0.8 + i) * 0.06;
        ctx.globalAlpha = ga * 0.16 * pz;
        ctx.drawImage(glowSpr('#FFCB57'), x + cos(ra) * 18 - 4, y - 8 + sin(ra) * 22 - 14, 8, 28);
      }
      ctx.globalAlpha = ga;
      glow(ctx, x, y - 6, 30, 22, '#FFB020', 0.35 * pz);
      ctx.globalCompositeOperation = op;
      var hop = abs(sin(t * 2.2 + ph)) * 1.4;
      blitSnap(ctx, img, x - w / 2, y - h / 2 - 6 - hop, w, h, S.k, t);
      ctx.globalCompositeOperation = 'lighter';
      var q = fract(t * 0.7 + ph);
      spark(ctx, x - 10 + q * 22, y - 20 + sin(q * 9) * 4, 3.4 * sin(q * PI), '#FFF6D6', sin(q * PI));
      ctx.globalCompositeOperation = op;
      return;
    }
    blitSnap(ctx, img, x - w / 2, y - h / 2 - lift, w, h, S.k, t);
    if (GEM[kind]) {
      var sq = fract(t * 0.45 + ph * 0.37);
      if (sq < 0.22) { ctx.globalCompositeOperation = 'lighter'; var sa = sin(sq / 0.22 * PI); spark(ctx, x - GEM[kind][1] * 0.25, y - lift - GEM[kind][1] * 0.5, GEM[kind][1] * 0.55 * sa + 0.5, '#FFFFFF', sa); ctx.globalCompositeOperation = op; }
    } else if (kind === 'magnet') {
      ctx.globalCompositeOperation = 'lighter';
      for (i = 0; i < 2; i++) { var mq = fract(t * 1.5 + i * 0.5 + ph); glow(ctx, x + (i ? 6 : -6), y - lift + 8 + mq * 4, 4, 4, '#4BA3FF', 1 - mq); spark(ctx, x + (i ? 7 : -5), y - lift + 9 + mq * 5, 2.4 * (1 - mq), '#BFE6FF', 1 - mq); }
      ctx.globalCompositeOperation = op;
    } else if (kind === 'bomb') {
      ctx.globalCompositeOperation = 'lighter';
      var fq = flick(t * 1.6, ph);
      glow(ctx, x + 4.5, y - lift - 13, 7 * fq, 7 * fq, '#FFB020', 0.9, true);
      spark(ctx, x + 4.5, y - lift - 13, 3.2 * fq, '#FFFFFF', 0.9);
      ctx.globalCompositeOperation = op;
    } else if (kind === 'heal') {
      ctx.globalCompositeOperation = 'lighter';
      glow(ctx, x, y - lift, 16, 14, '#FF6A5A', 0.18 + 0.1 * sin(t * 4 + ph));
      ctx.globalCompositeOperation = op;
    }
  };

  // ==========================================================================================
  // SKILL ICONS — every RUN_SKILLS id + 'silahUst'. Designed at 64 units, cached per (id, pixel size).
  // ==========================================================================================
  var SK_FB = {
    kilicHalka: ['active', 'none'], yildirim: ['active', 'yildirim'], atesTopu: ['active', 'ates'], buzHalka: ['active', 'buz'], zehir: ['active', 'zehir'],
    bumerang: ['active', 'golge'], meteor: ['active', 'ates'], ruhlar: ['active', 'golge'],
    gucTasi: ['passive', 'none'], celikYurek: ['passive', 'none'], kumSaati: ['passive', 'none'], buyutec: ['passive', 'none'], kanKadeh: ['passive', 'none'],
    ruzgarCizme: ['passive', 'none'], bilgeKitap: ['passive', 'none'], miknatis: ['passive', 'none'], silahUst: ['weapon', 'none'],
    kilicFirtina: ['evo', 'none'], gokGurultusu: ['evo', 'yildirim'], cehennem: ['evo', 'ates'], mutlakSifir: ['evo', 'buz'], vebaBulutu: ['evo', 'zehir'],
    olumDansi: ['evo', 'golge'], kiyamet: ['evo', 'ates'], ruhOrdusu: ['evo', 'golge']
  };
  var PASSIVE_COL = { gucTasi: '#E8394D', celikYurek: '#C9CED8', kumSaati: '#FFCB57', buyutec: '#4BA3FF', kanKadeh: '#B8182E', ruzgarCizme: '#3EDBC8', bilgeKitap: '#9D6BFF', miknatis: '#4BA3FF' };
  function skInfo(id) {
    var s = null, i;
    if (GM.D && GM.D.RUN_SKILLS) for (i = 0; i < GM.D.RUN_SKILLS.length; i++) if (GM.D.RUN_SKILLS[i].id === id) { s = GM.D.RUN_SKILLS[i]; break; }
    var fb = SK_FB[id] || ['active', 'none'];
    var type = (s && s.type) || fb[0], el = (s && s.el) || fb[1];
    var col = type === 'passive' ? (PASSIVE_COL[id] || '#9D6BFF') : type === 'weapon' ? '#FFB020' : el === 'none' ? (type === 'evo' ? '#FFCB57' : '#9AA6C8') : elCol(el);
    return { type: type, el: el, col: col };
  }
  function miniSword(c, x, y, a, L, blade, glowCol) {
    c.save(); c.translate(x, y); c.rotate(a);
    cel(c, function (c) { P(c, [-L * 0.09, 0, -L * 0.09, -L * 0.72, 0, -L * 0.86, L * 0.09, -L * 0.72, L * 0.09, 0]); }, blade, dk(blade, 0.45), '#FFFFFF', 1.4, 0.8);
    ln(c, 0, -L * 0.1, 0, -L * 0.74, 'rgba(255,255,255,0.7)', 0.9);
    cel(c, function (c) { RR(c, -L * 0.26, -L * 0.02, L * 0.52, L * 0.09, 1.4); }, '#FFCB57', '#B07A22', '#FFF1C4', 0.8, 0.5);
    fl(c, function (c) { RR(c, -L * 0.055, L * 0.07, L * 0.11, L * 0.2, 1); }, '#5A3424');
    fl(c, function (c) { Ci(c, 0, L * 0.3, L * 0.07); }, glowCol || '#FFCB57');
    c.restore();
  }
  function cloud(c, x, y, s, base, shade, hi) {
    blob(c, function (c) { Ci(c, x - 10 * s, y + 2 * s, 8 * s); Ci(c, x, y - 4 * s, 10 * s); Ci(c, x + 11 * s, y + 1 * s, 8 * s); RR(c, x - 16 * s, y, 32 * s, 9 * s, 4 * s); }, base, shade, hi, 1.8, 2.4 * s, 1.4 * s);
  }
  function bolt(c, pts, w) {
    c.beginPath(); c.moveTo(pts[0], pts[1]); for (var i = 2; i < pts.length; i += 2) c.lineTo(pts[i], pts[i + 1]);
    strokeW(c, OUT, w + 3); strokeW(c, '#FFE45C', w); strokeW(c, '#FFFFFF', w * 0.35);
  }
  function skull(c, x, y, s, col, eyeCol) {
    cel(c, function (c) { c.moveTo(x - 9 * s, y); c.bezierCurveTo(x - 10 * s, y - 13 * s, x + 10 * s, y - 13 * s, x + 9 * s, y); c.quadraticCurveTo(x + 8 * s, y + 5 * s, x + 5 * s, y + 6 * s); c.lineTo(x + 5 * s, y + 9 * s); c.lineTo(x - 5 * s, y + 9 * s); c.lineTo(x - 5 * s, y + 6 * s); c.quadraticCurveTo(x - 8 * s, y + 5 * s, x - 9 * s, y); c.closePath(); }, col, dk(col, 0.35), '#FFFFFF', 1.8 * s, 1);
    fl(c, function (c) { E(c, x - 3.6 * s, y - 1 * s, 2.6 * s, 3 * s); E(c, x + 3.6 * s, y - 1 * s, 2.6 * s, 3 * s); }, eyeCol || '#1A1018', true);
    fl(c, function (c) { P(c, [x, y + 2.5 * s, x + 1.4 * s, y + 4.6 * s, x - 1.4 * s, y + 4.6 * s]); }, '#1A1018', true);
    for (var i = -1; i <= 1; i++) ln(c, x + i * 2.2 * s, y + 6.4 * s, x + i * 2.2 * s, y + 9 * s, dk(col, 0.5), 0.9);
  }
  function snowflake(c, x, y, R, col) {
    c.lineCap = 'round';
    for (var pass = 0; pass < 2; pass++) {
      c.beginPath();
      for (var i = 0; i < 6; i++) {
        var a = i * PI / 3 - HP, ca = cos(a), sa = sin(a);
        c.moveTo(x, y); c.lineTo(x + ca * R, y + sa * R);
        for (var b = 0; b < 2; b++) {
          var d = R * (0.45 + b * 0.25), bl = R * (0.26 - b * 0.06);
          c.moveTo(x + ca * d, y + sa * d); c.lineTo(x + ca * d + cos(a - 0.8) * bl, y + sa * d + sin(a - 0.8) * bl);
          c.moveTo(x + ca * d, y + sa * d); c.lineTo(x + ca * d + cos(a + 0.8) * bl, y + sa * d + sin(a + 0.8) * bl);
        }
      }
      strokeW(c, pass ? col : OUT, pass ? 3 : 6);
    }
    fl(c, function (c) { Ci(c, x, y, R * 0.2); }, '#FFFFFF');
  }
  function fireballGlyph(c, x, y, r, a) {
    c.save(); c.translate(x, y); c.rotate(a);
    flames(c, 0, r * 0.4, r * 1.0, r * 4.6, 0.37, 2);
    fl(c, function (c) { Ci(c, 0, 0, r); }, '#E8401E');
    fl(c, function (c) { Ci(c, -r * 0.12, -r * 0.12, r * 0.72); }, '#FF9A2A', true);
    fl(c, function (c) { Ci(c, -r * 0.22, -r * 0.22, r * 0.42); }, '#FFF0A0', true);
    c.restore();
  }
  function meteorRock(c, x, y, r) {
    var op = c.globalCompositeOperation;
    c.globalCompositeOperation = 'lighter'; glow(c, x - r * 1.2, y - r * 1.2, r * 3, r * 3, '#FF5A1A', 0.5); c.globalCompositeOperation = op;
    c.save(); c.translate(x, y); c.rotate(-0.785);
    flames(c, 0, r * 0.5, r * 1.1, r * 4.8, 0.71, 5);
    c.restore();
    cel(c, function (c) { c.moveTo(x - r, y); c.bezierCurveTo(x - r * 1.05, y - r * 0.9, x + r * 0.1, y - r * 1.15, x + r * 0.75, y - r * 0.55); c.bezierCurveTo(x + r * 1.2, y - r * 0.1, x + r * 0.9, y + r * 0.9, x + r * 0.1, y + r * 0.95); c.bezierCurveTo(x - r * 0.6, y + r, x - r * 0.95, y + r * 0.6, x - r, y); c.closePath(); }, '#6A4A4A', '#33201F', '#A07A70', r * 0.28, r * 0.14);
    fl(c, function (c) { E(c, x + r * 0.3, y + r * 0.3, r * 0.26, r * 0.2); E(c, x - r * 0.35, y - r * 0.35, r * 0.18, r * 0.14); }, '#3A2424', true);
    c.beginPath(); c.moveTo(x - r * 0.8, y + r * 0.1); c.lineTo(x - r * 0.25, y - r * 0.05); c.lineTo(x + r * 0.05, y + r * 0.5); c.moveTo(x - r * 0.25, y - r * 0.05); c.lineTo(x + r * 0.1, y - r * 0.6);
    strokeW(c, '#FF7A2A', mx(1.2, r * 0.16)); strokeW(c, '#FFE07A', mx(0.6, r * 0.06));
  }
  function wispGlyph(c, x, y, s, col) {
    var op = c.globalCompositeOperation; c.globalCompositeOperation = 'lighter'; glow(c, x, y, 12 * s, 12 * s, col, 0.8); c.globalCompositeOperation = op;
    fl(c, function (c) { c.moveTo(x - 6 * s, y + 2 * s); c.quadraticCurveTo(x - 7 * s, y - 6 * s, x + 1 * s, y - 13 * s); c.quadraticCurveTo(x + 1 * s, y - 6 * s, x + 6 * s, y - 2 * s); c.quadraticCurveTo(x + 7 * s, y + 7 * s, x, y + 7 * s); c.quadraticCurveTo(x - 6 * s, y + 7 * s, x - 6 * s, y + 2 * s); }, lt(col, 0.45));
    fl(c, function (c) { E(c, x - 2.2 * s, y + 1 * s, 1.2 * s, 1.6 * s); E(c, x + 2.2 * s, y + 1 * s, 1.2 * s, 1.6 * s); }, '#1A1030', true);
  }
  function shadowBlade(c, x, y, a, s) {
    c.save(); c.translate(x, y); c.rotate(a); c.scale(s, s);
    cel(c, function (c) { c.moveTo(-16, 6); c.bezierCurveTo(-14, -14, 6, -20, 18, -10); c.quadraticCurveTo(4, -10, -4, -2); c.quadraticCurveTo(-8, 2, -16, 6); c.closePath(); }, '#6A3AC8', '#2A1060', '#D2B8FF', 2.2, 1.2);
    c.beginPath(); c.moveTo(-12, 2); c.bezierCurveTo(-10, -12, 6, -17, 16, -10.4); strokeW(c, '#F4E6FF', 1.1);
    cel(c, function (c) { RR(c, -20, 4, 8, 5, 2); }, '#3A2A1E', '#1E140F', null, 0.8);
    c.restore();
  }
  var GLYPH = {
    kilicHalka: function (c) {
      c.beginPath(); c.arc(32, 33, 19, -2.6, 1.2); strokeW(c, 'rgba(220,230,255,0.35)', 3);
      for (var i = 0; i < 3; i++) { var a = -HP + i * TAU / 3; miniSword(c, 32 + cos(a) * 13, 33 + sin(a) * 13, a + HP + 0.9, 29, '#E8EEF8', '#4BA3FF'); }
      fl(c, function (c) { Ci(c, 32, 33, 4); }, '#4BA3FF'); fl(c, function (c) { Ci(c, 31, 32, 1.5); }, '#FFFFFF', true);
    },
    yildirim: function (c) {
      cloud(c, 32, 20, 1, '#4A4466', '#2A2440', '#7A74A0');
      bolt(c, [34, 26, 26, 38, 33, 38, 25, 54, 41, 34, 33, 34, 39, 26], 3.4);
    },
    atesTopu: function (c) { var op = c.globalCompositeOperation; c.globalCompositeOperation = 'lighter'; glow(c, 38, 38, 22, 22, '#FF5A1A', 0.6); c.globalCompositeOperation = op; fireballGlyph(c, 38, 38, 12.5, -0.75); },
    buzHalka: function (c) {
      c.beginPath(); c.arc(32, 32, 21, 0, TAU); strokeW(c, OUT, 5); strokeW(c, '#8FE0FF', 2.4);
      snowflake(c, 32, 32, 15, '#DFF6FF');
    },
    zehir: function (c) {
      cel(c, function (c) { RR(c, 28, 10, 8, 11, 1.4); }, '#D8E6E0', '#8AA8A0', null, 1);
      cel(c, function (c) { RR(c, 26.5, 7, 11, 5, 1.6); }, '#8A5A3A', '#5A3A22', null, 0.8);
      cel(c, function (c) { c.moveTo(28, 20); c.lineTo(36, 20); c.bezierCurveTo(52, 26, 50, 54, 32, 54); c.bezierCurveTo(14, 54, 12, 26, 28, 20); c.closePath(); }, 'rgba(200,240,230,0.5)', 'rgba(60,100,90,0.55)', '#FFFFFF', 2, 1.2);
      c.save(); c.beginPath(); c.moveTo(28, 20); c.lineTo(36, 20); c.bezierCurveTo(52, 26, 50, 54, 32, 54); c.bezierCurveTo(14, 54, 12, 26, 28, 20); c.clip();
      fl(c, function (c) { c.moveTo(14, 36); c.quadraticCurveTo(24, 32, 32, 35); c.quadraticCurveTo(42, 38, 50, 34); c.lineTo(50, 56); c.lineTo(14, 56); c.closePath(); }, '#7CE04A', true);
      fl(c, function (c) { c.moveTo(14, 36); c.quadraticCurveTo(24, 32, 32, 35); c.quadraticCurveTo(42, 38, 50, 34); c.lineTo(50, 38); c.quadraticCurveTo(40, 41, 32, 39); c.quadraticCurveTo(22, 36, 14, 40); c.closePath(); }, '#C8FF8A', true);
      c.restore();
      skull(c, 32, 44, 0.55, '#F2FFE8', '#2A4A10');
      fl(c, function (c) { Ci(c, 24, 28, 2); Ci(c, 38, 30, 1.4); }, 'rgba(255,255,255,0.8)', true);
    },
    bumerang: function (c) {
      c.beginPath(); c.arc(32, 34, 20, PI * 0.9, PI * 1.6); strokeW(c, 'rgba(180,140,255,0.4)', 2.4);
      c.beginPath(); c.arc(32, 34, 15, PI * 1.0, PI * 1.5); strokeW(c, 'rgba(180,140,255,0.25)', 1.6);
      shadowBlade(c, 33, 36, -0.4, 1.05);
    },
    meteor: function (c) { meteorRock(c, 38, 40, 10); },
    ruhlar: function (c) {
      rope(c, function (c) { c.moveTo(32, 8); c.lineTo(32, 14); }, '#5A5466', 1.6, 1);
      cel(c, function (c) { P(c, [24, 18, 32, 12, 40, 18, 38, 20, 26, 20]); P(c, [24, 46, 40, 46, 37, 51, 27, 51]); }, '#5A5466', '#2A2632', '#8A8496', 1, 0.6);
      fl(c, function (c) { RR(c, 25, 20, 14, 26, 3); }, 'rgba(120,255,220,0.25)');
      wispGlyph(c, 32, 35, 0.75, '#3EDBC8');
      c.beginPath(); c.moveTo(25, 20); c.lineTo(25, 46); c.moveTo(39, 20); c.lineTo(39, 46); c.moveTo(32, 20); c.lineTo(32, 23); strokeW(c, '#5A5466', 2);
      wispGlyph(c, 13, 26, 0.42, '#9D6BFF'); wispGlyph(c, 51, 40, 0.42, '#9D6BFF');
    },
    gucTasi: function (c) {
      cel(c, function (c) { P(c, [32, 10, 48, 22, 44, 46, 32, 54, 20, 46, 16, 22]); }, '#E8394D', '#8E1324', '#FF9AA5', 3, 1.6);
      fl(c, function (c) { P(c, [32, 10, 40, 24, 32, 30, 24, 24]); }, '#FF6A78', true);
      fl(c, function (c) { P(c, [24, 24, 32, 30, 32, 54, 20, 46, 16, 22]); }, 'rgba(120,10,30,0.3)', true);
      c.beginPath(); P(c, [32, 10, 48, 22, 44, 46, 32, 54, 20, 46, 16, 22]); c.stroke();
      c.beginPath(); c.moveTo(32, 30); c.lineTo(32, 54); c.moveTo(24, 24); c.lineTo(32, 30); c.lineTo(40, 24); strokeW(c, '#8E1324', 1.2);
      fl(c, function (c) { P(c, [26, 16, 29, 14, 24, 22]); }, '#FFFFFF', true);
    },
    celikYurek: function (c) {
      function heart(c) { c.moveTo(32, 52); c.bezierCurveTo(8, 38, 10, 14, 24, 14); c.bezierCurveTo(29, 14, 32, 18, 32, 22); c.bezierCurveTo(32, 18, 35, 14, 40, 14); c.bezierCurveTo(54, 14, 56, 38, 32, 52); c.closePath(); }
      cel(c, heart, '#A8B0C0', '#5A6272', '#F2F6FF', 3.4, 1.8);
      c.save(); c.translate(32, 32); c.scale(0.45, 0.45); c.translate(-32, -32);
      fl(c, heart, '#E8394D'); c.restore();
      fl(c, function (c) { Ci(c, 20, 26, 1.4); Ci(c, 44, 26, 1.4); Ci(c, 32, 46, 1.4); Ci(c, 24, 38, 1.4); Ci(c, 40, 38, 1.4); }, '#5A6272', true);
      fl(c, function (c) { E(c, 22, 20, 4, 2.4, -0.6); }, '#FFFFFF', true);
    },
    kumSaati: function (c) {
      cel(c, function (c) { c.moveTo(22, 14); c.lineTo(42, 14); c.quadraticCurveTo(42, 28, 34, 32); c.quadraticCurveTo(42, 36, 42, 50); c.lineTo(22, 50); c.quadraticCurveTo(22, 36, 30, 32); c.quadraticCurveTo(22, 28, 22, 14); c.closePath(); }, 'rgba(200,230,255,0.4)', 'rgba(80,110,150,0.4)', '#FFFFFF', 2, 1);
      fl(c, function (c) { c.moveTo(25, 20); c.lineTo(39, 20); c.quadraticCurveTo(38, 27, 32, 30); c.quadraticCurveTo(26, 27, 25, 20); }, '#FFCB57', true);
      fl(c, function (c) { c.moveTo(24, 48); c.quadraticCurveTo(32, 38, 40, 48); c.closePath(); }, '#FFCB57', true);
      ln(c, 32, 30, 32, 46, '#FFE07A', 1.2);
      cel(c, function (c) { RR(c, 17, 9, 30, 6, 2); RR(c, 17, 49, 30, 6, 2); }, '#8A5A2A', '#5A3A18', '#C08A4A', 1.2, 0.7);
      rope(c, function (c) { c.moveTo(19, 15); c.lineTo(19, 49); c.moveTo(45, 15); c.lineTo(45, 49); }, '#8A5A2A', 2, 1);
    },
    buyutec: function (c) {
      rope(c, function (c) { c.moveTo(38, 38); c.lineTo(52, 52); }, '#6A3A22', 5, 1.4);
      fl(c, function (c) { Ci(c, 27, 27, 15); }, OUT);
      fl(c, function (c) { Ci(c, 27, 27, 12.6); }, '#FFCB57');
      cel(c, function (c) { Ci(c, 27, 27, 9.6); }, 'rgba(120,200,255,0.55)', 'rgba(40,90,160,0.5)', 'rgba(255,255,255,0.9)', 2, 1.6);
      fl(c, function (c) { E(c, 23, 22, 3, 1.8, -0.7); }, '#FFFFFF', true);
    },
    kanKadeh: function (c) {
      cel(c, function (c) { c.moveTo(16, 14); c.lineTo(48, 14); c.quadraticCurveTo(48, 34, 34, 36); c.lineTo(34, 44); c.lineTo(42, 50); c.lineTo(22, 50); c.lineTo(30, 44); c.lineTo(30, 36); c.quadraticCurveTo(16, 34, 16, 14); c.closePath(); }, '#FFCB57', '#A8620A', '#FFF1C4', 2.6, 1.4);
      fl(c, function (c) { E(c, 32, 16, 14, 3.6); }, '#8E1324');
      fl(c, function (c) { E(c, 30, 15.4, 8, 1.6); }, '#E8394D', true);
      fl(c, function (c) { c.moveTo(42, 17); c.quadraticCurveTo(44, 24, 43, 27); c.arc(42.4, 27, 1.6, 0, PI); c.quadraticCurveTo(41, 23, 40, 18); }, '#C8182E', true);
      fl(c, function (c) { Ci(c, 32, 26, 2.6); }, '#E8394D');
    },
    ruzgarCizme: function (c) {
      cel(c, function (c) { c.moveTo(24, 12); c.lineTo(38, 12); c.lineTo(38, 38); c.quadraticCurveTo(50, 40, 52, 48); c.lineTo(52, 52); c.lineTo(20, 52); c.lineTo(22, 40); c.closePath(); }, '#8A5A34', '#5A3418', '#B88A5A', 2.4, 1.3);
      fl(c, function (c) { RR(c, 22, 12, 18, 6, 2); }, '#C8A46A');
      ln(c, 20, 48, 52, 48, '#3A2414', 2.4);
      // wing
      for (var fi = 0; fi < 3; fi++) {
        var fy = 15 + fi * 5.5, fl2 = 20 - fi * 4;
        cel(c, function (c) { c.moveTo(25, fy + 4); c.quadraticCurveTo(25 - fl2 * 0.5, fy - 6 + fi, 25 - fl2, fy - 4 + fi * 1.5); c.quadraticCurveTo(25 - fl2 * 0.55, fy + 2, 25, fy + 8); c.closePath(); }, '#F2FBFF', '#9AC8DA', null, 1.3);
      }
      c.beginPath(); c.moveTo(8, 40); c.lineTo(16, 40); c.moveTo(6, 46); c.lineTo(16, 46); strokeW(c, 'rgba(160,240,230,0.8)', 1.6);
    },
    bilgeKitap: function (c) {
      cel(c, function (c) { RR(c, 14, 12, 36, 42, 3); }, '#5A2A9A', '#2E1258', '#8A5AD0', 2.4, 1.2);
      fl(c, function (c) { RR(c, 16, 48, 34, 5, 1.4); }, '#F2EAD6');
      fl(c, function (c) { P(c, [14, 12, 20, 12, 14, 18]); P(c, [50, 12, 44, 12, 50, 18]); P(c, [14, 54, 20, 54, 14, 48]); P(c, [50, 54, 44, 54, 50, 48]); }, '#FFCB57');
      c.beginPath(); c.moveTo(32, 20); c.lineTo(38, 30); c.lineTo(32, 42); c.lineTo(26, 30); c.closePath(); c.moveTo(32, 26); c.lineTo(32, 36); strokeW(c, '#1A0A30', 4); strokeW(c, '#E2CCFF', 1.6);
    },
    miknatis: function (c) {
      c.beginPath(); c.arc(32, 28, 13, PI, 0); c.lineTo(45, 46); c.moveTo(19, 46); c.lineTo(19, 28);
      strokeW(c, OUT, 14); strokeW(c, '#E8394D', 9.4);
      c.beginPath(); c.arc(32, 28, 13, PI * 1.1, PI * 1.45); strokeW(c, '#FF9AA5', 2.4);
      cel(c, function (c) { RR(c, 14, 42, 10, 9, 1.6); RR(c, 40, 42, 10, 9, 1.6); }, '#D8DEE8', '#8A92A0', '#FFFFFF', 1.4, 0.8);
      c.beginPath(); c.moveTo(10, 56); c.lineTo(14, 54); c.moveTo(54, 56); c.lineTo(50, 54); c.moveTo(32, 54); c.lineTo(32, 58); strokeW(c, '#8FD8FF', 1.6);
    },
    silahUst: function (c) {
      // anvil
      cel(c, function (c) { c.moveTo(12, 34); c.lineTo(50, 34); c.quadraticCurveTo(54, 34, 56, 30); c.lineTo(46, 40); c.lineTo(40, 40); c.lineTo(42, 48); c.lineTo(48, 52); c.lineTo(18, 52); c.lineTo(24, 48); c.lineTo(26, 40); c.lineTo(18, 40); c.quadraticCurveTo(12, 38, 12, 34); c.closePath(); }, '#5A5A6E', '#2E2E3E', '#9A9AB0', 2.2, 1.2);
      miniSword(c, 34, 33, -0.25, 30, '#E8EEF8', '#FF7A2F');
      var op = c.globalCompositeOperation; c.globalCompositeOperation = 'lighter';
      glow(c, 30, 30, 10, 8, '#FFB020', 0.7);
      for (var i = 0; i < 5; i++) { var a = -PI * 0.9 + i * 0.4; spark(c, 30 + cos(a) * 14, 30 + sin(a) * 12, 2.4, '#FFE07A', 1); }
      c.globalCompositeOperation = op;
    },
    kilicFirtina: function (c) {
      c.lineCap = 'round';
      for (var k = 0; k < 3; k++) { c.beginPath(); c.arc(32, 33, 10 + k * 7, -k * 1.4, -k * 1.4 + 3.6); strokeW(c, 'rgba(255,230,160,' + (0.5 - k * 0.12) + ')', 2.2); }
      for (var i = 0; i < 6; i++) { var a = i * TAU / 6 + 0.3, rr = 9 + (i % 2) * 8; miniSword(c, 32 + cos(a) * rr, 33 + sin(a) * rr, a + HP + 0.7, 18 + (i % 2) * 4, '#F2F6FF', '#FFCB57'); }
      var op = c.globalCompositeOperation; c.globalCompositeOperation = 'lighter'; glow(c, 32, 33, 12, 12, '#FFCB57', 0.9, true); c.globalCompositeOperation = op;
    },
    gokGurultusu: function (c) {
      cloud(c, 32, 18, 1.25, '#3A3456', '#1E1A30', '#6A64A0');
      bolt(c, [22, 26, 16, 38, 22, 38, 14, 54], 3);
      bolt(c, [34, 28, 28, 40, 35, 40, 28, 58], 3.6);
      bolt(c, [46, 26, 42, 36, 48, 36, 42, 50], 2.6);
      var op = c.globalCompositeOperation; c.globalCompositeOperation = 'lighter'; glow(c, 32, 40, 22, 18, '#FFE45C', 0.45); c.globalCompositeOperation = op;
    },
    cehennem: function (c) {
      flames(c, 22, 30, 8, 26, 0.2, 1); flames(c, 42, 30, 8, 26, 0.6, 2); flames(c, 32, 26, 10, 30, 0.9, 3);
      skull(c, 32, 36, 1.15, '#2A1A1A', '#FFE07A');
      var op = c.globalCompositeOperation; c.globalCompositeOperation = 'lighter';
      glow(c, 28, 35, 6, 6, '#FFB020', 0.9); glow(c, 36.4, 35, 6, 6, '#FFB020', 0.9);
      c.globalCompositeOperation = op;
    },
    mutlakSifir: function (c) {
      var op = c.globalCompositeOperation; c.globalCompositeOperation = 'lighter'; glow(c, 32, 34, 26, 26, '#7FD8FF', 0.55); c.globalCompositeOperation = op;
      for (var i = 0; i < 8; i++) { var a = i * TAU / 8; ln(c, 32 + cos(a) * 18, 34 + sin(a) * 18, 32 + cos(a) * 25, 34 + sin(a) * 25, '#DFF6FF', 1.6); }
      var cs = [[-9, 50, -0.45, 22, 5], [9, 50, 0.45, 22, 5], [0, 52, 0, 38, 7.4]];
      for (i = 0; i < cs.length; i++) { var k = cs[i]; c.save(); c.translate(32 + k[0], k[1]); c.rotate(k[2]); cel(c, function (c) { P(c, [-k[4], 0, -k[4], -k[3] * 0.72, 0, -k[3], k[4], -k[3] * 0.72, k[4], 0]); }, '#9FE6FF', '#3A8AC8', '#FFFFFF', 2, 1.2); ln(c, 0, -k[3] + 3, 0, -3, 'rgba(255,255,255,0.8)', 1.2); c.restore(); }
      snowflake(c, 32, 30, 7, '#FFFFFF');
    },
    vebaBulutu: function (c) {
      var op = c.globalCompositeOperation; c.globalCompositeOperation = 'lighter'; glow(c, 32, 34, 26, 22, '#7CFF3A', 0.4); c.globalCompositeOperation = op;
      blob(c, function (c) { Ci(c, 18, 36, 10); Ci(c, 30, 26, 13); Ci(c, 44, 32, 11); Ci(c, 34, 42, 11); Ci(c, 22, 44, 8); }, '#5A9A2A', '#2A5A12', '#9ADE5A', 2, 3, 1.6);
      skull(c, 32, 34, 0.85, '#E8FFD0', '#2A4A10');
      fl(c, function (c) { Ci(c, 12, 22, 2.4); Ci(c, 50, 18, 2); Ci(c, 52, 48, 1.6); Ci(c, 14, 52, 1.8); }, '#B6FF5A');
    },
    olumDansi: function (c) {
      var op = c.globalCompositeOperation; c.globalCompositeOperation = 'lighter';
      glow(c, 32, 32, 24, 24, '#9D6BFF', 0.55);
      c.globalCompositeOperation = op;
      c.beginPath(); c.arc(32, 32, 22, 0, TAU); strokeW(c, OUT, 4.4); strokeW(c, '#B57BFF', 2);
      shadowBlade(c, 32, 33, -0.8, 0.95); shadowBlade(c, 32, 33, 0.8 + PI, 0.95);
      fl(c, function (c) { Ci(c, 32, 33, 3.6); }, '#FF3D4F'); fl(c, function (c) { Ci(c, 31, 32, 1.2); }, '#FFFFFF', true);
    },
    kiyamet: function (c) {
      meteorRock(c, 22, 22, 6.4); meteorRock(c, 46, 30, 7.4); meteorRock(c, 30, 46, 9);
      var op = c.globalCompositeOperation; c.globalCompositeOperation = 'lighter'; glow(c, 30, 50, 22, 10, '#FF5A1A', 0.6); c.globalCompositeOperation = op;
    },
    ruhOrdusu: function (c) {
      wispGlyph(c, 18, 40, 0.65, '#9D6BFF'); wispGlyph(c, 46, 40, 0.65, '#9D6BFF');
      wispGlyph(c, 32, 22, 0.6, '#3EDBC8');
      skull(c, 32, 40, 0.95, '#E8E0FF', '#9D6BFF');
      var op = c.globalCompositeOperation; c.globalCompositeOperation = 'lighter'; glow(c, 28.6, 39, 4, 4, '#C08CFF', 0.9); glow(c, 35.4, 39, 4, 4, '#C08CFF', 0.9); c.globalCompositeOperation = op;
    }
  };
  function iconBase(c, info, id) {
    var col = info.col, type = info.type;
    var bg = c.createRadialGradient(32, 26, 3, 32, 32, 44);
    bg.addColorStop(0, mix(col, '#2A2038', type === 'evo' ? 0.25 : 0.42)); bg.addColorStop(0.55, mix(col, '#140F1C', 0.78)); bg.addColorStop(1, '#0A070E');
    c.beginPath(); RR(c, 3, 3, 58, 58, 12); c.fillStyle = bg; c.fill();
    c.save(); c.beginPath(); RR(c, 3, 3, 58, 58, 12); c.clip();
    if (type === 'evo') {
      c.globalCompositeOperation = 'lighter';
      for (var i = 0; i < 12; i++) { var a = i / 12 * TAU; c.beginPath(); c.moveTo(32, 32); c.arc(32, 32, 50, a, a + 0.14); c.closePath(); c.fillStyle = rgba(col, 0.12); c.fill(); }
      c.globalCompositeOperation = 'source-over';
    }
    if (type === 'passive') { c.beginPath(); c.arc(32, 32, 23, 0, TAU); c.fillStyle = 'rgba(0,0,0,0.28)'; c.fill(); c.lineWidth = 1.4; c.strokeStyle = rgba(col, 0.45); c.stroke(); }
    // inner bevel
    c.fillStyle = 'rgba(255,255,255,0.07)'; c.fillRect(3, 3, 58, 14);
    c.fillStyle = 'rgba(0,0,0,0.25)'; c.fillRect(3, 50, 58, 11);
    c.restore();
    // glyph
    setLine(c, 2);
    try { (GLYPH[id] || GLYPH.gucTasi)(c); } catch (err) { if (typeof console !== 'undefined') console.error('[GM.Art] icon', id, err); }
    // frame
    var fr = type === 'evo' ? ['#FFE9A3', '#E39A2D', '#8A5A14'] : type === 'passive' ? ['#E8C8A0', '#A8784A', '#5A3A1E'] : type === 'weapon' ? ['#FFD27A', '#D86A2A', '#6A2410'] : ['#E8E4F4', '#9A92B8', '#4A4260'];
    c.beginPath(); RR(c, 3, 3, 58, 58, 12); strokeW(c, OUT, 6.4);
    var fg = c.createLinearGradient(0, 3, 0, 61); fg.addColorStop(0, fr[0]); fg.addColorStop(0.5, fr[1]); fg.addColorStop(1, fr[2]);
    c.beginPath(); RR(c, 3, 3, 58, 58, 12); c.strokeStyle = fg; c.lineWidth = type === 'evo' ? 3.6 : 2.8; c.stroke();
    c.beginPath(); RR(c, 6.2, 6.2, 51.6, 51.6, 9.4); strokeW(c, 'rgba(0,0,0,0.45)', 1);
    if (type === 'evo') {
      // corner studs + top crest gem
      var cs = [[7, 7], [57, 7], [7, 57], [57, 57]];
      for (i = 0; i < 4; i++) { var p = cs[i]; fl(c, function (c) { P(c, [p[0], p[1] - 4.4, p[0] + 4.4, p[1], p[0], p[1] + 4.4, p[0] - 4.4, p[1]]); }, '#FFCB57'); fl(c, function (c) { Ci(c, p[0], p[1], 1.5); }, '#FF3D4F', true); }
      fl(c, function (c) { P(c, [24, 3, 28, -2, 32, 2, 36, -2, 40, 3, 32, 7]); }, '#FFCB57');
      fl(c, function (c) { Ci(c, 32, 3, 2); }, '#B565FF', true);
    } else if (type === 'weapon') {
      fl(c, function (c) { P(c, [3, 14, 3, 3, 14, 3]); P(c, [61, 14, 61, 3, 50, 3]); }, '#FFB020');
    }
  }
  var ICONS = Object.create(null);
  Art.drawSkillIcon = function (ctx, x, y, size, skillId, t) {
    size = size > 0 ? size : 64;
    var k = bakeK(), px = mx(8, round(size * k)), key = skillId + '|' + px, cv = ICONS[key];
    var info = skInfo(skillId);
    if (!cv) {
      cv = mkCv(px, px); if (!cv) return;
      var g = cv.getContext('2d'); g.setTransform(px / 64, 0, 0, px / 64, 0, 0);
      iconBase(g, info, skillId);
      ICONS[key] = cv;
    }
    ctx.drawImage(cv, x, y, size, size);
    if (info.type === 'evo' && t != null) {
      // animated: sweeping shine + twinkles (cheap)
      var ga = ctx.globalAlpha, op = ctx.globalCompositeOperation, s = size / 64;
      var q = fract((t || 0) * 0.45 + (hstr(skillId) % 100) / 100);
      ctx.save(); ctx.beginPath(); RR(ctx, x + 3 * s, y + 3 * s, 58 * s, 58 * s, 12 * s); ctx.clip();
      ctx.globalCompositeOperation = 'lighter';
      var sx2 = x + lerp(-30, 94, q) * s;
      ctx.globalAlpha = ga * 0.32;
      ctx.beginPath(); ctx.moveTo(sx2, y); ctx.lineTo(sx2 + 14 * s, y); ctx.lineTo(sx2 - 6 * s, y + size); ctx.lineTo(sx2 - 20 * s, y + size); ctx.closePath(); ctx.fillStyle = '#FFF1C4'; ctx.fill();
      ctx.globalAlpha = ga;
      var tw = fract((t || 0) * 0.8);
      spark(ctx, x + 50 * s, y + 13 * s, 5 * s * sin(tw * PI), '#FFFFFF', sin(tw * PI));
      ctx.restore();
      ctx.globalAlpha = ga; ctx.globalCompositeOperation = op;
    }
  };

  // ==========================================================================================
  // FX — battle effects. Additive where it glows; all state restored; gradients only via cached sprites.
  // ==========================================================================================
  var BEAM = Object.create(null);
  function beamSpr(col) {
    if (BEAM[col]) return BEAM[col];
    var cv = mkCv(32, 128), g = cv.getContext('2d');
    var gr = g.createLinearGradient(0, 0, 32, 0);
    gr.addColorStop(0, rgba(col, 0)); gr.addColorStop(0.35, rgba(col, 0.55)); gr.addColorStop(0.5, rgba(mix(col, '#FFFFFF', 0.6), 1)); gr.addColorStop(0.65, rgba(col, 0.55)); gr.addColorStop(1, rgba(col, 0));
    g.fillStyle = gr; g.fillRect(0, 0, 32, 128);
    g.globalCompositeOperation = 'destination-in';
    var gv = g.createLinearGradient(0, 0, 0, 128); gv.addColorStop(0, 'rgba(0,0,0,0)'); gv.addColorStop(0.6, 'rgba(0,0,0,0.7)'); gv.addColorStop(1, 'rgba(0,0,0,1)');
    g.fillStyle = gv; g.fillRect(0, 0, 32, 128);
    BEAM[col] = cv; return cv;
  }
  var SWORD = Object.create(null);
  function swordSpr(col) {
    if (SWORD[col]) return SWORD[col];
    SWORD[col] = Art.bake(function (c, cx, cy) {
      c.translate(cx, cy + 14); setLine(c, 1.4);
      c.globalCompositeOperation = 'lighter'; glow(c, 0, -14, 9, 22, col, 0.6); c.globalCompositeOperation = 'source-over';
      miniSword(c, 0, 0, 0, 34, '#E8EEF8', col);
    }, 28, 52, 1);
    return SWORD[col];
  }
  function crescent(c, x, y, r, a0, a1, th, N) {
    var i, a, w;
    c.beginPath();
    for (i = 0; i <= N; i++) { a = a0 + (a1 - a0) * i / N; if (i) c.lineTo(x + cos(a) * r, y + sin(a) * r); else c.moveTo(x + cos(a) * r, y + sin(a) * r); }
    for (i = N; i >= 0; i--) { a = a0 + (a1 - a0) * i / N; w = sin(i / N * PI); var ri = r * (1 - th * (0.15 + 0.85 * w)); c.lineTo(x + cos(a) * ri, y + sin(a) * ri); }
    c.closePath();
  }
  var FX = Art.fx = Art.fx || {};
  FX.shadow = function (ctx, x, y, rx, ry) { shadow(ctx, x, y, rx, ry == null ? rx * 0.35 : ry, 1); };
  FX.slash = function (ctx, x, y, r, ang, arc, p, col) {
    col = col || '#FFFFFF'; p = clamp(p || 0, 0, 1);
    var head = eOut(mn(1, p * 1.9)), tail = eIn(clamp((p - 0.15) / 0.85, 0, 1));
    var a0 = ang - arc / 2 + arc * tail, a1 = ang - arc / 2 + arc * head;
    if (a1 - a0 < 0.02) return;
    var al = p < 0.55 ? 1 : 1 - (p - 0.55) / 0.45;
    var ga = ctx.globalAlpha, op = ctx.globalCompositeOperation;
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = ga * al * 0.32; crescent(ctx, x, y, r * 1.06, a0, a1, 0.62, 18); ctx.fillStyle = col; ctx.fill();
    ctx.globalAlpha = ga * al * 0.85; crescent(ctx, x, y, r, a0 + (a1 - a0) * 0.1, a1, 0.3, 18); ctx.fillStyle = col; ctx.fill();
    ctx.globalAlpha = ga * al; crescent(ctx, x, y, r * 1.01, a0 + (a1 - a0) * 0.3, a1, 0.1, 12); ctx.fillStyle = '#FFFFFF'; ctx.fill();
    ctx.globalAlpha = ga;
    // leading flare + sparks shed along the arc
    glow(ctx, x + cos(a1) * r * 0.92, y + sin(a1) * r * 0.92, r * 0.42, r * 0.42, col, al * 0.9, true);
    for (var i = 0; i < 4; i++) {
      var k = 0.25 + i * 0.2, a = lerp(a0, a1, k), d = r * (1.04 + 0.12 * p + (i % 2) * 0.06);
      spark(ctx, x + cos(a) * d, y + sin(a) * d, r * 0.09 * (1 - p) + 1, '#FFFFFF', al * (0.5 + 0.5 * k));
    }
    ctx.globalAlpha = ga; ctx.globalCompositeOperation = op;
  };
  FX.spin = function (ctx, x, y, r, p, col) {
    col = col || '#B57BFF'; p = clamp(p || 0, 0, 1);
    var A = -HP + eOut(p) * TAU * 1.15, al = p < 0.75 ? 1 : 1 - (p - 0.75) / 0.25;
    var ga = ctx.globalAlpha, op = ctx.globalCompositeOperation;
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = ga * 0.14 * al * (1 - p); ctx.beginPath(); ctx.arc(x, y, r * 0.86, 0, TAU); ctx.lineWidth = r * 0.2; ctx.strokeStyle = col; ctx.stroke();
    ctx.globalAlpha = ga * 0.55 * al; crescent(ctx, x, y, r * 1.05, A - 2.6, A, 0.45, 22); ctx.fillStyle = col; ctx.fill();
    ctx.globalAlpha = ga * 0.9 * al; crescent(ctx, x, y, r, A - 1.5, A, 0.2, 14); ctx.fillStyle = mix(col, '#FFFFFF', 0.55); ctx.fill();
    ctx.globalAlpha = ga;
    glow(ctx, x + cos(A) * r * 0.88, y + sin(A) * r * 0.88, r * 0.3, r * 0.3, col, al, true);
    ctx.globalAlpha = ga; ctx.globalCompositeOperation = op;
  };
  FX.arrow = function (ctx, x, y, ang, col) {
    col = col || '#9FE6FF';
    var ga = ctx.globalAlpha, op = ctx.globalCompositeOperation;
    ctx.save(); ctx.translate(x, y); ctx.rotate(ang);
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = ga * 0.7; ctx.drawImage(glowSpr(col), -34, -4, 34, 8);
    ctx.globalAlpha = ga; glow(ctx, 6, 0, 8, 8, col, 0.6);
    ctx.globalCompositeOperation = op;
    ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(-14, 0); ctx.lineTo(5, 0); ctx.strokeStyle = OUT; ctx.lineWidth = 3.4; ctx.stroke(); ctx.strokeStyle = '#E8D8B0'; ctx.lineWidth = 1.6; ctx.stroke();
    ctx.beginPath(); ctx.moveTo(10, 0); ctx.lineTo(3, -3.6); ctx.lineTo(4.4, 0); ctx.lineTo(3, 3.6); ctx.closePath(); ctx.fillStyle = '#F2F6FF'; ctx.strokeStyle = OUT; ctx.lineWidth = 1.2; ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(-14, 0); ctx.lineTo(-17, -3.4); ctx.lineTo(-11, -0.6); ctx.moveTo(-14, 0); ctx.lineTo(-17, 3.4); ctx.lineTo(-11, 0.6); ctx.fillStyle = col; ctx.fill(); ctx.stroke();
    ctx.restore();
    ctx.globalAlpha = ga; ctx.globalCompositeOperation = op;
  };
  FX.orb = function (ctx, x, y, r, col, t) {
    col = col || '#B57BFF'; t = t || 0;
    var ga = ctx.globalAlpha, op = ctx.globalCompositeOperation, pz = 0.85 + 0.15 * sin(t * 12);
    ctx.globalCompositeOperation = 'lighter';
    glow(ctx, x, y, r * 3.2 * pz, r * 3.2 * pz, col, 0.55);
    glow(ctx, x, y, r * 1.6, r * 1.6, col, 0.95, true);
    ctx.globalCompositeOperation = op;
    ctx.beginPath(); ctx.arc(x, y, r * 0.78, 0, TAU); ctx.fillStyle = mix(col, '#FFFFFF', 0.35); ctx.fill();
    ctx.beginPath(); ctx.arc(x - r * 0.18, y - r * 0.18, r * 0.42, 0, TAU); ctx.fillStyle = '#FFFFFF'; ctx.fill();
    ctx.globalCompositeOperation = 'lighter';
    for (var i = 0; i < 3; i++) { var a = t * 6 + i * TAU / 3; spark(ctx, x + cos(a) * r * 1.5, y + sin(a) * r * 1.5 * 0.7, r * 0.45, '#FFFFFF', 0.8); }
    ctx.globalAlpha = ga; ctx.globalCompositeOperation = op;
  };
  FX.fireball = function (ctx, x, y, r, ang, t) {
    t = t || 0;
    var ga = ctx.globalAlpha, op = ctx.globalCompositeOperation;
    ctx.globalCompositeOperation = 'lighter';
    glow(ctx, x, y, r * 3.4, r * 3.4, '#FF5A1A', 0.6);
    ctx.globalCompositeOperation = op;
    ctx.save(); ctx.translate(x, y); ctx.rotate((ang || 0) - HP);
    flames(ctx, 0, r * 0.35, r * 0.95, r * 3.6, t, 3);
    ctx.restore();
    ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fillStyle = '#FF7A2A'; ctx.fill();
    ctx.globalCompositeOperation = 'lighter';
    glow(ctx, x, y, r * 1.5, r * 1.5, '#FFD27A', 1, true);
    ctx.globalAlpha = ga; ctx.globalCompositeOperation = op;
  };
  FX.bolt = function (ctx, x1, y1, x2, y2, t, col) {
    col = col || '#FFE45C'; t = t || 0;
    var dx = x2 - x1, dy = y2 - y1, L = sqrt(dx * dx + dy * dy); if (L < 1) return;
    var nx = -dy / L, ny = dx / L, N = mx(3, mn(18, round(L / 16))), R = rng(floor(t * 24) * 7919 + round(x1 + y2));
    var pts = [x1, y1];
    for (var i = 1; i < N; i++) { var k = i / N, j = (R() - 0.5) * L * 0.16 * sin(k * PI) + (R() - 0.5) * 6; pts.push(x1 + dx * k + nx * j, y1 + dy * k + ny * j); }
    pts.push(x2, y2);
    var ga = ctx.globalAlpha, op = ctx.globalCompositeOperation;
    ctx.globalCompositeOperation = 'lighter'; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    function path() { ctx.beginPath(); ctx.moveTo(pts[0], pts[1]); for (var q = 2; q < pts.length; q += 2) ctx.lineTo(pts[q], pts[q + 1]); }
    path(); ctx.globalAlpha = ga * 0.35; ctx.strokeStyle = col; ctx.lineWidth = 9; ctx.stroke();
    ctx.globalAlpha = ga * 0.9; ctx.lineWidth = 3.4; ctx.stroke();
    ctx.globalAlpha = ga; ctx.strokeStyle = '#FFFFFF'; ctx.lineWidth = 1.4; ctx.stroke();
    // a little fork
    var fi = 2 + ((R() * (pts.length / 2 - 3)) | 0) * 2;
    if (fi < pts.length - 2) { ctx.beginPath(); ctx.moveTo(pts[fi], pts[fi + 1]); ctx.lineTo(pts[fi] + (dx / L) * 14 + nx * 12 * (R() - 0.5) * 2, pts[fi + 1] + (dy / L) * 14 + ny * 12 * (R() - 0.5) * 2); ctx.strokeStyle = col; ctx.lineWidth = 1.6; ctx.globalAlpha = ga * 0.8; ctx.stroke(); }
    ctx.globalAlpha = ga;
    glow(ctx, x1, y1, 12, 12, col, 0.8, true); glow(ctx, x2, y2, 16, 16, col, 0.9, true);
    ctx.globalAlpha = ga; ctx.globalCompositeOperation = op;
  };
  FX.nova = function (ctx, x, y, r, p, col) {
    col = col || '#7FD8FF'; p = clamp(p || 0, 0, 1);
    var rr = r * (0.15 + 0.85 * eOut(p)), al = 1 - p;
    var ga = ctx.globalAlpha, op = ctx.globalCompositeOperation;
    ctx.globalCompositeOperation = 'lighter';
    glow(ctx, x, y, rr * 1.1, rr * 1.1, col, 0.3 * al);
    ctx.globalAlpha = ga * al;
    ctx.beginPath(); ctx.arc(x, y, rr, 0, TAU); ctx.strokeStyle = col; ctx.lineWidth = mx(1.5, r * 0.14 * (1 - p)); ctx.stroke();
    ctx.strokeStyle = '#FFFFFF'; ctx.lineWidth = mx(1, r * 0.04 * (1 - p)); ctx.stroke();
    // glinting shards riding the wave
    ctx.globalAlpha = ga;
    for (var i = 0; i < 10; i++) { var a = i / 10 * TAU + 0.2, rr2 = rr * (1 + (i % 2) * 0.05); spark(ctx, x + cos(a) * rr2, y + sin(a) * rr2, mx(1.5, r * 0.09 * (1 - p)), mix(col, '#FFFFFF', 0.6), al); }
    ctx.globalAlpha = ga; ctx.globalCompositeOperation = op;
  };
  FX.explosion = function (ctx, x, y, r, p, col) {
    col = col || '#FF7A2F'; p = clamp(p || 0, 0, 1);
    var ga = ctx.globalAlpha, op = ctx.globalCompositeOperation, i, a, d;
    var seed = (round(x * 3.1 + y * 7.7) | 0);
    // soft smoke puffs (normal blend, cached soft sprite)
    if (p > 0.2) {
      var sa = sin(seg(p, 0.2, 1) * PI) * 0.75;
      for (i = 0; i < 6; i++) { a = i / 6 * TAU + hashN(seed + i) * 0.8; d = r * (0.25 + 0.55 * eOut(p)); glow(ctx, x + cos(a) * d, y + sin(a) * d * 0.75 - p * r * 0.35, r * (0.35 + 0.25 * p), r * (0.35 + 0.25 * p), '#241C2C', sa); }
    }
    ctx.globalCompositeOperation = 'lighter';
    if (p < 0.22) glow(ctx, x, y, r * 1.9, r * 1.9, '#FFFFFF', (1 - p / 0.22) * 0.9, true);
    glow(ctx, x, y, r * (0.7 + 0.9 * eOut(p)), r * (0.7 + 0.9 * eOut(p)), col, (1 - p) * 0.9, true);
    ctx.globalCompositeOperation = op;
    // chunky cartoon fire puffs (orange rim, yellow core) that swell then shrink
    if (p < 0.62) {
      var fp = p / 0.62, ps = sin(fp * PI) * (1 - fp * 0.4);
      for (var L = 0; L < 2; L++) {
        ctx.fillStyle = L ? '#FFE07A' : mix(col, '#E8401E', 0.4);
        ctx.beginPath();
        for (i = 0; i < 6; i++) { a = i / 6 * TAU + hashN(seed + 9 + i) * 0.6; d = r * 0.42 * eOut(fp) * (L ? 0.6 : 1); Ci(ctx, x + cos(a) * d, y + sin(a) * d, r * (0.36 - L * 0.14) * ps * (0.8 + 0.4 * hashN(seed + 20 + i))); }
        Ci(ctx, x, y, r * (0.42 - L * 0.16) * ps);
        ctx.fill();
      }
    }
    ctx.globalCompositeOperation = 'lighter';
    // shock ring
    ctx.globalAlpha = ga * (1 - p) * 0.75; ctx.beginPath(); ctx.arc(x, y, r * (0.35 + 0.95 * eOut(p)), 0, TAU); ctx.strokeStyle = mix(col, '#FFFFFF', 0.45); ctx.lineWidth = mx(1, r * 0.09 * (1 - p)); ctx.stroke();
    // irregular sparks + ember debris
    ctx.globalAlpha = ga * (1 - p); ctx.strokeStyle = '#FFE07A'; ctx.lineWidth = mx(1, r * 0.035); ctx.lineCap = 'round'; ctx.beginPath();
    for (i = 0; i < 9; i++) { a = hashN(seed + 40 + i) * TAU; var sp = 0.6 + hashN(seed + 60 + i) * 0.8, d1 = r * (0.3 + sp * eOut(p)), d2 = d1 + r * 0.22 * (1 - p) * sp; ctx.moveTo(x + cos(a) * d1, y + sin(a) * d1); ctx.lineTo(x + cos(a) * d2, y + sin(a) * d2); }
    ctx.stroke();
    ctx.globalAlpha = ga;
    for (i = 0; i < 5; i++) { a = hashN(seed + 80 + i) * TAU; d = r * (0.4 + 1.0 * eOut(p)) * (0.7 + hashN(seed + 90 + i) * 0.5); glow(ctx, x + cos(a) * d, y + sin(a) * d + p * p * r * 0.5, r * 0.08 + 1.5, r * 0.08 + 1.5, '#FFB04A', 1 - p, true); }
    ctx.globalAlpha = ga; ctx.globalCompositeOperation = op;
  };
  FX.pool = function (ctx, x, y, r, t, col) {
    col = col || '#8BE04E'; t = t || 0;
    var ga = ctx.globalAlpha, op = ctx.globalCompositeOperation, i;
    ctx.beginPath();
    for (i = 0; i <= 20; i++) { var a = i / 20 * TAU, w = 1 + 0.07 * sin(a * 3 + t * 2) + 0.05 * sin(a * 5 - t * 3); var px = x + cos(a) * r * w, py = y + sin(a) * r * 0.55 * w; if (i) ctx.lineTo(px, py); else ctx.moveTo(px, py); }
    ctx.closePath(); ctx.globalAlpha = ga * 0.5; ctx.fillStyle = dk(col, 0.55); ctx.fill();
    ctx.globalAlpha = ga * 0.5; ctx.lineWidth = 1.6; ctx.strokeStyle = col; ctx.stroke();
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = ga;
    glow(ctx, x, y, r * 1.05, r * 0.6, col, 0.4);
    for (i = 0; i < 5; i++) {
      var q = fract(t * 0.9 + i * 0.23), bx = x + cos(i * 2.4) * r * 0.55, by = y + sin(i * 2.4) * r * 0.3, br = (1.5 + (i % 3)) * (0.5 + q) * mx(0.6, r / 40);
      ctx.globalAlpha = ga * (1 - q); ctx.beginPath(); ctx.arc(bx, by - q * 4, br, 0, TAU); ctx.lineWidth = 1.2; ctx.strokeStyle = mix(col, '#FFFFFF', 0.5); ctx.stroke();
    }
    ctx.globalAlpha = ga; ctx.globalCompositeOperation = op;
  };
  FX.meteorShadow = function (ctx, x, y, r, p) {
    p = clamp(p || 0, 0, 1);
    var ga = ctx.globalAlpha, op = ctx.globalCompositeOperation;
    shadow(ctx, x, y, r * (0.25 + 0.85 * p), r * (0.25 + 0.85 * p) * 0.5, 0.5 + 0.5 * p);
    var pul = 0.6 + 0.4 * sin(p * 30);
    ctx.globalAlpha = ga * (0.12 + 0.2 * p); ctx.beginPath(); ctx.ellipse(x, y, r, r * 0.5, 0, 0, TAU); ctx.fillStyle = '#E8394D'; ctx.fill();
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = ga * (0.5 + 0.5 * p) * pul; ctx.lineWidth = 2.4; ctx.strokeStyle = '#FF5A4A'; ctx.stroke();
    ctx.globalAlpha = ga * 0.8; ctx.lineWidth = 1.6; ctx.beginPath();
    for (var i = 0; i < 4; i++) { var a = i * HP + p * 2; ctx.moveTo(x + cos(a) * r * 0.78, y + sin(a) * r * 0.39); ctx.lineTo(x + cos(a) * r * 1.0, y + sin(a) * r * 0.5); }
    ctx.stroke();
    ctx.globalAlpha = ga * p * 0.8; ctx.beginPath(); ctx.ellipse(x, y, r * p, r * p * 0.5, 0, 0, TAU); ctx.strokeStyle = '#FFB04A'; ctx.lineWidth = 1.4; ctx.stroke();
    ctx.globalAlpha = ga; ctx.globalCompositeOperation = op;
  };
  FX.blade = function (ctx, x, y, r, ang, col) {
    col = col || '#9FE6FF';
    var S = swordSpr(col), h = r * 2.2, w = h * S.w / S.h;
    ctx.save(); ctx.translate(x, y); ctx.rotate(ang || 0);
    ctx.drawImage(S.frames[0], -w / 2, -h / 2 - h * 0.08, w, h);
    ctx.restore();
  };
  FX.wisp = function (ctx, x, y, r, t, col) {
    col = col || '#3EDBC8'; t = t || 0;
    var ga = ctx.globalAlpha, op = ctx.globalCompositeOperation, f = 0.9 + 0.1 * sin(t * 9 + x * 0.1);
    ctx.globalCompositeOperation = 'lighter';
    glow(ctx, x, y, r * 2.6 * f, r * 2.6 * f, col, 0.65);
    ctx.globalCompositeOperation = op;
    var s = r / 7, sw = sin(t * 7 + y * 0.1) * 2 * s;
    ctx.beginPath(); ctx.moveTo(x - 6 * s, y + 2 * s); ctx.quadraticCurveTo(x - 7 * s, y - 6 * s, x + sw, y - 14 * s * f); ctx.quadraticCurveTo(x + 1 * s, y - 6 * s, x + 6 * s, y - 2 * s); ctx.quadraticCurveTo(x + 7 * s, y + 7 * s, x, y + 7 * s); ctx.quadraticCurveTo(x - 6 * s, y + 7 * s, x - 6 * s, y + 2 * s);
    ctx.fillStyle = mix(col, '#FFFFFF', 0.45); ctx.fill();
    ctx.globalCompositeOperation = 'lighter'; glow(ctx, x, y, r * 1.1, r * 1.1, '#FFFFFF', 0.5); ctx.globalCompositeOperation = op;
    ctx.fillStyle = '#1A1030'; ctx.beginPath(); ctx.ellipse(x - 2.2 * s, y + 1 * s, 1.2 * s, 1.6 * s, 0, 0, TAU); ctx.ellipse(x + 2.2 * s, y + 1 * s, 1.2 * s, 1.6 * s, 0, 0, TAU); ctx.fill();
    ctx.globalAlpha = ga; ctx.globalCompositeOperation = op;
  };
  FX.soul = function (ctx, x, y, p, col) {
    col = col || '#9DFFF0'; p = clamp(p || 0, 0, 1);
    var ga = ctx.globalAlpha, op = ctx.globalCompositeOperation, yy = y - eOut(p) * 52, a = sin(p * PI), s = 1.6 - p * 0.6;
    ctx.globalCompositeOperation = 'lighter';
    glow(ctx, x + sin(p * 9) * 3, yy, 12 * s, 14 * s, col, a * 0.8, true);
    ctx.globalAlpha = ga * a * 0.85;
    ctx.beginPath(); ctx.moveTo(x - 4 * s, yy + 2); ctx.quadraticCurveTo(x - 5 * s, yy - 6 * s, x + sin(p * 12) * 2, yy - 12 * s); ctx.quadraticCurveTo(x + 5 * s, yy - 4 * s, x + 4 * s, yy + 2); ctx.quadraticCurveTo(x, yy + 6 * s, x - 4 * s, yy + 2);
    ctx.fillStyle = mix(col, '#FFFFFF', 0.5); ctx.fill();
    ctx.globalAlpha = ga; ctx.globalCompositeOperation = op;
  };
  FX.beam = function (ctx, x, y, h, col, t) {
    col = col || '#FFB020'; t = t || 0; h = h || 120;
    var ga = ctx.globalAlpha, op = ctx.globalCompositeOperation, pz = 0.85 + 0.15 * sin(t * 4);
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = ga * 0.85 * pz; ctx.drawImage(beamSpr(col), x - 15, y - h, 30, h);
    ctx.globalAlpha = ga * 0.6; ctx.drawImage(beamSpr(col), x - 5, y - h * 0.8, 10, h * 0.8);
    ctx.globalAlpha = ga;
    glow(ctx, x, y, 26, 10, col, 0.8 * pz, true);
    ctx.globalAlpha = ga * 0.7; ctx.beginPath(); ctx.ellipse(x, y, 14 + 4 * sin(t * 3), 5 + 1.4 * sin(t * 3), 0, 0, TAU); ctx.strokeStyle = mix(col, '#FFFFFF', 0.4); ctx.lineWidth = 1.4; ctx.stroke();
    ctx.globalAlpha = ga;
    for (var i = 0; i < 5; i++) { var q = fract(t * 0.6 + i / 5); spark(ctx, x + sin(i * 4.1 + q * 3) * 9, y - q * h * 0.9, 2.6 * sin(q * PI), '#FFFFFF', sin(q * PI)); }
    ctx.globalAlpha = ga; ctx.globalCompositeOperation = op;
  };

  // Sprites blit fastest when the battle canvas transform scale equals the bake scale. A battle that zooms
  // its camera can call setBakeScale(dpr * zoom) once (clears the caches so sprites re-bake at that scale).
  Art.setBakeScale = function (k) {
    k = +k || 0; k = k > 0 ? clamp(k, 0.5, 3) : 0;
    if (k === BAKE_K) return;
    BAKE_K = k; Art.clearWorldCache();
  };
  // Pre-build the lazily created variants of an enemy (avoids a small hitch the first time a status appears).
  Art.warmEnemy = function (type, kinds) {
    var S = Art.bakeEnemy(type);
    (kinds || ['frozen', 'burn', 'poison', 'die']).forEach(function (kd) { try { variant(S, kd); } catch (err) { /* ignore */ } });
    return S;
  };
  Art.clearWorldCache = function () {
    var k;
    for (k in SPR) delete SPR[k]; for (k in PSPR) delete PSPR[k]; for (k in ICONS) delete ICONS[k];
    for (k in PKS) delete PKS[k]; for (k in GROUND) delete GROUND[k]; for (k in OVL) delete OVL[k];
    for (k in SWORD) delete SWORD[k]; for (k in GLOW) delete GLOW[k]; for (k in BEAM) delete BEAM[k];
    SHADOW = null; TF.ctx = null;
  };

})(window.GM = window.GM || {});
