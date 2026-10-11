// チャンピオンズ（@smogon/calc 第0世代）のダメージ計算と素早さ（構成設計 8 章）
// - SP（0〜32）は計算ライブラリの努力値の欄に入れる（データ調査 2 章）。Lv50
// - 指定のない側は「幅」で答える（構成設計 8.1）: 無振り（SP0・補正なし）〜特化（SP32・補正あり）
import { calculate, Field, Generations, Move, Pokemon } from "@smogon/calc";
import { getFinalSpeed } from "@smogon/calc/dist/mechanics/util";
import learnsets from "../data/learnsets.json";
import abilityTable from "../data/abilities.json";
import defaults from "../data/default-abilities.json";

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
  /** 状態異常（計算ライブラリの記号: brn やけど / par まひ / psn どく / tox もうどく / slp ねむり / frz こおり） */
  status?: "brn" | "par" | "psn" | "tox" | "slp" | "frz";
  /** ばけのかわが剥がれた（ミミッキュ）: 剥がれた姿で、残り HP を言わなければ 7/8 で計算する */
  disguiseBroken?: boolean;
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

/** 能力の略号（A・C など） */
export const STAT_LETTER: Record<Stat, string> = { hp: "H", atk: "A", def: "B", spa: "C", spd: "D", spe: "S" };

const toId = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/** 特性を言わなかったときの特性（data/default-abilities.json の優先順。どれもなければ最初の特性） */
export function defaultAbility(species: string): string | undefined {
  const list = (abilityTable as unknown as Record<string, string[]>)[toId(species)];
  if (!list?.length) return undefined;
  return defaults.prefer.find((a) => list.includes(a)) ?? list[0];
}

/** 使う特性（指定があればそれ） */
export function abilityOf(s: SideInput): string | undefined {
  return s.ability ?? defaultAbility(s.species);
}

/** その側で計算に効く特性か（言わなかったのに使ったら読み上げで添える。data/default-abilities.json の notableAttack / notableDefense） */
export function isNotableAbility(ab: string | undefined, role: "attacker" | "defender"): boolean {
  return !!ab && (role === "attacker" ? defaults.notableAttack : defaults.notableDefense).includes(ab);
}

/** 計算ライブラリがダメージに反映しない特性か（ばけのかわ） */
export function isNotCalculated(ab: string | undefined): boolean {
  return !!ab && (defaults.notCalculated as string[]).includes(ab);
}

/** 素早さの質問で使う特性: 言わなかったとき、天候・フィールドが合う素早さの特性があればそれ（すいすい など） */
function speedAbility(s: SideInput, f: FieldInput): string | undefined {
  if (s.ability) return s.ability;
  const list = (abilityTable as unknown as Record<string, string[]>)[toId(s.species)] ?? [];
  const sp = (defaults as unknown as { speed: Record<string, string> }).speed;
  return list.find((a) => sp[a] && (sp[a] === f.weather || sp[a] === f.terrain)) ?? defaultAbility(s.species);
}

/**
 * 天候・フィールドを言わなかったとき、場に出ると天気を変える特性（ひでり・すなおこしなど）があればそれを使う。
 * 両方が別々の天気を変える場合は決められないので使わない。使ったら note に書く
 */
export function autoField(sides: SideInput[], f: FieldInput): { field: FieldInput; notes: string[] } {
  const out = { ...f };
  const notes: string[] = [];
  for (const kind of ["weather", "terrain"] as const) {
    if (out[kind]) continue;
    const table = defaults[kind] as Record<string, string>;
    const hits = sides.map((sd) => ({ ab: abilityOf(sd), sd })).filter((x) => x.ab && table[x.ab]);
    const values = [...new Set(hits.map((x) => table[x.ab!]))];
    if (values.length === 1) {
      out[kind] = values[0];
      notes.push(`${hits[0].sd.species}:${hits[0].ab}`);
    }
  }
  return { field: out, notes };
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
    ability: abilityOf(s) as never,
    nature: pickNature(s.natureUp, s.natureDown, s.nature),
    evs: s.sp ?? {},
    boosts: s.boosts,
    status: s.status,
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
  /** 満タンから 1 発で倒れるはずを、気合の襷・がんじょうで耐えた（その持ち物・特性の英語名） */
  endured?: string;
  /** 計算に使ったわざのタイプ・威力（だいちのはどう・ウェザーボールなどは場で変わる。特性の倍率は含まない） */
  moveType?: string;
  moveBp?: number;
}

