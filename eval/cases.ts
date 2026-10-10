// 比較テストの質問文と採点（docs/eval-plan.md 4 章）
// AI には日本語名で返させる（構成設計 A5）ので、正解も日本語名で持つ。

export type Out = Record<string, any>;

export interface Case {
  id: number;
  group: "extract" | "deferred" | "clarify-extract";
  text: string;
  /** 直前の会話（#30 用） */
  history?: { user: string; assistant: string };
  check: (o: Out) => string[]; // 合っていない点の一覧（空なら正解）
}

// ひらがな→カタカナ（「はちまき」と「ハチマキ」を同じに扱う。名前の解決はサーバ側で吸収できるため）
const kata = (s: string) => s.replace(/[\u3041-\u3096]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 0x60));
export const norm = (s: unknown) => (typeof s === "string" ? s.replace(/[\s・]/g, "") : "");
/** 編集距離（文字単位） */
function distance(a: string, b: string): number {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
}
/**
 * 名前が合っているか。正式名、または「聞こえたままのカタカナ」で正解と読みが 2 文字以内の違い（サーバ側のあいまい一致で直せる想定）。
 * 別の実在のポケモンに置き換えた場合は、読みが近くても不正解になるよう、カタカナだけで書かれたものに限る
 */
function nameOk(got: unknown, want: string, alsoReal: string[] = []): boolean {
  const g = kata(norm(got));
  if (g === want) return true;
  return /^[ァ-ヶー]+$/.test(g) && !alsoReal.includes(g) && distance(g, want) <= 2;
}
const side = (o: Out, k: "attacker" | "defender") => (o.conditions?.[k] ?? {}) as Out;
const allText = (o: Out) => JSON.stringify(o);

function eq(o: Out, key: string, want: string): string[] {
  return norm(o[key]) === want ? [] : [`${key}=${JSON.stringify(o[key])}（正解 ${want}）`];
}
function intent(o: Out, want: string): string[] {
  return o.intent === want ? [] : [`intent=${o.intent}（正解 ${want}）`];
}
function names(o: Out): string[] {
  return [o.attacker, o.defender, o.pokemon].map(norm).filter(Boolean);
}
function hasNames(o: Out, ...want: string[]): string[] {
  const got = names(o);
  return want.filter((w) => !got.some((g) => g.includes(w))).map((w) => `ポケモン ${w} がない（${got.join(",")}）`);
}
function damage(o: Out, atk: string, def: string, move: string): string[] {
  return [...intent(o, "damage"), ...eq(o, "attacker", atk), ...eq(o, "defender", def), ...eq(o, "move", move)];
}
function item(o: Out, k: "attacker" | "defender", re: RegExp): string[] {
  return re.test(kata(String(side(o, k).item ?? ""))) ? [] : [`${k}.item=${JSON.stringify(side(o, k).item)}（正解 ${re}）`];
}
function asks(o: Out, re: RegExp, label: string): string[] {
  return re.test(allText(o)) ? [] : [`${label} がない`];
}

const C = (id: number, group: Case["group"], text: string, check: Case["check"], history?: Case["history"]): Case => ({
  id, group, text, check, history,
});

