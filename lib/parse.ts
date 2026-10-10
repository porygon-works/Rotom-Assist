import { entries } from "./names";

export interface Named {
  ja: string;
  en: string;
}

export type ParseResult =
  | { ok: true; attacker: Named; defender: Named; move: Named }
  | { ok: false; message: string };

interface Hit extends Named {
  start: number;
  end: number;
}

const MASK = "\u0000";

/** 長い名前から順に、重ならないように全出現位置を拾う。拾った範囲は MASK で潰す。 */
function findAll(text: string, table: [string, string][]): { hits: Hit[]; masked: string } {
  const sorted = [...table].sort((a, b) => b[0].length - a[0].length);
  const hits: Hit[] = [];
  let masked = text;
  for (const [ja, en] of sorted) {
    let from = 0;
    for (;;) {
      const i = masked.indexOf(ja, from);
      if (i === -1) break;
      hits.push({ ja, en, start: i, end: i + ja.length });
      masked = masked.slice(0, i) + MASK.repeat(ja.length) + masked.slice(i + ja.length);
      from = i + ja.length;
    }
  }
  return { hits: hits.sort((a, b) => a.start - b.start), masked };
}

const ATTACKER_PARTICLES = ["の", "が", "から"];
const DEFENDER_PARTICLES = ["に", "へ"];

const startsWithAny = (s: string, list: string[]) => list.some((p) => s.startsWith(p));

/**
 * 簡易ルール（Claude API なし）:
 *  - 「Xの…」「Xが…」= 攻撃側、「Xに…」「Xへ…」= 防御側
 *  - 例: 「ガブリアスにミミッキュのじゃれつく」→ 攻撃=ミミッキュ / 防御=ガブリアス / わざ=じゃれつく
 */
export function parseQuestion(raw: string): ParseResult {
  const text = raw.normalize("NFKC").replace(/\s+/g, "");

  // わざを先に拾って潰す（わざ名の一部がポケモン名に当たるのを防ぐ）
  const moveStep = findAll(text, entries("moves"));
  const pk = findAll(moveStep.masked, entries("pokemon"));
  const moves = moveStep.hits;
  const mons = pk.hits;

  // 対応表にないカタカナ語は「未登録の名前」として報告する
  const unknown = [...pk.masked.matchAll(/[ァ-ヴー]{2,}/g)].map((m) => `「${m[0]}」`);

  const problems: string[] = [];
  if (unknown.length) problems.push(`${unknown.join("、")}は対応表にありません`);
  if (moves.length === 0) problems.push("わざが分かりませんでした");
  if (moves.length > 1) problems.push("わざが複数あって決められません");
  if (mons.length < 2 && !unknown.length) {
    problems.push(`ポケモンが${mons.length}匹しか分かりませんでした`);
  } else if (mons.length < 2) {
    problems.push(`分かったポケモンは${mons.length}匹です`);
  }
  if (mons.length > 2) problems.push("ポケモンが3匹以上あって決められません");
  if (problems.length) return { ok: false, message: problems.join("。") + "。" };

  const [a, b] = mons;
  const role = (h: Hit) => {
    const rest = text.slice(h.end);
    if (startsWithAny(rest, ATTACKER_PARTICLES)) return "attacker" as const;
    if (startsWithAny(rest, DEFENDER_PARTICLES)) return "defender" as const;
    return null;
  };
  const ra = role(a);
  const rb = role(b);

  let attacker: Hit | undefined;
  let defender: Hit | undefined;
  if (ra === "attacker" && rb !== "attacker") [attacker, defender] = [a, b];
  else if (rb === "attacker" && ra !== "attacker") [attacker, defender] = [b, a];
  else if (ra === "defender" && rb !== "defender") [attacker, defender] = [b, a];
  else if (rb === "defender" && ra !== "defender") [attacker, defender] = [a, b];

  if (!attacker || !defender) {
    return {
      ok: false,
      message: `${a.ja}と${b.ja}のどちらが攻撃側か分かりませんでした。「${a.ja}にもう一方のの…」のように「の」「に」をつけて言ってください。`.replace(
        "もう一方のの",
        `${b.ja}の`,
      ),
    };
  }
  const n = (h: Hit): Named => ({ ja: h.ja, en: h.en });
  return { ok: true, attacker: n(attacker), defender: n(defender), move: n(moves[0]) };
}
