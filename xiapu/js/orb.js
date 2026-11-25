/* ============================================================
   校标 · 随页面流转
   · 校标：同一张矢量图分层堆叠，做出真实厚度
   · 化水：密度场（metaball）+ 法线光照，渲染成流动的水体
            而不是一堆点
   ============================================================ */
(function () {
  'use strict';

  const mark = document.getElementById('orbMark');
  const stack = document.getElementById('orbStack');
  const heroStage = document.getElementById('heroStage');
  const frame = document.getElementById('orbFrame');
  const fluid = document.getElementById('fluidCanvas');
  const hint = document.getElementById('emblemHint');
  if (!mark || !stack || !heroStage) return;

  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const smooth = t => t * t * (3 - 2 * t);
  const easeIO = t => t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
  const mix = (a, b, t) => a + (b - a) * t;

  const MARK_W = 320, MARK_H = 285;

  /* ---------- 分层厚度 ---------- */
  const LAYERS = 13, DEPTH = 1.6;
  for (let i = LAYERS - 1; i >= 0; i--) {
    const img = document.createElement('img');
    img.src = 'media/mark.svg';
    img.alt = '';
    const k = i / (LAYERS - 1);
    img.style.transform = 'translateZ(' + (-i * DEPTH).toFixed(2) + 'px)';
    img.style.filter = 'brightness(' + (1 - k * 0.44).toFixed(3) + ') saturate(' + (1 - k * 0.25).toFixed(2) + ')';
    stack.appendChild(img);
  }

  /* ---------- 从校标取轮廓，作为水体的出生点 ---------- */
  let spawn = [];
  const SAMPLE = 220;
  const tmp = document.createElement('canvas');
  const tctx = tmp.getContext('2d', { willReadFrequently: true });
  const src = new Image();
  src.onload = () => {
    const ratio = src.naturalHeight / src.naturalWidth || 0.89;
    tmp.width = SAMPLE;
    tmp.height = Math.round(SAMPLE * ratio);
    tctx.drawImage(src, 0, 0, tmp.width, tmp.height);
    let data;
    try { data = tctx.getImageData(0, 0, tmp.width, tmp.height).data; }
    catch (e) { return; }

    const pts = [];
    for (let y = 0; y < tmp.height; y += 4) {
      for (let x = 0; x < tmp.width; x += 4) {
        if (data[(y * tmp.width + x) * 4 + 3] < 150) continue;
        pts.push([x / tmp.width, y / tmp.height]);
      }
    }
    if (!pts.length) return;
    // 均匀抽 26 个点，代表校标的分布
    const need = 26;
    for (let i = 0; i < need; i++) {
      const p = pts[Math.floor(i * pts.length / need)];
      spawn.push([p[0], p[1]]);
    }
  };
  src.src = 'media/mark.svg';

  /* ---------- 莫比乌斯水带 ----------
     参数曲面 (u,v) -> 3D，倾斜投影后逐片排序上色，
     用漫反射 + 高光 + 菲涅尔做出通透的水感。 */
  const fctx = fluid ? fluid.getContext('2d') : null;
  const DPR = Math.min(devicePixelRatio || 1, 2);
  const OFF = 560;
  // 离屏画布：面片以不透明度绘制，避免半透明叠加出现网格
  const off = document.createElement('canvas');
  off.width = OFF; off.height = OFF;
  const octx = off.getContext('2d');
  if (fluid) {
    fluid.width = Math.round(279 * DPR);
    fluid.height = Math.round(279 * DPR);
  }

  const U = 132, V = 8;                // 沿环 / 带宽方向的分段
  const PX = new Float32Array((U + 1) * (V + 1) * 3);   // 投影后的 x,y
  const PZ = new Float32Array((U + 1) * (V + 1));       // 深度
  const order = new Float32Array(U * V);
  const orderIdx = new Uint16Array(U * V);

  function renderMobius(g, W, H, now, t, alpha) {
    const o = octx;
    o.clearRect(0, 0, W, H);
    const TAU = Math.PI * 2;
    const R = 1, BW = 0.30;                 // 环半径 / 半带宽
    const tilt = -0.95 + Math.sin(now * 0.00028) * 0.10;
    const spin = now * 0.00020;
    const S = Math.min(W, H) * 0.205 * (0.56 + 0.44 * Math.pow(t, 0.8));   // 由小长成环
    const cx = W / 2, cy = H / 2;
    const st = Math.sin(tilt), ct = Math.cos(tilt);
    const rippleA = 0.05 * t;

    // 顶点
    for (let i = 0; i <= U; i++) {
      const u = (i / U) * TAU + spin;
      const cu = Math.cos(u), su = Math.sin(u);
      const h = u * 0.5;
      const ch = Math.cos(h), sh = Math.sin(h);
      for (let j = 0; j <= V; j++) {
        const v = ((j / V) * 2 - 1) * BW;
        // 水面起伏：沿带面做流动波纹
        const rip = rippleA * Math.sin(u * 4.0 + now * 0.0016 + v * 6.0);
        const r = R + (v + rip) * ch;
        let x = r * cu;
        let y = r * su;
        let z = (v + rip) * sh * 1.25;

        // 倾斜
        const y2 = y * ct - z * st;
        const z2 = y * st + z * ct;
        // 轻微透视
        const k = 2.9 / (2.9 - z2 * 0.55);
        const idx = (i * (V + 1) + j);
        PX[idx * 3] = cx + x * k * S;
        PX[idx * 3 + 1] = cy + y2 * k * S;
        PZ[idx] = z2;
      }
    }

    // 面片排序（远 → 近），保证遮挡正确
    for (let i = 0; i < U; i++) {
      for (let j = 0; j < V; j++) {
        const a = i * (V + 1) + j, b = (i + 1) * (V + 1) + j;
        const zz = (PZ[a] + PZ[b] + PZ[a + 1] + PZ[b + 1]) * 0.25;
        orderIdx[i * V + j] = i * V + j;
        order[i * V + j] = zz;
      }
    }
    const arr = Array.from(orderIdx).sort((m, n) => order[m] - order[n]);

    const Lx = -0.42, Ly = -0.55, Lz = 0.72;
    const Hx = Lx, Hy = Ly, Hz = Lz + 1;      // 半程向量
    const hl = Math.hypot(Hx, Hy, Hz);

    g.clearRect(0, 0, W, H);
    if (alpha <= 0.004) return;

    // 背后的柔光
    const glow = g.createRadialGradient(cx, cy, S * 0.15, cx, cy, S * 1.55);
    glow.addColorStop(0, 'rgba(176,222,245,' + (0.42 * alpha).toFixed(3) + ')');
    glow.addColorStop(0.55, 'rgba(196,230,246,' + (0.16 * alpha).toFixed(3) + ')');
    glow.addColorStop(1, 'rgba(220,240,250,0)');
    g.fillStyle = glow;
    g.fillRect(0, 0, W, H);

    for (let n = 0; n < arr.length; n++) {
      const idx = arr[n];
      const i = (idx / V) | 0, j = idx % V;
      const a = i * (V + 1) + j;
      const b = (i + 1) * (V + 1) + j;
      const x0 = PX[a * 3], y0 = PX[a * 3 + 1];
      const x1 = PX[b * 3], y1 = PX[b * 3 + 1];
      const x2 = PX[(a + 1) * 3], y2 = PX[(a + 1) * 3 + 1];
      const x3 = PX[(b + 1) * 3], y3 = PX[(b + 1) * 3 + 1];

      // 法线
      const ax = x1 - x0, ay = y1 - y0, az = PZ[b] - PZ[a];
      const bx = x2 - x0, by = y2 - y0, bz = PZ[a + 1] - PZ[a];
      let nx = ay * bz - az * by;
      let ny = az * bx - ax * bz;
      let nz = ax * by - ay * bx;
      const len = Math.hypot(nx, ny, nz) || 1;
      nx /= len; ny /= len; nz /= len;
      if (nz < 0) { nx = -nx; ny = -ny; nz = -nz; }

      const facing = Math.abs(nz);
      const diff = Math.max(0, nx * Lx + ny * Ly + nz * Lz);
      const spec = Math.pow(Math.max(0, (nx * Hx + ny * Hy + nz * Hz) / hl), 30);
      const fres = Math.pow(1 - facing, 2.4);

      // 淡蓝水体：漫反射定调，厚度压暗，窄高光提亮
      const lit = clamp(diff, 0, 1);
      const shade = 0.80 + 0.20 * facing;          // 越接近侧边越暗（水的厚度）
      let r = (74 + lit * 92) * shade;
      let gg = (136 + lit * 74) * shade;
      let bb = (178 + lit * 52) * shade;
      // 沿环流动的一道柔光
      const sheen = Math.pow(Math.max(0, Math.sin(now * 0.0009 + i * 0.16)), 8);
      r += spec * 92 + fres * 16 + sheen * 26;
      gg += spec * 88 + fres * 14 + sheen * 24;
      bb += spec * 70 + fres * 10 + sheen * 18;

      const col = 'rgb(' + (r | 0) + ',' + (gg | 0) + ',' + (bb | 0) + ')';
      o.fillStyle = col;
      o.strokeStyle = col;
      o.lineWidth = 1.4;

      o.beginPath();
      o.moveTo(x0, y0);
      o.lineTo(x1, y1);
      o.lineTo(x3, y3);
      o.lineTo(x2, y2);
      o.closePath();
      o.fill();
      o.stroke();
    }

    // 整体贴回，统一控制通透度
    g.save();
    g.globalAlpha = (0.92 * alpha).toFixed(3);
    g.drawImage(off, 0, 0);
    g.restore();
  }

  /* ---------- 目标 ---------- */
  let vw = 0, vh = 0;
  function resize() {
    vw = innerWidth; vh = innerHeight;
  }
  resize();
  addEventListener('resize', resize);

  function heroTarget() {
    const r = heroStage.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2, s: Math.min(r.width, r.height) * 0.88 / MARK_W };
  }
  function dockTarget() {
    const narrow = vw < 760;
    return narrow
      ? { x: 56, y: vh - 86, s: Math.min(78, vw * 0.21) / MARK_W }   // 手机停在左下角，避开正文
      : { x: vw - 112, y: 152, s: Math.min(158, vw * 0.12) / MARK_W };
  }
  function frameTarget() {
    if (!frame) return null;
    const r = frame.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2, size: Math.min(r.width, r.height) };
  }

  const water = document.getElementById('water');

  let last = 0, nowT = performance.now(), spin = 0, lastY = 0, curX = 0, curY = 0, curS = 1, init = false;

  function tick(now) {
    if (now - last < 24) return;
    last = now;

    const y = scrollY;
    const wy = water ? water.offsetTop : 1e9;

    const dockP = easeIO(clamp((y - vh * 0.06) / (vh * 0.80), 0, 1));
    // 水段吸附之后，校标才从角落滑到画面中央（保证整个过程在屏幕内）
    const centerP = easeIO(clamp((y - (wy - vh * 0.04)) / (vh * 0.52), 0, 1));
    const melt = smooth(clamp((y - (wy + vh * 0.42)) / (vh * 1.05), 0, 1));
    const leave = clamp((y - (wy + vh * 1.72)) / (vh * 0.42), 0, 1);

    const h = heroTarget();
    const d = dockTarget();
    let tx = mix(h.x, d.x, dockP);
    let ty = mix(h.y, d.y, dockP);
    let ts = mix(h.s, d.s, dockP);

    const f = frameTarget();
    if (f) {
      tx = mix(tx, f.x, centerP);
      ty = mix(ty, f.y, centerP);
      ts = mix(ts, (f.size * 0.66) / MARK_W, centerP);
    }

    // 按真实时间衰减：即使定时器被节流到 2Hz，也能在几十毫秒的等效时间内收敛
    const dt = Math.min(0.5, (now - nowT) / 1000);
    nowT = now;
    const k = 1 - Math.exp(-dt * 13);
    if (!init) { curX = tx; curY = ty; curS = ts; init = true; }
    curX += (tx - curX) * k;
    curY += (ty - curY) * k;
    curS += (ts - curS) * k;

    mark.style.transform =
      'translate3d(' + (curX - MARK_W / 2).toFixed(1) + 'px,' +
      (curY - MARK_H / 2).toFixed(1) + 'px,0) scale(' + curS.toFixed(4) + ')';
    // 校标溶掉的同时水已经涌出，两者有重叠，读起来才是「变成水」
    mark.style.opacity = (1 - smooth(clamp((melt - 0.44) / 0.18, 0, 1))).toFixed(3);

    const vy = y - lastY; lastY = y;
    spin = clamp(spin + vy * 0.0006, -0.9, 0.9);
    spin *= Math.pow(0.94, Math.max(1, dt * 60));
    stack.style.transform =
      'rotateX(' + (5 - dockP * 3 + Math.sin(now * 0.0005) * 2.4).toFixed(2) + 'deg) rotateY(' +
      (-16 - dockP * 8 + spin * 26).toFixed(2) + 'deg)';

    // 水体
    if (fluid) {
      const inView = f && Math.abs(f.y - vh / 2) < vh * 0.9;
      const fAlpha = smooth(clamp((melt - 0.26) / 0.18, 0, 1)) * (1 - leave);
      if (inView && fAlpha > 0.005 && fctx) {
        renderMobius(fctx, fluid.width, fluid.height, now, smooth(clamp((melt - 0.24) / 0.44, 0, 1)), fAlpha);
        fluid.style.opacity = '1';
      } else {
        fluid.style.opacity = '0';
      }
    }

    if (frame) frame.style.opacity = smooth(clamp((melt - 0.06) / 0.34, 0, 1)).toFixed(3);
    document.body.classList.toggle('is-liquid', melt > 0.55);
    if (hint) hint.style.opacity = dockP > 0.2 ? '0' : '';
  }

  setInterval(() => tick(performance.now()), 24);
  tick(performance.now());

  /* ---------- 首屏拖动 ---------- */
  let drag = false, px = 0;
  addEventListener('pointerdown', e => {
    if (scrollY > vh * 0.35) return;
    const r = heroStage.getBoundingClientRect();
    if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) return;
    drag = true; px = e.clientX;
    if (hint) hint.style.opacity = '0';
  });
  addEventListener('pointermove', e => {
    if (!drag) return;
    const dx = e.clientX - px;
    px = e.clientX;
    spin = clamp(spin + dx * 0.004, -1.4, 1.4);
    lastY = scrollY + dx * 0.6;
  }, { passive: true });
  addEventListener('pointerup', () => { drag = false; });
})();
