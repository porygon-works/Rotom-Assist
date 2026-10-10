import { afterEach, expect, test, vi } from "vitest";
import { GET, POST } from "../app/api/history/route";
import { validateHistoryPost } from "../lib/validateHistory";
import { extractAfterWakeWord } from "../lib/wakeword";

const ID = "11111111-2222-3333-4444-555555555555";
const post = (b: unknown) => POST(new Request("http://x/api/history", { method: "POST", body: JSON.stringify(b) }));
const get = (id: string) => GET(new Request(`http://x/api/history?device_id=${id}`));

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

test("入力検証", () => {
  expect(validateHistoryPost({ device_id: ID, kind: "utterance", text: "a", note: "b" }).ok).toBe(true);
  expect(validateHistoryPost({ device_id: "short", kind: "utterance", text: "a" }).ok).toBe(false);
  expect(validateHistoryPost({ device_id: ID, kind: "x", text: "a" }).ok).toBe(false);
  expect(validateHistoryPost({ device_id: ID, kind: "event", text: " " }).ok).toBe(false);
  const long = validateHistoryPost({ device_id: ID, kind: "event", text: "a".repeat(9999) });
  expect(long.ok && long.value.text.length).toBe(500);
});

test("Supabase未設定でもエラーにならない", async () => {
  vi.stubEnv("SUPABASE_URL", "");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");
  expect(await (await post({ device_id: ID, kind: "utterance", text: "a" })).json()).toMatchObject({ configured: false, saved: false });
  expect(await (await get(ID)).json()).toEqual({ configured: false, items: [] });
});

test("設定済みならSupabaseのRESTに保存・取得する（キーはサーバ側ヘッダのみ）", async () => {
  vi.stubEnv("SUPABASE_URL", "https://example.supabase.co/");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "test-key");
  const calls: { url: string; init?: RequestInit }[] = [];
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    return init?.method === "POST" ? new Response(null, { status: 201 }) : Response.json([{ id: 1, text: "t", note: "n", created_at: "2026-01-01T00:00:00Z" }]);
  });
  expect((await (await post({ device_id: ID, kind: "utterance", text: "ダメ計", note: "n" })).json()).saved).toBe(true);
  expect((await (await get(ID)).json()).items).toHaveLength(1);
  expect(calls[0].url).toBe("https://example.supabase.co/rest/v1/rotom_history");
  expect((calls[0].init!.headers as Record<string, string>).apikey).toBe("test-key");
  expect(calls[1].url).toContain(`device_id=eq.${ID}`);
  expect((await get("bad")).status).toBe(400);
});

test("Supabaseが失敗したら502で返し、キーは漏らさない", async () => {
  vi.stubEnv("SUPABASE_URL", "https://example.supabase.co");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "secret-xyz");
  vi.stubGlobal("fetch", async () => new Response("denied secret-xyz", { status: 401 }));
  const res = await post({ device_id: ID, kind: "utterance", text: "a" });
  expect(res.status).toBe(502);
  expect(JSON.stringify(await res.json())).not.toContain("secret-xyz");
});

test("合言葉の聞き違い候補も拾う", () => {
  expect(extractAfterWakeWord("ダメ計算 ガブリアスに").rest).toBe("ガブリアスに");
  for (const t of ["ダメージ計算 ガブリアスに", "だめ経 ガブリアスに", "ダメ経ガブリアスに"]) {
    expect(extractAfterWakeWord(t).found, t).toBe(true);
  }
});
