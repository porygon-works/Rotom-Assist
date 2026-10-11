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
  // 2026-10-11 夕方: いろいろな言い方を試してもらった分（#36〜#96）。書き起こし違いが多く、ほとんど AI に回っていた
  L(51, "HBエンペルトに特化株の受診はどれぐらい入る", { intent: "damage", attacker: "ガブリアス", defender: "エンペルト", move: "じしん", d: { sp: { hp: 32, def: 32 } } }),
  L(59, "HBエンペルトに特化ガムの受診は絶えますか", { intent: "damage", attacker: "ガブリアス", defender: "エンペルト", move: "じしん", d: { sp: { hp: 32, def: 32 } } }),
  L(61, "HBトッカエンペルトに特化ガブリアスの受信を打ったら耐える", { intent: "damage", attacker: "ガブリアス", defender: "エンペルト", move: "じしん", d: { sp: { hp: 32, def: 32 }, up: "def" } }),
  L(41, "イエスさんメスがサイコフィールドかでワイドフォースを打ったらガブリアスにはどれぐらい入る", { intent: "damage", attacker: "イエッサン（メス）", defender: "ガブリアス", move: "ワイドフォース", terrain: /サイコ/ }),
  L(66, "型破りドリューズの受信がメガマフォクシーにどれぐらい入る", { intent: "damage", attacker: "ドリュウズ", defender: "メガマフォクシー", move: "じしん" }),
  L(65, "型破りのドリューズの受信がメガヴォクシーにどれぐらい入る", { intent: "damage", attacker: "ドリュウズ", defender: "メガマフォクシー", move: "じしん" }),
  L(76, "メガルカリオZの徹底光線がステロコミのメガボーマンダにどれぐらい入る", { intent: "damage", attacker: "メガルカリオZ", defender: "メガボーマンダ", move: "てっていこうせん", d: { stealthRock: true } }),
  L(77, "メガボーマンダの地震でHB特化とひどいレにどれぐらい入る", { intent: "damage", attacker: "メガボーマンダ", defender: "ドヒドイデ", move: "じしん" }),
  L(80, "メガヤミラミのイカ様ってどひどいでにどれぐらい入る", { intent: "damage", attacker: "メガヤミラミ", defender: "ドヒドイデ", move: "イカサマ" }),
  L(85, "オーロンゲのイカ様をA特化のドヒドイでに売ったらどれぐらい入る", { intent: "damage", attacker: "オーロンゲ", defender: "ドヒドイデ", move: "イカサマ", d: { sp: { atk: 32 }, up: "atk" } }),
  L(91, "セグレイヴの氷のつぶてステロ込みでメガ海流倒せる", { intent: "damage", attacker: "セグレイブ", defender: "メガカイリュー", move: "こおりのつぶて", d: { stealthRock: true } }),
  L(94, "目がグソクムシの不意打ちをドヒドイでどれぐらいタイル", { intent: "damage", attacker: "メガグソクムシャ", defender: "ドヒドイデ", move: "ふいうち" }),
  L(93, "メガソ武者の不意打ちをドヒドイでどんぐらい耐える", { intent: "damage", attacker: "メガグソクムシャ", defender: "ドヒドイデ", move: "ふいうち" }),
  L(87, "ポワルンって特性何", { intent: "ability", pokemon: "ポワルン" }),
  L(75, "メガピクシーの特性って何だっけ", { intent: "ability", pokemon: "メガピクシー" }),
  L(95, "メガソ武者のこと教えて", { intent: "about", pokemon: "メガグソクムシャ" }),
  L(88, "発寒にインファイト打ったら効果抜群", { intent: "type", pokemon: "ハッサム", move: "インファイト" }),
];
