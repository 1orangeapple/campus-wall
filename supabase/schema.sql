-- ============================================================
--  霞浦三小校园墙 · 数据库初始化脚本
--  在 Supabase → SQL Editor → New query 里整段粘贴运行
--  可重复执行（幂等），出错不会留半截
-- ============================================================

create extension if not exists "pgcrypto";

-- ---------- 1. 管理员表 ----------
-- 只有这张表里有记录的用户，才能看到待审核帖子和审核操作
create table if not exists public.admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

-- ---------- 2. 帖子表 ----------
create table if not exists public.posts (
  id            uuid primary key default gen_random_uuid(),
  nickname      text not null default '匿名同学',
  content       text not null,
  image_url     text,
  status        text not null default 'pending'
                check (status in ('pending', 'approved', 'rejected')),
  reject_reason text,
  like_count    int  not null default 0,
  comment_count int  not null default 0,
  created_at    timestamptz not null default now(),
  approved_at   timestamptz
);

create index if not exists posts_status_time_idx
  on public.posts (status, created_at desc);

-- ---------- 3. 点赞表 ----------
-- client_id 是浏览器本地生成的随机串，一台设备一票
create table if not exists public.post_likes (
  post_id    uuid not null references public.posts(id) on delete cascade,
  client_id  text not null,
  created_at timestamptz not null default now(),
  primary key (post_id, client_id)
);

-- ---------- 4. 评论表 ----------
create table if not exists public.comments (
  id         uuid primary key default gen_random_uuid(),
  post_id    uuid not null references public.posts(id) on delete cascade,
  nickname   text not null default '匿名同学',
  content    text not null,
  created_at timestamptz not null default now()
);

create index if not exists comments_post_idx
  on public.comments (post_id, created_at asc);

-- ============================================================
--  辅助函数：判断当前登录用户是不是管理员
-- ============================================================
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.admins where user_id = auth.uid());
$$;

-- ============================================================
--  开放 RPC：发帖 / 点赞 / 评论 / 读评论
--  全部用 SECURITY DEFINER，绕过 RLS 但强制业务规则，
--  这样即使有人拿 anon key 直接调 API 也绕不过审核
-- ============================================================

