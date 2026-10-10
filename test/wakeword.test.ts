import { expect, test } from "vitest";
import { extractAfterWakeWord } from "../lib/wakeword";

test("合言葉のあとを質問として取り出す", () => {
  expect(extractAfterWakeWord("ダメ計 ガブリアスにミミッキュのじゃれつく")).toEqual({ found: true, rest: "ガブリアスにミミッキュのじゃれつく" });
  expect(extractAfterWakeWord("ダメ計、ミミッキュの")).toMatchObject({ found: true, rest: "ミミッキュの" });
});
test("合言葉だけなら rest は空", () => {
  expect(extractAfterWakeWord("ダメ計")).toEqual({ found: true, rest: "" });
});
test("合言葉がなければ found:false", () => {
  expect(extractAfterWakeWord("ガブリアスにじゃれつく")).toEqual({ found: false, rest: "" });
});
