import { expect, test } from "vitest";
import { parseQuestion } from "../lib/parse";
import { entries } from "../lib/names";
import { Generations, toID } from "@smogon/calc";

test("例文: ガブリアスにミミッキュのじゃれつく", () => {
  const r = parseQuestion("ガブリアスにミミッキュのじゃれつく");
  expect(r).toMatchObject({ ok: true, attacker: { ja: "ミミッキュ", en: "Mimikyu" }, defender: { ja: "ガブリアス", en: "Garchomp" }, move: { en: "Play Rough" } });
});
test("語順違い: ミミッキュのじゃれつくをガブリアスに", () => {
  const r = parseQuestion("ミミッキュのじゃれつくをガブリアスに");
  expect(r).toMatchObject({ ok: true, attacker: { en: "Mimikyu" }, defender: { en: "Garchomp" } });
});
test("ブリジュラス(Archaludon)を含む", () => {
  const r = parseQuestion("ハバタクカミにブリジュラスのラスターカノン");
  expect(r).toMatchObject({ ok: true, attacker: { en: "Archaludon" }, defender: { en: "Flutter Mane" }, move: { en: "Flash Cannon" } });
});
test("対応表にない名前は何が分からないかを返す", () => {
  const r = parseQuestion("ドドゲザンにミミッキュのじゃれつく");
  expect(r.ok).toBe(false);
  if (!r.ok) expect(r.message).toContain("ドドゲザン");
});
test("わざがない/ポケモンが足りない", () => {
  const a = parseQuestion("ガブリアスにミミッキュの");
  expect(!a.ok && a.message).toContain("わざ");
  const b = parseQuestion("ガブリアスにじゃれつく");
  expect(!b.ok && b.message).toContain("1匹");
});
test("どちらが攻撃側か分からないときは聞き返す", () => {
  const r = parseQuestion("ガブリアスとミミッキュじゃれつく");
  expect(r.ok).toBe(false);
});
test("対応表の英語名はすべてライブラリに存在する", () => {
  const g = Generations.get(9);
  for (const [ja, en] of entries("pokemon")) expect(g.species.get(toID(en)), ja).toBeTruthy();
  for (const [ja, en] of entries("moves")) expect(g.moves.get(toID(en)), ja).toBeTruthy();
});
