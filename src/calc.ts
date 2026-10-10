import { calculate, Generations, Pokemon, Move, Field } from "@smogon/calc";
import { toEnglish } from "./names.js";

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
  field?: { weather?: string; terrain?: string; isDoubles?: boolean };
}

export interface CalcResult {
  min: number;
  max: number;
  minPercent: number;
  maxPercent: number;
  /** 例: "確定2発" "乱数1発(37.5%)" */
  koText: string;
  /** 読み上げ用の短文 */
  speech: string;
  assumptions: string[];
  description: string;
}

const gen = Generations.get(9);
const LEVEL = 50;

function build(side: Side, role: string, notes: string[]) {
  const name = toEnglish("pokemon", side.pokemon);
  const item = side.item ? toEnglish("items", side.item) : undefined;
  if (!side.evs) notes.push(`${role}の努力値は未指定（0振り）`);
  if (!side.nature) notes.push(`${role}の性格は未指定（無補正）`);
  if (!side.item) notes.push(`${role}の持ち物は未指定（なし）`);
  return new Pokemon(gen, name, {
    level: LEVEL,
    item,
    ability: side.ability,
    nature: side.nature ?? "Hardy",
    evs: side.evs ?? {},
    boosts: side.boosts,
    teraType: side.teraType as never,
  });
}

export function calc(input: CalcInput): CalcResult {
  const assumptions: string[] = [];
  const attacker = build(input.attacker, "攻撃側", assumptions);
  const defender = build(input.defender, "防御側", assumptions);
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
  const pct = (n: number) => Math.floor((n * 1000) / hp) / 10 /* Showdown表示と同じ切り捨て */;
  const ko = result.kochance();
  const koText = ko.text || "ダメージなし";
  const speech =
    `${pct(min)}から${pct(max)}パーセント。${koText}。` +
    (assumptions.length ? `前提：${assumptions.join("、")}。` : "");

  return {
    min, max, minPercent: pct(min), maxPercent: pct(max),
    koText, speech, assumptions, description: result.desc(),
  };
}
