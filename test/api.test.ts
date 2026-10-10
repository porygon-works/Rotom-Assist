import { expect, test } from "vitest";
import { POST } from "../app/api/calc/route";

const post = (body: unknown, raw = false) =>
  POST(new Request("http://localhost/api/calc", { method: "POST", body: raw ? (body as string) : JSON.stringify(body) }));

test("正常系: 範囲・確定数・前提を返す", async () => {
  const res = await post({ attacker: "Mimikyu", defender: "Garchomp", move: "Play Rough", gen: 9 });
  expect(res.status).toBe(200);
  const j = await res.json();
  expect(j.min).toBeLessThanOrEqual(j.max);
  expect(j.koText).toBe("確定2発");
  expect(j.assumptions.length).toBeGreaterThan(0);
});
test("ブリジュラス・ウガツホムラ相当が通る", async () => {
  for (const [a, d, m] of [["Archaludon", "Flutter Mane", "Flash Cannon"], ["Gouging Fire", "Garchomp", "Earthquake"]]) {
    expect((await post({ attacker: a, defender: d, move: m })).status).toBe(200);
  }
});
test("不正入力は 400", async () => {
  expect((await post("{oops", true)).status).toBe(400);
  expect((await post({ attacker: "Mimikyu", defender: "Garchomp" })).status).toBe(400);
  expect((await post({ attacker: "Nope", defender: "Garchomp", move: "Play Rough" })).status).toBe(400);
  expect((await post({ attacker: "Mimikyu", defender: "Garchomp", move: "Nope" })).status).toBe(400);
  expect((await post({ attacker: "Mimikyu", defender: "Garchomp", move: "Play Rough", gen: 99 })).status).toBe(400);
  expect((await post({ attacker: 1, defender: "Garchomp", move: "Play Rough" })).status).toBe(400);
});
