// 拡張テスト（2026-10-11、ユーザーの質問例と用語を受けて追加）
// - 用語: 特化=その能力に性格補正と SP 最大、準速=補正なしで S の SP 最大、最速=S に補正と SP 最大、
//         ステロ込み=ステルスロックのダメージを含める、水ロトム=ウォッシュロトム
// - 組: tune（指示文の調整に使う）と holdout（調整には使わず、成績を測るだけ）。ユーザーの例は holdout
import type { Case, Out } from "./cases";

type Stat = "hp" | "atk" | "def" | "spa" | "spd" | "spe";
interface SideSpec {
  sp?: Partial<Record<Stat, number>>;
  up?: Stat; // 性格で上がる能力
  down?: Stat; // 性格で下がる能力（C下降補正 など）
  neutralSpe?: true; // 準速: S に補正なし
  minSpe?: true; // 最遅
  boosts?: Partial<Record<Exclude<Stat, "hp">, number>>;
  item?: RegExp;
  hpLeft?: number;
  hpLeftPercent?: number;
  stealthRock?: true;
}
interface Spec {
  intent: string;
  attacker?: string;
  defender?: string;
  pokemon?: string;
  move?: string;
  a?: SideSpec;
  d?: SideSpec;
  p?: SideSpec; // pokemon（単体）の条件
  weather?: RegExp;
  terrain?: RegExp;
  reflect?: true;
  critical?: true;
  ask?: string;
  missing?: string;
  usesContext?: true;
}

const kata = (s: string) => s.replace(/[ぁ-ゖ]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 0x60));
const norm = (s: unknown) => (typeof s === "string" ? kata(s.replace(/[\s・]/g, "")) : "");

// 性格名 → 上がる能力・下がる能力
const NATURES: Record<string, [Stat, Stat]> = {
  さみしがり: ["atk", "def"], いじっぱり: ["atk", "spa"], やんちゃ: ["atk", "spd"], ゆうかん: ["atk", "spe"],
  ずぶとい: ["def", "atk"], わんぱく: ["def", "spa"], のうてんき: ["def", "spd"], のんき: ["def", "spe"],
  ひかえめ: ["spa", "atk"], おっとり: ["spa", "def"], うっかりや: ["spa", "spd"], れいせい: ["spa", "spe"],
  おだやか: ["spd", "atk"], おとなしい: ["spd", "def"], しんちょう: ["spd", "spa"], なまいき: ["spd", "spe"],
  おくびょう: ["spe", "atk"], せっかち: ["spe", "def"], ようき: ["spe", "spa"], むじゃき: ["spe", "spd"],
};
const STAT_ALIAS: Record<string, Stat> = {
  hp: "hp", h: "hp", atk: "atk", attack: "atk", a: "atk", def: "def", defense: "def", b: "def",
  spa: "spa", c: "spa", spd: "spd", d: "spd", spe: "spe", speed: "spe", s: "spe",
};
const stat = (v: unknown): Stat | undefined => (typeof v === "string" ? STAT_ALIAS[v.toLowerCase()] : undefined);

/** その側で性格により上がる能力（nature_up か性格名から）。speed:"max" も S 上昇とみなす */
export function natureUp(side: Out): Stat | undefined {
  return stat(side.nature_up) ?? NATURES[norm(side.nature).replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60))]?.[0] ?? (side.speed === "max" ? "spe" : undefined);
}
function natureDown(side: Out): Stat | undefined {
  return stat(side.nature_down) ?? NATURES[norm(side.nature).replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60))]?.[1] ?? (side.speed === "min" ? "spe" : undefined);
}
export function spOf(side: Out, s: Stat): number | undefined {
  const v = side.sp?.[s];
  if (typeof v === "number") return v;
  if (s === "spe" && (side.speed === "max" || side.speed === "neutral")) return 32;
  if (s === "spe" && side.speed === "min") return 0;
  return undefined;
}

