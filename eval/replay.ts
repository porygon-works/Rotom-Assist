// 再生テスト: 保存済みの AI の出力（eval/results/*.json）をアプリの処理（lib/ask.ts の answerExtraction）に流し込み、
// 質問ごとの回答文を一覧にする。AI を呼ばないので、無料枠を使わずにアプリの動作を確かめられる
// 使い方: npx tsx eval/replay.ts [ファイル名に含む文字列]
import { readdirSync, readFileSync } from "node:fs";
import { answerExtraction } from "../lib/ask";
import { CASES } from "./cases";
import { CASES2 } from "./cases2";

const ALL = new Map([...CASES, ...CASES2].map((c) => [c.id, c]));
const filter = process.argv[2] ?? "";
let errors = 0;
let total = 0;
for (const f of readdirSync("eval/results").filter((f) => f.endsWith(".json") && f.includes(filter)).sort()) {
  const d = JSON.parse(readFileSync(`eval/results/${f}`, "utf8"));
  const seen = new Set<number>();
  console.log(`\n## ${f}`);
  for (const r of d.rows) {
    if (!r.output || seen.has(r.id)) continue; // 同じ質問は最初の 1 回だけ
    seen.add(r.id);
    total++;
    const a = answerExtraction(r.output, ALL.get(r.id)?.text);
    const bad = a.title === "エラー";
    if (bad) errors++;
    console.log(`#${r.id} ${ALL.get(r.id)?.text}\n   → [${a.intent}] ${a.speech}${bad ? `  ※${a.lines.join(" ")}` : ""}`);
  }
}
console.log(`\n${total} 件、計算エラー ${errors} 件`);
