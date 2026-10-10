import { insertHistory, isConfigured, listHistory } from "../../../lib/history";
import { isDeviceId, validateHistoryPost } from "../../../lib/validateHistory";

export const runtime = "nodejs";

/** 保存。Supabase 未設定なら saved:false を返す（エラーにしない）。 */
export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "JSONとして読めませんでした" }, { status: 400 });
  }
  const v = validateHistoryPost(body);
  if (!v.ok) return Response.json({ error: v.error }, { status: 400 });
  if (!isConfigured()) return Response.json({ configured: false, saved: false });
  try {
    await insertHistory(v.value);
    return Response.json({ configured: true, saved: true });
  } catch (e) {
    return Response.json({ configured: true, saved: false, error: (e as Error).message }, { status: 502 });
  }
}

/** この端末(device_id)の履歴だけ返す。 */
export async function GET(req: Request) {
  const id = new URL(req.url).searchParams.get("device_id");
  if (!isDeviceId(id)) return Response.json({ error: "device_idが不正です" }, { status: 400 });
  if (!isConfigured()) return Response.json({ configured: false, items: [] });
  try {
    return Response.json({ configured: true, items: await listHistory(id) });
  } catch (e) {
    return Response.json({ configured: true, items: [], error: (e as Error).message }, { status: 502 });
  }
}
