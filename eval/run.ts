// AI 比較テスト（docs/eval-plan.md）。全候補を OpenAI 互換の窓口で呼ぶ（要件 N8）。
// 使い方: npx tsx eval/run.ts <候補名> [--prompt v1] [--repeat 3] [--only 1,2,3] [--no-burst]
// キーは環境変数 GEMINI_API_KEY / GROQ_API_KEY から読む。結果は eval/results/<候補名>[-<指示文>].json に書く（v1 は接尾辞なし）。
import { mkdirSync, writeFileSync } from "node:fs";
import { CASES, canonical, fabrication, type Case, type Out } from "./cases";
import { PROMPTS } from "./prompt";

interface Provider {
  url: string;
  keyEnv: string;
  model: string;
  extra?: Record<string, unknown>;
}

const GEMINI = "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions";
const GROQ = "https://api.groq.com/openai/v1/chat/completions";

export const PROVIDERS: Record<string, Provider> = {
  // 思考は切る／最小にする（速さ優先）。設定値は実施時に試して決めた（none を受け付けないモデルがある）
  "gemma-4-26b": { url: GEMINI, keyEnv: "GEMINI_API_KEY", model: "gemma-4-26b-a4b-it", extra: { reasoning_effort: "minimal" } },
  "gemini-3.8-flash": { url: GEMINI, keyEnv: "GEMINI_API_KEY", model: "gemini-3.8-flash", extra: { reasoning_effort: "none" } },
  "gemini-3.5-flash-lite": { url: GEMINI, keyEnv: "GEMINI_API_KEY", model: "gemini-3.5-flash-lite", extra: { reasoning_effort: "minimal" } },
  "groq-gpt-oss-120b": { url: GROQ, keyEnv: "GROQ_API_KEY", model: "openai/gpt-oss-120b", extra: { reasoning_effort: "low" } },
  "groq-gpt-oss-20b": { url: GROQ, keyEnv: "GROQ_API_KEY", model: "openai/gpt-oss-20b", extra: { reasoning_effort: "low" } },
  "groq-qwen3.8-27b": { url: GROQ, keyEnv: "GROQ_API_KEY", model: "qwen/qwen3.8-27b" },
};

interface Call {
  ok: boolean;
  status: number;
  ms: number;
  text: string;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
  rateLimit?: Record<string, string>;
  dailyQuota?: boolean;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let SYSTEM = PROMPTS.v1;

async function call(p: Provider, c: Case): Promise<Call> {
  const messages = [
    { role: "system", content: SYSTEM },
    ...(c.history ? [{ role: "user", content: c.history.user }, { role: "assistant", content: c.history.assistant }] : []),
    { role: "user", content: c.text },
  ];
  const t0 = performance.now();
  const res = await fetch(p.url, {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env[p.keyEnv]}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: p.model, messages, temperature: 0, response_format: { type: "json_object" }, ...p.extra }),
  });
  const body = await res.text();
  const ms = performance.now() - t0;
  const rateLimit = Object.fromEntries([...res.headers].filter(([k]) => k.includes("ratelimit") || k === "retry-after"));
  if (!res.ok) {
    return { ok: false, status: res.status, ms, text: body.slice(0, 600), rateLimit, dailyQuota: /PerDay|per day|RPD|TPD/i.test(body) };
  }
  const j = JSON.parse(body);
  return { ok: true, status: res.status, ms, text: j.choices?.[0]?.message?.content ?? "", usage: j.usage, rateLimit };
}

