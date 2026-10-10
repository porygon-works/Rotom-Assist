import { calc } from "../../../lib/calc";
import { validateCalcRequest } from "../../../lib/validate";

export const runtime = "nodejs";

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "JSONとして読めませんでした" }, { status: 400 });
  }
  const v = validateCalcRequest(body);
  if (!v.ok) return Response.json({ error: v.error }, { status: 400 });
  try {
    return Response.json(calc(v.value));
  } catch (e) {
    return Response.json({ error: `計算に失敗しました: ${(e as Error).message}` }, { status: 400 });
  }
}
