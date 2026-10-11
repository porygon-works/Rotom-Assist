import { allow } from "../../../lib/rateLimit";
import { synthesize } from "../../../lib/tts";

export const runtime = "nodejs";
export const maxDuration = 20;

const MAX_TEXT = 300;

/** POST /api/tts { text } → audio/wav。キーがない・上限・不調なら 503（画面はブラウザの読み上げに戻す） */
export async function POST(req: Request) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  if (!allow(`tts:${ip}`)) return Response.json({ error: "回数が多すぎます" }, { status: 429 });
  let body: { text?: unknown };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "JSONとして読めませんでした" }, { status: 400 });
  }
  const text = typeof body.text === "string" ? body.text.trim().slice(0, MAX_TEXT) : "";
  if (!text) return Response.json({ error: "text が空です" }, { status: 400 });
  const key = process.env.GEMINI_API_KEY;
  if (!key) return Response.json({ error: "GEMINI_API_KEY がない" }, { status: 503 });
  const r = await synthesize(text, key);
  if (!r.wav) return Response.json({ error: r.errors.join(" / ") }, { status: 503 });
  return new Response(r.wav as unknown as BodyInit, { headers: { "content-type": "audio/wav", "cache-control": "no-store", "x-tts-model": r.model ?? "" } });
}
