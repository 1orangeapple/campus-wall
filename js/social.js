/* ===========================================================
   霞浦三小校园墙 · 身份 / 好友 / 私聊
   -----------------------------------------------------------
   身份用 Supabase 匿名登录：不用注册、不用密码，打开就有一个
   真实的 auth 身份。好处是好友和消息有真正的权限隔离，
   别人没法冒充你。
   =========================================================== */

(function () {
  'use strict';

  const cfg = window.WALL_CONFIG || {};
  const BACKEND_READY = !!(cfg.SUPABASE_URL && cfg.SUPABASE_ANON_KEY && window.supabase);

  let sb = null;
  if (BACKEND_READY) {
    // 复用 store.js 已经建好的客户端，避免出现两个 GoTrueClient 实例
    sb = (window.Wall && window.Wall._sb) || window.supabase.createClient(
      cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY, {
        auth: { persistSession: true, autoRefreshToken: true },
        db: { schema: 'public' }
      }
    );
  }

  const AVATARS = [
    '🐣', '🐱', '🐶', '🐼', '🦊', '🐰', '🐨', '🐯',
    '🦁', '🐷', '🐸', '🐵', '🐧', '🐳', '🦄', '🌟',
    '🍊', '🍓', '🍉', '🌊', '🌻', '⚽', '🎈', '🚀'
  ];

  const LS_PROFILE = 'campuswall_profile';

  const Social = {
    ready: false,
    uid: null,
    profile: null,
    demo: !BACKEND_READY,
    AVATARS: AVATARS,
    _sb: sb,

    /* ================= 初始化 ================= */

    async init() {
      if (!BACKEND_READY) {
        this.uid = 'demo-' + (localStorage.getItem('campuswall_client_id') || 'me');
        this.profile = this._loadLocalProfile() || {
          id: this.uid, nickname: '', avatar: '🐣', bio: ''
        };
        this.ready = true;
        return this.profile;
      }

      try {
        const { data: sess } = await sb.auth.getSession();
        let user = sess && sess.session ? sess.session.user : null;

        if (!user) {
          const { data, error } = await sb.auth.signInAnonymously();
          if (error) throw error;
          user = data.user;
        }
        this.uid = user.id;

        // 拉档案；trigger 可能还没跑完，最多重试 5 次
        for (let i = 0; i < 5; i++) {
          const { data, error } = await sb.rpc('my_profile');
          if (!error && data) {
            this.profile = typeof data === 'string' ? JSON.parse(data) : data;
            break;
          }
          await new Promise(r => setTimeout(r, 300));
        }

        if (!this.profile) {
          this.profile = { id: this.uid, nickname: '', avatar: '🐣', bio: '' };
        }

        this.ready = true;
        return this.profile;
      } catch (err) {
        console.warn('[Social] 初始化失败：', err && err.message);
        this.ready = false;
        this.error = err && err.message;
        return null;
      }
    },

    isAnonymousSignInEnabled() {
      return !this.error || !/anonymous/i.test(this.error);
    },

    displayName() {
      const p = this.profile || {};
      return p.nickname || '同学';
    },

    /* ================= 资料 ================= */

    async saveProfile(patch) {
      const next = {
        nickname: (patch.nickname || '').trim(),
        avatar: patch.avatar || (this.profile && this.profile.avatar) || '🐣',
        bio: (patch.bio || '').trim()
      };

      if (!next.nickname) throw new Error('昵称不能为空');
      if (next.nickname.length > 12) throw new Error('昵称最多 12 个字');
      if (next.bio.length > 60) throw new Error('签名最多 60 个字');

      if (!BACKEND_READY) {
        this.profile = Object.assign({}, this.profile, next);
        this._saveLocalProfile(this.profile);
        return this.profile;
      }

      const { data, error } = await sb.rpc('update_my_profile', {
        p_nickname: next.nickname,
        p_avatar: next.avatar,
        p_bio: next.bio
      });
      if (error) throw new Error(error.message || '保存失败');

      this.profile = typeof data === 'string' ? JSON.parse(data) : data;
      return this.profile;
    },

    _loadLocalProfile() {
      try {
        const raw = localStorage.getItem(LS_PROFILE);
        return raw ? JSON.parse(raw) : null;
      } catch (e) { return null; }
    },
    _saveLocalProfile(p) {
      try { localStorage.setItem(LS_PROFILE, JSON.stringify(p)); } catch (e) {}
    },

    /* ================= 好友 ================= */

    async relation(userId) {
      if (!userId) return { state: 'none' };
      if (userId === this.uid) return { state: 'self' };
      if (!BACKEND_READY) return { state: 'demo' };

      const { data, error } = await sb.rpc('relation_with', { p_user: userId });
      if (error) return { state: 'none' };
      return typeof data === 'string' ? JSON.parse(data) : data;
    },

    async addFriend(userId) {
      if (!BACKEND_READY) throw new Error('演示模式不能加好友');
      const { data, error } = await sb.rpc('send_friend_request', { p_target: userId });
      if (error) throw new Error(error.message || '发送申请失败');
      return typeof data === 'string' ? JSON.parse(data) : data;
    },

    async respondRequest(id, accept) {
      if (!BACKEND_READY) throw new Error('演示模式不能处理申请');
      const { data, error } = await sb.rpc('respond_friend_request', {
        p_id: id, p_accept: !!accept
      });
      if (error) throw new Error(error.message || '处理失败');
      return data;
    },

    async listFriends() {
      if (!BACKEND_READY) {
        return this._loadLocalFriends();
      }
      const { data, error } = await sb.rpc('list_friends');
      if (error) throw new Error(error.message || '加载好友失败');
      const list = typeof data === 'string' ? JSON.parse(data) : (data || []);
      return Array.isArray(list) ? list : [];
    },

    async listRequests() {
      if (!BACKEND_READY) return [];
      const { data, error } = await sb.rpc('list_friend_requests');
      if (error) return [];
      const list = typeof data === 'string' ? JSON.parse(data) : (data || []);
      return Array.isArray(list) ? list : [];
    },

    _loadLocalFriends() {
      try {
        const raw = localStorage.getItem('campuswall_demo_friends');
        return raw ? JSON.parse(raw) : [];
      } catch (e) { return []; }
    },

    /* ================= 消息 ================= */

    async sendMessage(toId, content) {
      const text = (content || '').trim();
      if (!text) throw new Error('消息不能为空');

      if (!BACKEND_READY) {
        const key = 'campuswall_demo_msgs';
        let all = {};
        try { all = JSON.parse(localStorage.getItem(key) || '{}'); } catch (e) {}
        const arr = all[toId] || [];
        const row = {
          id: 'm_' + Date.now(),
          sender: this.uid,
          receiver: toId,
          content: text.slice(0, 500),
          created_at: new Date().toISOString()
        };
        arr.push(row);
        all[toId] = arr;
        try { localStorage.setItem(key, JSON.stringify(all)); } catch (e) {}
        return row;
      }

      const { data, error } = await sb.rpc('send_message', { p_to: toId, p_content: text });
      if (error) throw new Error(error.message || '发送失败');
      return typeof data === 'string' ? JSON.parse(data) : data;
    },

    async listMessages(peerId, before) {
      if (!BACKEND_READY) {
        try {
          const all = JSON.parse(localStorage.getItem('campuswall_demo_msgs') || '{}');
          return all[peerId] || [];
        } catch (e) { return []; }
      }
      const { data, error } = await sb.rpc('list_messages', {
        p_peer: peerId, p_limit: 50, p_before: before || null
      });
      if (error) throw new Error(error.message || '加载消息失败');
      const list = typeof data === 'string' ? JSON.parse(data) : (data || []);
      return Array.isArray(list) ? list : [];
    },

    async markRead(peerId) {
      if (!BACKEND_READY) return 0;
      const { data } = await sb.rpc('mark_read', { p_peer: peerId });
      return data || 0;
    },

    async unreadTotal() {
      if (!BACKEND_READY) return 0;
      const { data, error } = await sb.rpc('unread_total');
      if (error) return 0;
      return data || 0;
    },

    async getProfile(userId) {
      if (!BACKEND_READY) {
        if (userId === this.uid) return this.profile;
        return { id: userId, nickname: '演示同学', avatar: '🐣', bio: '' };
      }
      const { data, error } = await sb.from('profiles')
        .select('id,nickname,avatar,bio').eq('id', userId).maybeSingle();
      if (error || !data) return null;
      return data;
    },

    /* ================= 实时 ================= */

    _channels: [],

    /** 收到新消息时回调；返回取消函数 */
    onNewMessage(cb) {
      if (!BACKEND_READY || !this.uid) return function () {};
      const ch = sb.channel('rt-msg-' + this.uid)
        .on('postgres_changes', {
          event: 'INSERT', schema: 'public', table: 'messages',
          filter: 'receiver=eq.' + this.uid
        }, payload => cb(payload.new))
        .subscribe();
      this._channels.push(ch);
      return () => { try { sb.removeChannel(ch); } catch (e) {} };
    },

    /** 收到好友申请时回调 */
    onFriendRequest(cb) {
      if (!BACKEND_READY || !this.uid) return function () {};
      const ch = sb.channel('rt-fr-' + this.uid)
        .on('postgres_changes', {
          event: '*', schema: 'public', table: 'friendships',
          filter: 'addressee=eq.' + this.uid
        }, payload => cb(payload.new))
        .subscribe();
      this._channels.push(ch);
      return () => { try { sb.removeChannel(ch); } catch (e) {} };
    },

    /** 好友申请被同意时回调（我申请别人的场景） */
    onFriendAccepted(cb) {
      if (!BACKEND_READY || !this.uid) return function () {};
      const ch = sb.channel('rt-fa-' + this.uid)
        .on('postgres_changes', {
          event: 'UPDATE', schema: 'public', table: 'friendships',
          filter: 'requester=eq.' + this.uid
        }, payload => cb(payload.new))
        .subscribe();
      this._channels.push(ch);
      return () => { try { sb.removeChannel(ch); } catch (e) {} };
    }
  };

  window.Social = Social;
})();
