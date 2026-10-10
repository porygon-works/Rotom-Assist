import type { ReactNode } from "react";
import "./globals.css";

export const metadata = {
  title: "ロトムアシスト",
  description: "ポケモン対戦ダメージ計算・音声アシスタント",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ja">
      <body>{children}</body>
    </html>
  );
}
