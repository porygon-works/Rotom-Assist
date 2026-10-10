/**
 * 合言葉の検出。認識結果の表記ゆれに備えて候補を並べている。
 * 変えたいときはこのファイルだけ直す。
 */
// 音声認識は「ダメ計」を別表記で返しがちなので、聞き違い候補も入れている。
// 履歴に「合言葉なし（無視）」で残った表記があれば、ここに足す。
export const WAKE_WORDS = [
  "ダメ計", "ダメけい", "ダメケイ", "だめ計", "ダメ系", "ダメ経", "だめ経", "ダメ慶", "ダメ圭",
  "駄目計", "ダメ計算", "ダメージ計算", "ダメージけいさん", "ダメージケイサン",
];

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
    if (i !== -1 && (best === -1 || i < best || (i === best && i + w.length > bestEnd))) {
      best = i;
      bestEnd = i + w.length;
    }
  }
  if (best === -1) return { found: false, rest: "" };
  return { found: true, rest: s.slice(bestEnd).replace(/^[、。，．,.!！?？\s]+/, "") };
}
