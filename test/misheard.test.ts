import { describe, expect, it } from "vitest";
import { fixMishearing, MISHEARD } from "../lib/misheard";
import ruleWords from "../data/rule-words.json";

// data/misheard.json の 1 件ずつに書いた例（examples）を、アプリと同じ流れ（全部の行を順に当てる）で確かめる
describe("聞き間違いの表（data/misheard.json）", () => {
  for (const section of MISHEARD) {
    for (const r of section.rules) {
      it(`${section.title}: ${r.from} → ${r.to}`, () => {
        expect(() => new RegExp(r.from, "g")).not.toThrow();
        expect(Array.isArray(r.log)).toBe(true);
        expect(r.examples.length).toBeGreaterThan(0);
        for (const [heard, fixed] of r.examples) {
          expect(fixMishearing(heard)).toBe(fixed);
          // 2 回当てても変わらない（ルール解析は直した文をもう一度直す）
          expect(fixMishearing(fixed)).toBe(fixed);
        }
      });
    }
  }
  it("同じ from を 2 回書いていない", () => {
    const froms = MISHEARD.flatMap((s) => s.rules.map((r) => r.from));
    expect(new Set(froms).size).toBe(froms.length);
  });
});

describe("ルールの言い回し（data/rule-words.json）", () => {
  it("同じ語を 2 つの組に書いていない", () => {
    const words = ruleWords.groups.flatMap((g) => g.words);
    expect(words.filter((w, i) => words.indexOf(w) !== i)).toEqual([]);
  });
});
