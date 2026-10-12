// 音声認識の聞き間違いを直す（「受診」→「じしん」など）。表は data/misheard.json
import table from "../data/misheard.json";

const RULES = (table.rules as [string, string][]).map(([p, r]) => [new RegExp(p, "g"), r] as const);

/** 聞き間違いを直した文を返す。直していなければ同じ文 */
export function fixMishearing(text: string): string {
  // 音声認識（Android など）が日本語の単語の間に入れる空白を外す（「エース バーン」→「エースバーン」）。英数字どうしの空白は残す
  const joined = text.replace(/(?<=[^\x00-\x7F])[ \u3000]+(?=[^\x00-\x7F])/g, "");
  return RULES.reduce((t, [re, r]) => t.replace(re, r), joined);
}
