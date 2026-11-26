/* ===========================================================
   霞浦三小校园墙 · 审核后台
   =========================================================== */

(function () {
  'use strict';

  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.prototype.slice.call((r || document).querySelectorAll(s));

  function escapeHtml(s) {
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
    if (d < 30) return d + ' 天前';
    const dd = new Date(t);
    return (dd.getMonth() + 1) + '月' + dd.getDate() + '日';
  }

  const G = [
    ['#f7a34a', '#e85d3d'], ['#4fc3c9', '#2c9aa8'], ['#7f8ce0', '#5560c4'],
    ['#f08aa0', '#d95c7c'], ['#8ac97f', '#4f9e52'], ['#e8b44a', '#c98f1e']
  ];
  function avatarStyle(name) {
    let h = 0;
    const s = name || '匿';
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

  /* ---------------- 登录流程 ---------------- */

  const loginView = $('#loginView');
  const panelView = $('#panelView');
  const btnLogout = $('#btnLogout');

  async function boot() {
    if (!window.Wall.ready) {
      // 演示模式：直接进后台看流程
      showPanel();
      $('#demoNote').className = 'alert err show';
      $('#demoNote').innerHTML =
        '当前是<b>演示模式</b>，审核操作只影响本机 localStorage 的假数据。' +
        '配好 Supabase 后，这里就是真正的审核后台。';
      return;
    }

    const user = await window.Wall.currentUser();
    if (!user) { showLogin(); return; }

    const ok = await window.Wall.isAdmin();
    if (!ok) {
      showLogin();
      $('#loginErr').textContent = '这个账号（' + user.email + '）不是管理员，请换一个。';
      $('#loginErr').classList.add('show');
      await window.Wall.adminSignOut();
      return;
    }
    showPanel();
  }

  function showLogin() {
    loginView.style.display = '';
    panelView.style.display = 'none';
    btnLogout.style.display = 'none';
  }

  function showPanel() {
    loginView.style.display = 'none';
    panelView.style.display = '';
    btnLogout.style.display = window.Wall.ready ? '' : 'none';
    refreshAll();
  }

  /* ---------------- 登录按钮 ---------------- */

  const btnLogin = $('#btnLogin');
  btnLogin.addEventListener('click', async function () {
    const email = ($('#inpEmail').value || '').trim();
    const pass = $('#inpPass').value || '';
    const errBox = $('#loginErr');
    errBox.classList.remove('show');

    if (!email || !pass) {
      errBox.textContent = '邮箱和密码都要填';
      errBox.classList.add('show');
      return;
    }

    btnLogin.disabled = true;
    const old = btnLogin.innerHTML;
    btnLogin.innerHTML = '<span class="spin-dot"></span> 登录中';

    try {
      await window.Wall.adminSignIn(email, pass);
      const ok = await window.Wall.isAdmin();
      if (!ok) {
        await window.Wall.adminSignOut();
        throw new Error('这个账号不是管理员，请用绑定了管理员身份的账号登录');
      }
      toast('登录成功', 'ok');
      showPanel();
    } catch (err) {
      errBox.textContent = err.message || '登录失败';
      errBox.classList.add('show');
    } finally {
      btnLogin.disabled = false;
      btnLogin.innerHTML = old;
    }
  });

  $('#inpPass').addEventListener('keydown', function (e) {
    if (e.key === 'Enter') btnLogin.click();
  });

  btnLogout.addEventListener('click', async function () {
    await window.Wall.adminSignOut();
    toast('已退出');
    showLogin();
  });

  /* ---------------- 列表渲染 ---------------- */

  function reviewCard(p, mode) {
    const el = document.createElement('article');
    el.className = 'review-item';
    el.dataset.id = p.id;

    const imgHtml = p.image_url
      ? '<img class="review-img" src="' + escapeHtml(p.image_url) + '" alt="配图" loading="lazy" data-zoom="' + escapeHtml(p.image_url) + '">'
      : '';

    let actionsHtml = '';
    if (mode === 'pending') {
      actionsHtml =
        '<button class="mini-btn ok" data-act="approve">✓ 通过并发布</button>' +
        '<button class="mini-btn no" data-act="reject">✕ 不通过</button>' +
        '<button class="mini-btn del" data-act="delete">删除</button>';
    } else {
      actionsHtml =
        '<button class="mini-btn pin' + (p.is_pinned ? ' on' : '') + '" data-act="pin">' +
          (p.is_pinned ? '📌 已置顶' : '📌 置顶') + '</button>' +
        '<button class="mini-btn no" data-act="unpublish">下架</button>' +
        '<button class="mini-btn del" data-act="delete">删除</button>';
    }

    el.innerHTML =
      '<div class="review-top">' +
        '<div class="avatar" style="' + avatarStyle(p.nickname) + ';width:34px;height:34px;border-radius:11px;font-size:14px">' +
          escapeHtml((p.nickname || '匿').charAt(0)) +
        '</div>' +
        '<div>' +
          '<div style="font-size:13.5px;font-weight:650">' + escapeHtml(p.nickname || '匿名同学') + '</div>' +
          '<div style="font-size:11.5px;color:var(--muted)">' +
            (p.status === 'approved' ? '已发布 · ' : '') +
            '👍 ' + (p.like_count || 0) + ' · 💬 ' + (p.comment_count || 0) +
          '</div>' +
        '</div>' +
        '<span class="time">' + timeAgo(p.created_at) + '</span>' +
      '</div>' +
      '<div class="review-body">' + escapeHtml(p.content) + '</div>' +
      imgHtml +
      '<div class="review-actions">' + actionsHtml + '</div>';

    return el;
  }

  async function refreshAll() {
    try {
      const [stats, pending, approved] = await Promise.all([
        window.Wall.adminStats(),
        window.Wall.adminListPosts('pending'),
        window.Wall.adminListPosts('approved')
      ]);

      $('#sPending').textContent = stats.pending;
      $('#sApproved').textContent = stats.approved;
      $('#sLikes').textContent = stats.likes;
      $('#sComments').textContent = stats.comments;
      $('#pendingBadge').textContent = stats.pending;

      const pList = $('#pendingList');
      pList.innerHTML = '';
      if (!pending.length) {
        pList.innerHTML = '<div class="empty" style="padding:36px 16px"><span class="emoji">☕</span><p>全部审完了，辛苦了</p><small>有新帖子提交时会出现在这里</small></div>';
      } else {
        pending.forEach(p => pList.appendChild(reviewCard(p, 'pending')));
      }

      const aList = $('#approvedList');
      aList.innerHTML = '';
      const recent = approved.slice(0, 40);
      if (!recent.length) {
        aList.innerHTML = '<div class="empty" style="padding:30px 16px"><p>还没有已发布的帖子</p></div>';
      } else {
        recent.forEach(p => aList.appendChild(reviewCard(p, 'approved')));
      }
    } catch (err) {
      toast(err.message || '加载失败', 'err');
    }
  }

  /* ---------------- 操作 ---------------- */

  document.addEventListener('click', async function (e) {
    const btn = e.target.closest('.mini-btn');
    if (btn) {
      const item = btn.closest('.review-item');
      const id = item.dataset.id;
      const act = btn.dataset.act;

      btn.disabled = true;
      const old = btn.textContent;

      try {
        if (act === 'approve') {
          btn.textContent = '…';
          await window.Wall.adminSetStatus(id, 'approved');
          item.style.transition = 'opacity .35s, transform .35s';
          item.style.opacity = '0';
          item.style.transform = 'translateX(24px)';
          setTimeout(() => item.remove(), 360);
          toast('已通过，帖子挂在墙上了', 'ok');
          setTimeout(refreshAll, 380);
          return;
        }

        if (act === 'reject') {
          const reason = window.prompt('不通过的原因（可选，只记在后台）', '不符合校园墙规范');
          if (reason === null) { btn.disabled = false; return; }
          btn.textContent = '…';
          await window.Wall.adminSetStatus(id, 'rejected', reason);
          item.remove();
          toast('已标记为不通过');
          setTimeout(refreshAll, 300);
          return;
        }

        if (act === 'pin') {
          const nowPinned = !btn.classList.contains('on');
          btn.disabled = true;
          try {
            await window.Wall.adminSetPinned(id, nowPinned);
            btn.classList.toggle('on', nowPinned);
            btn.textContent = nowPinned ? '📌 已置顶' : '📌 置顶';
            toast(nowPinned ? '已置顶到墙的最上面' : '已取消置顶', 'ok');
            setTimeout(refreshAll, 400);
          } catch (err) {
            toast(err.message || '操作失败', 'err');
          } finally {
            btn.disabled = false;
          }
          return;
        }

        if (act === 'unpublish') {
          if (!window.confirm('下架后同学们就看不到这条帖子了，确定吗？')) {
            btn.disabled = false; return;
          }
          await window.Wall.adminSetStatus(id, 'pending');
          toast('已下架，回到待审核');
          setTimeout(refreshAll, 300);
          return;
        }

        if (act === 'delete') {
          if (!window.confirm('删除后不可恢复（连同它的评论一起删除），确定吗？')) {
            btn.disabled = false; return;
          }
          await window.Wall.adminDeletePost(id);
          item.remove();
          toast('已删除');
          setTimeout(refreshAll, 300);
          return;
        }
      } catch (err) {
        toast(err.message || '操作失败', 'err');
        btn.disabled = false;
        btn.textContent = old;
      }
      return;
    }

    // 看大图
    const img = e.target.closest('[data-zoom]');
    if (img) {
      const lb = $('#lightbox');
      $('#lightboxImg').src = img.dataset.zoom;
      lb.classList.add('open');
    }
  });

  $('#lightbox').addEventListener('click', function () {
    this.classList.remove('open');
    setTimeout(() => { $('#lightboxImg').src = ''; }, 260);
  });

  $('#btnReload').addEventListener('click', function () {
    refreshAll();
    toast('已刷新');
  });

  /* =========================================================
     视图切换
     ========================================================= */
  let currentView = 'posts';

  document.getElementById('adminTabs').addEventListener('click', function (e) {
    const btn = e.target.closest('.atab');
    if (!btn) return;
    $$('.atab').forEach(b => b.classList.toggle('on', b === btn));
    currentView = btn.dataset.view;
    $('#viewPosts').hidden = currentView !== 'posts';
    $('#viewAdmins').hidden = currentView !== 'admins';
    $('#viewBans').hidden = currentView !== 'bans';

    if (currentView === 'admins') loadAdmins();
    if (currentView === 'bans') loadBans();
  });

  /* =========================================================
     管理员管理
     ========================================================= */
  function avatarCell(name, emoji) {
    return '<div class="avatar" style="' + avatarStyle(name) + '">' +
      escapeHtml(emoji || (name || '匿').charAt(0)) + '</div>';
  }

  async function loadAdmins() {
    const box = $('#adminList');
    box.innerHTML = '<div class="empty-mini">加载中…</div>';
    try {
      const list = await window.Wall.listAdmins();
      if (!list.length) {
        box.innerHTML = '<div class="empty-mini">还没有管理员</div>';
        return;
      }
      box.innerHTML = '';
      list.forEach(function (a) {
        const el = document.createElement('div');
        el.className = 'row-item';
        el.innerHTML =
          avatarCell(a.nickname, a.avatar) +
          '<div class="row-main">' +
            '<div class="row-name">' + escapeHtml(a.nickname) +
              (a.is_me ? ' <span class="badge approved">我</span>' : '') + '</div>' +
            '<div class="row-sub">' + new Date(a.created_at).toLocaleDateString('zh-CN') + ' 起</div>' +
          '</div>' +
          (a.is_me ? '<span class="row-sub">—</span>'
                   : '<button class="mini-btn del" data-demote="' + escapeHtml(a.user_id) + '">撤销</button>');
        box.appendChild(el);
      });
    } catch (err) {
      box.innerHTML = '<div class="empty-mini">' + escapeHtml(err.message) + '</div>';
    }
  }

  let userSearchTimer = null;
  const inpUserSearch = $('#inpUserSearch');
  if (inpUserSearch) {
    inpUserSearch.addEventListener('input', function () {
      clearTimeout(userSearchTimer);
      const v = inpUserSearch.value;
      userSearchTimer = setTimeout(() => searchUsers(v), 350);
    });
    // 一进「管理员」页先列一批
    setTimeout(() => searchUsers(''), 400);
  }

  async function searchUsers(q) {
    const box = $('#userList');
    if (!box) return;
    box.innerHTML = '<div class="empty-mini">搜索中…</div>';
    try {
      const list = await window.Wall.searchProfiles(q || '');
      if (!list.length) {
        box.innerHTML = '<div class="empty-mini">没找到这个人</div>';
        return;
      }
      box.innerHTML = '';
      list.forEach(function (u) {
        const el = document.createElement('div');
        el.className = 'row-item';
        el.innerHTML =
          avatarCell(u.nickname, u.avatar) +
          '<div class="row-main">' +
            '<div class="row-name">' + escapeHtml(u.nickname) + '</div>' +
            '<div class="row-sub">' + escapeHtml(u.id.slice(0, 8)) + '…</div>' +
          '</div>' +
          (u.is_admin
            ? '<span class="badge approved">已是管理员</span>'
            : '<button class="mini-btn ok" data-promote="' + escapeHtml(u.id) + '" data-name="' + escapeHtml(u.nickname) + '">设为管理员</button>');
        box.appendChild(el);
      });
    } catch (err) {
      box.innerHTML = '<div class="empty-mini">' + escapeHtml(err.message) + '</div>';
    }
  }

  /* =========================================================
     封禁管理
     ========================================================= */
  async function loadBans() {
    const box = $('#banList');
    box.innerHTML = '<div class="empty-mini">加载中…</div>';
    try {
      const list = await window.Wall.adminListBans();
      if (!list.length) {
        box.innerHTML = '<div class="empty-mini">还没有封禁记录</div>';
        return;
      }
      box.innerHTML = '';
      list.forEach(function (b) {
        const el = document.createElement('div');
        el.className = 'row-item' + (b.expired ? ' done' : '');
        const until = b.expires_at
          ? new Date(b.expires_at).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
          : '永久';
        el.innerHTML =
          '<div class="row-main">' +
            '<div class="row-name">' + escapeHtml(b.nickname || '（设备封禁）') +
              (b.expired ? ' <span class="badge">已过期</span>' : '') + '</div>' +
            '<div class="row-sub">' + escapeHtml(b.reason) + ' · 至 ' + until + '</div>' +
            '<div class="row-sub">' + (b.device_fp ? '设备 ' + escapeHtml(b.device_fp.slice(0, 14)) + '…' : '账号封禁') + '</div>' +
          '</div>' +
          '<button class="mini-btn del" data-unban="' + escapeHtml(b.id) + '">解封</button>';
        box.appendChild(el);
      });
    } catch (err) {
      box.innerHTML = '<div class="empty-mini">' + escapeHtml(err.message) + '</div>';
    }
  }

  $('#btnDoBan') && $('#btnDoBan').addEventListener('click', async function () {
    const fp = ($('#inpBanFp').value || '').trim();
    const reason = ($('#inpBanReason').value || '').trim() || '违反校园墙规范';
    const daysRaw = $('#selBanDays').value;
    const days = daysRaw === '' ? null : parseInt(daysRaw, 10);

    if (!fp) {
      toast('请填设备码；只想封账号的话，在「管理员」页的人物列表里操作', 'err');
      return;
    }

    this.disabled = true;
    try {
      await window.Wall.adminBan({ device: fp, reason, days });
      toast('已封禁', 'ok');
      $('#inpBanFp').value = '';
      $('#inpBanReason').value = '';
      loadBans();
    } catch (err) {
      toast(err.message || '封禁失败', 'err');
    } finally {
      this.disabled = false;
    }
  });

  /* 列表里的撤销/解封/任命（统一委托） */
  document.addEventListener('click', async function (e) {
    const promote = e.target.closest('[data-promote]');
    if (promote) {
      const name = promote.dataset.name;
      if (!window.confirm('确定把「' + name + '」设为管理员？\nTA 将能审核帖子、置顶、封禁别人。')) return;
      promote.disabled = true;
      try {
        await window.Wall.promoteAdmin(promote.dataset.promote);
        toast('已任命', 'ok');
        loadAdmins();
        searchUsers($('#inpUserSearch') ? $('#inpUserSearch').value : '');
      } catch (err) {
        toast(err.message || '任命失败', 'err');
        promote.disabled = false;
      }
      return;
    }

    const demote = e.target.closest('[data-demote]');
    if (demote) {
      if (!window.confirm('确定撤销这个人的管理员身份？')) return;
      demote.disabled = true;
      try {
        await window.Wall.demoteAdmin(demote.dataset.demote);
        toast('已撤销', 'ok');
        loadAdmins();
      } catch (err) {
        toast(err.message || '撤销失败', 'err');
        demote.disabled = false;
      }
      return;
    }

    const unban = e.target.closest('[data-unban]');
    if (unban) {
      if (!window.confirm('确定解封？')) return;
      unban.disabled = true;
      try {
        await window.Wall.adminUnban(unban.dataset.unban);
        toast('已解封', 'ok');
        loadBans();
      } catch (err) {
        toast(err.message || '解封失败', 'err');
        unban.disabled = false;
      }
      return;
    }
  });

  boot();
})();
