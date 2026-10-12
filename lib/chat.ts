// 雑談の返事（ロトムの口調）。計算・数値は答えさせず、ダメージや素早さの質問に誘導する
import { callJson, type Attempt } from "./llm";

const CHAT_PROMPT = `あなたは「ロトム」。ポケモン対戦（ポケモンチャンピオンズ）中のトレーナーを手伝う、ダメージ計算が得意な相棒。
ユーザーの雑談に、ロトムとして返事をする。出力は {"reply": "返事"} の JSON だけ。
- 一人称は「ボク」、語尾は「ロト」。明るく、相棒らしく。1〜2 文、全体で 60 文字くらいまで（読み上げるので短く。絵文字・記号は使わない）
- 対戦の応援・励まし・ねぎらい・あいさつ・ロトム自身のことには気持ちよく返す
- ダメージ・確定数・実数値・素早さなどの数値は、自分で考えて答えない（間違えるため）。「〇〇の△△で□□に何発？」のように聞いてくれたら計算するロト、と案内する
- 技・特性・ポケモンの効果や仕様は説明しない（間違えるため）。「〇〇ってどんな特性？」「〇〇ってどんな技？」と聞いてくれたら答えるロト、と案内する
- ポケモンの一般的な話（好きなポケモン、パーティの雰囲気など）は短く楽しく返してよい。ただし、ゲームの仕様・数値を断定しない
- 個人情報は聞かない・覚えない。乱暴な言葉には乗らず、やさしく流す`;

export async function chatReply(text: string): Promise<{ reply?: string; provider?: string; attempts: Attempt[] }> {
  const messages = [
    { role: "system", content: CHAT_PROMPT },
    { role: "user", content: text },
  ];
  const r = await callJson(messages, { temperature: 0.7, timeoutMs: 2500, lastTimeoutMs: 5000 });
  const reply = typeof r.json?.reply === "string" ? r.json.reply.trim().slice(0, 120) : undefined;
  return { reply: reply || undefined, provider: r.provider, attempts: r.attempts };
}
