/* GÖLGE MUHAFIZLARI — procedural WebAudio sound effects + music (owner: audio). No audio files.
 *
 * GM.A = { unlock(), setSfx(bool), setMusic(bool), sfxOn, musicOn,
 *          play(name, { vol, pitch, pan }), music('lobby'|'battle'|'boss'|null), duck(amount, sec) }
 *
 * Graph:  sfx bus ─┐
 *         music bus → duck ─┼→ master → highpass 28 Hz → glue compressor → limiter → speakers
 *         shared reverb (procedural dark-hall impulse response, convolver) ─┘
 *
 * SFX: every sound is a small synth recipe (filtered noise, resonant metallic partials, FM bells, brass, formant choir…).
 *   After unlock() each recipe is rendered once in the background (OfflineAudioContext) into mono AudioBuffers — 2–3 random
 *   variants for the frequent combat sounds — normalised, trimmed and cached. play() then costs one buffer source + one gain
 *   (+ a panner only when panning). Until a buffer is ready the same recipe is synthesised live, so nothing is ever silent.
 *   Throttling: per-name minimum interval + max concurrent voices, a global voice cap with priorities (UI and fanfares always
 *   win), and rapid pickups / coins climb a pentatonic scale.
 * Music: three procedural loops (lobby 70 bpm, battle 112 bpm, boss 138 bpm) driven by a 25 ms lookahead scheduler that
 *   schedules ~0.12 s ahead. Pads / choir / tremolo strings / drones are persistent oscillators whose pitch glides between
 *   chords (no per-note allocation); drums, bass, plucks, bells and brass stabs are pre-rendered one-shots replayed with
 *   playbackRate. Tracks crossfade; a faded-out track stops and releases its nodes.
 * Safety: nothing here throws. Before unlock() every call is a cheap no-op (music() remembers what to play).
 */
