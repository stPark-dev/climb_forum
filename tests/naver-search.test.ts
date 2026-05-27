// 네이버 지역검색 클라이언트 단위 테스트
// 실제 네트워크 호출 없이 fetch 를 mock 해서 검증.
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  naverMapToWgs84,
  normalizeItem,
  RateLimitedError,
  searchLocal,
  stripHtmlTags,
} from "@/lib/server/naver-search";

// ============================================================
// 1. stripHtmlTags — 네이버 title 의 <b></b> 강조 태그 제거
// ============================================================
describe("stripHtmlTags", () => {
  it("<b> 태그를 제거한다", () => {
    expect(stripHtmlTags("<b>더클라임</b> 강남점")).toBe("더클라임 강남점");
  });

  it("대소문자 무관 <B></B>", () => {
    expect(stripHtmlTags("<B>볼더</B>월드")).toBe("볼더월드");
  });

  it("연속 태그도 제거", () => {
    expect(stripHtmlTags("<b>락</b>앤<b>웨이브</b>")).toBe("락앤웨이브");
  });

  it("HTML 엔티티 디코딩 — &amp;, &lt;, &gt;, &quot;, &#39;", () => {
    expect(stripHtmlTags("Rock &amp; Wave")).toBe("Rock & Wave");
    expect(stripHtmlTags("a &lt;b&gt; c")).toBe("a <b> c");
    expect(stripHtmlTags("she said &quot;yo&quot;")).toBe('she said "yo"');
    expect(stripHtmlTags("it&#39;s")).toBe("it's");
  });

  it("태그 없는 입력 그대로", () => {
    expect(stripHtmlTags("플라스틱마운틴")).toBe("플라스틱마운틴");
  });
});

// ============================================================
// 2. naverMapToWgs84 — WGS84 × 10^7 정수 → WGS84 실수
// ============================================================
describe("naverMapToWgs84", () => {
  it("실제 응답 예: 더클라임 양재점 (mapx=1270358964, mapy=374851842)", () => {
    const { lat, lng } = naverMapToWgs84("1270358964", "374851842");
    expect(lng).toBeCloseTo(127.0358964, 7);
    expect(lat).toBeCloseTo(37.4851842, 7);
  });

  it("문자열·숫자 입력 모두 동일 결과", () => {
    const a = naverMapToWgs84("1270320213", "374976095");
    const b = naverMapToWgs84(1270320213, 374976095);
    expect(a.lat).toBeCloseTo(b.lat, 9);
    expect(a.lng).toBeCloseTo(b.lng, 9);
    expect(a.lng).toBeCloseTo(127.0320213, 7);
    expect(a.lat).toBeCloseTo(37.4976095, 7);
  });

  it("잘못된 입력은 throw", () => {
    expect(() => naverMapToWgs84("abc", "def")).toThrow();
  });
});

