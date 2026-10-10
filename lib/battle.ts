// チャンピオンズ（@smogon/calc 第0世代）のダメージ計算と素早さ（構成設計 8 章）
// - SP（0〜32）は計算ライブラリの努力値の欄に入れる（データ調査 2 章）。Lv50
// - 指定のない側は「幅」で答える（構成設計 8.1）: 無振り（SP0・補正なし）〜特化（SP32・補正あり）
import { calculate, Field, Generations, Move, Pokemon } from "@smogon/calc";
import { getFinalSpeed } from "@smogon/calc/dist/mechanics/util";
import learnsets from "../data/learnsets.json";

export const gen = Generations.get(0 as never);
const LEVEL = 50;

export type Stat = "hp" | "atk" | "def" | "spa" | "spd" | "spe";
export type BoostStat = Exclude<Stat, "hp">;

export interface SideInput {
  species: string; // 英語名
  item?: string;
  ability?: string;
  nature?: string; // 英語の性格名
  natureUp?: Stat;
  natureDown?: Stat;
  sp?: Partial<Record<Stat, number>>;
  boosts?: Partial<Record<BoostStat, number>>;
  hpLeft?: number;
  hpLeftPercent?: number;
  stealthRock?: boolean;
}

export interface FieldInput {
  weather?: string; // Sun / Rain / Sand / Snow
  terrain?: string; // Electric / Grassy / Psychic / Misty
  reflect?: boolean;
  lightScreen?: boolean;
  critical?: boolean;
}

/** 上がる・下がる能力から性格を選ぶ。下がる能力の指定がなければ、計算に響きにくい方（攻撃↔特攻の反対側）を下げる */
export function pickNature(up?: Stat, down?: Stat, name?: string): string {
  if (name && gen.natures.get(name.toLowerCase() as never)) return name;
  if (up === "hp") up = undefined;
  if (!up && !down) return "Hardy";
  // 下がる能力だけの指定（最遅など）は、上がる方を攻撃（下がるのが攻撃なら特攻）にする
  if (!up) up = down === "atk" ? "spa" : "atk";
  const d: Stat = down ?? (up === "spa" ? "atk" : "spa");
  for (const n of gen.natures) if (n.plus === up && n.minus === d) return n.name;
  return "Hardy";
}

/** その側について、能力の振り方（SP・性格）の指定があるか */
export function hasSpread(s: SideInput, stats: Stat[]): boolean {
  if (s.nature || s.natureUp) return true;
  return stats.some((k) => s.sp?.[k] !== undefined);
}

function build(s: SideInput): Pokemon {
  const opts = {
    level: LEVEL,
    item: s.item as never,
    ability: s.ability as never,
    nature: pickNature(s.natureUp, s.natureDown, s.nature),
    evs: s.sp ?? {},
    boosts: s.boosts,
  };
  const p = new Pokemon(gen, s.species, opts);
  const max = p.maxHP();
  const cur = s.hpLeft ?? (s.hpLeftPercent !== undefined ? Math.floor((max * s.hpLeftPercent) / 100) : undefined);
  if (cur === undefined) return p;
  return new Pokemon(gen, s.species, { ...opts, curHP: Math.max(1, Math.min(max, cur)) } as never);
}

function field(f: FieldInput, attacker: SideInput, defender: SideInput): Field {
  return new Field({
    gameType: "Singles",
    weather: f.weather as never,
    terrain: f.terrain as never,
    attackerSide: {},
    defenderSide: { isReflect: !!f.reflect, isLightScreen: !!f.lightScreen, isSR: !!defender.stealthRock || undefined },
  } as never);
}

export interface Ko {
  /** guaranteed: 乱数の全範囲で N 発 / chance: 乱数 / none: 確定数なし */
  kind: "guaranteed" | "chance" | "none";
  n: number;
  chance: number;
}

export interface DamageResult {
  min: number;
  max: number;
  minPercent: number;
  maxPercent: number;
  /** 防御側の最大 HP と、計算に使った今の HP */
  hp: number;
  curHP: number;
  ko: Ko;
  immune: boolean;
  desc: string;
}

function one(a: SideInput, d: SideInput, move: string, f: FieldInput): DamageResult {
  const attacker = build(a);
  const defender = build(d);
  const m = new Move(gen, move, { isCrit: !!f.critical });
  const r = calculate(gen, attacker, defender, m, field(f, a, d));
  const rolls = [r.damage].flat(2) as number[];
  const min = Math.min(...rolls);
  const max = Math.max(...rolls);
  const hp = defender.maxHP();
  const pct = (n: number) => Math.floor((n * 1000) / hp) / 10; // Showdown の表示と同じ切り捨て
  let ko: Ko = { kind: "none", n: 0, chance: 0 };
  if (max > 0) {
    // 確定数は計算ライブラリの判定を使う。chance が 1 のときだけ「確定」（CLAUDE.md）
    const k = r.kochance();
    if (k.n) ko = { kind: k.chance === 1 ? "guaranteed" : "chance", n: k.n, chance: k.chance ?? 0 };
  }
  return { min, max, minPercent: pct(min), maxPercent: pct(max), hp, curHP: defender.curHP(), ko, immune: max === 0, desc: max === 0 ? "" : r.desc() };
}

