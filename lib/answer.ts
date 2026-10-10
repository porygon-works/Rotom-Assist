// 回答文（構成設計 9 章）: 最初に結論、次に数値、最後に仮定。読み上げ向けに短く、ロトム口調
// 数値は計算の結果だけを使う（AI を通さない）
import type { DamageAnswer, DamageResult, Ko } from "./battle";

/** 読み上げ用に丸めた割合 */
const p = (n: number) => `${Math.round(n)}`;

export function koSpeech(ko: Ko): string {
  if (ko.kind === "guaranteed") return `確定${ko.n}発`;
  if (ko.kind === "chance") return `乱数${ko.n}発`;
  return "4発以上";
}

/** 画面用の確定数（乱数は確率付き） */
export function koText(ko: Ko, immune: boolean): string {
  if (immune) return "ダメージなし";
  if (ko.kind === "guaranteed") return `確定${ko.n}発`;
  if (ko.kind === "chance") return `乱数${ko.n}発（${(ko.chance * 100).toFixed(1)}%）`;
  return "確定数なし（4発以上）";
}

function rangeText(r: DamageResult) {
  return `${r.min}〜${r.max}（${r.minPercent}〜${r.maxPercent}%）`;
}

export interface DamageNames {
  attacker: string;
  defender: string;
  move: string;
}

/** 質問の聞き方（「耐える？」「落ちる？」）に合わせて結論を言う */
export type DamageQuestion = "survive" | "ko" | "plain";

export function damageQuestionOf(text: string | undefined): DamageQuestion {
  if (!text) return "plain";
  if (/耐え|たえ|残る|のこる/.test(text)) return "survive";
  if (/落ち|おち|落とせ|おとせ|倒せ|たおせ|倒れ|たおれ|確定|ワンパン|一撃/.test(text)) return "ko";
  return "plain";
}

/** 確率の読み上げ（ごく小さいときに「0パーセント」と言わない） */
function chanceSpeech(c: number): string {
  const pct = c * 100;
  if (pct < 1) return "1パーセント未満";
  return `${Math.round(pct)}パーセントくらい`;
}

/** 1 発目で倒せるかで結論を言う */
function verdict(ko: Ko, q: DamageQuestion): string {
  if (q === "plain") return "";
  const ohko = ko.n === 1;
  if (q === "survive") {
    if (!ohko) return "耐えるロト！";
    return ko.kind === "guaranteed" ? "耐えられないロト。" : `乱数ロト。耐える確率は${chanceSpeech(1 - ko.chance)}。`;
  }
  if (!ohko) return "1発では落ちないロト。";
  return ko.kind === "guaranteed" ? "落ちるロト！" : `乱数ロト。落ちる確率は${chanceSpeech(ko.chance)}。`;
}

export interface DamageOptions {
  question?: DamageQuestion;
  /** 振り方の指定がない側 */
  open?: { attacker: boolean; defender: boolean };
  stealthRock?: boolean;
}

export function damageSpeech(n: DamageNames, d: DamageAnswer, notes: string[], opt: DamageOptions = {}): { speech: string; lines: string[] } {
  const b = d.base;
  if (b.immune) {
    return { speech: `${n.attacker}の${n.move}は${n.defender}に効かないロト！`, lines: ["ダメージなし（タイプで無効、または特性など）"] };
  }
  const lines = [`ダメージ ${rangeText(b)}・${koText(b.ko, false)}${opt.stealthRock ? "（ステロ込み）" : ""}`];
  if (b.curHP < b.hp) lines.push(`防御側の HP: ${b.curHP} / ${b.hp} で計算`);
  const sr = opt.stealthRock ? "ステロ込みで" : "";
  const ko = `${sr}${koSpeech(b.ko)}`;
  const chance = b.ko.kind === "chance" ? `倒せるのは${chanceSpeech(b.ko.chance)}。` : "";
  const v = verdict(b.ko, opt.question ?? "plain");
  let speech: string;
  if (d.range) {
    const lo = d.range.low;
    const hi = d.range.high;
    lines.push(`振り方の幅: ${lo.minPercent}%（${koText(lo.ko, lo.immune)}）〜 ${hi.maxPercent}%（${koText(hi.ko, hi.immune)}）`);
    const who = opt.open?.attacker && opt.open?.defender ? "無振り同士なら" : opt.open?.attacker ? "攻撃側が無振りなら" : "防御側が無振りなら";
    // 結論が振り方しだいで変わるときは言い切らない
    let caveat = "";
    if ((opt.question ?? "plain") !== "plain") {
      if (b.ko.n !== 1 && hi.ko.n === 1) caveat = "ただ、振り方しだいで1発で落ちることがあるロト。";
      if (b.ko.n === 1 && lo.ko.n !== 1) caveat = "ただ、振り方しだいで耐えることがあるロト。";
    }
    speech = `${v}${caveat}${who}${ko}ロト。${chance}${p(b.minPercent)}から${p(b.maxPercent)}パーセント。振り方しだいで${p(lo.minPercent)}から${p(hi.maxPercent)}パーセントロト`;
  } else {
    speech = `${v}${ko}ロト！ ${chance}${p(b.minPercent)}から${p(b.maxPercent)}パーセントロト`;
  }
  if (b.curHP < b.hp) speech += `。残りHP${b.curHP}で計算したロト`;
  if (notes.length) speech = `${notes.join("。")}。${speech}`;
  return { speech, lines };
}

export const STAT_JA: Record<string, string> = { hp: "H", atk: "A", def: "B", spa: "C", spd: "D", spe: "S" };
export const CATEGORY_JA: Record<string, string> = { Physical: "物理", Special: "特殊", Status: "変化" };

export function clarifySpeech(missing: string[]): string {
  if (missing.includes("attacker")) return "どのポケモンが攻撃するロト？";
  if (missing.includes("defender")) return "どのポケモンに撃つロト？";
  if (missing.includes("move")) return "どの技ロト？";
  return "ごめん、もう一回言ってほしいロト";
}