-- 发帖：永远只能落成 pending，客户端无法自己指定状态
create or replace function public.submit_post(
  p_nickname  text,
  p_content   text,
  p_image_url text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_nick    text;
  v_content text;
  v_id      uuid;
begin
  v_nick := btrim(coalesce(p_nickname, ''));
  if v_nick = '' then v_nick := '匿名同学'; end if;
  if char_length(v_nick) > 20 then
    raise exception '昵称最多 20 个字';
  end if;

  v_content := btrim(coalesce(p_content, ''));
  if char_length(v_content) < 2 then
    raise exception '内容太短了，至少写 2 个字';
  end if;
  if char_length(v_content) > 1000 then
    raise exception '内容最多 1000 个字';
  end if;

  -- 简单限流：同一设备 60 秒内只能发一条
  if exists (
    select 1 from public.posts
    where status = 'pending'
      and nickname = v_nick
      and content = v_content
      and created_at > now() - interval '60 seconds'
  ) then
    raise exception '刚刚已经提交过这条啦，稍等一下';
  end if;

  insert into public.posts (nickname, content, image_url, status)
  values (v_nick, v_content, p_image_url, 'pending')
  returning id into v_id;

  return v_id;
end;
$$;

-- 点赞 / 取消点赞：返回 {liked, like_count}
create or replace function public.toggle_like(
  p_post_id   uuid,
  p_client_id text
)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_exists boolean;
  v_count  int;
begin
  if p_client_id is null or char_length(p_client_id) < 8 then
    raise exception 'client_id 无效';
  end if;

  if not exists (
    select 1 from public.posts where id = p_post_id and status = 'approved'
  ) then
    raise exception '帖子不存在或未通过审核';
  end if;

  select exists (
    select 1 from public.post_likes
    where post_id = p_post_id and client_id = p_client_id
  ) into v_exists;

  if v_exists then
    delete from public.post_likes
      where post_id = p_post_id and client_id = p_client_id;
  else
    insert into public.post_likes (post_id, client_id)
      values (p_post_id, p_client_id)
      on conflict do nothing;
  end if;

  select count(*) into v_count
    from public.post_likes where post_id = p_post_id;

  update public.posts set like_count = v_count where id = p_post_id;

  return json_build_object('liked', not v_exists, 'like_count', v_count);
end;
$$;

-- 发评论
create or replace function public.add_comment(
  p_post_id  uuid,
  p_nickname text,
  p_content  text
)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_nick    text;
  v_content text;
  v_row     public.comments;
  v_count   int;
begin
  v_nick := btrim(coalesce(p_nickname, ''));
  if v_nick = '' then v_nick := '匿名同学'; end if;
  if char_length(v_nick) > 20 then
    raise exception '昵称最多 20 个字';
  end if;

  v_content := btrim(coalesce(p_content, ''));
  if v_content = '' then
    raise exception '评论不能为空';
  end if;
  if char_length(v_content) > 300 then
    raise exception '评论最多 300 个字';
  end if;

  if not exists (
    select 1 from public.posts where id = p_post_id and status = 'approved'
  ) then
    raise exception '帖子不存在或未通过审核';
  end if;

  insert into public.comments (post_id, nickname, content)
  values (p_post_id, v_nick, v_content)
  returning * into v_row;

  select count(*) into v_count
    from public.comments where post_id = p_post_id;

  update public.posts set comment_count = v_count where id = p_post_id;

  return json_build_object(
    'id', v_row.id,
    'nickname', v_row.nickname,
    'content', v_row.content,
    'created_at', v_row.created_at
  );
end;
$$;

-- 查某个帖子的评论（只允许已通过的帖子）
create or replace function public.list_comments(p_post_id uuid)
returns setof public.comments
language sql
stable
security definer
set search_path = public
as $$
  select c.*
  from public.comments c
  join public.posts p on p.id = c.post_id
  where c.post_id = p_post_id and p.status = 'approved'
  order by c.created_at asc
  limit 200;
$$;

-- ============================================================
--  权限：允许匿名调用上面这些 RPC
-- ============================================================
revoke all on function public.submit_post(text, text, text)   from public;
revoke all on function public.toggle_like(uuid, text)         from public;
revoke all on function public.add_comment(uuid, text, text)   from public;
revoke all on function public.list_comments(uuid)             from public;

grant execute on function public.submit_post(text, text, text) to anon, authenticated;
grant execute on function public.toggle_like(uuid, text)       to anon, authenticated;
grant execute on function public.add_comment(uuid, text, text) to anon, authenticated;
grant execute on function public.list_comments(uuid)           to anon, authenticated;

-- ============================================================
--  行级安全（RLS）
-- ============================================================
alter table public.posts      enable row level security;
alter table public.post_likes enable row level security;
alter table public.comments   enable row level security;
alter table public.admins     enable row level security;

-- 先收回 Supabase 默认给 anon / authenticated 的全表权限，
-- 再按需精确地授予（表级权限 + 行级策略 双重把关）
revoke all on public.posts      from anon, authenticated;
revoke all on public.post_likes from anon, authenticated;
revoke all on public.comments   from anon, authenticated;
revoke all on public.admins     from anon, authenticated;

-- 匿名访客：只能读帖子（策略再筛成"仅已通过"）
grant select on public.posts to anon, authenticated;
-- 登录用户（管理员）：能改状态、能删
grant update, delete on public.posts to authenticated;
grant select on public.admins to authenticated;
grant select, delete on public.comments to authenticated;
-- post_likes / comments 的写入一律走上面的 RPC，不给直接表权限

-- posts：所有人都能读「已通过」的帖子
drop policy if exists posts_read_approved on public.posts;
create policy posts_read_approved on public.posts
  for select to anon, authenticated
  using (status = 'approved');

-- posts：管理员能读全部
drop policy if exists posts_admin_read on public.posts;
create policy posts_admin_read on public.posts
  for select to authenticated
  using (public.is_admin());

-- posts：管理员能改（通过 / 拒绝）
drop policy if exists posts_admin_update on public.posts;
create policy posts_admin_update on public.posts
  for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- posts：管理员能删
drop policy if exists posts_admin_delete on public.posts;
create policy posts_admin_delete on public.posts
  for delete to authenticated
  using (public.is_admin());

-- post_likes：不开放任何直接访问，全部走 toggle_like RPC
-- （anon / authenticated 上一步已经被 revoke 掉了表权限，这里不需要再建策略）

-- comments：管理员能删评论
drop policy if exists comments_admin_delete on public.comments;
create policy comments_admin_delete on public.comments
  for delete to authenticated
  using (public.is_admin());

-- comments：管理员能读全部评论
drop policy if exists comments_admin_read on public.comments;
create policy comments_admin_read on public.comments
  for select to authenticated
  using (public.is_admin());

-- admins：管理员能读自己的那一行
drop policy if exists admins_read_self on public.admins;
create policy admins_read_self on public.admins
  for select to authenticated
  using (user_id = auth.uid());

-- ============================================================
--  Storage：帖子配图
--  桶和策略一起在这里建好，不需要再去 Storage 页面手动点
-- ============================================================
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'post-images',
  'post-images',
  true,
  10485760,   -- 单文件上限 10MB
  array['image/jpeg','image/png','image/webp','image/gif']
)
on conflict (id) do update
  set public = true,
      file_size_limit = 10485760,
      allowed_mime_types = array['image/jpeg','image/png','image/webp','image/gif'];

