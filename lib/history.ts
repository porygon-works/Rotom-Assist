/**
 * 認識履歴の保存先（Supabase の REST API を直接叩く。サーバ側専用）。
 * 環境変数: SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY（Vercel の環境変数に設定。コードには書かない）
 * 未設定なら保存せず、アプリはそのまま動く。
 */
export interface HistoryRow {
  device_id: string;
  kind: "utterance" | "event";
  text: string;
  note: string;
}
export interface StoredHistory {
  id: number;
  text: string;
  note: string;
  created_at: string;
}

/**
 * 1つのSupabaseプロジェクトを複数アプリで共有するため、アプリごとにスキーマを分ける。
 * 前提: Project Settings → Data API の「Exposed schemas」に rotom を追加済み（supabase/schema.sql 参照）。
 */
const SCHEMA = "rotom";
const TABLE = "history";

function cfg() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return url && key ? { url: url.replace(/\/$/, ""), key } : null;
}

export const isConfigured = () => cfg() !== null;

const headers = (key: string) => ({ apikey: key, Authorization: `Bearer ${key}`, "content-type": "application/json" });

export async function insertHistory(row: HistoryRow): Promise<void> {
  const c = cfg();
  if (!c) return;
  const res = await fetch(`${c.url}/rest/v1/${TABLE}`, {
    method: "POST",
    headers: { ...headers(c.key), "Content-Profile": SCHEMA, Prefer: "return=minimal" },
    body: JSON.stringify(row),
  });
  if (!res.ok) throw new Error(`Supabase insert failed: ${res.status}`);
}

export async function listHistory(deviceId: string, limit = 50): Promise<StoredHistory[]> {
  const c = cfg();
  if (!c) return [];
  const q = `device_id=eq.${encodeURIComponent(deviceId)}&kind=eq.utterance&order=created_at.desc&limit=${limit}&select=id,text,note,created_at`;
  const res = await fetch(`${c.url}/rest/v1/${TABLE}?${q}`, { headers: { ...headers(c.key), "Accept-Profile": SCHEMA } });
  if (!res.ok) throw new Error(`Supabase select failed: ${res.status}`);
  return (await res.json()) as StoredHistory[];
}
