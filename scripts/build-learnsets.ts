// 覚える技のデータ（data/learnsets.json）を作る。手元で実行し、結果をリポジトリに入れる（構成設計 10 章）
// 使い方: npx tsx scripts/build-learnsets.ts <Showdown 本体の data/mods/champions/learnsets.ts>
//   https://github.com/smogon/pokemon-showdown/blob/master/data/mods/champions/learnsets.ts
// ファイルはプログラムとして実行せず、文字として読む（「ポケモン: {」と「わざ: [」の行だけ拾う）
import { readFileSync, writeFileSync } from "node:fs";

const src = process.argv[2];
if (!src) throw new Error("learnsets.ts のパスを指定する");
const out: Record<string, string[]> = {};
let current: string | null = null;
for (const line of readFileSync(src, "utf8").split("\n")) {
  const sp = line.match(/^\t([a-z0-9]+): \{/);
  if (sp) {
    current = sp[1];
    out[current] = [];
    continue;
  }
  const mv = line.match(/^\t\t\t([a-z0-9]+): \[/);
  if (mv && current) out[current].push(mv[1]);
}
for (const k of Object.keys(out)) if (!out[k].length) delete out[k];
writeFileSync(
  "data/learnsets.json",
  JSON.stringify({ _source: "Pokémon Showdown data/mods/champions/learnsets.ts（scripts/build-learnsets.ts で生成）", ...out }) + "\n",
);
console.log(`ポケモン ${Object.keys(out).length}、わざの延べ数 ${Object.values(out).reduce((a, b) => a + b.length, 0)}`);
