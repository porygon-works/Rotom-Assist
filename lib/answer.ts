// 回答文（構成設計 9 章）: 最初に結論、次に数値、最後に仮定。読み上げ向けに短く、ロトム口調
// 数値は計算の結果だけを使う（AI を通さない）
import type { DamageAnswer, DamageResult, Ko } from "./battle";

/** 読み上げ用に丸めた割合 */
const p = (n: number) => `${Math.round(n)}`;

export function koSpeech(ko: Ko): string {
  if (ko.n >= 5 || ko.kind === "none") return "5発以上";
  if (ko.kind === "guaranteed") return `確定${ko.n}発`;
  if (ko.kind === "chance") return `乱数${ko.n}発`;
  return "4発以上";
}

/** 画面用の確定数（乱数は確率付き） */
export function koText(ko: Ko, immune: boolean): string {
  if (immune) return "ダメージなし";
  if (ko.kind === "none" || ko.n >= 5) return "5発以上";
  if (ko.kind === "guaranteed") return `確定${ko.n}発`;
  if (ko.kind === "chance") return `乱数${ko.n}発（${(ko.chance * 100).toFixed(1)}%）`;
  return "確定数なし（4発以上）";
}

/** 1 発目を耐える・防ぐ持ち物と特性の呼び方 */
const ENDURE: Record<string, { name: string; short: string; verb: string }> = {
  "Focus Sash": { name: "きあいのタスキ", short: "タスキ", verb: "1回耐える" },
  Sturdy: { name: "がんじょう", short: "がんじょう", verb: "1回耐える" },
  Disguise: { name: "ばけのかわ", short: "ばけのかわ", verb: "1発目を防ぐ" },
};

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
  if (pct >= 99.5) return "ほぼ確実";
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
  stealthRock?: boolean;
}

/**
 * ダメ計の読み上げ。順番は「結論 → 場合分け（補正あり・耐久振り）→ 前提（仮定・特性など）」。
 * 前提は notes（特性・天候などの一言）と d.assumed（言われていないので仮定したこと）
 */
export function damageSpeech(n: DamageNames, d: DamageAnswer, notes: string[], opt: DamageOptions = {}): { speech: string; short: string; lines: string[] } {
  const b = d.base;
  if (b.immune) {
    const t = `${n.attacker}の${n.move}は${n.defender}に効かないロト！`;
    return { speech: notes.length ? `${t}${notes.join("。")}` : t, short: t, lines: ["ダメージなし（タイプで無効、または特性など）"] };
  }
  const lines: string[] = [];
  if (b.curHP < b.hp) lines.push(`防御側の HP: ${b.curHP} / ${b.hp} で計算`);
  const en = b.endured ? ENDURE[b.endured] : undefined;
  if (en) lines.push(b.endured === "Disguise" ? "ばけのかわで 1 発目を防ぐ（満タンのとき。剥がれると最大 HP の 1/8 減る）。確定数はこれを含む" : `${en.name}で 1 発目は耐える（満タンのとき）`);
  const sr = opt.stealthRock ? "ステロ込みで" : "";
  const q = opt.question ?? "plain";
  const v = verdict(b.ko, q);
  // 結論で確率を言ったときは繰り返さない
  const chance = b.ko.kind === "chance" && b.ko.n < 5 && !v.includes("確率") ? `倒せるのは${chanceSpeech(b.ko.chance)}。` : "";
  // 1. 結論
  const head = `${v}${sr}${koSpeech(b.ko)}ロト。${chance}${p(b.minPercent)}から${p(b.maxPercent)}パーセント`;
  // 2. 場合分け（言われていない条件で結果が変わる幅）
  const cases: string[] = [];
  const caseText = (label: string, r: DamageResult) => `${label}${koSpeech(r.ko)}、${p(r.minPercent)}から${p(r.maxPercent)}パーセント`;
  if (d.attackerBoosted) cases.push(caseText("攻撃側が補正ありなら", d.attackerBoosted));
  if (d.defenderBulky) cases.push(caseText("防御側が耐久に振っていたら", d.defenderBulky));
  // 「耐える？」「落ちる？」の結論が場合分けで変わるときは言い添える
  let caveat = "";
  if (q !== "plain") {
    if (b.ko.n !== 1 && d.attackerBoosted?.ko.n === 1) caveat = "ただ、攻撃側が補正ありだと1発で落ちることがあるロト";
    else if (b.ko.n === 1 && d.defenderBulky && d.defenderBulky.ko.n !== 1) caveat = "ただ、防御側が耐久に振っていたら耐えることがあるロト";
  }
  // 3. 前提
  const premise = [...notes];
  if (en) premise.push(`${n.defender}は${en.short}で${en.verb}ロト`);
  if (d.assumed.length) premise.push(`${d.assumed.join("、")}で計算したロト`);
  if (b.curHP < b.hp) premise.push(`残りHP${b.curHP}で計算したロト`);
  const speech = [head, caveat, ...cases, ...premise].filter(Boolean).join("。");
  // 短い読み上げ: 結論・確定数・ダメージ範囲だけ（場合分けと前提は画面だけ）
  const short = `${v}${sr}${koSpeech(b.ko)}ロト。${p(b.minPercent)}から${p(b.maxPercent)}パーセント${en ? `。${en.short}で${en.verb}ロト` : ""}`;
  return { speech, short, lines };
}

export const STAT_JA: Record<string, string> = { hp: "H", atk: "A", def: "B", spa: "C", spd: "D", spe: "S" };
export const CATEGORY_JA: Record<string, string> = { Physical: "物理", Special: "特殊", Status: "変化" };

export function clarifySpeech(missing: string[]): string {
  if (missing.includes("attacker")) return "どのポケモンが攻撃するロト？";
  if (missing.includes("defender")) return "どのポケモンに撃つロト？";
  if (missing.includes("move")) return "どの技ロト？";
  return "ごめん、もう一回言ってほしいロト";
}
