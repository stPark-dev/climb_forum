-- climb_forum dev-seed-sample (NOT a migration)
-- 목적: 카카오맵 SDK + SSR 동선 시각 검증용
-- 출처: jjiyo.com / sunnyday030.com 블로그 (WebSearch 확인 2026-05-26)
-- 좌표는 도로명 주소 기반 근사값 — admin UI 마일스톤(Phase 1.5)에서 정밀화 예정
-- 실행: Supabase SQL Editor 또는 psql로 1회. 마이그레이션 디렉토리에 포함하지 말 것.

-- 1. gyms
INSERT INTO public.gyms (slug, name_ko, brand_type, website_url, is_active)
VALUES ('the-climb', '더클라임', 'chain', 'http://theclimb.co.kr', true)
ON CONFLICT (slug) DO NOTHING;

-- 2. gym_branches
INSERT INTO public.gym_branches (
  gym_id, slug, name_ko, region_sido, region_sgg, address, lat, lng, phone, facility_type, is_active
)
SELECT
  g.id,
  'the-climb-gangnam',
  '더클라임 강남점',
  '서울',
  '강남구',
  '서울 강남구 테헤란로8길 21 화인강남빌딩 B1층',
  37.4990,
  127.0290,
  '02-566-8821',
  'bouldering',
  true
FROM public.gyms g WHERE g.slug = 'the-climb'
ON CONFLICT (slug) DO NOTHING;

-- 3. gym_hours (평일 10-23, 주말 10-20)
INSERT INTO public.gym_hours (branch_id, day_type, open_time, close_time, is_closed)
SELECT b.id, day_type::text, '10:00'::time,
  CASE WHEN day_type IN ('sat','sun') THEN '20:00'::time ELSE '23:00'::time END,
  false
FROM public.gym_branches b
CROSS JOIN unnest(ARRAY['mon','tue','wed','thu','fri','sat','sun']) AS day_type
WHERE b.slug = 'the-climb-gangnam'
ON CONFLICT (branch_id, day_type, effective_from) DO NOTHING;
