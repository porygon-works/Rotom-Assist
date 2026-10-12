// ルール解析（lib/rules.ts）だけで、テストの質問のうちどれを正しく即答できるかを数える（AI は呼ばない）
// 大事なのは「即答した問題で間違いが 0 件」であること。答えられない問題は AI に回るだけ
// 使い方: npx tsx eval/rules.ts [fresh|log]（fresh: ルール作りに使っていない組 eval/cases3.ts だけ、log: 実際の質問から作った組 eval/cases-log.ts だけ）
import { fixMishearing } from "../lib/misheard";
import { parseFollowUp, parseRules } from "../lib/rules";
import { CASES } from "./cases";
import { CASES2 } from "./cases2";
import { CASES3 } from "./cases3";
import { CASES_LOG } from "./cases-log";

let ok = 0, wrong = 0, pass = 0;
const arg = process.argv[2];
for (const c of arg === "fresh" ? CASES3 : arg === "log" ? CASES_LOG : [...CASES, ...CASES2, ...CASES_LOG]) {
  // 前の会話を使う質問は、直前の解釈に条件を足すルール（parseFollowUp）で測る
  // アプリ（lib/ask.ts）と同じく、聞き間違いを直した文で読む
  const text = fixMishearing(c.text);
  const o = c.history ? parseFollowUp(text, JSON.parse(c.history.assistant)) : parseRules(text);
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
