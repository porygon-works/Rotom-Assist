import { calculate, Generations, Pokemon, Move, Field } from "@smogon/calc";
import { toEnglish } from "./names";

export interface Side {
  pokemon: string;
  item?: string;
  ability?: string;
  nature?: string;
  /** 努力値。未指定は assumptions に記録される */
  evs?: Partial<Record<"hp" | "atk" | "def" | "spa" | "spd" | "spe", number>>;
  boosts?: Partial<Record<"atk" | "def" | "spa" | "spd" | "spe", number>>;
  teraType?: string;
}

export interface CalcInput {
  attacker: Side;
  defender: Side;
  move: string;
  /** 世代（既定 9） */
  gen?: number;
  field?: { weather?: string; terrain?: string; isDoubles?: boolean };
}

export interface KoInfo {
  /** guaranteed: 乱数の全範囲でN発で倒せる / chance: 乱数次第 / none: 確定数を出せない */
  kind: "guaranteed" | "chance" | "none";
  n: number;
  /** 0〜1。kind が chance のとき確率 */
  chance: number;
}

export interface CalcResult {
  min: number;
  max: number;
  minPercent: number;
  maxPercent: number;
  hp: number;
  ko: KoInfo;
  /** 例: "確定2発" "乱数1発（37.5%）" */
  koText: string;
  assumptions: string[];
  description: string;
}

export const DEFAULT_GEN = 9;
const LEVEL = 50;

function build(gen: ReturnType<typeof Generations.get>, side: Side) {
  return new Pokemon(gen, toEnglish("pokemon", side.pokemon), {
    level: LEVEL,
    item: side.item ? toEnglish("items", side.item) : undefined,
    ability: side.ability,
    nature: side.nature ?? "Hardy",
    evs: side.evs ?? {},
    boosts: side.boosts,
    teraType: side.teraType as never,
  });
}

export function calc(input: CalcInput): CalcResult {
  const gen = Generations.get((input.gen ?? DEFAULT_GEN) as never);

  const assumptions = [`Lv${LEVEL}、個体値31`];
  const unspecified = (f: (s: Side) => unknown) => !f(input.attacker) || !f(input.defender);
  if (unspecified((s) => s.evs)) assumptions.push("努力値は未指定のため0振り（仮定）");
  if (unspecified((s) => s.nature)) assumptions.push("性格は未指定のため補正なし（仮定）");
  if (unspecified((s) => s.item)) assumptions.push("持ち物は未指定のためなし（仮定）");

  const attacker = build(gen, input.attacker);
  const defender = build(gen, input.defender);
  const move = new Move(gen, toEnglish("moves", input.move));
  const field = new Field({
    gameType: input.field?.isDoubles ? "Doubles" : "Singles",
    weather: input.field?.weather as never,
    terrain: input.field?.terrain as never,
  });

  const result = calculate(gen, attacker, defender, move, field);
  const dmg = result.damage;
  const rolls = (Array.isArray(dmg) ? dmg : [dmg]).flat() as number[];
  const min = Math.min(...rolls);
  const max = Math.max(...rolls);
  const hp = defender.maxHP();
  // Showdown の表示と同じ切り捨て
  const pct = (n: number) => Math.floor((n * 1000) / hp) / 10;

  // 確定数は @smogon/calc が乱数16通り（連続技は全組合せ）から求めた確率で判定する。
  // chance === 1 のときだけ「確定」と言う。それ以外は「乱数」。
  // ダメージ0（無効・ひこうへのじしん等）では kochance() が例外を出すので呼ばない。
  const k = max === 0 ? { n: 0, chance: 0 } : result.kochance();
  let ko: KoInfo;
  let koText: string;
  if (max === 0) {
    ko = { kind: "none", n: 0, chance: 0 };
    koText = "ダメージなし";
  } else if (!k.n) {
    ko = { kind: "none", n: 0, chance: 0 };
    koText = "確定数なし（4発以上）";
  } else if (k.chance === 1) {
    ko = { kind: "guaranteed", n: k.n, chance: 1 };
    koText = `確定${k.n}発`;
  } else {
    const c = k.chance ?? 0;
    ko = { kind: "chance", n: k.n, chance: c };
    koText = `乱数${k.n}発（${(c * 100).toFixed(1)}%）`;
  }

  return {
    min, max, minPercent: pct(min), maxPercent: pct(max), hp,
    ko, koText, assumptions, description: max === 0 ? `${attacker.name}の${move.name}は${defender.name}に効果がない（ダメージ0）` : result.desc(),
  };
}
