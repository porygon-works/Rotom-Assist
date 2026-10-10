import { expect, test } from "vitest";
import { calc } from "../src/calc.js";

test("日本語名と英語名で同じ結果になる", () => {
  const ja = calc({ attacker: { pokemon: "ブリジュラス" }, defender: { pokemon: "リザードン" }, move: "ラスターカノン" });
  const en = calc({ attacker: { pokemon: "Archaludon" }, defender: { pokemon: "Charizard" }, move: "Flash Cannon" });
  expect(ja.min).toBe(en.min);
  expect(ja.max).toBe(en.max);
});

test("範囲・確定数・前提が返る", () => {
  const r = calc({ attacker: { pokemon: "Archaludon" }, defender: { pokemon: "Flutter Mane" }, move: "Flash Cannon" });
  expect(r.max).toBeGreaterThanOrEqual(r.min);
  expect(r.assumptions.length).toBeGreaterThan(0);
  expect(r.koText).not.toBe("");
});

test("パラドックス種・メガシンカ持ち物を扱える", () => {
  expect(() => calc({ attacker: { pokemon: "Iron Valiant" }, defender: { pokemon: "Charizard", item: "Charizardite Y" }, move: "Moonblast" })).not.toThrow();
});
