-- 0002 gyms domain
-- 대한민국 실내 클라이밍 포털 — 암장(체인/독립) · 지점 · 운영시간 · 요금
-- 모든 신규 테이블은 RLS 활성 + FORCE.
-- 큐레이터(curator)는 INSERT/UPDATE 가능, 하드 DELETE 는 관리자만.

-- ============================================================
-- 1. gyms — 브랜드(체인 본사) 또는 독립 운영체 단위
-- ============================================================
create table if not exists public.gyms (
  id          uuid primary key default gen_random_uuid(),
  slug        text not null unique
              check (slug ~ '^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$'),
  name_ko     text not null
              check (length(name_ko) between 1 and 100),
  name_en     text
              check (name_en is null or length(name_en) <= 100),
  brand_type  text not null default 'independent'
              check (brand_type in ('chain','independent')),
  website_url text
              check (website_url is null or website_url ~ '^https?://'),
  description text
              check (description is null or length(description) <= 2000),
  logo_url    text,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  updated_by  uuid references auth.users(id) on delete set null
);

create index if not exists idx_gyms_active
  on public.gyms(id) where is_active = true;
create index if not exists idx_gyms_brand_type
  on public.gyms(brand_type);

-- ============================================================
-- 2. gym_branches — 실제 영업 지점
-- ============================================================
create table if not exists public.gym_branches (
  id              uuid primary key default gen_random_uuid(),
  gym_id          uuid not null references public.gyms(id) on delete restrict,
  slug            text not null unique
                  check (slug ~ '^[a-z0-9][a-z0-9-]{1,80}[a-z0-9]$'),
  name_ko         text not null
                  check (length(name_ko) between 1 and 120),
  region_sido     text not null
                  check (length(region_sido) between 2 and 20),
  region_sgg      text not null
                  check (length(region_sgg) between 2 and 30),
  address         text not null
                  check (length(address) between 5 and 200),
  address_detail  text
                  check (address_detail is null or length(address_detail) <= 100),
  postal_code     text
                  check (postal_code is null or postal_code ~ '^[0-9]{5}$'),
  lat             numeric(10,7) not null
                  check (lat between 33.0 and 39.0),
  lng             numeric(10,7) not null
                  check (lng between 124.0 and 132.0),
  phone           text
                  check (phone is null or phone ~ '^[0-9\-+ ]{7,20}$'),
  kakao_place_id  text,
  facility_type   text not null default 'bouldering'
                  check (facility_type in ('bouldering','lead','both')),
  is_active       boolean not null default true,
  closed_at       timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  updated_by      uuid references auth.users(id) on delete set null,
  constraint chk_closed_consistency check (
    (is_active = false and closed_at is not null) or
    (is_active = true  and closed_at is null)
  )
);

create index if not exists idx_branches_gym_id
  on public.gym_branches(gym_id);
create index if not exists idx_branches_active
  on public.gym_branches(id) where is_active = true;
create index if not exists idx_branches_region
  on public.gym_branches(region_sido, region_sgg);
create index if not exists idx_branches_geo
  on public.gym_branches(lat, lng) where is_active = true;
create index if not exists idx_branches_facility
  on public.gym_branches(facility_type);

-- ============================================================
-- 3. gym_hours — 지점별 요일/공휴일 운영시간
-- ============================================================
create table if not exists public.gym_hours (
  id              uuid primary key default gen_random_uuid(),
  branch_id       uuid not null references public.gym_branches(id) on delete cascade,
  day_type        text not null
                  check (day_type in ('mon','tue','wed','thu','fri','sat','sun','holiday')),
  open_time       time,
  close_time      time,
  is_closed       boolean not null default false,
  note            text
                  check (note is null or length(note) <= 200),
  effective_from  date not null default current_date,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  updated_by      uuid references auth.users(id) on delete set null,
  constraint chk_hours_consistency check (
    (is_closed = true  and open_time is null     and close_time is null) or
    (is_closed = false and open_time is not null and close_time is not null)
  ),
  unique (branch_id, day_type, effective_from)
);

create index if not exists idx_hours_branch
  on public.gym_hours(branch_id, day_type);

-- ============================================================
-- 4. gym_pricing — 지점별 요금제 (일일권/다회권/월권 등)
-- ============================================================
create table if not exists public.gym_pricing (
  id               uuid primary key default gen_random_uuid(),
  branch_id        uuid not null references public.gym_branches(id) on delete cascade,
  pricing_type     text not null
                   check (pricing_type in ('day_pass','multi_pass','monthly','period','rental','other')),
  label_ko         text not null
                   check (length(label_ko) between 1 and 80),
  price_krw        integer not null
                   check (price_krw between 0 and 10000000),
  unit             text
                   check (unit is null or length(unit) <= 30),
  note             text
                   check (note is null or length(note) <= 300),
  effective_from   date,
  effective_until  date,
  sort_order       integer not null default 100,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  updated_by       uuid references auth.users(id) on delete set null,
  constraint chk_pricing_date_order check (
    effective_from is null or effective_until is null or effective_from <= effective_until
  )
);

create index if not exists idx_pricing_branch
  on public.gym_pricing(branch_id, sort_order);
create index if not exists idx_pricing_type
  on public.gym_pricing(pricing_type);

