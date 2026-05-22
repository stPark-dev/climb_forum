# Phase 0 — 아키텍처 (아키 작성)

> 본 문서는 대한민국 실내 클라이밍 포털의 시스템 아키텍처 초안.
> 확정 사항: Supabase (PostgreSQL + Auth + Storage + Realtime), RLS 필수.
> 결정 항목: 프론트엔드 프레임워크, Supabase 접근 방식, 배포 토폴로지, ERD, RLS 정책, 한국 OAuth 흐름.

---

## 1. 프론트엔드 프레임워크 권장안

### 1.1 후보 비교

| 항목 | Next.js 15 (App Router) | Remix v2 | SvelteKit 2 |
|---|---|---|---|
| 렌더링 모델 | RSC + SSR + ISR + SSG 모두 1급 | SSR + 데이터 로더 중심 | SSR + SSG + 어댑터별 ISR 부분 |
| Supabase 통합 | @supabase/ssr 공식, 가장 성숙 | 커뮤니티 헬퍼, 덜 성숙 | 커뮤니티 패키지, 가장 덜 성숙 |
| 이미지 최적화 | next/image 내장 | 별도 라이브러리 | enhanced-img |
| 한국 사용자 레이턴시 | Vercel/Cloudflare 양쪽 가능 | Cloudflare 어댑터 강함 | Cloudflare/Vercel 어댑터 |
| 생태계 (shadcn/ui 등) | 가장 큼 | 중간 | 작음 |
| 채용/외주 풀 | 매우 큼 | 작음 | 작음 |

### 1.2 권장: **Next.js 15 App Router** (차선: Remix v2)

근거:
- Supabase 공식 지원이 가장 성숙. `@supabase/ssr`로 인증 쿠키·서버 컴포넌트·route handler 통합이 1급.
- next/image가 사용자 업로드 사진 최적화에 즉시 활용 가능 (AVIF/WebP, 반응형 srcset).
- RSC + Server Actions가 RLS와 자연스럽게 어울림: 서버에서 사용자 JWT를 쿠키로 받아 Supabase 호출 → RLS 평가.
- 디시 스타일 커뮤니티(SSR) + 큐레이션 꿀팁(ISR) + 관리자(클라이언트) 화면별 렌더링 패턴이 다른 프로젝트에 적합.
- 채용 풀이 가장 커서 외주·인수인계 비용 최저.

차선 Remix를 남기는 이유: Cloudflare Workers 환경에서 어댑터가 강력, 데이터 로딩 모델 단순. SvelteKit은 인력 풀·라이브러리 빈약으로 제외.

### 1.3 Next.js 채택 시 부수 결정
- React 19, App Router 단독 사용 (Pages Router 미사용)
- route group: `app/(public)/`, `app/(auth)/`, `app/(admin)/`
- 상태: TanStack Query v5 + Zustand
- UI: shadcn/ui + Tailwind CSS v4
- 폼: react-hook-form + zod
- 폰트: Pretendard Variable, Wanted Sans (자이 design.md에서 확정)

---

## 2. Supabase 접근 방식

### 2.1 후보
- (A) supabase-js + @supabase/ssr 단독
- (B) Drizzle ORM 혼합
- (C) Prisma 혼합
- (D) Kysely 쿼리 빌더만

### 2.2 권장: **(A) supabase-js + Supabase CLI 마이그레이션**

근거:
- RLS는 PostgREST 경로에서 평가됨. supabase-js는 PostgREST를 호출하므로 RLS가 자연스럽게 작동. ORM이 service role로 직접 connection을 잡으면 RLS 우회 위험.
- Supabase CLI 마이그레이션이 충분히 성숙. `supabase/migrations/*.sql`을 git에 두고 `supabase db push`로 배포. RLS·트리거·함수 모두 SQL 단일 소스.
- Auth 트리거(신규 가입 시 profiles 생성), Storage 정책(버킷별 RLS) 같은 Supabase 특화 기능은 SQL/Dashboard 기반.
- 타입 안전성은 `supabase gen types typescript --linked > types/db.ts`로 자동 생성. 별도 ORM 없이도 IDE 자동완성·컴파일 타임 체크 충분.
- Drizzle은 추후 "스키마 단일 소스" 보조 옵션으로만 검토(런타임 쿼리는 여전히 supabase-js 유지).

