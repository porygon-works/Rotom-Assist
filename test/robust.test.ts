// ルール解析の取り違えを、全ポケモン名で機械的に確かめる（聞き間違いの推測・言い直しの読み飛ばしで、助詞を名前に吸わせない・別のポケモンにしない）
import { describe, expect, it } from "vitest";
import names from "../data/names.json";
import { resolve } from "../lib/resolve";
import { parseRules } from "../lib/rules";

const POKEMON = Object.keys((names as unknown as { pokemon: Record<string, string> }).pokemon);
const canon = (x: unknown) => {
  if (typeof x !== "string") return x;
  const r = resolve("pokemon", x);
  return r.ok ? r.ja : x;
};
const phrases = (p: string) =>
  [
    [`ガブリアスのじしんを${p}耐えれる`, "defender"],
    [`${p}のじしんでガブリアス何発`, "attacker"],
    [`${p}ってなにが弱点`, "pokemon"],
    [`ガブリアスと${p}どっちが速い`, "defender"],
  ] as const;

describe("ルール解析の取り違え（全ポケモン）", () => {
  it("正式名をよくある言い方に入れたら、そのポケモンとして読む（答えないのはよいが、別のポケモンにはしない）", () => {
    const wrong: string[] = [];
    for (const p of POKEMON)
      for (const [q, k] of phrases(p)) {
        const o = parseRules(q);
        if (o && canon(o[k]) !== p) wrong.push(`${q} → ${JSON.stringify(o[k])}`);
      }
    expect(wrong).toEqual([]);
  }, 60_000);

  it("名前を崩して（伸ばす音・促音を抜く、小さい字を大きく、濁点のゆれ）も別のポケモンにしない（崩した結果が別の実在の名前になるものは除く）", () => {
    const BIG: Record<string, string> = { ャ: "ヤ", ュ: "ユ", ョ: "ヨ", ァ: "ア", ィ: "イ", ゥ: "ウ", ェ: "エ", ォ: "オ" };
    const noises = [
      (s: string) => s.replace(/ー/, ""),
      (s: string) => s.replace(/(?<=[オコソトノホモヨロゴゾドボポョ])ー/, "ウ"),
      (s: string) => s.replace(/ッ/, ""),
      (s: string) => s.replace(/[ャュョァィゥェォ]/, (c) => BIG[c]),
      (s: string) => s.replace(/[ガギグゲゴダデドバビブベボ]/, (c) => String.fromCharCode(c.charCodeAt(0) - 1)),
    ];
    const others = (names as unknown as { others: { pokemon?: string[] } }).others.pokemon ?? [];
    const real = new Set([...POKEMON, ...others]);
    const wrong: string[] = [];
    for (const p of POKEMON)
      for (const f of noises) {
        const h = f(p);
        if (h === p || real.has(h)) continue;
        for (const [q, k] of phrases(h).slice(0, 1)) {
          const o = parseRules(q);
          if (o && canon(o[k]) !== p) wrong.push(`${q} → ${JSON.stringify(o[k])}`);
        }
      }
    expect(wrong).toEqual([]);
  }, 60_000);
});