/** 思考の書き出しやコードブロックを除き、最初の JSON を取り出す */
export function parseJson(text: string): Out | null {
  const t = text.replace(/<thought>[\s\S]*?<\/thought>/g, "").replace(/```(json)?/g, "");
  const start = t.search(/[[{]/);
  if (start < 0) return null;
  for (let end = t.length; end > start; end--) {
    try {
      const v = JSON.parse(t.slice(start, end));
      return Array.isArray(v) ? (v[0] ?? null) : v;
    } catch {
      /* 末尾を縮めて再試行 */
    }
  }
  return null;
}

interface Row {
  id: number;
  group: Case["group"];
  run: number;
  ms: number;
  status: number;
  retries429: number;
  output: Out | null;
  raw?: string;
  errors: string[];
  fabricated: string[];
  usage?: Call["usage"];
}

async function runCase(p: Provider, c: Case, run: number): Promise<Row & { daily?: boolean }> {
  let retries = 0;
  for (;;) {
    const r = await call(p, c);
    if (r.status === 429 && !r.dailyQuota && retries < 5) {
      retries++;
      const wait = Number(r.rateLimit?.["retry-after"]) || 20;
      console.error(`  #${c.id} 429（${retries} 回目）→ ${wait}s 待つ`);
      await sleep(wait * 1000);
      continue;
    }
    const output = r.ok ? parseJson(r.text) : null;
    const errors = !r.ok ? [`HTTP ${r.status}: ${r.text.slice(0, 200)}`] : output ? c.check(output) : ["JSON として読めない"];
    return {
      id: c.id, group: c.group, run, ms: Math.round(r.ms), status: r.status, retries429: retries, output,
      raw: output ? undefined : r.text.slice(0, 600), errors, fabricated: output ? fabrication(output) : [], usage: r.usage,
      daily: r.dailyQuota,
    };
  }
}

/** 連続テスト: 1 分間に 5 問（12 秒おき）を 3 回。429 は再試行しないで数える */
async function burst(p: Provider) {
  const pick = [1, 3, 4, 10, 25].map((id) => CASES.find((c) => c.id === id)!);
  const rounds: { round: number; statuses: number[]; ms: number[] }[] = [];
  for (let round = 1; round <= 3; round++) {
    const statuses: number[] = [];
    const ms: number[] = [];
    for (const c of pick) {
      const t0 = Date.now();
      const r = await call(p, c);
      statuses.push(r.status);
      ms.push(Math.round(r.ms));
      await sleep(Math.max(0, 12000 - (Date.now() - t0)));
    }
    rounds.push({ round, statuses, ms });
    console.error(`  連続 ${round}: ${statuses.join(",")}`);
  }
  return rounds;
}

async function main() {
  const [name, ...args] = process.argv.slice(2);
  const p = PROVIDERS[name];
  if (!p) throw new Error(`候補名: ${Object.keys(PROVIDERS).join(" / ")}`);
  if (!process.env[p.keyEnv]) throw new Error(`${p.keyEnv} が未設定`);
  const promptName = args.includes("--prompt") ? args[args.indexOf("--prompt") + 1] : "v1";
  if (!PROMPTS[promptName]) throw new Error(`指示文: ${Object.keys(PROMPTS).join(" / ")}`);
  SYSTEM = PROMPTS[promptName];
  const repeat = Number(args[args.indexOf("--repeat") + 1]) || 3;
  const only = args.includes("--only") ? args[args.indexOf("--only") + 1].split(",").map(Number) : null;
  const cases = only ? CASES.filter((c) => only.includes(c.id)) : CASES;

  const rows: Row[] = [];
  let stopped: string | null = null;
  outer: for (let run = 1; run <= repeat; run++) {
    for (const c of cases) {
      const r = await runCase(p, c, run);
      rows.push(r);
      console.error(`${name} run${run} #${c.id} ${r.ms}ms ${r.errors.length ? "×" : "○"} ${r.errors.join(" / ")}`);
      if (r.daily) {
        stopped = `1 日の上限に達した（run${run} #${c.id}）`;
        break outer;
      }
    }
  }
  let bursts = null;
  if (!stopped && !args.includes("--no-burst")) {
    await sleep(65000); // 直前の連続呼び出しの影響を抜く
    bursts = await burst(p);
  }
  mkdirSync("eval/results", { recursive: true });
  const file = promptName === "v1" ? name : `${name}-${promptName}`;
  writeFileSync(`eval/results/${file}.json`, JSON.stringify({ name, prompt: promptName, model: p.model, extra: p.extra, date: new Date().toISOString(), stopped, rows, bursts }, null, 2));
  console.error(`done ${name}${stopped ? ` (${stopped})` : ""}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
