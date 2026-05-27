// 서버 전용 — 네이버 지역검색 API 클라이언트
// https://developers.naver.com/docs/serviceapi/search/local/local.md
//
// - X-Naver-Client-Id / X-Naver-Client-Secret 헤더는 SERVICE_ROLE 과 같은 등급으로 다룬다.
// - 클라이언트 컴포넌트에서는 import 금지 (브라우저로 키 노출 방지).
// - mapx/mapy 는 WGS84 × 10^7 정수 문자열. 1e7 로 나눠 lat/lng 추출.
// - 카테고리에 '클라이밍' / '볼더링' / '암벽등반' / '암벽' 중 하나라도 없는 행은 제외.
// - 한국 영토 좌표 범위 (lat 33~39, lng 124~132) 를 벗어나면 제외.

import { z } from "zod";

// ============================================================
// 1. 좌표 추출 (WGS84 × 10^7 정수 → WGS84 실수)
// ============================================================
// 네이버 지역검색 v1 은 mapx/mapy 를 WGS84 좌표 × 10^7 정수 문자열로 반환한다.
//   예) mapx="1270358964" → lng = 127.0358964
//       mapy="374851842"  → lat = 37.4851842
export function naverMapToWgs84(
  mapx: string | number,
  mapy: string | number,
): { lat: number; lng: number } {
  const x = typeof mapx === "string" ? parseInt(mapx, 10) : mapx;
  const y = typeof mapy === "string" ? parseInt(mapy, 10) : mapy;
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    throw new Error(`잘못된 좌표: mapx=${mapx}, mapy=${mapy}`);
  }
  return { lat: y / 1e7, lng: x / 1e7 };
}

// ============================================================
// 2. HTML 태그 제거 + 엔티티 디코딩 (네이버 title 정리)
// ============================================================
const HTML_ENTITY_MAP: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
  "&apos;": "'",
};

export function stripHtmlTags(input: string): string {
  return input
    .replace(/<\/?b>/gi, "")
    .replace(/&(?:amp|lt|gt|quot|apos|#39);/g, (m) => HTML_ENTITY_MAP[m] ?? m)
    .trim();
}

// ============================================================
// 3. 응답 zod 스키마
// ============================================================
const NaverItemSchema = z.object({
  title: z.string(),
  link: z.string().optional(),
  category: z.string(),
  description: z.string().optional(),
  telephone: z.string().optional(),
  address: z.string(),
  roadAddress: z.string().optional(),
  mapx: z.string(),
  mapy: z.string(),
});
export type NaverItem = z.infer<typeof NaverItemSchema>;

const NaverResponseSchema = z.object({
  total: z.number(),
  start: z.number(),
  display: z.number(),
  items: z.array(NaverItemSchema),
});

// ============================================================
// 4. 정규화 결과 타입
// ============================================================
export interface NormalizedHit {
  rawTitle: string;
  name: string; // <b> 태그 제거된 매장명
  category: string;
  telephone: string | null;
  address: string; // roadAddress 우선
  lat: number;
  lng: number;
  link: string | null;
}

// 카테고리 필터: '클라이밍' / '볼더링' / '암벽등반' / '암벽' 중 하나라도 포함되면 통과.
// 네이버는 클라이밍짐을 '스포츠,오락>암벽등반' 으로 분류하므로 이를 반드시 포함해야 한다.
const CLIMBING_KEYWORDS = ["클라이밍", "볼더링", "암벽등반", "암벽"];
function isClimbingCategory(category: string): boolean {
  return CLIMBING_KEYWORDS.some((k) => category.includes(k));
}

// 한국 영토 범위 (DB CHECK 와 동일)
function isInKoreaBounds(lat: number, lng: number): boolean {
  return lat >= 33 && lat <= 39 && lng >= 124 && lng <= 132;
}

// ============================================================
// 5. 1건 정규화 — 필터링 실패 시 null
// ============================================================
export function normalizeItem(raw: unknown): NormalizedHit | null {
  const parsed = NaverItemSchema.safeParse(raw);
  if (!parsed.success) return null;
  const item = parsed.data;

  if (!isClimbingCategory(item.category)) return null;

  let lat: number;
  let lng: number;
  try {
    ({ lat, lng } = naverMapToWgs84(item.mapx, item.mapy));
  } catch {
    return null;
  }
  if (!isInKoreaBounds(lat, lng)) return null;

  const name = stripHtmlTags(item.title);
  const address =
    item.roadAddress && item.roadAddress.trim().length > 0
      ? item.roadAddress
      : item.address;
  const telephone =
    item.telephone && item.telephone.trim().length > 0 ? item.telephone : null;
  const link = item.link && item.link.trim().length > 0 ? item.link : null;

  return {
    rawTitle: item.title,
    name,
    category: item.category,
    telephone,
    address,
    lat,
    lng,
    link,
  };
}

// ============================================================
// 6. searchLocal — 한 번의 검색 호출
// ============================================================
export interface SearchOptions {
  display?: number;
  sort?: "random" | "comment";
  // 429 백오프 대기(ms). 기본 5000ms. 테스트에서 짧게 주입.
  rateLimitBackoffMs?: number;
  // sleep 함수 DI — 테스트에서 fake timer 우회용.
  sleep?: (ms: number) => Promise<void>;
  // 429 → 5s 대기 → 재시도 → 또 429 일 때 호출되는 콜백 (호출부 카운터용).
  onRateLimitRetried?: () => void;
}

// 429 두 번 연속 발생 시 사용. 호출부가 잡아서 skip 처리.
export class RateLimitedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RateLimitedError";
  }
}

