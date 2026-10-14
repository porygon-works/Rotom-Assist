// 今動いている版（Vercel のコミット）。開いたままの画面が、新しい版が出たかを確かめる（app/useAutoUpdate.ts）
export const dynamic = "force-dynamic";

export function GET() {
  return Response.json({ commit: process.env.VERCEL_GIT_COMMIT_SHA ?? "" }, { headers: { "Cache-Control": "no-store" } });
}
