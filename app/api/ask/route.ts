import { after } from "next/server";
import { ask } from "../../../lib/ask";
import { logAsk } from "../../../lib/askLog";
import type { Turn } from "../../../lib/llm";
import { allow } from "../../../lib/rateLimit";
import { isDeviceId } from "../../../lib/validateHistory";

export const runtime = "nodejs";
// AI が混んでいると 10 秒近くかかることがある（lib/llm.ts の最後の候補は 8 秒まで待つ）
export const maxDuration = 20;

const MAX_TEXT = 200;

/** POST /api/ask { text, history?: [{ user, extraction }], device_id? } → 読み上げ文・画面用データ・診断（構成設計 4.1） */
export async function POST(req: Request) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  if (!allow(ip)) return Response.json({ error: "回数が多すぎるロト。1分待ってほしいロト" }, { status: 429 });
  let body: { text?: unknown; history?: unknown; device_id?: unknown };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "JSONとして読めませんでした" }, { status: 400 });
  }
  const text = typeof body.text === "string" ? body.text.trim() : "";
  if (!text) return Response.json({ error: "text が空です" }, { status: 400 });
  if (text.length > MAX_TEXT) return Response.json({ error: `text は ${MAX_TEXT} 文字以内にしてください` }, { status: 400 });
  const history: Turn[] = Array.isArray(body.history)
    ? body.history
        .filter(
          (h): h is Turn =>
            !!h && typeof h === "object" && typeof (h as Turn).user === "string" && (h as Turn).user.length <= MAX_TEXT &&
            JSON.stringify((h as Turn).extraction ?? null).length <= 2000,
        )
        .slice(-1)
    : [];
  const result = await ask(text, { history });
  // 記録は答えを返した後に行う（Supabase が遅くても応答を待たせない）
  const deviceId = isDeviceId(body.device_id) ? body.device_id : "";
  after(() => logAsk(text, deviceId, result));
  return Response.json(result);
}
