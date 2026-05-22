# climb_forum

대한민국 실내 클라이밍 커뮤니티 포털.

- 클라이밍장 정보 + 지도
- 디시 톤 커뮤니티 게시판
- 숙련도별 큐레이션 꿀팁
- 관리자 백오피스

## 기술 스택

- **Next.js 14** (App Router) + TypeScript + React 18
- **Supabase 클라우드** — PostgreSQL + Auth + Storage + Realtime
- **vitest** — 단위·통합 테스트

## 로컬 셋업 (Supabase 클라우드 프로젝트 사용)

```bash
# 1. 의존성
npm install

# 2. 환경변수
cp .env.example .env.local
# .env.local 편집:
#   NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY
#   SUPABASE_SERVICE_ROLE_KEY (server only)

# 3. 클라우드 프로젝트 link + 마이그레이션 적용
npx supabase login            # access token 1회 등록
npx supabase link --project-ref <ref>
npx supabase db push          # supabase/migrations/* 클라우드에 push

# 4. 마이그레이션 적용 상태 확인
npx supabase migration list   # LOCAL / REMOTE 동기화 확인

# 5. 개발 서버
npm run dev
# http://localhost:3000

# 6. 테스트
npm test
```

> **로컬 도커 Supabase는 사용하지 않습니다.** 모든 인증·DB·Storage·Realtime은 Supabase 클라우드(서울 또는 도쿄 리전 권장)에서 동작합니다.

## 디렉터리

```
app/                Next.js App Router
  auth/             로그인·가입·OAuth 콜백·로그아웃
  (public)/         (예약)
lib/supabase/       Supabase 클라이언트·서버·미들웨어 헬퍼
supabase/
  config.toml       supabase link/push에 필요한 설정
  migrations/       SQL 마이그레이션 (단일 소스)
tests/              vitest 단위 테스트
docs/phase-0/       Phase 0 산출물 (아키텍처·연구·꿀팁 전략·디자인·운영 체크리스트)
```

## Google OAuth 활성화

1. https://console.cloud.google.com → API & Services → Credentials → OAuth 2.0 Client ID 생성 (Web application)
2. **Authorized redirect URIs**에 `https://<project-ref>.supabase.co/auth/v1/callback` 등록
3. Supabase Dashboard → Authentication → Providers → **Google** 활성화 → Client ID/Secret 입력
4. Supabase Dashboard → Authentication → URL Configuration:
   - Site URL: `https://climb.example.kr` (또는 로컬은 `http://localhost:3000`)
   - Redirect URLs: `http://localhost:3000/auth/callback`, `https://climb.example.kr/auth/callback`
5. 사이트 도메인을 Google OAuth 동의 화면 (Authorized domains)에도 등록

코드는 별도 `GOOGLE_CLIENT_ID` 환경변수 없이 동작합니다 — Supabase가 토큰 교환을 대신 처리.

## RLS 정책

모든 `public` 스키마 테이블에 RLS 활성. 누락 검출은 `tests/migrations.test.ts`가 CI 게이트로 강제.

## Phase 0 산출물

`docs/phase-0/` 참고.
