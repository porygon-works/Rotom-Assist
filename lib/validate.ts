import { Generations, toID } from "@smogon/calc";
import { DEFAULT_GEN, type CalcInput } from "./calc";

export type Validated = { ok: true; value: CalcInput } | { ok: false; error: string };

const MAX_LEN = 64;

function name(v: unknown, label: string): string | { error: string } {
  if (typeof v !== "string" || !v.trim()) return { error: `${label}は文字列で指定してください` };
  if (v.length > MAX_LEN) return { error: `${label}が長すぎます` };
  return v.trim();
}

/** /api/calc の入力検証。名前は英語名で受け取る（変換はクライアント側で済ませる）。 */
export function validateCalcRequest(body: unknown): Validated {
  if (typeof body !== "object" || body === null) return { ok: false, error: "JSONオブジェクトを送ってください" };
  const b = body as Record<string, unknown>;

  const gen = b.gen === undefined ? DEFAULT_GEN : b.gen;
  if (typeof gen !== "number" || !Number.isInteger(gen) || gen < 1 || gen > 9) {
    return { ok: false, error: "genは1〜9の整数で指定してください" };
  }
  const g = Generations.get(gen as never);

  const attacker = name(b.attacker, "attacker");
  const defender = name(b.defender, "defender");
  const move = name(b.move, "move");
  for (const v of [attacker, defender, move]) if (typeof v !== "string") return { ok: false, error: v.error };

  for (const [label, n] of [["attacker", attacker], ["defender", defender]] as const) {
    if (!g.species.get(toID(n as string))) return { ok: false, error: `${label}「${n}」は第${gen}世代に存在しません` };
  }
  if (!g.moves.get(toID(move as string))) return { ok: false, error: `move「${move}」は第${gen}世代に存在しません` };

  return {
    ok: true,
    value: { attacker: { pokemon: attacker as string }, defender: { pokemon: defender as string }, move: move as string, gen },
  };
}
