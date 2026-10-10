// 未使用の確認用（fresh、2026-10-11 夜に作成）: ルール解析・指示文の改善に一度も使っていない質問。
// 正解は質問と同時に書いた（結果を見てから直していない）。この組を見てルールを直したら、別の組を作り直す
import { checkSpec } from "./cases2";
import type { Case } from "./cases";

type Spec = Parameters<typeof checkSpec>[1];
const F = (id: number, text: string, w: Spec): Case => ({
  id, text, group: w.intent === "clarify" ? "clarify-extract" : w.intent === "chat" ? "deferred" : "extract",
  check: (o) => checkSpec(o, w),
});

export const CASES3: Case[] = [
  F(201, "サザンドラのあくのはどう、ウルガモスに何発？", { intent: "damage", attacker: "サザンドラ", defender: "ウルガモス", move: "あくのはどう" }),
  F(202, "H振りバンギラスにガブのじしん", { intent: "damage", attacker: "ガブリアス", defender: "バンギラス", move: "じしん", d: { sp: { hp: 32 } } }),
  F(203, "C特化メガゲンガーのシャドーボール、サーフゴー耐える？", { intent: "damage", attacker: "メガゲンガー", defender: "サーフゴー", move: "シャドーボール", a: { sp: { spa: 32 }, up: "spa" } }),
  F(204, "いのちのたまドラパルトのドラゴンアロー、カイリューに", { intent: "damage", attacker: "ドラパルト", defender: "カイリュー", move: "ドラゴンアロー", a: { item: /イノチノタマ/ } }),
  F(205, "ガブリアスの素早さは？", { intent: "speed", pokemon: "ガブリアス" }),
  F(206, "最速ウルガモスと準速ドラパルトどっちが速い？", { intent: "speed", attacker: "ウルガモス", defender: "ドラパルト", a: { sp: { spe: 32 }, up: "spe" }, d: { sp: { spe: 32 }, neutralSpe: true } }),
  F(207, "ミミッキュの弱点", { intent: "type", pokemon: "ミミッキュ" }),
  F(208, "ドドゲザンのタイプは？", { intent: "type", pokemon: "ドドゲザン" }),
  F(209, "ゲンガーの種族値は？", { intent: "stats", pokemon: "ゲンガー" }),
  F(210, "ふいうちの威力は？", { intent: "move_info", move: "ふいうち" }),
  F(211, "ガオガエンってねこだましおぼえる？", { intent: "learnset", pokemon: "ガオガエン", move: "ねこだまし" }),
  F(212, "晴れのリザードンのソーラービーム、ウォッシュロトムに", { intent: "damage", attacker: "リザードン", defender: "ウォッシュロトム", move: "ソーラービーム", weather: /晴/ }),
  F(213, "砂嵐でバンギラスのストーンエッジ、リザードンに", { intent: "damage", attacker: "バンギラス", defender: "リザードン", move: "ストーンエッジ", weather: /砂/ }),
  F(214, "グラスフィールドでカットロトムのリーフストーム、ウォッシュロトムに", { intent: "damage", attacker: "カットロトム", defender: "ウォッシュロトム", move: "リーフストーム", terrain: /グラス/ }),
  F(215, "A+2のガブリアスのげきりん、カイリューに", { intent: "damage", attacker: "ガブリアス", defender: "カイリュー", move: "げきりん", a: { boosts: { atk: 2 } } }),
  F(216, "S1段階上昇のドラパルトって最速ガブリアス抜ける？", { intent: "speed", attacker: "ドラパルト", defender: "ガブリアス", a: { boosts: { spe: 1 } }, d: { sp: { spe: 32 }, up: "spe" } }),
  F(217, "ステロ込みでウルガモスにバンギラスのストーンエッジ", { intent: "damage", attacker: "バンギラス", defender: "ウルガモス", move: "ストーンエッジ", d: { stealthRock: true } }),
  F(218, "HP半分のカイリューにミミッキュのじゃれつく", { intent: "damage", attacker: "ミミッキュ", defender: "カイリュー", move: "じゃれつく", d: { hpLeftPercent: 50 } }),
  F(219, "ようきガブリアスとおくびょうドラパルトどっちが速い？", { intent: "speed", attacker: "ガブリアス", defender: "ドラパルト", a: { up: "spe" }, d: { up: "spe" } }),
  F(220, "HD特化サーフゴーにC特化サザンドラのあくのはどう", { intent: "damage", attacker: "サザンドラ", defender: "サーフゴー", move: "あくのはどう", a: { sp: { spa: 32 }, up: "spa" }, d: { sp: { hp: 32, spd: 32 }, up: "spd" } }),
  F(221, "スカーフドラパルトって最速メガルカリオZ抜ける？", { intent: "speed", attacker: "ドラパルト", defender: "メガルカリオZ", a: { item: /スカーフ/ }, d: { sp: { spe: 32 }, up: "spe" } }),
  F(222, "ドラパルトのシャドーボール、ゲンガーに", { intent: "damage", attacker: "ドラパルト", defender: "ゲンガー", move: "シャドーボール" }),
  F(223, "サーナイトにドドゲザンのアイアンヘッド", { intent: "damage", attacker: "ドドゲザン", defender: "サーナイト", move: "アイアンヘッド" }),
  F(224, "ニンフィアのハイパーボイスで準速ガブ落ちる？", { intent: "damage", attacker: "ニンフィア", defender: "ガブリアス", move: "ハイパーボイス" }),
  F(225, "おはようございます", { intent: "chat" }),
  F(226, "メガカイリューのしんそく、ガブリアスに確定？", { intent: "damage", attacker: "メガカイリュー", defender: "ガブリアス", move: "しんそく" }),
  F(227, "ミミッキュに急所でガブのじしん", { intent: "damage", attacker: "ガブリアス", defender: "ミミッキュ", move: "じしん", critical: true }),
  F(228, "雨のときのバンギラスにウォッシュロトムのハイドロポンプ", { intent: "damage", attacker: "ウォッシュロトム", defender: "バンギラス", move: "ハイドロポンプ", weather: /雨/ }),
  F(229, "ウルガモスの素早さ実数値", { intent: "speed", pokemon: "ウルガモス" }),
  F(230, "ガブとドラパどっちが速い？", { intent: "speed", attacker: "ガブリアス", defender: "ドラパルト" }),
];
