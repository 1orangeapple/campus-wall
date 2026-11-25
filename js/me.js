/* ===========================================================
   个人中心
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

  const toastStack = $('#toastStack');
  function toast(msg, type, ms) {
    const el = document.createElement('div');
    el.className = 'toast' + (type ? ' ' + type : '');
    el.textContent = msg;
    toastStack.appendChild(el);
    setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 320); }, ms || 2600);
  }

  const S = window.Social;
  let pickedAvatar = '🐣';

  /* ---------------- 头像网格 ---------------- */

  function renderAvatarGrid() {
    const grid = $('#avatarGrid');
    grid.innerHTML = '';
    S.AVATARS.forEach(function (emo) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'av-pick' + (emo === pickedAvatar ? ' on' : '');
      b.textContent = emo;
      b.addEventListener('click', function () {
        pickedAvatar = emo;
        $$('.av-pick', grid).forEach(x => x.classList.toggle('on', x.textContent === emo));
        updatePreview();
      });
      grid.appendChild(b);
    });
  }

  function updatePreview() {
    const name = ($('#inpName').value || '').trim() || '同学';
    $('#meAvatar').textContent = pickedAvatar;
    $('#meAvatar').style.cssText = gradOf(name);
    $('#meName').textContent = name;
  }

  /* ---------------- 好友 ---------------- */

  async function loadFriends() {
    const friendBox = $('#friendList');
    const reqBox = $('#requestList');

    try {
      const [friends, requests] = await Promise.all([
        S.listFriends().catch(() => []),
        S.listRequests().catch(() => [])
      ]);

      $('#friendCount').textContent = friends.length ? friends.length + ' 人' : '';

      // 申请
      reqBox.innerHTML = '';
      if (!requests.length) {
        reqBox.innerHTML = '<div class="empty-mini">没有新的好友申请</div>';
      } else {
        requests.forEach(function (r) {
          const el = document.createElement('div');
          el.className = 'row-item';
          el.innerHTML =
            '<div class="avatar" style="' + gradOf(r.nickname) + '">' + esc(r.avatar || '🐣') + '</div>' +
            '<div class="row-main"><div class="row-name">' + esc(r.nickname) + '</div>' +
            '<div class="row-sub">想加你为好友</div></div>' +
            '<button class="mini-btn ok" data-act="yes">同意</button>' +
            '<button class="mini-btn del" data-act="no">忽略</button>';

          el.addEventListener('click', async function (e) {
            const btn = e.target.closest('[data-act]');
            if (!btn) return;
            btn.disabled = true;
            try {
              await S.respondRequest(r.id, btn.dataset.act === 'yes');
              toast(btn.dataset.act === 'yes' ? '已同意' : '已忽略', 'ok');
              loadFriends();
            } catch (err) {
              toast(err.message || '操作失败', 'err');
              btn.disabled = false;
            }
          });
          reqBox.appendChild(el);
        });
      }

      // 好友
      friendBox.innerHTML = '';
      if (!friends.length) {
        friendBox.innerHTML = '<div class="empty-mini">还没有好友，去帖子上点头像试试</div>';
      } else {
        friends.forEach(function (f) {
          const el = document.createElement('a');
          el.className = 'row-item row-link';
          el.href = 'chat.html?peer=' + encodeURIComponent(f.id);
          el.innerHTML =
            '<div class="avatar" style="' + gradOf(f.nickname) + '">' + esc(f.avatar || '🐣') +
              (f.unread ? '<i class="badge-dot">' + (f.unread > 99 ? '99+' : f.unread) + '</i>' : '') +
            '</div>' +
            '<div class="row-main">' +
              '<div class="row-name">' + esc(f.nickname) + '</div>' +
              '<div class="row-sub">' + esc(f.last_msg || (f.bio || '还没聊过')) + '</div>' +
            '</div>' +
            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" width="16" height="16" style="opacity:.35;flex:none"><path d="M9 5l7 7-7 7"/></svg>';
          friendBox.appendChild(el);
        });
      }
    } catch (err) {
      friendBox.innerHTML = '<div class="empty-mini">' + esc(err.message || '加载失败') + '</div>';
    }
  }

  async function refreshUnread() {
    try {
      const n = await S.unreadTotal();
      const dot = $('#msgDot');
      if (n > 0) { dot.hidden = false; dot.textContent = n > 99 ? '99+' : String(n); }
      else { dot.hidden = true; }
    } catch (e) {}
  }

  /* ---------------- 保存 ---------------- */

  async function save() {
    const name = ($('#inpName').value || '').trim();
    const bio = ($('#inpBio').value || '').trim();

    if (!name) { toast('先给自己起个名字吧', 'err'); $('#inpName').focus(); return; }

    const btn = $('#btnSave');
    btn.disabled = true;
    const old = btn.innerHTML;
    btn.innerHTML = '<span class="spin-dot"></span> 保存中';

    try {
      const p = await S.saveProfile({ nickname: name, avatar: pickedAvatar, bio });
      $('#meName').textContent = p.nickname;
      toast('已保存', 'ok');
    } catch (err) {
      toast(err.message || '保存失败', 'err');
    } finally {
      btn.disabled = false;
      btn.innerHTML = old;
    }
  }

  /* ---------------- 启动 ---------------- */

  async function boot() {
    const p = await S.init();

    if (!p) {
      $('#noteBar').hidden = false;
      $('#noteBar').className = 'note-bar show';
      $('#noteBar').innerHTML =
        '<b>身份初始化失败</b><br>' + esc(S.error || '未知错误') +
        '<br>如果提示 anonymous sign-ins disabled，去 Supabase → Authentication → Sign In / Providers 打开匿名登录。';
      return;
    }

    if (S.demo) {
      $('#noteBar').hidden = false;
      $('#noteBar').className = 'note-bar show';
      $('#noteBar').innerHTML = '<b>演示模式</b> · 资料只存在这台设备上，好友和聊天需要连接 Supabase。';
    }

    pickedAvatar = p.avatar || '🐣';
    $('#inpName').value = p.nickname && !/^同学[0-9a-f]{4}$/.test(p.nickname) ? p.nickname : '';
    $('#inpBio').value = p.bio || '';

    renderAvatarGrid();
    updatePreview();

    $('#inpName').addEventListener('input', updatePreview);
    $('#btnSave').addEventListener('click', save);
    $('#inpName').addEventListener('keydown', e => { if (e.key === 'Enter') save(); });

    if (!S.demo) {
      loadFriends();
      refreshUnread();
      S.onFriendRequest(function () { loadFriends(); });
      S.onFriendAccepted(function () { loadFriends(); });
      S.onNewMessage(function () { refreshUnread(); loadFriends(); });
    } else {
      $('#requestList').innerHTML = '<div class="empty-mini">演示模式下不可用</div>';
      $('#friendList').innerHTML = '<div class="empty-mini">演示模式下不可用</div>';
    }
  }

  boot();
})();
