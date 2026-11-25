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