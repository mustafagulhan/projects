/* GÖLGE MUHAFIZLARI — boot + main loop (owner: lead) */
(function (GM) {
  'use strict';
  function safe(fn, label) {
    try { return fn(); } catch (e) { console.error('[GM] ' + label + ' failed:', e); }
  }
  function boot() {
    safe(function () { GM.S.load(); }, 'S.load');
    safe(function () { if (GM.A && GM.A.setSfx) { GM.A.setSfx(GM.S.p.settings.sound !== false); GM.A.setMusic(GM.S.p.settings.music !== false); } }, 'audio settings');
    safe(function () { GM.UI.init(); }, 'UI.init');
    safe(function () { if (GM.UIMeta && GM.UIMeta.init) GM.UIMeta.init(); }, 'UIMeta.init');
    safe(function () { if (GM.UI.go && !GM.UI.current) GM.UI.go('savas'); }, 'UI.go');

    var root = document.getElementById('gm');
    var unlocked = false;
    root.addEventListener('pointerdown', function () {
      if (!unlocked && GM.A && GM.A.unlock) { unlocked = true; safe(function () { GM.A.unlock(); if (GM.A.music && !(GM.B && GM.B.active)) GM.A.music('lobby'); }, 'audio unlock'); }
    }, { passive: true });
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) {
        safe(function () { if (GM.B && GM.B.active && GM.B.pause) GM.B.pause(); }, 'B.pause');
        safe(function () { GM.S.save(); }, 'S.save');
      }
    });
    window.addEventListener('pagehide', function () { safe(function () { GM.S.save(); }, 'S.save'); });

    var last = performance.now(), errs = 0;
    function loop(now) {
      var dt = Math.min(0.05, Math.max(0, (now - last) / 1000)); last = now;
      var t = now / 1000;
      try {
        if (GM.B && GM.B.active) GM.B.frame(dt, t);
        else if (GM.UI && GM.UI.frame) GM.UI.frame(dt, t);
      } catch (e) { if (errs++ < 5) console.error('[GM] frame error:', e); }
      requestAnimationFrame(loop);
    }
    requestAnimationFrame(loop);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})(window.GM = window.GM || {});