export const CASES: Case[] = [
  C(1, "extract", "ガブリアスにミミッキュのじゃれつく", (o) => damage(o, "ミミッキュ", "ガブリアス", "じゃれつく")),
  C(2, "extract", "ミミッキュのじゃれつくでガブリアスどれくらい減る？", (o) => damage(o, "ミミッキュ", "ガブリアス", "じゃれつく")),
  C(3, "extract", "サーナイトのムーンフォース、カイリューに何発？", (o) => damage(o, "サーナイト", "カイリュー", "ムーンフォース")),
  C(4, "extract", "スカーフガブリアスのじしん、サーフゴーに", (o) => [
    ...damage(o, "ガブリアス", "サーフゴー", "じしん"), ...item(o, "attacker", /スカーフ/),
  ]),
  C(5, "extract", "いのちのたまリザードンのねっぷう、ハッサムに", (o) => [
    ...damage(o, "リザードン", "ハッサム", "ねっぷう"), ...item(o, "attacker", /イノチノタマ/),
  ]),
  C(6, "extract", "相手のハッサムがハチマキだったら、バレットパンチでサーナイト落ちる？", (o) => [
    ...damage(o, "ハッサム", "サーナイト", "バレットパンチ"), ...item(o, "attacker", /ハチマキ/),
  ]),
  C(7, "extract", "メガリザードンYのかえんほうしゃ、晴れでドドゲザンに", (o) => {
    const a = norm(o.attacker);
    const mega = (a.includes("メガ") && /Y|Ｙ/.test(a)) || (a === "リザードン" && /Y|Ｙ/.test(String(side(o, "attacker").mega ?? "")));
    return [
      ...intent(o, "damage"), ...(mega ? [] : [`attacker=${o.attacker}（正解 メガリザードンY）`]),
      ...eq(o, "defender", "ドドゲザン"), ...eq(o, "move", "かえんほうしゃ"),
      ...(/晴|ひざし|日差し|にほんばれ/.test(String(o.conditions?.field?.weather ?? "")) ? [] : [`weather=${JSON.stringify(o.conditions?.field?.weather)}`]),
    ];
  }),
  C(8, "extract", "攻撃1段階上がったカイリューのしんそく、ガブリアスに", (o) => [
    ...damage(o, "カイリュー", "ガブリアス", "しんそく"),
    ...(Number(side(o, "attacker").boosts?.atk) === 1 ? [] : [`attacker.boosts.atk=${side(o, "attacker").boosts?.atk}`]),
  ]),
  C(9, "extract", "HPに32振ったガブリアス、サーフゴーのゴールドラッシュ耐える？", (o) => [
    ...damage(o, "サーフゴー", "ガブリアス", "ゴールドラッシュ"),
    ...(Number(side(o, "defender").sp?.hp) === 32 ? [] : [`defender.sp.hp=${side(o, "defender").sp?.hp}`]),
  ]),
  C(10, "extract", "ガブリアスとサーフゴーどっちが速い？", (o) => [...intent(o, "speed"), ...hasNames(o, "ガブリアス", "サーフゴー")]),
  C(11, "extract", "最速スカーフのガブリアスって、最速のドラパルト抜ける？", (o) => {
    // 最速は speed:"max" でも、S の SP 32 ＋ S 上昇の性格（v5 以降の形）でもよい
    const sides = [o.conditions?.attacker ?? {}, o.conditions?.defender ?? {}];
    const maxCount = sides.filter((x: Out) => x.speed === "max" || (x.sp?.spe === 32 && /^(spe|speed|s)$/i.test(String(x.nature_up ?? "")))).length;
    return [
      ...intent(o, "speed"), ...hasNames(o, "ガブリアス", "ドラパルト"),
      ...asks(o, /スカーフ/, "スカーフ"), ...(maxCount >= 2 ? [] : [`最速が ${maxCount} 体分`]),
    ];
  }),
  C(12, "extract", "ドラパルトの素早さ実数値いくつ？", (o) => [...intent(o, "speed"), ...hasNames(o, "ドラパルト")]),
  C(13, "extract", "サーフゴーのタイプは？", (o) => [...intent(o, "type"), ...hasNames(o, "サーフゴー")]),
  C(14, "extract", "サーフゴーの弱点は？", (o) => [...intent(o, "type"), ...hasNames(o, "サーフゴー")]),
  C(15, "extract", "カイリューの種族値教えて", (o) => [...intent(o, "stats"), ...hasNames(o, "カイリュー")]),
  C(16, "extract", "サーナイトってでんじは覚える？", (o) => [...intent(o, "learnset"), ...hasNames(o, "サーナイト"), ...eq(o, "move", "でんじは")]),
  C(17, "extract", "じゃれつくって何タイプ？", (o) => [...intent(o, "move_info"), ...eq(o, "move", "じゃれつく")]),
  C(18, "deferred", "自分のミミッキュの技なんだっけ", (o) => intent(o, "my_team")),
  C(19, "deferred", "うちのガブリアスの努力値振り教えて", (o) => intent(o, "my_team")),
  C(20, "deferred", "自分のパーティでドドゲザンに一番通る技は？", (o) => intent(o, "my_team")),
  C(21, "deferred", "こんにちは、今日も対戦がんばるよ", (o) => intent(o, "chat")),
  C(22, "deferred", "さっきの負け方つらいわ", (o) => intent(o, "chat")),
  C(23, "deferred", "ロトムの好きなポケモンは？", (o) => intent(o, "chat")),
  C(24, "clarify-extract", "ガブリアスに……えーと、何だっけ", (o) => intent(o, "clarify")),
  C(25, "clarify-extract", "ミミッキュのじゃれつく", (o) => [
    ...intent(o, "clarify"),
    ...((o.missing ?? []).some((m: string) => /defender|防御|相手|受け/.test(m)) ? [] : [`missing=${JSON.stringify(o.missing)}`]),
  ]),
  // 名前の確認・補正はサーバ側で行う（v8 以降の設計案）。「アロロ」を聞こえたまま攻撃側に入れれば、サーバが「分からない」と返せる。
  // 実在の別のポケモン（アローラキュウコンなど）に置き換えたら不正解
  C(26, "clarify-extract", "ガブリアスにアロロのじゃれつく", (o) => kata(norm(o.attacker)) === "アロロ" && norm(o.defender) === "ガブリアス" ? [] : [
    ...intent(o, "clarify"),
    ...((o.unknown_names ?? []).some((m: string) => m.includes("アロロ")) ? [] : [`unknown_names=${JSON.stringify(o.unknown_names)}`]),
  ]),
  // 聞き間違い: 正式名に直すか、聞こえたままのカタカナ（サーバ側のあいまい一致で直せる近さ）なら正解
  C(27, "extract", "が降りあすに見っきゅのじゃれつく", (o) => [
    ...intent(o, "damage"), ...eq(o, "move", "じゃれつく"),
    ...(nameOk(o.attacker, "ミミッキュ") ? [] : [`attacker=${JSON.stringify(o.attacker)}（正解 ミミッキュ）`]),
    ...(nameOk(o.defender, "ガブリアス") ? [] : [`defender=${JSON.stringify(o.defender)}（正解 ガブリアス）`]),
  ]),
  C(28, "extract", "さあ内藤のムーンフォース、カイリューに", (o) => [
    ...intent(o, "damage"), ...eq(o, "defender", "カイリュー"), ...eq(o, "move", "ムーンフォース"),
    ...(nameOk(o.attacker, "サーナイト") ? [] : [`attacker=${JSON.stringify(o.attacker)}（正解 サーナイト）`]),
  ]),
  C(29, "extract", "ガブリアスの素早さと、サーフゴーのタイプ教えて", (o) => {
    if (o.intent === "clarify") return [];
    const q: Out[] = Array.isArray(o.queries) ? o.queries : [];
    const ok =
      o.intent === "multi" &&
      q.some((x) => x.intent === "speed" && names(x).includes("ガブリアス")) &&
      q.some((x) => x.intent === "type" && names(x).includes("サーフゴー"));
    return ok ? [] : [`2 つに分けられていない（intent=${o.intent}, queries=${q.length}）`];
  }),
  C(30, "extract", "じゃあハチマキ持ってたら？", (o) => [
    ...damage(o, "ミミッキュ", "ガブリアス", "じゃれつく"), ...item(o, "attacker", /ハチマキ/),
    ...(o.uses_context === true ? [] : ["uses_context が true でない"]),
  ], {
    user: "ガブリアスにミミッキュのじゃれつく",
    assistant: JSON.stringify({ intent: "damage", attacker: "ミミッキュ", defender: "ガブリアス", move: "じゃれつく", conditions: {}, uses_context: false, missing: [], unknown_names: [] }),
  }),
];

