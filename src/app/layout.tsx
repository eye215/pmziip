import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";
import "../features/records/records.css";
import "./theme.css";

// Self-hosted (no external font request), one variable file for all weights.
const pretendard = localFont({
  src: "./fonts/PretendardVariable-KS.woff2",
  weight: "45 920",
  display: "swap",
  variable: "--font-pretendard",
});

export const metadata: Metadata = {
  title: "PM.zip · 제품 성과 워크스페이스",
  description: "요구사항부터 성과 검증까지 연결하는 PM 워크스페이스",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ko" className={pretendard.variable}>
      <body>{children}</body>
    </html>
  );
}
