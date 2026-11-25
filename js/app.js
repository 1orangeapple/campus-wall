/* ===========================================================
   霞浦三小校园墙 · 前台交互 v2
   - 15 秒静默刷新（增量更新，不打断正在看的内容）
   - 点头像加好友 / 发消息
   - 消息实时提醒
   =========================================================== */

(function () {
  'use strict';

  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.prototype.slice.call((root || document).querySelectorAll(sel));

  /* ---------------- 工具 ---------------- */

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function timeAgo(iso) {
    const t = new Date(iso).getTime();
    if (!t) return '';
    const m = Math.floor((Date.now() - t) / 60000);
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

  const GRADIENTS = [
    ['#f7a34a', '#e85d3d'], ['#4fc3c9', '#2c9aa8'], ['#7f8ce0', '#5560c4'],
    ['#f08aa0', '#d95c7c'], ['#8ac97f', '#4f9e52'], ['#e8b44a', '#c98f1e'],
    ['#a98ed8', '#7f5fbd'], ['#7fb8e8', '#3f7fbd']
  ];

  function hashStr(s) {
    let h = 0;
    const str = String(s || '匿');
    for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) | 0;
    return Math.abs(h);
  }

  function gradOf(name) {
    const g = GRADIENTS[hashStr(name) % GRADIENTS.length];
    return 'background:linear-gradient(145deg,' + g[0] + ',' + g[1] + ')';
  }

  function avatarInner(name, emoji) {
    if (emoji) return esc(emoji);
    const n = (name || '匿').trim();
    return esc(n.charAt(0).toUpperCase());
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
  const ICON_PIN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="13" height="13"><path d="M9.5 3.5h5l-.8 5.2 3.3 3.4H7l3.3-3.4z"/><path d="M12 12.1V21"/></svg>';

  /* ---------------- 状态 ---------------- */

  let posts = [];              // 当前列表
  let authors = {};            // author_id -> profile
  let sortMode = 'new';
  let loading = false;
  let pollTimer = null;
  let lastSignature = '';      // 用 id 顺序判断结构是否变化
  const openComments = new Set();

  /* ---------------- 渲染 ---------------- */

  const feed = $('#feed');

  function authorOf(p) {
    if (!p || !p.author_id || p.is_anonymous) return null;
    return authors[p.author_id] || null;
  }

  function renderPost(p) {
    const el = document.createElement('article');
    el.className = 'post' + (p.is_pinned ? ' pinned' : '');
    el.dataset.id = p.id;

    const au = authorOf(p);
    const clickable = au ? ' clickable' : '';
    const emoji = au ? au.avatar : '';
    const shownName = p.is_anonymous ? '匿名同学' : (au && au.nickname ? au.nickname : p.nickname);

    const imgHtml = p.image_url
      ? '<img class="post-img" src="' + esc(p.image_url) + '" alt="帖子配图" loading="lazy" data-zoom="' + esc(p.image_url) + '">'
      : '';

    const pinHtml = p.is_pinned
      ? '<span class="pin-tag">' + ICON_PIN + ' 置顶</span>'
      : '';

    el.innerHTML =
      (p.is_pinned ? '' : '') +
      '<div class="post-head">' +
        '<div class="avatar' + clickable + '" style="' + gradOf(shownName) + '"' +
          (au ? ' data-uid="' + esc(p.author_id) + '"' : '') + '>' + avatarInner(shownName, emoji) + '</div>' +
        '<div class="post-meta">' +
          '<div class="name">' + esc(shownName) + pinHtml + '</div>' +
          '<div class="time">' + timeAgo(p.created_at) + '</div>' +
        '</div>' +
      '</div>' +
      '<div class="post-body">' + esc(p.content) + '</div>' +
      imgHtml +
      '<div class="post-actions">' +
        '<button class="act like-btn' + (p.liked_by_me ? ' liked' : '') + '" data-id="' + esc(p.id) + '">' +
          ICON_HEART + '<span class="like-num">' + (p.like_count || 0) + '</span>' +
        '</button>' +
        '<button class="act cmt-btn" data-id="' + esc(p.id) + '">' +
          ICON_CHAT + '<span class="cmt-num">' + (p.comment_count || 0) + '</span>' +
        '</button>' +
      '</div>' +
      '<div class="comments" data-for="' + esc(p.id) + '">' +
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
      lastSignature = '';
      return;
    }

    const sig = posts.map(p => p.id).join(',');
    const keepOpen = Array.from(openComments);

    const frag = document.createDocumentFragment();
    posts.forEach(function (p, i) {
      const el = renderPost(p);
      el.style.animationDelay = Math.min(i * 40, 320) + 'ms';
      frag.appendChild(el);
    });
    feed.innerHTML = '';
    feed.appendChild(frag);
    lastSignature = sig;

    // 恢复之前展开的评论
    keepOpen.forEach(function (id) {
      const panel = feed.querySelector('.comments[data-for="' + cssEsc(id) + '"]');
      if (panel) {
        panel.classList.add('open');
        loadComments(id, panel);
      }
    });
  }

  /** 只更新数字，不重建 DOM —— 轮询用这个，绝不打断用户 */
  function patchNumbers() {
    posts.forEach(function (p) {
      const card = feed.querySelector('.post[data-id="' + cssEsc(p.id) + '"]');
      if (!card) return;
      const likeEl = card.querySelector('.like-num');
      const cmtEl = card.querySelector('.cmt-num');
      if (likeEl && likeEl.textContent !== String(p.like_count || 0)) {
        likeEl.textContent = p.like_count || 0;
      }
      if (cmtEl && cmtEl.textContent !== String(p.comment_count || 0)) {
        cmtEl.textContent = p.comment_count || 0;
      }
    });
  }

  function cssEsc(s) {
    return String(s).replace(/["\\]/g, '\\$&');
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

  /* ---------------- 作者资料 ---------------- */

  async function loadAuthors(list) {
    const ids = Array.from(new Set(
      list.filter(p => p.author_id && !p.is_anonymous && !authors[p.author_id])
          .map(p => p.author_id)
    ));
    if (!ids.length || !window.Social || window.Social.demo) return;

    try {
      const rows = await Promise.all(ids.slice(0, 40).map(id => window.Social.getProfile(id)));
      rows.forEach(function (r) { if (r) authors[r.id] = r; });
    } catch (e) { /* 忽略 */ }
  }

  /* ---------------- 加载 ---------------- */

  async function loadPosts(showSkeleton, silent) {
    if (loading) return;
    loading = true;
    if (!silent) $('#btnRefresh').classList.add('spin');

    if (showSkeleton && !posts.length) {
      feed.innerHTML =
        '<div class="skel"><div class="skel-line" style="width:38%"></div><div class="skel-line" style="width:92%"></div><div class="skel-line" style="width:71%"></div></div>' +
        '<div class="skel"><div class="skel-line" style="width:30%"></div><div class="skel-line" style="width:86%"></div></div>';
    }

    try {
      const fresh = await window.Wall.listPosts(sortMode);
      await loadAuthors(fresh);

      const sig = fresh.map(p => p.id).join(',');

      if (!silent) {
        posts = fresh;
        renderFeed();
      } else if (sig !== lastSignature) {
        // 结构变了（新帖/删帖/顺序变了）→ 重建，但保留展开的评论
        posts = fresh;
        renderFeed();
      } else {
        // 只是数字变了 → 原地更新，不动 DOM 结构
        posts = fresh;
        patchNumbers();
      }

      renderStats();
    } catch (err) {
      if (!silent) {
        feed.innerHTML =
          '<div class="empty"><span class="emoji">😵</span><p>加载失败了</p><small>' +
          esc(err.message || '请检查网络后重试') + '</small></div>';
      }
    } finally {
      loading = false;
      if (!silent) setTimeout(() => $('#btnRefresh').classList.remove('spin'), 400);
    }
  }

  /* ---------------- 15 秒静默轮询 ---------------- */

  function startPolling() {
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = setInterval(function () {
      if (document.hidden) return;          // 页面不可见时不刷，省流量
      const modalOpen = document.querySelector('.modal-backdrop.open');
      if (modalOpen) return;                // 弹窗打开时别刷，免得打断
      loadPosts(false, true);
      refreshUnread();
    }, 15000);
  }

  /* ---------------- 未读红点 ---------------- */

  const msgDot = $('#msgDot');

  async function refreshUnread() {
    if (!window.Social || !window.Social.ready) return;
    try {
      const n = await window.Social.unreadTotal();
      if (n > 0) {
        msgDot.hidden = false;
        msgDot.textContent = n > 99 ? '99+' : String(n);
      } else {
        msgDot.hidden = true;
      }
    } catch (e) { /* 忽略 */ }
  }

  /* ---------------- 用户卡 ---------------- */

  const userCard = $('#userCard');
  let cardUid = null;

  async function openUserCard(uid) {
    if (!uid || !window.Social || !window.Social.ready) return;
    cardUid = uid;

    const prof = await window.Social.getProfile(uid);
    $('#ucAvatar').textContent = prof ? prof.avatar : '🐣';
    $('#ucAvatar').style.cssText = gradOf(prof ? prof.nickname : '同学');
    $('#ucName').textContent = prof ? prof.nickname : '同学';
    $('#ucBio').textContent = (prof && prof.bio) ? prof.bio : '';
    $('#ucActions').innerHTML = '<div class="uc-loading">…</div>';

    userCard.classList.add('open');
    document.body.style.overflow = 'hidden';

    const rel = await window.Social.relation(uid);
    renderCardActions(rel);
  }

  function renderCardActions(rel) {
    const box = $('#ucActions');
    box.innerHTML = '';

    function btn(label, cls, fn) {
      const b = document.createElement('button');
      b.className = 'mini-btn ' + (cls || 'ok');
      b.textContent = label;
      b.addEventListener('click', fn);
      box.appendChild(b);
      return b;
    }

    if (rel.state === 'self') {
      btn('这是我', 'del', () => { location.href = 'me.html'; });
      return;
    }
    if (rel.state === 'friend') {
      btn('发消息', 'ok', () => { location.href = 'chat.html?peer=' + cardUid; });
      return;
    }
    if (rel.state === 'pending' || rel.state === 'requested') {
      const b = btn('已申请，等对方同意', 'del', () => {});
      b.disabled = true;
      return;
    }
    if (rel.state === 'incoming') {
      btn('同意好友申请', 'ok', async function () {
        try {
          await window.Social.respondRequest(rel.request_id, true);
          toast('已经是好友了', 'ok');
          renderCardActions({ state: 'friend' });
        } catch (e) { toast(e.message, 'err'); }
      });
      btn('忽略', 'del', async function () {
        try {
          await window.Social.respondRequest(rel.request_id, false);
          renderCardActions({ state: 'none' });
        } catch (e) { toast(e.message, 'err'); }
      });
      return;
    }
    if (rel.state === 'demo' || rel.state === 'anon') {
      const b = btn('加好友', 'ok', () => {});
      b.disabled = true;
      box.insertAdjacentHTML('beforeend', '<div class="uc-note">演示模式下不能加好友</div>');
      return;
    }

    btn('加好友', 'ok', async function (ev) {
      const b = ev.currentTarget;
      b.disabled = true;
      b.textContent = '发送中…';
      try {
        const r = await window.Social.addFriend(cardUid);
        if (r.state === 'accepted') {
          toast('你们已经是好友了', 'ok');
          renderCardActions({ state: 'friend' });
        } else if (r.state === 'already_friends') {
          toast('已经是好友了', 'ok');
          renderCardActions({ state: 'friend' });
        } else {
          toast('申请已发出，等对方同意', 'ok');
          renderCardActions({ state: 'pending' });
        }
      } catch (e) {
        toast(e.message || '发送失败', 'err');
        b.disabled = false;
        b.textContent = '加好友';
      }
    });
  }

  function closeUserCard() {
    userCard.classList.remove('open');
    document.body.style.overflow = '';
    cardUid = null;
  }

  $('#ucClose').addEventListener('click', closeUserCard);
  userCard.addEventListener('click', function (e) {
    if (e.target === userCard) closeUserCard();
  });

  /* ---------------- 事件委托 ---------------- */

  feed.addEventListener('click', async function (e) {
    // 点头像 → 用户卡
    const av = e.target.closest('.avatar.clickable');
    if (av && av.dataset.uid) {
      e.stopPropagation();
      openUserCard(av.dataset.uid);
      return;
    }

    const likeBtn = e.target.closest('.like-btn');
    if (likeBtn) {
      e.preventDefault();
      const id = likeBtn.dataset.id;
      if (likeBtn.dataset.busy === '1') return;
      likeBtn.dataset.busy = '1';

      const numEl = likeBtn.querySelector('.like-num');
      const wasLiked = likeBtn.classList.contains('liked');
      const oldNum = parseInt(numEl.textContent, 10) || 0;

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

    const cmtBtn = e.target.closest('.cmt-btn');
    if (cmtBtn) {
      const id = cmtBtn.dataset.id;
      const panel = feed.querySelector('.comments[data-for="' + cssEsc(id) + '"]');
      if (!panel) return;
      const opening = !panel.classList.contains('open');
      panel.classList.toggle('open', opening);
      if (opening) {
        openComments.add(id);
        if (!panel.dataset.loaded) await loadComments(id, panel);
        const input = panel.querySelector('.cmt-input');
        if (input && window.innerWidth > 640) setTimeout(() => input.focus(), 120);
      } else {
        openComments.delete(id);
      }
      return;
    }

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
        appendComment(panel.querySelector('.comment-list'), row);
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

    const img = e.target.closest('[data-zoom]');
    if (img) openLightbox(img.dataset.zoom);
  });

  feed.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && e.target.classList.contains('cmt-input')) {
      e.preventDefault();
      e.target.closest('.comments').querySelector('.comment-send').click();
    }
  });

  function bumpCommentCount(postId, delta) {
    const p = posts.find(x => x.id === postId);
    if (p) p.comment_count = Math.max(0, (p.comment_count || 0) + delta);
    const el = feed.querySelector('.post[data-id="' + cssEsc(postId) + '"] .cmt-num');
    if (el && p) el.textContent = p.comment_count;
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
        rows.forEach(r => appendComment(listEl, r));
      }
      panel.dataset.loaded = '1';
    } catch (err) {
      listEl.innerHTML = '<div class="comment-empty">' + esc(err.message || '评论加载失败') + '</div>';
    }
  }

  function appendComment(listEl, row) {
    const empty = listEl.querySelector('.comment-empty');
    if (empty) empty.remove();

    const el = document.createElement('div');
    el.className = 'comment';
    el.innerHTML =
      '<div class="c-av" style="' + gradOf(row.nickname) + '">' + avatarInner(row.nickname) + '</div>' +
      '<div class="c-main">' +
        '<span class="c-name">' + esc(row.nickname || '匿名同学') + '</span>' +
        '<span class="c-time">' + timeAgo(row.created_at) + '</span>' +
        '<div class="c-text">' + esc(row.content) + '</div>' +
      '</div>';

    listEl.appendChild(el);
    el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
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

  /* ---------------- 发布 ---------------- */

  const composer = $('#composer');
  const inpContent = $('#inpContent');
  const counter = $('#counter');
  const fileInput = $('#fileInput');
  const uploadTile = $('#uploadTile');
  const uploaderInfo = $('#uploaderInfo');
  const btnSubmit = $('#btnSubmit');
  const chkAnon = $('#chkAnon');

  let pickedBlob = null;
  let pickedPreview = null;

  function openComposer() {
    composer.classList.add('open');
    document.body.style.overflow = 'hidden';

    const S = window.Social;
    if (S && S.ready && S.profile) {
      $('#posterAvatar').textContent = S.profile.avatar || '🐣';
      $('#posterAvatar').style.cssText = gradOf(S.profile.nickname || '同学');
      $('#posterName').textContent = S.profile.nickname || '还没起名字（去个人中心设一个）';
    } else {
      $('#posterAvatar').textContent = '🐣';
      $('#posterName').textContent = '匿名同学';
    }

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
    if (e.key === 'Escape') {
      if (composer.classList.contains('open')) closeComposer();
      if (userCard.classList.contains('open')) closeUserCard();
    }
  });

  inpContent.addEventListener('input', function () {
    const n = inpContent.value.length;
    counter.textContent = n + ' / 1000';
    counter.classList.toggle('over', n > 950);
  });

  chkAnon.addEventListener('change', function () {
    $('#posterName').textContent = chkAnon.checked
      ? '匿名同学'
      : (window.Social && window.Social.profile && window.Social.profile.nickname) || '还没起名字';
    $('#posterAvatar').textContent = chkAnon.checked ? '🙈'
      : (window.Social && window.Social.profile && window.Social.profile.avatar) || '🐣';
  });

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
    pickedBlob = null; pickedPreview = null;
    uploadTile.classList.remove('has-img');
    uploadTile.style.backgroundImage = '';
    uploaderInfo.textContent = '支持 jpg / png，会自动压缩，单张不超过 10MB。';
  }

  btnSubmit.addEventListener('click', async function () {
    const content = (inpContent.value || '').trim();
    if (content.length < 2) {
      toast('再多写几个字吧', 'err');
      inpContent.focus();
      return;
    }

    btnSubmit.disabled = true;
    const originalHtml = btnSubmit.innerHTML;
    btnSubmit.innerHTML = '<span class="spin-dot"></span> 提交中';

    try {
      await window.Wall.submitPost({
        content,
        imageBlob: pickedBlob,
        anonymous: chkAnon.checked
      });
      closeComposer();
      inpContent.value = '';
      counter.textContent = '0 / 1000';
      chkAnon.checked = false;
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
      openComments.clear();
      loadPosts(true);
    });
  });

  $('#btnRefresh').addEventListener('click', function () {
    loadPosts(false);
    refreshUnread();
    toast('已刷新');
  });

  const head = $('#siteHead');
  window.addEventListener('scroll', function () {
    head.classList.toggle('is-stuck', window.scrollY > 8);
  }, { passive: true });

  document.addEventListener('visibilitychange', function () {
    if (!document.hidden && posts.length) {
      loadPosts(false, true);
      refreshUnread();
    }
  });

  /* ---------------- 启动 ---------------- */

  async function boot() {
    if (!window.Wall.ready) $('#demoBar').classList.add('show');

    // 身份（匿名登录）
    if (window.Social) {
      const prof = await window.Social.init();
      if (prof) {
        $('#myAvatar').textContent = prof.avatar || '🐣';
        $('#btnMe').style.cssText = gradOf(prof.nickname || '同学');
      } else if (window.Social.error) {
        $('#demoBar').classList.remove('show');
        $('#demoBar').classList.add('show');
        $('#demoBar').innerHTML =
          '<b>身份初始化失败</b> · ' + esc(window.Social.error) +
          '<br>如果是 "Anonymous sign-ins disabled"，去 Supabase → Authentication → Sign In / Providers 打开匿名登录。';
      }

      // 有新消息 → 立刻刷新红点
      window.Social.onNewMessage(function () {
        refreshUnread();
      });
    }

    refreshUnread();
    loadPosts(true);
    startPolling();
  }

  boot();
})();