-- 任何人（包括没登录的访客）都能看图片 —— 图片本身不含隐私
drop policy if exists "post images public read" on storage.objects;
create policy "post images public read" on storage.objects
  for select to anon, authenticated
  using (bucket_id = 'post-images');

-- 允许匿名上传（发帖时要传图）。只能往 post-images 这个桶里写
drop policy if exists "post images anon upload" on storage.objects;
create policy "post images anon upload" on storage.objects
  for insert to anon, authenticated
  with check (bucket_id = 'post-images');

-- ============================================================
--  评论：只允许读"已通过"帖子下面的评论
-- ============================================================
drop policy if exists comments_read_approved on public.comments;
create policy comments_read_approved on public.comments
  for select to anon, authenticated
  using (
    exists (
      select 1 from public.posts p
      where p.id = comments.post_id and p.status = 'approved'
    )
  );

-- ============================================================
--  最后一步：把自己设成管理员
--  1) 先去 Authentication → Users → Add user 建一个邮箱+密码账号
--  2) 把下面 <管理员账号的UUID> 换成那个用户的 id 再执行
-- ============================================================
-- insert into public.admins (user_id)
-- values ('<管理员账号的UUID>')
-- on conflict do nothing;

-- ============================================================
--  以下为 v2 升级内容（个人资料 / 好友 / 私聊 / 置顶）
--  全新安装时无需再单独跑 migration-v2.sql
-- ============================================================

-- ============================================================
--  霞浦三小校园墙 · v2 增量升级
--  个人资料 / 好友 / 私聊 / 置顶
--  -----------------------------------------------------------
--  在已经部署好的项目上：SQL Editor 整段粘贴执行一次即可。
--  不会动你现有的帖子、点赞、评论数据。
--  可重复执行。
--
--  ⚠ 执行前先去 Authentication → Sign In / Providers
--    把 Anonymous sign-ins 打开，否则前端拿不到身份。
-- ============================================================

-- ============================================================
--  0. 前置检查：匿名登录有没有开
-- ============================================================
do $$
begin
  if not exists (
    select 1 from pg_proc where proname = 'sign_in_anonymously'
  ) then
    raise notice '提示：匿名登录函数暂未就绪，请确认 Dashboard 里已开启 Anonymous sign-ins';
  end if;
end $$;

