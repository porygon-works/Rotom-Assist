import type { CalcResult } from "./calc";
import type { Named } from "./parse";

const fmt = (n: number) => String(Math.round(n * 10) / 10);

/** 読み上げ用の短い日本語文。「確定」は ko.kind が guaranteed のときだけ使う。 */
export function buildSpeech(names: { attacker: Named; defender: Named; move: Named }, r: CalcResult): string {
  const head = `${names.attacker.ja}の${names.move.ja}、${names.defender.ja}に${fmt(r.minPercent)}から${fmt(r.maxPercent)}パーセント。`;
  let ko: string;
  if (r.max === 0) ko = "ダメージなし。";
  else if (r.ko.kind === "guaranteed") ko = `確定${r.ko.n}発。`;
  else if (r.ko.kind === "chance") ko = `乱数${r.ko.n}発、確率${fmt(r.ko.chance * 100)}パーセント。`;
  else ko = "確定数は出せません。";
  return `${head}${ko}努力値と性格と持ち物は仮定値です。`;
}
