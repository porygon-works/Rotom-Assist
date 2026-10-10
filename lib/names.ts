import table from "../data/ja-en.json";

export type Kind = keyof typeof table;

const t = (kind: Kind) => table[kind] as Record<string, string>;

/** 対応表にあれば英語名、なければ undefined。 */
export function lookup(kind: Kind, ja: string): string | undefined {
  return t(kind)[ja];
}

/** [日本語, 英語] の一覧（パーサ用） */
export function entries(kind: Kind): [string, string][] {
  return Object.entries(t(kind));
}

/** 日本語名なら英語名へ、未登録ならそのまま返す（英語入力はそのまま通す）。 */
export function toEnglish(kind: Kind, name: string): string {
  return lookup(kind, name.trim()) ?? name.trim();
}
