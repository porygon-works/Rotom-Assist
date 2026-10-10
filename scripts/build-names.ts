// 日本語名の対応表（data/names.json）を作る。手元で実行し、結果をリポジトリに入れる（構成設計 10 章）
// 使い方: npx tsx scripts/build-names.ts <PokeAPI の CSV を置いたフォルダ>
//   CSV: https://github.com/PokeAPI/pokeapi/tree/master/data/v2/csv の
//        pokemon_species(_names) / moves・move_names / items・item_names / abilities・ability_names / types・type_names / natures・nature_names
// 対象は @smogon/calc 第0世代（チャンピオンズ）にいるポケモン・わざ・持ち物と、全特性
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Generations } from "@smogon/calc";

const dir = process.argv[2];
if (!dir) throw new Error("CSV のフォルダを指定する");

function csv(name: string): string[][] {
  return readFileSync(join(dir, `${name}.csv`), "utf8").trim().split("\n").slice(1).map((l) => l.split(","));
}
/** identifier → 日本語名（言語 1 = ja-Hrkt。なければ 11 = ja） */
function jaTable(base: string, names: string): Map<string, string> {
  const id2ident = new Map(csv(base).map((r) => [r[0], r[1]]));
  const best = new Map<string, [number, string]>();
  for (const [id, lang, name] of csv(names)) {
    const rank = lang === "1" ? 2 : lang === "11" ? 1 : 0;
    if (!rank) continue;
    const ident = id2ident.get(id);
    if (ident && (best.get(ident)?.[0] ?? 0) < rank) best.set(ident, [rank, name]);
  }
  return new Map([...best].map(([k, [, v]]) => [k, v]));
}
const ident = (en: string) => en.toLowerCase().replace(/[’'.:]/g, "").replace(/\s+/g, "-").replace(/-+/g, "-");

const g = Generations.get(0 as never);
const speciesJa = jaTable("pokemon_species", "pokemon_species_names");
const movesJa = jaTable("moves", "move_names");
const itemsJa = jaTable("items", "item_names");
const abilitiesJa = jaTable("abilities", "ability_names");

const ROTOM: Record<string, string> = { Wash: "ウォッシュロトム", Heat: "ヒートロトム", Frost: "フロストロトム", Fan: "スピンロトム", Mow: "カットロトム" };
const REGION: Record<string, string> = { Alola: "アローラ", Galar: "ガラル", Hisui: "ヒスイ", Paldea: "パルデア" };
const FORME: Record<string, string> = {
  F: "メス", Blade: "ブレード", Shield: "シールド", Both: "シールド・ブレード", Rainy: "あまみず", Snowy: "ゆきぐも", Sunny: "たいよう",
  Eternal: "えいえん", Large: "おおきい", Small: "ちいさい", Super: "とくだい", Dusk: "たそがれ", Midnight: "まよなか",
  Four: "4ひきかぞく", Busted: "ばれた", Hangry: "はらぺこ", Hero: "マイティ", Antique: "しんさく", Masterpiece: "けっさく",
  Blue: "ブルー", White: "ホワイト", Yellow: "イエロー", "Low-Key": "ローな", Fancy: "ファンシー", Pokeball: "モンスターボール",
  Aqua: "ウォーター", Blaze: "ブレイズ", Combat: "コンバット",
};

const pokemon: Record<string, string> = {};
const missing: string[] = [];
for (const s of g.species) {
  // baseSpecies が入っていないフォルム（Aegislash-Blade など）は、最初の「-」の前を元のポケモンとみなす
  let base = (s as { baseSpecies?: string }).baseSpecies ?? s.name;
  if (!speciesJa.has(ident(base)) && s.name.includes("-") && speciesJa.has(ident(s.name.split("-")[0]))) base = s.name.split("-")[0];
  const baseJa = speciesJa.get(ident(base));
  if (!baseJa) {
    missing.push(s.name);
    continue;
  }
  const forme = s.name === base ? "" : s.name.slice(base.length + 1);
  let ja: string;
  const mega = forme.match(/^(?:([MF])-)?Mega(?:-([XYZ]))?$/);
  if (!forme) ja = baseJa;
  else if (mega) ja = `メガ${baseJa}${mega[2] ?? ""}${mega[1] === "F" ? "（メス）" : ""}`;
  else if (base === "Rotom" && ROTOM[forme]) ja = ROTOM[forme];
  else if (REGION[forme.split("-")[0]]) {
    const [r, sub] = forme.split("-");
    ja = `${REGION[r]}${baseJa}${sub ? `（${FORME[sub] ?? sub}）` : ""}`;
  } else ja = `${baseJa}（${FORME[forme] ?? forme}）`;
  pokemon[ja] = s.name;
}

function table(list: Iterable<{ name: string }>, ja: Map<string, string>, kind: string) {
  const out: Record<string, string> = {};
  for (const x of list) {
    if (x.name === "(No Move)") continue;
    const j = ja.get(ident(x.name));
    if (j) out[j] = x.name;
    else missing.push(`${kind}:${x.name}`);
  }
  return out;
}
const moves = table(g.moves, movesJa, "move");
const items = table(g.items, itemsJa, "item");
// 特性は計算ライブラリの一覧が不完全（データ調査 1 章）なので、PokeAPI の全特性を英語名に直して使う
const abilities: Record<string, string> = {};
const abilityIdent = new Map(csv("abilities").map((r) => [r[1], r[1]]));
for (const [identifier, ja] of abilitiesJa) {
  if (!abilityIdent.has(identifier)) continue;
  abilities[ja] = identifier.split("-").map((w) => w[0].toUpperCase() + w.slice(1)).join(" ");
}

// タイプ（第0世代の 18 タイプ。??? と Stellar は除く）
const typesJa = jaTable("types", "type_names");
const types: Record<string, string> = {};
for (const t of g.types) {
  const j = typesJa.get(ident(t.name));
  if (j && t.name !== "???" && t.name !== "Stellar") types[j] = t.name;
}

// 性格（上がる・下がる能力は計算ライブラリ側が持つ）
const naturesJa = jaTable("natures", "nature_names");
const natures: Record<string, string> = {};
for (const n of g.natures) {
  const j = naturesJa.get(ident(n.name));
  if (j) natures[j] = n.name;
}

// チャンピオンズにいないもの（「〇〇はチャンピオンズにいないロト」と答えるため）。持ち物は数が多いので、あだ名の表にあるものだけ
const inGame = (m: Record<string, string>) => new Set(Object.keys(m));
const others = {
  pokemon: [...speciesJa.values()].filter((j) => !inGame(pokemon).has(j)),
  moves: [...movesJa.values()].filter((j) => !inGame(moves).has(j)),
  items: [...itemsJa.values()].filter((j) => !inGame(items).has(j) && /^(こだわり|とつげき|ブーストエナジー|じゃくてんほけん|ふうせん|かえんだま|どくどくだま|オボンのみ|ラムのみ|あついいわ|しめったいわ|ひかりのねんど)/.test(j)),
};

const out = {
  _source: "PokeAPI CSV（日本語名）＋ @smogon/calc 第0世代（チャンピオンズの一覧）。scripts/build-names.ts で生成",
  pokemon, moves, items, abilities, types, natures,
  others,
};
writeFileSync("data/names.json", JSON.stringify(out, null, 1) + "\n");
console.log(`ポケモン ${Object.keys(pokemon).length}、わざ ${Object.keys(moves).length}、持ち物 ${Object.keys(items).length}、特性 ${Object.keys(abilities).length}`);
console.log(`日本語名がないもの ${missing.length}: ${missing.join(", ")}`);
