// ポケモンごとの特性の一覧（data/abilities.json）を作る。手元で実行し、結果をリポジトリに入れる（構成設計 10 章）
// 計算ライブラリ（@smogon/calc 第0世代）には特性が 1 つしか入っていないため、Showdown 本体の図鑑から全特性を取る
// 使い方: npx tsx scripts/build-abilities.ts <Showdown 本体の data/pokedex.ts>
//   https://github.com/smogon/pokemon-showdown/blob/master/data/pokedex.ts
// ファイルはプログラムとして実行せず、文字として読む（「ポケモン: {」と「abilities: {…}」の行だけ拾う）
import { readFileSync, writeFileSync } from "node:fs";
import { Generations } from "@smogon/calc";

const src = process.argv[2];
if (!src) throw new Error("pokedex.ts のパスを指定する");
const g = Generations.get(0 as never);
const toID = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
const inGame = new Set([...g.species].map((s) => toID(s.name)));

const out: Record<string, string[]> = {};
let current: string | null = null;
for (const line of readFileSync(src, "utf8").split("\n")) {
  const sp = line.match(/^\t([a-z0-9]+): \{/);
  if (sp) {
    current = sp[1];
    continue;
  }
  const ab = line.match(/^\t\tabilities: \{(.*)\},?$/);
  if (ab && current && inGame.has(current)) {
    out[current] = [...ab[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
  }
}
// 図鑑にない新しいフォルム（メガルカリオZ など）は、計算ライブラリの特性を使う
for (const s of g.species) {
  const id = toID(s.name);
  if (!out[id]) out[id] = Object.values((s as unknown as { abilities: Record<string, string> }).abilities ?? {});
}
writeFileSync(
  "data/abilities.json",
  JSON.stringify({ _source: "Pokémon Showdown data/pokedex.ts（なければ @smogon/calc 第0世代）。scripts/build-abilities.ts で生成", ...out }) + "\n",
);
console.log(`ポケモン ${Object.keys(out).length}`);