// ============================================================
// 3. normalizeItem — 응답 1건을 NormalizedHit 으로 변환
// ============================================================
describe("normalizeItem", () => {
  // 실제 네이버 응답 (서울 강남구 클라이밍짐 검색 결과 중 1건) 기반 fixture
  const FIXTURE = {
    title: "더클라임 <b>클라이밍</b> 강남점",
    link: "",
    category: "스포츠,오락>암벽등반",
    description: "",
    telephone: "",
    address: "서울특별시 강남구 역삼동 823-14 화인강남빌딩 B1층",
    roadAddress: "서울특별시 강남구 테헤란로8길 21 화인강남빌딩 B1층",
    mapx: "1270320213",
    mapy: "374976095",
  };

  it("실제 응답 fixture 변환 (<b> 제거·좌표 추출·roadAddress 우선·빈 telephone→null)", () => {
    const hit = normalizeItem(FIXTURE);
    expect(hit).not.toBeNull();
    expect(hit!.name).toBe("더클라임 클라이밍 강남점");
    expect(hit!.rawTitle).toBe("더클라임 <b>클라이밍</b> 강남점");
    expect(hit!.address).toBe(
      "서울특별시 강남구 테헤란로8길 21 화인강남빌딩 B1층",
    );
    expect(hit!.telephone).toBeNull();
    expect(hit!.link).toBeNull();
    expect(hit!.lng).toBeCloseTo(127.0320213, 7);
    expect(hit!.lat).toBeCloseTo(37.4976095, 7);
  });

  it("roadAddress 없으면 address fallback", () => {
    const hit = normalizeItem({ ...FIXTURE, roadAddress: "" });
    expect(hit!.address).toBe(
      "서울특별시 강남구 역삼동 823-14 화인강남빌딩 B1층",
    );
  });

  it("telephone 값 있으면 그대로 유지", () => {
    const hit = normalizeItem({ ...FIXTURE, telephone: "02-1234-5678" });
    expect(hit!.telephone).toBe("02-1234-5678");
  });

  it("link 값 있으면 그대로 유지", () => {
    const hit = normalizeItem({ ...FIXTURE, link: "https://example.com" });
    expect(hit!.link).toBe("https://example.com");
  });

  it("카테고리 필터: '암벽등반' 통과 (실제 네이버 분류)", () => {
    const hit = normalizeItem({ ...FIXTURE, category: "스포츠,오락>암벽등반" });
    expect(hit).not.toBeNull();
  });

  it("카테고리 필터: '볼더링짐' 통과", () => {
    const hit = normalizeItem({ ...FIXTURE, category: "스포츠,오락>볼더링짐" });
    expect(hit).not.toBeNull();
  });

  it("카테고리 필터: '클라이밍센터' 통과", () => {
    const hit = normalizeItem({
      ...FIXTURE,
      category: "스포츠,오락>실내체육관>클라이밍센터",
    });
    expect(hit).not.toBeNull();
  });

  it("카테고리 필터: '당구장' 은 제외", () => {
    const hit = normalizeItem({ ...FIXTURE, category: "스포츠,오락>당구장" });
    expect(hit).toBeNull();
  });

  it("한국 영토 외 좌표 제외 (lat/lng 가 범위 밖)", () => {
    // 도쿄 근처: lng 139.7, lat 35.6 → lng 범위 (124~132) 밖
    const hit = normalizeItem({
      ...FIXTURE,
      mapx: "1397000000",
      mapy: "356800000",
    });
    expect(hit).toBeNull();
  });
});

