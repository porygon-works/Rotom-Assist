// AI の取り出し結果のポケモン名が、本当に質問の中にあるかを確かめる（ask_log #65・#89）
// AI は撃つ側を言っていないのに補ったり（「メガカイリューにつららおとし」→ 撃つ側カイリュー）、別のポケモンに置き換えたり
// （「メガヴォクシー」→ メガボーマンダ）することがある。質問の中に見当たらない名前は使わず、聞き返す
import aliases from "../data/aliases.json";
import { distance, normalize, reading, resolve } from "./resolve";

type Obj = Record<string, unknown>;
const aliasTable = (aliases as unknown as { pokemon: Record<string, string> }).pokemon;

interface Span {
  start: number;
  end: number;
  dist: number;
}

/** 読みの違いで許す数（短い名前ほど厳しく） */
const tol = (len: number) => (len <= 4 ? 0 : len <= 8 ? 1 : len <= 12 ? 2 : 3);

/** 名前（とそのあだ名）が質問のどこにあるか。読みの近さで探し、いちばん近い場所を返す */
export function findName(text: string, name: string): Span | undefined {
  const r = resolve("pokemon", name);
  const words = new Set([name]);
  if (r.ok) {
    words.add(r.ja);
    for (const [alias, ja] of Object.entries(aliasTable)) if (ja === r.ja) words.add(alias);
  }
  const t = reading(text);
  let best: Span | undefined;
  for (const w of words) {
    const k = reading(w);
    if (k.length < 2) {
      // 1 文字のあだ名（「株」= ガブ）はそのまま含まれているかだけを見る（場所は読みの外に置き、重なりの判定に使わない）
      if (normalize(text).includes(normalize(w))) best ??= { start: -100, end: -99, dist: 0 };
      continue;
    }
    for (let len = Math.max(1, k.length - 2); len <= k.length + 2; len++) {
      for (let start = 0; start + len <= t.length; start++) {
        const d = distance(t.slice(start, start + len), k);
        if (d > tol(k.length)) continue;
        // 近いほど・長いほどよい
        if (!best || d < best.dist || (d === best.dist && len > best.end - best.start)) best = { start, end: start + len, dist: d };
      }
    }
  }
  return best;
}

const overlap = (a: Span, b: Span) => a.start < b.end && b.start < a.end;

/**
 * 質問の中に見当たらないポケモン名を取り除き、聞き返しにする。
 * 撃つ側と受ける側が同じ場所を指しているとき（「メガカイリュー」の中の「カイリュー」）は、短い方を取り除く
 */
export function dropUnmentioned(text: string, ex: Obj): Obj {
  if (ex.uses_context === true) return ex; // 前の質問の名前を使っている
  const out: Obj = { ...ex };
  const spans: Partial<Record<"attacker" | "defender" | "pokemon", Span>> = {};
  const missing = new Set<string>(Array.isArray(ex.missing) ? (ex.missing as string[]) : []);
  for (const k of ["attacker", "defender", "pokemon"] as const) {
    const name = ex[k];
    if (typeof name !== "string" || !name.trim()) continue;
    const s = findName(text, name);
    if (s) spans[k] = s;
    else {
      delete out[k];
      missing.add(k);
    }
  }
  if (spans.attacker && spans.defender && overlap(spans.attacker, spans.defender)) {
    const drop = spans.attacker.end - spans.attacker.start < spans.defender.end - spans.defender.start ? "attacker" : "defender";
    delete out[drop];
    missing.add(drop);
  }
  if (!missing.size || (missing.size === (Array.isArray(ex.missing) ? ex.missing.length : 0))) return out;
  return { ...out, intent: out.intent === "damage" || out.intent === "speed" ? "clarify" : out.intent, missing: [...missing] };
}
