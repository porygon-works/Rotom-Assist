// 回数制限（構成設計 11 章）: 無料枠を守るため、1 分あたりの回数に上限を付ける。サーバのメモリだけで数える簡易版
// （Vercel では関数のインスタンスごとに数えるので厳密ではない。他人の利用を防ぐ目的で、当面はこれで足りる）
const hits = new Map<string, number[]>();

export function allow(key: string, limit = 20, windowMs = 60_000, now = Date.now()): boolean {
  const list = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
  if (list.length >= limit) {
    hits.set(key, list);
    return false;
  }
  list.push(now);
  hits.set(key, list);
  if (hits.size > 1000) for (const [k, v] of hits) if (!v.some((t) => now - t < windowMs)) hits.delete(k);
  return true;
}
