// 名前の解決（構成設計 7 章）: 日本語・英語・あだ名・聞き間違い → 計算ライブラリの英語名
// AI は名前を補正しない（指示文 v8）。知らない名前・聞き間違いは聞こえたままのカタカナで来るので、ここで読みの近さで照合する
import names from "../data/names.json";
import aliases from "../data/aliases.json";

export type NameKind = "pokemon" | "moves" | "items" | "abilities" | "types" | "natures";

export type Resolved =
  | { ok: true; en: string; ja: string; fuzzy: boolean; heard: string }
  /** notInGame: 実在するがチャンピオンズにいない（その日本語名） */
  | { ok: false; heard: string; candidates: string[]; notInGame?: string };

/** 正規化: 全角半角・ひらがなカタカナをそろえ、空白・記号を除く */
export function normalize(s: string): string {
  return s
    .normalize("NFKC")
    .replace(/[ぁ-ゖ]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 0x60))
    .replace(/[\s・･,、。.!?！？「」『』()（）]/g, "")
    .toLowerCase()
    // メガシンカの末尾の読み（メガルカリオゼット → メガルカリオz）
    .replace(/(ゼット|ゼッド)$/u, "z")
    .replace(/エックス$/u, "x")
    .replace(/ワイ$/u, "y");
}

/** 編集距離（文字単位） */
export function distance(a: string, b: string): number {
  if (Math.abs(a.length - b.length) > 3) return 99;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length];
}

interface Index {
  /** 正規化した名前（日本語・英語・あだ名）→ [英語名, 日本語の正式名] */
  exact: Map<string, [string, string]>;
  /** あいまい一致の対象（日本語の正式名だけ） */
  fuzzy: [string, string, string][]; // [正規化した日本語名, 英語名, 日本語名]。英語名が空ならチャンピオンズにいない
  /** チャンピオンズにいない名前（正規化）→ 日本語名 */
  others: Map<string, string>;
}

const table = names as unknown as Record<NameKind, Record<string, string>>;
const othersTable = (names as unknown as { others: Partial<Record<NameKind, string[]>> }).others;
const aliasTable = aliases as unknown as Record<string, Record<string, string>>;
const indexes = new Map<NameKind, Index>();

function index(kind: NameKind): Index {
  let ix = indexes.get(kind);
  if (ix) return ix;
  const exact = new Map<string, [string, string]>();
  const fuzzy: Index["fuzzy"] = [];
  const enToJa = new Map<string, string>();
  for (const [ja, en] of Object.entries(table[kind])) {
    exact.set(normalize(ja), [en, ja]);
    if (!enToJa.has(en)) enToJa.set(en, ja);
    fuzzy.push([normalize(ja), en, ja]);
  }
  for (const [en, ja] of enToJa) exact.set(normalize(en), [en, ja]);
  const others = new Map<string, string>();
  for (const ja of othersTable[kind] ?? []) {
    others.set(normalize(ja), ja);
    fuzzy.push([normalize(ja), "", ja]);
  }
  for (const [alias, ja] of Object.entries(aliasTable[kind] ?? {})) {
    const en = table[kind][ja];
    if (en) exact.set(normalize(alias), [en, ja]);
    else others.set(normalize(alias), ja);
  }
  ix = { exact, fuzzy, others };
  indexes.set(kind, ix);
  return ix;
}

/** あいまい一致で許す違いの文字数（短い名前ほど厳しく） */
const tolerance = (len: number) => (len <= 3 ? 0 : len <= 5 ? 1 : 2);

export function resolve(kind: NameKind, heard: string): Resolved {
  const key = normalize(heard);
  if (!key) return { ok: false, heard, candidates: [] };
  const ix = index(kind);
  const hit = ix.exact.get(key);
  if (hit) return { ok: true, en: hit[0], ja: hit[1], fuzzy: false, heard };
  const other = ix.others.get(key);
  if (other) return { ok: false, heard, candidates: [], notInGame: other };

  // 「ステロ込み」「スカーフ持ち」のような言い方の残りを落として再挑戦
  const trimmed = key.replace(/(込み|込|持ち|もち|持|型|入り)$/u, "");
  if (trimmed !== key && ix.exact.get(trimmed)) {
    const h = ix.exact.get(trimmed)!;
    return { ok: true, en: h[0], ja: h[1], fuzzy: false, heard };
  }

  let best = 99;
  let found: [string, string][] = [];
  for (const [n, en, ja] of ix.fuzzy) {
    const d = distance(key, n);
    if (d < best) [best, found] = [d, [[en, ja]]];
    else if (d === best && !found.some(([e]) => e === en)) found.push([en, ja]);
  }
  if (best <= tolerance(key.length)) {
    if (found.length === 1 && !found[0][0]) return { ok: false, heard, candidates: [], notInGame: found[0][1] };
    if (found.length === 1) return { ok: true, en: found[0][0], ja: found[0][1], fuzzy: true, heard };
    return { ok: false, heard, candidates: found.map(([, ja]) => ja).slice(0, 3) };
  }
  return { ok: false, heard, candidates: [] };
}

/** 天候・フィールド（data/aliases.json の呼び方 → 計算ライブラリの値） */
export function resolveField(kind: "weather" | "terrain", heard: string): string | undefined {
  const key = normalize(heard);
  for (const [k, v] of Object.entries(aliasTable[kind] ?? {})) if (normalize(k) === key) return v;
  // 「晴れ下」「エレキフィールド中」などの言い方
  for (const [k, v] of Object.entries(aliasTable[kind] ?? {})) if (key.includes(normalize(k))) return v;
  return undefined;
}

/** 英語名 → 日本語の正式名（表示用。なければ英語名のまま） */
export function toJa(kind: NameKind, en: string): string {
  for (const [ja, e] of Object.entries(table[kind])) if (e === en) return ja;
  return en;
}
