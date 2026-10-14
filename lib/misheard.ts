// 音声認識の聞き間違いを直す（「受診」→「じしん」など）。表は data/misheard.json（節の順・節の中の順に当てる）
import table from "../data/misheard.json";

export interface MisheardRule {
  from: string;
  to: string;
  log: number[];
  note?: string;
  examples: [string, string][];
}

export const MISHEARD: { title: string; rules: MisheardRule[] }[] = table.sections as { title: string; rules: MisheardRule[] }[];

const RULES = MISHEARD.flatMap((s) => s.rules).map((r) => [new RegExp(r.from, "g"), r.to] as const);

/** 聞き間違いを直した文を返す。直していなければ同じ文（2 回当てても同じ文になる） */
export function fixMishearing(text: string): string {
  // 音声認識（Android など）が日本語の単語の間に入れる空白を外す（「エース バーン」→「エースバーン」）
  const joined = text
    // 片側が日本語なら外す（「メガルカリオ Z を」→「メガルカリオZを」）。両側が英数字（「HP 100」）は残す
    .replace(/(?<=[^\x00-\x7F])[ 　]+|[ 　]+(?=[^\x00-\x7F])/g, "");
  return RULES.reduce((t, [re, r]) => t.replace(re, r), joined);
}
