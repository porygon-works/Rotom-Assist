// AI 取り出しアダプタ（構成設計 4.3）。OpenAI 互換の形式（Chat Completions）で呼び、駄目なら次の候補に切り替える
// 既定の順番は比較テストの結果（docs/eval-plan.md 7 章）: Gemini 3.5 Flash-Lite → Gemini 3.1 Flash-Lite → Groq gpt-oss-120b
import { EXTRACT_PROMPT } from "./extractPrompt";

export interface Provider {
  name: string;
  url: string;
  key: string;
  model: string;
  /** モデルごとの追加の指定（思考を切るなど） */
  extra?: Record<string, unknown>;
}

const GEMINI = "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions";
const GROQ = "https://api.groq.com/openai/v1/chat/completions";

/** 環境変数から候補を作る。LLM_* があれば最優先、続いて GEMINI_API_KEY・GROQ_API_KEY の既定の候補 */
export function providersFromEnv(env: Record<string, string | undefined> = process.env): Provider[] {
  const list: Provider[] = [];
  if (env.LLM_BASE_URL && env.LLM_API_KEY && env.LLM_MODEL) {
    list.push({ name: env.LLM_MODEL, url: env.LLM_BASE_URL, key: env.LLM_API_KEY, model: env.LLM_MODEL });
  }
  if (env.GEMINI_API_KEY) {
    list.push({ name: "gemini-3.5-flash-lite", url: GEMINI, key: env.GEMINI_API_KEY, model: "gemini-3.5-flash-lite", extra: { reasoning_effort: "minimal" } });
    list.push({ name: "gemini-3.1-flash-lite", url: GEMINI, key: env.GEMINI_API_KEY, model: "gemini-3.1-flash-lite", extra: { reasoning_effort: "none" } });
  }
  if (env.GROQ_API_KEY) {
    list.push({ name: "groq-gpt-oss-120b", url: GROQ, key: env.GROQ_API_KEY, model: "openai/gpt-oss-120b", extra: { reasoning_effort: "low" } });
  }
  return list;
}

/** AI の設定の状態（キーの有無・環境・コミット）。キーの値そのものは含めない。調査用にログと画面の診断に出す */
export interface AiSetup {
  /** Vercel の環境（production / preview / development）。手元なら local */
  env: string;
  /** デプロイ元のコミット（短縮）。手元なら空 */
  commit: string;
  keys: { GEMINI_API_KEY: boolean; GROQ_API_KEY: boolean; LLM_API_KEY: boolean };
  providers: string[];
  /** SUPABASE_URL と SUPABASE_SERVICE_ROLE_KEY が両方見えているか（false なら roas.ask_log に記録されない） */
  log: boolean;
}

export function aiSetup(env: Record<string, string | undefined> = process.env): AiSetup {
  return {
    env: env.VERCEL_ENV ?? "local",
    commit: (env.VERCEL_GIT_COMMIT_SHA ?? "").slice(0, 7),
    keys: { GEMINI_API_KEY: !!env.GEMINI_API_KEY, GROQ_API_KEY: !!env.GROQ_API_KEY, LLM_API_KEY: !!env.LLM_API_KEY },
    providers: providersFromEnv(env).map((p) => p.name),
    log: !!(env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY),
  };
}

export interface Turn {
  user: string;
  /** そのときの取り出し結果（JSON） */
  extraction: unknown;
}

export interface Attempt {
  provider: string;
  ms: number;
  ok: boolean;
  error?: string;
}

export interface ExtractResult {
  extraction: Record<string, unknown> | null;
  provider?: string;
  attempts: Attempt[];
}

