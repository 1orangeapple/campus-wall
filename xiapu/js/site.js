/* ============================================================
   页面交互
   ============================================================ */
(function () {
  'use strict';

  // 本页的核心体验就是动效，因此不跟随系统「减弱动态效果」开关
  const reduce = false;
  const hover = matchMedia('(hover:hover) and (pointer:fine)').matches;
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

  /* ---------- 首屏入场 ---------- */
  window.addEventListener('load', () => {
    requestAnimationFrame(() => document.body.classList.add('is-ready'));
  });
  setTimeout(() => document.body.classList.add('is-ready'), 1200);

  /* ---------- 滚动进度 + 导轨 ---------- */
  const scrollLine = $('#scrollLine');
  const railLinks = $$('.rail a');
  const sections = railLinks.map(a => ({ a, el: document.querySelector(a.getAttribute('href')) }));

  let ticking = false;
  function onScroll() {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => {
      ticking = false;

      const h = document.documentElement.scrollHeight - innerHeight;
      scrollLine.style.width = (h > 0 ? (scrollY / h) * 100 : 0) + '%';

      const mid = scrollY + innerHeight * 0.42;
      let active = sections[0];
      sections.forEach(s => { if (s.el && s.el.offsetTop <= mid) active = s; });
      sections.forEach(s => s.a.classList.toggle('is-active', s === active));

      parallax();
      journey();
      tiltReset();
      toneCheck();
    });
  }
  addEventListener('scroll', onScroll, { passive: true });
  addEventListener('resize', () => { measure(); onScroll(); });

  /* ---------- 声音按钮跟随深浅底 ---------- */
  const soundEl = document.getElementById('sound');
  const darkZones = $$('.chapter--ink, .anthem');
  function toneCheck() {
    if (!soundEl || !darkZones.length) return;
    const r = soundEl.getBoundingClientRect();
    const y = r.top + r.height / 2;
    const dark = darkZones.some(z => {
      const b = z.getBoundingClientRect();
      return b.top <= y && b.bottom >= y;
    });
    soundEl.classList.toggle('is-dark', dark);
  }

  /* ---------- 出现动画 ---------- */
  const revealItems = $$('.reveal');
  if ('IntersectionObserver' in window && !reduce) {
    const io = new IntersectionObserver((es) => {
      es.forEach(e => {
        if (e.isIntersecting) {
          const el = e.target;
          const sibs = el.parentElement ? Array.from(el.parentElement.children).filter(c => c.classList.contains('reveal')) : [];
          const idx = Math.max(0, sibs.indexOf(el));
          el.style.transitionDelay = Math.min(0.36, idx * 0.07) + 's';
          el.classList.add('is-in');
          io.unobserve(el);
        }
      });
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.08 });
    revealItems.forEach(el => io.observe(el));
    setTimeout(() => {
      revealItems.forEach(el => {
        if (!el.classList.contains('is-in') && el.getBoundingClientRect().top < innerHeight) {
          el.classList.add('is-in');
        }
      });
    }, 1400);
  } else {
    revealItems.forEach(el => el.classList.add('is-in'));
  }

  /* ---------- 数字 ---------- */
  const statsEl = $('#stats');
  let statsDone = false;
  function runStats() {
    if (statsDone) return;
    statsDone = true;
    $$('dt', statsEl).forEach((dt, i) => {
      const target = parseFloat(dt.dataset.count);
      const suffix = dt.dataset.suffix || '';
      const digits = String(Math.round(target)).length;
      const dur = 1400 + i * 120;
      const t0 = performance.now();
      function step(t) {
        const p = clamp((t - t0) / dur, 0, 1);
        const e = 1 - Math.pow(1 - p, 3);
        let v = Math.round(target * e);
        let str = v >= 10000 ? v.toLocaleString('en-US') : String(v);
        dt.innerHTML = str + (suffix ? '<span>' + suffix + '</span>' : '');
        if (p < 1) requestAnimationFrame(step);
      }
      requestAnimationFrame(step);
    });
  }
  if (statsEl) {
    if ('IntersectionObserver' in window) {
      const io2 = new IntersectionObserver(es => {
        if (es[0].isIntersecting) { runStats(); io2.disconnect(); }
      }, { threshold: 0.35 });
      io2.observe(statsEl);
    } else runStats();
  }

  /* ---------- 校门视差 ---------- */
  const gate = $('#gateImg');
  function parallax() {
    if (!gate || reduce) return;
    const r = gate.getBoundingClientRect();
    if (r.bottom < -200 || r.top > innerHeight + 200) return;
    const p = (r.top + r.height / 2 - innerHeight / 2) / innerHeight;
    gate.style.transform = `translate3d(0,${(-p * 46).toFixed(1)}px,0) scale(1.06)`;
  }

  /* ---------- 3D 倾斜 ---------- */
  const tilts = $$('[data-tilt]');
  function tiltReset() {}
  if (hover && !reduce) {
    tilts.forEach(el => {
      const img = $('img', el);
      el.addEventListener('pointermove', ev => {
        const r = el.getBoundingClientRect();
        const x = (ev.clientX - r.left) / r.width - 0.5;
        const y = (ev.clientY - r.top) / r.height - 0.5;
        img.style.transform = `perspective(1000px) rotateY(${x * 7}deg) rotateX(${-y * 7}deg) scale(1.015)`;
      });
      el.addEventListener('pointerleave', () => { img.style.transform = ''; });
    });
  }

  /* ---------- 序 · 横向长卷 ---------- */
  const scroller = $('#journeyScroller');
  const stage = scroller ? $('.journey__stage', scroller) : null;
  const track = $('#journeyTrack');
  const bar = $('#journeyBar');
  const panels = track ? $$('.panel', track) : [];
  let shiftMax = 0, stageW = 0;

  function measure() {
    if (!track || !stage) return;
    stageW = stage.clientWidth;
    shiftMax = Math.max(0, track.scrollWidth - stageW);
    panels.forEach(p => { p.style.transition = 'none'; });
  }

  function journey() {
    if (!track || !scroller || !stage) return;
    if (reduce) { track.style.transform = 'none'; return; }
    const r = scroller.getBoundingClientRect();
    const travel = scroller.offsetHeight - stage.offsetHeight;
    const p = clamp(-r.top / Math.max(1, travel), 0, 1);

    track.style.transform = `translate3d(${(-p * shiftMax).toFixed(1)}px,0,0)`;
    if (bar) bar.style.width = (p * 100) + '%';

    const cx = stageW / 2;
    panels.forEach(el => {
      const b = el.getBoundingClientRect();
      const d = (b.left + b.width / 2 - cx) / stageW;   // -1 .. 1
      const ry = clamp(d * -20, -17, 17);
      const tz = -Math.abs(d) * 170;
      const sc = 1 - Math.abs(d) * 0.045;
      el.style.transform = `translate3d(0,0,${tz.toFixed(1)}px) rotateY(${ry.toFixed(2)}deg) scale(${sc.toFixed(3)})`;
      el.style.opacity = String(clamp(1 - Math.abs(d) * 0.55, 0.32, 1));
    });
  }

  measure();
  // 面板内容确定后再量一次
  addEventListener('load', measure);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(measure);

  /* ---------- 道 · 六句 ---------- */
  const creed = $('#creed');
  if (creed) {
    const rows = $$('.creed__row', creed);
    rows.forEach(row => {
      const btn = $('button', row);
      const panel = $('.creed__panel', row);
      btn.addEventListener('click', () => {
        const open = btn.getAttribute('aria-expanded') === 'true';
        rows.forEach(o => {
          const ob = $('button', o), op = $('.creed__panel', o);
          if (o === row) return;
          ob.setAttribute('aria-expanded', 'false');
          op.style.height = '0px';
        });
        if (open) {
          btn.setAttribute('aria-expanded', 'false');
          panel.style.height = '0px';
        } else {
          btn.setAttribute('aria-expanded', 'true');
          panel.style.height = panel.scrollHeight + 'px';
        }
      });
    });
    addEventListener('resize', () => {
      rows.forEach(row => {
        const btn = $('button', row), panel = $('.creed__panel', row);
        if (btn.getAttribute('aria-expanded') === 'true') {
          panel.style.height = 'auto';
          const h = panel.scrollHeight;
          panel.style.height = h + 'px';
        }
      });
    });
  }

  /* ---------- 卷 · 校刊 ---------- */
  const deckEl = $('#journalDeck');
  if (deckEl) {
    const sheets = $$('.sheet', deckEl);
    const stageJ = $('#journalStage');
    const countEl = $('#jCount');
    const N = sheets.length;
    let idx = 0;

    function layout(animate) {
      const w = sheets[0].getBoundingClientRect().width || 200;
      const gap = w * 0.58;
      sheets.forEach((s, k) => {
        const off = k - idx;
        const a = Math.abs(off);
        const vis = a > 3 ? 0 : 1;
        const tx = off * gap;
        const tz = -a * (w * 0.55);
        const ry = clamp(off * -26, -40, 40);
        const sc = 1 - Math.min(a, 3) * 0.05;
        s.style.transition = animate === false ? 'none' : '';
        s.style.transform = `translate(-50%,-50%) translate3d(${tx.toFixed(1)}px,0,${tz.toFixed(1)}px) rotateY(${ry.toFixed(1)}deg) scale(${sc.toFixed(3)})`;
        s.style.opacity = String(vis * clamp(1 - a * 0.26, 0, 1));
        s.style.zIndex = String(20 - a);
        s.style.pointerEvents = a > 3 ? 'none' : 'auto';
        s.classList.toggle('is-current', off === 0);
        s.setAttribute('aria-hidden', off === 0 ? 'false' : 'true');
      });
      if (countEl) countEl.textContent = String(idx + 1).padStart(2, '0') + ' / ' + String(N).padStart(2, '0');
    }
    function go(n, animate) {
      idx = (n + N) % N;
      layout(animate);
    }
    layout(false);
    addEventListener('resize', () => layout(false));

    $('#jPrev').addEventListener('click', () => go(idx - 1));
    $('#jNext').addEventListener('click', () => go(idx + 1));

    // 拖拽 / 滑动
    let downX = 0, downY = 0, dragging = false, moved = false;
    stageJ.addEventListener('pointerdown', e => {
      if (e.target.closest('.jbtn')) return;
      dragging = true; moved = false;
      downX = e.clientX; downY = e.clientY;
      stageJ.setPointerCapture && stageJ.setPointerCapture(e.pointerId);
    });
    stageJ.addEventListener('pointermove', e => {
      if (!dragging) return;
      const dx = e.clientX - downX, dy = e.clientY - downY;
      if (Math.abs(dx) > 8 && Math.abs(dx) > Math.abs(dy)) moved = true;
    });
    stageJ.addEventListener('pointerup', e => {
      if (!dragging) return;
      dragging = false;
      const dx = e.clientX - downX;
      if (Math.abs(dx) > 46) go(idx + (dx < 0 ? 1 : -1));
      else if (!moved && e.target.closest('.sheet.is-current')) openLb(idx);
    });
    stageJ.addEventListener('pointercancel', () => { dragging = false; });

    stageJ.addEventListener('keydown', e => {
      if (e.key === 'ArrowLeft') { go(idx - 1); e.preventDefault(); }
      if (e.key === 'ArrowRight') { go(idx + 1); e.preventDefault(); }
      if (e.key === 'Enter') { openLb(idx); }
    });

    /* 灯箱 */
    const lb = $('#lightbox'), lbImg = $('#lbImg'), lbCount = $('#lbCount');
    function openLb(n) {
      idx = clamp(n, 0, N - 1);
      layout();
      lbImg.src = sheets[idx].querySelector('img').src;
      lbImg.alt = sheets[idx].querySelector('img').alt;
      lbCount.textContent = String(idx + 1).padStart(2, '0') + ' / ' + String(N).padStart(2, '0');
      lb.classList.remove('is-zoom');
      $('#lbZoom').setAttribute('aria-pressed', 'false');
      if (typeof lb.showModal === 'function') lb.showModal(); else lb.setAttribute('open', '');
      document.body.style.overflow = 'hidden';
    }
    function closeLb() {
      if (typeof lb.close === 'function') lb.close(); else lb.removeAttribute('open');
      document.body.style.overflow = '';
    }
    $('#lbClose').addEventListener('click', closeLb);
    lb.addEventListener('close', () => { document.body.style.overflow = ''; });
    lb.addEventListener('click', e => { if (e.target === lb) closeLb(); });
    $('#lbPrev').addEventListener('click', () => { idx = (idx - 1 + N) % N; openLb(idx); });
    $('#lbNext').addEventListener('click', () => { idx = (idx + 1) % N; openLb(idx); });
    $('#lbZoom').addEventListener('click', e => {
      const on = lb.classList.toggle('is-zoom');
      e.currentTarget.setAttribute('aria-pressed', String(on));
      e.currentTarget.textContent = on ? '适应屏幕' : '原始大小';
    });
    addEventListener('keydown', e => {
      if (!lb.open) return;
      if (e.key === 'ArrowLeft') { idx = (idx - 1 + N) % N; openLb(idx); }
      if (e.key === 'ArrowRight') { idx = (idx + 1) % N; openLb(idx); }
    });
  }

  /* ---------- 声音 ---------- */
  const audio = new Audio('audio/ruoshui.mp3');
  audio.loop = true;
  audio.preload = 'auto';
  audio.volume = 0.55;

  const soundBtn = $('#sound');
  const anthemBtn = $('#anthemPlay');
  const waveBars = anthemBtn ? $$('.anthem__wave i', anthemBtn) : [];
  let playing = false;

  function paint(on) {
    playing = on;
    if (soundBtn) soundBtn.setAttribute('aria-pressed', String(on));
    if (anthemBtn) {
      anthemBtn.setAttribute('aria-pressed', String(on));
      $('.anthem__txt', anthemBtn).textContent = on ? '正在播放 · 点击暂停' : '聆听 · 四十秒';
    }
    if (!on) waveBars.forEach(b => { b.style.height = '4px'; });
  }

  audio.addEventListener('play', () => paint(true));
  audio.addEventListener('pause', () => paint(false));

  function toggle() {
    if (playing) { audio.pause(); paint(false); return; }
    paint(true);                       // 先给反馈，失败再回退
    const p = audio.play();
    if (p && p.catch) p.catch(() => paint(false));
  }
  soundBtn && soundBtn.addEventListener('click', toggle);
  anthemBtn && anthemBtn.addEventListener('click', toggle);

  // 装饰性声波
  (function bars() {
    if (!waveBars.length) return;
    let t = 0;
    function frame() {
      requestAnimationFrame(frame);
      if (!playing) return;
      t += 0.1;
      waveBars.forEach((b, i) => {
        const v = (Math.sin(t + i * 0.9) * 0.5 + 0.5) * (Math.sin(t * 0.31 + i) * 0.4 + 0.6);
        b.style.height = (3 + v * 15).toFixed(1) + 'px';
      });
    }
    frame();
  })();

  /* ---------- 首屏水光 ---------- */
  const wc = $('#waterCanvas');
  if (wc && !reduce) {
    const ctx = wc.getContext('2d');
    let W = 0, H = 0, dpr = 1;
    const blobs = [];
    const ripples = [];

    function size() {
      const r = wc.parentElement.getBoundingClientRect();
      dpr = Math.min(devicePixelRatio || 1, 1.5);
      W = r.width; H = r.height;
      wc.width = Math.round(W * dpr);
      wc.height = Math.round(H * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    size();
    addEventListener('resize', size);

    for (let i = 0; i < 5; i++) {
      blobs.push({
        x: Math.random(), y: Math.random(),
        r: 0.24 + Math.random() * 0.26,
        a: 0.10 + Math.random() * 0.10,
        sx: (Math.random() - 0.5) * 0.00006,
        sy: (Math.random() - 0.5) * 0.00005,
        hue: Math.random() > 0.55 ? '27,147,199' : '242,210,118'
      });
    }

    wc.addEventListener('pointerdown', e => {
      const r = wc.getBoundingClientRect();
      ripples.push({ x: e.clientX - r.left, y: e.clientY - r.top, t: 0 });
    });

    let last = 0;
    function frame(ts) {
      requestAnimationFrame(frame);
      if (ts - last < 33) return;
      const dt = Math.min(60, ts - (last || ts)); last = ts;

      ctx.clearRect(0, 0, W, H);

      blobs.forEach(b => {
        b.x += b.sx * dt; b.y += b.sy * dt;
        if (b.x < -0.3) b.x = 1.3; if (b.x > 1.3) b.x = -0.3;
        if (b.y < -0.3) b.y = 1.3; if (b.y > 1.3) b.y = -0.3;
        const cx = b.x * W, cy = b.y * H, rad = b.r * Math.max(W, H);
        const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, rad);
        g.addColorStop(0, 'rgba(' + b.hue + ',' + b.a + ')');
        g.addColorStop(0.55, 'rgba(' + b.hue + ',' + (b.a * 0.24) + ')');
        g.addColorStop(1, 'rgba(' + b.hue + ',0)');
        ctx.fillStyle = g;
        ctx.fillRect(cx - rad, cy - rad, rad * 2, rad * 2);
      });

      for (let i = ripples.length - 1; i >= 0; i--) {
        const rp = ripples[i];
        rp.t += dt / 1600;
        if (rp.t >= 1) { ripples.splice(i, 1); continue; }
        const rad = 12 + rp.t * 260;
        ctx.beginPath();
        ctx.arc(rp.x, rp.y, rad, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(27,147,199,' + (0.20 * (1 - rp.t)) + ')';
        ctx.lineWidth = 1.1;
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(rp.x, rp.y, rad * 0.62, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(27,147,199,' + (0.12 * (1 - rp.t)) + ')';
        ctx.stroke();
      }
    }
    requestAnimationFrame(frame);
  }

  onScroll();
})();
