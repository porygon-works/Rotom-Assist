// ルール解析（lib/parse.ts）だけで 30 問のうちどれを正しく即答できるかを数える（AI は呼ばない）
// 使い方: npx tsx eval/rules.ts
import { parseQuestion } from "../lib/parse";
import { CASES } from "./cases";

let ok = 0, wrong = 0, pass = 0;
for (const c of CASES) {
  if (c.history) continue; // 前の会話を使う質問はルールの対象外
  const r = parseQuestion(c.text);
  if (!r.ok) {
    pass++;
    console.log(`#${c.id} AI へ回す: ${r.message}`);
    continue;
  }
  const o = { intent: "damage", attacker: r.attacker.ja, defender: r.defender.ja, move: r.move.ja, conditions: {} };
  const errors = c.check(o);
  if (errors.length) wrong++; else ok++;
  console.log(`#${c.id} ${errors.length ? "× 誤答" : "○ 即答"} ${r.attacker.ja}→${r.defender.ja} ${r.move.ja} ${errors.join(" / ")}`);
}
console.log(`\n即答で正解 ${ok} 問、即答で誤り ${wrong} 問、AI へ回す ${pass} 問`);