-- ============================================================
-- 5. updated_at 트리거 (기존 헬퍼 재사용)
-- ============================================================
drop trigger if exists gyms_set_updated_at on public.gyms;
create trigger gyms_set_updated_at
  before update on public.gyms
  for each row execute function public.tg_set_updated_at();

drop trigger if exists gym_branches_set_updated_at on public.gym_branches;
create trigger gym_branches_set_updated_at
  before update on public.gym_branches
  for each row execute function public.tg_set_updated_at();

drop trigger if exists gym_hours_set_updated_at on public.gym_hours;
create trigger gym_hours_set_updated_at
  before update on public.gym_hours
  for each row execute function public.tg_set_updated_at();

drop trigger if exists gym_pricing_set_updated_at on public.gym_pricing;
create trigger gym_pricing_set_updated_at
  before update on public.gym_pricing
  for each row execute function public.tg_set_updated_at();

-- ============================================================
-- 6. RLS — 모든 4테이블 ENABLE + FORCE
-- ============================================================

-- gyms
alter table public.gyms enable row level security;
alter table public.gyms force row level security;

drop policy if exists gyms_read_active on public.gyms;
create policy gyms_read_active on public.gyms
  for select using (is_active = true or public.is_admin());

drop policy if exists gyms_insert_curator on public.gyms;
create policy gyms_insert_curator on public.gyms
  for insert to authenticated
  with check (public.is_admin() or public.has_role('curator'));

drop policy if exists gyms_update_curator on public.gyms;
create policy gyms_update_curator on public.gyms
  for update to authenticated
  using      (public.is_admin() or public.has_role('curator'))
  with check (public.is_admin() or public.has_role('curator'));

drop policy if exists gyms_delete_admin on public.gyms;
create policy gyms_delete_admin on public.gyms
  for delete to authenticated
  using (public.is_admin());

-- gym_branches
alter table public.gym_branches enable row level security;
alter table public.gym_branches force row level security;

drop policy if exists gym_branches_read_active on public.gym_branches;
create policy gym_branches_read_active on public.gym_branches
  for select using (
    public.is_admin() or (
      is_active = true and exists (
        select 1 from public.gyms g
        where g.id = gym_branches.gym_id and g.is_active = true
      )
    )
  );

drop policy if exists gym_branches_insert_curator on public.gym_branches;
create policy gym_branches_insert_curator on public.gym_branches
  for insert to authenticated
  with check (public.is_admin() or public.has_role('curator'));

drop policy if exists gym_branches_update_curator on public.gym_branches;
create policy gym_branches_update_curator on public.gym_branches
  for update to authenticated
  using      (public.is_admin() or public.has_role('curator'))
  with check (public.is_admin() or public.has_role('curator'));

drop policy if exists gym_branches_delete_admin on public.gym_branches;
create policy gym_branches_delete_admin on public.gym_branches
  for delete to authenticated
  using (public.is_admin());

-- gym_hours — 가시성은 부모 branch.is_active 에 종속
alter table public.gym_hours enable row level security;
alter table public.gym_hours force row level security;

drop policy if exists gym_hours_read_active on public.gym_hours;
create policy gym_hours_read_active on public.gym_hours
  for select using (
    public.is_admin() or exists (
      select 1 from public.gym_branches b
      where b.id = gym_hours.branch_id and b.is_active = true
    )
  );

drop policy if exists gym_hours_insert_curator on public.gym_hours;
create policy gym_hours_insert_curator on public.gym_hours
  for insert to authenticated
  with check (public.is_admin() or public.has_role('curator'));

drop policy if exists gym_hours_update_curator on public.gym_hours;
create policy gym_hours_update_curator on public.gym_hours
  for update to authenticated
  using      (public.is_admin() or public.has_role('curator'))
  with check (public.is_admin() or public.has_role('curator'));

drop policy if exists gym_hours_delete_admin on public.gym_hours;
create policy gym_hours_delete_admin on public.gym_hours
  for delete to authenticated
  using (public.is_admin());

-- gym_pricing — 가시성은 부모 branch.is_active 에 종속
alter table public.gym_pricing enable row level security;
alter table public.gym_pricing force row level security;

drop policy if exists gym_pricing_read_active on public.gym_pricing;
create policy gym_pricing_read_active on public.gym_pricing
  for select using (
    public.is_admin() or exists (
      select 1 from public.gym_branches b
      where b.id = gym_pricing.branch_id and b.is_active = true
    )
  );

drop policy if exists gym_pricing_insert_curator on public.gym_pricing;
create policy gym_pricing_insert_curator on public.gym_pricing
  for insert to authenticated
  with check (public.is_admin() or public.has_role('curator'));

drop policy if exists gym_pricing_update_curator on public.gym_pricing;
create policy gym_pricing_update_curator on public.gym_pricing
  for update to authenticated
  using      (public.is_admin() or public.has_role('curator'))
  with check (public.is_admin() or public.has_role('curator'));

drop policy if exists gym_pricing_delete_admin on public.gym_pricing;
create policy gym_pricing_delete_admin on public.gym_pricing
  for delete to authenticated
  using (public.is_admin());

-- ============================================================
-- 7. 권한 부여
-- ============================================================
grant select on public.gyms, public.gym_branches, public.gym_hours, public.gym_pricing
  to anon, authenticated;
grant insert, update, delete on public.gyms, public.gym_branches, public.gym_hours, public.gym_pricing
  to authenticated;
