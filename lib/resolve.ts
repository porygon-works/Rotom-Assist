// 名前の解決（構成設計 7 章）: 日本語・英語・あだ名・聞き間違い → 計算ライブラリの英語名
// AI は名前を補正しない（指示文 v8）。知らない名前・聞き間違いは聞こえたままのカタカナで来るので、ここで読みの近さで照合する
import names from "../data/names.json";
import aliases from "../data/aliases.json";
import readings from "../data/readings.json";

export type NameKind = "pokemon" | "moves" | "items" | "abilities" | "types" | "natures";

export type Resolved =
  /** dist: あいまい一致のときの違いの大きさ（文字か読みの違いの数） */
  | { ok: true; en: string; ja: string; fuzzy: boolean; heard: string; dist?: number }
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

// ---- 読みの比較（聞き間違い・言い間違い用）----
// カタカナのままだと「ミミック」と「ミミッキュ」は 2 文字違い（ク→キ、ュ を足す）だが、読みでは mimiku と mimikyu で 1 文字違い。
// 小さい字・伸ばす音・促音・「オウ/オー」の違いを読みでそろえ、音の近さで比べる

const KANA: Record<string, string> = {};
{
  const rows: [string, string[]][] = [
    ["アイウエオ", ["a", "i", "u", "e", "o"]], ["カキクケコ", ["ka", "ki", "ku", "ke", "ko"]], ["ガギグゲゴ", ["ga", "gi", "gu", "ge", "go"]],
    ["サシスセソ", ["sa", "si", "su", "se", "so"]], ["ザジズゼゾ", ["za", "zi", "zu", "ze", "zo"]], ["タチツテト", ["ta", "ti", "tu", "te", "to"]],
    ["ダヂヅデド", ["da", "zi", "zu", "de", "do"]], ["ナニヌネノ", ["na", "ni", "nu", "ne", "no"]], ["ハヒフヘホ", ["ha", "hi", "hu", "he", "ho"]],
    ["バビブベボ", ["ba", "bi", "bu", "be", "bo"]], ["パピプペポ", ["pa", "pi", "pu", "pe", "po"]], ["マミムメモ", ["ma", "mi", "mu", "me", "mo"]],
    ["ヤユヨ", ["ya", "yu", "yo"]], ["ラリルレロ", ["ra", "ri", "ru", "re", "ro"]], ["ワヲン", ["wa", "o", "n"]], ["ァィゥェォャュョヮ", ["a", "i", "u", "e", "o", "ya", "yu", "yo", "wa"]],
    ["ヴ", ["bu"]],
  ];
  for (const [chars, rs] of rows) [...chars].forEach((c, i) => (KANA[c] = rs[i]));
}
const READINGS = Object.entries(readings as Record<string, string>)
  .filter(([k]) => !k.startsWith("_"))
  .sort((a, b) => b[0].length - a[0].length);

/** 読み（ローマ字に近い形）。漢字は data/readings.json の読みに置き換え、小さい字は前の音に付け、促音・伸ばす音は落とす */
export function reading(s: string): string {
  let k = normalize(s);
  for (const [kanji, kana] of READINGS) k = k.split(kanji).join(kana);
  let out = "";
  const chars = [...k];
  for (let i = 0; i < chars.length; i++) {
    const c = chars[i];
    if (c === "ッ" || c === "ー" || c === "~" || c === "〜") continue;
    const r = KANA[c];
    if (r === undefined) {
      out += c; // 英字・数字・読みの分からない漢字はそのまま
      continue;
    }
    // 小さい字は前の音の母音を置き換える（キュ → kyu、シャ → sya、ファ → ha、ティ → ti）
    const next = chars[i + 1];
    if (next && "ャュョァィゥェォヮ".includes(next)) {
      out += r.slice(0, -1) + KANA[next];
      i++;
      continue;
    }
    out += r;
  }
  // 長音のゆれ（オウ/オオ → o、エイ → e、ウウ → u）、同じ母音の連続
  return out.replace(/ou/g, "o").replace(/oo/g, "o").replace(/ei/g, "e").replace(/uu/g, "u").replace(/aa/g, "a").replace(/ii/g, "i");
}