// ============================================================
// 4. searchLocal — fetch mocking
// ============================================================
describe("searchLocal", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  const okResponse = (items: unknown[]) => ({
    ok: true,
    status: 200,
    json: async () => ({
      lastBuildDate: "Wed, 27 May 2026 12:00:00 +0900",
      total: items.length,
      start: 1,
      display: items.length,
      items,
    }),
    text: async () => JSON.stringify({ items }),
  });

  it("정상 응답 → NormalizedHit[] 반환", async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      okResponse([
        {
          title: "<b>더클라임</b> 강남점",
          link: "",
          category: "스포츠,오락>암벽등반",
          description: "",
          telephone: "02-1234-5678",
          address: "서울특별시 강남구 역삼동",
          roadAddress: "서울특별시 강남구 테헤란로 100",
          mapx: "1270320213",
          mapy: "374976095",
        },
      ]),
    );
    globalThis.fetch = mockFetch as unknown as typeof fetch;

    const hits = await searchLocal("서울 클라이밍짐", "id", "secret");
    expect(hits).toHaveLength(1);
    expect(hits[0].name).toBe("더클라임 강남점");

    // 헤더 검증
    const call = mockFetch.mock.calls[0];
    const initArg = call[1] as RequestInit;
    expect((initArg.headers as Record<string, string>)["X-Naver-Client-Id"]).toBe("id");
    expect((initArg.headers as Record<string, string>)["X-Naver-Client-Secret"]).toBe("secret");
    // URL 검증 — URLSearchParams 는 공백을 '+' 로 인코딩
    const url = String(call[0]);
    expect(url).toContain("openapi.naver.com/v1/search/local.json");
    const decoded = decodeURIComponent(url).replace(/\+/g, " ");
    expect(decoded).toContain("서울 클라이밍짐");
  });

  it("카테고리 필터로 제외된 결과는 빈 배열", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      okResponse([
        {
          title: "축구장",
          link: "",
          category: "스포츠,오락>스포츠시설>실내체육관>축구장",
          description: "",
          telephone: "",
          address: "서울특별시 강남구",
          roadAddress: "",
          mapx: "1270320213",
          mapy: "374976095",
        },
      ]),
    ) as unknown as typeof fetch;

    const hits = await searchLocal("축구장", "id", "secret");
    expect(hits).toEqual([]);
  });

  it("display 옵션은 최대 5로 클램프", async () => {
    const mockFetch = vi.fn().mockResolvedValue(okResponse([]));
    globalThis.fetch = mockFetch as unknown as typeof fetch;
    await searchLocal("test", "id", "secret", { display: 100 });
    const url = String(mockFetch.mock.calls[0][0]);
    expect(url).toContain("display=5");
  });

  it("4xx 응답은 즉시 throw (재시도 안 함)", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => "Unauthorized",
      json: async () => ({}),
    });
    globalThis.fetch = mockFetch as unknown as typeof fetch;
    await expect(searchLocal("test", "id", "secret")).rejects.toThrow(/401/);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("5xx 응답은 1회 재시도 후 throw", async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 503,
        text: async () => "down",
        json: async () => ({}),
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 503,
        text: async () => "down",
        json: async () => ({}),
      });
    globalThis.fetch = mockFetch as unknown as typeof fetch;
    await expect(searchLocal("test", "id", "secret")).rejects.toThrow(/503/);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("5xx → 200 재시도 성공", async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 502,
        text: async () => "bad gateway",
        json: async () => ({}),
      })
      .mockResolvedValueOnce(okResponse([]));
    globalThis.fetch = mockFetch as unknown as typeof fetch;
    const hits = await searchLocal("test", "id", "secret");
    expect(hits).toEqual([]);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("네트워크 에러도 1회 재시도", async () => {
    const mockFetch = vi
      .fn()
      .mockRejectedValueOnce(new Error("ECONNRESET"))
      .mockResolvedValueOnce(okResponse([]));
    globalThis.fetch = mockFetch as unknown as typeof fetch;
    const hits = await searchLocal("test", "id", "secret");
    expect(hits).toEqual([]);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("응답 스키마 불일치 (items 필드 없음) → throw", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ wrong: true }),
      text: async () => "{}",
    }) as unknown as typeof fetch;
    await expect(searchLocal("test", "id", "secret")).rejects.toThrow();
  });

  it("빈 query 는 throw", async () => {
    await expect(searchLocal("", "id", "secret")).rejects.toThrow();
    await expect(searchLocal("   ", "id", "secret")).rejects.toThrow();
  });

  it("clientId/clientSecret 누락 시 throw", async () => {
    await expect(searchLocal("test", "", "secret")).rejects.toThrow();
    await expect(searchLocal("test", "id", "")).rejects.toThrow();
  });

  // ============================================================
  // 4-1. 429 rate limit backoff + 단일 재시도
  // ============================================================
  it("429 → backoff → 재시도 성공", async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 429,
        text: async () => "Rate limit exceeded",
        json: async () => ({}),
      })
      .mockResolvedValueOnce(okResponse([]));
    globalThis.fetch = mockFetch as unknown as typeof fetch;

    const sleep = vi.fn().mockResolvedValue(undefined);
    const onRateLimitRetried = vi.fn();

    const hits = await searchLocal("test", "id", "secret", {
      rateLimitBackoffMs: 5000,
      sleep,
      onRateLimitRetried,
    });

    expect(hits).toEqual([]);
    expect(mockFetch).toHaveBeenCalledTimes(2);
    // backoff 호출이 5000ms 로 정확히 들어왔는지
    expect(sleep).toHaveBeenCalledWith(5000);
    expect(sleep).toHaveBeenCalledTimes(1);
    // 첫 429 → 재시도 성공 시 콜백 1회 호출
    expect(onRateLimitRetried).toHaveBeenCalledTimes(1);
  });

  it("429 두 번 연속 → RateLimitedError throw, 그 쿼리만 skip 가능", async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValue({
        ok: false,
        status: 429,
        text: async () => "Rate limit exceeded",
        json: async () => ({}),
      });
    globalThis.fetch = mockFetch as unknown as typeof fetch;

    const sleep = vi.fn().mockResolvedValue(undefined);

    await expect(
      searchLocal("test", "id", "secret", {
        rateLimitBackoffMs: 5000,
        sleep,
      }),
    ).rejects.toBeInstanceOf(RateLimitedError);

    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(5000);
    expect(sleep).toHaveBeenCalledTimes(1);
  });

  it("429 외 4xx (401) 는 재시도 없이 기존대로 throw (RateLimitedError 아님)", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => "Unauthorized",
      json: async () => ({}),
    });
    globalThis.fetch = mockFetch as unknown as typeof fetch;

    const sleep = vi.fn().mockResolvedValue(undefined);

    let caught: unknown;
    try {
      await searchLocal("test", "id", "secret", { sleep });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(Error);
    expect(caught).not.toBeInstanceOf(RateLimitedError);
    expect((caught as Error).message).toMatch(/401/);

    expect(mockFetch).toHaveBeenCalledTimes(1);
    // 4xx 는 즉시 throw — sleep 불필요
    expect(sleep).not.toHaveBeenCalled();
  });
});
