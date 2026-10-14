import { expect, it } from "vitest";
import { QUIET_MS, RETURN_QUIET_MS, shouldReload } from "../app/useAutoUpdate";

const o = { base: "aaa", latest: "bbb", idle: true, quietFor: QUIET_MS, returning: false };

it("新しい版が出ていて、話していない時間が続いたら入れ替える", () => {
  expect(shouldReload(o)).toBe(true);
  expect(shouldReload({ ...o, latest: "aaa" })).toBe(false); // 同じ版
  expect(shouldReload({ ...o, latest: "" })).toBe(false); // 版が分からない（手元・通信の失敗）
  expect(shouldReload({ ...o, base: "" })).toBe(false);
});

it("聞き取り・考え中・読み上げ中と、答えを読んでいる間は入れ替えない", () => {
  expect(shouldReload({ ...o, idle: false })).toBe(false);
  expect(shouldReload({ ...o, quietFor: QUIET_MS - 1 })).toBe(false);
});

it("別のタブ・アプリから戻ってきたときは、少し静かなら入れ替える", () => {
  expect(shouldReload({ ...o, returning: true, quietFor: RETURN_QUIET_MS })).toBe(true);
  expect(shouldReload({ ...o, returning: true, quietFor: RETURN_QUIET_MS - 1 })).toBe(false);
});