function one(a: SideInput, d: SideInput, move: string, f: FieldInput): DamageResult {
  // ばけのかわが剥がれた後: 剥がれた姿（Mimikyu-Busted）で、剥がれたときに最大 HP の 1/8 減っている
  if (d.disguiseBroken && d.species === "Mimikyu") {
    const hp = build(d).maxHP();
    const left = d.hpLeft !== undefined || d.hpLeftPercent !== undefined ? {} : { hpLeft: hp - Math.floor(hp / 8) };
    return one(a, { ...d, disguiseBroken: undefined, species: "Mimikyu-Busted", ...left }, move, f);
  }
  const attacker = build(a);
  const defender = build(d);
  const m = new Move(gen, move, { isCrit: !!f.critical });
  const r = calculate(gen, attacker, defender, m, field(f, a, d));
  // 連続技（ドラゴンアローなど）は全部当たったときの合計（range() が合計を返す）
  const [min, max] = r.range();
  const hp = defender.maxHP();
  const pct = (n: number) => Math.floor((n * 1000) / hp) / 10; // Showdown の表示と同じ切り捨て
  let ko: Ko = { kind: "none", n: 0, chance: 0 };
  if (max > 0) {
    // 確定数は計算ライブラリの判定を使う。chance が 1 のときだけ「確定」（CLAUDE.md）
    const k = r.kochance();
    if (k.n) ko = { kind: k.chance === 1 ? "guaranteed" : "chance", n: k.n, chance: k.chance ?? 0 };
  }
  // 気合の襷・がんじょう: 計算ライブラリの確定数は反映しないので、ここで補う（満タン・連続技でないとき、1 発目は 1 残る）
  let endured: string | undefined;
  const sturdy = d.item === "Focus Sash" ? "Focus Sash" : abilityOf(d) === "Sturdy" ? "Sturdy" : undefined;
  if (sturdy && ko.n === 1 && defender.curHP() === hp && (m.hits ?? 1) <= 1) {
    endured = sturdy;
    ko = { kind: "guaranteed", n: 2, chance: 1 };
  }
  // ばけのかわ（ミミッキュ）: 満タンなら 1 発目は防いで最大 HP の 1/8 だけ減る。計算ライブラリは反映しないので、
  // 「剥がれた姿（Mimikyu-Busted）・残り HP 7/8」に何発で倒れるかを求めて 1 発足す（連続技は 1 発目だけ防ぐので対象外）
  if (max > 0 && abilityOf(d) === "Disguise" && d.species === "Mimikyu" && defender.curHP() === hp && (m.hits ?? 1) <= 1) {
    const busted = one(a, { ...d, species: "Mimikyu-Busted", ability: "Disguise", hpLeft: hp - Math.floor(hp / 8), hpLeftPercent: undefined }, move, f);
    if (busted.ko.n) ko = { ...busted.ko, n: busted.ko.n + 1 };
    endured = "Disguise";
  }
  const desc = max === 0 ? "" : r.desc();
  const bp = Number(desc.match(/\((\d+) BP\)/)?.[1] ?? m.bp);
  return { min, max, minPercent: pct(min), maxPercent: pct(max), hp, curHP: defender.curHP(), ko, immune: max === 0, desc, endured, moveType: r.move.type as string, moveBp: bp };
}

export interface DamageAnswer {
  /** 特性で自動で入れた天候・フィールド（「英語名:特性」） */
  autoField: string[];
  /** 使った特性 */
  abilities: { attacker?: string; defender?: string };
  /** 計算に使った場（特性で入れた天候などを含む） */
  field: FieldInput;
  /** 防御側のいかくで変えた攻撃側の攻撃ランク（0 は特性で防いだ。undefined は関係なし） */
  intimidate?: number;
  /** 指定どおりで計算した結果。攻撃側の振り方を言わなければ使う能力に全振り（SP32）・補正なし、防御側は無振り */
  base: DamageResult;
  /** 攻撃側の性格補正を言わなかったとき: 補正あり（使う能力が上がる性格）の結果 */
  attackerBoosted?: DamageResult;
  /** 防御側の振り方を言わなかったとき: 耐久に振っていた（H32・防御か特防32・補正あり）ときの結果 */
  defenderBulky?: DamageResult;
  /** 仮定した内容（読み上げ・表示用） */
  assumed: string[];
  category: "Physical" | "Special" | "Status";
}

