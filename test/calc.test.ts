import { expect, test } from "vitest";
import { calc } from "../lib/calc";

const mimikyu = { pokemon: "Mimikyu" };
const garchomp = { pokemon: "Garchomp" };

test("日本語名と英語名で同じ結果になる", () => {
  const ja = calc({ attacker: { pokemon: "ブリジュラス" }, defender: { pokemon: "リザードン" }, move: "ラスターカノン" });
  const en = calc({ attacker: { pokemon: "Archaludon" }, defender: { pokemon: "Charizard" }, move: "Flash Cannon" });
  expect([ja.min, ja.max]).toEqual([en.min, en.max]);
});

// Showdown の計算機（Gen9 / Lv50 / 無振り・無補正・持ち物なし）での表示と照合するための基準値。
// 出典: 同じ @smogon/calc 由来の desc 文字列。Showdown 画面と見比べる手順は README 参照。
test("基準ケース: Mimikyu Play Rough vs Garchomp", () => {
  const r = calc({ attacker: mimikyu, defender: garchomp, move: "Play Rough" });
  expect(r.description).toBe("0 Atk Mimikyu Play Rough vs. 0 HP / 0 Def Garchomp: 98-116 (53.5 - 63.3%) -- guaranteed 2HKO");
  expect(r.koText).toBe("確定2発");
});

test("確定と言うのは全乱数でN発のときだけ（min×N >= HP）", () => {
  const r = calc({ attacker: mimikyu, defender: garchomp, move: "Play Rough" });
  expect(r.ko.kind).toBe("guaranteed");
  expect(r.min * r.ko.n).toBeGreaterThanOrEqual(r.hp);
  expect(r.min * (r.ko.n - 1)).toBeLessThan(r.hp);
});

test("乱数のケースは「確定」と言わない", () => {
  // Archaludon Flash Cannon vs Flutter Mane は min*2 < HP <= max*2 付近の乱数/確定どちらかを必ず整合させる
  const r = calc({ attacker: { pokemon: "Archaludon" }, defender: { pokemon: "Flutter Mane" }, move: "Flash Cannon" });
  if (r.ko.kind === "guaranteed") expect(r.min * r.ko.n).toBeGreaterThanOrEqual(r.hp);
  else expect(r.koText).not.toMatch(/^確定/);
  // 低火力: ほぼ必ず乱数 or 確定数なしになる組み合わせで乱数表記を確認
  const weak = calc({ attacker: mimikyu, defender: { pokemon: "Gholdengo" }, move: "Play Rough" });
  if (weak.ko.kind === "chance") {
    expect(weak.koText).toMatch(/^乱数\d発（\d+(\.\d)?%）$/);
    expect(weak.min * weak.ko.n).toBeLessThan(weak.hp);
  }
});

test("パラドックス種・メガシンカ持ち物を扱える", () => {
  expect(() => calc({ attacker: { pokemon: "Gouging Fire" }, defender: { pokemon: "Charizard", item: "Charizardite Y" }, move: "Dragon Claw" })).not.toThrow();
  expect(() => calc({ attacker: { pokemon: "Iron Valiant" }, defender: { pokemon: "Charizard" }, move: "Moonblast" })).not.toThrow();
});

test("前提条件が必ず含まれる", () => {
  const r = calc({ attacker: mimikyu, defender: garchomp, move: "Play Rough" });
  expect(r.assumptions.join()).toMatch(/努力値.*性格.*持ち物/s);
});

test("ダメージ0（無効）でも例外にならず「ダメージなし」", () => {
  const r = calc({ attacker: { pokemon: "Gouging Fire" }, defender: { pokemon: "Charizard" }, move: "Earthquake" });
  expect(r.max).toBe(0);
  expect(r.koText).toBe("ダメージなし");
});