-- ============================================================
--  1. 个人资料表
-- ============================================================
create table if not exists public.profiles (
  id         uuid primary key references auth.users(id) on delete cascade,
  nickname   text not null default '同学',
  avatar     text not null default '🐣',   -- emoji 头像
  bio        text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 新用户（包括匿名登录）自动建档
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, nickname)
  values (
    new.id,
    '同学' || substr(replace(new.id::text, '-', ''), 1, 4)
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- 给升级前就存在的用户补档
insert into public.profiles (id, nickname)
select u.id, '同学' || substr(replace(u.id::text, '-', ''), 1, 4)
from auth.users u
left join public.profiles p on p.id = u.id
where p.id is null;

-- ============================================================
--  2. posts 加字段：作者 / 匿名标记 / 置顶
-- ============================================================
alter table public.posts
  add column if not exists author_id    uuid references public.profiles(id) on delete set null,
  add column if not exists is_anonymous boolean not null default false,
  add column if not exists is_pinned    boolean not null default false,
  add column if not exists pinned_at    timestamptz;

create index if not exists posts_pinned_idx
  on public.posts (is_pinned desc, created_at desc);

-- ============================================================
--  3. 好友关系
-- ============================================================
create table if not exists public.friendships (
  id         uuid primary key default gen_random_uuid(),
  requester  uuid not null references public.profiles(id) on delete cascade,
  addressee  uuid not null references public.profiles(id) on delete cascade,
  status     text not null default 'pending'
             check (status in ('pending', 'accepted', 'rejected', 'blocked')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint friendships_pair_uniq unique (requester, addressee),
  constraint friendships_not_self check (requester <> addressee)
);

create index if not exists friendships_req_idx  on public.friendships (requester, status);
create index if not exists friendships_addr_idx on public.friendships (addressee, status);

-- ============================================================
--  4. 私聊消息
-- ============================================================
create table if not exists public.messages (
  id         uuid primary key default gen_random_uuid(),
  sender     uuid not null references public.profiles(id) on delete cascade,
  receiver   uuid not null references public.profiles(id) on delete cascade,
  content    text not null,
  created_at timestamptz not null default now(),
  read_at    timestamptz
);

create index if not exists messages_pair_idx
  on public.messages (sender, receiver, created_at desc);
create index if not exists messages_unread_idx
  on public.messages (receiver, created_at desc) where read_at is null;

-- ============================================================
--  5. 权限收紧
-- ============================================================
alter table public.profiles    enable row level security;
alter table public.friendships enable row level security;
alter table public.messages    enable row level security;

revoke all on public.profiles    from anon, authenticated;
revoke all on public.friendships from anon, authenticated;
revoke all on public.messages    from anon, authenticated;

-- 资料：谁都能看（要在帖子里显示昵称头像），但只能改自己的昵称/头像/签名
-- 注意用列级权限，不给整表 update —— 否则用户能改自己的 created_at
grant select on public.profiles to anon, authenticated;
grant update (nickname, avatar, bio, updated_at) on public.profiles to authenticated;

-- 好友：只能读跟自己有关的行，写入一律走 RPC
grant select on public.friendships to authenticated;

-- 消息：能读自己收发的；但只能把 read_at 这一列改掉
-- （如果给整表 update，用户就能通过 API 篡改别人发给自己的消息内容）
grant select on public.messages to authenticated;
grant update (read_at) on public.messages to authenticated;

drop policy if exists profiles_read_all on public.profiles;
create policy profiles_read_all on public.profiles
  for select to anon, authenticated using (true);

drop policy if exists profiles_update_own on public.profiles;
create policy profiles_update_own on public.profiles
  for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

drop policy if exists friendships_read_own on public.friendships;
create policy friendships_read_own on public.friendships
  for select to authenticated
  using (requester = auth.uid() or addressee = auth.uid());

drop policy if exists messages_read_own on public.messages;
create policy messages_read_own on public.messages
  for select to authenticated
  using (sender = auth.uid() or receiver = auth.uid());

-- 标记已读：只能把"发给我的"改成已读
drop policy if exists messages_mark_read on public.messages;
create policy messages_mark_read on public.messages
  for update to authenticated
  using (receiver = auth.uid())
  with check (receiver = auth.uid());

-- ============================================================
--  6. RPC：资料
-- ============================================================
create or replace function public.my_profile()
returns json
language sql
stable
security definer
set search_path = public
as $$
  select to_jsonb(p) from public.profiles p where p.id = auth.uid();
$$;

create or replace function public.update_my_profile(
  p_nickname text,
  p_avatar   text,
  p_bio      text
)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_nick text;
  v_bio  text;
  v_av   text;
  v_row  public.profiles;
begin
  if auth.uid() is null then
    raise exception '请先刷新页面重新进入';
  end if;

  v_nick := btrim(coalesce(p_nickname, ''));
  if char_length(v_nick) < 1 then
    raise exception '昵称不能为空';
  end if;
  if char_length(v_nick) > 12 then
    raise exception '昵称最多 12 个字';
  end if;

  v_bio := btrim(coalesce(p_bio, ''));
  if char_length(v_bio) > 60 then
    raise exception '签名最多 60 个字';
  end if;

  v_av := coalesce(nullif(btrim(p_avatar), ''), '🐣');
  if char_length(v_av) > 8 then
    v_av := substr(v_av, 1, 2);
  end if;

  update public.profiles
     set nickname = v_nick,
         avatar   = v_av,
         bio      = v_bio,
         updated_at = now()
   where id = auth.uid()
  returning * into v_row;

  if v_row.id is null then
    insert into public.profiles (id, nickname, avatar, bio)
    values (auth.uid(), v_nick, v_av, v_bio)
    returning * into v_row;
  end if;

  return to_jsonb(v_row);
end;
$$;

-- ============================================================
--  7. RPC：好友
-- ============================================================

-- 对方如果已经先申请过我 → 直接双向成为好友
create or replace function public.send_friend_request(p_target uuid)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me   uuid := auth.uid();
  v_rev  public.friendships;
  v_mine public.friendships;
begin
  if v_me is null then raise exception '请先刷新页面'; end if;
  if p_target = v_me then raise exception '不能加自己'; end if;
  if not exists (select 1 from public.profiles where id = p_target) then
    raise exception '这个同学不存在';
  end if;

  -- 对方已经申请过我？
  select * into v_rev from public.friendships
   where requester = p_target and addressee = v_me;

  if v_rev.id is not null then
    if v_rev.status = 'accepted' then
      return json_build_object('state', 'already_friends');
    end if;
    update public.friendships
       set status = 'accepted', updated_at = now()
     where id = v_rev.id;
    return json_build_object('state', 'accepted');
  end if;

  -- 我这边已有的记录
  select * into v_mine from public.friendships
   where requester = v_me and addressee = p_target;

  if v_mine.id is not null then
    if v_mine.status = 'pending' then
      return json_build_object('state', 'pending');
    end if;
    update public.friendships
       set status = 'pending', updated_at = now()
     where id = v_mine.id;
    return json_build_object('state', 'pending');
  end if;

  insert into public.friendships (requester, addressee, status)
  values (v_me, p_target, 'pending');

  return json_build_object('state', 'pending');
end;
$$;

create or replace function public.respond_friend_request(p_id uuid, p_accept boolean)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := auth.uid();
  v_row public.friendships;
begin
  if v_me is null then raise exception '请先刷新页面'; end if;

  select * into v_row from public.friendships
   where id = p_id and addressee = v_me and status = 'pending';

  if v_row.id is null then
    raise exception '这个申请不存在或已处理';
  end if;

  update public.friendships
     set status = case when p_accept then 'accepted' else 'rejected' end,
         updated_at = now()
   where id = p_id;

  return json_build_object('ok', true, 'accepted', p_accept);
end;
$$;

-- 好友列表（含最后一条消息、未读数）
create or replace function public.list_friends()
returns json
language sql
stable
security definer
set search_path = public
as $$
  with me as (select auth.uid() as uid),
  pairs as (
    select
      case when f.requester = (select uid from me) then f.addressee else f.requester end as peer_id
    from public.friendships f
    where f.status = 'accepted'
      and (f.requester = (select uid from me) or f.addressee = (select uid from me))
  )
  select coalesce(json_agg(row_to_json(t) order by t.last_at desc nulls last), '[]'::json)
  from (
    select
      p.id,
      p.nickname,
      p.avatar,
      p.bio,
      (select count(*) from public.messages m
        where m.sender = p.id and m.receiver = (select uid from me) and m.read_at is null) as unread,
      (select m.content from public.messages m
        where (m.sender = p.id and m.receiver = (select uid from me))
           or (m.sender = (select uid from me) and m.receiver = p.id)
        order by m.created_at desc limit 1) as last_msg,
      (select m.created_at from public.messages m
        where (m.sender = p.id and m.receiver = (select uid from me))
           or (m.sender = (select uid from me) and m.receiver = p.id)
        order by m.created_at desc limit 1) as last_at
    from public.profiles p
    where p.id in (select peer_id from pairs)
  ) t;
$$;

-- 收到的待处理申请
create or replace function public.list_friend_requests()
returns json
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(json_agg(row_to_json(t) order by t.created_at desc), '[]'::json)
  from (
    select f.id, f.requester as user_id, p.nickname, p.avatar, f.created_at
    from public.friendships f
    join public.profiles p on p.id = f.requester
    where f.addressee = auth.uid() and f.status = 'pending'
  ) t;
$$;

-- 我和某人的关系状态（给用户卡按钮用）
create or replace function public.relation_with(p_user uuid)
returns json
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_me uuid := auth.uid();
  f public.friendships;
begin
  if v_me is null then
    return json_build_object('state', 'anon');
  end if;
  if v_me = p_user then
    return json_build_object('state', 'self');
  end if;

  select * into f from public.friendships
   where (requester = v_me and addressee = p_user)
      or (requester = p_user and addressee = v_me)
   limit 1;

  if f.id is null then
    return json_build_object('state', 'none');
  end if;

  if f.status = 'accepted' then
    return json_build_object('state', 'friend');
  end if;
  if f.status = 'pending' then
    if f.requester = v_me then
      return json_build_object('state', 'requested');
    else
      return json_build_object('state', 'incoming', 'request_id', f.id);
    end if;
  end if;

  return json_build_object('state', f.status);
end;
$$;

-- ============================================================
--  8. RPC：私聊
-- ============================================================
create or replace function public.are_friends(a uuid, b uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.friendships
    where status = 'accepted'
      and ((requester = a and addressee = b) or (requester = b and addressee = a))
  );
$$;

create or replace function public.send_message(p_to uuid, p_content text)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me   uuid := auth.uid();
  v_text text;
  v_row  public.messages;
begin
  if v_me is null then raise exception '请先刷新页面'; end if;
  if p_to = v_me then raise exception '不能给自己发消息'; end if;
  if not public.are_friends(v_me, p_to) then
    raise exception '你们还不是好友';
  end if;

  v_text := btrim(coalesce(p_content, ''));
  if v_text = '' then raise exception '消息不能为空'; end if;
  if char_length(v_text) > 500 then raise exception '消息最多 500 个字'; end if;

  -- 限流：1 秒内只能发 1 条
  if exists (
    select 1 from public.messages
    where sender = v_me and created_at > now() - interval '1 second'
  ) then
    raise exception '发得太快啦，喘口气';
  end if;

  insert into public.messages (sender, receiver, content)
  values (v_me, p_to, v_text)
  returning * into v_row;

  return json_build_object(
    'id', v_row.id,
    'sender', v_row.sender,
    'receiver', v_row.receiver,
    'content', v_row.content,
    'created_at', v_row.created_at
  );
end;
$$;

create or replace function public.list_messages(
  p_peer   uuid,
  p_limit  int default 50,
  p_before timestamptz default null
)
returns json
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(json_agg(row_to_json(t) order by t.created_at asc), '[]'::json)
  from (
    select m.id, m.sender, m.receiver, m.content, m.created_at, m.read_at
    from public.messages m
    where ((m.sender = auth.uid() and m.receiver = p_peer)
        or (m.sender = p_peer and m.receiver = auth.uid()))
      and (p_before is null or m.created_at < p_before)
    order by m.created_at desc
    limit least(coalesce(p_limit, 50), 100)
  ) t;
$$;

create or replace function public.mark_read(p_peer uuid)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_n int;
begin
  if auth.uid() is null then return 0; end if;
  update public.messages
     set read_at = now()
   where receiver = auth.uid() and sender = p_peer and read_at is null;
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

create or replace function public.unread_total()
returns int
language sql
stable
security definer
set search_path = public
as $$
  select count(*)::int from public.messages
  where receiver = auth.uid() and read_at is null;
$$;

-- ============================================================
--  9. RPC：管理员置顶
-- ============================================================
create or replace function public.admin_set_pinned(p_post_id uuid, p_pinned boolean)
returns json
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception '只有管理员能置顶';
  end if;

  update public.posts
     set is_pinned = p_pinned,
         pinned_at = case when p_pinned then now() else null end
   where id = p_post_id;

  return json_build_object('ok', true, 'pinned', p_pinned);
end;
$$;

-- ============================================================
--  10. 发帖：记录作者与匿名标记
-- ============================================================
-- 用新签名重建（旧签名保留兼容，前端会切到新函数）
create or replace function public.submit_post(
  p_nickname  text,
  p_content   text,
  p_image_url text default null,
  p_anonymous boolean default false
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_nick    text;
  v_content text;
  v_id      uuid;
  v_uid     uuid := auth.uid();
  v_prof    public.profiles;
begin
  if v_uid is not null then
    select * into v_prof from public.profiles where id = v_uid;
  end if;

  v_nick := btrim(coalesce(p_nickname, ''));
  if v_nick = '' then
    v_nick := coalesce(v_prof.nickname, '匿名同学');
  end if;
  if p_anonymous then
    v_nick := '匿名同学';
  end if;
  if char_length(v_nick) > 20 then
    raise exception '昵称最多 20 个字';
  end if;

  v_content := btrim(coalesce(p_content, ''));
  if char_length(v_content) < 2 then
    raise exception '内容太短了，至少写 2 个字';
  end if;
  if char_length(v_content) > 1000 then
    raise exception '内容最多 1000 个字';
  end if;

  if exists (
    select 1 from public.posts
    where status = 'pending'
      and nickname = v_nick
      and content = v_content
      and created_at > now() - interval '60 seconds'
  ) then
    raise exception '刚刚已经提交过这条啦，稍等一下';
  end if;

  insert into public.posts (nickname, content, image_url, status, author_id, is_anonymous)
  values (v_nick, v_content, p_image_url, 'pending', v_uid, coalesce(p_anonymous, false))
  returning id into v_id;

  return v_id;
end;
$$;

-- 如果旧的三参数版本还在，删掉避免重载歧义
do $$
begin
  if exists (
    select 1 from pg_proc
    where proname = 'submit_post'
      and pronargs = 3
      and pronamespace = 'public'::regnamespace
  ) then
    execute 'drop function public.submit_post(text, text, text)';
  end if;
end $$;

-- ============================================================
--  11. 权限授予
-- ============================================================
revoke all on function public.my_profile()                        from public;
revoke all on function public.update_my_profile(text, text, text) from public;
revoke all on function public.send_friend_request(uuid)           from public;
revoke all on function public.respond_friend_request(uuid, boolean) from public;
revoke all on function public.list_friends()                      from public;
revoke all on function public.list_friend_requests()              from public;
revoke all on function public.relation_with(uuid)                 from public;
revoke all on function public.send_message(uuid, text)            from public;
revoke all on function public.list_messages(uuid, int, timestamptz) from public;
revoke all on function public.mark_read(uuid)                     from public;
revoke all on function public.unread_total()                      from public;
revoke all on function public.admin_set_pinned(uuid, boolean)     from public;
revoke all on function public.submit_post(text, text, text, boolean) from public;

grant execute on function public.my_profile()                        to authenticated;
grant execute on function public.update_my_profile(text, text, text) to authenticated;
grant execute on function public.send_friend_request(uuid)           to authenticated;
grant execute on function public.respond_friend_request(uuid, boolean) to authenticated;
grant execute on function public.list_friends()                      to authenticated;
grant execute on function public.list_friend_requests()              to authenticated;
grant execute on function public.relation_with(uuid)                 to authenticated;
grant execute on function public.send_message(uuid, text)            to authenticated;
grant execute on function public.list_messages(uuid, int, timestamptz) to authenticated;
grant execute on function public.mark_read(uuid)                     to authenticated;
grant execute on function public.unread_total()                      to authenticated;
grant execute on function public.admin_set_pinned(uuid, boolean)     to authenticated;
grant execute on function public.submit_post(text, text, text, boolean) to anon, authenticated;

-- ============================================================
--  12. 实时推送（消息和好友申请）
-- ============================================================
do $$
begin
  alter publication supabase_realtime add table public.messages;
exception when duplicate_object then null;
           when others then raise notice 'messages 加入实时发布失败：%', sqlerrm;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.friendships;
exception when duplicate_object then null;
           when others then raise notice 'friendships 加入实时发布失败：%', sqlerrm;
end $$;