/** ダメージ計算。指定のない側は無振りを基本にし、幅も出す */
/** いかくを受けたときの攻撃側の反応（特性による。クリアボディなどは下がらない、まけんきは結果として上がる） */
const INTIMIDATE_REACTION: Record<string, number> = {
  "Clear Body": 0, "Hyper Cutter": 0, "Inner Focus": 0, Oblivious: 0, "Own Tempo": 0, Scrappy: 0,
  "Full Metal Body": 0, "White Smoke": 0, "Mirror Armor": 0, Defiant: 1, "Guard Dog": 1, Contrary: 1, Simple: -2,
};

/**
 * いかく: 防御側が「いかく」で物理技のとき、攻撃側の攻撃ランクを変えて計算する（攻撃ランクを言われていなければ）。
 * 場に出たときに入る特性だが、対戦ではほぼ必ず入るので、常に考慮する
 */
function applyIntimidate(a: SideInput, d: SideInput, category: string): { a: SideInput; change?: number } {
  if (category !== "Physical" || abilityOf(d) !== "Intimidate" || a.boosts?.atk !== undefined) return { a };
  const change = INTIMIDATE_REACTION[abilityOf(a) ?? ""] ?? -1;
  if (!change) return { a, change: 0 };
  return { a: { ...a, boosts: { ...a.boosts, atk: change } }, change };
}

export function damage(a0: SideInput, d: SideInput, move: string, f0: FieldInput = {}): DamageAnswer {
  const { field: f, notes: autoNotes } = autoField([a0, d], f0);
  const m = new Move(gen, move);
  const category = m.category as DamageAnswer["category"];
  const { a: a1, change: intimidate } = applyIntimidate(a0, d, category);
  const atkStat: Stat = category === "Special" ? "spa" : "atk";
  const defStat: Stat = category === "Special" ? "spd" : "def";
  const L = STAT_LETTER;
  const assumed: string[] = [];
  // 攻撃側: 振り方を言わなければ、使う能力に全振り（SP32）。対戦では攻撃側はぶっぱが基本のため
  const aSpOpen = a1.sp?.[atkStat] === undefined;
  const a: SideInput = aSpOpen ? { ...a1, sp: { ...a1.sp, [atkStat]: 32 } } : a1;
  // 性格補正を言わなければ補正なしで計算し、補正ありも出す
  const aNatureOpen = !a.nature && !a.natureUp && !a.natureDown;
  const aParts = [aSpOpen && `${L[atkStat]}全振り`, aNatureOpen && "補正なし"].filter(Boolean);
  if (aParts.length) assumed.push(`攻撃側は${aParts.join("・")}`);
  const dOpen = !hasSpread(d, ["hp", defStat]);
  if (dOpen) assumed.push("防御側は無振り");
  if (!a.item && !d.item) assumed.push("持ち物なし");
  const base = one(a, d, move, f);
  const extra = { autoField: autoNotes, abilities: { attacker: abilityOf(a), defender: abilityOf(d) }, field: f, intimidate };
  if (base.immune) return { base, assumed, category, ...extra };
  const attackerBoosted = aNatureOpen ? one({ ...a, natureUp: atkStat }, d, move, f) : undefined;
  const defenderBulky = dOpen ? one(a, { ...d, sp: { ...d.sp, hp: 32, [defStat]: 32 }, natureUp: defStat }, move, f) : undefined;
  return { base, attackerBoosted, defenderBulky, assumed, category, ...extra };
}

/** 素早さの実数値（スカーフ・ランク・天候の特性などを反映した値） */
export function speedOf(s: SideInput, f0: FieldInput = {}): number {
  const { field: f } = autoField([s], f0);
  const p = build({ ...s, ability: speedAbility(s, f) });
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
  return { name: m.name as string, type: m.type as string, category: m.category as string, bp: m.bp, priority: m.priority };
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

/**
 * その特性が今の計算に効いているか（特性を「効かない特性」に替えるとダメージが変わるか）。
 * 言わなかったのに使った特性を読み上げで添えるかの判断に使う（ソーラービームを受けるウォッシュロトムの「ふゆう」は添えない）
 */
export function abilityMatters(a: SideInput, d: SideInput, move: string, f: FieldInput, role: "attacker" | "defender"): boolean {
  const { field } = autoField([a, d], f);
  const base = one(a, d, move, field);
  const neutral = "Pressure"; // ダメージに関係しない特性
  const alt = role === "attacker" ? one({ ...a, ability: neutral }, d, move, field) : one(a, { ...d, ability: neutral }, move, field);
  return alt.min !== base.min || alt.max !== base.max || alt.ko.n !== base.ko.n;
}
