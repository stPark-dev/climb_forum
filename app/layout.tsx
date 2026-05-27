import type { Metadata } from "next";
import "./globals.css";
import SiteHeader from "@/components/SiteHeader";

export const metadata: Metadata = {
  title: "ClimbForum — 대한민국 실내 클라이밍 포털",
  description: "실내 클라이밍장 정보 · 커뮤니티 · 단계별 꿀팁",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body>
        <SiteHeader />
        {children}
      </body>
    </html>
  );
}
