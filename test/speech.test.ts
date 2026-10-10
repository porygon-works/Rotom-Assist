import { expect, test } from "vitest";
import { calc } from "../lib/calc";
import { buildSpeech } from "../lib/speech";

test("確定のときだけ「確定」と読む", () => {
  const n = { attacker: { ja: "ミミッキュ", en: "Mimikyu" }, defender: { ja: "ガブリアス", en: "Garchomp" }, move: { ja: "じゃれつく", en: "Play Rough" } };
  const r = calc({ attacker: { pokemon: "Mimikyu" }, defender: { pokemon: "Garchomp" }, move: "Play Rough" });
  const s = buildSpeech(n, r);
  expect(s).toContain("確定2発");
  expect(s).toContain("仮定値");
  expect(buildSpeech(n, { ...r, ko: { kind: "chance", n: 2, chance: 0.375 }, koText: "" })).not.toContain("確定");
});
