-- 0001 initial auth & roles
-- 대한민국 실내 클라이밍 포털 — 인증·권한·기본 프로필
-- 모든 신규 테이블은 RLS 활성화 + 정책 명시.

-- ============================================================
-- 1. roles  (정적 권한 정의)
-- ============================================================
create table if not exists public.roles (
  id          text primary key,
  label       text not null,
  description text,
  created_at  timestamptz not null default now()
);

insert into public.roles (id, label, description) values
  ('user',      '일반 회원',   '기본 등록 회원'),
  ('curator',   '큐레이터',    '꿀팁 작성·편집 권한'),
  ('moderator', '모더레이터',  '신고 처리·게시글 숨김 권한'),
  ('admin',     '관리자',      '모든 권한')
on conflict (id) do nothing;

-- ============================================================
-- 2. user_levels  (활동 레벨 정의)
-- ============================================================
create table if not exists public.user_levels (
  level       int primary key,
  name        text not null,
  min_points  int  not null,
  description text
);

insert into public.user_levels (level, name, min_points, description) values
  (1,  '클린업', 0,      '입문 단계'),
  (2,  '비기너', 50,     '기본기 익히는 중'),
  (3,  '클라이머', 200,  '꾸준히 등반'),
  (4,  '하드클라이머', 500, '중급 진입'),
  (5,  '엣지마스터', 1000, '상급 클라이머'),
  (6,  '도전자', 2000,   '한계급 도전'),
  (7,  '센드머신', 4000, '연속 완등'),
  (8,  '아이언그립', 8000, '엘리트 클래스'),
  (9,  '레전드', 16000,  '커뮤니티 전설'),
  (10, '신화', 32000,    '신화의 영역')
on conflict (level) do nothing;

-- ============================================================
-- 3. profiles  (auth.users 1:1 확장)
-- ============================================================
create table if not exists public.profiles (
  id            uuid primary key references auth.users(id) on delete cascade,
  username      text unique,
  display_name  text,
  avatar_url    text,
  bio           text,
  role_id       text not null default 'user' references public.roles(id),
  level         int  not null default 1 references public.user_levels(level),
  points        int  not null default 0,
  is_banned     boolean not null default false,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists idx_profiles_role on public.profiles(role_id) where is_banned = false;
create index if not exists idx_profiles_level on public.profiles(level) where is_banned = false;

-- ============================================================
-- 4. audit_log  (관리자 조치 추적)
-- ============================================================
create table if not exists public.audit_log (
  id          bigserial primary key,
  actor_id    uuid references public.profiles(id) on delete set null,
  action      text not null,
  target_type text,
  target_id   text,
  metadata    jsonb,
  created_at  timestamptz not null default now()
);

create index if not exists idx_audit_log_actor_created
  on public.audit_log(actor_id, created_at desc);

-- ============================================================
-- 5. RLS 헬퍼 함수
-- ============================================================
create or replace function public.has_role(required text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid()
      and role_id = required
      and is_banned = false
  );
$$;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.has_role('admin');
$$;

create or replace function public.is_moderator_or_admin()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.has_role('admin') or public.has_role('moderator');
$$;

-- ============================================================
-- 6. handle_new_user 트리거 — auth.users → profiles 자동 생성
-- ============================================================
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  raw_meta   jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  candidate  text;
  candidate_avatar text;
begin
  candidate := coalesce(
    raw_meta->>'name',
    raw_meta->>'nickname',
    raw_meta->>'full_name',
    raw_meta->>'preferred_username',
    split_part(coalesce(new.email, ''), '@', 1),
    'user'
  );
  candidate_avatar := coalesce(
    raw_meta->>'avatar_url',
    raw_meta->>'profile_image',
    raw_meta->>'picture'
  );

  insert into public.profiles (id, username, display_name, avatar_url)
  values (
    new.id,
    'user_' || substring(new.id::text, 1, 8),
    candidate,
    candidate_avatar
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ============================================================
-- 7. updated_at 자동 갱신 트리거
-- ============================================================
create or replace function public.tg_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.tg_set_updated_at();

-- ============================================================
-- 8. RLS 활성화 + 정책
-- ============================================================

-- roles: 누구나 read, 관리자만 쓰기
alter table public.roles enable row level security;

drop policy if exists roles_read_all on public.roles;
create policy roles_read_all on public.roles
  for select using (true);

drop policy if exists roles_admin_write on public.roles;
create policy roles_admin_write on public.roles
  for all using (public.is_admin()) with check (public.is_admin());

-- user_levels: 누구나 read, 관리자만 쓰기
alter table public.user_levels enable row level security;

drop policy if exists user_levels_read_all on public.user_levels;
create policy user_levels_read_all on public.user_levels
  for select using (true);

drop policy if exists user_levels_admin_write on public.user_levels;
create policy user_levels_admin_write on public.user_levels
  for all using (public.is_admin()) with check (public.is_admin());

-- profiles
alter table public.profiles enable row level security;

drop policy if exists profiles_read_public on public.profiles;
create policy profiles_read_public on public.profiles
  for select using (is_banned = false or public.is_admin());

drop policy if exists profiles_insert_self on public.profiles;
create policy profiles_insert_self on public.profiles
  for insert with check (auth.uid() = id);

drop policy if exists profiles_update_self on public.profiles;
create policy profiles_update_self on public.profiles
  for update using (auth.uid() = id or public.is_admin())
  with check (auth.uid() = id or public.is_admin());

drop policy if exists profiles_delete_admin on public.profiles;
create policy profiles_delete_admin on public.profiles
  for delete using (public.is_admin());

-- audit_log: 관리자만 read, insert는 SECURITY DEFINER 함수로만
alter table public.audit_log enable row level security;

drop policy if exists audit_read_admin on public.audit_log;
create policy audit_read_admin on public.audit_log
  for select using (public.is_moderator_or_admin());

drop policy if exists audit_insert_blocked on public.audit_log;
create policy audit_insert_blocked on public.audit_log
  for insert with check (false);

-- ============================================================
-- 9. 권한 부여
-- ============================================================
grant usage on schema public to anon, authenticated;
grant select on public.roles, public.user_levels to anon, authenticated;
grant select on public.profiles to anon, authenticated;
grant insert, update on public.profiles to authenticated;
grant execute on function public.has_role(text) to anon, authenticated;
grant execute on function public.is_admin() to anon, authenticated;
grant execute on function public.is_moderator_or_admin() to anon, authenticated;
