// 実際の質問（roas.ask_log）から作った回帰テスト。定期の見直し（docs/ask-log-review.md）で足していく
// 正解は「その質問で本当に聞きたかったこと」を書く（ルールの出力を見て合わせない）。名前は正式名で書き、聞き間違いはサーバ側の名前の解決で直った後の名前で比べる
import { resolve } from "../lib/resolve";
import { checkSpec } from "./cases2";
import type { Case } from "./cases";

type Spec = Parameters<typeof checkSpec>[1];
type Out = Parameters<typeof checkSpec>[0];

/** 名前を正式名に直してから比べる（「ミミック」→ミミッキュ） */
function canonical(o: Out): Out {
  const x = { ...(o as Record<string, unknown>) };
  for (const [k, kind] of [["attacker", "pokemon"], ["defender", "pokemon"], ["pokemon", "pokemon"], ["move", "moves"]] as const) {
    if (typeof x[k] !== "string") continue;
    const r = resolve(kind, x[k] as string);
    if (r.ok) x[k] = r.ja;
  }
  return x as Out;
}

/** id: ask_log の id（どの記録から作ったか分かるように） */
const L = (id: number, text: string, w: Spec): Case => ({
  id, text, group: w.intent === "clarify" ? "clarify-extract" : w.intent === "chat" ? "deferred" : "extract",
  check: (o) => checkSpec(canonical(o), w),
});

