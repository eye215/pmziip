import type { Metadata } from "next";
import "./globals.css";
import "../features/records/records.css";

export const metadata: Metadata = {
  title: "PM.zip · 제품 성과 워크스페이스",
  description: "요구사항부터 성과 검증까지 연결하는 PM 워크스페이스",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
