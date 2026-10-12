// 技・特性の説明文（data/move-desc.json、data/ability-desc.json）を作る。手元で実行し、結果をリポジトリに入れる（構成設計 10 章）
// 元は Pokémon Showdown の説明文（英語の shortDesc）。日本語の説明文の公開データがないため、AI で日本語にする（機械翻訳。名前・用語は表で渡す）
// 使い方: npx tsx scripts/build-descriptions.ts <Showdown 本体の data/text/moves.ts> <data/text/abilities.ts>
//   https://github.com/smogon/pokemon-showdown/blob/master/data/text/moves.ts
// ファイルはプログラムとして実行せず、文字として読む（「id: {」と、その直下の shortDesc の行だけ拾う）
// 必要な環境変数: GROQ_API_KEY または GEMINI_API_KEY。既に訳したものは訳し直さない（足りない分だけ訳す）
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import names from "../data/names.json";
import { callJson, providersFromEnv } from "../lib/llm";

const [movesSrc, abilitiesSrc] = process.argv.slice(2);
if (!movesSrc || !abilitiesSrc) throw new Error("moves.ts と abilities.ts のパスを指定する");
const toID = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/** id → 英語の短い説明（世代別の上書き gen8: {…} の中は見ない） */
function readShortDesc(path: string): Map<string, string> {
  const out = new Map<string, string>();
  let current: string | null = null;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const head = line.match(/^\t([a-z0-9]+): \{/);
    if (head) {
      current = head[1];
      continue;
    }
    const d = line.match(/^\t\tshortDesc: "(.*)",$/);
    if (d && current && !out.has(current)) out.set(current, d[1].replace(/\\"/g, '"'));
  }
  return out;
}

const table = names as unknown as Record<string, Record<string, string>>;
/** 英語名 → 日本語名（技・特性・道具・タイプ・ポケモン）。説明文に出てくる名前を訳語として渡す */
const glossary = new Map<string, string>();
for (const kind of ["moves", "abilities", "items", "types", "pokemon"]) {
  for (const [ja, en] of Object.entries(table[kind] ?? {})) if (!glossary.has(en)) glossary.set(en, ja);
}

const PROMPT = `あなたはポケモン対戦の用語に詳しい翻訳者です。Pokémon Showdown の技・特性の短い説明（英語）を、日本語の対戦用語で短く訳します。
- 入力は {"id": "英語の説明"} の JSON。出力も同じキーで {"id": "日本語の説明"} の JSON だけを返す
- 1 文〜2 文。です・ます調は使わず、「〜する」「〜になる」の常体で書く。読み上げるので記号（×、%）は「倍」「パーセント」に直す
- 用語: Attack=こうげき、Defense=ぼうぎょ、Sp. Atk=とくこう、Sp. Def=とくぼう、Speed=すばやさ、accuracy=命中率、evasiveness=回避率、HP=HP、stage=段階、priority=優先度、critical hit=急所、burn=やけど、paralysis=まひ、poison=どく、badly poisoned=もうどく、sleep=ねむり、freeze=こおり、confusion=こんらん、flinch=ひるみ、switch out=交代、the user / this Pokemon=自分、the target=相手、adjacent Pokemon=周りのポケモン、foe=相手、ally=味方、contact=接触、Sun=晴れ、Rain=雨、Sandstorm=すなあらし、Snow=雪、Electric/Grassy/Misty/Psychic Terrain=エレキ/グラス/ミスト/サイコフィールド、Trick Room=トリックルーム、Protect=まもる、max HP=最大HP、held item=持ち物、Dynamax（ダイマックス）や Z-Move の説明は省く
- 名前は渡された訳語表の日本語名を使う。表にない名前は英語のまま残さず、カタカナにする
- 意味を足したり省いたりしない。数値はそのまま`;

async function translate(entries: [string, string][]): Promise<Record<string, string>> {
  const used = new Map<string, string>();
  for (const [, en] of entries) for (const [e, j] of glossary) if (e.length > 2 && en.includes(e)) used.set(e, j);
  const messages = [
    { role: "system", content: PROMPT },
    { role: "user", content: `訳語表: ${JSON.stringify(Object.fromEntries(used))}\n\n${JSON.stringify(Object.fromEntries(entries))}` },
  ];
  // 翻訳は質を優先: Groq（gpt-oss-120b）→ Gemini の順。急がないので長く待つ
  const providers = providersFromEnv().sort((a, b) => (a.name.startsWith("groq") ? -1 : 0) - (b.name.startsWith("groq") ? -1 : 0));
  const r = await callJson(messages, { providers, timeoutMs: 60_000, lastTimeoutMs: 90_000 });
  if (!r.json) throw new Error(`翻訳に失敗: ${r.attempts.map((a) => `${a.provider} ${a.error}`).join(" / ")}`);
  return r.json as Record<string, string>;
}

async function build(kind: "moves" | "abilities", src: string, outPath: string) {
  const en = readShortDesc(src);
  const out: Record<string, { en: string; ja: string } | string> = existsSync(outPath) ? JSON.parse(readFileSync(outPath, "utf8")) : {};
  out._source = "Pokémon Showdown data/text の shortDesc（英語）を AI で日本語にしたもの（機械翻訳）。scripts/build-descriptions.ts で生成";
  const todo: [string, string][] = [];
  for (const enName of new Set(Object.values(table[kind]))) {
    const d = en.get(toID(enName));
    const prev = out[enName];
    if (!d) continue;
    if (typeof prev === "object" && prev.en === d && prev.ja) continue;
    todo.push([enName, d]);
  }
  console.log(`${kind}: ${todo.length} 件を訳す`);
  for (let i = 0; i < todo.length; i += 40) {
    const batch = todo.slice(i, i + 40);
    const ja = await translate(batch);
    for (const [k, d] of batch) if (typeof ja[k] === "string" && ja[k].trim()) out[k] = { en: d, ja: ja[k].trim() };
    writeFileSync(outPath, JSON.stringify(out, null, 1) + "\n");
    console.log(`  ${Math.min(i + 40, todo.length)} / ${todo.length}`);
  }
}

(async () => {
  await build("abilities", abilitiesSrc, "data/ability-desc.json");
  await build("moves", movesSrc, "data/move-desc.json");
})();
