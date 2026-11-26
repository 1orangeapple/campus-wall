/* ===========================================================
   霞浦三小校园墙 · 数据层
   -----------------------------------------------------------
   统一对外接口 window.Wall。
   配了 Supabase → 走真后端；没配 → 自动切到本地演示模式，
   数据存 localStorage，方便你先看效果、调样式。
   =========================================================== */

(function () {
  'use strict';

  const cfg = window.WALL_CONFIG || {};
  const BACKEND_READY = !!(cfg.SUPABASE_URL && cfg.SUPABASE_ANON_KEY && window.supabase);
  const BUCKET = cfg.STORAGE_BUCKET || 'post-images';

  /* ---------- 设备指纹：一台设备一票 ---------- */
  function getClientId() {
    const KEY = 'campuswall_client_id';
    let id = null;
    try { id = localStorage.getItem(KEY); } catch (e) { /* 隐私模式 */ }
    if (!id) {
      id = 'c_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
      try { localStorage.setItem(KEY, id); } catch (e) {}
    }
    return id;
  }
  const CLIENT_ID = getClientId();

  /* ---------- Supabase 客户端 ---------- */
  let sb = null;
  let adminSb = null;
  if (BACKEND_READY) {
    // 前台身份（匿名登录）和后台管理员身份用两套独立的 session 存储，
    // 否则老师在后台登录会把学生的匿名身份顶掉，反之亦然。
    sb = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY, {
      auth: { persistSession: true, autoRefreshToken: true, storageKey: 'campuswall-auth' },
      db: { schema: 'public' }
    });
    adminSb = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY, {
      auth: { persistSession: true, autoRefreshToken: true, storageKey: 'campuswall-admin-auth' },
      db: { schema: 'public' }
    });
  }

  /* ===========================================================
     图片压缩：手机原图动辄 4-8MB，压到 1600px / q0.82
     =========================================================== */
  function compressImage(file, maxSide, quality) {
    maxSide = maxSide || 1600;
    quality = quality || 0.82;
    return new Promise((resolve, reject) => {
      if (!file || !/^image\//.test(file.type)) {
        reject(new Error('请选择图片文件'));
        return;
      }
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = function () {
        let { width: w, height: h } = img;
        const scale = Math.min(1, maxSide / Math.max(w, h));
        w = Math.round(w * scale);
        h = Math.round(h * scale);

        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, w, h);
        ctx.drawImage(img, 0, 0, w, h);
        URL.revokeObjectURL(url);

        canvas.toBlob(function (blob) {
          if (!blob) { reject(new Error('图片处理失败')); return; }
          resolve(blob);
        }, 'image/jpeg', quality);
      };
      img.onerror = function () {
        URL.revokeObjectURL(url);
        reject(new Error('图片读取失败，换一张试试'));
      };
      img.src = url;
    });
  }

  /* ===========================================================
     演示模式：localStorage 假数据库
     =========================================================== */
  const DEMO_POSTS = 'campuswall_demo_posts_v1';
  const DEMO_COMMENTS = 'campuswall_demo_comments_v1';
  const DEMO_LIKES = 'campuswall_demo_likes_v1';

  function demoRead(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (e) { return fallback; }
  }
  function demoWrite(key, val) {
    try { localStorage.setItem(key, JSON.stringify(val)); } catch (e) {
      throw new Error('本地存储写满了，删几张图片再试');
    }
  }

  function demoSeed() {
    if (localStorage.getItem(DEMO_POSTS) && localStorage.getItem(DEMO_COMMENTS)) return;
    const now = Date.now();
    const seed = [
      {
        id: 'demo-1',
        nickname: '三年二班 小林',
        content: '操场东边那棵大榕树下面，捡到一只黑色水杯，杯身上贴了只小老虎贴纸。失主来三班找我～',
        image_url: null,
        status: 'approved',
        category: '失物招领',
        like_count: 23,
        comment_count: 2,
        created_at: new Date(now - 1000 * 60 * 47).toISOString(),
        approved_at: new Date(now - 1000 * 60 * 40).toISOString()
      },
      {
        id: 'demo-2',
        nickname: '爱吃海蛎煎的鱼',
        content: '今天的晚霞特别好看，从教学楼三楼看过去整片天都是橘红色的，像霞浦的滩涂掉到天上了。\n有没有人和我一样站在走廊看了十分钟？',
        image_url: 'assets/demo-sunset.jpg',
        status: 'approved',
        category: '灌水贴',
        like_count: 61,
        comment_count: 3,
        created_at: new Date(now - 1000 * 60 * 60 * 5).toISOString(),
        approved_at: new Date(now - 1000 * 60 * 60 * 4).toISOString()
      },
      {
        id: 'demo-3',
        nickname: '匿名同学',
        content: '六年级的同学们，下周运动会报名还差两个人，接力赛或者跳远都行，不会也没关系，重在参与嘛，加我把名字报给体委。',
        image_url: null,
        status: 'approved',
        category: '吐槽',
        like_count: 9,
        comment_count: 0,
        created_at: new Date(now - 1000 * 60 * 60 * 26).toISOString(),
        approved_at: new Date(now - 1000 * 60 * 60 * 25).toISOString()
      },
      {
        id: 'demo-pending',
        nickname: '五年级 阿涛',
        content: '想问一下图书馆那本《海底两万里》被谁借走了，我排了好久了……',
        image_url: null,
        status: 'pending',
        category: '灌水贴',
        like_count: 0,
        comment_count: 0,
        created_at: new Date(now - 1000 * 60 * 12).toISOString()
      }
    ];
    demoWrite(DEMO_POSTS, seed);

    const comments = [
      { id: 'c1', post_id: 'demo-1', nickname: '杯子主人', content: '是我的！明天去找你，谢谢你呀', created_at: new Date(now - 1000 * 60 * 30).toISOString() },
      { id: 'c2', post_id: 'demo-1', nickname: '路过', content: '好人有好报~', created_at: new Date(now - 1000 * 60 * 20).toISOString() },
      { id: 'c3', post_id: 'demo-2', nickname: '二楼的人', content: '我也看到了！整个走廊都在拍照', created_at: new Date(now - 1000 * 60 * 200).toISOString() },
      { id: 'c4', post_id: 'demo-2', nickname: '摄影社', content: '下次可以来参加我们的晚霞拍摄活动', created_at: new Date(now - 1000 * 60 * 180).toISOString() },
      { id: 'c5', post_id: 'demo-2', nickname: '匿名同学', content: '+1', created_at: new Date(now - 1000 * 60 * 120).toISOString() }
    ];
    demoWrite(DEMO_COMMENTS, comments);
    demoWrite(DEMO_LIKES, {});
  }

  function demoLikeSet() {
    const all = demoRead(DEMO_LIKES, {});
    if (!Array.isArray(all[CLIENT_ID])) all[CLIENT_ID] = [];
    return all;
  }

  /* ===========================================================
     统一 API
     =========================================================== */
  const Wall = {
    ready: BACKEND_READY,
    clientId: CLIENT_ID,
    _sb: sb,
    compressImage,

    /* -------- 帖子列表 -------- */
    async listPosts(sort, category) {
      sort = sort || 'new';

      if (!BACKEND_READY) {
        demoSeed();
        let list = demoRead(DEMO_POSTS, []).filter(p => p.status === 'approved');
        if (category) list = list.filter(p => (p.category || '灌水贴') === category);
        list.sort((a, b) => {
          // 置顶永远在最前
          if (!!b.is_pinned !== !!a.is_pinned) return b.is_pinned ? 1 : -1;
          return sort === 'hot'
            ? (b.like_count - a.like_count) || (new Date(b.created_at) - new Date(a.created_at))
            : (new Date(b.created_at) - new Date(a.created_at));
        });
        const likes = demoLikeSet()[CLIENT_ID] || [];
        return list.map(p => Object.assign({}, p, { liked_by_me: likes.indexOf(p.id) >= 0 }));
      }

      let q = sb.from('posts')
        .select('id,nickname,content,image_url,status,like_count,comment_count,created_at,approved_at,author_id,is_anonymous,is_pinned,pinned_at,category')
        .eq('status', 'approved')
        .limit(60);

      if (category) q = q.eq('category', category);

      // 置顶优先，其次按所选排序
      q = q.order('is_pinned', { ascending: false });
      q = sort === 'hot'
        ? q.order('like_count', { ascending: false }).order('created_at', { ascending: false })
        : q.order('created_at', { ascending: false });

      let res = await q;

      // 降级：如果数据库还没跑 v3 迁移（没有 category 列），
      // 不能整个首页白屏，退回旧字段继续展示
      if (res.error && /category/i.test(res.error.message || '')) {
        let q2 = sb.from('posts')
          .select('id,nickname,content,image_url,status,like_count,comment_count,created_at,approved_at,author_id,is_anonymous,is_pinned,pinned_at')
          .eq('status', 'approved')
          .limit(60)
          .order('is_pinned', { ascending: false });
        q2 = sort === 'hot'
          ? q2.order('like_count', { ascending: false }).order('created_at', { ascending: false })
          : q2.order('created_at', { ascending: false });
        res = await q2;
        if (!res.error) console.warn('[wall] 数据库缺少 v3 字段，已降级显示（请跑 migration-v3.sql）');
      }

      if (res.error) throw new Error(res.error.message || '加载失败');

      const data = res.data;

      // 标记"我点过赞"：拿本地点赞缓存对照
      const mine = getLikedCache();
      return (data || []).map(p => Object.assign({}, p, { liked_by_me: mine.indexOf(p.id) >= 0 }));
    },

    /* -------- 发帖（进待审核队列）-------- */
    async submitPost(opts) {
      const nickname = (opts.nickname || '').trim().slice(0, 20);
      const content = (opts.content || '').trim();
      let imageUrl = null;

      if (content.length < 2) throw new Error('内容太短了，至少写 2 个字');

      if (opts.imageBlob) {
        if (!BACKEND_READY) {
          imageUrl = await blobToDataUrl(opts.imageBlob);
        } else {
          const path = 'p/' + Date.now() + '-' + Math.random().toString(36).slice(2, 8) + '.jpg';
          const { error: upErr } = await sb.storage.from(BUCKET).upload(path, opts.imageBlob, {
            contentType: 'image/jpeg',
            cacheControl: '31536000',
            upsert: false
          });
          if (upErr) throw new Error('图片上传失败：' + upErr.message);
          const { data: pub } = sb.storage.from(BUCKET).getPublicUrl(path);
          imageUrl = pub ? pub.publicUrl : null;
        }
      }

      if (!BACKEND_READY) {
        demoSeed();
        const posts = demoRead(DEMO_POSTS, []);
        posts.unshift({
          id: 'p_' + Date.now().toString(36),
          nickname: nickname || '匿名同学',
          content,
          image_url: imageUrl,
          status: 'pending',
          category: opts.category || '灌水贴',
          is_pinned: false,
          like_count: 0,
          comment_count: 0,
          created_at: new Date().toISOString()
        });
        demoWrite(DEMO_POSTS, posts);
        return { ok: true, pending: true };
      }

      const { error } = await sb.rpc('submit_post', {
        p_nickname: nickname || null,
        p_content: content,
        p_image_url: imageUrl,
        p_anonymous: !!opts.anonymous,
        p_category: opts.category || '灌水贴',
        p_fp: CLIENT_ID
      });
      if (error) throw new Error(error.message || '提交失败');
      return { ok: true, pending: true };
    },

    /* -------- 点赞 / 取消 -------- */
    async toggleLike(postId) {
      if (!BACKEND_READY) {
        demoSeed();
        const all = demoLikeSet();
        const mine = all[CLIENT_ID];
        const posts = demoRead(DEMO_POSTS, []);
        const post = posts.find(p => p.id === postId);
        if (!post) throw new Error('帖子不存在');

        const i = mine.indexOf(postId);
        let liked;
        if (i >= 0) { mine.splice(i, 1); post.like_count = Math.max(0, post.like_count - 1); liked = false; }
        else { mine.push(postId); post.like_count = (post.like_count || 0) + 1; liked = true; }

        demoWrite(DEMO_LIKES, all);
        demoWrite(DEMO_POSTS, posts);
        return { liked, like_count: post.like_count };
      }

      const { data, error } = await sb.rpc('toggle_like', {
        p_post_id: postId,
        p_client_id: CLIENT_ID
      });
      if (error) throw new Error(error.message || '操作失败');

      const mine = getLikedCache();
      const i = mine.indexOf(postId);
      if (data.liked && i < 0) mine.push(postId);
      if (!data.liked && i >= 0) mine.splice(i, 1);
      setLikedCache(mine);

      return { liked: data.liked, like_count: data.like_count };
    },

    /* -------- 评论 -------- */
    async listComments(postId) {
      if (!BACKEND_READY) {
        return demoRead(DEMO_COMMENTS, [])
          .filter(c => c.post_id === postId)
          .sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
      }
      const { data, error } = await sb.rpc('list_comments', { p_post_id: postId });
      if (error) throw new Error(error.message || '加载评论失败');
      const list = typeof data === 'string' ? JSON.parse(data) : (data || []);
      return Array.isArray(list) ? list : [];
    },

    async addComment(postId, nickname, content, parentId) {
      content = (content || '').trim();
      if (!content) throw new Error('评论不能为空');

      if (!BACKEND_READY) {
        demoSeed();
        const all = demoRead(DEMO_COMMENTS, []);
        const parent = parentId ? all.find(c => c.id === parentId) : null;
        // 只允许两层：回复"回复"时挂回它的一楼
        const realParent = parent ? (parent.parent_id || parent.id) : null;
        const parentRow = realParent ? (all.find(c => c.id === realParent) || parent) : null;

        const row = {
          id: 'c_' + Date.now().toString(36),
          post_id: postId,
          nickname: (nickname || '').trim() || '匿名同学',
          content: content.slice(0, 300),
          parent_id: realParent,
          reply_to: parentRow ? parentRow.nickname : null,
          created_at: new Date().toISOString()
        };
        all.push(row);
        demoWrite(DEMO_COMMENTS, all);
        const posts = demoRead(DEMO_POSTS, []);
        const p = posts.find(x => x.id === postId);
        if (p) { p.comment_count = (p.comment_count || 0) + 1; demoWrite(DEMO_POSTS, posts); }
        return row;
      }

      const { data, error } = await sb.rpc('add_comment', {
        p_post_id: postId,
        p_nickname: (nickname || '').trim() || '匿名同学',
        p_content: content,
        p_parent: parentId || null,
        p_fp: CLIENT_ID
      });
      if (error) throw new Error(error.message || '评论失败');
      return data;
    },

    /* =========================================================
       以下：后台管理
       ========================================================= */

    async adminSignIn(email, password) {
      if (!BACKEND_READY) return { demo: true };
      const { data, error } = await adminSb.auth.signInWithPassword({ email, password });
      if (error) throw new Error(error.message || '登录失败');
      return data;
    },

    async adminSignOut() {
      if (!BACKEND_READY) return;
      await adminSb.auth.signOut();
    },

    async currentUser() {
      if (!BACKEND_READY) return { demo: true };
      const { data } = await adminSb.auth.getUser();
      return data ? data.user : null;
    },

    async isAdmin() {
      if (!BACKEND_READY) return true;
      const { data, error } = await adminSb.from('admins').select('user_id').limit(1);
      if (error) return false;
      return !!(data && data.length);
    },

    async adminListPosts(status) {
      if (!BACKEND_READY) {
        demoSeed();
        const all = demoRead(DEMO_POSTS, []);
        const list = status ? all.filter(p => p.status === status) : all;
        return list.slice().sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
      }
      let q = adminSb.from('posts').select('*').limit(200);
      if (status) q = q.eq('status', status);
      const { data, error } = await q.order('created_at', { ascending: false });
      if (error) throw new Error(error.message || '加载失败');
      return data || [];
    },

    async adminSetStatus(postId, status, reason) {
      if (!BACKEND_READY) {
        const posts = demoRead(DEMO_POSTS, []);
        const p = posts.find(x => x.id === postId);
        if (!p) throw new Error('帖子不存在');
        p.status = status;
        p.reject_reason = reason || null;
        if (status === 'approved') p.approved_at = new Date().toISOString();
        demoWrite(DEMO_POSTS, posts);
        return true;
      }
      const patch = { status };
      if (status === 'approved') patch.approved_at = new Date().toISOString();
      if (status === 'rejected') patch.reject_reason = reason || '不符合校园墙规范';
      const { error } = await adminSb.from('posts').update(patch).eq('id', postId);
      if (error) throw new Error(error.message || '操作失败');
      return true;
    },

    /* -------- 置顶 / 取消置顶 -------- */
    async adminSetPinned(postId, pinned) {
      if (!BACKEND_READY) {
        const posts = demoRead(DEMO_POSTS, []);
        const p = posts.find(x => x.id === postId);
        if (!p) throw new Error('帖子不存在');
        p.is_pinned = !!pinned;
        p.pinned_at = pinned ? new Date().toISOString() : null;
        demoWrite(DEMO_POSTS, posts);
        return true;
      }
      const { error } = await adminSb.rpc('admin_set_pinned', {
        p_post_id: postId, p_pinned: !!pinned
      });
      if (error) throw new Error(error.message || '操作失败');
      return true;
    },

    async adminDeletePost(postId) {
      if (!BACKEND_READY) {
        demoWrite(DEMO_POSTS, demoRead(DEMO_POSTS, []).filter(p => p.id !== postId));
        demoWrite(DEMO_COMMENTS, demoRead(DEMO_COMMENTS, []).filter(c => c.post_id !== postId));
        return true;
      }
      const { error } = await adminSb.from('posts').delete().eq('id', postId);
      if (error) throw new Error(error.message || '删除失败');
      return true;
    },

    /* -------- 搜索帖子 -------- */
    async searchPosts(keyword) {
      const q = (keyword || '').trim();
      if (!q) return [];

      if (!BACKEND_READY) {
        demoSeed();
        const kw = q.toLowerCase();
        return demoRead(DEMO_POSTS, [])
          .filter(p => p.status === 'approved' &&
            ((p.content || '').toLowerCase().includes(kw) ||
             (p.nickname || '').toLowerCase().includes(kw)))
          .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
          .slice(0, 40);
      }

      const { data, error } = await sb.rpc('search_posts', { p_q: q, p_limit: 40 });
      if (error) {
        if (/search_posts|schema cache|does not exist/i.test(error.message || '')) {
          throw new Error('搜索功能需要先跑 migration-v3.sql');
        }
        throw new Error(error.message || '搜索失败');
      }
      const list = typeof data === 'string' ? JSON.parse(data) : (data || []);
      const mine = getLikedCache();
      return (Array.isArray(list) ? list : []).map(p => Object.assign({}, p, {
        liked_by_me: mine.indexOf(p.id) >= 0
      }));
    },

    /* -------- 封禁状态检查 -------- */
    async checkBan() {
      if (!BACKEND_READY) return { banned: false };
      try {
        const { data, error } = await sb.rpc('check_ban', { p_fp: CLIENT_ID });
        if (error) return { banned: false };
        return typeof data === 'string' ? JSON.parse(data) : (data || { banned: false });
      } catch (e) { return { banned: false }; }
    },

    /* =========================================================
       管理员：任命 / 撤销 / 封禁
       ========================================================= */

    async listAdmins() {
      if (!BACKEND_READY) return [];
      const { data, error } = await adminSb.rpc('list_admins');
      if (error) throw new Error(error.message || '加载管理员失败');
      const list = typeof data === 'string' ? JSON.parse(data) : (data || []);
      return Array.isArray(list) ? list : [];
    },

    async searchProfiles(q) {
      if (!BACKEND_READY) return [];
      const { data, error } = await adminSb.rpc('search_profiles', { p_q: q || '' });
      if (error) throw new Error(error.message || '搜索失败');
      const list = typeof data === 'string' ? JSON.parse(data) : (data || []);
      return Array.isArray(list) ? list : [];
    },

    async promoteAdmin(userId) {
      if (!BACKEND_READY) throw new Error('演示模式不可用');
      const { data, error } = await adminSb.rpc('promote_admin', { p_target: userId });
      if (error) throw new Error(error.message || '任命失败');
      return data;
    },

    async demoteAdmin(userId) {
      if (!BACKEND_READY) throw new Error('演示模式不可用');
      const { data, error } = await adminSb.rpc('demote_admin', { p_target: userId });
      if (error) throw new Error(error.message || '撤销失败');
      return data;
    },

    async adminBan(opts) {
      if (!BACKEND_READY) throw new Error('演示模式不可用');
      const { data, error } = await adminSb.rpc('admin_ban', {
        p_user: opts.userId || null,
        p_device: opts.device || null,
        p_reason: opts.reason || '违反校园墙规范',
        p_days: opts.days == null ? null : opts.days
      });
      if (error) throw new Error(error.message || '封禁失败');
      return data;
    },

    async adminUnban(banId) {
      if (!BACKEND_READY) throw new Error('演示模式不可用');
      const { data, error } = await adminSb.rpc('admin_unban', { p_ban_id: banId });
      if (error) throw new Error(error.message || '解封失败');
      return data;
    },

    async adminListBans() {
      if (!BACKEND_READY) return [];
      const { data, error } = await adminSb.rpc('admin_list_bans');
      if (error) throw new Error(error.message || '加载封禁列表失败');
      const list = typeof data === 'string' ? JSON.parse(data) : (data || []);
      return Array.isArray(list) ? list : [];
    },

    /* -------- 昵称是否被占用 -------- */
    async nicknameTaken(nick) {
      const n = (nick || '').trim();
      if (!n) return false;
      if (!BACKEND_READY) {
        const prof = JSON.parse(localStorage.getItem('campuswall_profile') || 'null');
        return !!(prof && prof.nickname && prof.nickname.toLowerCase() === n.toLowerCase());
      }
      const { data, error } = await sb.rpc('nickname_taken', {
        p_nick: n, p_ignore_self: true
      });
      if (error) return false;
      return !!data;
    },

    async adminStats() {
      if (!BACKEND_READY) {
        demoSeed();
        const all = demoRead(DEMO_POSTS, []);
        return {
          pending: all.filter(p => p.status === 'pending').length,
          approved: all.filter(p => p.status === 'approved').length,
          likes: all.reduce((s, p) => s + (p.like_count || 0), 0),
          comments: all.reduce((s, p) => s + (p.comment_count || 0), 0)
        };
      }
      const [pend, appr, allp] = await Promise.all([
        adminSb.from('posts').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
        adminSb.from('posts').select('id', { count: 'exact', head: true }).eq('status', 'approved'),
        adminSb.from('posts').select('like_count,comment_count').eq('status', 'approved').limit(1000)
      ]);
      const rows = allp.data || [];
      return {
        pending: pend.count || 0,
        approved: appr.count || 0,
        likes: rows.reduce((s, r) => s + (r.like_count || 0), 0),
        comments: rows.reduce((s, r) => s + (r.comment_count || 0), 0)
      };
    }
  };

  /* ---------- 本地"我点过赞"缓存 ---------- */
  function getLikedCache() {
    try {
      const raw = localStorage.getItem('campuswall_liked');
      return raw ? JSON.parse(raw) : [];
    } catch (e) { return []; }
  }
  function setLikedCache(arr) {
    try { localStorage.setItem('campuswall_liked', JSON.stringify(arr.slice(-800))); } catch (e) {}
  }

  function blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(fr.result);
      fr.onerror = () => reject(new Error('图片读取失败'));
      fr.readAsDataURL(blob);
    });
  }

  window.Wall = Wall;
})();
