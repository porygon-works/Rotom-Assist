/**
 * 合言葉の検出。認識結果の表記ゆれに備えて候補を並べている。
 * 変えたいときはこのファイルだけ直す。
 */
export const WAKE_WORDS = ["ダメ計", "ダメけい", "ダメケイ", "だめ計", "ダメ系"];

export interface WakeResult {
  found: boolean;
  /** 合言葉のあとの文字列（前後の空白・句読点は除去）。なければ空文字 */
  rest: string;
}

export function extractAfterWakeWord(text: string): WakeResult {
  const s = text.replace(/\s+/g, "");
  let best = -1;
  let bestEnd = -1;
  for (const w of WAKE_WORDS) {
    const i = s.indexOf(w);
    if (i !== -1 && (best === -1 || i < best)) {
      best = i;
      bestEnd = i + w.length;
    }
  }
  if (best === -1) return { found: false, rest: "" };
  return { found: true, rest: s.slice(bestEnd).replace(/^[、。，．,.!！?？\s]+/, "") };
}
