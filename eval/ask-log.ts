// 質問の記録（roas.ask_log）を見直すための集計。定期の見直し（docs/ask-log-review.md）で使う
// 使い方: npx tsx eval/ask-log.ts [--from <id>] [--mark]
//   既定は eval/ask-log-state.json の lastId より後の記録。--mark で、今回見た最後の id を lastId に書く（見直しが終わってから付ける）
// 必要な環境変数: SUPABASE_URL、SUPABASE_SERVICE_ROLE_KEY（値は出力しない）
import { readFileSync, writeFileSync } from "node:fs";
import { parseRules } from "../lib/rules";
import { resolve } from "../lib/resolve";

interface Row {
  id: number;
  device_id: string;
  question: string;
  title: string;
  speech: string;
  intent: string;
  provider: string;
  total_ms: number;
  attempts: { provider: string; ms: number; ok: boolean; error?: string }[];
  extraction: Record<string, unknown> | null;
  created_at: string;
}

// リポジトリの根から実行する
const STATE = "eval/ask-log-state.json";
const state = JSON.parse(readFileSync(STATE, "utf8")) as { lastId: number; reviewedAt: string };
const argv = process.argv.slice(2);
const fromArg = argv.indexOf("--from");
const from = fromArg >= 0 ? Number(argv[fromArg + 1]) : state.lastId;

async function fetchRows(after: number): Promise<Row[]> {
  const url = process.env.SUPABASE_URL?.replace(/\/$/, "");
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY が見えていない");
  const rows: Row[] = [];
  for (let last = after; ; ) {
    const q = `select=*&id=gt.${last}&order=id.asc&limit=500`;
    const res = await fetch(`${url}/rest/v1/ask_log?${q}`, { headers: { apikey: key, Authorization: `Bearer ${key}`, "Accept-Profile": "roas" } });
    if (!res.ok) throw new Error(`ask_log の取得に失敗: HTTP ${res.status}`);
    const page = (await res.json()) as Row[];
    rows.push(...page);
    if (page.length < 500) return rows;
    last = page[page.length - 1].id;
  }
}

async function fetchEvents(since: string): Promise<{ device_id: string; text: string; note: string; created_at: string }[]> {
  const url = process.env.SUPABASE_URL?.replace(/\/$/, "");
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return [];
  const q = `select=device_id,text,note,created_at&kind=eq.event&order=id.asc&limit=5000${since ? `&created_at=gt.${encodeURIComponent(since)}` : ""}`;
  const res = await fetch(`${url}/rest/v1/history?${q}`, { headers: { apikey: key, Authorization: `Bearer ${key}`, "Accept-Profile": "roas" } });
  if (!res.ok) return [];
  return ((await res.json()) as { device_id: string; text: string; note: string; created_at: string }[]).filter((e) => !e.device_id.startsWith("debug-"));
}

/** 解釈を比べられる形に（名前は正式名に直す） */
function key(o: Record<string, unknown> | null): string {
  if (!o) return "-";
  const parts = [String(o.intent ?? "")];
  for (const [k, kind] of [["attacker", "pokemon"], ["defender", "pokemon"], ["pokemon", "pokemon"], ["move", "moves"]] as const) {
    if (typeof o[k] !== "string") continue;
    const r = resolve(kind, o[k] as string);
    parts.push(`${k}=${r.ok ? r.ja : o[k]}`);
  }
  return parts.join(" ");
}

const FAILED = /分からないロト|どれのことロト|混み合ってる|AI の設定がまだ|まだ勉強中/;
const line = (r: Row) => `- #${r.id} ${r.created_at.slice(0, 16).replace("T", " ")}「${r.question}」→ ${r.speech.slice(0, 80)}（${r.provider || "答えなし"}、${r.total_ms} ms）`;

