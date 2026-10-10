import Anthropic from "@anthropic-ai/sdk";
import { calc, type CalcInput } from "../lib/calc";

export const MODEL = process.env.ROTOM_MODEL ?? "claude-haiku-5-5";

const SYSTEM = `あなたはポケモン対戦中の音声アシスタント。
- ダメージ数値は必ず calc_damage ツールで求める。暗算・推測で数値を出さない。
- ポケモン名・わざ名・持ち物は日本語のままツールに渡してよい（変換はツール側）。
- 回答は読み上げ向けに1〜3文。「ダメージ範囲(%)」「確定数」を述べ、ユーザーが指定しなかった前提（努力値・持ち物など）があれば短く添える。
- 相手の情報が不明なら、わかる範囲で計算し「わからない」点を明示する。`;

const side = {
  type: "object",
  properties: {
    pokemon: { type: "string" },
    item: { type: "string" },
    ability: { type: "string" },
    nature: { type: "string", description: "英語の性格名 例: Modest" },
    evs: { type: "object", description: "hp/atk/def/spa/spd/spe の努力値(0-252)" },
    boosts: { type: "object", description: "atk/def/spa/spd/spe の能力ランク(-6〜6)" },
    teraType: { type: "string" },
  },
  required: ["pokemon"],
} as const;

export const TOOLS: Anthropic.Tool[] = [
  {
    name: "calc_damage",
    description: "@smogon/calc でダメージ範囲と確定数を計算する。",
    input_schema: {
      type: "object",
      properties: {
        attacker: side,
        defender: side,
        move: { type: "string" },
        field: {
          type: "object",
          properties: {
            weather: { type: "string" },
            terrain: { type: "string" },
            isDoubles: { type: "boolean" },
          },
        },
      },
      required: ["attacker", "defender", "move"],
    },
  },
];

export function runTool(name: string, input: unknown): string {
  if (name !== "calc_damage") return JSON.stringify({ error: `unknown tool ${name}` });
  try {
    const r = calc(input as CalcInput);
    return JSON.stringify(r);
  } catch (e) {
    // 名前の誤りなどはモデルに返して言い直させる
    return JSON.stringify({ error: String((e as Error).message) });
  }
}

type Client = Pick<Anthropic, "messages">;

export async function ask(
  question: string,
  client: Client = new Anthropic(),
  maxTurns = 4,
): Promise<string> {
  const messages: Anthropic.MessageParam[] = [{ role: "user", content: question }];
  for (let i = 0; i < maxTurns; i++) {
    const res = await client.messages.create({
      model: MODEL, max_tokens: 400, system: SYSTEM, tools: TOOLS, messages,
    });
    messages.push({ role: "assistant", content: res.content });
    const uses = res.content.filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
    if (!uses.length) {
      return res.content.map((b) => (b.type === "text" ? b.text : "")).join("").trim();
    }
    messages.push({
      role: "user",
      content: uses.map((u) => ({
        type: "tool_result" as const, tool_use_id: u.id, content: runTool(u.name, u.input),
      })),
    });
  }
  return "うまく計算できませんでした。";
}
