"use client";
// ロトムの顔: 両目（右目の絵を左右反転して左目に使う）と口。読み上げ中は口の絵を切り替えて、しゃべっているように見せる
// 絵はいただいた画像を SVG で描き起こしたもの（拡大しても荒れない）
import { useEffect, useState } from "react";

/** 右目（傾いた白い楕円の中に水色の楕円。左右に切れ目の線） */
export function Eye({ flip }: { flip?: boolean }) {
  return (
    <svg viewBox="0 0 100 140" className="eye" aria-hidden style={flip ? { transform: "scaleX(-1)" } : undefined}>
      <g transform="rotate(25 50 70)" stroke="#111" strokeWidth="1.6">
        <ellipse cx="50" cy="70" rx="30" ry="52" fill="#f8f8f8" />
        <ellipse cx="50" cy="71" rx="20" ry="35" fill="#58dfe6" />
        <line x1="69.5" y1="68" x2="80" y2="66.5" />
        <line x1="20" y1="74" x2="30.5" y2="72.5" />
      </g>
    </svg>
  );
}

export type MouthShape = "smile" | "teeth" | "open" | "o";

/** 口の絵（viewBox は 4 種類で共通にして、切り替えても位置がずれないようにする） */
export function Mouth({ shape }: { shape: MouthShape }) {
  return (
    <svg viewBox="0 35 125 65" className="mouth" aria-hidden>
      <defs>
        <clipPath id="mouth-open">
          <path d="M9 46 Q62.5 68 116.5 45.5 Q62.5 130 9 46 Z" />
        </clipPath>
        <clipPath id="mouth-o">
          <ellipse cx="62.5" cy="63" rx="20.5" ry="25" />
        </clipPath>
      </defs>
      {shape === "smile" && <path d="M16.5 58 C34 80 91 80 108.5 58" fill="none" stroke="#111" strokeWidth="3" strokeLinecap="round" />}
      {shape === "teeth" && (
        <g stroke="#111" strokeWidth="1.3">
          <path d="M11 52 Q62.5 74 114 52 Q62.5 119 11 52 Z" fill="#fdfdfd" />
          <line x1="41" y1="62.5" x2="41" y2="82.5" />
          <line x1="84" y1="62" x2="84.3" y2="82" />
        </g>
      )}
      {shape === "open" && (
        <g>
          <g clipPath="url(#mouth-open)">
            <rect x="0" y="35" width="125" height="65" fill="#8b2a3a" />
            <ellipse cx="62.5" cy="81" rx="34" ry="12" fill="#d9536b" />
            <ellipse cx="62.5" cy="84" rx="31" ry="10" fill="#f97590" />
            <path d="M9 46 Q62.5 68 116.5 45.5 L116.5 50 Q62.5 82 9 50 Z" fill="#fdfdfd" />
          </g>
          <g stroke="#111" strokeWidth="1.3" fill="none">
            <path d="M12.5 55.5 Q62.5 76 112.5 55.5" />
            <line x1="40.7" y1="56.6" x2="40.7" y2="66" />
            <line x1="84.8" y1="55.5" x2="84.8" y2="65.8" />
            <path d="M9 46 Q62.5 68 116.5 45.5 Q62.5 130 9 46 Z" />
          </g>
        </g>
      )}
      {shape === "o" && (
        <g>
          <g clipPath="url(#mouth-o)">
            <ellipse cx="62.5" cy="63" rx="20.5" ry="25" fill="#dc4f6b" />
            <ellipse cx="62.5" cy="79" rx="17" ry="12" fill="#fb96a9" />
          </g>
          <ellipse cx="62.5" cy="63" rx="20.5" ry="25" fill="none" stroke="#111" strokeWidth="1.6" />
        </g>
      )}
    </svg>
  );
}

/** ふだんの口は歯を見せて笑う。しゃべっている間はそれ以外の口を切り替える（同じ形が続かないように選ぶ） */
const IDLE: MouthShape = "teeth";
const TALK: MouthShape[] = ["open", "o", "smile", "open"];

/** タップの動き（びゅびゅっと移動して戻る）の長さ。globals.css の rotom-zip と合わせる */
const ZIP_MS = 600;

export function RotomFace({ speaking, onTap }: { speaking: boolean; onTap?: () => void }) {
  const [shape, setShape] = useState<MouthShape>(IDLE);
  const [happy, setHappy] = useState(0);
  useEffect(() => {
    if (!happy) return;
    const t = window.setTimeout(() => setHappy(0), ZIP_MS);
    return () => window.clearTimeout(t);
  }, [happy]);
  const tap = () => {
    setHappy(Date.now());
    navigator.vibrate?.(30);
    onTap?.();
  };
  useEffect(() => {
    if (!speaking) {
      setShape(IDLE);
      return;
    }
    let i = 0;
    setShape(TALK[0]);
    const t = window.setInterval(() => {
      i = (i + 1 + Math.floor(Math.random() * 2)) % TALK.length;
      setShape((prev) => (TALK[i] === prev ? TALK[(i + 1) % TALK.length] : TALK[i]));
    }, 130);
    return () => window.clearInterval(t);
  }, [speaking]);
  const face = (
    <>
      {/* いただいた右目の絵（てっぺんが右に傾く）は見る側の右。左はそれを左右反転して使い、てっぺんが外へ開く「\ /」の形にする */}
      <div className="eyes">
        <Eye flip />
        <Eye />
      </div>
      <Mouth shape={shape} />
    </>
  );
  // タップできるときはボタンにする（音を鳴らし、電気のように画面をびゅびゅっと動き回って戻る）。key で毎回アニメーションをやり直す
  return onTap ? (
    <button type="button" key={happy || "idle"} className={`face face-btn ${speaking ? "speaking" : ""} ${happy ? "happy" : ""}`} onClick={tap} aria-label="ロトムをタップ">
      {face}
    </button>
  ) : (
    <div className={`face ${speaking ? "speaking" : ""}`} aria-hidden>
      {face}
    </div>
  );
}