interface Index {
  /** 正規化した名前（日本語・英語・あだ名）→ [英語名, 日本語の正式名] */
  exact: Map<string, [string, string]>;
  /** あいまい一致の対象（日本語の正式名だけ） */
  fuzzy: [string, string, string, string][]; // [正規化した日本語名, 英語名, 日本語名, 読み]。英語名が空ならチャンピオンズにいない
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
    fuzzy.push([normalize(ja), en, ja, reading(ja)]);
  }
  for (const [en, ja] of enToJa) exact.set(normalize(en), [en, ja]);
  const others = new Map<string, string>();
  for (const ja of othersTable[kind] ?? []) {
    others.set(normalize(ja), ja);
    fuzzy.push([normalize(ja), "", ja, reading(ja)]);
  }
  for (const [alias, ja] of Object.entries(aliasTable[kind] ?? {})) {
    const en = table[kind][ja];
    if (en) exact.set(normalize(alias), [en, ja]);
    else others.set(normalize(alias), ja);
    // あだ名も読みの比較の対象にする（「ガブ」の聞き間違いなど）。短いあだ名は誤りやすいので 4 文字以上だけ
    if (normalize(alias).length >= 4) fuzzy.push([normalize(alias), en ?? "", ja, reading(alias)]);
  }
  ix = { exact, fuzzy, others };
  indexes.set(kind, ix);
  return ix;
}

/** あいまい一致で許す違いの文字数（短い名前ほど厳しく） */
const tolerance = (len: number) => (len <= 3 ? 0 : len <= 5 ? 1 : 2);
/** 読み（ローマ字）で許す違いの文字数。ローマ字はカタカナの約 2 倍の長さ */
const readingTolerance = (len: number) => (len <= 4 ? 0 : len <= 9 ? 1 : 2);

/**
 * チャンピオンズにいない名前を、その名前を含むチャンピオンズのポケモンに置き換える（ヒドイデ → ドヒドイデ、リザード → リザードン）。
 * メガシンカを除いて 1 つに決まるときだけ。言い間違い・聞き間違いで進化前の名前になることが多いため
 */
function evolvedInGame(kind: NameKind, ix: Index, ja: string, heard: string): Resolved | undefined {
  if (kind !== "pokemon") return undefined;
  const n = normalize(ja);
  const found = new Map<string, string>();
  for (const [norm, en, name] of ix.fuzzy) if (en && norm !== n && norm.includes(n) && !norm.startsWith("メガ")) found.set(en, name);
  if (found.size !== 1) return undefined;
  const [[en, name]] = [...found];
  return { ok: true, en, ja: name, fuzzy: true, heard, dist: 1 };
}

export function resolve(kind: NameKind, heard: string): Resolved {
  const key = normalize(heard);
  if (!key) return { ok: false, heard, candidates: [] };
  const ix = index(kind);
  const hit = ix.exact.get(key);
  if (hit) return { ok: true, en: hit[0], ja: hit[1], fuzzy: false, heard };
  const other = ix.others.get(key);
  if (other) return evolvedInGame(kind, ix, other, heard) ?? { ok: false, heard, candidates: [], notInGame: other };

  // 「ステロ込み」「スカーフ持ち」のような言い方の残りを落として再挑戦
  const trimmed = key.replace(/(込み|込|持ち|もち|持|型|入り)$/u, "");
  if (trimmed !== key && ix.exact.get(trimmed)) {
    const h = ix.exact.get(trimmed)!;
    return { ok: true, en: h[0], ja: h[1], fuzzy: false, heard };
  }

  // 文字の違いと読みの違いのうち、小さい方で比べる（「ミミック」→ミミッキュ、「サーフ号」→サーフゴー）
  const rk = reading(heard);
  let best = 99;
  let found: [string, string][] = [];
  for (const [n, en, ja, r] of ix.fuzzy) {
    const d = Math.min(distance(key, n) <= tolerance(key.length) ? distance(key, n) : 99, distance(rk, r) <= readingTolerance(rk.length) ? distance(rk, r) : 99);
    if (d === 99) continue;
    if (d < best) [best, found] = [d, [[en, ja]]];
    else if (d === best && !found.some(([e, j]) => (e || j) === (en || ja))) found.push([en, ja]);
  }
  if (best < 99) {
    if (found.length === 1 && !found[0][0]) return evolvedInGame(kind, ix, found[0][1], heard) ?? { ok: false, heard, candidates: [], notInGame: found[0][1] };
    if (found.length === 1) return { ok: true, en: found[0][0], ja: found[0][1], fuzzy: true, heard, dist: best };
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
