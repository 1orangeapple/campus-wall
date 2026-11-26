-- ============================================================
--  霞浦三小校园墙 · v3 增量升级
--  分类 / 评论回复 / 封禁 / 管理员管理 / 重名检测 / 通知
--  -----------------------------------------------------------
--  在已经部署好的项目上：SQL Editor 整段粘贴执行一次。
--  不影响现有帖子、评论、好友、消息。
--  可重复执行。
-- ============================================================

-- ============================================================
--  1. 帖子分类
-- ============================================================
alter table public.posts
  add column if not exists category text not null default '灌水贴';

-- 先加约束（如果已存在会报错，吞掉）
do $$
begin
  alter table public.posts
    add constraint posts_category_chk
    check (category in ('灌水贴', '吐槽', '失物招领', '挂人'));
exception when duplicate_object then null;
end $$;

create index if not exists posts_category_idx
  on public.posts (category, status, created_at desc);

-- ============================================================
--  2. 评论回复（楼中楼，一层）
-- ============================================================
alter table public.comments
  add column if not exists parent_id uuid references public.comments(id) on delete cascade,
  add column if not exists author_id uuid references public.profiles(id) on delete set null;

create index if not exists comments_parent_idx
  on public.comments (post_id, parent_id, created_at asc);

-- ============================================================
--  3. 封禁（设备指纹 + 账号双封）
-- ============================================================
create table if not exists public.bans (
  id         uuid primary key default gen_random_uuid(),
  device_fp  text,
  user_id    uuid references public.profiles(id) on delete cascade,
  nickname   text,
  reason     text not null default '违反校园墙规范',
  created_at timestamptz not null default now(),
  expires_at timestamptz,          -- null = 永久
  banned_by  uuid
);

create index if not exists bans_fp_idx   on public.bans (device_fp);
create index if not exists bans_user_idx on public.bans (user_id);

-- ============================================================
--  4. 管理员表扩展
-- ============================================================
alter table public.admins
  add column if not exists added_by  uuid,
  add column if not exists note      text,
  add column if not exists promoted_at timestamptz default now();

-- ============================================================
--  5. 昵称唯一（重名检测的底层保证）
-- ============================================================
-- 先把历史数据里重复的昵称加上后缀，否则唯一索引建不上
with dup as (
  select id,
         nickname,
         row_number() over (partition by lower(btrim(nickname)) order by created_at) as rn
  from public.profiles
)
update public.profiles p
   set nickname = p.nickname || '_' || substr(replace(p.id::text,'-',''),1,4)
  from dup
 where p.id = dup.id and dup.rn > 1;

create unique index if not exists profiles_nickname_uniq
  on public.profiles (lower(btrim(nickname)));

-- ============================================================
--  6. 工具函数
-- ============================================================

-- 昵称是否已被占用（p_ignore_self 用于"保存自己不改名"的场景）
create or replace function public.nickname_taken(p_nick text, p_ignore_self boolean default true)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where lower(btrim(nickname)) = lower(btrim(p_nick))
      and (not coalesce(p_ignore_self, true) or id <> coalesce(auth.uid(), '00000000-0000-0000-0000-000000000000'::uuid))
  );
$$;

-- 当前工具有没有被封（按设备指纹或当前账号）
create or replace function public.check_ban(p_fp text)
returns json
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select json_build_object(
              'banned', true,
              'reason', b.reason,
              'expires_at', b.expires_at
            )
       from public.bans b
      where (b.expires_at is null or b.expires_at > now())
        and (
          (p_fp is not null and b.device_fp = p_fp)
          or (auth.uid() is not null and b.user_id = auth.uid())
        )
      order by b.created_at desc
      limit 1),
    json_build_object('banned', false)
  );
$$;

