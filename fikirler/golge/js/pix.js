/* GÖLGE MUHAFIZLARI — pixel-art toolkit (owner: lead). See PIXEL.md.
   Everything here is cheap to call at bake time; per-frame code should only use blit/rect/text. */
(function (GM) {
  'use strict';

  var C = {
    ink: '#2A1F2D', ink2: '#3B2C3E', plum: '#4A3A55', plum2: '#5E4B6B', mauve: '#7A6489', mauve2: '#9A86A8',
    lilac: '#B9AFCB', lilac2: '#D8D0E2', brick0: '#5A333B', brick1: '#7C464C', brick2: '#A0625F', brick3: '#C08A80',
    stone0: '#57536E', stone1: '#6F6A86', stone2: '#8F8AA6', stone3: '#B4AFC8',
    moss0: '#2F4A3A', moss1: '#3F6B4A', moss2: '#5E8F5A', moss3: '#86B06A', moss4: '#B6D18A',
    teal0: '#2E5559', teal1: '#3E6F73', teal2: '#5FA0A0', teal3: '#9CD3C8',
    cream: '#F3EAD8', white: '#FFFFFF', skin0: '#C98C78', skin1: '#E8B79A', skin2: '#F6D3BC',
    red0: '#8E2F3C', red1: '#C4505A', red2: '#E07A7A', pink: '#F2A5A0',
    gold0: '#9A6A2E', gold1: '#C8963E', gold2: '#E8C46A', gold3: '#FFE9A0',
    ember0: '#A84A2E', ember1: '#D8743E', ember2: '#F2A65A',
    blue0: '#2E3F66', blue1: '#3D5A8C', blue2: '#5E86C2', blue3: '#9CC3E8',
    violet0: '#4E3380', violet1: '#7B4FB5', violet2: '#A77BE0', violet3: '#D2B6F5',
    bone0: '#9C9480', bone1: '#D6CCB2', bone2: '#EFE6CE'
  };
  var RAR = [
    [C.stone1, C.stone2, C.stone3], [C.moss1, C.moss2, C.moss4], [C.blue1, C.blue2, C.blue3],
    [C.violet1, C.violet2, C.violet3], [C.gold1, C.gold2, C.gold3], [C.red0, C.red1, C.red2]
  ];
  var FONT = '"Pixelify Sans", "Courier New", monospace';

  function hexRgb(h) {
    if (!h) return null;
    if (h.charAt(0) !== '#') h = C[h] || h;
    if (h.length === 4) h = '#' + h[1] + h[1] + h[2] + h[2] + h[3] + h[3];
    var n = parseInt(h.slice(1, 7), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  function rgbHex(r, g, b) { return '#' + ((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1).toUpperCase(); }
  function col(c) { return (c && c.charAt(0) !== '#' && C[c]) ? C[c] : c; }
  function canvas(w, h) { var c = document.createElement('canvas'); c.width = Math.max(1, w | 0); c.height = Math.max(1, h | 0); return c; }

  /* sprite(rows, map): rows = array of equal-ish strings; map = { char: colourName|'#hex' }.
     '.' and ' ' are transparent. Unknown chars are transparent. */
  function sprite(rows, map) {
    var h = rows.length, w = 0, x, y;
    for (y = 0; y < h; y++) if (rows[y].length > w) w = rows[y].length;
    var c = canvas(w, h), g = c.getContext('2d'), img = g.createImageData(w, h), d = img.data, cache = {};
    for (y = 0; y < h; y++) {
      var row = rows[y];
      for (x = 0; x < row.length; x++) {
        var ch = row.charAt(x);
        if (ch === '.' || ch === ' ') continue;
        var m = map[ch]; if (!m) continue;
        var rgb = cache[ch] || (cache[ch] = hexRgb(col(m)));
        var i = (y * w + x) * 4; d[i] = rgb[0]; d[i + 1] = rgb[1]; d[i + 2] = rgb[2]; d[i + 3] = 255;
      }
    }
    g.putImageData(img, 0, 0);
    return c;
  }

  /* fromFn(w, h, fn): fn(g, P) draws with integer primitives; g has smoothing off. Returns the canvas. */
  function fromFn(w, h, fn) {
    var c = canvas(w, h), g = c.getContext('2d');
    g.imageSmoothingEnabled = false;
    fn(g, P);
    return c;
  }

  /* outline(src, colour = ink, diag = false): returns a NEW canvas 2 px larger (1 px each side). */
  function outline(src, oc, diag) {
    var w = src.width, h = src.height, W = w + 2, H = h + 2;
    var s = src.getContext('2d').getImageData(0, 0, w, h).data;
    var c = canvas(W, H), g = c.getContext('2d'), out = g.createImageData(W, H), d = out.data, rgb = hexRgb(col(oc || C.ink));
    function a(x, y) { return (x < 0 || y < 0 || x >= w || y >= h) ? 0 : s[(y * w + x) * 4 + 3]; }
    for (var y = 0; y < H; y++) for (var x = 0; x < W; x++) {
      var sx = x - 1, sy = y - 1, i = (y * W + x) * 4;
      if (a(sx, sy) > 127) { var j = (sy * w + sx) * 4; d[i] = s[j]; d[i + 1] = s[j + 1]; d[i + 2] = s[j + 2]; d[i + 3] = 255; continue; }
      var n = a(sx - 1, sy) > 127 || a(sx + 1, sy) > 127 || a(sx, sy - 1) > 127 || a(sx, sy + 1) > 127;
      if (!n && diag) n = a(sx - 1, sy - 1) > 127 || a(sx + 1, sy - 1) > 127 || a(sx - 1, sy + 1) > 127 || a(sx + 1, sy + 1) > 127;
      if (n) { d[i] = rgb[0]; d[i + 1] = rgb[1]; d[i + 2] = rgb[2]; d[i + 3] = 255; }
    }
    g.putImageData(out, 0, 0);
    return c;
  }

  /* recolor(src, { '#from': '#to' | name, ... }) — exact colour swaps, returns a new canvas. */
  function recolor(src, pairs) {
    var w = src.width, h = src.height, c = canvas(w, h), g = c.getContext('2d');
    var img = src.getContext('2d').getImageData(0, 0, w, h), d = img.data, map = {};
    Object.keys(pairs).forEach(function (k) { var f = hexRgb(col(k)), t = hexRgb(col(pairs[k])); if (f && t) map[(f[0] << 16) | (f[1] << 8) | f[2]] = t; });
    for (var i = 0; i < d.length; i += 4) {
      if (!d[i + 3]) continue;
      var t2 = map[(d[i] << 16) | (d[i + 1] << 8) | d[i + 2]];
      if (t2) { d[i] = t2[0]; d[i + 1] = t2[1]; d[i + 2] = t2[2]; }
    }
    g.putImageData(img, 0, 0);
    return c;
  }

  /* tint(src, colour, amount 0..1) — mixes every opaque pixel toward colour (white flash, frozen, poisoned). */
  function tint(src, tc, amt) {
    var w = src.width, h = src.height, c = canvas(w, h), g = c.getContext('2d');
    var img = src.getContext('2d').getImageData(0, 0, w, h), d = img.data, t = hexRgb(col(tc));
    for (var i = 0; i < d.length; i += 4) { if (!d[i + 3]) continue; d[i] += (t[0] - d[i]) * amt; d[i + 1] += (t[1] - d[i + 1]) * amt; d[i + 2] += (t[2] - d[i + 2]) * amt; }
    g.putImageData(img, 0, 0);
    return c;
  }
  /* silhouette(src, colour) — every opaque pixel becomes colour (shadows, glow masks). */
  function silhouette(src, sc) { return tint(src, sc, 1); }

  function flipX(src) { var c = canvas(src.width, src.height), g = c.getContext('2d'); g.translate(src.width, 0); g.scale(-1, 1); g.drawImage(src, 0, 0); return c; }

  /* compose(w, h, layers): layers = [{ img, x, y, flip }] drawn in order onto a new canvas. */
  function compose(w, h, layers) {
    var c = canvas(w, h), g = c.getContext('2d'); g.imageSmoothingEnabled = false;
    for (var i = 0; i < layers.length; i++) {
      var L = layers[i]; if (!L || !L.img) continue;
      if (L.flip) { g.save(); g.translate((L.x | 0) + L.img.width, L.y | 0); g.scale(-1, 1); g.drawImage(L.img, 0, 0); g.restore(); }
      else g.drawImage(L.img, L.x | 0, L.y | 0);
    }
    return c;
  }

  /* mix / ramp helpers for palette work (bake time only). */
  function mix(a, b, t) { var x = hexRgb(col(a)), y = hexRgb(col(b)); return rgbHex(Math.round(x[0] + (y[0] - x[0]) * t), Math.round(x[1] + (y[1] - x[1]) * t), Math.round(x[2] + (y[2] - x[2]) * t)); }
  function ramp(base, n) { n = n || 3; var out = []; for (var i = 0; i < n; i++) { var t = n === 1 ? 0 : i / (n - 1); out.push(t < 0.5 ? mix(C.ink, base, 0.45 + t * 1.1) : mix(base, C.cream, (t - 0.5) * 0.9)); } return out; }

  /* integer primitives for fromFn bodies (g = 2d context of a sprite canvas) */
  function rect(g, x, y, w, h, c) { g.fillStyle = col(c); g.fillRect(x | 0, y | 0, w | 0, h | 0); }
  function px(g, x, y, c) { g.fillStyle = col(c); g.fillRect(x | 0, y | 0, 1, 1); }
  function line(g, x0, y0, x1, y1, c) {
    x0 |= 0; y0 |= 0; x1 |= 0; y1 |= 0; g.fillStyle = col(c);
    var dx = Math.abs(x1 - x0), sx = x0 < x1 ? 1 : -1, dy = -Math.abs(y1 - y0), sy = y0 < y1 ? 1 : -1, e = dx + dy, guard = 0;
    for (;;) { g.fillRect(x0, y0, 1, 1); if ((x0 === x1 && y0 === y1) || guard++ > 4096) break; var e2 = 2 * e; if (e2 >= dy) { e += dy; x0 += sx; } if (e2 <= dx) { e += dx; y0 += sy; } }
  }
  function circle(g, cx, cy, r, c, fill) {
    g.fillStyle = col(c); cx |= 0; cy |= 0; r = Math.max(0, r | 0);
    if (fill) { for (var y = -r; y <= r; y++) { var w = Math.floor(Math.sqrt(r * r - y * y + r * 0.8)); g.fillRect(cx - w, cy + y, w * 2 + 1, 1); } return; }
    var x = r, yy = 0, err = 1 - r;
    while (x >= yy) {
      g.fillRect(cx + x, cy + yy, 1, 1); g.fillRect(cx + yy, cy + x, 1, 1); g.fillRect(cx - yy, cy + x, 1, 1); g.fillRect(cx - x, cy + yy, 1, 1);
      g.fillRect(cx - x, cy - yy, 1, 1); g.fillRect(cx - yy, cy - x, 1, 1); g.fillRect(cx + yy, cy - x, 1, 1); g.fillRect(cx + x, cy - yy, 1, 1);
      yy++; if (err < 0) err += 2 * yy + 1; else { x--; err += 2 * (yy - x) + 1; }
    }
  }
  function ellipse(g, cx, cy, rx, ry, c) {
    g.fillStyle = col(c); rx = Math.max(0, rx); ry = Math.max(0.5, ry);
    for (var y = -Math.floor(ry); y <= Math.floor(ry); y++) { var w = Math.floor(rx * Math.sqrt(Math.max(0, 1 - (y * y) / (ry * ry)))); g.fillRect((cx - w) | 0, (cy + y) | 0, w * 2 + 1, 1); }
  }

  /* ordered dithering (Bayer 4×4) */
  var BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
  function dither(g, x, y, w, h, c, level) {
    g.fillStyle = col(c); var L = Math.max(0, Math.min(1, level)) * 16;
    for (var j = 0; j < h; j++) for (var i = 0; i < w; i++) { if (BAYER[((y + j) & 3) * 4 + ((x + i) & 3)] < L) g.fillRect(x + i, y + j, 1, 1); }
  }
  var patCache = {};
  /* ditherPattern(ctx, colour, level) → CanvasPattern (4×4). Fill it with an identity transform on a
     low-res canvas so one pattern pixel = one game pixel. */
  function ditherPattern(ctx, c, level) {
    var lv = Math.round(Math.max(0, Math.min(1, level)) * 16), key = col(c) + lv;
    var tile = patCache[key];
    if (!tile) { tile = canvas(4, 4); var g = tile.getContext('2d'); dither(g, 0, 0, 4, 4, c, lv / 16); patCache[key] = tile; }
    return ctx.createPattern(tile, 'repeat');
  }

  /* deterministic RNG */
  function rng(seed) { var a = (seed | 0) || 1; return function () { a |= 0; a = a + 0x6D2B79F5 | 0; var t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
  function hash(x, y, s) { var h = (x * 374761393 + y * 668265263 + (s | 0) * 2246822519) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; }

  /* blit(ctx, img, x, y, k, o): draw a sprite crisp. x,y and k are in the ctx's current user units.
     k = desired user units per sprite pixel; it is rounded so one sprite pixel = an integer number of device pixels.
     o.anchor: 'feet' (default: x centre, y bottom) | 'center' | 'tl';  o.flip; o.alpha; o.min (min device px per sprite px, default 1).
     Returns { x, y, w, h, m } in device pixels. Assumes no rotation in the current transform. */
  function blit(ctx, img, x, y, k, o) {
    if (!img || !img.width) return null;
    o = o || {};
    var t = ctx.getTransform(), sx = Math.sqrt(t.a * t.a + t.b * t.b) || 1, sy = Math.sqrt(t.c * t.c + t.d * t.d) || 1;
    var m = Math.max(o.min || 1, Math.round((k || 1) * sx));
    var w = img.width * m, h = img.height * m;
    var dx = t.a * x + t.c * y + t.e, dy = t.b * x + t.d * y + t.f;
    var an = o.anchor || 'feet';
    if (an === 'feet') { dx -= w / 2; dy -= h; } else if (an === 'center') { dx -= w / 2; dy -= h / 2; }
    if (o.ox) dx += o.ox * m; if (o.oy) dy += o.oy * m;
    dx = Math.round(dx); dy = Math.round(dy);
    ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.imageSmoothingEnabled = false;
    if (o.alpha != null) ctx.globalAlpha *= o.alpha;
    if (o.comp) ctx.globalCompositeOperation = o.comp;
    if (o.flip) { ctx.translate(dx + w, dy); ctx.scale(-1, 1); ctx.drawImage(img, 0, 0, w, h); }
    else ctx.drawImage(img, dx, dy, w, h);
    ctx.restore();
    return { x: dx, y: dy, w: w, h: h, m: m, sy: sy };
  }
  /* devPx(ctx, k): integer device pixels per sprite pixel that blit would use. */
  function devPx(ctx, k) { var t = ctx.getTransform(); return Math.max(1, Math.round((k || 1) * (Math.sqrt(t.a * t.a + t.b * t.b) || 1))); }

  /* fitPixelCanvas(cv, cssW, cssH, cssPerPx): size a canvas so one game pixel = m device pixels (m integer).
     Returns { m, dpr, w, h, scale } where w,h = backing (game-pixel) size and scale = dpr/m (use as ctx transform for CSS-px world units). */
  function fitPixelCanvas(cv, cssW, cssH, cssPerPx) {
    var dpr = Math.min(window.devicePixelRatio || 1, 3), m = Math.max(1, Math.round((cssPerPx || 2.5) * dpr));
    var w = Math.max(1, Math.floor(cssW * dpr / m)), h = Math.max(1, Math.floor(cssH * dpr / m));
    cv.width = w; cv.height = h;
    cv.style.width = (w * m / dpr) + 'px'; cv.style.height = (h * m / dpr) + 'px';
    cv.style.imageRendering = 'pixelated';
    var g = cv.getContext('2d'); g.imageSmoothingEnabled = false;
    return { m: m, dpr: dpr, w: w, h: h, scale: dpr / m };
  }

  /* text(ctx, str, x, y, size, colour, o): pixel-font text with a hard 1-unit shadow/outline. o.align, o.shadow (colour|false), o.outline (colour). */
  function text(ctx, str, x, y, size, c, o) {
    o = o || {};
    ctx.save();
    ctx.font = (o.weight || 600) + ' ' + size + 'px ' + FONT;
    ctx.textAlign = o.align || 'left'; ctx.textBaseline = o.base || 'alphabetic';
    x = Math.round(x); y = Math.round(y);
    if (o.outline) { ctx.fillStyle = col(o.outline); var u = o.u || 1; ctx.fillText(str, x - u, y); ctx.fillText(str, x + u, y); ctx.fillText(str, x, y - u); ctx.fillText(str, x, y + u); }
    if (o.shadow !== false) { ctx.fillStyle = col(o.shadow || C.ink); ctx.fillText(str, x, y + (o.u || 1)); }
    ctx.fillStyle = col(c); ctx.fillText(str, x, y);
    ctx.restore();
  }

  var P = { C: C, RAR: RAR, FONT: FONT, hexRgb: hexRgb, rgbHex: rgbHex, col: col, canvas: canvas, sprite: sprite, fromFn: fromFn,
    outline: outline, recolor: recolor, tint: tint, silhouette: silhouette, flipX: flipX, compose: compose, mix: mix, ramp: ramp,
    rect: rect, px: px, line: line, circle: circle, ellipse: ellipse, dither: dither, ditherPattern: ditherPattern, BAYER: BAYER,
    rng: rng, hash: hash, blit: blit, devPx: devPx, fitPixelCanvas: fitPixelCanvas, text: text };
  GM.PX = P;
})(window.GM = window.GM || {});
