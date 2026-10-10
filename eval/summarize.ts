// eval/results/*.json を集計して、docs/eval-plan.md 7 章の表の形で出す
// 使い方: npx tsx eval/summarize.ts [ファイル名に含む文字列]
import { readdirSync, readFileSync } from "node:fs";
import { CASES, canonical, type Out } from "./cases";
import { CASES2 } from "./cases2";

const ALL = [...CASES, ...CASES2];

/** サーバ側の補正（案）: clarify なのに足りないもの・知らない名前がなく、攻撃側・防御側・わざが揃っていれば damage として扱う */
export function guard(o: Out): Out {
  const empty = (v: unknown) => !Array.isArray(v) || v.length === 0;
  if (o.intent === "clarify" && empty(o.missing) && empty(o.unknown_names) && o.attacker && o.defender && o.move) return { ...o, intent: "damage" };
  return o;
}

// 単価（USD / 100 万トークン、入力・出力）。null は不明（Gemma は無料枠のみ）
// 2026-10-10 実施時は公式ページがネットワーク制限で開けず、検索結果（比較サイト）の値。要確認
const PRICE: Record<string, [number, number] | null> = {
  "gemma-4-26b": null,
  "gemini-3.8-flash": [0.75, 3.75],
  "gemini-3.5-flash-lite": [0.3, 2.5],
  "groq-gpt-oss-120b": [0.15, 0.75],
  "groq-gpt-oss-20b": [0.1, 0.5],
  "groq-qwen3.8-27b": null,
};

const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%（${a}/${b}）` : "—");
const quantile = (xs: number[], q: number) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.min(s.length - 1, Math.ceil(q * s.length) - 1)] : NaN;
};

const filter = process.argv[2] ?? "";
for (const f of readdirSync("eval/results").filter((f) => f.endsWith(".json") && f.includes(filter)).sort()) {
  const d = JSON.parse(readFileSync(`eval/results/${f}`, "utf8"));
  // 保存済みの出力を今の採点で付け直す（採点を直したときに AI を呼び直さなくて済むように）
  const rows: any[] = d.rows
    .filter((r: any) => r.status === 200)
    .map((r: any) => {
      const c = ALL.find((c) => c.id === r.id)!;
      return { ...r, errors: r.output ? c.check(r.output) : r.errors, guarded: r.output ? c.check(guard(r.output)) : r.errors };
    });
  const by = (pred: (r: any) => boolean) => rows.filter(pred);
  const ok = (rs: any[]) => rs.filter((r) => r.errors.length === 0).length;

  const extract = by((r) => r.group === "extract" || r.group === "clarify-extract");
  const deferred = by((r) => r.group === "deferred");
  const clar = by((r) => r.group === "clarify-extract");
  const fab = rows.filter((r) => r.fabricated.length);
  const ms = rows.map((r) => r.ms);

  // ぶれ: 同じ質問の 3 回が全部同じか
  const ids = [...new Set(rows.map((r) => r.id))];
  const stable = ids.filter((id) => {
    const rs = rows.filter((r) => r.id === id);
    return rs.length >= 2 && new Set(rs.map((r) => canonical(r.output))).size === 1;
  }).length;
  const multiRun = ids.filter((id) => rows.filter((r) => r.id === id).length >= 2).length;

  const inTok = rows.reduce((s, r) => s + (r.usage?.prompt_tokens ?? 0), 0) / (rows.length || 1);
  const outTok = rows.reduce((s, r) => s + (r.usage?.completion_tokens ?? 0), 0) / (rows.length || 1);
  const price = PRICE[d.name];
  const cost = price ? ((inTok * price[0] + outTok * price[1]) / 1e6).toFixed(6) : "単価不明";

  const burstErr = d.bursts ? d.bursts.flatMap((b: any) => b.statuses).filter((s: number) => s !== 200).length : null;
  const failed = d.rows.filter((r: any) => r.status !== 200).length;
  const retries = d.rows.reduce((s: number, r: any) => s + r.retries429, 0);

  console.log(`## ${d.name}［指示文 ${d.prompt ?? "v1"}・組 ${d.set ?? "base"}${d.tag ? `・${d.tag}` : ""}］（${d.model}）${d.stopped ? ` ※${d.stopped}` : ""}`);
  console.log(`- 取り出し正確さ: ${pct(ok(extract), extract.length)}（サーバ側の補正込み ${pct(extract.filter((r) => r.guarded.length === 0).length, extract.length)}）`);
  console.log(`- 後回し機能の判別: ${pct(ok(deferred), deferred.length)}`);
  console.log(`- 聞き返し: ${pct(ok(clar), clar.length)}`);
  console.log(`- 捏造: ${fab.length} 件 ${fab.map((r) => `#${r.id}:${r.fabricated.join(",")}`).join(" ")}`);
  console.log(`- 速さ: 中央値 ${(quantile(ms, 0.5) / 1000).toFixed(2)}s / 遅い5% ${(quantile(ms, 0.95) / 1000).toFixed(2)}s`);
  console.log(`- 連続: ${burstErr === null ? "未実施" : `エラー ${burstErr} 件 ${JSON.stringify(d.bursts.map((b: any) => b.statuses))}`}`);
  console.log(`- ぶれ（3 回一致）: ${pct(stable, multiRun)}`);
  console.log(`- トークン/問: 入力 ${Math.round(inTok)} / 出力 ${Math.round(outTok)}、1 問の費用 $${cost}`);
  console.log(`- 失敗した呼び出し: ${failed} 件、429 の再試行: ${retries} 回`);
  const wrong = new Map<number, string[]>();
  for (const r of rows.filter((r) => r.errors.length)) wrong.set(r.id, [...(wrong.get(r.id) ?? []), `run${r.run}: ${r.errors.join(" / ")}`]);
  for (const [id, es] of [...wrong].sort((a, b) => a[0] - b[0])) console.log(`  - #${id} ${es.join(" | ")}`);
  console.log();
}