const API_URL = "https://openapi.naver.com/v1/search/local.json";
const MAX_DISPLAY = 5; // 네이버 지역검색은 다른 검색 API와 달리 최대 5건
const DEFAULT_RATE_LIMIT_BACKOFF_MS = 5000;

function clampDisplay(d: number | undefined): number {
  if (d == null) return MAX_DISPLAY;
  if (!Number.isFinite(d) || d < 1) return 1;
  return Math.min(MAX_DISPLAY, Math.floor(d));
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export async function searchLocal(
  query: string,
  clientId: string,
  clientSecret: string,
  opts: SearchOptions = {},
): Promise<NormalizedHit[]> {
  if (!query || query.trim().length === 0) {
    throw new Error("query 가 비어 있습니다");
  }
  if (!clientId) throw new Error("NAVER_SEARCH_CLIENT_ID 가 비어 있습니다");
  if (!clientSecret) throw new Error("NAVER_SEARCH_CLIENT_SECRET 가 비어 있습니다");

  const params = new URLSearchParams({
    query: query.trim(),
    display: String(clampDisplay(opts.display)),
    sort: opts.sort ?? "random",
  });
  const url = `${API_URL}?${params.toString()}`;
  const backoffMs = opts.rateLimitBackoffMs ?? DEFAULT_RATE_LIMIT_BACKOFF_MS;
  const sleep = opts.sleep ?? defaultSleep;

  // 5xx · 네트워크 에러는 1회 재시도. 다른 4xx 는 그대로 throw.
  // 429 는 backoffMs 대기 후 1회 재시도; 두 번째도 429 면 RateLimitedError.
  const maxAttempts = 2;
  let lastError: unknown;
  let rateLimitRetried = false;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const res = await fetch(url, {
        method: "GET",
        headers: {
          "X-Naver-Client-Id": clientId,
          "X-Naver-Client-Secret": clientSecret,
          Accept: "application/json",
        },
      });

      if (!res.ok) {
        const body = await safeReadText(res);
        // 429: rate limit — backoff 후 1회 재시도, 두 번째도 429 면 RateLimitedError
        if (res.status === 429) {
          if (attempt < maxAttempts) {
            rateLimitRetried = true;
            await sleep(backoffMs);
            continue;
          }
          if (rateLimitRetried) opts.onRateLimitRetried?.();
          throw new RateLimitedError(
            `네이버 API 429: ${body.slice(0, 200)}`,
          );
        }
        // 다른 4xx: 인증·할당량·키 문제 — 즉시 throw
        if (res.status >= 400 && res.status < 500) {
          throw new Error(`네이버 API ${res.status}: ${body.slice(0, 200)}`);
        }
        // 5xx: 재시도
        lastError = new Error(`네이버 API ${res.status}: ${body.slice(0, 200)}`);
        if (attempt < maxAttempts) continue;
        throw lastError;
      }

      const json = await res.json();
      const parsed = NaverResponseSchema.safeParse(json);
      if (!parsed.success) {
        throw new Error(
          `네이버 응답 스키마 불일치: ${parsed.error.issues
            .map((i) => i.message)
            .join(", ")}`,
        );
      }

      const hits: NormalizedHit[] = [];
      for (const raw of parsed.data.items) {
        const hit = normalizeItem(raw);
        if (hit) hits.push(hit);
      }
      // 첫 시도 429 → 재시도 성공 케이스: 호출부에 알림
      if (rateLimitRetried) opts.onRateLimitRetried?.();
      return hits;
    } catch (err) {
      // RateLimitedError / 다른 4xx / 스키마 에러는 재시도 없이 즉시 전파
      if (err instanceof RateLimitedError) {
        throw err;
      }
      if (err instanceof Error && err.message.startsWith("네이버 API 4")) {
        throw err;
      }
      if (err instanceof Error && err.message.startsWith("네이버 응답 스키마")) {
        throw err;
      }
      lastError = err;
      if (attempt < maxAttempts) continue;
      throw err;
    }
  }
  throw lastError ?? new Error("네이버 검색 실패");
}

async function safeReadText(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return "";
  }
}
