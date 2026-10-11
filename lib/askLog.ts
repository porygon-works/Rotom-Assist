/**
 * 質問 1 回ごとの記録を Supabase の roas.ask_log に保存する（サーバ側専用。supabase/002_ask_log.sql）。
 * 環境変数 SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY が未設定なら何もしない（アプリはそのまま動く）。
 */
import type { AskResult } from "./ask";
import { aiSetup } from "./llm";

const MAX = 1000;

export async function logAsk(question: string, deviceId: string, r: AskResult): Promise<void> {
  const url = process.env.SUPABASE_URL?.replace(/\/$/, "");
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return;
  const row = {
    device_id: deviceId,
    question: question.slice(0, MAX),
    title: r.title.slice(0, MAX),
    speech: r.speech.slice(0, MAX),
    intent: r.intent,
    provider: r.diagnostics?.provider ?? "",
    total_ms: r.diagnostics?.totalMs ?? 0,
    attempts: r.diagnostics?.attempts ?? [],
    extraction: r.extraction ?? null,
    setup: r.diagnostics?.setup ?? aiSetup(),
  };
  try {
    const res = await fetch(`${url}/rest/v1/ask_log`, {
      method: "POST",
      headers: { apikey: key, Authorization: `Bearer ${key}`, "content-type": "application/json", "Content-Profile": "roas", Prefer: "return=minimal" },
      body: JSON.stringify(row),
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) console.error(`ask_log insert failed: ${res.status} ${await res.text()}`);
  } catch (e) {
    // 記録の失敗で答えを止めない。Vercel の Logs に残す
    console.error("ask_log insert failed:", (e as Error).message);
  }
}
