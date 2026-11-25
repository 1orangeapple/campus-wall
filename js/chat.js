/* ===========================================================
   消息 / 聊天
   =========================================================== */

(function () {
  'use strict';

  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.prototype.slice.call((r || document).querySelectorAll(s));

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  const G = [
    ['#f7a34a', '#e85d3d'], ['#4fc3c9', '#2c9aa8'], ['#7f8ce0', '#5560c4'],
    ['#f08aa0', '#d95c7c'], ['#8ac97f', '#4f9e52'], ['#e8b44a', '#c98f1e']
  ];
  function gradOf(name) {
    let h = 0;
    const s = String(name || '匿');
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
    const g = G[Math.abs(h) % G.length];
    return 'background:linear-gradient(145deg,' + g[0] + ',' + g[1] + ')';
  }

  function timeShort(iso) {
    const t = new Date(iso).getTime();
    if (!t) return '';
    const now = new Date();
    const d = new Date(t);
    const sameDay = d.toDateString() === now.toDateString();
    const pad = n => (n < 10 ? '0' + n : '' + n);
    if (sameDay) return pad(d.getHours()) + ':' + pad(d.getMinutes());
    const y = new Date(now.getTime() - 86400000);
    if (d.toDateString() === y.toDateString()) return '昨天';
    return (d.getMonth() + 1) + '/' + d.getDate();
  }

  const toastStack = $('#toastStack');
  function toast(msg, type, ms) {
    const el = document.createElement('div');
    el.className = 'toast' + (type ? ' ' + type : '');
    el.textContent = msg;
    toastStack.appendChild(el);
    setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 320); }, ms || 2600);
  }

  const S = window.Social;
  const peerId = new URLSearchParams(location.search).get('peer');
  let peer = null;
  let msgIds = new Set();
  let polling = null;

  /* ================= 会话列表 ================= */

  async function renderSessions() {
    const box = $('#sessionList');
    try {
      const friends = await S.listFriends();
      if (!friends.length) {
        box.innerHTML =
          '<div class="empty" style="padding:70px 20px">' +
            '<span class="emoji">💬</span>' +
            '<p>还没有好友</p>' +
            '<small>去校园墙上点别人的头像，加个好友就能聊了</small>' +
          '</div>';
        return;
      }

      box.innerHTML = '';
      friends.forEach(function (f) {
        const a = document.createElement('a');
        a.className = 'session' + (f.unread ? ' unread' : '');
        a.href = 'chat.html?peer=' + encodeURIComponent(f.id);
        a.innerHTML =
          '<div class="avatar avatar-lg" style="' + gradOf(f.nickname) + '">' + esc(f.avatar || '🐣') +
            (f.unread ? '<i class="badge-dot">' + (f.unread > 99 ? '99+' : f.unread) + '</i>' : '') +
          '</div>' +
          '<div class="session-main">' +
            '<div class="session-top">' +
              '<span class="session-name">' + esc(f.nickname) + '</span>' +
              '<span class="session-time">' + (f.last_at ? timeShort(f.last_at) : '') + '</span>' +
            '</div>' +
            '<div class="session-last">' + esc(f.last_msg || '还没有聊过') + '</div>' +
          '</div>';
        box.appendChild(a);
      });
    } catch (err) {
      box.innerHTML = '<div class="empty-mini">' + esc(err.message || '加载失败') + '</div>';
    }
  }

  /* ================= 聊天 ================= */

  function msgHtml(m) {
    const mine = m.sender === S.uid;
    return '<div class="bubble-row ' + (mine ? 'mine' : 'them') + '" data-id="' + esc(m.id) + '">' +
      (mine ? '' : '<div class="avatar sm" style="' + gradOf(peer ? peer.nickname : '') + '">' +
        esc((peer && peer.avatar) || '🐣') + '</div>') +
      '<div class="bubble">' + esc(m.content) + '</div>' +
      '</div>';
  }

  function appendMsg(m, scroll) {
    if (msgIds.has(m.id)) return;
    msgIds.add(m.id);

    const scrollEl = $('#msgScroll');
    const loading = scrollEl.querySelector('.msg-loading');
    if (loading) loading.remove();

    const wrap = document.createElement('div');
    wrap.innerHTML = msgHtml(m);
    const el = wrap.firstElementChild;
    scrollEl.appendChild(el);

    if (scroll !== false) {
      requestAnimationFrame(() => {
        scrollEl.scrollTop = scrollEl.scrollHeight;
      });
    }
  }

  async function loadMessages(firstLoad) {
    try {
      const rows = await S.listMessages(peer.id);
      const scrollEl = $('#msgScroll');

      if (firstLoad) {
        scrollEl.innerHTML = '';
        rows.forEach(m => appendMsg(m, false));
        requestAnimationFrame(() => { scrollEl.scrollTop = scrollEl.scrollHeight; });
      } else {
        // 只补新的
        rows.forEach(m => appendMsg(m, true));
      }

      if (!rows.length && firstLoad) {
        scrollEl.innerHTML = '<div class="msg-empty">还没有消息，说句「你好」开始吧</div>';
      }
    } catch (err) {
      if (firstLoad) {
        $('#msgScroll').innerHTML = '<div class="msg-empty">' + esc(err.message || '加载失败') + '</div>';
      }
    }
  }

  async function send() {
    const input = $('#msgInput');
    const text = (input.value || '').trim();
    if (!text) { input.focus(); return; }

    const btn = $('#btnSend');
    if (btn.disabled) return;
    btn.disabled = true;
    input.value = '';

    try {
      const row = await S.sendMessage(peer.id, text);
      appendMsg(row, true);
    } catch (err) {
      input.value = text;   // 失败把内容还回去
      toast(err.message || '发送失败', 'err');
    } finally {
      btn.disabled = false;
      input.focus();
    }
  }

  async function bootChat() {
    $('#listView').hidden = true;
    $('#listHead').hidden = true;
    $('#chatView').hidden = false;

    peer = await S.getProfile(peerId);
    if (!peer) {
      $('#peerName').textContent = '这个人不见了';
      $('#msgScroll').innerHTML = '<div class="msg-empty">找不到这个同学</div>';
      return;
    }

    $('#peerAvatar').textContent = peer.avatar || '🐣';
    $('#peerAvatar').style.cssText = gradOf(peer.nickname);
    $('#peerName').textContent = peer.nickname;
    $('#peerSub').textContent = peer.bio || '';

    const rel = await S.relation(peerId);
    if (rel.state !== 'friend') {
      $('#msgScroll').innerHTML =
        '<div class="msg-empty">你们还不是好友<br><a href="index.html" style="color:var(--brand)">去墙上点头像加好友</a></div>';
      const cb = $('.composer-bar');
      if (cb) cb.style.display = 'none';
      return;
    }

    await loadMessages(true);
    S.markRead(peerId);
    setTimeout(() => $('#msgInput').focus(), 200);

    // Realtime：收到对方消息立刻出现
    S.onNewMessage(function (m) {
      if (m.sender === peerId) {
        appendMsg(m, true);
        S.markRead(peerId);
      }
    });

    // 15 秒兜底轮询（Realtime 没连上时也能收到）
    polling = setInterval(function () {
      if (document.hidden) return;
      loadMessages(false);
      S.markRead(peerId);
    }, 15000);

    $('#btnSend').addEventListener('click', send);
    $('#msgInput').addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
    });

    // 键盘弹起时保持在底部
    $('#msgInput').addEventListener('focus', function () {
      setTimeout(function () {
        const el = $('#msgScroll');
        el.scrollTop = el.scrollHeight;
      }, 300);
    });
  }

  /* ================= 启动 ================= */

  async function boot() {
    const p = await S.init();

    if (!p) {
      $('#noteBar').hidden = false;
      $('#noteBar').className = 'note-bar show';
      $('#noteBar').innerHTML =
        '<b>身份初始化失败</b><br>' + esc(S.error || '未知错误') +
        '<br>去 Supabase → Authentication → Sign In / Providers 打开匿名登录。';
      $('#sessionList').innerHTML = '';
      return;
    }

    $('#myAvatar').textContent = p.avatar || '🐣';

    if (S.demo) {
      $('#noteBar').hidden = false;
      $('#noteBar').className = 'note-bar show';
      $('#noteBar').innerHTML = '<b>演示模式</b> · 好友和聊天需要连接 Supabase 后才能用。';
    }

    if (peerId) {
      await bootChat();
    } else {
      if (!S.demo) {
        renderSessions();
        S.onNewMessage(function () { renderSessions(); });
        setInterval(function () {
          if (!document.hidden && !peerId) renderSessions();
        }, 15000);
      } else {
        $('#sessionList').innerHTML = '<div class="empty-mini">演示模式下不可用</div>';
      }
    }
  }

  boot();
})();
