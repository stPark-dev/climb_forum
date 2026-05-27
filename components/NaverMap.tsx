"use client";

// 네이버 지도 SDK 통합 — 키 없으면 placeholder, 키 있으면 동적 로드
// NEXT_PUBLIC_NAVER_MAP_CLIENT_ID 가 빌드 시점에 인라인되므로 클라이언트에서만 접근 가능.

import { useEffect, useRef, useState } from "react";

interface NaverMapProps {
  lat: number;
  lng: number;
  name: string;
  /** 지도 영역 높이 (px, 기본 320) */
  height?: number;
}

// 네이버 SDK 의 최소 타입 (any 회피)
type NaverLatLng = { lat(): number; lng(): number };
type NaverMapInstance = unknown;
type NaverMarker = unknown;
type NaverInfoWindow = { open(map: NaverMapInstance, marker: NaverMarker): void };
interface NaverMaps {
  LatLng: new (lat: number, lng: number) => NaverLatLng;
  Map: new (el: HTMLElement, opt: { center: NaverLatLng; zoom: number }) => NaverMapInstance;
  Marker: new (opt: { position: NaverLatLng; map?: NaverMapInstance }) => NaverMarker;
  InfoWindow: new (opt: { content: string }) => NaverInfoWindow;
}
interface NaverSdk {
  maps: NaverMaps;
}
declare global {
  interface Window {
    naver?: NaverSdk;
  }
}

const SCRIPT_ID = "naver-map-sdk";

function loadNaverSdk(clientId: string): Promise<NaverSdk> {
  return new Promise((resolve, reject) => {
    if (typeof window === "undefined") {
      reject(new Error("브라우저 환경이 아닙니다"));
      return;
    }
    if (window.naver && window.naver.maps) {
      resolve(window.naver);
      return;
    }
    const existing = document.getElementById(SCRIPT_ID) as HTMLScriptElement | null;
    if (existing) {
      existing.addEventListener("load", () => {
        if (window.naver && window.naver.maps) resolve(window.naver);
        else reject(new Error("네이버 SDK 로드 실패"));
      });
      return;
    }
    const script = document.createElement("script");
    script.id = SCRIPT_ID;
    script.async = true;
    script.src = `https://oapi.map.naver.com/openapi/v3/maps.js?ncpKeyId=${encodeURIComponent(clientId)}`;
    script.onload = () => {
      if (window.naver && window.naver.maps) {
        resolve(window.naver);
      } else {
        reject(new Error("네이버 SDK 객체 없음"));
      }
    };
    script.onerror = () => reject(new Error("네이버 SDK 스크립트 로드 실패"));
    document.head.appendChild(script);
  });
}

export default function NaverMap({ lat, lng, name, height = 320 }: NaverMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [status, setStatus] = useState<"idle" | "loading" | "ready" | "error" | "no-key">("idle");
  const [errorMsg, setErrorMsg] = useState<string>("");

  useEffect(() => {
    const clientId = process.env.NEXT_PUBLIC_NAVER_MAP_CLIENT_ID;
    if (!clientId) {
      setStatus("no-key");
      return;
    }
    let cancelled = false;
    setStatus("loading");
    loadNaverSdk(clientId)
      .then((naver) => {
        if (cancelled || !containerRef.current) return;
        const center = new naver.maps.LatLng(lat, lng);
        const map = new naver.maps.Map(containerRef.current, { center, zoom: 16 });
        const marker = new naver.maps.Marker({ position: center, map });
        const info = new naver.maps.InfoWindow({
          content: `<div style="padding:6px 10px;font-size:13px;color:#1a1a1a;font-weight:600;">${escapeHtml(name)}</div>`,
        });
        info.open(map, marker);
        setStatus("ready");
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setErrorMsg(e instanceof Error ? e.message : "지도 로드 실패");
        setStatus("error");
      });
    return () => {
      cancelled = true;
    };
  }, [lat, lng, name]);

  // 키 미설정 — placeholder
  if (status === "no-key") {
    return (
      <div
        role="img"
        aria-label={`${name} 위치 네이버 지도 (키 미설정으로 placeholder 표시)`}
        style={placeholderStyle(height)}
      >
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: "0.875rem", color: "var(--text-secondary)" }}>지도</div>
          <div style={{ fontSize: "0.75rem", color: "var(--text-secondary)", marginTop: 4 }}>
            네이버 지도 키 미설정
          </div>
          <div style={{ fontSize: "0.75rem", color: "var(--text-secondary)", marginTop: 4 }}>
            위도 {lat.toFixed(5)} · 경도 {lng.toFixed(5)}
          </div>
        </div>
      </div>
    );
  }

  if (status === "error") {
    return (
      <div role="alert" style={placeholderStyle(height)}>
        <div style={{ textAlign: "center", color: "var(--danger)" }}>
          지도를 불러올 수 없습니다
          <div style={{ fontSize: "0.75rem", color: "var(--text-secondary)", marginTop: 4 }}>
            {errorMsg}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      role="img"
      aria-label={`${name} 위치 네이버 지도`}
      style={{
        width: "100%",
        height,
        borderRadius: 12,
        border: "1px solid var(--border)",
        background: "var(--bg-secondary)",
      }}
    />
  );
}

function placeholderStyle(height: number): React.CSSProperties {
  return {
    width: "100%",
    height,
    borderRadius: 12,
    border: "1px dashed var(--border)",
    background: "var(--bg-secondary)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  };
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
