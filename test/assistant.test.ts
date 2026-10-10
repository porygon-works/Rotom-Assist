import { expect, test } from "vitest";
import { ask, runTool } from "../src/assistant.js";

test("ツール実行：不正な名前はエラーJSONで返る", () => {
  expect(JSON.parse(runTool("calc_damage", { attacker: { pokemon: "Nope" }, defender: { pokemon: "Charizard" }, move: "Flash Cannon" })).error).toBeTruthy();
});

test("tool_use → 計算結果を tool_result で返し、最終テキストを返す", async () => {
  const seen: any[] = [];
  let n = 0;
  const client: any = { messages: { create: async (req: any) => {
    seen.push(structuredClone(req.messages));
    return n++ === 0
      ? { content: [{ type: "tool_use", id: "t1", name: "calc_damage", input: { attacker: { pokemon: "ブリジュラス" }, defender: { pokemon: "ハバタクカミ" }, move: "ラスターカノン" } }] }
      : { content: [{ type: "text", text: "約65〜78パーセントで確定2発です。" }] };
  } } };
  expect(await ask("質問", client)).toContain("確定2発");
  const result = seen[1].at(-1).content[0];
  expect(result.type).toBe("tool_result");
  expect(JSON.parse(result.content).maxPercent).toBeGreaterThan(0);
});
