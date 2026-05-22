import { describe, it, expect } from "vitest";
import {
  sanitizeReturnTo,
  buildOAuthRedirect,
  stripTrailingSlash,
  isValidRole,
  VALID_ROLES,
  GOOGLE_SCOPE,
} from "@/lib/supabase/auth-helpers";

describe("sanitizeReturnTo", () => {
  it("기본 슬래시로 normalize", () => {
    expect(sanitizeReturnTo("/")).toBe("/");
    expect(sanitizeReturnTo("/tips")).toBe("/tips");
    expect(sanitizeReturnTo("/community/post/123")).toBe("/community/post/123");
  });

  it("open redirect — 외부 URL 차단", () => {
    expect(sanitizeReturnTo("http://evil.com")).toBe("/");
    expect(sanitizeReturnTo("https://evil.com")).toBe("/");
    expect(sanitizeReturnTo("//evil.com/path")).toBe("/");
    expect(sanitizeReturnTo("javascript:alert(1)")).toBe("/");
    expect(sanitizeReturnTo("data:text/html,<script>1</script>")).toBe("/");
  });

  it("상대 경로 강제", () => {
    expect(sanitizeReturnTo("relative")).toBe("/");
    expect(sanitizeReturnTo("")).toBe("/");
    // @ts-expect-error: null input
    expect(sanitizeReturnTo(null)).toBe("/");
  });
});

describe("stripTrailingSlash", () => {
  it("끝 슬래시 제거", () => {
    expect(stripTrailingSlash("http://localhost:3000/")).toBe("http://localhost:3000");
    expect(stripTrailingSlash("http://localhost:3000")).toBe("http://localhost:3000");
    expect(stripTrailingSlash("/")).toBe("");
  });
});

describe("buildOAuthRedirect", () => {
  it("기본 next='/'", () => {
    expect(buildOAuthRedirect("http://localhost:3000")).toBe(
      "http://localhost:3000/auth/callback?next=%2F",
    );
  });

  it("커스텀 next 인코딩", () => {
    expect(buildOAuthRedirect("http://localhost:3000", "/tips?level=1")).toBe(
      "http://localhost:3000/auth/callback?next=%2Ftips%3Flevel%3D1",
    );
  });

  it("외부 URL 시도 시 / 로 대체", () => {
    expect(buildOAuthRedirect("http://localhost:3000", "https://evil.com")).toBe(
      "http://localhost:3000/auth/callback?next=%2F",
    );
  });

  it("siteUrl 끝 슬래시 처리", () => {
    expect(buildOAuthRedirect("http://localhost:3000/", "/me")).toBe(
      "http://localhost:3000/auth/callback?next=%2Fme",
    );
  });
});

describe("isValidRole", () => {
  it("정의된 role만 통과", () => {
    for (const r of VALID_ROLES) {
      expect(isValidRole(r)).toBe(true);
    }
    expect(isValidRole("superadmin")).toBe(false);
    expect(isValidRole("")).toBe(false);
    expect(isValidRole(123)).toBe(false);
    expect(isValidRole(null)).toBe(false);
  });
});

describe("GOOGLE_SCOPE", () => {
  it("OIDC 표준 + 최소 권한만 포함", () => {
    expect(GOOGLE_SCOPE).toContain("openid");
    expect(GOOGLE_SCOPE).toContain("email");
    expect(GOOGLE_SCOPE).toContain("profile");
    // 과도한 스코프 없음
    expect(GOOGLE_SCOPE).not.toContain("drive");
    expect(GOOGLE_SCOPE).not.toContain("gmail");
    expect(GOOGLE_SCOPE).not.toContain("calendar");
    expect(GOOGLE_SCOPE).not.toContain("contacts");
  });
});
