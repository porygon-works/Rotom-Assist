// ルール解析（lib/rules.ts）だけで、テストの質問のうちどれを正しく即答できるかを数える（AI は呼ばない）
// 大事なのは「即答した問題で間違いが 0 件」であること。答えられない問題は AI に回るだけ
// 使い方: npx tsx eval/rules.ts
import { parseFollowUp, parseRules } from "../lib/rules";
import { CASES } from "./cases";
import { CASES2 } from "./cases2";

let ok = 0, wrong = 0, pass = 0;
for (const c of [...CASES, ...CASES2]) {
  // 前の会話を使う質問は、直前の解釈に条件を足すルール（parseFollowUp）で測る
  const o = c.history ? parseFollowUp(c.text, JSON.parse(c.history.assistant)) : parseRules(c.text);
  if (!o) {
    pass++;
    continue;
  }
  const errors = c.check(o);
  if (errors.length) wrong++;
  else ok++;
  console.log(`#${c.id} ${errors.length ? "× 誤答" : "○ 即答"} ${c.text} ${errors.join(" / ")}`);
}
console.log(`\n即答で正解 ${ok} 問、即答で誤り ${wrong} 問、AI へ回す ${pass} 問`);