### 2.3 안티패턴 — 금지
- 클라이언트 번들에 service role key 노출 금지 (`NEXT_PUBLIC_*` 접두사 사용 금지).
- ORM이 service role로 직접 DB 접속해 일반 데이터 흐름에서 RLS 우회 금지.
- raw SQL string concat 금지 — 항상 파라미터 바인딩.

---

## 3. 배포 토폴로지

### 3.1 후보 비교

| 항목 | Vercel | Cloudflare Pages + Workers | Netlify |
|---|---|---|---|
| Next.js 호환 | 1급 | 점차 좋아짐, 일부 기능 제약 | 좋음, Edge functions 제약 |
| 한국 레이턴시 | 도쿄/서울 PoP | 서울 PoP 매우 강함 | 도쿄 위주 |
| 비용 | 트래픽·invocation 기준, 중규모↑ 부담 | 매우 저렴 | 중간 |
| 이미지 최적화 | next/image 완벽 | Cloudflare Images 별도 | 자체 처리 |

### 3.2 권장: **Vercel (MVP~베타) → 트래픽 분기점에서 Cloudflare 이관 옵션 보유**

근거:
- 초기 단계에서는 Next.js + Supabase 통합과 next/image, Server Actions가 가장 안정적인 Vercel이 안전.
- 비용은 트래픽이 늘면서 분기점. 월 수십만 PV까지는 Vercel Pro로 충분. 그 이상이면 Cloudflare 이관 필요.
- 코드는 Vercel 의존을 최소화: 이미지 변환은 Supabase Storage transform을 1순위로, next/image는 캐싱·반응형 용도로만.

### 3.3 환경 분리
- **dev**: 로컬 Supabase CLI (`supabase start` 도커 풀스택)
- **staging**: 별도 Supabase 프로젝트(`-staging`) + Vercel preview
- **prod**: 별도 Supabase 프로젝트(`-prod`) + Vercel production
- 시크릿은 Vercel env 환경별 분리, service role key는 server-only.

### 3.4 Supabase 리전
- **서울(ap-northeast-2) 권장**. 도쿄(ap-northeast-1) 차선.
- PIPA상 국외이전 고지는 어느 쪽이든 필요하지만 서울이면 약관 설명 단순.

---

## 4. 이미지·CDN 전략

### 4.1 파이프라인
1. 클라이언트 EXIF 제거(browser-image-compression) + 1차 리사이즈 (장변 2048px)
2. Server Action으로 멀티파트 업로드 → Supabase Storage
3. Storage 정책: `uploads/<user_id>/...` 본인만 PUT
4. 표시 시 Storage transform URL: `?width=800&format=webp&quality=70`
5. next/image로 감싸 반응형 srcset + lazy load

### 4.2 버킷 설계
- `gym-photos` — 클라이밍장 공식 사진 (관리자 write, public read)
- `user-uploads` — 사용자 게시글 첨부 (본인 write, 게시글 권한에 따른 read)
- `avatars` — 프로필 이미지 (본인 write, public read)
- `tip-images` — 꿀팁 이미지 (큐레이터 write, public read)

### 4.3 보호 항목
- 업로드 시 magic byte MIME 검증
- 최대 파일 10MB
- 동영상은 외부 임베드(YouTube/Vimeo)만, 자체 호스팅 안 함 (초기)
- 멀웨어 스캔은 초기 미적용, 패러독스 게이트로 추후 결정

---

## 5. 캐싱 전략

### 5.1 페이지 캐싱
| 화면 | 전략 | 이유 |
|---|---|---|
| 홈 피드 | SSR + 짧은 ISR (30~60초) | 신선도↔부하 |
| 클라이밍장 목록·지도 | ISR 5~10분 | 변경 빈도 낮음 |
| 클라이밍장 상세 | ISR 5~10분 | 동상 |
| 커뮤니티 글 목록 | SSR + 30초 캐시 | 실시간성 |
| 게시글 상세 | SSR + revalidateTag (작성·수정·삭제) | 실시간 + 정합성 |
| 꿀팁 카테고리/상세 | ISR 1시간 + revalidate on publish | 큐레이션 |
| 마이페이지/관리자 | SSR no-cache | 본인 데이터 / 권한 |

