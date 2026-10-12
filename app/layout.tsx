import type { ReactNode } from "react";
import "./globals.css";

export const metadata = {
  title: "ロトムアシスト",
  description: "ポケモン対戦ダメージ計算・音声アシスタント",
  // アイコンは app/icon.png（ブラウザのタブなど）と app/apple-icon.png（iPhone のホーム画面）。ロトムの顔の下にロゴ
  appleWebApp: { title: "ロトムアシスト", capable: true, statusBarStyle: "default" as const },
};

export const viewport = {
  themeColor: "#ff7a00",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover" as const,
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ja">
      <body>{children}</body>
    </html>
  );
}