async function main() {
const all = await fetchRows(from);
// 動作確認で入れた記録は除く
const rows = all.filter((r) => !r.device_id.startsWith("debug-"));
const out: string[] = [];
out.push(`# ask_log の見直し（id ${from} より後、${rows.length} 件）`, "");
if (!rows.length) out.push("新しい記録はない");
else {
  const rules = rows.filter((r) => r.provider === "rules");
  const ai = rows.filter((r) => r.provider && r.provider !== "rules");
  out.push(`ルールで即答 ${rules.length} 件 / AI ${ai.length} 件 / 答えなし ${rows.length - rules.length - ai.length} 件`, "");

  const failed = rows.filter((r) => !r.provider || r.intent === "error" || FAILED.test(r.speech));
  out.push(`## 1. 答えられなかった・聞き返した（${failed.length} 件）`, "", ...failed.map(line), "");

  const clarify = rows.filter((r) => r.intent === "clarify" && !failed.includes(r));
  out.push(`## 2. 聞き返し（${clarify.length} 件）`, "", ...clarify.map(line), "");

  // AI に回った質問: 今のルールで即答できるか。できるなら AI の解釈と同じか（違えばどちらかが誤り）
  out.push(`## 3. AI に回った質問（${ai.length} 件）`, "");
  const still: Row[] = [];
  for (const r of ai) {
    const now = parseRules(r.question);
    if (!now) {
      still.push(r);
      continue;
    }
    const same = key(now) === key(r.extraction);
    out.push(`- #${r.id}「${r.question}」→ 今はルールで即答。${same ? "AI と同じ解釈" : `**AI と違う解釈**: ルール ${key(now)} / AI ${key(r.extraction)}`}`);
  }
  out.push("", `### まだ AI が要る質問（${still.length} 件。intent ごと）`, "");
  const byIntent = new Map<string, Row[]>();
  for (const r of still) {
    const k = String(r.extraction?.intent ?? "?");
    byIntent.set(k, [...(byIntent.get(k) ?? []), r]);
  }
  for (const [k, rs] of [...byIntent].sort((a, b) => b[1].length - a[1].length)) {
    out.push(`- ${k}（${rs.length} 件）`);
    for (const r of rs) out.push(`  - #${r.id}「${r.question}」 解釈 ${JSON.stringify(r.extraction)}`);
  }
  out.push("");

  const slow = rows.filter((r) => r.total_ms > 3000).sort((a, b) => b.total_ms - a.total_ms);
  out.push(`## 4. 遅かった（3 秒超、${slow.length} 件）`, "", ...slow.slice(0, 20).map(line), "");

  const errs = new Map<string, number>();
  for (const r of rows) for (const a of r.attempts) if (!a.ok) errs.set(`${a.provider}: ${a.error}`, (errs.get(`${a.provider}: ${a.error}`) ?? 0) + 1);
  out.push(`## 5. AI の失敗（候補ごと）`, "", ...[...errs].sort((a, b) => b[1] - a[1]).map(([k, n]) => `- ${k} … ${n} 回`), "");

  const count = new Map<string, number>();
  for (const r of rows) count.set(r.question, (count.get(r.question) ?? 0) + 1);
  const repeated = [...count].filter(([, n]) => n > 1).sort((a, b) => b[1] - a[1]);
  out.push(`## 6. 同じ質問の繰り返し（言い直し・聞き直しの目安）`, "", ...repeated.map(([q, n]) => `- 「${q}」 ${n} 回`), "");
}
// 7. 聞き取りの経過（画面が roas.history に kind=event で送る）。止まった・残っていた・エラーを数える
const ev = await fetchEvents(state.reviewedAt);
const bad = ev.filter((e) => /mic-error|mic-stale|mic-start-failed|ask-failed|sound-gemini-failed/.test(e.text) || (e.text === "mic-end" && e.note.includes("timeout")));
const count = new Map<string, number>();
for (const e of bad) {
  const k = e.text === "mic-error" ? `mic-error ${e.note.split(" ").slice(-1)[0]}` : e.text === "mic-end" ? "mic-end timeout（終わりの知らせが来なかった）" : e.text;
  count.set(k, (count.get(k) ?? 0) + 1);
}
out.push(`## 7. 聞き取りの経過（前回の見直し以降、${ev.length} 件）`, "", ...[...count].map(([k, n]) => `- ${k} … ${n} 回`), "");
const uas = [...new Set(ev.filter((e) => e.text === "page-load").map((e) => e.note.replace(/^\d+ms /, "")))];
if (uas.length) out.push("端末:", ...uas.map((u) => `- ${u}`), "");
console.log(out.join("\n"));

if (argv.includes("--mark") && all.length) {
  const lastId = all[all.length - 1].id;
  writeFileSync(STATE, JSON.stringify({ lastId, reviewedAt: new Date().toISOString() }, null, 2) + "\n");
  console.error(`lastId を ${lastId} にした`);
}
}

main().catch((e) => {
  console.error((e as Error).message);
  process.exit(1);
});
