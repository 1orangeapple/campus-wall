/* ===========================================================
   通知中心
   -----------------------------------------------------------
   网页做不到微信那种「关了页面还能收」的离线推送（那需要
   Service Worker + Push 服务端），这里做的是：
   - 页面在后台 / 切到别的 App 时，弹系统通知（Android 通知栏可见）
   - 页面在前台时，用站内 toast，不打扰
   - 标题栏闪动 + 提示音
   =========================================================== */

(function () {
  'use strict';

  const LS_SOUND = 'campuswall_sound_on';
  const LS_ASKED = 'campuswall_notify_asked';

  let audioCtx = null;
  let blinkTimer = null;
  let baseTitle = document.title;

  function soundOn() {
    try { return localStorage.getItem(LS_SOUND) !== '0'; } catch (e) { return true; }
  }

  /** 用 WebAudio 合成一个短提示音，不依赖任何音频文件 */
  function beep() {
    if (!soundOn()) return;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      if (!audioCtx) audioCtx = new AC();
      if (audioCtx.state === 'suspended') audioCtx.resume();

      const t = audioCtx.currentTime;
      // 两声「叮咚」
      [0, 0.13].forEach(function (offset, i) {
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(i === 0 ? 880 : 1174, t + offset);
        gain.gain.setValueAtTime(0.0001, t + offset);
        gain.gain.exponentialRampToValueAtTime(0.16, t + offset + 0.015);
        gain.gain.exponentialRampToValueAtTime(0.0001, t + offset + 0.20);
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.start(t + offset);
        osc.stop(t + offset + 0.24);
      });
    } catch (e) { /* 静默 */ }
  }

  const Notify = {
    /* ---------- 权限 ---------- */
    supported() {
      return typeof window.Notification !== 'undefined';
    },

    permission() {
      return this.supported() ? Notification.permission : 'unsupported';
    },

    async request() {
      if (!this.supported()) return 'unsupported';
      try {
        const p = await Notification.requestPermission();
        try { localStorage.setItem(LS_ASKED, '1'); } catch (e) {}
        return p;
      } catch (e) {
        return 'denied';
      }
    },

    /** 第一次进站自动问一次（用户拒绝过就不再骚扰） */
    async maybeAsk() {
      if (!this.supported()) return;
      let asked = false;
      try { asked = localStorage.getItem(LS_ASKED) === '1'; } catch (e) {}
      if (asked || Notification.permission !== 'default') return;
      setTimeout(() => { this.request(); }, 2500);
    },

    /* ---------- 系统通知 ---------- */
    push(title, body, opts) {
      opts = opts || {};
      if (!this.supported() || Notification.permission !== 'granted') return false;
      try {
        const n = new Notification(title, {
          body: body || '',
          tag: opts.tag || 'campuswall',
          renotify: true,
          silent: false
        });
        n.onclick = function () {
          try { window.focus(); } catch (e) {}
          if (opts.url) location.href = opts.url;
          n.close();
        };
        setTimeout(() => { try { n.close(); } catch (e) {} }, 8000);
        return true;
      } catch (e) {
        return false;
      }
    },

    /**
     * 统一入口：
     * 页面在后台 → 系统通知 + 提示音 + 标题闪
     * 页面在前台 → 只 toast，不吵
     */
    alert(title, body, opts) {
      opts = opts || {};
      const hidden = document.hidden || !document.hasFocus();

      if (hidden) {
        const ok = this.push(title, body, opts);
        beep();
        this.blink(title);
        if (!ok) beep();   // 没授权也要有声音提示
      } else if (window.__cwToast) {
        window.__cwToast(title + (body ? '：' + body : ''));
      }
      if (!hidden && opts.forceSound) beep();
    },

    /* ---------- 标题闪动 ---------- */
    blink(msg) {
      this.stopBlink();
      let on = false;
      const original = document.title;
      baseTitle = baseTitle || original;
      blinkTimer = setInterval(function () {
        on = !on;
        document.title = on ? '🔴 ' + (msg || '有新消息') : baseTitle;
      }, 1100);
      const stop = () => {
        this.stopBlink();
        document.removeEventListener('visibilitychange', stop);
      };
      document.addEventListener('visibilitychange', stop);
    },

    stopBlink() {
      if (blinkTimer) { clearInterval(blinkTimer); blinkTimer = null; }
      document.title = baseTitle;
    },

    /* ---------- 声音开关 ---------- */
    toggleSound() {
      const next = !soundOn();
      try { localStorage.setItem(LS_SOUND, next ? '1' : '0'); } catch (e) {}
      if (next) beep();
      return next;
    },

    soundOn: soundOn
  };

  document.addEventListener('visibilitychange', function () {
    if (!document.hidden) Notify.stopBlink();
  });

  window.Notify = Notify;
})();