/** 思考の書き出しやコードブロックを除き、最初の JSON を取り出す */
export function parseJson(text: string): Record<string, unknown> | null {
  const t = text.replace(/<thought>[\s\S]*?<\/thought>/g, "").replace(/```(json)?/g, "");
  const start = t.search(/[[{]/);
  if (start < 0) return null;
  for (let end = t.length; end > start; end--) {
    try {
      const v = JSON.parse(t.slice(start, end));
      const o = Array.isArray(v) ? v[0] : v;
      return o && typeof o === "object" ? o : null;
    } catch {
      /* 末尾を縮めて再試行 */
    }
  }
  return null;
}

type Fetch = typeof fetch;

/** 上限（429）を返した候補は、しばらく飛ばす（毎回断られてから切り替える無駄を省く） */
const cooldown = new Map<string, number>();
const COOLDOWN_MS = 60_000;

/** 候補を順に試す。上限（429）・サーバの不調（5xx）・時間切れ・読めない返答なら次へ */
export async function extract(
  text: string,
  opts: { history?: Turn[]; providers?: Provider[]; timeoutMs?: number; lastTimeoutMs?: number; fetchImpl?: Fetch } = {},
): Promise<ExtractResult> {
  const messages = [
    { role: "system", content: EXTRACT_PROMPT },
    ...(opts.history ?? []).slice(-1).flatMap((h) => [
      { role: "user", content: h.user },
      { role: "assistant", content: JSON.stringify(h.extraction) },
    ]),
    { role: "user", content: text },
  ];
  const r = await callJson(messages, opts);
  return { extraction: r.json, provider: r.provider, attempts: r.attempts };
}

export interface Message {
  role: "system" | "user" | "assistant";
  content: string;
}

/** 候補を順に呼び、最初に JSON を返したものを使う（429 の候補は 60 秒休ませる）。extract・雑談・説明文の翻訳で共通 */
export async function callJson(
  messages: Message[] | { role: string; content: string }[],
  opts: { providers?: Provider[]; timeoutMs?: number; lastTimeoutMs?: number; fetchImpl?: Fetch; temperature?: number } = {},
): Promise<{ json: Record<string, unknown> | null; provider?: string; attempts: Attempt[] }> {
  const providers = opts.providers ?? providersFromEnv();
  const doFetch = opts.fetchImpl ?? fetch;
  const attempts: Attempt[] = [];
  const now = Date.now();
  const ready = providers.filter((p) => (cooldown.get(p.name) ?? 0) <= now);
  const order = ready.length ? ready : providers;
  for (const [i, p] of order.entries()) {
    const t0 = Date.now();
    // 最後の候補は長めに待つ（予備がもう無いので、遅くても答えを返す方がよい。無料枠は混むと 10 秒以上かかることがある）
    const timeout = i === order.length - 1 ? (opts.lastTimeoutMs ?? 8000) : (opts.timeoutMs ?? 3000);
    try {
      const res = await doFetch(p.url, {
        method: "POST",
        headers: { Authorization: `Bearer ${p.key}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model: p.model, messages, temperature: opts.temperature ?? 0, response_format: { type: "json_object" }, ...p.extra }),
        signal: AbortSignal.timeout(timeout),
      });
      if (!res.ok) {
        if (res.status === 429) cooldown.set(p.name, Date.now() + COOLDOWN_MS);
        attempts.push({ provider: p.name, ms: Date.now() - t0, ok: false, error: `HTTP ${res.status}` });
        continue;
      }
      const j = (await res.json()) as { choices?: { message?: { content?: string } }[] };
      const json = parseJson(j.choices?.[0]?.message?.content ?? "");
      if (!json) {
        attempts.push({ provider: p.name, ms: Date.now() - t0, ok: false, error: "JSON として読めない" });
        continue;
      }
      attempts.push({ provider: p.name, ms: Date.now() - t0, ok: true });
      return { json, provider: p.name, attempts };
    } catch (e) {
      const err = e as Error;
      attempts.push({ provider: p.name, ms: Date.now() - t0, ok: false, error: err.name === "TimeoutError" ? "時間切れ" : err.message });
    }
  }
  return { json: null, attempts };
}