-- ============================================================
--  7. 发帖：加分类 + 封禁校验
-- ============================================================
create or replace function public.submit_post(
  p_nickname  text,
  p_content   text,
  p_image_url text default null,
  p_anonymous boolean default false,
  p_category  text default '灌水贴',
  p_fp        text default null
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
  v_cat     text;
begin
  if (public.check_ban(p_fp) ->> 'banned')::boolean then
    raise exception '你已被封禁，无法发帖';
  end if;

  v_cat := coalesce(p_category, '灌水贴');
  if v_cat not in ('灌水贴', '吐槽', '失物招领', '挂人') then
    v_cat := '灌水贴';
  end if;

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

  insert into public.posts (nickname, content, image_url, status, author_id, is_anonymous, category)
  values (v_nick, v_content, p_image_url, 'pending', v_uid, coalesce(p_anonymous, false), v_cat)
  returning id into v_id;

  return v_id;
end;
$$;

-- 删掉旧的重载版本，避免前端调用歧义
do $$
declare
  r record;
begin
  for r in
    select p.oid::regprocedure as sig
    from pg_proc p
    where p.proname = 'submit_post'
      and p.pronamespace = 'public'::regnamespace
      and p.pronargs < 6
  loop
    execute 'drop function ' || r.sig;
  end loop;
end $$;

-- ============================================================
--  8. 评论：加回复 + 封禁校验
-- ============================================================
create or replace function public.add_comment(
  p_post_id  uuid,
  p_nickname text,
  p_content  text,
  p_parent   uuid default null,
  p_fp       text default null
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
  v_uid     uuid := auth.uid();
  v_parent  public.comments;
  v_parent_name text;
  v_target  uuid;
begin
  if (public.check_ban(p_fp) ->> 'banned')::boolean then
    raise exception '你已被封禁，无法评论';
  end if;

  v_nick := btrim(coalesce(p_nickname, ''));
  if v_nick = '' then v_nick := '匿名同学'; end if;
  if char_length(v_nick) > 20 then
    raise exception '昵称最多 20 个字';
  end if;

  v_content := btrim(coalesce(p_content, ''));
  if v_content = '' then raise exception '评论不能为空'; end if;
  if char_length(v_content) > 300 then
    raise exception '评论最多 300 个字';
  end if;

  if not exists (
    select 1 from public.posts where id = p_post_id and status = 'approved'
  ) then
    raise exception '帖子不存在或未通过审核';
  end if;

  if p_parent is not null then
    select * into v_parent from public.comments where id = p_parent and post_id = p_post_id;
    if v_parent.id is null then
      raise exception '要回复的评论不存在';
    end if;
    -- 只允许两层：回复"回复"时，挂到它所属的一楼
    if v_parent.parent_id is not null then
      p_parent := v_parent.parent_id;
      select * into v_parent from public.comments where id = p_parent;
    end if;
    v_parent_name := v_parent.nickname;
    v_target := v_parent.author_id;
  end if;

  insert into public.comments (post_id, nickname, content, parent_id, author_id)
  values (p_post_id, v_nick, v_content, p_parent, v_uid)
  returning * into v_row;

  select count(*) into v_count from public.comments where post_id = p_post_id;
  update public.posts set comment_count = v_count where id = p_post_id;

  return json_build_object(
    'id', v_row.id,
    'post_id', v_row.post_id,
    'nickname', v_row.nickname,
    'content', v_row.content,
    'parent_id', v_row.parent_id,
    'author_id', v_row.author_id,
    'created_at', v_row.created_at,
    'reply_to', v_parent_name
  );
end;
$$;

do $$
declare
  r record;
begin
  for r in
    select p.oid::regprocedure as sig
    from pg_proc p
    where p.proname = 'add_comment'
      and p.pronamespace = 'public'::regnamespace
      and p.pronargs < 5
  loop
    execute 'drop function ' || r.sig;
  end loop;
end $$;

-- 读评论：带回复关系
create or replace function public.list_comments(p_post_id uuid)
returns json
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(json_agg(row_to_json(t) order by t.created_at asc), '[]'::json)
  from (
    select c.id, c.nickname, c.content, c.parent_id, c.created_at,
           p.nickname as reply_to
    from public.comments c
    left join public.comments p on p.id = c.parent_id
    join public.posts po on po.id = c.post_id
    where c.post_id = p_post_id and po.status = 'approved'
    order by c.created_at asc
    limit 300
  ) t;
$$;

-- ============================================================
--  9. 管理员管理（把别人升级成管理员）
-- ============================================================
create or replace function public.list_admins()
returns json
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(json_agg(row_to_json(t) order by t.created_at asc), '[]'::json)
  from (
    select a.user_id, a.created_at,
           coalesce(p.nickname, '（未设置昵称）') as nickname,
           coalesce(p.avatar, '🐣') as avatar,
           (a.user_id = auth.uid()) as is_me
    from public.admins a
    left join public.profiles p on p.id = a.user_id
  ) t;
$$;

create or replace function public.promote_admin(p_target uuid)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := auth.uid();
begin
  if not public.is_admin() then
    raise exception '只有管理员能任命管理员';
  end if;
  if p_target is null then raise exception '请选择一个人'; end if;
  if p_target = v_me then raise exception '你已经是管理员了'; end if;
  if not exists (select 1 from public.profiles where id = p_target) then
    raise exception '这个人不存在';
  end if;

  insert into public.admins (user_id, added_by)
  values (p_target, v_me)
  on conflict (user_id) do nothing;

  return json_build_object('ok', true);
end;
$$;

create or replace function public.demote_admin(p_target uuid)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := auth.uid();
  v_count int;
begin
  if not public.is_admin() then
    raise exception '只有管理员能撤销管理员';
  end if;
  if p_target = v_me then
    raise exception '不能撤销自己，找别的管理员帮忙';
  end if;

  select count(*) into v_count from public.admins;
  if v_count <= 1 then
    raise exception '至少要留一个管理员';
  end if;

  delete from public.admins where user_id = p_target;
  return json_build_object('ok', true);
end;
$$;

-- 后台搜人（按昵称）
create or replace function public.search_profiles(p_q text)
returns json
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(json_agg(row_to_json(t)), '[]'::json)
  from (
    select p.id, p.nickname, p.avatar,
           exists (select 1 from public.admins a where a.user_id = p.id) as is_admin
    from public.profiles p
    where p_q is null or btrim(p_q) = ''
       or p.nickname ilike '%' || btrim(p_q) || '%'
    order by p.created_at desc
    limit 30
  ) t;
$$;

-- ============================================================
--  10. 封禁管理
-- ============================================================
create or replace function public.admin_ban(
  p_user     uuid default null,
  p_device   text default null,
  p_reason   text default '违反校园墙规范',
  p_days     int  default null
)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_nick text;
begin
  if not public.is_admin() then
    raise exception '只有管理员能封禁';
  end if;
  if p_user is null and (p_device is null or btrim(p_device) = '') then
    raise exception '至少要指定一个账号或设备';
  end if;
  if p_user is not null then
    if exists (select 1 from public.admins where user_id = p_user) then
      raise exception '管理员不能被封禁，先撤销它的管理员身份';
    end if;
    select nickname into v_nick from public.profiles where id = p_user;
  end if;

  insert into public.bans (user_id, device_fp, nickname, reason, expires_at, banned_by)
  values (
    p_user,
    nullif(btrim(coalesce(p_device, '')), ''),
    v_nick,
    coalesce(nullif(btrim(coalesce(p_reason, '')), ''), '违反校园墙规范'),
    case when p_days is null then null else now() + (p_days || ' days')::interval end,
    auth.uid()
  );

  return json_build_object('ok', true);
end;
$$;

create or replace function public.admin_unban(p_ban_id uuid)
returns json
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception '只有管理员能解封';
  end if;
  delete from public.bans where id = p_ban_id;
  return json_build_object('ok', true);
end;
$$;

create or replace function public.admin_list_bans()
returns json
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(json_agg(row_to_json(t) order by t.created_at desc), '[]'::json)
  from (
    select b.id, b.user_id, b.device_fp, b.nickname, b.reason,
           b.created_at, b.expires_at,
           (b.expires_at is not null and b.expires_at <= now()) as expired
    from public.bans b
  ) t;
$$;

-- ============================================================
--  11. 搜索帖子（关键词）
-- ============================================================
create or replace function public.search_posts(p_q text, p_limit int default 30)
returns json
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(json_agg(row_to_json(t) order by t.created_at desc), '[]'::json)
  from (
    select id, nickname, content, image_url, category, is_pinned,
           like_count, comment_count, created_at, author_id, is_anonymous
    from public.posts
    where status = 'approved'
      and btrim(coalesce(p_q, '')) <> ''
      and (content ilike '%' || btrim(p_q) || '%'
        or nickname ilike '%' || btrim(p_q) || '%')
    order by created_at desc
    limit least(coalesce(p_limit, 30), 60)
  ) t;
$$;

-- ============================================================
--  12. 权限
-- ============================================================
revoke all on public.bans from anon, authenticated;
grant select, delete on public.bans to authenticated;

drop policy if exists bans_admin_all on public.bans;
create policy bans_admin_all on public.bans
  for select to authenticated
  using (public.is_admin());

drop policy if exists bans_admin_del on public.bans;
create policy bans_admin_del on public.bans
  for delete to authenticated
  using (public.is_admin());

revoke all on function public.nickname_taken(text, boolean)    from public;
revoke all on function public.check_ban(text)                   from public;
revoke all on function public.submit_post(text,text,text,boolean,text,text) from public;
revoke all on function public.add_comment(uuid,text,text,uuid,text) from public;
revoke all on function public.list_comments(uuid)               from public;
revoke all on function public.list_admins()                     from public;
revoke all on function public.promote_admin(uuid)               from public;
revoke all on function public.demote_admin(uuid)                from public;
revoke all on function public.search_profiles(text)             from public;
revoke all on function public.admin_ban(uuid,text,text,int)     from public;
revoke all on function public.admin_unban(uuid)                 from public;
revoke all on function public.admin_list_bans()                 from public;
revoke all on function public.search_posts(text, int)           from public;

grant execute on function public.nickname_taken(text, boolean)    to anon, authenticated;
grant execute on function public.check_ban(text)                   to anon, authenticated;
grant execute on function public.submit_post(text,text,text,boolean,text,text) to anon, authenticated;
grant execute on function public.add_comment(uuid,text,text,uuid,text) to anon, authenticated;
grant execute on function public.list_comments(uuid)               to anon, authenticated;
grant execute on function public.search_posts(text, int)           to anon, authenticated;

grant execute on function public.list_admins()                     to authenticated;
grant execute on function public.promote_admin(uuid)               to authenticated;
grant execute on function public.demote_admin(uuid)                to authenticated;
grant execute on function public.search_profiles(text)             to authenticated;
grant execute on function public.admin_ban(uuid,text,text,int)     to authenticated;
grant execute on function public.admin_unban(uuid)                 to authenticated;
grant execute on function public.admin_list_bans()                 to authenticated;