(function (GM) {
  'use strict';

  var AC = window.AudioContext || window.webkitAudioContext;
  var OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext;

  var SFX_LV = 0.85, MUSIC_LV = 0.42, REV_LV = 0.6;
  var LOOK = 0.12, TICK_MS = 25;
  var VOICE_SOFT = 22, VOICE_HARD = 34;

  var ctx = null, dead = !AC, unlocked = false, settingsTouched = false;
  var sfxOn = true, musicOn = true;
  var bus = null, voices = 0, suspendedByUs = false, resumeAt = -9;
  var warned = {};
  var stats = { played: {}, dropped: {}, live: 0 };

  function warn(k, e) { if (!warned[k]) { warned[k] = 1; try { console.warn('[GM.A] ' + k, e && e.message ? e.message : e || ''); } catch (x) { /* ignore */ } } }
  function rnd(a, b) { return a + Math.random() * (b - a); }
  function mtof(m) { return 440 * Math.pow(2, (m - 69) / 12); }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function wall() { return (window.performance && performance.now ? performance.now() : Date.now()) / 1000; }

  /* ================================================================================================
   * Low-level synth helpers (context-agnostic: they work on the live context and on offline renders)
   * ================================================================================================ */
  function gain(ac, v) { var g = ac.createGain(); g.gain.value = v; return g; }
  function bq(ac, type, f, q) { var b = ac.createBiquadFilter(); b.type = type; b.frequency.value = f; if (q != null) b.Q.value = q; return b; }
  function osc(ac, type, f) { var o = ac.createOscillator(); o.type = type; o.frequency.value = f; return o; }
  function nyq(ac, f) { return Math.min(f, ac.sampleRate * 0.45); }

  // percussive envelope: 0 → v in a (linear, or exponential swell when ex), then exponential decay over d
  function env(p, t, a, v, d, ex) {
    if (ex) { p.setValueAtTime(0.0008, t); p.exponentialRampToValueAtTime(v, t + a); }
    else { p.setValueAtTime(0, t); p.linearRampToValueAtTime(v, t + a); }
    p.exponentialRampToValueAtTime(0.0001, t + a + d);
  }
  // attack / hold / release envelope
  function envH(p, t, a, v, h, r, ex) {
    if (ex) { p.setValueAtTime(0.0008, t); p.exponentialRampToValueAtTime(v, t + a); }
    else { p.setValueAtTime(0, t); p.linearRampToValueAtTime(v, t + a); }
    p.setValueAtTime(v, t + a + h);
    p.exponentialRampToValueAtTime(0.0001, t + a + h + r);
  }

  function shaperCurve(ac, k) {
    var C = ac._gmC || (ac._gmC = {});
    if (C[k]) return C[k];
    var n = 2048, c = new Float32Array(n), th = Math.tanh(k);
    for (var i = 0; i < n; i++) { var x = i * 2 / (n - 1) - 1; c[i] = Math.tanh(k * x) / th; }
    return (C[k] = c);
  }

  function filt(ac, type, f, q, f2, span, t, pts) {
    var b = ac.createBiquadFilter(); b.type = type;
    if (q != null) b.Q.value = q;
    if (pts) {
      b.frequency.setValueAtTime(nyq(ac, pts[0][1]), t);
      for (var i = 1; i < pts.length; i++) b.frequency.exponentialRampToValueAtTime(nyq(ac, pts[i][1]), t + pts[i][0]);
    } else {
      b.frequency.setValueAtTime(nyq(ac, f), t);
      if (f2) b.frequency.exponentialRampToValueAtTime(nyq(ac, f2), t + span);
    }
    return b;
  }
  // optional filter chain: hp → bp → lp (each may sweep from x to x2 over fg seconds, bandpass may follow points bpp)
  function chain(ac, n, t, o, span) {
    var sp = o.fg || span, f;
    if (o.hp) { f = filt(ac, 'highpass', o.hp, o.hq, o.hp2, sp, t); n.connect(f); n = f; }
    if (o.bp || o.bpp) { f = filt(ac, 'bandpass', o.bp, o.bq, o.bp2, sp, t, o.bpp); n.connect(f); n = f; }
    if (o.lp) { f = filt(ac, 'lowpass', o.lp, o.lq, o.lp2, sp, t); n.connect(f); n = f; }
    return n;
  }

  /* T: one oscillator voice. o = { w, f, f2, g (glide time), det, a, h, d, v, ex, sh (saturation), vib:[rate, depthHz],
   *    hp/hp2/hq, bp/bp2/bq/bpp, lp/lp2/lq, fg } */
  function T(ac, out, t, o) {
    var a = o.a == null ? 0.002 : o.a, h = o.h || 0, d = o.d || 0.1, end = t + a + h + d;
    var s = ac.createOscillator(); s.type = o.w || 'sine';
    s.frequency.setValueAtTime(nyq(ac, o.f), t);
    if (o.f2) s.frequency.exponentialRampToValueAtTime(nyq(ac, o.f2), t + (o.g || a + h + d));
    if (o.det) s.detune.value = o.det;
    var g = ac.createGain();
    if (h) envH(g.gain, t, a, o.v, h, d, o.ex); else env(g.gain, t, a, o.v, d, o.ex);
    var n = chain(ac, s, t, o, a + h + d);
    n.connect(g); n = g;
    if (o.sh) { var w = ac.createWaveShaper(); w.curve = shaperCurve(ac, o.sh); g.connect(w); n = w; }
    n.connect(out);
    if (o.vib) {
      var l = osc(ac, 'sine', o.vib[0]), lg = ac.createGain();
      lg.gain.setValueAtTime(o.vib[1], t); lg.gain.linearRampToValueAtTime(o.vib[1] * (o.vibK == null ? 0.15 : o.vibK), end);
      l.connect(lg); lg.connect(s.frequency); l.start(t); l.stop(end + 0.02);
    }
    s.start(t); s.stop(end + 0.02);
    return end;
  }

  /* N: one noise voice. o = { k:'white'|'pink'|'brown'|'crackle', a, h, d, v, ex, rate, + filters like T } */
  function N(ac, out, t, o) {
    var a = o.a == null ? 0.002 : o.a, h = o.h || 0, d = o.d || 0.1, len = a + h + d;
    var buf = noise(ac)[o.k || 'white'];
    var s = ac.createBufferSource(); s.buffer = buf;
    if (o.rate) s.playbackRate.value = o.rate;
    var g = ac.createGain();
    if (h) envH(g.gain, t, a, o.v, h, d, o.ex); else env(g.gain, t, a, o.v, d, o.ex);
    var n = chain(ac, s, t, o, len);
    n.connect(g); g.connect(out);
    var off = Math.random() * Math.max(0, buf.duration - len - 0.05);
    s.start(t, off); s.stop(t + len + 0.02);
    return t + len;
  }

  // metallic partial sets: sword ring, free-bar anvil, gong
  var METAL = {
    blade: { r: [1, 1.34, 1.79, 2.38, 2.95, 3.61], a: [1, 0.8, 0.6, 0.45, 0.35, 0.25] },
    anvil: { r: [1, 2.76, 5.40, 8.93], a: [1, 0.5, 0.25, 0.12] },
    gong:  { r: [1, 1.52, 2.03, 2.74, 3.31, 4.18, 5.43], a: [1, 0.8, 0.7, 0.5, 0.4, 0.3, 0.2] }
  };
  function M(ac, out, t, f, v, d, kind) {
    var K = METAL[kind || 'blade'];
    for (var i = 0; i < K.r.length; i++) {
      var fi = f * K.r[i];
      if (fi > ac.sampleRate * 0.42) continue;
      T(ac, out, t, { f: fi, det: rnd(-6, 6), a: 0.001, d: d * (1 - i * 0.09), v: v * K.a[i] });
    }
  }
  // FM bell (c:m = 1:1.4, decaying index) + a high shimmer partial
  function B(ac, out, t, f, v, d) {
    var c = osc(ac, 'sine', f), m = osc(ac, 'sine', f * 1.4), mg = ac.createGain(), g = ac.createGain();
    mg.gain.setValueAtTime(f * 2.4, t); mg.gain.exponentialRampToValueAtTime(f * 0.04, t + d * 0.6);
    m.connect(mg); mg.connect(c.frequency);
    env(g.gain, t, 0.002, v, d);
    c.connect(g); g.connect(out);
    c.start(t); m.start(t); c.stop(t + d + 0.05); m.stop(t + d + 0.05);
    if (f * 2.76 < ac.sampleRate * 0.42) T(ac, out, t, { f: f * 2.76, d: d * 0.25, v: v * 0.2 });
  }
  // brass: two detuned saws, pitch scoop, opening lowpass
  function BR(ac, out, t, f, hold, v, cut) {
    var cm = cut || 6, top = nyq(ac, Math.min(f * cm, 9000)), end = t + 0.025 + hold + 0.24;
    var lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 1.4;
    lp.frequency.setValueAtTime(f * 1.1, t);
    lp.frequency.linearRampToValueAtTime(top, t + 0.06);
    lp.frequency.setTargetAtTime(Math.max(f * 1.5, top * 0.55), t + 0.07, 0.2);
    lp.frequency.setTargetAtTime(f * 1.1, t + 0.025 + hold, 0.08);
    var g = ac.createGain(); envH(g.gain, t, 0.025, v, hold, 0.22);
    lp.connect(g); g.connect(out);
    for (var i = 0; i < 2; i++) {
      var s = osc(ac, 'sawtooth', f); s.detune.value = i ? 7 : -7;
      s.frequency.setValueAtTime(f * 0.95, t); s.frequency.exponentialRampToValueAtTime(f, t + 0.05);
      s.connect(lp); s.start(t); s.stop(end);
    }
    return end;
  }
  // formant choir: detuned saw pairs with vibrato through vowel formants
  var FORM = {
    a: [[800, 1, 6], [1150, 0.55, 8], [2900, 0.25, 12]],
    o: [[480, 1, 6], [820, 0.5, 8], [2800, 0.18, 12]],
    u: [[340, 1, 6], [700, 0.45, 8], [2500, 0.12, 12]]
  };
  function CH(ac, out, t, notes, a, hold, r, v, vowel) {
    var end = t + a + hold + r + 0.05, sum = gain(ac, 1), g = ac.createGain();
    envH(g.gain, t, a, v, hold, r);
    FORM[vowel || 'a'].forEach(function (fm) { var b = bq(ac, 'bandpass', fm[0], fm[2]), fg = gain(ac, fm[1] * 2.2); sum.connect(b); b.connect(fg); fg.connect(g); });
    var lp = bq(ac, 'lowpass', 900, 0.5), lg = gain(ac, 0.18); sum.connect(lp); lp.connect(lg); lg.connect(g);
    g.connect(out);
    var vib = osc(ac, 'sine', 5.2), vg = gain(ac, 14); vib.connect(vg); vib.start(t); vib.stop(end);
    notes.forEach(function (m) {
      [-9, 8].forEach(function (dc) {
        var s = osc(ac, 'sawtooth', mtof(m)); s.detune.value = dc + rnd(-3, 3);
        vg.connect(s.detune); s.connect(sum); s.start(t); s.stop(end);
      });
    });
    return end;
  }
  // sparkle shower
  function SP(ac, out, t, n, span, f0, f1, v) {
    for (var i = 0; i < n; i++) {
      var tt = t + Math.random() * span, f = f0 * Math.pow(f1 / f0, Math.random());
      T(ac, out, tt, { f: f, a: 0.002, d: rnd(0.05, 0.14), v: v * rnd(0.5, 1) });
    }
  }
  function COIN(ac, out, t, k) {
    T(ac, out, t, { w: 'square', f: 988 * k, h: 0.03, d: 0.03, v: 0.12, lp: 4500 });
    T(ac, out, t + 0.055, { w: 'square', f: 1319 * k, d: 0.22, v: 0.12, lp: 5000 });
    T(ac, out, t + 0.055, { f: 2637 * k, d: 0.18, v: 0.12 });
    T(ac, out, t + 0.055, { f: 3950 * k, d: 0.1, v: 0.05 });
  }
  function TAIKO(ac, out, t, vel) {
    T(ac, out, t, { f: 104, f2: 54, g: 0.14, d: 0.42, v: 0.9 * vel, sh: 1.5 });
    T(ac, out, t, { w: 'triangle', f: 208, f2: 112, g: 0.06, d: 0.08, v: 0.35 * vel });
    N(ac, out, t, { k: 'brown', lp: 800, d: 0.13, v: 0.6 * vel });
    N(ac, out, t, { k: 'white', bp: 2100, bq: 1, d: 0.013, v: 0.25 * vel });
  }

  /* ---------- noise buffers (per context; offline renders reuse the live ones) ---------- */
  function noise(ac) {
    if (ac._gmN) return ac._gmN;
    if (ctx && ac !== ctx && ctx._gmN && ctx.sampleRate === ac.sampleRate) return (ac._gmN = ctx._gmN);
    var sr = ac.sampleRate, len = Math.floor(sr * 2);
    var bufs = { white: ac.createBuffer(1, len, sr), pink: ac.createBuffer(1, len, sr), brown: ac.createBuffer(1, len, sr), crackle: ac.createBuffer(1, len, sr) };
    var wd = bufs.white.getChannelData(0), pd = bufs.pink.getChannelData(0), bd = bufs.brown.getChannelData(0), cd = bufs.crackle.getChannelData(0);
    var b0 = 0, b1 = 0, b2 = 0, br = 0, ca = 0, sg = 1, i;
    for (i = 0; i < len; i++) {
      var x = Math.random() * 2 - 1;
      wd[i] = x;
      b0 = 0.99765 * b0 + x * 0.0990460; b1 = 0.96300 * b1 + x * 0.2965164; b2 = 0.57000 * b2 + x * 1.0526913;
      pd[i] = b0 + b1 + b2 + x * 0.1848;
      br = (br + 0.02 * x) / 1.02; bd[i] = br;
      if (Math.random() < 0.0018) { ca = 0.3 + Math.random() * 0.7; sg = Math.random() < 0.5 ? -1 : 1; }
      cd[i] = ca * sg * (0.5 + Math.random() * 0.5) + x * 0.015; ca *= 0.8; sg = -sg;
    }
    [pd, bd, cd, wd].forEach(function (d) {
      var pk = 0, j; for (j = 0; j < len; j++) { var a = d[j] < 0 ? -d[j] : d[j]; if (a > pk) pk = a; }
      var k = pk > 0 ? 0.95 / pk : 1; for (j = 0; j < len; j++) d[j] *= k;
    });
    return (ac._gmN = bufs);
  }

  /* ---------- reverb: procedural dark hall (stereo, darker as it decays) ---------- */
  function makeIR(ac, sec) {
    var sr = ac.sampleRate, len = Math.floor(sr * sec), buf = ac.createBuffer(2, len, sr), pre = Math.floor(sr * 0.008);
    for (var ch = 0; ch < 2; ch++) {
      var d = buf.getChannelData(ch), lp = 0;
      for (var i = pre; i < len; i++) {
        var x = i / len, n = Math.random() * 2 - 1;
        lp += (0.88 - 0.8 * x) * (n - lp);
        d[i] = lp * Math.exp(-5.6 * x) * (1 - x);
      }
      for (var k = 0; k < 14; k++) { var idx = pre + Math.floor(sr * (0.006 + Math.random() * 0.075)); if (idx < len) d[idx] += (Math.random() < 0.5 ? -1 : 1) * 0.6 * (1 - k / 14); }
    }
    return buf;
  }
  function buildRev(ac) {
    var inp = gain(ac, 1), hp = bq(ac, 'highpass', 160, 0.6), pre = ac.createDelay(0.2), cv = ac.createConvolver(), out = gain(ac, REV_LV);
    pre.delayTime.value = 0.018;
    cv.buffer = makeIR(ac, 2.0);
    inp.connect(hp); hp.connect(pre); pre.connect(cv); cv.connect(out);
    return { input: inp, output: out };
  }

  /* ================================================================================================
   * SFX recipes.  fn(ac, out, t, variant).  d = render length (s), v = mix volume, rev = reverb send,
   * pri 0 (spammy combat) / 1 (combat events) / 2 (UI) / 3 (fanfares), thr = min interval (s),
   * max = max concurrent, jit = random pitch spread, n = rendered variants, duck = music duck amount,
   * sweep = stereo pan sweep, combo = rising-pitch group
   * ================================================================================================ */
  var S = {};
  function def(name, o, fn) {
    o.fn = fn; o.v = o.v == null ? 0.5 : o.v; o.rev = o.rev || 0; o.pri = o.pri == null ? 1 : o.pri;
    o.thr = o.thr == null ? 0.04 : o.thr; o.max = o.max || 3; o.jit = o.jit || 0; o.n = o.n || 1;
    S[name] = o;
  }

  /* ----- UI ----- */
  def('click', { d: 0.1, v: 0.4, pri: 2, thr: 0.03, max: 3 }, function (ac, o, t) {
    T(ac, o, t, { f: 1700, f2: 650, g: 0.03, d: 0.045, v: 0.55 });
    T(ac, o, t, { w: 'triangle', f: 380, f2: 260, g: 0.04, d: 0.05, v: 0.4 });
    N(ac, o, t, { hp: 4500, d: 0.014, v: 0.22 });
  });
  def('tab', { d: 0.2, v: 0.38, pri: 2, thr: 0.05, max: 2, rev: 0.1 }, function (ac, o, t) {
    T(ac, o, t, { w: 'triangle', f: 740, d: 0.045, v: 0.4, lp: 3000 });
    T(ac, o, t + 0.05, { w: 'triangle', f: 1110, d: 0.07, v: 0.36, lp: 3500 });
    T(ac, o, t + 0.05, { f: 2220, d: 0.05, v: 0.1 });
    N(ac, o, t, { k: 'pink', bp: 2600, bq: 1.2, d: 0.05, v: 0.3 });
  });
  def('open', { d: 0.6, v: 0.45, pri: 2, thr: 0.08, max: 2, rev: 0.35 }, function (ac, o, t) {
    N(ac, o, t, { k: 'pink', bp: 300, bp2: 2800, bq: 2, fg: 0.26, a: 0.07, d: 0.26, v: 0.7 });
    T(ac, o, t, { f: 150, f2: 240, g: 0.15, a: 0.04, d: 0.18, v: 0.3 });
    [74, 77, 81].forEach(function (m, i) {
      T(ac, o, t + 0.06 + i * 0.05, { f: mtof(m + 12), d: 0.22, v: 0.13 });
      T(ac, o, t + 0.06 + i * 0.05, { w: 'triangle', f: mtof(m), d: 0.18, v: 0.08 });
    });
  });
  def('close', { d: 0.42, v: 0.42, pri: 2, thr: 0.08, max: 2, rev: 0.2 }, function (ac, o, t) {
    N(ac, o, t, { k: 'pink', bp: 2400, bp2: 280, bq: 2, fg: 0.2, a: 0.01, d: 0.22, v: 0.65 });
    T(ac, o, t + 0.02, { f: 220, f2: 85, g: 0.12, d: 0.14, v: 0.45 });
    T(ac, o, t + 0.15, { w: 'triangle', f: 520, f2: 380, g: 0.03, d: 0.04, v: 0.18 });
  });
  def('equip', { d: 0.55, v: 0.55, pri: 2, thr: 0.08, max: 2, rev: 0.2 }, function (ac, o, t) {
    N(ac, o, t, { bp: 2300, bq: 2.5, d: 0.07, v: 0.8 });
    M(ac, o, t, 1250, 0.3, 0.32);
    T(ac, o, t, { f: 150, f2: 80, g: 0.08, d: 0.12, v: 0.55 });
    N(ac, o, t + 0.075, { bp: 3100, bq: 3, d: 0.045, v: 0.42 });
    M(ac, o, t + 0.075, 1720, 0.18, 0.24);
  });
  def('unequip', { d: 0.42, v: 0.45, pri: 2, thr: 0.08, max: 2, rev: 0.15 }, function (ac, o, t) {
    N(ac, o, t, { bp: 1700, bp2: 800, bq: 2, fg: 0.1, d: 0.1, v: 0.6 });
    M(ac, o, t, 880, 0.2, 0.22);
    T(ac, o, t, { f: 230, f2: 110, g: 0.1, d: 0.12, v: 0.35 });
  });
  def('upgrade', { d: 1.1, v: 0.58, pri: 2, thr: 0.1, max: 2, rev: 0.4 }, function (ac, o, t) {
    M(ac, o, t, 1046, 0.45, 0.55, 'anvil');
    N(ac, o, t, { bp: 2600, bq: 1.4, d: 0.06, v: 0.7 });
    T(ac, o, t, { f: 170, f2: 70, g: 0.1, d: 0.14, v: 0.5 });
    [74, 78, 81, 86].forEach(function (m, i) {
      var tt = t + 0.1 + i * 0.065;
      T(ac, o, tt, { w: 'triangle', f: mtof(m), d: 0.28, v: 0.2 });
      T(ac, o, tt, { f: mtof(m + 12), d: 0.2, v: 0.1 });
    });
    N(ac, o, t + 0.08, { hp: 6000, a: 0.25, d: 0.3, v: 0.12 });
  });
  def('merge', { d: 1.7, v: 0.68, pri: 3, thr: 0.3, max: 1, rev: 0.5, duck: 0.3 }, function (ac, o, t) {
    N(ac, o, t, { k: 'pink', bp: 200, bp2: 2200, bq: 1.6, fg: 0.38, a: 0.36, d: 0.04, v: 0.6 });
    T(ac, o, t, { w: 'sawtooth', f: 110, f2: 220, g: 0.36, a: 0.34, d: 0.05, v: 0.14, lp: 900 });
    var i = t + 0.38;
    T(ac, o, i, { f: 130, f2: 40, g: 0.3, d: 0.5, v: 0.9, sh: 3 });
    N(ac, o, i, { k: 'brown', lp: 1400, d: 0.4, v: 0.8 });
    M(ac, o, i, 690, 0.32, 0.8); M(ac, o, i, 1040, 0.2, 0.6);
    [74, 78, 81, 86, 90].forEach(function (m, k) { B(ac, o, i + 0.06 + k * 0.04, mtof(m), 0.16, 1.0); });
    SP(ac, o, i + 0.05, 10, 0.8, 3000, 8000, 0.06);
  });
  def('levelup', { d: 1.8, v: 0.6, pri: 3, thr: 0.3, max: 1, rev: 0.45, duck: 0.35 }, function (ac, o, t) {
    BR(ac, o, t, mtof(62), 0.07, 0.3); BR(ac, o, t + 0.09, mtof(69), 0.07, 0.3); BR(ac, o, t + 0.18, mtof(74), 0.08, 0.32);
    [62, 66, 69, 74].forEach(function (m) { BR(ac, o, t + 0.3, mtof(m), 0.7, 0.17); });
    CH(ac, o, t + 0.28, [62, 66, 69], 0.25, 0.6, 0.7, 0.1, 'a');
    B(ac, o, t + 0.3, mtof(86), 0.18, 1.1); B(ac, o, t + 0.42, mtof(93), 0.12, 0.9);
    N(ac, o, t + 0.05, { hp: 7000, a: 0.25, d: 0.5, v: 0.1 });
    T(ac, o, t + 0.3, { f: 110, f2: 55, g: 0.2, d: 0.35, v: 0.5 });
  });
  def('reward', { d: 1.3, v: 0.55, pri: 2, thr: 0.15, max: 2, rev: 0.45 }, function (ac, o, t) {
    [81, 85, 88, 93].forEach(function (m, i) { B(ac, o, t + i * 0.06, mtof(m), 0.2, 0.9); });
    COIN(ac, o, t + 0.02, 1); COIN(ac, o, t + 0.14, 1.12);
    N(ac, o, t, { k: 'pink', bp: 800, bp2: 3500, bq: 1.5, fg: 0.2, a: 0.04, d: 0.2, v: 0.25 });
    SP(ac, o, t + 0.1, 8, 0.7, 4000, 9000, 0.05);
  });
  def('rare', { d: 1.8, v: 0.6, pri: 3, thr: 0.3, max: 1, rev: 0.55, duck: 0.3 }, function (ac, o, t) {
    T(ac, o, t, { f: 95, f2: 45, g: 0.4, d: 0.6, v: 0.6 });
    N(ac, o, t, { k: 'brown', lp: 900, d: 0.35, v: 0.4 });
    [74, 78, 81, 85].forEach(function (m, i) { B(ac, o, t + 0.04 + i * 0.055, mtof(m), 0.17, 1.4); });
    N(ac, o, t + 0.05, { hp: 5000, a: 0.4, d: 0.7, v: 0.1 });
    SP(ac, o, t + 0.1, 12, 1.0, 3000, 8000, 0.06);
  });
  def('legendary', { d: 2.9, v: 0.75, pri: 3, thr: 0.5, max: 1, rev: 0.6, duck: 0.55 }, function (ac, o, t) {
    T(ac, o, t, { f: 75, f2: 32, g: 0.8, d: 1.1, v: 0.85, sh: 2 });
    N(ac, o, t, { k: 'brown', lp: 1200, lp2: 200, d: 0.7, v: 0.6 });
    BR(ac, o, t + 0.15, mtof(38), 1.0, 0.2); BR(ac, o, t + 0.15, mtof(45), 1.0, 0.17); BR(ac, o, t + 0.15, mtof(50), 1.0, 0.15);
    CH(ac, o, t + 0.1, [62, 66, 69, 74], 0.5, 1.1, 0.9, 0.12, 'a');
    [74, 78, 81, 86, 90, 93].forEach(function (m, i) { B(ac, o, t + 0.25 + i * 0.07, mtof(m), 0.17, 1.3); });
    M(ac, o, t + 0.25, 1480, 0.1, 1.6);
    SP(ac, o, t + 0.3, 22, 1.6, 3000, 9000, 0.055);
    N(ac, o, t, { hp: 4000, hp2: 9000, a: 0.5, d: 1.2, v: 0.1 });
  });
  def('error', { d: 0.36, v: 0.42, pri: 2, thr: 0.15, max: 1 }, function (ac, o, t) {
    [0, 0.12].forEach(function (dt) {
      T(ac, o, t + dt, { w: 'square', f: 148, h: 0.06, d: 0.04, v: 0.22, lp: 900 });
      T(ac, o, t + dt, { w: 'square', f: 157, h: 0.06, d: 0.04, v: 0.22, lp: 900 });
    });
    T(ac, o, t, { f: 95, f2: 70, d: 0.22, v: 0.3 });
  });
  def('buy', { d: 0.9, v: 0.55, pri: 2, thr: 0.15, max: 2, rev: 0.3 }, function (ac, o, t) {
    N(ac, o, t, { bp: 1500, bq: 2, d: 0.05, v: 0.45 });
    T(ac, o, t, { f: 320, f2: 150, g: 0.06, d: 0.07, v: 0.3 });
    COIN(ac, o, t + 0.03, 1); COIN(ac, o, t + 0.11, 1.12); COIN(ac, o, t + 0.19, 1.26);
    B(ac, o, t + 0.26, mtof(93), 0.13, 0.6);
  });

  /* ----- combat ----- */
  def('slash', { d: 0.36, v: 0.5, pri: 0, thr: 0.06, max: 4, jit: 0.06, n: 3, rev: 0.12 }, function (ac, o, t, vi) {
    var k = [1, 0.9, 1.12][vi || 0];
    N(ac, o, t, { bp: 1400 * k, bp2: 5200 * k, bq: 2.8, fg: 0.09, a: 0.006, d: 0.13, v: 0.9 });
    N(ac, o, t, { hp: 3000, a: 0.004, d: 0.06, v: 0.3 });
    N(ac, o, t, { k: 'pink', lp: 900, a: 0.02, d: 0.1, v: 0.4 });
    M(ac, o, t + 0.025, 2500 * k, 0.16, 0.22);
  });
  def('arrow', { d: 0.4, v: 0.45, pri: 0, thr: 0.05, max: 4, jit: 0.05, n: 2, rev: 0.1 }, function (ac, o, t, vi) {
    var k = vi ? 1.08 : 1;
    T(ac, o, t, { w: 'triangle', f: 360 * k, f2: 210 * k, g: 0.06, d: 0.24, v: 0.55, lp: 2600, lp2: 500, fg: 0.15, vib: [26, 22] });
    T(ac, o, t, { w: 'square', f: 180 * k, f2: 105 * k, g: 0.05, d: 0.1, v: 0.09, lp: 800 });
    N(ac, o, t, { bp: 3600, bp2: 1800, bq: 2, fg: 0.06, d: 0.07, v: 0.5 });
    N(ac, o, t + 0.03, { bp: 2600, bp2: 3400, bq: 7, fg: 0.15, a: 0.02, d: 0.14, v: 0.2 });
  });
  def('magic', { d: 0.6, v: 0.45, pri: 0, thr: 0.06, max: 4, jit: 0.05, n: 2, rev: 0.45 }, function (ac, o, t, vi) {
    var sc = [86, 89, 93, 96, 98, 101];
    for (var i = 0; i < 4; i++) {
      var m = sc[(i * 2 + (vi || 0) + (Math.random() * 2 | 0)) % sc.length];
      T(ac, o, t + i * 0.035, { f: mtof(m), d: 0.22, v: 0.16 });
      T(ac, o, t + i * 0.035, { f: mtof(m) * 2.01, d: 0.08, v: 0.05 });
    }
    N(ac, o, t, { bp: 6000, bq: 1, a: 0.05, d: 0.25, v: 0.22 });
    T(ac, o, t, { w: 'triangle', f: 320, f2: 720, g: 0.12, a: 0.03, d: 0.16, v: 0.22, vib: [11, 25] });
  });
  def('scythe', { d: 0.65, v: 0.55, pri: 0, thr: 0.1, max: 3, jit: 0.05, n: 2, rev: 0.15, sweep: [-0.6, 0.6] }, function (ac, o, t, vi) {
    var k = vi ? 1.1 : 1;
    N(ac, o, t, { k: 'pink', bpp: [[0, 240 * k], [0.2, 1300 * k], [0.45, 280 * k]], bq: 1.3, a: 0.17, d: 0.3, v: 1 });
    T(ac, o, t, { f: 105, f2: 70, g: 0.35, a: 0.12, d: 0.28, v: 0.45 });
    T(ac, o, t, { w: 'triangle', f: 210, f2: 140, g: 0.35, a: 0.12, d: 0.2, v: 0.12 });
    M(ac, o, t + 0.2, 1850 * k, 0.1, 0.3);
  });
  def('hit', { d: 0.24, v: 0.42, pri: 0, thr: 0.05, max: 6, jit: 0.1, n: 3 }, function (ac, o, t, vi) {
    var k = [1, 0.88, 1.13][vi || 0];
    T(ac, o, t, { f: 200 * k, f2: 55 * k, g: 0.06, a: 0.001, d: 0.11, v: 0.95, sh: 2 });
    T(ac, o, t, { w: 'triangle', f: 420 * k, f2: 130 * k, g: 0.04, a: 0.001, d: 0.06, v: 0.5 });
    N(ac, o, t, { bp: 1900 * k, bq: 0.8, a: 0.001, d: 0.035, v: 0.75 });
    N(ac, o, t, { k: 'pink', bp: 950 * k, bq: 1.2, a: 0.001, d: 0.08, v: 0.6 });
    N(ac, o, t, { hp: 5000, d: 0.008, v: 0.3 });
  });
  def('crit', { d: 0.4, v: 0.5, pri: 1, thr: 0.06, max: 4, jit: 0.05, n: 2, rev: 0.15 }, function (ac, o, t, vi) {
    var k = vi ? 1.06 : 1;
    T(ac, o, t, { f: 230, f2: 60, g: 0.06, d: 0.1, v: 0.8, sh: 2 });
    N(ac, o, t, { hp: 5500, d: 0.035, v: 0.6 });
    N(ac, o, t, { bp: 1800, bq: 1, d: 0.05, v: 0.45 });
    M(ac, o, t + 0.008, 2900 * k, 0.3, 0.28);
    T(ac, o, t + 0.008, { f: 3900 * k, f2: 3600 * k, g: 0.12, d: 0.13, v: 0.18 });
  });
  def('enemyDie', { d: 0.42, v: 0.4, pri: 0, thr: 0.045, max: 5, jit: 0.12, n: 3, rev: 0.15 }, function (ac, o, t, vi) {
    var k = [1, 0.85, 1.18][vi || 0];
    N(ac, o, t, { k: 'pink', bp: 1500 * k, bp2: 260 * k, bq: 1.5, fg: 0.22, a: 0.005, d: 0.26, v: 0.9 });
    T(ac, o, t, { f: 640 * k, f2: 150 * k, g: 0.12, d: 0.14, v: 0.42 });
    T(ac, o, t + 0.06, { f: 900 * k, f2: 1900 * k, g: 0.18, a: 0.05, d: 0.16, v: 0.06 });
  });
  def('playerHurt', { d: 0.45, v: 0.6, pri: 1, thr: 0.15, max: 2, jit: 0.05, n: 2 }, function (ac, o, t, vi) {
    var f = vi ? 250 : 230;
    T(ac, o, t, { f: 125, f2: 45, g: 0.2, d: 0.26, v: 1, sh: 2.5 });
    N(ac, o, t, { k: 'brown', lp: 900, d: 0.18, v: 0.8 });
    T(ac, o, t + 0.005, { w: 'sawtooth', f: f, f2: 150, g: 0.13, a: 0.012, d: 0.14, v: 0.45, bp: 700, bq: 4 });
    T(ac, o, t + 0.005, { w: 'sawtooth', f: f, f2: 150, g: 0.13, a: 0.012, d: 0.12, v: 0.25, bp: 1150, bq: 6 });
    N(ac, o, t, { bp: 2200, bq: 1, d: 0.03, v: 0.3 });
  });
  def('pickup', { d: 0.3, v: 0.3, pri: 0, thr: 0.03, max: 6, combo: 'pick', rev: 0.12 }, function (ac, o, t) {
    T(ac, o, t, { f: 1047, d: 0.13, v: 0.6 });
    T(ac, o, t, { f: 2094, d: 0.06, v: 0.18 });
    T(ac, o, t + 0.018, { w: 'triangle', f: 1570, d: 0.06, v: 0.15 });
    N(ac, o, t, { hp: 8000, d: 0.025, v: 0.12 });
  });
  def('gold', { d: 0.36, v: 0.3, pri: 0, thr: 0.045, max: 5, combo: 'gold', rev: 0.1 }, function (ac, o, t) { COIN(ac, o, t, 1); });
  def('chest', { d: 1.9, v: 0.65, pri: 3, thr: 0.3, max: 1, rev: 0.5, duck: 0.3 }, function (ac, o, t) {
    T(ac, o, t, { w: 'sawtooth', f: 85, f2: 150, g: 0.32, a: 0.05, d: 0.3, v: 0.25, bp: 900, bq: 5, vib: [32, 18] });
    var c = t + 0.34;
    T(ac, o, c, { f: 170, f2: 70, g: 0.1, d: 0.12, v: 0.6 });
    N(ac, o, c, { bp: 1300, bq: 2, d: 0.05, v: 0.55 });
    M(ac, o, c, 820, 0.18, 0.25);
    var b = t + 0.44;
    N(ac, o, b, { hp: 3500, a: 0.05, d: 0.6, v: 0.18 });
    [74, 78, 81, 86, 93].forEach(function (m, i) { B(ac, o, b + i * 0.06, mtof(m), 0.18, 1.1); });
    BR(ac, o, b + 0.04, mtof(62), 0.55, 0.14); BR(ac, o, b + 0.04, mtof(66), 0.55, 0.12); BR(ac, o, b + 0.04, mtof(69), 0.55, 0.12);
    SP(ac, o, b + 0.05, 14, 1.0, 3000, 9000, 0.055);
  });
  def('skillPick', { d: 0.8, v: 0.55, pri: 2, thr: 0.12, max: 2, rev: 0.35 }, function (ac, o, t) {
    N(ac, o, t, { k: 'pink', bp: 600, bp2: 3200, bq: 1.5, fg: 0.14, a: 0.03, d: 0.14, v: 0.45 });
    B(ac, o, t + 0.02, mtof(81), 0.2, 0.6); B(ac, o, t + 0.1, mtof(86), 0.22, 0.8);
    T(ac, o, t, { f: 160, f2: 80, g: 0.1, d: 0.12, v: 0.35 });
    SP(ac, o, t + 0.08, 5, 0.4, 4000, 9000, 0.05);
  });
  def('evolve', { d: 3.0, v: 0.75, pri: 3, thr: 0.5, max: 1, rev: 0.6, duck: 0.55 }, function (ac, o, t) {
    N(ac, o, t, { k: 'pink', bp: 300, bp2: 5500, bq: 2, fg: 1.05, a: 1.02, d: 0.06, v: 0.55 });
    [50, 57, 62].forEach(function (m) { T(ac, o, t, { w: 'sawtooth', f: mtof(m - 12), f2: mtof(m), g: 1.0, a: 1.0, d: 0.08, v: 0.08, lp: 500, lp2: 3500, fg: 1.0 }); });
    var i = t + 1.05;
    T(ac, o, i, { f: 95, f2: 32, g: 0.5, d: 1.0, v: 1, sh: 2.5 });
    N(ac, o, i, { k: 'brown', lp: 1600, lp2: 200, d: 0.7, v: 0.7 });
    M(ac, o, i, 880, 0.2, 1.3);
    CH(ac, o, i, [62, 66, 69, 74], 0.12, 0.9, 0.9, 0.13, 'a');
    BR(ac, o, i, mtof(50), 0.8, 0.2); BR(ac, o, i, mtof(57), 0.8, 0.16);
    [86, 90, 93, 98].forEach(function (m, k) { B(ac, o, i + 0.08 + k * 0.06, mtof(m), 0.16, 1.2); });
    SP(ac, o, i + 0.1, 20, 1.4, 3000, 9000, 0.05);
  });
  def('ult', { d: 2.1, v: 0.75, pri: 3, thr: 0.4, max: 1, rev: 0.55, duck: 0.4 }, function (ac, o, t) {
    N(ac, o, t, { hp: 900, hp2: 7000, fg: 0.6, a: 0.6, d: 0.04, v: 0.45, ex: 1 });
    T(ac, o, t, { w: 'sawtooth', f: 55, f2: 110, g: 0.6, a: 0.58, d: 0.06, v: 0.25, lp: 350, lp2: 1800, fg: 0.6 });
    var i = t + 0.62;
    T(ac, o, i, { f: 85, f2: 30, g: 0.4, d: 1.1, v: 1, sh: 3 });
    N(ac, o, i, { k: 'brown', lp: 2200, lp2: 180, fg: 0.8, d: 0.9, v: 0.85 });
    M(ac, o, i, 520, 0.18, 1.2, 'gong');
    BR(ac, o, i, mtof(38), 0.7, 0.26); BR(ac, o, i, mtof(45), 0.7, 0.2); BR(ac, o, i, mtof(50), 0.7, 0.16);
  });
  def('bossRoar', { d: 2.5, v: 0.8, pri: 3, thr: 0.8, max: 1, rev: 0.5, duck: 0.4 }, function (ac, o, t) {
    var len = 1.95, end = t + len + 0.05;
    var amp = ac.createGain(); envH(amp.gain, t, 0.18, 0.9, 1.15, 0.6);
    var am = gain(ac, 0.55), lfo = osc(ac, 'triangle', 24), lg = gain(ac, 0.45);
    lfo.frequency.setValueAtTime(22, t); lfo.frequency.linearRampToValueAtTime(34, t + 0.5); lfo.frequency.linearRampToValueAtTime(18, t + len);
    lfo.connect(lg); lg.connect(am.gain);
    var sh = ac.createWaveShaper(); sh.curve = shaperCurve(ac, 4);
    var f1 = bq(ac, 'bandpass', 520, 3), f2 = bq(ac, 'bandpass', 1050, 4), lp = bq(ac, 'lowpass', 2200, 0.7);
    f1.frequency.setValueAtTime(480, t); f1.frequency.linearRampToValueAtTime(780, t + 0.45); f1.frequency.linearRampToValueAtTime(420, t + len);
    var g1 = gain(ac, 1.6), g2 = gain(ac, 0.8), g3 = gain(ac, 0.35);
    am.connect(sh); sh.connect(f1); sh.connect(f2); sh.connect(lp); f1.connect(g1); f2.connect(g2); lp.connect(g3);
    g1.connect(amp); g2.connect(amp); g3.connect(amp); amp.connect(o);
    [[1, 0], [1.5, 14], [0.5, -10]].forEach(function (c) {
      var s = osc(ac, 'sawtooth', 70 * c[0]); s.detune.value = c[1];
      s.frequency.setValueAtTime(64 * c[0], t); s.frequency.exponentialRampToValueAtTime(98 * c[0], t + 0.32); s.frequency.exponentialRampToValueAtTime(50 * c[0], t + len);
      s.connect(am); s.start(t); s.stop(end);
    });
    lfo.start(t); lfo.stop(end);
    N(ac, o, t, { k: 'pink', bp: 450, bq: 0.8, a: 0.2, h: 1.0, d: 0.6, v: 0.32 });
    T(ac, o, t, { f: 48, f2: 38, g: len, a: 0.2, h: 1.0, d: 0.6, v: 0.55 });
    N(ac, o, t, { k: 'brown', lp: 300, a: 0.1, h: 1.0, d: 0.7, v: 0.5 });
  });
  def('explosion', { d: 1.5, v: 0.68, pri: 1, thr: 0.08, max: 4, jit: 0.08, n: 2, rev: 0.3 }, function (ac, o, t, vi) {
    var k = vi ? 0.85 : 1;
    T(ac, o, t, { f: 120 * k, f2: 28, g: 0.35, d: 0.75, v: 1, sh: 3 });
    T(ac, o, t, { w: 'triangle', f: 240 * k, f2: 60, g: 0.15, d: 0.2, v: 0.3 });
    N(ac, o, t, { k: 'brown', lp: 3200, lp2: 150, fg: 0.7, a: 0.003, d: 0.95, v: 1 });
    N(ac, o, t, { bp: 1500, bq: 0.7, d: 0.12, v: 0.7 });
    N(ac, o, t + 0.02, { k: 'crackle', hp: 1200, d: 0.7, v: 0.45 });
  });
  def('lightning', { d: 1.2, v: 0.55, pri: 1, thr: 0.07, max: 3, jit: 0.08, n: 2, rev: 0.35 }, function (ac, o, t) {
    T(ac, o, t, { w: 'sawtooth', f: 2200, f2: 90, g: 0.12, d: 0.16, v: 0.35, hp: 250 });
    N(ac, o, t, { k: 'crackle', bp: 3000, bq: 0.7, a: 0.001, d: 0.38, v: 1 });
    N(ac, o, t, { hp: 2200, d: 0.05, v: 0.75 });
    N(ac, o, t + 0.05, { k: 'brown', lp: 420, a: 0.05, d: 0.85, v: 0.65 });
    T(ac, o, t + 0.03, { f: 62, f2: 45, d: 0.5, v: 0.4 });
  });
  def('ice', { d: 1.0, v: 0.45, pri: 1, thr: 0.08, max: 3, jit: 0.06, n: 2, rev: 0.5 }, function (ac, o, t, vi) {
    var fs = [2637, 3520, 4186, 3136, 4699];
    for (var i = 0; i < 5; i++) {
      var f = fs[(i + (vi || 0) * 2) % 5] * rnd(0.97, 1.03), tt = t + i * 0.04 + rnd(0, 0.015);
      T(ac, o, tt, { f: f, d: 0.32, v: 0.16 });
      T(ac, o, tt, { f: f * 2.76, d: 0.12, v: 0.05 });
    }
    N(ac, o, t, { hp: 5000, d: 0.15, v: 0.32 });
    N(ac, o, t, { bp: 2500, bq: 8, d: 0.22, v: 0.25 });
    T(ac, o, t, { f: 320, f2: 190, g: 0.1, d: 0.1, v: 0.22 });
  });
  def('fire', { d: 1.1, v: 0.55, pri: 1, thr: 0.08, max: 3, jit: 0.06, n: 2, rev: 0.25 }, function (ac, o, t) {
    N(ac, o, t, { k: 'pink', bpp: [[0, 300], [0.15, 1400], [0.6, 480]], bq: 0.9, a: 0.12, d: 0.6, v: 1 });
    N(ac, o, t + 0.03, { k: 'crackle', bp: 2600, bq: 0.8, d: 0.6, v: 0.45 });
    N(ac, o, t, { k: 'brown', lp: 320, a: 0.05, d: 0.5, v: 0.55 });
    T(ac, o, t, { f: 125, f2: 70, g: 0.3, d: 0.3, v: 0.3 });
  });
  def('poison', { d: 0.95, v: 0.45, pri: 1, thr: 0.08, max: 3, jit: 0.06, n: 2, rev: 0.25 }, function (ac, o, t) {
    [0, 0.07, 0.15, 0.21, 0.3, 0.41].forEach(function (dt, i) {
      var f = rnd(330, 880);
      T(ac, o, t + dt, { f: f, f2: f * 2.6, g: 0.05, a: 0.003, d: 0.065, v: 0.45 - i * 0.04, lp: 3000 });
    });
    N(ac, o, t, { k: 'pink', bp: 2000, bq: 0.6, a: 0.05, d: 0.45, v: 0.18 });
    T(ac, o, t, { f: 92, f2: 70, d: 0.3, v: 0.25 });
  });
  def('victory', { d: 4.2, v: 0.75, pri: 3, thr: 1, max: 1, rev: 0.55, duck: 0.85 }, function (ac, o, t) {
    [0, 0.12, 0.24].forEach(function (dt, i) { TAIKO(ac, o, t + dt, 0.5 + i * 0.15); });
    [[62, 0, 0.12], [62, 0.16, 0.07], [62, 0.26, 0.07], [69, 0.36, 0.32], [67, 0.74, 0.12], [69, 0.9, 0.12]].forEach(function (n) {
      BR(ac, o, t + n[1], mtof(n[0]), n[2], 0.3); BR(ac, o, t + n[1], mtof(n[0] - 12), n[2], 0.14);
    });
    var c = t + 1.06;
    [50, 57, 62, 66, 69, 74].forEach(function (m) { BR(ac, o, c, mtof(m), 1.6, 0.13); });
    CH(ac, o, c, [62, 66, 69, 74], 0.3, 1.4, 1.2, 0.12, 'a');
    TAIKO(ac, o, c, 1);
    T(ac, o, c, { f: 80, f2: 35, g: 0.6, d: 1.2, v: 0.8, sh: 2 });
    N(ac, o, c, { hp: 4000, d: 1.6, v: 0.18 });
    [86, 90, 93, 98].forEach(function (m, i) { B(ac, o, c + 0.1 + i * 0.08, mtof(m), 0.16, 1.4); });
    SP(ac, o, c + 0.2, 20, 2.0, 3000, 9000, 0.05);
  });
  def('defeat', { d: 4.8, v: 0.7, pri: 3, thr: 1, max: 1, rev: 0.6, duck: 0.85 }, function (ac, o, t) {
    [0, 0.28].forEach(function (dt) { T(ac, o, t + dt, { f: 62, f2: 45, g: 0.1, d: 0.18, v: 0.55 }); });
    [[69, 0, 0.35], [65, 0.45, 0.35], [62, 0.9, 0.35], [61, 1.35, 0.9]].forEach(function (n) {
      BR(ac, o, t + n[1], mtof(n[0] - 12), n[2], 0.26, 3.5);
      CH(ac, o, t + n[1], [n[0]], 0.1, n[2], 0.35, 0.1, 'o');
    });
    var c = t + 2.3;
    CH(ac, o, c, [50, 53, 57, 62], 0.3, 0.9, 1.1, 0.14, 'o');
    T(ac, o, c, { w: 'triangle', f: mtof(38), h: 0.4, d: 1.4, v: 0.3 });
    M(ac, o, c, 110, 0.25, 1.9, 'gong');
    T(ac, o, c, { f: 70, f2: 40, g: 0.5, d: 1.0, v: 0.6 });
  });
  def('metinBreak', { d: 1.9, v: 0.75, pri: 3, thr: 0.2, max: 2, rev: 0.5, duck: 0.3 }, function (ac, o, t) {
    T(ac, o, t, { f: 95, f2: 35, g: 0.4, d: 0.55, v: 1, sh: 3 });
    N(ac, o, t, { k: 'brown', lp: 1600, d: 0.45, v: 0.9 });
    N(ac, o, t, { bp: 2500, bq: 1, d: 0.08, v: 0.65 });
    N(ac, o, t + 0.01, { k: 'crackle', bp: 1200, bq: 0.8, d: 0.35, v: 0.6 });
    for (var i = 0; i < 10; i++) {
      var tt = t + 0.05 + Math.pow(Math.random(), 1.6) * 0.75, f = rnd(700, 2600);
      N(ac, o, tt, { bp: f, bq: 6, d: 0.05, v: 0.45 * (1 - i * 0.06) });
      T(ac, o, tt, { f: f * 0.5, d: 0.05, v: 0.12 });
    }
    T(ac, o, t + 0.12, { f: 400, f2: 1600, g: 0.6, a: 0.2, d: 0.6, v: 0.1, vib: [7, 20] });
    B(ac, o, t + 0.2, mtof(86), 0.13, 1.2); B(ac, o, t + 0.26, mtof(92), 0.1, 1.1);
    N(ac, o, t + 0.1, { k: 'pink', bp: 500, bp2: 4000, bq: 1.2, fg: 0.5, a: 0.4, d: 0.3, v: 0.25 });
  });
  def('whoosh', { d: 0.45, v: 0.4, pri: 0, thr: 0.05, max: 3, jit: 0.1, n: 2, sweep: [-0.4, 0.4] }, function (ac, o, t, vi) {
    var k = vi ? 1.15 : 1;
    N(ac, o, t, { k: 'pink', bpp: [[0, 350 * k], [0.12, 1700 * k], [0.32, 420 * k]], bq: 1.4, a: 0.1, d: 0.22, v: 0.9 });
  });

  /* ----- extras (not in the SPEC list, harmless if unused) ----- */
  def('tick', { d: 0.06, v: 0.28, pri: 2, thr: 0.03, max: 2 }, function (ac, o, t) {
    T(ac, o, t, { w: 'triangle', f: 2400, d: 0.016, v: 0.35 });
    N(ac, o, t, { hp: 6000, d: 0.01, v: 0.2 });
  });
  def('flip', { d: 0.2, v: 0.35, pri: 2, thr: 0.04, max: 3 }, function (ac, o, t) {
    N(ac, o, t, { bp: 1800, bq: 1, d: 0.04, v: 0.6 });
    N(ac, o, t + 0.05, { bp: 2600, bq: 1, d: 0.04, v: 0.45 });
    T(ac, o, t + 0.05, { w: 'triangle', f: 600, d: 0.03, v: 0.1 });
  });
  def('heal', { d: 0.95, v: 0.45, pri: 1, thr: 0.2, max: 1, rev: 0.45 }, function (ac, o, t) {
    [65, 69, 72, 77].forEach(function (m, i) {
      T(ac, o, t + i * 0.07, { w: 'triangle', f: mtof(m), a: 0.02, d: 0.4, v: 0.22 });
      T(ac, o, t + i * 0.07, { f: mtof(m + 12), a: 0.02, d: 0.3, v: 0.1 });
    });
    N(ac, o, t, { hp: 5000, a: 0.2, d: 0.4, v: 0.1 });
  });
  def('magnet', { d: 0.8, v: 0.45, pri: 1, thr: 0.3, max: 1, rev: 0.3 }, function (ac, o, t) {
    T(ac, o, t, { f: 220, f2: 1300, g: 0.6, a: 0.05, d: 0.6, v: 0.3, vib: [14, 40], vibK: 1 });
    N(ac, o, t, { k: 'pink', bp: 300, bp2: 3000, bq: 2, fg: 0.6, a: 0.5, d: 0.15, v: 0.4 });
  });
  def('gem', { d: 0.6, v: 0.4, pri: 1, thr: 0.06, max: 3, rev: 0.4 }, function (ac, o, t) {
    B(ac, o, t, mtof(93), 0.25, 0.5); B(ac, o, t + 0.05, mtof(100), 0.15, 0.4);
    N(ac, o, t, { hp: 7000, d: 0.05, v: 0.15 });
  });
  def('dash', { d: 0.32, v: 0.4, pri: 1, thr: 0.12, max: 2 }, function (ac, o, t) {
    N(ac, o, t, { k: 'pink', bp: 600, bp2: 2600, bq: 1.4, fg: 0.12, a: 0.02, d: 0.16, v: 0.8 });
    T(ac, o, t, { f: 300, f2: 620, g: 0.12, d: 0.1, v: 0.2 });
  });
  def('heartbeat', { d: 0.55, v: 0.5, pri: 1, thr: 0.4, max: 1 }, function (ac, o, t) {
    T(ac, o, t, { f: 70, f2: 48, g: 0.08, d: 0.16, v: 0.9, sh: 1.5 });
    T(ac, o, t + 0.22, { f: 62, f2: 44, g: 0.08, d: 0.2, v: 0.7, sh: 1.5 });
  });
  def('revive', { d: 2.2, v: 0.6, pri: 3, thr: 1, max: 1, rev: 0.6, duck: 0.4 }, function (ac, o, t) {
    CH(ac, o, t, [62, 66, 69, 74], 0.6, 0.6, 0.9, 0.13, 'a');
    N(ac, o, t, { k: 'pink', bp: 400, bp2: 5000, bq: 1.5, fg: 0.9, a: 0.85, d: 0.1, v: 0.35 });
    [74, 78, 81, 86, 90].forEach(function (m, i) { B(ac, o, t + 0.5 + i * 0.07, mtof(m), 0.15, 1.1); });
    T(ac, o, t + 0.85, { f: 90, f2: 45, g: 0.3, d: 0.5, v: 0.5 });
  });
  def('warning', { d: 1.7, v: 0.6, pri: 3, thr: 1, max: 1, rev: 0.5, duck: 0.3 }, function (ac, o, t) {
    [0, 0.62].forEach(function (dt) {
      BR(ac, o, t + dt, mtof(38), 0.42, 0.3, 4); BR(ac, o, t + dt, mtof(39), 0.42, 0.22, 4); BR(ac, o, t + dt, mtof(50), 0.42, 0.14, 4);
      TAIKO(ac, o, t + dt, 0.8);
    });
  });
  def('unlock', { d: 1.2, v: 0.55, pri: 2, thr: 0.3, max: 1, rev: 0.45 }, function (ac, o, t) {
    N(ac, o, t, { bp: 1400, bq: 2, d: 0.05, v: 0.6 });
    M(ac, o, t, 700, 0.25, 0.3, 'anvil');
    T(ac, o, t, { f: 180, f2: 80, g: 0.1, d: 0.12, v: 0.4 });
    [74, 81, 86].forEach(function (m, i) { B(ac, o, t + 0.12 + i * 0.08, mtof(m), 0.2, 0.8); });
  });

  var ALIAS = { coin: 'gold', bomb: 'explosion', roar: 'bossRoar', shatter: 'metinBreak', deny: 'error', select: 'skillPick',
    levelUp: 'levelup', die: 'enemyDie', hurt: 'playerHurt', swing: 'whoosh', xp: 'pickup', chestOpen: 'chest', thunder: 'lightning' };
  var COMBO = { pick: { t: 0, n: 0, sc: [0, 2, 4, 7, 9, 12, 14, 16, 19] }, gold: { t: 0, n: 0, sc: [0, 2, 4, 5, 7, 9, 11, 12] } };

  /* ================================================================================================
   * Music one-shot instruments (rendered once, replayed with playbackRate). bases = render pitches (MIDI)
   * ================================================================================================ */
  var MS = {
    bell:   { d: 2.4, bases: [81], fn: function (ac, o, t, b) { B(ac, o, t, mtof(b), 0.6, 2.2); T(ac, o, t, { f: mtof(b) * 2, d: 0.4, v: 0.06 }); } },
    pluck:  { d: 0.6, bases: [62, 74], fn: function (ac, o, t, b) {
      var f = mtof(b);
      T(ac, o, t, { w: 'sawtooth', f: f, d: 0.38, v: 0.5, lp: 4200, lp2: 420, fg: 0.22, lq: 3 });
      T(ac, o, t, { w: 'square', f: f * 1.004, d: 0.3, v: 0.22, lp: 2600, lp2: 380, fg: 0.2 });
      T(ac, o, t, { f: f * 2, d: 0.08, v: 0.1 });
    } },
    bass:   { d: 0.7, bases: [38, 50], fn: function (ac, o, t, b) {
      var f = mtof(b);
      T(ac, o, t, { w: 'sawtooth', f: f, h: 0.04, d: 0.4, v: 0.6, lp: 1700, lp2: 220, fg: 0.28, lq: 6 });
      T(ac, o, t, { f: f, h: 0.06, d: 0.45, v: 0.4 });
      T(ac, o, t, { w: 'square', f: f * 2.003, d: 0.14, v: 0.16, lp: 1400 });
    } },
    stab:   { d: 0.95, bases: [50], fn: function (ac, o, t, b) {
      BR(ac, o, t, mtof(b), 0.16, 0.3); BR(ac, o, t, mtof(b + 7), 0.16, 0.26); BR(ac, o, t, mtof(b + 12), 0.16, 0.22); BR(ac, o, t, mtof(b - 12), 0.16, 0.3, 4);
    } },
    taiko:  { d: 0.9, bases: [0], fn: function (ac, o, t) { TAIKO(ac, o, t, 1); } },
    taikoL: { d: 1.6, bases: [0], fn: function (ac, o, t) {
      T(ac, o, t, { f: 64, f2: 36, g: 0.25, d: 1.2, v: 1, sh: 1.5 });
      T(ac, o, t, { w: 'triangle', f: 128, f2: 72, g: 0.1, d: 0.18, v: 0.35 });
      N(ac, o, t, { k: 'brown', lp: 420, d: 0.5, v: 0.7 });
      N(ac, o, t, { bp: 1500, bq: 1, d: 0.015, v: 0.25 });
    } },
    shime:  { d: 0.25, bases: [0], fn: function (ac, o, t) {
      T(ac, o, t, { w: 'triangle', f: 430, f2: 330, g: 0.03, d: 0.08, v: 0.6 });
      N(ac, o, t, { bp: 2700, bq: 1.5, d: 0.045, v: 0.75 });
    } },
    hat:    { d: 0.1, bases: [0], fn: function (ac, o, t) { N(ac, o, t, { hp: 7000, d: 0.035, v: 0.7 }); N(ac, o, t, { bp: 10000, bq: 1, d: 0.02, v: 0.4 }); } },
    rim:    { d: 0.12, bases: [0], fn: function (ac, o, t) { T(ac, o, t, { w: 'square', f: 880, d: 0.02, v: 0.25, bp: 1200 }); N(ac, o, t, { bp: 1900, bq: 3, d: 0.03, v: 0.7 }); } },
    gong:   { d: 4.2, bases: [0], fn: function (ac, o, t) { M(ac, o, t, 98, 0.5, 3.8, 'gong'); N(ac, o, t, { k: 'brown', lp: 500, d: 0.35, v: 0.5 }); T(ac, o, t, { f: 49, d: 2.5, v: 0.3 }); } },
    boom:   { d: 2.8, bases: [0], fn: function (ac, o, t) {
      T(ac, o, t, { f: 55, f2: 32, g: 0.8, d: 2.0, v: 1 });
      N(ac, o, t, { k: 'brown', lp: 220, a: 0.02, d: 1.4, v: 0.7 });
      T(ac, o, t, { w: 'triangle', f: 110, f2: 64, g: 0.3, d: 0.3, v: 0.25 });
    } }
  };

  /* ================================================================================================
   * Background rendering of recipes into cached buffers
   * ================================================================================================ */
  var cache = {}, mcache = {}, rq = [], rBusy = false, queued = {};

  function startR(oc) {
    return new Promise(function (res, rej) {
      var done = false, to = setTimeout(function () { if (!done) { done = true; rej(new Error('render timeout')); } }, 8000);
      oc.oncomplete = function (e) { if (!done) { done = true; clearTimeout(to); res(e.renderedBuffer); } };
      try {
        var p = oc.startRendering();
        if (p && p.then) p.then(function (b) { if (!done) { done = true; clearTimeout(to); res(b); } }, function (e) { if (!done) { done = true; clearTimeout(to); rej(e); } });
      } catch (e) { done = true; clearTimeout(to); rej(e); }
    });
  }
  function renderRaw(fn, dur, vi) {
    var sr = ctx.sampleRate, oc = new OAC(1, Math.ceil((dur + 0.06) * sr), sr);
    var out = oc.createGain(); out.connect(oc.destination);
    fn(oc, out, 0.004, vi || 0);
    return startR(oc);
  }
  // normalise to 0.9 peak, trim the silent tail (-64 dB), short fade at the end. null if broken/silent.
  function post(buf) {
    var d = buf.getChannelData(0), n = d.length, pk = 0, i, a;
    for (i = 0; i < n; i++) { a = d[i]; if (a !== a) return null; if (a < 0) a = -a; if (a > pk) pk = a; }
    if (pk < 1e-5) return null;
    var g = 0.9 / pk, thr = 0.0006 * pk, end = n, sr = buf.sampleRate;
    while (end > 1 && Math.abs(d[end - 1]) < thr) end--;
    end = Math.min(n, end + Math.floor(sr * 0.01));
    var out = ctx.createBuffer(1, end, sr), od = out.getChannelData(0), fade = Math.min(end, Math.floor(sr * 0.008));
    for (i = 0; i < end; i++) od[i] = d[i] * g;
    for (i = 0; i < fade; i++) od[end - 1 - i] *= i / fade;
    out._pk = pk;
    return out;
  }
  function renderKey(key) {
    var kind = key.charAt(0), name = key.slice(2);
    if (kind === 's') {
      var sd = S[name], bufs = [], p = Promise.resolve();
      for (var v = 0; v < sd.n; v++) (function (vi) {
        p = p.then(function () { return renderRaw(sd.fn, sd.d, vi).then(function (b) { b = post(b); if (b) bufs.push(b); }); });
      })(v);
      return p.then(function () { if (bufs.length) cache[name] = bufs; });
    }
    var parts = name.split('@'), inst = MS[parts[0]], base = +parts[1];
    return renderRaw(function (ac, o, t) { inst.fn(ac, o, t, base); }, inst.d).then(function (b) { b = post(b); if (b) mcache[name] = b; });
  }
  function enqueue(key, front) {
    if (queued[key]) return;
    queued[key] = 1;
    if (front) rq.unshift(key); else rq.push(key);
    pump();
  }
  function pump() {
    if (rBusy || !rq.length || !OAC || !ctx) return;
    rBusy = true;
    var key = rq.shift(), p;
    try { p = renderKey(key); } catch (e) { p = Promise.reject(e); }
    p.then(null, function (e) { warn('render failed: ' + key, e); }).then(function () { rBusy = false; setTimeout(pump, 4); });
  }
  function mkey(nm, b) { return 'm:' + nm + '@' + b; }
  function queueAll() {
    // order: what the lobby needs first, then battle music + combat sfx, then everything else
    [mkey('bell', 81), mkey('boom', 0), mkey('gong', 0), mkey('taikoL', 0), 's:click', 's:tab', 's:open', 's:close',
      mkey('taiko', 0), mkey('shime', 0), mkey('hat', 0), mkey('bass', 38), mkey('bass', 50), mkey('pluck', 62), mkey('pluck', 74),
      mkey('stab', 50), mkey('rim', 0)].forEach(function (k) { enqueue(k); });
    ['hit', 'slash', 'arrow', 'magic', 'scythe', 'crit', 'enemyDie', 'pickup', 'gold', 'playerHurt', 'whoosh', 'explosion',
      'lightning', 'ice', 'fire', 'poison', 'levelup', 'skillPick', 'equip', 'unequip', 'upgrade', 'error', 'buy', 'reward',
      'chest', 'rare', 'merge', 'legendary', 'evolve', 'ult', 'bossRoar', 'metinBreak', 'victory', 'defeat'].forEach(function (n) { enqueue('s:' + n); });
    Object.keys(S).forEach(function (n) { enqueue('s:' + n); });
  }

  /* ================================================================================================
   * Master graph, unlock, visibility
   * ================================================================================================ */
  function build() {
    var c = ctx;
    var master = gain(c, 0.9), hp = bq(c, 'highpass', 28, 0.7);
    var comp = c.createDynamicsCompressor();
    comp.threshold.value = -14; comp.knee.value = 10; comp.ratio.value = 3.5; comp.attack.value = 0.004; comp.release.value = 0.22;
    var lim = c.createDynamicsCompressor();
    lim.threshold.value = -2; lim.knee.value = 0; lim.ratio.value = 20; lim.attack.value = 0.001; lim.release.value = 0.08;
    master.connect(hp); hp.connect(comp); comp.connect(lim); lim.connect(c.destination);
    var sfx = gain(c, sfxOn ? SFX_LV : 0); sfx.connect(master);
    var music = gain(c, musicOn ? MUSIC_LV : 0), duck = gain(c, 1); music.connect(duck); duck.connect(master);
    var rev = buildRev(c); rev.output.connect(master);
    var sfxRev = gain(c, sfxOn ? 1 : 0); sfxRev.connect(rev.input);
    var musicRev = gain(c, musicOn ? 1 : 0); musicRev.connect(rev.input);
    bus = { master: master, sfx: sfx, music: music, duck: duck, rev: rev, sfxRev: sfxRev, musicRev: musicRev, sends: {}, lim: lim };
    noise(c);
  }
  function send(amt) {
    var k = Math.round(amt * 20) / 20, s = bus.sends[k];
    if (!s) { s = bus.sends[k] = gain(ctx, k); s.connect(bus.sfxRev); }
    return s;
  }
  function silentKick() {
    try { var b = ctx.createBuffer(1, 1, ctx.sampleRate), s = ctx.createBufferSource(); s.buffer = b; s.connect(ctx.destination); s.start(0); } catch (e) { /* ignore */ }
  }
  function resume() {
    if (!ctx || ctx.state === 'running' || ctx.state === 'closed') return;
    resumeAt = wall();
    try { var p = ctx.resume(); if (p && p.then) p.then(null, function () {}); } catch (e) { /* ignore */ }
    silentKick();
  }
  function onGesture() { if (ctx && ctx.state !== 'running' && !document.hidden) resume(); }
  function onVis() {
    if (!ctx) return;
    try {
      if (document.hidden) {
        if (ctx.state === 'running') { suspendedByUs = true; var p = ctx.suspend(); if (p && p.then) p.then(null, function () {}); }
      } else if (suspendedByUs || ctx.state !== 'running') { suspendedByUs = false; resume(); }
    } catch (e) { /* ignore */ }
  }

  function unlock() {
    if (dead) return false;
    try {
      if (!ctx) {
        try { ctx = new AC({ latencyHint: 'interactive' }); } catch (e) { ctx = new AC(); }
        if (!settingsTouched) {
          var st = GM.S && GM.S.p && GM.S.p.settings;
          if (st) { sfxOn = st.sound !== false; musicOn = st.music !== false; }
        }
        build();
        unlocked = true;
        // mobile browsers only accept resume() inside certain gestures (touchend / click); keep retrying on those
        ['pointerup', 'touchend', 'click', 'keydown'].forEach(function (ev) { window.addEventListener(ev, onGesture, { capture: true, passive: true }); });
        document.addEventListener('visibilitychange', onVis);
        queueAll();
      }
      resume();
      if (want && musicOn && !cur) switchTo(want);
      return true;
    } catch (e) {
      warn('WebAudio unavailable', e);
      dead = true; ctx = null; bus = null;
      return false;
    }
  }

  /* ================================================================================================
   * SFX playback
   * ================================================================================================ */
  var per = {};
  function play(name, o) {
    if (dead || !ctx || !sfxOn || !bus) return false;
    try {
      var sd = S[name] || S[ALIAS[name]];
      if (!sd) return false;
      // while a resume is pending (first tap) sounds may still be scheduled; otherwise a suspended context plays nothing
      if (ctx.state !== 'running' && wall() - resumeAt > 0.4) return false;
      var key = S[name] ? name : ALIAS[name], st = per[key] || (per[key] = { last: -9, live: 0 }), now = wall();
      if (now - st.last < sd.thr || st.live >= sd.max ||
        (voices >= VOICE_SOFT && sd.pri < 1) || (voices >= VOICE_HARD && sd.pri < 3)) {
        stats.dropped[key] = (stats.dropped[key] || 0) + 1;
        return false;
      }
      var vol = sd.v * (o && o.vol != null && isFinite(o.vol) ? clamp(+o.vol, 0, 2) : 1);
      if (vol < 0.002) return false;
      st.last = now;
      var rate = (o && o.pitch > 0 && isFinite(o.pitch) ? +o.pitch : 1) * (1 + (Math.random() - 0.5) * sd.jit);
      if (sd.combo) {
        var c = COMBO[sd.combo];
        c.n = now - c.t < 0.32 ? Math.min(c.n + 1, c.sc.length - 1) : 0; c.t = now;
        rate *= Math.pow(2, c.sc[c.n] / 12);
      }
      rate = clamp(rate, 0.25, 4);
      var t = ctx.currentTime + 0.004, g = gain(ctx, vol), head = g, pan = null;
      var pv = o && o.pan != null && isFinite(o.pan) ? clamp(+o.pan, -1, 1) : null;
      if ((pv !== null || sd.sweep) && ctx.createStereoPanner) {
        pan = ctx.createStereoPanner();
        if (sd.sweep && pv === null) {
          pan.pan.setValueAtTime(sd.sweep[0], t);
          pan.pan.linearRampToValueAtTime(sd.sweep[1], t + sd.d * 0.7 / rate);
        } else pan.pan.value = pv;
        pan.connect(g); head = pan;
      }
      g.connect(bus.sfx);
      if (sd.rev) g.connect(send(sd.rev));
      voices++; st.live++;
      stats.played[key] = (stats.played[key] || 0) + 1;
      var ended = false;
      var done = function () {
        if (ended) return; ended = true;
        voices--; st.live--;
        try { g.disconnect(); if (pan) pan.disconnect(); } catch (e) { /* ignore */ }
      };
      var bufs = cache[key];
      if (bufs && bufs.length) {
        var src = ctx.createBufferSource();
        src.buffer = bufs[(Math.random() * bufs.length) | 0];
        src.playbackRate.value = rate;
        src.connect(head); src.onended = done;
        src.start(t);
        setTimeout(done, (src.buffer.duration / rate + 0.5) * 1000);   // safety net if onended never fires
      } else {
        // not rendered yet: synthesise live at an approximate level and make sure it gets rendered next
        stats.live++;
        var lg = gain(ctx, LIVE_NORM[key] || 0.6); lg.connect(head);
        sd.fn(ctx, lg, t, (Math.random() * sd.n) | 0);
        setTimeout(function () { done(); try { lg.disconnect(); } catch (e) { /* ignore */ } }, (sd.d + 0.3) * 1000);
        enqueue('s:' + key, true);
      }
      if (sd.duck) duck(sd.duck, sd.d * 0.75);
      return true;
    } catch (e) { warn('play ' + name, e); return false; }
  }
  // 0.9 / raw peak of each recipe (measured from offline renders) so the live fallback matches the rendered level
  var LIVE_NORM = {
    click: 0.99, tab: 2.04, open: 2.51, close: 2.02, equip: 0.82, unequip: 1.29, upgrade: 0.83, merge: 0.45,
    levelup: 0.78, reward: 1.85, rare: 1.27, legendary: 0.79, error: 1.38, slash: 2.27, arrow: 1.25, magic: 2.55,
    scythe: 1.72, hit: 0.66, crit: 0.6, enemyDie: 1.92, playerHurt: 0.8, pickup: 1.26, gold: 3.49, chest: 1.05,
    skillPick: 2.67, evolve: 0.55, ult: 0.52, bossRoar: 0.41, explosion: 0.56, lightning: 0.96, ice: 2.02, fire: 2.93,
    poison: 1.36, victory: 0.41, defeat: 0.66, metinBreak: 0.64, buy: 2.59, whoosh: 4.44, tick: 2.57, flip: 3.76,
    heal: 2.38, magnet: 3.06, gem: 2.77, dash: 4.54, heartbeat: 0.99, revive: 1.3, warning: 0.66, unlock: 1.03
  };

  function duck(amount, sec) {
    if (!ctx || !bus) return;
    try {
      var p = bus.duck.gain, t = ctx.currentTime, lo = clamp(1 - (amount || 0.5), 0.05, 1), hold = Math.max(0.05, sec || 1);
      p.cancelScheduledValues(t); p.setValueAtTime(p.value, t);
      p.linearRampToValueAtTime(lo, t + 0.08);
      p.setValueAtTime(lo, t + 0.08 + hold);
      p.linearRampToValueAtTime(1, t + 0.08 + hold + 0.9);
    } catch (e) { /* ignore */ }
  }

  /* ================================================================================================
   * Music
   * ================================================================================================ */
  var CHD = {
    Dm: { r: 38, pad: [50, 57, 62, 65], arp: [62, 65, 69, 74] },
    Bb: { r: 34, pad: [46, 58, 62, 65], arp: [58, 62, 65, 70] },
    Gm: { r: 43, pad: [43, 58, 62, 67], arp: [55, 58, 62, 67] },
    A:  { r: 45, pad: [45, 57, 61, 64], arp: [57, 61, 64, 69] },
    F:  { r: 41, pad: [41, 57, 60, 65], arp: [57, 60, 65, 69] },
    C:  { r: 36, pad: [48, 55, 60, 64], arp: [60, 64, 67, 72] },
    Eb: { r: 39, pad: [51, 58, 63, 67], arp: [55, 58, 63, 67] },
    Cs: { r: 37, pad: [49, 55, 61, 64], arp: [61, 64, 67, 73] }   // C#dim — the boss' leading-tone menace
  };

  function Track(name, E) {
    var td = TR[name], ac = E.ac;
    this.name = name; this.td = td; this.ac = ac; this.E = E;
    this.stepDur = 60 / td.bpm / 4;
    this.s = 0; this.next = ac.currentTime + 0.1;
    this.srcs = []; this.nodes = [];
    this.stopping = false; this.endAt = Infinity; this.dead = false;
    var fd = this.fd = gain(ac, 0), fr = this.fr = gain(ac, 0);
    fd.connect(E.out); fr.connect(E.rev);
    var vol = gain(ac, td.v); vol.connect(fd);
    var dry = this.dry = gain(ac, 1), wet = this.wet = gain(ac, 1), echo = this.echo = gain(ac, 1);
    dry.connect(vol); wet.connect(vol);
    var rs = gain(ac, td.rev * td.v); wet.connect(rs); rs.connect(fr);
    echo.connect(wet);
    var dl = ac.createDelay(2), fb = gain(ac, td.fb), dlp = bq(ac, 'lowpass', 2600, 0.5), dOut = gain(ac, 0.5);
    dl.delayTime.value = this.stepDur * td.echo;
    echo.connect(dl); dl.connect(dlp); dlp.connect(fb); fb.connect(dl); dlp.connect(dOut); dOut.connect(wet);
    this.nodes.push(vol, dry, wet, echo, rs, dl, fb, dlp, dOut);
    if (td.dist) {
      var sh = ac.createWaveShaper(), dlp2 = bq(ac, 'lowpass', 1900, 0.7);
      sh.curve = shaperCurve(ac, 2.5);
      this.dist = gain(ac, 0.8); this.dist.connect(sh); sh.connect(dlp2); dlp2.connect(dry);
      this.nodes.push(this.dist, sh, dlp2);
    }
    td.setup(this);
  }
  Track.prototype.keep = function (src) { src.start(this.next); this.srcs.push(src); return src; };
  Track.prototype.fade = function (to, t, dur) {
    [this.fd.gain, this.fr.gain].forEach(function (p) {
      p.cancelScheduledValues(t); p.setValueAtTime(p.value, t); p.linearRampToValueAtTime(to, t + Math.max(0.02, dur));
    });
  };
  Track.prototype.stop = function (t, dur) {
    if (this.stopping) return;
    this.stopping = true; this.endAt = t + dur;
    this.fade(0, t, dur);
    var self = this;
    if (this.E.live) setTimeout(function () { self.kill(); }, (dur + 0.35) * 1000);
  };
  Track.prototype.kill = function () {
    if (this.dead) return;
    this.dead = true;
    var t = this.ac.currentTime, self = this;
    this.srcs.forEach(function (s) { try { s.stop(t + 0.05); } catch (e) { /* ignore */ } });
    setTimeout(function () { [self.fd, self.fr].concat(self.nodes).forEach(function (n) { try { n.disconnect(); } catch (e) { /* ignore */ } }); }, 250);
    var i = tracks.indexOf(this); if (i >= 0) tracks.splice(i, 1);
    if (cur === this) cur = null;
  };
  Track.prototype.tick = function (until) {
    var now = this.ac.currentTime;
    while (this.next < until) {
      if (this.stopping && this.next > this.endAt) break;
      if (this.next >= now - 0.03) this.td.step(this, Math.max(this.next, now), this.s);
      this.s++; this.next += this.stepDur;
    }
  };
  Track.prototype.play = function (buf, t, v, rate, pan, busName) {
    if (!buf || v <= 0) return;
    var ac = this.ac, s = ac.createBufferSource(), g = gain(ac, v), dest = this[busName || 'dry'] || this.dry;
    s.buffer = buf; if (rate && rate !== 1) s.playbackRate.value = rate;
    var p = null;
    s.connect(g);
    if (pan && ac.createStereoPanner) { p = ac.createStereoPanner(); p.pan.value = pan; g.connect(p); p.connect(dest); } else g.connect(dest);
    s.start(Math.max(t, ac.currentTime));
    s.onended = function () { try { g.disconnect(); if (p) p.disconnect(); } catch (e) { /* ignore */ } };
  };
  Track.prototype.hit = function (nm, t, v, rate, pan, busName) { this.play(mcache[nm + '@0'], t, v, rate, pan, busName); };
  Track.prototype.note = function (nm, midi, t, v, pan, busName) {
    var bs = MS[nm].bases, b = bs[0];
    for (var i = 1; i < bs.length; i++) if (Math.abs(bs[i] - midi) < Math.abs(b - midi)) b = bs[i];
    this.play(mcache[nm + '@' + b], t, v, Math.pow(2, (midi - b) / 12), pan, busName);
  };

  /* persistent instruments (live for the whole track; pitch glides between chords) */
  function mkPad(T, o) {
    var ac = T.ac, t0 = T.next, f = bq(ac, 'lowpass', o.cut, o.q), g = gain(ac, 0);
    g.gain.setValueAtTime(0, t0); g.gain.linearRampToValueAtTime(o.v, t0 + (o.att || 1));
    f.connect(g); g.connect(T[o.bus || 'wet']);
    var lfo = osc(ac, 'sine', o.lfo), lg = gain(ac, o.lfoD); lfo.connect(lg); lg.connect(f.frequency); T.keep(lfo);
    var os = [];
    for (var i = 0; i < o.n * 2; i++) {
      var s = osc(ac, o.w || 'sawtooth', 220); s.detune.value = (i & 1 ? 1 : -1) * o.det + rnd(-3, 3);
      s.connect(f); T.keep(s); os.push(s);
    }
    T.nodes.push(f, g, lg);
    return {
      set: function (ms, t, gl) {
        for (var i = 0; i < os.length; i++) {
          var fr = mtof(ms[(i >> 1) % ms.length]);
          if (gl) os[i].frequency.setTargetAtTime(fr, t, gl / 3); else os[i].frequency.setValueAtTime(fr, t);
        }
      }
    };
  }
  function mkChoir(T, o) {
    var ac = T.ac, sum = gain(ac, 1), out = gain(ac, 0), fs = [], v = o.v, started = false;
    out.connect(T.wet);
    FORM[o.vowel || 'a'].forEach(function (fm) {
      var b = bq(ac, 'bandpass', fm[0], fm[2]), bg = gain(ac, fm[1] * 2.2);
      sum.connect(b); b.connect(bg); bg.connect(out); fs.push(b); T.nodes.push(b, bg);
    });
    var lp = bq(ac, 'lowpass', 700, 0.5), lg = gain(ac, 0.2); sum.connect(lp); lp.connect(lg); lg.connect(out);
    var vib = osc(ac, 'sine', 5.1), vg = gain(ac, 12); vib.connect(vg); T.keep(vib);
    var os = [];
    [[0, -8], [0, 9], [-12, 0]].forEach(function (c) {
      var s = osc(ac, 'sawtooth', 220); s.detune.value = c[1]; vg.connect(s.detune); s.connect(sum); T.keep(s); os.push({ s: s, oct: c[0] });
    });
    T.nodes.push(sum, out, lp, lg, vg);
    return {
      note: function (m, t, vel, att, gl) {
        os.forEach(function (x) {
          var fr = mtof(m + x.oct);
          if (gl && started) x.s.frequency.setTargetAtTime(fr, t, gl / 3); else x.s.frequency.setValueAtTime(fr, t);
        });
        started = true;
        out.gain.setTargetAtTime(v * vel * 0.55, t, 0.05);
        out.gain.setTargetAtTime(v * vel, t + 0.1, Math.max(0.05, att / 3));
      },
      off: function (t, rel) { out.gain.setTargetAtTime(0, t, Math.max(0.05, rel / 3)); },
      vowel: function (name, t, dur) { FORM[name].forEach(function (fm, i) { fs[i].frequency.setTargetAtTime(fm[0], t, dur / 3); }); }
    };
  }
  function mkDrone(T, o) {
    var ac = T.ac, s = osc(ac, o.w || 'triangle', 73), g = gain(ac, 0), n = s, t0 = T.next;
    if (o.lp) { var f = bq(ac, 'lowpass', o.lp, 1); s.connect(f); n = f; T.nodes.push(f); }
    g.gain.setValueAtTime(0, t0); g.gain.linearRampToValueAtTime(o.v, t0 + 2);
    n.connect(g); g.connect(T[o.bus || 'dry']); T.keep(s); T.nodes.push(g);
    return { set: function (m, t, gl) { if (gl) s.frequency.setTargetAtTime(mtof(m), t, gl / 3); else s.frequency.setValueAtTime(mtof(m), t); } };
  }
  function mkWind(T, o) {
    var ac = T.ac, s = ac.createBufferSource(), f = bq(ac, 'bandpass', 600, 1.4), g = gain(ac, o.v);
    s.buffer = noise(ac).pink; s.loop = true;
    var l1 = osc(ac, 'sine', 0.083), l1g = gain(ac, 330), l2 = osc(ac, 'sine', 0.051), l2g = gain(ac, o.v * 0.7);
    l1.connect(l1g); l1g.connect(f.frequency); l2.connect(l2g); l2g.connect(g.gain);
    s.connect(f); f.connect(g); g.connect(T.wet);
    T.keep(s); T.keep(l1); T.keep(l2); T.nodes.push(f, g, l1g, l2g);
  }
  function mkStrings(T, o) {
    var ac = T.ac, t0 = T.next, hp = bq(ac, 'highpass', 190, 0.7), lp = bq(ac, 'lowpass', 2600, 0.8), tr = gain(ac, 0.5), g = gain(ac, 0);
    var lfo = osc(ac, 'sine', o.rate), lg = gain(ac, 0.5); lfo.connect(lg); lg.connect(tr.gain); T.keep(lfo);
    g.gain.setValueAtTime(0, t0); g.gain.linearRampToValueAtTime(o.v, t0 + 0.6);
    hp.connect(lp); lp.connect(tr); tr.connect(g); g.connect(T.wet);
    var os = [];
    for (var i = 0; i < 6; i++) { var s = osc(ac, 'sawtooth', 220); s.detune.value = (i & 1 ? 1 : -1) * 11; s.connect(hp); T.keep(s); os.push(s); }
    T.nodes.push(hp, lp, tr, g, lg);
    return { set: function (ms, t, gl) { for (var i = 0; i < 6; i++) { var fr = mtof(ms[(i >> 1) % ms.length]); if (gl) os[i].frequency.setTargetAtTime(fr, t, gl / 3); else os[i].frequency.setValueAtTime(fr, t); } } };
  }

  var LOBBY_PROG = ['Dm', 'Bb', 'Gm', 'A', 'Dm', 'F', 'C', 'A'];               // 2 bars each
  var LOBBY_MEL = [69, 65, 70, 69, 67, 70, 69, 73, 74, 72, 72, 69, 67, 64, 64, 61];
  var LOBBY_BELLS = [[0, 6, 10], [4, 12], [2, 8, 14], [0, 10]];
  var BATTLE_PROG = ['Dm', 'Dm', 'Bb', 'C', 'Dm', 'Dm', 'Gm', 'A'];
  var BATTLE_MEL = [69, 72, 70, 67, 69, 74, 70, 73];
  var BATTLE_DRUM = 'T..t..t.T.t...t.';
  var BATTLE_BASS = [0, null, 0, 0, 12, null, 0, 0, 0, null, 0, 0, 7, null, 12, 7];
  var ARP_SEQ = [0, 1, 2, 3, 1, 2, 3, 4, 2, 3, 4, 5, 4, 3, 2, 1];
  var BOSS_PROG = ['Dm', 'Eb', 'Dm', 'Cs', 'Dm', 'Eb', 'Bb', 'A'];
  var BOSS_MEL = [62, 63, 62, 61, 62, 63, 65, 64];
  var BOSS_ACC = [1, 0, 0, 1, 0, 0, 1, 0, 0, 0, 1, 0, 1, 0, 0, 0];
  function arpNote(a, i) { return i < 4 ? a[i] : a[i - 3] + 12; }

  var TR = {
    // slow dark-fantasy pad: detuned saws through a breathing lowpass, formant choir, soft bells, distant drums, wind
    lobby: { bpm: 70, v: 0.82, rev: 0.6, echo: 3, fb: 0.4, fadeIn: 2.2,
      setup: function (T) {
        T.pad = mkPad(T, { n: 4, det: 10, cut: 760, q: 0.9, lfo: 0.06, lfoD: 340, v: 0.055, att: 3 });
        T.choir = mkChoir(T, { v: 0.12, vowel: 'o' });
        T.drone = mkDrone(T, { v: 0.08 });
        mkWind(T, { v: 0.045 });
      },
      step: function (T, t, s) {
        var bar = (s >> 4) % 16, k = s & 15, ci = bar >> 1, ch = CHD[LOBBY_PROG[ci]];
        if (k === 0) {
          if ((bar & 1) === 0) {
            T.pad.set(ch.pad, t, s === 0 ? 0 : 0.9);
            T.drone.set(ch.r, t, s === 0 ? 0 : 0.8);
            T.hit('boom', t, 0.32, 1, 0, 'wet');
            if ((ci & 1) === 0) T.choir.vowel(ci % 4 === 0 ? 'o' : 'a', t, 3);
          }
          T.choir.note(LOBBY_MEL[bar], t, 1, 1.1, 0.25);
          if (bar === 0) T.hit('gong', t, 0.2, 0.9, 0, 'wet');
        }
        var pat = LOBBY_BELLS[bar % 4], idx = pat.indexOf(k);
        if (idx >= 0) T.note('bell', ch.arp[(idx + bar) % 4] + 12, t, 0.2 + 0.08 * Math.random(), idx % 2 ? 0.45 : -0.45, 'echo');
        if ((bar & 1) === 1 && (k === 8 || k === 11)) T.hit('taikoL', t, k === 8 ? 0.22 : 0.13, 1, 0, 'wet');
      } },
    // driving taiko, galloping bass ostinato, minor-key arpeggio with echoes; choir + brass stabs in the B section
    battle: { bpm: 112, v: 1.0, rev: 0.32, echo: 3, fb: 0.3, fadeIn: 1.2,
      setup: function (T) {
        T.pad = mkPad(T, { n: 3, det: 12, cut: 1300, q: 1.2, lfo: 0.13, lfoD: 550, v: 0.05, att: 1 });
        T.choir = mkChoir(T, { v: 0.1, vowel: 'a' });
      },
      step: function (T, t, s) {
        var bar = (s >> 4) % 16, k = s & 15, ch = CHD[BATTLE_PROG[bar % 8]], B = bar >= 8, fill = (bar % 8) === 7 && k >= 8;
        if (k === 0) {
          T.pad.set(ch.pad.slice(1), t, s === 0 ? 0 : 0.05);
          if (B) T.choir.note(BATTLE_MEL[bar % 8], t, 1, 0.25, 0.08);
          else if (bar === 0) T.choir.off(t, 0.6);
          if (bar === 0) T.hit('gong', t, 0.3, 1.1, 0, 'wet');
        }
        var d = BATTLE_DRUM.charAt(k);
        if (fill) T.hit('taiko', t, 0.42 + (k - 8) * 0.06, (k & 1) ? 1.35 : 1.05, (k & 1) ? 0.2 : -0.2, 'wet');
        else if (d === 'T') T.hit('taiko', t, 0.72, 1, 0, 'wet');
        else if (d === 't') T.hit('taiko', t, 0.42, 1.35, (k & 2) ? 0.25 : -0.25, 'wet');
        if ((k & 1) === 0 && !fill) T.hit('shime', t, (k % 8 === 4) ? 0.5 : 0.22, 1, 0.15, 'dry');
        T.hit('hat', t, (k % 4 === 2) ? 0.32 : 0.13, 1, -0.3, 'dry');
        var bo = BATTLE_BASS[k];
        if (bo != null) T.note('bass', ch.r + bo, t, (k % 4 === 0) ? 0.6 : 0.4, 0, 'dry');
        if (bar >= 2 && bar % 8 !== 7) T.note('pluck', arpNote(ch.arp, ARP_SEQ[k]), t, (k % 4 === 0) ? 0.36 : 0.25, (k & 1) ? 0.35 : -0.35, 'echo');
        if (B && (k === 0 || k === 10)) T.note('stab', ch.r + 12, t, k ? 0.3 : 0.45, 0, 'wet');
      } },
    // heavier, faster, darker: phrygian half-steps, taiko on every beat, distorted 16th bass chug, tremolo strings,
    // 3-3-2 brass stabs, tritone danger bells, low chant
    boss: { bpm: 138, v: 0.8, rev: 0.3, echo: 2, fb: 0.25, fadeIn: 0.5, dist: true,
      setup: function (T) {
        T.str = mkStrings(T, { v: 0.065, rate: 1 / T.stepDur });
        T.choir = mkChoir(T, { v: 0.13, vowel: 'o' });
        T.drone = mkDrone(T, { w: 'sawtooth', lp: 300, v: 0.06 });
      },
      step: function (T, t, s) {
        var bar = (s >> 4) % 8, k = s & 15, ch = CHD[BOSS_PROG[bar]], B = bar >= 4, fill = bar === 7 && k >= 12;
        if (k === 0) {
          T.str.set(ch.pad.slice(1), t, s === 0 ? 0 : 0.03);
          T.drone.set(ch.r, t, s === 0 ? 0 : 0.05);
          T.choir.note(BOSS_MEL[bar], t, 1, 0.2, 0.1);
          T.hit('taikoL', t, 0.55, 1, 0, 'wet');
          if (bar === 0) T.hit('gong', t, 0.38, 0.8, 0, 'wet');
        }
        if (fill) T.hit('taiko', t, 0.6 + (k - 12) * 0.1, 1.15 + (k - 12) * 0.08, 0, 'wet');
        else {
          if (k % 4 === 0) T.hit('taiko', t, 0.68, 0.92, 0, 'wet');
          else if (k % 4 === 2) T.hit('taiko', t, 0.38, 1.4, (k & 4) ? 0.3 : -0.3, 'wet');
        }
        T.hit('shime', t, (k % 4 === 2) ? 0.36 : 0.15, 1.1, 0.2, 'dry');
        if (k & 1) T.hit('hat', t, 0.24, 1, -0.25, 'dry');
        T.note('bass', ch.r + ((k === 6 || k === 14) ? 12 : 0), t, BOSS_ACC[k] ? 0.6 : 0.3, 0, 'dist');
        if (B && (k === 0 || k === 3 || k === 6)) T.note('stab', ch.r + 12, t, k ? 0.36 : 0.5, 0, 'wet');
        if (k === 2 || k === 10) T.note('bell', k === 2 ? 80 : 81, t, 0.16, k === 2 ? -0.4 : 0.4, 'echo');
        if (B && bar !== 7 && (k & 1) === 0) T.note('pluck', arpNote(ch.arp, ARP_SEQ[k]) - 12, t, 0.22, (k & 2) ? 0.3 : -0.3, 'echo');
      } }
  };

  var tracks = [], cur = null, want = null, timer = null;
  function liveEnv() { return { ac: ctx, out: bus.music, rev: bus.musicRev, live: true }; }
  function tickAll() {
    if (!ctx) return;
    try {
      var until = ctx.currentTime + LOOK;
      for (var i = tracks.length - 1; i >= 0; i--) if (tracks[i] && !tracks[i].dead) tracks[i].tick(until);
    } catch (e) { warn('music tick', e); }
    if (!tracks.length && timer) { clearInterval(timer); timer = null; }
  }
  function switchTo(name) {
    if (!ctx || !bus) return;
    if (cur && cur.name === name && !cur.stopping) return;
    var t = ctx.currentTime;
    // never let more than one older track fade at a time: rapid switching would otherwise stack oscillators
    tracks.forEach(function (tr) {
      if (tr.stopping && !tr.dead && !tr.fast) { tr.fast = true; tr.endAt = Math.min(tr.endAt, t); tr.fade(0, t, 0.06); setTimeout(function () { tr.kill(); }, 140); }
    });
    if (cur) { cur.stop(t, name === 'boss' ? 0.8 : name ? 1.5 : 1.4); cur = null; }
    if (name) {
      cur = new Track(name, liveEnv());
      cur.fade(1, cur.next, TR[name].fadeIn);
      tracks.push(cur);
      cur.tick(ctx.currentTime + LOOK);
    }
    if (!timer && tracks.length) timer = setInterval(tickAll, TICK_MS);
  }
  function music(name) {
    try {
      if (name === undefined || name === '' || name === false) name = null;
      if (name !== null && !TR[name]) return;
      want = name;
      if (dead || !ctx || !unlocked || !musicOn) return;
      switchTo(want);
    } catch (e) { warn('music ' + name, e); }
  }

  function setSfx(on) {
    try {
      settingsTouched = true;
      sfxOn = !!on;
      if (ctx && bus) {
        var t = ctx.currentTime;
        [[bus.sfx.gain, sfxOn ? SFX_LV : 0], [bus.sfxRev.gain, sfxOn ? 1 : 0]].forEach(function (x) {
          x[0].cancelScheduledValues(t); x[0].setValueAtTime(x[0].value, t); x[0].linearRampToValueAtTime(x[1], t + 0.04);
        });
      }
    } catch (e) { warn('setSfx', e); }
  }
  function setMusic(on) {
    try {
      settingsTouched = true;
      var was = musicOn;
      musicOn = !!on;
      if (!ctx || !bus) return;
      var t = ctx.currentTime;
      [[bus.music.gain, musicOn ? MUSIC_LV : 0], [bus.musicRev.gain, musicOn ? 1 : 0]].forEach(function (x) {
        x[0].cancelScheduledValues(t); x[0].setValueAtTime(x[0].value, t); x[0].linearRampToValueAtTime(x[1], t + 0.05);
      });
      if (!musicOn && was) {
        var dying = tracks.slice(); cur = null;
        dying.forEach(function (tr) { tr.stopping = true; tr.endAt = t; });
        setTimeout(function () { dying.forEach(function (tr) { tr.kill(); }); }, 120);
      } else if (musicOn && !was && want && unlocked) switchTo(want);
    } catch (e) { warn('setMusic', e); }
  }

  /* ---------- debug / test hooks (used by the scratch harness; cheap and inert in the game) ---------- */
  var debug = {
    ctx: function () { return ctx; },
    stats: function () {
      return { voices: voices, state: ctx ? ctx.state : 'none', played: stats.played, dropped: stats.dropped, live: stats.live,
        cached: Object.keys(cache).length, mcached: Object.keys(mcache).length, queue: rq.length + (rBusy ? 1 : 0),
        tracks: tracks.map(function (x) { return x.name + (x.stopping ? '(out)' : ''); }), current: cur ? cur.name : null };
    },
    ready: function () { return !!ctx && !rBusy && rq.length === 0; },
    // raw (un-normalised) render of a recipe → AudioBuffer
    render: function (name, vi) { return renderRaw(S[name].fn, S[name].d, vi || 0); },
    cached: function (name) { return cache[name] || null; },
    // offline render of a music track (needs the one-shots to be cached first)
    renderMusic: function (name, sec) {
      var sr = ctx.sampleRate, oc = new OAC(2, Math.ceil(sec * sr), sr), out = gain(oc, MUSIC_LV), rev = buildRev(oc);
      out.connect(oc.destination); rev.output.connect(oc.destination);
      var tr = new Track(name, { ac: oc, out: out, rev: rev.input, live: false });
      tr.fade(1, 0, 0.02); tr.tick(sec);
      return startR(oc);
    },
    master: function () { return bus && bus.lim; }
  };

  var NAMES = ['click', 'tab', 'open', 'close', 'equip', 'unequip', 'upgrade', 'merge', 'levelup', 'reward', 'rare', 'legendary', 'error',
    'slash', 'arrow', 'magic', 'scythe', 'hit', 'crit', 'enemyDie', 'playerHurt', 'pickup', 'gold', 'chest', 'skillPick', 'evolve', 'ult',
    'bossRoar', 'explosion', 'lightning', 'ice', 'fire', 'poison', 'victory', 'defeat', 'metinBreak', 'buy', 'whoosh'];

  GM.A = {
    unlock: unlock,
    setSfx: setSfx,
    setMusic: setMusic,
    play: play,
    music: music,
    duck: function (amount, sec) { duck(amount, sec); },
    get sfxOn() { return sfxOn; },
    set sfxOn(v) { setSfx(v); },
    get musicOn() { return musicOn; },
    set musicOn(v) { setMusic(v); },
    get current() { return want; },
    get unlocked() { return unlocked && !dead; },
    names: NAMES,
    extras: Object.keys(S).filter(function (n) { return NAMES.indexOf(n) < 0; }),
    tracks: Object.keys(TR),
    debug: debug
  };
})(window.GM = window.GM || {});