function checkSide(label: string, side: Out, w: SideSpec): string[] {
  const e: string[] = [];
  for (const [s, v] of Object.entries(w.sp ?? {})) if (spOf(side, s as Stat) !== v) e.push(`${label}.sp.${s}=${spOf(side, s as Stat)}（正解 ${v}）`);
  if (w.up && natureUp(side) !== w.up) e.push(`${label} の性格補正=${natureUp(side)}（正解 ${w.up}）`);
  if (w.down && natureDown(side) !== w.down) e.push(`${label} の下降補正=${natureDown(side)}（正解 ${w.down}）`);
  if (w.neutralSpe && natureUp(side) === "spe") e.push(`${label} が準速なのに S 補正あり`);
  if (w.minSpe && !(spOf(side, "spe") === 0 && natureDown(side) === "spe")) e.push(`${label} が最遅になっていない`);
  for (const [s, v] of Object.entries(w.boosts ?? {})) if (Number(side.boosts?.[s]) !== v) e.push(`${label}.boosts.${s}=${side.boosts?.[s]}（正解 ${v}）`);
  if (w.item && !w.item.test(kata(String(side.item ?? "")))) e.push(`${label}.item=${JSON.stringify(side.item)}（正解 ${w.item}）`);
  if (w.hpLeft !== undefined && Number(side.hp_left) !== w.hpLeft) e.push(`${label}.hp_left=${side.hp_left}（正解 ${w.hpLeft}）`);
  if (w.hpLeftPercent !== undefined && Number(side.hp_left_percent) !== w.hpLeftPercent) e.push(`${label}.hp_left_percent=${side.hp_left_percent}（正解 ${w.hpLeftPercent}）`);
  if (w.stealthRock && side.stealth_rock !== true) e.push(`${label}.stealth_rock=${side.stealth_rock}（正解 true）`);
  return e;
}

export function checkSpec(o: Out, w: Spec): string[] {
  const e: string[] = [];
  if (o.intent !== w.intent) e.push(`intent=${o.intent}（正解 ${w.intent}）`);
  for (const k of ["attacker", "defender", "pokemon", "move"] as const) {
    if (w[k] !== undefined && norm(o[k]) !== kata(w[k]!)) e.push(`${k}=${JSON.stringify(o[k])}（正解 ${w[k]}）`);
  }
  const c = o.conditions ?? {};
  if (w.a) e.push(...checkSide("attacker", c.attacker ?? {}, w.a));
  if (w.d) e.push(...checkSide("defender", c.defender ?? {}, w.d));
  if (w.p) e.push(...checkSide("pokemon", c.pokemon ?? c.attacker ?? {}, w.p));
  const f = c.field ?? {};
  if (w.weather && !w.weather.test(String(f.weather ?? ""))) e.push(`weather=${JSON.stringify(f.weather)}（正解 ${w.weather}）`);
  if (w.terrain && !w.terrain.test(String(f.terrain ?? ""))) e.push(`terrain=${JSON.stringify(f.terrain)}（正解 ${w.terrain}）`);
  if (w.reflect && f.reflect !== true) e.push(`reflect=${f.reflect}`);
  if (w.critical && f.critical !== true) e.push(`critical=${f.critical}`);
  if (w.ask && o.ask !== w.ask) e.push(`ask=${o.ask}（正解 ${w.ask}）`);
  if (w.missing && !(o.missing ?? []).includes(w.missing)) e.push(`missing=${JSON.stringify(o.missing)}（正解 ${w.missing} を含む）`);
  if (w.usesContext && o.uses_context !== true) e.push("uses_context が true でない");
  return e;
}

type Set2 = "tune" | "holdout";
interface Case2 extends Case {
  set: Set2;
}
const K = (id: number, set: Set2, text: string, w: Spec, history?: Case["history"]): Case2 => ({
  id, set, text, history,
  group: w.intent === "clarify" ? "clarify-extract" : "extract",
  check: (o) => checkSpec(o, w),
});

const ctx = (user: string, out: object) => ({ user, assistant: JSON.stringify(out) });

