import table from "../data/ja-en.json" with { type: "json" };

type Kind = keyof typeof table;

/** 日本語名なら英語名へ、未登録ならそのまま返す（英語入力はそのまま通す）。 */
export function toEnglish(kind: Kind, name: string): string {
  return (table[kind] as Record<string, string>)[name.trim()] ?? name.trim();
}