export interface DamageAnswer {
  /** 指定どおり（指定のない側は無振り）で計算した結果 */
  base: DamageResult;
  /** 指定のない側を振り方の幅で動かしたときの最小〜最大（指定が揃っていれば undefined） */
  range?: { low: DamageResult; high: DamageResult };
  /** 仮定した内容（読み上げ・表示用） */
  assumed: string[];
  category: "Physical" | "Special" | "Status";
}

/** ダメージ計算。指定のない側は無振りを基本にし、幅も出す */
export function damage(a: SideInput, d: SideInput, move: string, f: FieldInput = {}): DamageAnswer {
  const m = new Move(gen, move);
  const category = m.category as DamageAnswer["category"];
  const atkStat: Stat = category === "Special" ? "spa" : "atk";
  const defStat: Stat = category === "Special" ? "spd" : "def";
  const aOpen = !hasSpread(a, [atkStat]);
  const dOpen = !hasSpread(d, ["hp", defStat]);
  const base = one(a, d, move, f);
  const assumed: string[] = [];
  if (aOpen) assumed.push("攻撃側の振り方");
  if (dOpen) assumed.push("防御側の振り方");
  if (!a.item && !d.item) assumed.push("持ち物なし");
  if (!aOpen && !dOpen) return { base, assumed, category };
  const strongA: SideInput = aOpen ? { ...a, sp: { ...a.sp, [atkStat]: 32 }, natureUp: atkStat } : a;
  const bulkyD: SideInput = dOpen ? { ...d, sp: { ...d.sp, hp: 32, [defStat]: 32 }, natureUp: defStat } : d;
  return { base, range: { low: one(a, bulkyD, move, f), high: one(strongA, d, move, f) }, assumed, category };
}

/** 素早さの実数値（スカーフ・ランク・天候の特性などを反映した値） */
export function speedOf(s: SideInput, f: FieldInput = {}): number {
  const p = build(s);
  const fld = new Field({ gameType: "Singles", weather: f.weather as never, terrain: f.terrain as never } as never);
  return getFinalSpeed(gen, p as never, fld as never, fld.attackerSide as never);
}

/** 振り方を変えたときの素早さ（無振り・準速・最速など）。sp と性格以外の条件はそのまま */
export function speedVariants(s: SideInput, f: FieldInput = {}) {
  const v = (sp: number, up?: Stat, down?: Stat) => speedOf({ ...s, sp: { ...s.sp, spe: sp }, natureUp: up, natureDown: down, nature: undefined }, f);
  return { slowest: v(0, undefined, "spe"), none: v(0), neutral: v(32), fastest: v(32, "spe") };
}

/**
 * どこまで振ると抜かれるか（ask: threshold）。相手（other）の S の SP を 0〜32 で動かし、
 * subject の素早さを超える（同速を含む）最小の SP を、補正なし・補正ありそれぞれで返す。超えられなければ null
 */
export function speedThreshold(subject: number, other: SideInput, f: FieldInput = {}) {
  const find = (up?: Stat) => {
    let tie: number | null = null;
    for (let sp = 0; sp <= 32; sp++) {
      const v = speedOf({ ...other, sp: { ...other.sp, spe: sp }, natureUp: up, natureDown: undefined, nature: undefined }, f);
      if (v > subject) return { faster: sp, tie };
      if (v === subject && tie === null) tie = sp;
    }
    return { faster: null as number | null, tie };
  };
  return { neutral: find(), plus: find("spe") };
}

export function speciesInfo(en: string) {
  const s = gen.species.get(en.toLowerCase().replace(/[^a-z0-9]/g, "") as never);
  return s ? { types: [...s.types] as string[], baseStats: { ...s.baseStats } as Record<Stat, number> } : undefined;
}

export function moveInfo(en: string) {
  const m = new Move(gen, en);
  return { type: m.type as string, category: m.category as string, bp: m.bp, priority: m.priority };
}

/** 防御側のタイプに対する相性の倍率（タイプ名は英語） */
export function effectiveness(attackType: string, defTypes: string[]): number {
  const t = gen.types.get(attackType.toLowerCase() as never);
  return defTypes.reduce((x, d) => x * ((t?.effectiveness as Record<string, number>)?.[d] ?? 1), 1);
}

export function allTypes(): string[] {
  return [...gen.types].map((t) => t.name as string).filter((n) => n !== "???" && n !== "Stellar");
}

const toID = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/** 覚えるか（チャンピオンズの覚える技。メガシンカなどは元のポケモンの一覧を見る）。データにないポケモンは undefined */
export function learns(speciesEn: string, moveEn: string): boolean | undefined {
  const table = learnsets as unknown as Record<string, string[]>;
  let list = table[toID(speciesEn)];
  if (!list) {
    const base = (gen.species.get(toID(speciesEn) as never) as { baseSpecies?: string } | undefined)?.baseSpecies ?? speciesEn.split("-")[0];
    list = table[toID(base)];
  }
  return list ? list.includes(toID(moveEn)) : undefined;
}