export const CASES2: Case2[] = [
  // ユーザーの例（holdout）
  K(101, "holdout", "HB振りエンペルトのHP120残ってるんだけど、A特化ガブのじしん耐える？", {
    intent: "damage", attacker: "ガブリアス", defender: "エンペルト", move: "じしん",
    a: { sp: { atk: 32 }, up: "atk" }, d: { sp: { hp: 32, def: 32 }, hpLeft: 120 },
  }),
  K(102, "holdout", "S二段階上昇のイダイトウって最速メガルカリオZ抜ける？", {
    intent: "speed", attacker: "イダイトウ", defender: "メガルカリオZ", ask: "compare",
    a: { boosts: { spe: 2 } }, d: { sp: { spe: 32 }, up: "spe" },
  }),
  K(103, "holdout", "S二段階上昇のイダイトウってメガルカリオZがどこまですばやさ振ってたら負ける？", {
    intent: "speed", attacker: "イダイトウ", defender: "メガルカリオZ", ask: "threshold", a: { boosts: { spe: 2 } },
  }),

  // 調整用（tune）と確認用（holdout）の追加。名前・言い回し・条件を散らす
  K(111, "tune", "C特化ハバタクカミのムーンフォース、H振りカイリューに", {
    intent: "damage", attacker: "ハバタクカミ", defender: "カイリュー", move: "ムーンフォース",
    a: { sp: { spa: 32 }, up: "spa" }, d: { sp: { hp: 32 } },
  }),
  K(112, "tune", "準速ガブリアスと最速ドラパルトどっちが速い？", {
    intent: "speed", attacker: "ガブリアス", defender: "ドラパルト", ask: "compare",
    a: { sp: { spe: 32 }, neutralSpe: true }, d: { sp: { spe: 32 }, up: "spe" },
  }),
  K(113, "holdout", "ステロ込みで、ミミッキュのじゃれつくでリザードン落ちる？", {
    intent: "damage", attacker: "ミミッキュ", defender: "リザードン", move: "じゃれつく", d: { stealthRock: true },
  }),
  K(114, "tune", "雨のときの水ロトムのハイドロポンプ、ガブに何発？", {
    intent: "damage", attacker: "ウォッシュロトム", defender: "ガブリアス", move: "ハイドロポンプ", weather: /雨/,
  }),
  K(115, "tune", "エレキフィールドでテツノカイナのワイルドボルト、サーフゴーに", {
    intent: "damage", attacker: "テツノカイナ", defender: "サーフゴー", move: "ワイルドボルト", terrain: /エレキ/,
  }),
  K(116, "holdout", "砂嵐の中でガブリアスのじしん、ドドゲザンに何発？", {
    intent: "damage", attacker: "ガブリアス", defender: "ドドゲザン", move: "じしん", weather: /砂/,
  }),
  K(117, "tune", "HPが半分のサーフゴー、ガブのじしんで落ちる？", {
    intent: "damage", attacker: "ガブリアス", defender: "サーフゴー", move: "じしん", d: { hpLeftPercent: 50 },
  }),
  K(118, "tune", "残りHP3割のカイリューにハバタクカミのムーンフォース", {
    intent: "damage", attacker: "ハバタクカミ", defender: "カイリュー", move: "ムーンフォース", d: { hpLeftPercent: 30 },
  }),
  K(119, "holdout", "攻撃が1段階下がったガブリアスのげきりん、カイリューに", {
    intent: "damage", attacker: "ガブリアス", defender: "カイリュー", move: "げきりん", a: { boosts: { atk: -1 } },
  }),
  K(120, "tune", "いじっぱりガブのじしん、エンペルトに", {
    intent: "damage", attacker: "ガブリアス", defender: "エンペルト", move: "じしん", a: { up: "atk" },
  }),
  K(121, "tune", "スカーフ持ちの準速ガブリアスって最速ドラパルト抜ける？", {
    intent: "speed", attacker: "ガブリアス", defender: "ドラパルト", ask: "compare",
    a: { item: /スカーフ/, sp: { spe: 32 }, neutralSpe: true }, d: { sp: { spe: 32 }, up: "spe" },
  }),
  K(122, "holdout", "最速メガルカリオZの素早さっていくつ？", {
    intent: "speed", pokemon: "メガルカリオZ", ask: "value", p: { sp: { spe: 32 }, up: "spe" },
  }),
  K(123, "tune", "グラスフィールドでガブからカイリューにじしん", {
    intent: "damage", attacker: "ガブリアス", defender: "カイリュー", move: "じしん", terrain: /グラス/,
  }),
  K(124, "tune", "晴れてるときのウォッシュロトムのハイドロポンプ、リザードンに", {
    intent: "damage", attacker: "ウォッシュロトム", defender: "リザードン", move: "ハイドロポンプ", weather: /晴|ひざし|日差し/,
  }),
  K(125, "holdout", "ガブのじしん、ステロ込みでHB特化エンペルト落ちる？", {
    intent: "damage", attacker: "ガブリアス", defender: "エンペルト", move: "じしん",
    d: { sp: { hp: 32, def: 32 }, up: "def", stealthRock: true },
  }),
  K(126, "tune", "H252のエンペルトにA特化ガブのじしん", {
    intent: "damage", attacker: "ガブリアス", defender: "エンペルト", move: "じしん",
    a: { sp: { atk: 32 }, up: "atk" }, d: { sp: { hp: 32 } },
  }),
  K(127, "tune", "火ロトムのオーバーヒート、ハッサムに", {
    intent: "damage", attacker: "ヒートロトム", defender: "ハッサム", move: "オーバーヒート",
  }),
  K(128, "holdout", "ミミのじゃれつくでドラパ落ちる？", {
    intent: "damage", attacker: "ミミッキュ", defender: "ドラパルト", move: "じゃれつく",
  }),
  K(129, "tune", "S1段階上がったガブリアスとスカーフドラパルトどっちが速い？", {
    intent: "speed", attacker: "ガブリアス", defender: "ドラパルト", ask: "compare",
    a: { boosts: { spe: 1 } }, d: { item: /スカーフ/ },
  }),
  K(130, "tune", "イダイトウって何振りまでならメガルカリオZ抜ける？", {
    intent: "speed", attacker: "イダイトウ", defender: "メガルカリオZ", ask: "threshold",
  }),
  K(131, "holdout", "C+2のハバタクカミのムーンフォースでカイリュー確定？", {
    intent: "damage", attacker: "ハバタクカミ", defender: "カイリュー", move: "ムーンフォース", a: { boosts: { spa: 2 } },
  }),
  K(132, "tune", "リフレクターありでガブのじしん、サーフゴー耐える？", {
    intent: "damage", attacker: "ガブリアス", defender: "サーフゴー", move: "じしん", reflect: true,
  }),
  K(133, "tune", "急所に当たったらミミッキュのじゃれつくでガブ落ちる？", {
    intent: "damage", attacker: "ミミッキュ", defender: "ガブリアス", move: "じゃれつく", critical: true,
  }),
  K(134, "holdout", "サイコフィールドのサーナイトのサイコキネシス、カイリューに", {
    intent: "damage", attacker: "サーナイト", defender: "カイリュー", move: "サイコキネシス", terrain: /サイコ/,
  }),
  K(135, "tune", "ミストフィールド下でハバタクカミのムーンフォース、ドラパルトに", {
    intent: "damage", attacker: "ハバタクカミ", defender: "ドラパルト", move: "ムーンフォース", terrain: /ミスト/,
  }),
  K(136, "tune", "A特化いのちのたまガブのげきりん、H振りカイリューに", {
    intent: "damage", attacker: "ガブリアス", defender: "カイリュー", move: "げきりん",
    a: { sp: { atk: 32 }, up: "atk", item: /イノチノタマ/ }, d: { sp: { hp: 32 } },
  }),
  K(137, "holdout", "じゃあステロ込みだったら？", {
    intent: "damage", attacker: "ガブリアス", defender: "エンペルト", move: "じしん",
    a: { sp: { atk: 32 }, up: "atk" }, d: { stealthRock: true }, usesContext: true,
  }, ctx("A特化ガブのじしん、エンペルトに", {
    intent: "damage", attacker: "ガブリアス", defender: "エンペルト", move: "じしん",
    conditions: { attacker: { sp: { atk: 32 }, nature_up: "atk" } },
  })),
  K(138, "tune", "じゃあS1段階上がってたら？", {
    intent: "speed", attacker: "イダイトウ", defender: "メガルカリオZ", a: { boosts: { spe: 1 } }, usesContext: true,
  }, ctx("イダイトウって最速メガルカリオZ抜ける？", {
    intent: "speed", ask: "compare", attacker: "イダイトウ", defender: "メガルカリオZ",
    conditions: { defender: { sp: { spe: 32 }, nature_up: "spe" } },
  })),
  K(139, "tune", "A特化ガブのじしん耐える？", { intent: "clarify", missing: "defender" }),
  K(140, "holdout", "エンペルトにじしん撃ったらどれくらい？", { intent: "clarify", missing: "attacker" }),
  K(141, "tune", "ドラパルトとメガルカリオZ、準速同士だとどっちが速い？", {
    intent: "speed", attacker: "ドラパルト", defender: "メガルカリオZ", ask: "compare",
    a: { sp: { spe: 32 }, neutralSpe: true }, d: { sp: { spe: 32 }, neutralSpe: true },
  }),
  K(142, "holdout", "最速イダイトウがS1段階上がったらメガルカリオZ抜ける？", {
    intent: "speed", attacker: "イダイトウ", defender: "メガルカリオZ", ask: "compare",
    a: { sp: { spe: 32 }, up: "spe", boosts: { spe: 1 } },
  }),
  K(143, "tune", "最遅ドドゲザンと最遅サーフゴーどっちが遅い？", {
    intent: "speed", attacker: "ドドゲザン", defender: "サーフゴー", ask: "compare", a: { minSpe: true }, d: { minSpe: true },
  }),
  K(144, "holdout", "雪の時にHD特化のサーフゴーにハバタクカミのムーンフォース", {
    intent: "damage", attacker: "ハバタクカミ", defender: "サーフゴー", move: "ムーンフォース", weather: /雪/,
    d: { sp: { hp: 32, spd: 32 }, up: "spd" },
  }),
  K(145, "tune", "サーフゴーのゴールドラッシュ、HP7割のガブリアス落とせる？", {
    intent: "damage", attacker: "サーフゴー", defender: "ガブリアス", move: "ゴールドラッシュ", d: { hpLeftPercent: 70 },
  }),
  K(146, "holdout", "準速イダイトウってドラパルト抜ける？", {
    intent: "speed", attacker: "イダイトウ", defender: "ドラパルト", ask: "compare", a: { sp: { spe: 32 }, neutralSpe: true },
  }),
];

export const SETS: Record<string, Case[]> = {
  tune: CASES2.filter((c) => c.set === "tune"),
  holdout: CASES2.filter((c) => c.set === "holdout"),
};
