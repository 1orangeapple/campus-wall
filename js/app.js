/* ===========================================================
   霞浦三小校园墙 · 前台交互
   =========================================================== */

(function () {
  'use strict';

  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.prototype.slice.call((root || document).querySelectorAll(sel));

  /* ---------------- 工具 ---------------- */

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function timeAgo(iso) {
    const t = new Date(iso).getTime();
    if (!t) return '';
    const diff = Date.now() - t;
    const m = Math.floor(diff / 60000);
    if (m < 1) return '刚刚';
    if (m < 60) return m + ' 分钟前';
    const h = Math.floor(m / 60);
    if (h < 24) return h + ' 小时前';
    const d = Math.floor(h / 24);
    if (d === 1) return '昨天 ' + fmtTime(t, 'HH:mm');
    if (d < 7) return d + ' 天前';
    return fmtTime(t, 'M月D日');
  }

  function fmtTime(ms, fmt) {
    const d = new Date(ms);
    const pad = n => (n < 10 ? '0' + n : '' + n);
    if (fmt === 'HH:mm') return pad(d.getHours()) + ':' + pad(d.getMinutes());
    return (d.getMonth() + 1) + '月' + d.getDate() + '日';
  }

  const AVATAR_GRADIENTS = [
    ['#f7a34a', '#e85d3d'],
    ['#4fc3c9', '#2c9aa8'],
    ['#7f8ce0', '#5560c4'],
    ['#f08aa0', '#d95c7c'],
    ['#8ac97f', '#4f9e52'],
    ['#e8b44a', '#c98f1e'],
    ['#a98ed8', '#7f5fbd'],
    ['#7fb8e8', '#3f7fbd']
  ];

  function hashStr(s) {
    let h = 0;
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
    return Math.abs(h);
  }

  function avatarStyle(name) {
    const g = AVATAR_GRADIENTS[hashStr(name || '匿名') % AVATAR_GRADIENTS.length];
    return 'background:linear-gradient(145deg,' + g[0] + ',' + g[1] + ')';
  }

  function initial(name) {
    const n = (name || '匿').trim();
    return n.charAt(0).toUpperCase();
  }

  /* ---------------- toast ---------------- */

  const toastStack = $('#toastStack');
  function toast(msg, type, ms) {
    const el = document.createElement('div');
    el.className = 'toast' + (type ? ' ' + type : '');
    el.textContent = msg;
    toastStack.appendChild(el);
    setTimeout(function () {
      el.classList.add('out');
      setTimeout(() => el.remove(), 320);
    }, ms || 2600);
  }

  /* ---------------- 图标 ---------------- */

  const ICON_HEART = '<svg class="like-heart" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M20.4 5.6a5.1 5.1 0 0 0-7.2 0L12 6.8l-1.2-1.2a5.1 5.1 0 0 0-7.2 7.2l8.4 8.4 8.4-8.4a5.1 5.1 0 0 0 0-7.2z"/></svg>';
  const ICON_CHAT = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M20.5 12c0 4.1-3.8 7.4-8.5 7.4-1 0-2-.15-2.9-.42L4.5 20.5l1.3-3.8C4.4 15.4 3.5 13.8 3.5 12c0-4.1 3.8-7.4 8.5-7.4s8.5 3.3 8.5 7.4z"/></svg>';
  const ICON_LOCK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="16" height="16"><rect x="4" y="10.5" width="16" height="10" rx="2.5"/><path d="M8 10.5V7a4 4 0 0 1 8 0v3.5"/></svg>';

  /* ---------------- 状态 ---------------- */

  let posts = [];
  let sortMode = 'new';
  let loading = false;

  /* ---------------- 渲染 ---------------- */

  const feed = $('#feed');

  function renderPost(p) {
    const el = document.createElement('article');
    el.className = 'post';
    el.dataset.id = p.id;

    const imgHtml = p.image_url
      ? '<img class="post-img" src="' + escapeHtml(p.image_url) + '" alt="帖子配图" loading="lazy" data-zoom="' + escapeHtml(p.image_url) + '">'
      : '';

    el.innerHTML =
      '<div class="post-head">' +
        '<div class="avatar" style="' + avatarStyle(p.nickname) + '">' + escapeHtml(initial(p.nickname)) + '</div>' +
        '<div class="post-meta">' +
          '<div class="name">' + escapeHtml(p.nickname || '匿名同学') + '</div>' +
          '<div class="time">' + timeAgo(p.created_at) + '</div>' +
        '</div>' +
      '</div>' +
      '<div class="post-body">' + escapeHtml(p.content) + '</div>' +
      imgHtml +
      '<div class="post-actions">' +
        '<button class="act like-btn' + (p.liked_by_me ? ' liked' : '') + '" data-id="' + escapeHtml(p.id) + '">' +
          ICON_HEART + '<span class="like-num">' + (p.like_count || 0) + '</span>' +
        '</button>' +
        '<button class="act cmt-btn" data-id="' + escapeHtml(p.id) + '">' +
          ICON_CHAT + '<span class="cmt-num">' + (p.comment_count || 0) + '</span>' +
        '</button>' +
      '</div>' +
      '<div class="comments" data-for="' + escapeHtml(p.id) + '">' +
        '<div class="comment-list"></div>' +
        '<div class="comment-form">' +
          '<input type="text" class="cmt-input" maxlength="300" placeholder="说点什么…" autocomplete="off">' +
          '<button class="comment-send">发送</button>' +
        '</div>' +
      '</div>';

    return el;
  }

  function renderFeed() {
    if (!posts.length) {
      feed.innerHTML =
        '<div class="empty">' +
          '<span class="emoji">🌾</span>' +
          '<p>墙上还空着，等你写下第一句话</p>' +
          '<small>发出去的帖子要等管理员审核通过才会出现</small>' +
        '</div>';
      return;
    }
    const frag = document.createDocumentFragment();
    posts.forEach(function (p, i) {
      const el = renderPost(p);
      el.style.animationDelay = Math.min(i * 40, 320) + 'ms';
      frag.appendChild(el);
    });
    feed.innerHTML = '';
    feed.appendChild(frag);
  }

  function renderStats() {
    const likes = posts.reduce((s, p) => s + (p.like_count || 0), 0);
    const cmts = posts.reduce((s, p) => s + (p.comment_count || 0), 0);
    animateNum($('#statPosts'), posts.length);
    animateNum($('#statLikes'), likes);
    animateNum($('#statComments'), cmts);
    $('#countChip').textContent = posts.length ? posts.length + ' 条在墙上' : '';
  }

  function animateNum(el, target) {
    if (!el) return;
    const from = parseInt(el.textContent, 10) || 0;
    if (from === target) { el.textContent = target; return; }
    const start = performance.now();
    const dur = 520;
    function step(now) {
      const k = Math.min(1, (now - start) / dur);
      const e = 1 - Math.pow(1 - k, 3);
      el.textContent = Math.round(from + (target - from) * e);
      if (k < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  }

  /* ---------------- 加载 ---------------- */

  async function loadPosts(showSkeleton) {
    if (loading) return;
    loading = true;
    const btn = $('#btnRefresh');
    btn.classList.add('spin');

    if (showSkeleton && !posts.length) {
      feed.innerHTML =
        '<div class="skel"><div class="skel-line" style="width:38%"></div><div class="skel-line" style="width:92%"></div><div class="skel-line" style="width:71%"></div></div>' +
        '<div class="skel"><div class="skel-line" style="width:30%"></div><div class="skel-line" style="width:86%"></div></div>';
    }

    try {
      posts = await window.Wall.listPosts(sortMode);
      renderFeed();
      renderStats();
    } catch (err) {
      feed.innerHTML =
        '<div class="empty"><span class="emoji">😵</span><p>加载失败了</p><small>' +
        escapeHtml(err.message || '请检查网络后重试') + '</small></div>';
    } finally {
      loading = false;
      setTimeout(() => btn.classList.remove('spin'), 400);
    }
  }

  /* ---------------- 交互：点赞 ---------------- */

  feed.addEventListener('click', async function (e) {
    const likeBtn = e.target.closest('.like-btn');
    if (likeBtn) {
      e.preventDefault();
      const id = likeBtn.dataset.id;
      if (likeBtn.dataset.busy === '1') return;
      likeBtn.dataset.busy = '1';

      const numEl = likeBtn.querySelector('.like-num');
      const wasLiked = likeBtn.classList.contains('liked');
      const oldNum = parseInt(numEl.textContent, 10) || 0;

      // 乐观更新
      likeBtn.classList.toggle('liked', !wasLiked);
      numEl.textContent = Math.max(0, oldNum + (wasLiked ? -1 : 1));

      try {
        const res = await window.Wall.toggleLike(id);
        likeBtn.classList.toggle('liked', res.liked);
        numEl.textContent = res.like_count;
        const p = posts.find(x => x.id === id);
        if (p) { p.like_count = res.like_count; p.liked_by_me = res.liked; }
        renderStats();
      } catch (err) {
        likeBtn.classList.toggle('liked', wasLiked);
        numEl.textContent = oldNum;
        toast(err.message || '点赞失败了', 'err');
      } finally {
        setTimeout(() => { likeBtn.dataset.busy = '0'; }, 350);
      }
      return;
    }

    // 评论面板开关
    const cmtBtn = e.target.closest('.cmt-btn');
    if (cmtBtn) {
      const id = cmtBtn.dataset.id;
      const panel = feed.querySelector('.comments[data-for="' + cssEscape(id) + '"]');
      if (!panel) return;
      const opening = !panel.classList.contains('open');
      panel.classList.toggle('open', opening);
      if (opening) {
        if (!panel.dataset.loaded) await loadComments(id, panel);
        const input = panel.querySelector('.cmt-input');
        if (input && window.innerWidth > 640) setTimeout(() => input.focus(), 120);
      }
      return;
    }

    // 发评论
    const sendBtn = e.target.closest('.comment-send');
    if (sendBtn) {
      const panel = sendBtn.closest('.comments');
      const input = panel.querySelector('.cmt-input');
      const text = (input.value || '').trim();
      if (!text) { input.focus(); return; }
      if (sendBtn.disabled) return;
      sendBtn.disabled = true;
      sendBtn.textContent = '…';

      try {
        const row = await window.Wall.addComment(panel.dataset.for, '', text);
        input.value = '';
        appendComment(panel.querySelector('.comment-list'), row, true);
        bumpCommentCount(panel.dataset.for, 1);
        renderStats();
      } catch (err) {
        toast(err.message || '评论失败', 'err');
      } finally {
        sendBtn.disabled = false;
        sendBtn.textContent = '发送';
      }
      return;
    }

    // 看大图
    const img = e.target.closest('[data-zoom]');
    if (img) {
      openLightbox(img.dataset.zoom);
    }
  });

  feed.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && e.target.classList.contains('cmt-input')) {
      e.preventDefault();
      const panel = e.target.closest('.comments');
      panel.querySelector('.comment-send').click();
    }
  });

  function cssEscape(s) {
    return String(s).replace(/"/g, '\\"');
  }

  function bumpCommentCount(postId, delta) {
    const p = posts.find(x => x.id === postId);
    if (p) p.comment_count = Math.max(0, (p.comment_count || 0) + delta);
    const el = feed.querySelector('.post[data-id="' + cssEscape(postId) + '"] .cmt-num');
    if (el) el.textContent = p ? p.comment_count : el.textContent;
  }

  /* ---------------- 评论 ---------------- */

  async function loadComments(postId, panel) {
    const listEl = panel.querySelector('.comment-list');
    listEl.innerHTML = '<div class="comment-empty">加载中…</div>';
    try {
      const rows = await window.Wall.listComments(postId);
      listEl.innerHTML = '';
      if (!rows.length) {
        listEl.innerHTML = '<div class="comment-empty">还没有人评论，来坐第一排</div>';
      } else {
        rows.forEach(r => appendComment(listEl, r, false));
      }
      panel.dataset.loaded = '1';
    } catch (err) {
      listEl.innerHTML = '<div class="comment-empty">' + escapeHtml(err.message || '评论加载失败') + '</div>';
    }
  }

  function appendComment(listEl, row, appendToEnd) {
    const empty = listEl.querySelector('.comment-empty');
    if (empty) empty.remove();

    const el = document.createElement('div');
    el.className = 'comment';
    el.innerHTML =
      '<div class="c-av" style="' + avatarStyle(row.nickname) + '">' + escapeHtml(initial(row.nickname)) + '</div>' +
      '<div class="c-main">' +
        '<span class="c-name">' + escapeHtml(row.nickname || '匿名同学') + '</span>' +
        '<span class="c-time">' + timeAgo(row.created_at) + '</span>' +
        '<div class="c-text">' + escapeHtml(row.content) + '</div>' +
      '</div>';

    if (appendToEnd) {
      listEl.appendChild(el);
      el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    } else {
      listEl.appendChild(el);
    }
  }

  /* ---------------- 大图 ---------------- */

  const lightbox = $('#lightbox');
  const lightboxImg = $('#lightboxImg');
  function openLightbox(url) {
    if (!url) return;
    lightboxImg.src = url;
    lightbox.classList.add('open');
  }
  lightbox.addEventListener('click', function () {
    lightbox.classList.remove('open');
    setTimeout(() => { lightboxImg.src = ''; }, 260);
  });

  /* ---------------- 发布弹窗 ---------------- */

  const composer = $('#composer');
  const inpNick = $('#inpNick');
  const inpContent = $('#inpContent');
  const counter = $('#counter');
  const fileInput = $('#fileInput');
  const uploadTile = $('#uploadTile');
  const uploaderInfo = $('#uploaderInfo');
  const btnSubmit = $('#btnSubmit');

  let pickedFile = null;   // 原始 File
  let pickedBlob = null;   // 压缩后的 Blob
  let pickedPreview = null;

  function openComposer() {
    composer.classList.add('open');
    document.body.style.overflow = 'hidden';
    if (window.innerWidth > 640) setTimeout(() => inpContent.focus(), 320);
  }

  function closeComposer() {
    composer.classList.remove('open');
    document.body.style.overflow = '';
  }

  $('#btnCompose').addEventListener('click', openComposer);
  $('#btnCancel').addEventListener('click', closeComposer);
  composer.addEventListener('click', function (e) {
    if (e.target === composer) closeComposer();
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && composer.classList.contains('open')) closeComposer();
  });

  inpContent.addEventListener('input', function () {
    const n = inpContent.value.length;
    counter.textContent = n + ' / 1000';
    counter.classList.toggle('over', n > 950);
  });

  // 记住上次用的昵称
  try {
    const saved = localStorage.getItem('campuswall_nick');
    if (saved) inpNick.value = saved;
  } catch (e) {}

  /* --- 选图 --- */
  uploadTile.addEventListener('click', () => fileInput.click());

  fileInput.addEventListener('change', async function () {
    const f = fileInput.files && fileInput.files[0];
    if (!f) return;
    if (f.size > 10 * 1024 * 1024) {
      toast('图片太大了，请选 10MB 以内的', 'err');
      fileInput.value = '';
      return;
    }
    uploaderInfo.textContent = '正在压缩…';
    try {
      const blob = await window.Wall.compressImage(f, 1600, 0.82);
      if (pickedPreview) URL.revokeObjectURL(pickedPreview);
      pickedFile = f;
      pickedBlob = blob;
      pickedPreview = URL.createObjectURL(blob);
      uploadTile.classList.add('has-img');
      uploadTile.style.backgroundImage = 'url("' + pickedPreview + '")';
      uploaderInfo.innerHTML = '已选好（约 ' + Math.round(blob.size / 1024) + ' KB） · <span class="rm" id="rmImg">移除</span>';
      const rm = $('#rmImg');
      if (rm) rm.addEventListener('click', clearImage);
    } catch (err) {
      toast(err.message || '图片处理失败', 'err');
      uploaderInfo.textContent = '支持 jpg / png，会自动压缩，单张不超过 10MB。';
    }
    fileInput.value = '';
  });

  function clearImage() {
    if (pickedPreview) URL.revokeObjectURL(pickedPreview);
    pickedFile = null; pickedBlob = null; pickedPreview = null;
    uploadTile.classList.remove('has-img');
    uploadTile.style.backgroundImage = '';
    uploaderInfo.textContent = '支持 jpg / png，会自动压缩，单张不超过 10MB。';
  }

  /* --- 提交 --- */
  btnSubmit.addEventListener('click', async function () {
    const content = (inpContent.value || '').trim();
    if (content.length < 2) {
      toast('再多写几个字吧', 'err');
      inpContent.focus();
      return;
    }
    const nickname = (inpNick.value || '').trim();

    btnSubmit.disabled = true;
    const originalHtml = btnSubmit.innerHTML;
    btnSubmit.innerHTML = '<span class="spin-dot"></span> 提交中';

    try {
      await window.Wall.submitPost({ nickname, content, imageBlob: pickedBlob });
      try { localStorage.setItem('campuswall_nick', nickname); } catch (e) {}
      closeComposer();
      inpContent.value = '';
      counter.textContent = '0 / 1000';
      clearImage();
      toast('已提交，等管理员审核通过就能看到啦 ✓', 'ok', 3400);
    } catch (err) {
      toast(err.message || '提交失败，请稍后再试', 'err', 3600);
    } finally {
      btnSubmit.disabled = false;
      btnSubmit.innerHTML = originalHtml;
    }
  });

  /* ---------------- 排序 / 刷新 ---------------- */

  $$('.tab').forEach(function (tab) {
    tab.addEventListener('click', function () {
      if (tab.dataset.sort === sortMode) return;
      $$('.tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      sortMode = tab.dataset.sort;
      posts = [];
      loadPosts(true);
    });
  });

  $('#btnRefresh').addEventListener('click', function () {
    loadPosts(false);
    toast('已刷新');
  });

  /* 顶栏滚动阴影 */
  const head = $('#siteHead');
  window.addEventListener('scroll', function () {
    head.classList.toggle('is-stuck', window.scrollY > 8);
  }, { passive: true });

  /* 回到前台时静默刷新 */
  document.addEventListener('visibilitychange', function () {
    if (!document.hidden && posts.length) loadPosts(false);
  });

  /* ---------------- 启动 ---------------- */

  if (!window.Wall.ready) {
    $('#demoBar').classList.add('show');
  }

  loadPosts(true);
})();