### 5.2 클라이언트 캐싱
- TanStack Query v5: stale 5분
- 좋아요·댓글은 optimistic update
- Realtime 구독: 게시글 상세 실시간 댓글, 알림 토스트

### 5.3 DB 최적화
- 인덱스: `posts(category_id, created_at desc)`, `comments(post_id, created_at)`, `gym_branches(region, city)`, `tip_articles(level_id, category_id)`
- RLS 정책에 쓰이는 컬럼(`author_id`, `is_deleted`, `status`)에 모두 인덱스
- 댓글수·추천수는 비정규화 컬럼 + 트리거 동기화

---

## 6. ERD 초안

### 6.1 도메인 그룹
1. 계정·권한: profiles, user_levels, bans
2. 클라이밍장: gyms, gym_branches, gym_hours, gym_pricing, gym_amenities, gym_photos, gym_reviews
3. 커뮤니티: post_categories, posts, comments, post_votes, comment_votes, bookmarks
4. 꿀팁: tip_levels, tip_categories, tip_articles, tip_sources, tip_revisions, tip_comments, tip_read_states
5. 신고·운영: reports, audit_log, notifications

### 6.2 mermaid ERD

\`\`\`mermaid
erDiagram
    profiles ||--o{ posts : author
    profiles ||--o{ comments : author
    profiles ||--o{ post_votes : voter
    profiles ||--o{ comment_votes : voter
    profiles ||--o{ bookmarks : owner
    profiles ||--o{ gym_reviews : reviewer
    profiles ||--o{ tip_read_states : reader
    profiles ||--o{ reports : reporter
    profiles ||--o{ notifications : recipient
    profiles }o--|| user_levels : current_level
    profiles ||--o{ bans : subject

    gyms ||--o{ gym_branches : operates
    gym_branches ||--o{ gym_hours : has
    gym_branches ||--o{ gym_pricing : offers
    gym_branches ||--o{ gym_amenities : provides
    gym_branches ||--o{ gym_photos : shows
    gym_branches ||--o{ gym_reviews : receives
    gym_branches ||--o{ posts : tagged_in

    post_categories ||--o{ posts : categorizes
    posts ||--o{ comments : has
    posts ||--o{ post_votes : scored_by
    comments ||--o{ comment_votes : scored_by
    posts ||--o{ bookmarks : saved_in
    posts ||--o{ reports : flagged_in
    comments ||--o{ reports : flagged_in

    tip_categories ||--o{ tip_articles : categorizes
    tip_levels ||--o{ tip_articles : rated_at
    tip_articles ||--o{ tip_sources : cites
    tip_articles ||--o{ tip_revisions : history
    tip_articles ||--o{ tip_comments : discussion
    tip_articles ||--o{ tip_read_states : tracks
\`\`\`

### 6.3 주요 테이블 컬럼 스케치

#### profiles
| 컬럼 | 타입 | 비고 |
|---|---|---|
| id | uuid PK | auth.users.id FK |
| username | text unique | URL 슬러그 |
| display_name | text | |
| avatar_url | text | Storage URL |
| bio | text | |
| role | text default 'user' | user/curator/moderator/admin |
| level | int default 1 | 1~10 |
| points | int default 0 | 누적 활동 점수 |
| is_banned | bool default false | |
| created_at | timestamptz default now() | |
| updated_at | timestamptz | trigger |

#### gym_branches
| 컬럼 | 타입 |
|---|---|
| id | uuid PK |
| gym_id | uuid FK gyms |
| name | text |
| address | text |
| address_detail | text |
| region | text (시/도) |
| city | text (시/군/구) |
| lat | double precision |
| lng | double precision |
| phone | text |
| instagram_handle | text (연동 → research.md) |
| description | text |
| difficulty_range | text[] |
| ceiling_height_m | numeric |
| has_lead | bool |
| has_bouldering | bool |
| has_speed | bool |
| status | text default 'active' (active/closed/pending) |
| verified_at | timestamptz |
| created_at / updated_at | timestamptz |

#### posts
| 컬럼 | 타입 |
|---|---|
| id | uuid PK |
| category_id | uuid FK post_categories |
| author_id | uuid FK profiles nullable (탈퇴 처리) |
| title | text |
| body | text (마크다운) |
| body_html | text (사니타이즈 결과 캐시) |
| tagged_branch_id | uuid FK gym_branches nullable |
| view_count | int default 0 |
| upvotes / downvotes | int default 0 (비정규화) |
| comment_count | int default 0 (비정규화) |
| is_anonymous | bool default false |
| is_hidden | bool default false (운영자 블라인드) |
| is_deleted | bool default false (soft delete) |
| created_at / updated_at | timestamptz |

#### tip_articles
| 컬럼 | 타입 |
|---|---|
| id | uuid PK |
| slug | text unique |
| title | text |
| level_id | uuid FK tip_levels (입문~엘리트) |
| category_id | uuid FK tip_categories |
| summary | text (2~3문장) |
| body | text (마크다운) |
| body_html | text (사니타이즈) |
| disclaimer | text (의료·재활 면책) |
| status | text default 'draft' (draft/in_review/published/archived) |
| author_id | uuid FK profiles (큐레이터) |
| reviewed_by | uuid FK profiles (패러독스 리뷰어) |
| published_at | timestamptz |
| read_count | int default 0 |
| created_at / updated_at | timestamptz |

#### tip_sources
id, article_id, title, publisher, author, url, accessed_at, note

#### reports
id, reporter_id, target_type (post/comment/user/gym_review), target_id, reason_code (spam/abuse/illegal/copyright/other), detail, status (open/reviewing/resolved/dismissed), handled_by, handled_at, created_at

#### audit_log
id bigserial, actor_id, action, target_type, target_id, metadata jsonb, created_at

### 6.4 인덱스 초안
\`\`\`sql
CREATE INDEX idx_posts_category_created ON posts(category_id, created_at DESC) WHERE is_deleted = false;
CREATE INDEX idx_posts_author ON posts(author_id) WHERE is_deleted = false;
CREATE INDEX idx_comments_post_created ON comments(post_id, created_at) WHERE is_deleted = false;
CREATE INDEX idx_gym_branches_region_city ON gym_branches(region, city) WHERE status = 'active';
CREATE INDEX idx_gym_branches_geo ON gym_branches USING gist(point(lng, lat));
CREATE INDEX idx_tip_articles_level_category ON tip_articles(level_id, category_id) WHERE status = 'published';
CREATE INDEX idx_reports_status_created ON reports(status, created_at DESC);
CREATE INDEX idx_audit_log_actor_created ON audit_log(actor_id, created_at DESC);
\`\`\`

---

## 7. RLS 정책 초안

### 7.1 역할 모델
JWT의 `auth.role()` 외에 `profiles.role`을 신뢰 소스로:
- anon — 비로그인
- authenticated — 일반
- curator — 꿀팁 작성
- moderator — 신고 처리, 글 숨김
- admin — 모든 권한

헬퍼:
\`\`\`sql
create or replace function public.has_role(required text)
returns boolean language sql stable security definer set search_path = public as \$\$
  select exists (
    select 1 from profiles
    where id = auth.uid() and role = required and is_banned = false
  );
\$\$;

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as \$\$
  select has_role('admin');
\$\$;
\`\`\`

### 7.2 테이블별 정책

#### profiles
\`\`\`sql
alter table profiles enable row level security;

create policy "profiles_read" on profiles
  for select using (is_banned = false or is_admin());

create policy "profiles_update_self" on profiles
  for update using (auth.uid() = id or is_admin())
  with check (auth.uid() = id or is_admin());

create policy "profiles_insert_self" on profiles
  for insert with check (auth.uid() = id);
\`\`\`

#### posts
\`\`\`sql
alter table posts enable row level security;

create policy "posts_read" on posts
  for select using (
    is_deleted = false
    and (is_hidden = false or auth.uid() = author_id or is_admin() or has_role('moderator'))
  );

create policy "posts_insert" on posts
  for insert with check (
    auth.uid() = author_id
    and not exists (select 1 from profiles where id = auth.uid() and is_banned = true)
  );

create policy "posts_update_own" on posts
  for update using (auth.uid() = author_id and is_deleted = false)
  with check (auth.uid() = author_id);

create policy "posts_admin_update" on posts
  for update using (is_admin() or has_role('moderator'));

create policy "posts_delete_own" on posts
  for delete using (auth.uid() = author_id or is_admin());
\`\`\`

#### comments — posts와 동일 패턴

#### post_votes
\`\`\`sql
create policy "votes_read_self" on post_votes
  for select using (auth.uid() = voter_id or is_admin());
create policy "votes_insert" on post_votes
  for insert with check (auth.uid() = voter_id);
create policy "votes_delete_own" on post_votes
  for delete using (auth.uid() = voter_id);
\`\`\`
(개별 투표는 본인/관리자만, 집계는 posts의 비정규화 컬럼)

#### tip_articles
\`\`\`sql
create policy "tips_read_published" on tip_articles
  for select using (status = 'published' or has_role('curator') or is_admin());
create policy "tips_insert_curator" on tip_articles
  for insert with check (has_role('curator') or is_admin());
create policy "tips_update_curator" on tip_articles
  for update using (has_role('curator') or is_admin());
create policy "tips_delete_admin" on tip_articles
  for delete using (is_admin());
\`\`\`

#### reports
\`\`\`sql
create policy "reports_insert" on reports
  for insert with check (auth.uid() = reporter_id);
create policy "reports_read_admin" on reports
  for select using (is_admin() or has_role('moderator'));
create policy "reports_update_admin" on reports
  for update using (is_admin() or has_role('moderator'));
\`\`\`

#### gym_branches
\`\`\`sql
create policy "gyms_read_public" on gym_branches
  for select using (status = 'active' or is_admin());
create policy "gyms_write_admin" on gym_branches
  for insert with check (is_admin() or has_role('moderator'));
\`\`\`
사용자 제보는 별도 staging 테이블(gym_branch_submissions)에서 운영자 승인 후 복사.

#### audit_log
\`\`\`sql
create policy "audit_read_admin" on audit_log for select using (is_admin());
create policy "audit_insert_system" on audit_log for insert with check (false);
\`\`\`
실제 insert는 SECURITY DEFINER 함수를 통해서만.

### 7.3 RLS 성능 함정
- 정책에 사용되는 컬럼은 반드시 인덱스 (author_id, status, is_deleted)
- has_role() 같은 함수는 STABLE + 캐시 가능하게
- OR 정책 여러 개일 때 시퀀스 스캔으로 떨어질 수 있음 → 인덱스 보강

### 7.4 운영 원칙
- 모든 신규 테이블 마이그레이션에서 `enable row level security` 강제
- CI에서 pg_tables vs pg_policies 비교해 누락 검출
- 정책 변경은 PR + 패러독스 리뷰 필수

---

## 8. 한국 OAuth 연동 흐름

### 8.1 카카오 OAuth 시퀀스

\`\`\`mermaid
sequenceDiagram
    autonumber
    participant U as 사용자(브라우저)
    participant F as 프론트(Next.js)
    participant SB as Supabase Auth
    participant K as Kakao OAuth
    participant DB as Postgres + RLS

    U->>F: 카카오로 로그인 클릭
    F->>SB: supabase.auth.signInWithOAuth({provider:'kakao'})
    SB-->>U: 302 to kauth.kakao.com/oauth/authorize?client_id=...&redirect_uri=https://<supabase>/auth/v1/callback&scope=profile_nickname,account_email
    U->>K: 카카오 로그인 + 동의
    K-->>U: 302 to https://<supabase>/auth/v1/callback?code=AUTH_CODE
    U->>SB: GET /auth/v1/callback?code=AUTH_CODE
    SB->>K: POST /oauth/token (code, client_secret)
    K-->>SB: access_token + refresh_token
    SB->>K: GET /v2/user/me
    K-->>SB: { id, kakao_account.email, properties.nickname }
    SB->>DB: upsert auth.users + emit session JWT
    DB->>DB: trigger handle_new_user → profiles insert
    SB-->>U: 302 to https://<our-site>/auth/callback#access_token=...
    U->>F: GET /auth/callback
    F->>F: supabase-js가 fragment에서 토큰 추출 → 쿠키 저장
    F-->>U: 홈으로 리다이렉트
\`\`\`

### 8.2 네이버 OAuth — 차이점만
- 인가: https://nid.naver.com/oauth2.0/authorize
- 토큰: https://nid.naver.com/oauth2.0/token
- 프로필: https://openapi.naver.com/v1/nid/me
- 권한: 이메일·닉네임. 프로필 사진은 별도 검수.
- state 파라미터 의무 (Supabase 자동 처리)

### 8.3 구글 OAuth
- Supabase가 OIDC 표준으로 1급 지원. scope: openid email profile.

### 8.4 신규 가입 시 profiles 자동 생성 트리거
\`\`\`sql
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public, auth as \$\$
declare
  raw_meta jsonb := new.raw_user_meta_data;
  display text := coalesce(raw_meta->>'name', raw_meta->>'nickname', raw_meta->>'full_name', split_part(new.email, '@', 1));
  avatar text := coalesce(raw_meta->>'avatar_url', raw_meta->>'profile_image', raw_meta->>'picture');
begin
  insert into public.profiles (id, username, display_name, avatar_url)
  values (new.id, 'user_' || substring(new.id::text, 1, 8), display, avatar)
  on conflict (id) do nothing;
  return new;
end;
\$\$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
\`\`\`

### 8.5 콜백 URL 화이트리스트
- Supabase Dashboard → Authentication → URL Configuration
- Site URL: https://climb.example.kr
- Redirect URLs: 프로덕션 + preview 도메인 + http://localhost:3000/auth/callback
- 카카오·네이버 콘솔에는 Supabase 콜백 URL (https://<project>.supabase.co/auth/v1/callback)만 등록

### 8.6 세션 운영
- JWT exp: 1시간 (기본)
- Refresh token rotation: ON
- 로그아웃 시 supabase.auth.signOut + 모든 디바이스 옵션

---

## 9. 관찰성·운영 메타

### 9.1 로그
- Supabase: Database/API/Auth/Storage 로그 — Dashboard 30일 보관, 외부 sink로 export
- 앱: 구조화 로그(pino) → Vercel Logs → Logtail/Better Stack로 수집

### 9.2 에러 트래킹
- Sentry 공식 Next.js SDK. 클라이언트·서버 양쪽. PII 마스킹 규칙 필수

### 9.3 메트릭
- KPI: DAU, 게시글/댓글/투표 수, 꿀팁 read rate, 가입 전환율, 오류율
- Vercel Analytics 또는 PostHog (자체 호스팅 가능, PIPA 친화)

### 9.4 헬스체크
- /api/health — DB ping, Storage ping, build sha
- 외부 uptime: Better Uptime / UptimeRobot 1분 간격

### 9.5 로컬 개발
\`\`\`bash
npm i -g supabase
supabase init
supabase link --project-ref <staging-ref>
supabase start    # 도커 풀스택
supabase db reset # 마이그레이션 + seed
npm run dev
\`\`\`

\`.env.local\`:
\`\`\`
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...   # server only, .gitignore
\`\`\`

### 9.6 백업
- Supabase 자동 백업 (Pro PITR 7일)
- 주 1회 pg_dump → 별도 스토리지 30일, 분기 1회 복원 리허설

---

## 10. 미해결 / 후속 논의

1. 검색 엔진: Postgres FTS 시작 vs Meilisearch/Typesense 베타에서 재평가
2. Realtime 채택 범위: 댓글 실시간 vs 비용 → 베타 부하 테스트 후
3. revalidateTag 동작 검증 (Next 15)
4. 인스타 연동 결과 (research.md 대기) — 불가능 시 instagram_handle은 외부 링크 카드용으로만
5. 사용자 제보 클라이밍장 승인 워크플로우 (자이·미라지·패러독스 합의)
6. 익명/반익명 게시글 신원 추적 (PIPA·통신비밀보호법) — 패러독스 검토
7. 다국어 — 일단 한국어 단일, 영문 UI 라벨만 보조
8. CDN edge cache key 규칙 (로그인/비로그인 분리, cookie 변동)
9. PWA·웹 푸시 도입 여부 (자이 톤 확정 후)
10. Drizzle 도입 시점 — 테이블 30+, 마이그레이션 50+ 시점 재검토

---

## 부록 A. ADR 후보
- ADR-001: Next.js 15 App Router 채택
- ADR-002: Supabase-js 단독, ORM 미도입
- ADR-003: Vercel 배포 (Cloudflare 이관 옵션)
- ADR-004: RLS 헬퍼 함수(has_role) 도입
- ADR-005: 이미지 파이프라인 (Storage transform + next/image)
- ADR-006: 카카오·네이버는 Supabase Generic OAuth

## 부록 B. 약어
RLS / ISR / RSC / PIPA / FTS
