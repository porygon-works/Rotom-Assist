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
];