export const CASES_LOG: Case[] = [
  // 2026-10-11: 音声認識が「サーフゴー」を「サーフ号」と書いた
  L(6, "サーフ号って何が弱点", { intent: "type", pokemon: "サーフゴー" }),
  // 2026-10-11: 「リザ」と言いかけて「メガリザードンY」と言い直した。「をリザ」をオリーヴァと取り違える危険があった
  L(8, "マスカーニャのパワージェムをリザメガリザードンワイ耐えれる", { intent: "damage", attacker: "マスカーニャ", defender: "メガリザードンY", move: "パワージェム" }),
  // 2026-10-11: 「C下降補正」が「私加工補正」、「耐えれる」が「を与え」と書き起こされ、AI が C↓ を落としていた
  L(10, "私加工補正のマスカーニャのパワージムをメガリザードワイを与え", { intent: "damage", attacker: "マスカーニャ", defender: "メガリザードンY", move: "パワージェム", a: { down: "spa" } }),
  // 2026-10-11: AI が HB特化の B↑ と、名前とわざの間の持ち物を落としていた
  L(13, "ひでりメガリザードンYのいのちのたまかえんほうしゃ、HB特化C下降補正のガブリアスに", { intent: "damage", attacker: "メガリザードンY", defender: "ガブリアス", move: "かえんほうしゃ", a: { item: /イノチノタマ/ }, d: { sp: { hp: 32, def: 32 }, up: "def", down: "spa" } }),
  // 2026-10-11: 「C下降補正」が「資格補正」、「を」の付いた防御側、ばけのかわが剥がれた状態を読めず AI に回り、剥がれているのに 1 発目を防ぐ計算になっていた
  L(21, "化けの皮が剥がれたミミックにマスカーニャのパワージムは何%入る", { intent: "damage", attacker: "マスカーニャ", defender: "ミミッキュ", move: "パワージェム" }),
  L(22, "資格補正のマスカーニャはパワージムでミミックを何発で倒せる", { intent: "damage", attacker: "マスカーニャ", defender: "ミミッキュ", move: "パワージェム", a: { down: "spa" } }),
  // 2026-10-11: 「C下降補正」が「シカ補正」「スイカ補正」、「耐えますか」が「買えますか」、「HB特化」が「HB特価」と書き起こされ AI に回っていた
  L(31, "シカ補正のマスカンやのパワージムをメガリザードンワイは買えますか", { intent: "damage", attacker: "マスカーニャ", defender: "メガリザードンY", move: "パワージェム", a: { down: "spa" } }),
  L(32, "スイカ補正のマスカーニャのパワージェムをHB特価メガリザードンワイは買えますか", { intent: "damage", attacker: "マスカーニャ", defender: "メガリザードンY", move: "パワージェム", a: { down: "spa" }, d: { sp: { hp: 32, def: 32 }, up: "def" } }),
  // 2026-10-11: 「大地の波動」が「ドイツの波動」、「メガカメックス」が「メガカミックス」と書き起こされ、AI がはどうだん・メガでないカメックスで計算していた
  L(34, "エレキフィールド化のドイツの波動をメガカミックスが打ったときにメガリザードンワイに何%入る", { intent: "damage", attacker: "メガカメックス", defender: "メガリザードンY", move: "だいちのはどう", terrain: /エレキ/ }),
  // 2026-10-12: 「じしん」が「受診」「受信」「自身」、「HB振り」が「HBブリ」、「特化」が「トッカ」、「ガブ」が「ガム」と書き起こされ、AI が技を落として「どの技？」になっていた（data/misheard.json で先に直す）
  L(50, "HBブリエンペルトに特化ガムの受診は", { intent: "damage", attacker: "ガブリアス", defender: "エンペルト", move: "じしん", a: { up: "atk" }, d: { sp: { hp: 32, def: 32 } } }),
  L(58, "HB振りエンペルトに特化自身ガブリアスの耐える", { intent: "damage", attacker: "ガブリアス", defender: "エンペルト", move: "じしん", a: { up: "atk" }, d: { sp: { hp: 32, def: 32 } } }),
  L(59, "HBエンペルトに特化ガムの受診は絶えますか", { intent: "damage", attacker: "ガブリアス", defender: "エンペルト", move: "じしん", a: { up: "atk" }, d: { sp: { hp: 32, def: 32 } } }),
  L(61, "HBトッカエンペルトに特化ガブリアスの受信を打ったら耐える", { intent: "damage", attacker: "ガブリアス", defender: "エンペルト", move: "じしん", a: { up: "atk" }, d: { sp: { hp: 32, def: 32 }, up: "def" } }),
  L(70, "HB特化エンペルトに特化受診ガブリアス", { intent: "damage", attacker: "ガブリアス", defender: "エンペルト", move: "じしん", d: { sp: { hp: 32, def: 32 }, up: "def" } }),
  L(71, "HB特化エンペルトに特化ガブリアスの受診", { intent: "damage", attacker: "ガブリアス", defender: "エンペルト", move: "じしん", a: { up: "atk" }, d: { sp: { hp: 32, def: 32 }, up: "def" } }),
  L(72, "HB特化エンペルトにA特化ガブリアスの受診はどれぐらい入る", { intent: "damage", attacker: "ガブリアス", defender: "エンペルト", move: "じしん", a: { up: "atk" }, d: { sp: { hp: 32, def: 32 }, up: "def" } }),
  // 2026-10-12: 「ドヒドイデ」が「とひどいレ」「ひどいで」、「イカサマ」が「イカ様」、「メガグソクムシャ」が「メガソ武者」「目がグソクムシ」、「カイリュー」が「海流」、「マフォクシー」が「ヴォクシー」と書き起こされた
  L(65, "型破りのドリューズの受信がメガヴォクシーにどれぐらい入る", { intent: "damage", attacker: "ドリュウズ", defender: "メガマフォクシー", move: "じしん" }),
  L(77, "メガボーマンダの地震でHB特化とひどいレにどれぐらい入る", { intent: "damage", attacker: "メガボーマンダ", defender: "ドヒドイデ", move: "じしん", d: { sp: { hp: 32, def: 32 }, up: "def" } }),
  L(79, "メガヤミラミのイカ様ってひどいでにどれぐらい入る", { intent: "damage", attacker: "メガヤミラミ", defender: "ドヒドイデ", move: "イカサマ" }),
  L(91, "セグレイヴの氷のつぶてステロ込みでメガ海流倒せる", { intent: "damage", attacker: "セグレイブ", defender: "メガカイリュー", move: "こおりのつぶて" }),
  L(93, "メガソ武者の不意打ちをドヒドイでどんぐらい耐える", { intent: "damage", attacker: "メガグソクムシャ", defender: "ドヒドイデ", move: "ふいうち" }),
  L(94, "目がグソクムシの不意打ちをドヒドイでどれぐらいタイル", { intent: "damage", attacker: "メガグソクムシャ", defender: "ドヒドイデ", move: "ふいうち" }),
  // 2026-10-14: 「HB」が「EV」、「ガブ」が「株」と書き起こされた。AI は「EV」を全部の能力に 32 振ったと読んでいた（#156 で HB振りと言い直している）。
  // 能力の文字のない「特化ガブ」（攻撃側。わざの分類で A か C に決まる）・「振り」のない「HBエンペルト」が読めず AI に回っていた
  L(155, "EVエンペルトにガブリアスの地震は耐えますか", { intent: "damage", attacker: "ガブリアス", defender: "エンペルト", move: "じしん", d: { sp: { hp: 32, def: 32 } } }),
  L(156, "HBぶりエンペルトに特化株の受信はどんぐらい入る", { intent: "damage", attacker: "ガブリアス", defender: "エンペルト", move: "じしん", a: { sp: { atk: 32 }, up: "atk" }, d: { sp: { hp: 32, def: 32 } } }),
];
