import type { Metadata } from "next";
import { Syne, Space_Mono } from "next/font/google";
import "./globals.css";
import SiteHeader from "@/components/SiteHeader";

// Creative Voltage — 영문 display/mono 페어. 한글은 Pretendard (CDN <link>).
const syne = Syne({
  subsets: ["latin"],
  weight: ["400", "700", "800"],
  variable: "--font-display",
  display: "swap",
});
const spaceMono = Space_Mono({
  subsets: ["latin"],
  weight: ["400", "700"],
  variable: "--font-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "ClimbForum — 대한민국 실내 클라이밍 포털",
  description: "실내 클라이밍장 정보 · 커뮤니티 · 단계별 꿀팁",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko" className={`${syne.variable} ${spaceMono.variable}`}>
      <head>
        {/* Pretendard — 한글 본문 폰트 (CDN static, woff2 서브셋) */}
        <link
          rel="stylesheet"
          href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/static/pretendard.min.css"
        />
      </head>
      <body>
        <SiteHeader />
        {children}
      </body>
    </html>
  );
}