/** 数値の捏造: SP・ランク・残り HP 以外の場所に数値がある、または「%」「ダメージ」付きの数字がある */
export function fabrication(o: unknown, path: string[] = []): string[] {
  if (typeof o === "number") {
    // SP・ランク・残り HP はユーザーが言った値なので数値でよい
    return path.some((p) => ["sp", "boosts", "hp_left", "hp_left_percent"].includes(p)) ? [] : [`${path.join(".")}=${o}`];
  }
  if (typeof o === "string") return /\d+(\.\d+)?\s*(%|％|ダメージ|発)/.test(o) ? [`${path.join(".")}="${o}"`] : [];
  if (Array.isArray(o)) return o.flatMap((v, i) => fabrication(v, [...path, String(i)]));
  if (o && typeof o === "object") return Object.entries(o).flatMap(([k, v]) => fabrication(v, [...path, k]));
  return [];
}

/** ぶれの比較用: 空の値を落とし、キーを並べ替えた文字列 */
export function canonical(o: unknown): string {
  const strip = (v: any): any => {
    if (Array.isArray(v)) {
      const a = v.map(strip).filter((x) => x !== undefined);
      return a.length ? a : undefined;
    }
    if (v && typeof v === "object") {
      const e = Object.keys(v).sort().map((k) => [k, strip(v[k])] as const).filter(([, x]) => x !== undefined);
      return e.length ? Object.fromEntries(e) : undefined;
    }
    if (v === "" || v === null || v === 0 || v === false) return undefined;
    return typeof v === "string" ? norm(v) : v;
  };
  return JSON.stringify(strip(o) ?? {});
}
