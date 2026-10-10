import type { HistoryRow } from "./history";

const DEVICE_ID = /^[A-Za-z0-9-]{16,64}$/;
const MAX_TEXT = 500;

export const isDeviceId = (v: unknown): v is string => typeof v === "string" && DEVICE_ID.test(v);

export function validateHistoryPost(body: unknown): { ok: true; value: HistoryRow } | { ok: false; error: string } {
  if (typeof body !== "object" || body === null) return { ok: false, error: "JSONオブジェクトを送ってください" };
  const b = body as Record<string, unknown>;
  if (!isDeviceId(b.device_id)) return { ok: false, error: "device_idが不正です" };
  if (b.kind !== "utterance" && b.kind !== "event") return { ok: false, error: "kindが不正です" };
  if (typeof b.text !== "string" || !b.text.trim()) return { ok: false, error: "textが空です" };
  const note = b.note === undefined ? "" : b.note;
  if (typeof note !== "string") return { ok: false, error: "noteは文字列です" };
  return {
    ok: true,
    value: { device_id: b.device_id, kind: b.kind, text: b.text.slice(0, MAX_TEXT), note: note.slice(0, MAX_TEXT) },
  };
}
