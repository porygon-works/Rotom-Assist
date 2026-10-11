// ダメ計の計算条件カード（画面用）: 攻撃側・防御側・わざ・場を分けて、何を指定して何を仮定したかを見せる
import { abilityOf, gen, moveInfo, pickNature, type DamageAnswer, type FieldInput, type SideInput, type Stat } from "./battle";
import { CATEGORY_JA, koText } from "./answer";
import { toJa } from "./resolve";

/** 1 項目。assumed: 言われていないので仮定した値 */
export interface CardItem {
  label: string;
  value: string;
  assumed?: boolean;
}

export interface SideCard {
  role: "攻撃側" | "防御側";
  name: string;
  items: CardItem[];
}

export interface DamageCard {
  attacker: SideCard;
  defender: SideCard;
  move: { name: string; type: string; category: string; power: string };
  field: string[];
  result: { damage: string; ko: string; range?: string };
}

const ORDER: Stat[] = ["hp", "atk", "def", "spa", "spd", "spe"];
const LETTER: Record<Stat, string> = { hp: "H", atk: "A", def: "B", spa: "C", spd: "D", spe: "S" };
const WEATHER: Record<string, string> = { Sun: "晴れ", Rain: "雨", Sand: "砂嵐", Snow: "雪" };
const TERRAIN: Record<string, string> = { Electric: "エレキフィールド", Grassy: "グラスフィールド", Psychic: "サイコフィールド", Misty: "ミストフィールド" };
const STATUS: Record<string, string> = { brn: "やけど", par: "まひ", psn: "どく", tox: "もうどく", slp: "ねむり", frz: "こおり" };

/** 振り方: 同じ値の能力をまとめる（HB32、A32 C20）。0 は書かない */
export function spreadText(sp: SideInput["sp"]): string {
  const groups = new Map<number, string>();
  for (const k of ORDER) {
    const v = sp?.[k];
    if (!v) continue;
    groups.set(v, (groups.get(v) ?? "") + LETTER[k]);
  }
  return [...groups].map(([v, letters]) => `${letters}${v}`).join(" ");
}

/** 性格補正: 計算に使った性格の上がる・下がる能力（A↑ C↓）と、言われた部分 */
function natureItem(s: SideInput): CardItem {
  const name = pickNature(s.natureUp, s.natureDown, s.nature);
  const n = gen.natures.get(name.toLowerCase() as never) as { plus?: Stat; minus?: Stat } | undefined;
  const ja = toJa("natures", name);
  if (!n?.plus || !n.minus || n.plus === n.minus) return { label: "性格", value: "補正なし", assumed: !s.nature };
  const arrows = `${LETTER[n.plus]}↑ ${LETTER[n.minus]}↓`;
  if (s.nature) return { label: "性格", value: `${arrows}（${ja}）` };
  // 片方だけ言われたときは、もう片方を仮定した（計算に響きにくい方）
  const filled = [!s.natureUp && `${LETTER[n.plus]}↑`, !s.natureDown && `${LETTER[n.minus]}↓`].filter(Boolean);
  return { label: "性格", value: `${arrows}（${ja}${filled.length ? `。${filled.join("・")}は仮定` : ""}）` };
}

function boostText(b: SideInput["boosts"], intimidate?: number): string {
  const parts = ORDER.filter((k) => b?.[k as keyof typeof b]).map((k) => {
    const v = b![k as keyof typeof b]!;
    return `${LETTER[k]}${v > 0 ? "+" : ""}${v}`;
  });
  if (intimidate !== undefined && intimidate !== 0) parts.push(`A${intimidate > 0 ? "+" : ""}${intimidate}（いかく）`);
  return parts.join(" ");
}

function sideCard(role: SideCard["role"], ja: string, s: SideInput, ability: string | undefined, open: boolean, extra: { intimidate?: number } = {}): SideCard {
  const items: CardItem[] = [];
  const sp = spreadText(s.sp);
  items.push(sp ? { label: "振り方", value: sp } : { label: "振り方", value: open ? "無振り（幅も計算）" : "無振り", assumed: true });
  items.push(natureItem(s));
  const boosts = boostText(s.boosts, extra.intimidate);
  items.push({ label: "能力ランク", value: boosts || "なし", assumed: !boosts });
  items.push(s.item ? { label: "持ち物", value: toJa("items", s.item) } : { label: "持ち物", value: "なし", assumed: true });
  items.push({ label: "特性", value: ability ? toJa("abilities", ability) : "-", assumed: !s.ability });
  if (s.status) items.push({ label: "状態", value: STATUS[s.status] ?? s.status });
  if (s.hpLeftPercent !== undefined) items.push({ label: "残りHP", value: `${s.hpLeftPercent}%` });
  if (s.hpLeft !== undefined) items.push({ label: "残りHP", value: String(s.hpLeft) });
  if (s.stealthRock) items.push({ label: "ステロ", value: "込み" });
  if (s.disguiseBroken) items.push({ label: "ばけのかわ", value: "剥がれている（残りHP 7/8）" });
  return { role, name: ja, items };
}

export function fieldTexts(f: FieldInput): string[] {
  return [
    f.weather && (WEATHER[f.weather] ?? f.weather),
    f.terrain && (TERRAIN[f.terrain] ?? f.terrain),
    f.reflect && "リフレクター",
    f.lightScreen && "ひかりのかべ",
    f.critical && "急所",
  ].filter(Boolean) as string[];
}

/** 自動で入れた「英語名:特性」から、その特性が入れた場（天候かフィールド）を取り出す */
function fieldOfAuto(auto: string, f: FieldInput): FieldInput {
  const ab = auto.split(":")[1];
  return /Surge|Hadron/.test(ab) ? { terrain: f.terrain } : { weather: f.weather };
}

export function damageCard(
  names: { attacker: string; defender: string; move: string },
  a: SideInput,
  d: SideInput,
  moveEn: string,
  r: DamageAnswer,
  open: { attacker: boolean; defender: boolean },
): DamageCard {
  const m = moveInfo(moveEn);
  const b = r.base;
  return {
    attacker: sideCard("攻撃側", names.attacker, a, r.abilities.attacker ?? abilityOf(a), open.attacker, { intimidate: r.intimidate }),
    defender: sideCard("防御側", names.defender, d, r.abilities.defender ?? abilityOf(d), open.defender),
    move: { name: names.move, type: toJa("types", m.type), category: CATEGORY_JA[m.category] ?? m.category, power: m.bp ? String(m.bp) : "-" },
    // 特性で入れた天候・フィールドは、どの特性かを添える（晴れ（ひでり））
    field: fieldTexts(r.field).map((t) => {
      const auto = r.autoField.find((x) => fieldTexts(fieldOfAuto(x, r.field)).includes(t));
      return auto ? `${t}（${toJa("abilities", auto.split(":")[1])}）` : t;
    }),
    result: {
      damage: b.immune ? "ダメージなし" : `${b.min}〜${b.max}（${b.minPercent}〜${b.maxPercent}%）`,
      ko: koText(b.ko, b.immune),
      range: r.range ? `振り方しだいで ${r.range.low.minPercent}〜${r.range.high.maxPercent}%` : undefined,
    },
  };
}
