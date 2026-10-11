// ルール解析（構成設計 4.2 の 2）: よくある言い方を AI を使わずに解釈する。AI と同じ形（lib/extractPrompt.ts）を返す
// 方針: 文の中の語が**すべて**辞書・決まった言い回しで説明できたときだけ結果を返す。知らない語が少しでも残れば null（AI に回す）
// （試作版のルール解析が「HPに32振った」を黙って落とした反省。eval-plan.md 7.6）
import names from "../data/names.json";
import aliases from "../data/aliases.json";
import { resolve } from "./resolve";

type Obj = Record<string, unknown>;
type Stat = "hp" | "atk" | "def" | "spa" | "spd" | "spe";

/** NFKC・ひらがな→カタカナ・空白除去（句読点は区切りとして残す） */
function norm(s: string): string {
  return s
    .normalize("NFKC")
    .replace(/[ぁ-ゖ]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 0x60))
    .replace(/\s+/g, "")
    // 「下降補正」の書き起こし違い（加工補正 など。ask_log #10）
    .replace(/(加工|河口|火口|下向|過去)(?=補正)/g, "下降")
    // 「C下降補正」の「C」が「良い」になった（良い過去補正。ask_log #25）
    .replace(/(良イ|ヨイ|イイ)(?=下降補正)/g, "C")
    // 「C下降補正」（しかこう）が 1 語の漢字になった（資格補正 など）
    .replace(/(資格|視覚|四角|死角|シカク|シカコウ|シカ|スイカ|西瓜)(?=補正)/g, "C下降")
    // 「特化」の書き起こし違い（HB特価、HBトッカ。ask_log #32・#61）
    .replace(/([HABCDS]{1,3})(?:特価|トッカ)/g, "$1特化")
    // 「HB振り」の「振り」がブリ・プリになった（HBブリエンペルト。ask_log #50）
    .replace(/([HABCDS]{1,3})(?:ブリ|プリ)/g, "$1振リ")
    // 「耐えますか」が「絶えますか」になった（ask_log #59）
    .replace(/絶エ/g, "耐エ")
    // 「耐えれる」「耐えますか」の書き起こし違い（買えますか。ask_log #31〜#33）
    .replace(/買エ(マスカ|レル|ル)/g, "耐エ$1")
    // 「〇〇フィールド下の」「〇〇下で」の書き起こし違い（エレキフィールド化の。ask_log #34）
    .replace(/(フィールド|晴レ|雨|砂嵐|雪)(?:化|カ)(?=ノ|デ)/g, "$1下")
    // 能力の略号の読み（音声認識がカタカナで書くことがある:「エー特化」「エイチビー振り」「エス二段階」）。
    // 特化・振り・段階・＋−・補正の直前に続くときだけ直す（「エースバーン」などを壊さない）
    .replace(/((?:エイチ|エッチ|エー|エイ|ビー|シー|ディー|デー|エス)+)(?=特化|振リ|段階|[+\-]|補正|252|ガ?[1-6一二三四五六]段階|ニ?(?:下降|上昇|マイナス|プラス|ダウン|アップ)補正|[↑↓])/g, (m) =>
      LETTER_READING.reduce((x, [re, l]) => x.replace(re, l), m),
    )
    // 1 字だけの読み・漢字（音声認識が「C」を「し」「市」「氏」、「A」を「え」「絵」「英」と書く）。
    // 名前の一部（カエンジシ、アヤシシ）を壊さないよう、文頭・助詞・区切り・略号の直後で、後ろに特化・振り・補正などが続くときだけ
    .replace(new RegExp(`(?<=^|[ノニデガトハヲモ、,\\s]|[HABCDS])(シ|エ|[${Object.keys(LETTER_KANJI).join("")}])(?=${STAT_TRIGGER})`, "g"), (m) => (m === "シ" ? "C" : m === "エ" ? "A" : LETTER_KANJI[m]))
    .replace(/([hbacds]+)(?=特化|振リ|段階|[+\-]|補正|252|[↑↓])/g, (m) => m.toUpperCase());
}

/** 能力の略号の後ろに続く語（この前にあるときだけ、読みや漢字を略号に直す） */
const STAT_TRIGGER = "特化|振リ|補正|ニ?(?:下降|上昇|マイナス|プラス|ダウン|アップ|低下)補正|[↑↓]|[+\\-][1-6]|ガ?[1-6一二三四五六]段階";
/** 音声認識が略号を書き換える漢字 → 略号 */
const LETTER_KANJI: Record<string, string> = { 私: "C", 市: "C", 氏: "C", 誌: "C", 紙: "C", 師: "C", 史: "C", 絵: "A", 英: "A", 栄: "A" };

/** 能力の略号の読み → 略号 */
const LETTER_READING: [RegExp, string][] = [
  [/エイチ|エッチ/g, "H"], [/エー|エイ/g, "A"], [/ビー/g, "B"], [/シー/g, "C"], [/ディー|デー/g, "D"], [/エス/g, "S"],
];

type Tok =
  | { k: "pokemon"; ja: string; heard?: string } // heard: 聞き間違いを読みの近さで直したとき、聞こえた形（回答は直した名前で答え、画面にだけ「〇〇として計算した」と出す）
  | { k: "move"; ja: string; heard?: string }
  | { k: "item"; ja: string }
  | { k: "nature"; ja: string }
  | { k: "ability"; ja: string } // 特性（直後のポケモン）
  | { k: "weather"; v: string }
  | { k: "terrain"; v: string }
  | { k: "spread"; sp: Partial<Record<Stat, number>>; up?: Stat; down?: Stat; both?: boolean; bare?: boolean } // both: 「準速同士」、bare: 能力を言わない「特化」
  | { k: "boost"; stat: Stat; n: number; conditional?: boolean } // conditional: 「上がったら」の形（付け先が前か後ろか決まらない）
  | { k: "sr" } // ステロ込み（防御側）
  | { k: "flag"; f: "reflect" | "critical" } // 壁・急所（場）
  | { k: "hp"; percent?: number; value?: number; left?: boolean } // 残り HP（直後のポケモン）。left: 「残り」「残ってる」が付いていた
  | { k: "status"; v: string } // 状態異常（直後のポケモン）
  | { k: "busted" } // ばけのかわが剥がれた（直後のポケモン）
  | { k: "p"; v: string } // 助詞・区切り
  | { k: "w"; v: string }; // 質問の言い回し

const LETTER: Record<string, Stat> = { H: "hp", A: "atk", B: "def", C: "spa", D: "spd", S: "spe" };

let dict: [string, Tok][] | null = null;
let surfaceSet: Set<string> | null = null;
/** 辞書の語の表記（完全一致の確認用） */
const surfaces = () => (surfaceSet ??= new Set(dictionary().map(([w]) => w)));
function dictionary(): [string, Tok][] {
  if (dict) return dict;
  const n = names as unknown as Record<string, Record<string, string>>;
  const a = aliases as unknown as Record<string, Record<string, string>>;
  const list: [string, Tok][] = [];
  const add = (surface: string, t: Tok) => list.push([norm(surface), t]);
  for (const ja of Object.keys(n.pokemon)) {
    add(ja, { k: "pokemon", ja });
    // メガシンカの末尾の読み（メガルカリオゼット、メガリザードンワイ）
    const m = ja.match(/^(メガ.+)([XYZ])$/);
    if (m) add(m[1] + { X: "エックス", Y: "ワイ", Z: "ゼット" }[m[2] as "X" | "Y" | "Z"], { k: "pokemon", ja });
  }
  for (const [al, ja] of Object.entries(a.pokemon)) if (n.pokemon[ja]) add(al, { k: "pokemon", ja });
  const others = (names as unknown as { others: Record<string, string[]> }).others;
  for (const ja of others.pokemon ?? []) add(ja, { k: "pokemon", ja });
  for (const ja of others.moves ?? []) add(ja, { k: "move", ja });
  for (const ja of Object.keys(n.moves)) add(ja, { k: "move", ja });
  for (const [al, ja] of Object.entries(a.moves)) if (n.moves[ja]) add(al, { k: "move", ja });
  for (const ja of Object.keys(n.items)) add(ja, { k: "item", ja });
  // チャンピオンズにない持ち物（ハチマキなど）も持ち物として拾い、回答で「ないロト」と言わせる
  for (const [al, ja] of Object.entries(a.items)) add(al, { k: "item", ja });
  for (const ja of Object.keys(n.natures)) add(ja, { k: "nature", ja });
  // 特性（名前の前に付けて言う形:「マルチスケイルのカイリュー」）。わざ・ポケモンと同じ名前なら、そちらを優先（並べ替えで先に入れたものが勝つ）
  for (const ja of Object.keys(n.abilities)) add(ja, { k: "ability", ja });
  for (const [al, ja] of Object.entries(a.abilities ?? {})) if (n.abilities[ja]) add(al, { k: "ability", ja });
  for (const [w, v] of Object.entries(a.weather)) add(w, { k: "weather", v: w });
  for (const [t] of Object.entries(a.terrain)) add(t, { k: "terrain", v: t });
  // 助詞・区切り
  for (const p of ["の", "に", "へ", "で", "が", "と", "から", "、", ",", "って", "は"]) add(p, { k: "p", v: norm(p) });
  // 2 文字の助詞（「ガブリアスには」「晴れでは」）。役割は先頭の字（に・で）で決める
  for (const p of ["には", "にも", "へは", "では"]) add(p, { k: "p", v: norm(p[0]) });
  // 質問の言い回し（意味を持たない、または質問の種類を表す語）
  for (const w of [
    "何発", "なんぱつ", "確定", "確定数", "耐える", "耐えれる", "耐えられる", "落ちる", "落とせる", "倒せる", "どれくらい", "どのくらい", "減る",
    "どっちが速い", "どっちがはやい", "どっちが早い", "どっちが先", "抜ける", "抜かれる", "素早さ", "すばやさ", "実数値", "いくつ",
    "タイプ", "弱点", "相性", "種族値", "威力", "何タイプ", "教えて", "？", "?", "。", "!", "！", "撃ったら", "うったら", "だと", "なら",
    "んだけど", "だけど", "けど", "何が", "なにが", "何", "なに", "与える", "与えれる", "与え", "あたえる", "どれぐらい", "どんぐらい", "どのぐらい", "とかで", "とか", "タイル", "売ったら", "特性", "とくせい", "効果", "効果抜群", "抜群", "ばつぐん", "効く", "効かない", "いまひとつ", "今ひとつ", "のこと", "こと", "だっけ", "何だっけ", "って何", "どんな", "打ったら", "打って", "打つと", "入りますか", "耐えますか", "耐えられますか", "耐えるか", "打ったときに", "打ったとき", "撃ったときに", "撃ったとき", "うったとき", "入る", "はいる", "入れる", "通る",
    "じゃくてん", "しゅぞくち", "いりょく", "なんタイプ", "なんぱつ",
    "優先度", "ゆうせんど", "どっちが優先度高い", "どっちが威力高い", "高い",
    "何パーセント", "なんパーセント", "何%", "何割", "なんわり",
    "一発", "1発", "2発", "3発", "確定1発", "確定一発", "確定2発", "確定二発", "乱数1発",
    "より速い", "よりはやい", "より早い", "より遅い", "どっち速い", "どっちはやい", "どっち早い", "どっちが速いの", "どっちが先",
    "てるときの", "てる時の", "てるとき", "ときの", "時の", "ときに", "時に", "のとき", "の時", "中で", "下で", "下の", "どっちが遅い", "どっちがおそい",
    "持ってたら", "持ってる", "もってたら", "だったら", "の場合は", "の場合", "場合", "じゃあ", "じゃ", "では", "なら", "だと",
    "覚える", "おぼえる", "覚えた", "を",
    "どこまで", "すばやさ振ってたら", "素早さ振ってたら", "振ってたら", "振ったら", "何振りまで", "何振りなら", "負ける", "抜かれる", "までなら", "まで",
  ]) add(w, { k: "w", v: norm(w) });
  // 長い語から先に照合する
  const prio = (t: Tok) => (t.k === "weather" || t.k === "terrain" ? 0 : 1);
  list.sort((x, y) => y[0].length - x[0].length || prio(x[1]) - prio(y[1]));
  dict = list;
  return list;
}

/** 決まった形の言い回し（特化・振り・最速・ランク） */
function pattern(s: string): [number, Tok] | null {
  let m = s.match(/^([HABCDS]{1,3})特化/);
  if (m) {
    const stats = [...m[1]].map((c) => LETTER[c]);
    const nonH = stats.filter((x) => x !== "hp");
    if (nonH.length !== 1) return null; // 「CS特化」など補正の先が決まらないものは AI に回す
    return [m[0].length, { k: "spread", sp: Object.fromEntries(stats.map((x) => [x, 32])), up: nonH[0] }];
  }
  // 能力を言わない「特化」（「特化ガブのじしん」）: 攻撃側なら使うわざに合わせて攻撃か特攻の特化。付け先は parseRules で確かめる
  m = s.match(/^特化/);
  if (m) return [m[0].length, { k: "spread", sp: {}, bare: true }];
  m = s.match(/^([HABCDS]{1,3})(?:振リ|252|極振リ)/);
  if (m) return [m[0].length, { k: "spread", sp: Object.fromEntries([...m[1]].map((c) => [LETTER[c], 32])) }];
  // 「HBエンペルト」: 能力を 2 つ以上並べてすぐ名前が続くときは、その能力に振った（「振り」を省いた言い方）
  m = s.match(/^([HABCDS]{2,3})(?=[ァ-ヶ一-龯])/);
  if (m) return [m[0].length, { k: "spread", sp: Object.fromEntries([...m[1]].map((c) => [LETTER[c], 32])) }];
  // 性格補正: 「C下降補正」「Cマイナス補正」「C↓」= 性格で特攻が下がる（ようき・いじっぱり など）、「A上昇補正」「A↑」「A補正」= 上がる
  m = s.match(/^([ABCDS])ニ?(?:(下降|低下|マイナス|ダウン|[-−])補正|(上昇|プラス|アップ|[+＋])補正|(↓)|(↑)|補正)/);
  if (m) {
    const stat = LETTER[m[1]];
    return [m[0].length, m[2] || m[4] ? { k: "spread", sp: {}, down: stat } : { k: "spread", sp: {}, up: stat }];
  }
  // 無振り: すべての SP が 0・補正なし（指定ありとして扱い、幅は出さない）
  m = s.match(/^(?:無振リ|ムフリ)/);
  if (m) return [m[0].length, { k: "spread", sp: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 } }];
  m = s.match(/^(最速|準速|最遅)同士/);
  if (m) {
    const t = pattern(m[1]);
    return t && t[1].k === "spread" ? [m[0].length, { ...t[1], both: true }] : null;
  }
  m = s.match(/^(?:イカク|威嚇)(?:ヲ|ガ)?(?:受ケタ|入ッタ|入レラレタ|込ミ|後)/);
  if (m) return [m[0].length, { k: "boost", stat: "atk", n: -1 }];
  m = s.match(/^(?:化ケノ皮|バケノカワ|化ケノカワ|バケノ皮)(?:ガ|ノ)?(?:剥ガレタ|ハガレタ|剥ゲタ|ハゲタ|ナイ|ナシ|無シ|割レタ|ワレタ)/);
  if (m) return [m[0].length, { k: "busted" }];
  m = s.match(/^(ヤケド|火傷|マヒ|麻痺)(?:状態)?(?:シタ|シテル|シテイル)?/);
  if (m) return [m[0].length, { k: "status", v: /ヤケド|火傷/.test(m[1]) ? "やけど" : "まひ" }];
  m = s.match(/^リフレクター(?:アリ|有リ|込ミ)?/);
  if (m) return [m[0].length, { k: "flag", f: "reflect" }];
  m = s.match(/^急所(?:ニ当タッタラ|ニ当タレバ|ニ当タッテ|込ミ|アリ)?/);
  if (m) return [m[0].length, { k: "flag", f: "critical" }];
  m = s.match(/^(最速|準速|最遅)/);
  if (m) {
    if (m[1] === "最速") return [2, { k: "spread", sp: { spe: 32 }, up: "spe" }];
    if (m[1] === "準速") return [2, { k: "spread", sp: { spe: 32 } }];
    return [2, { k: "spread", sp: { spe: 0 }, down: "spe" }];
  }
  m = s.match(/^(?:ステロ|ステルスロック)(?:込ミ|コミ|込|アリ|有リ|入リ)/);
  if (m) return [m[0].length, { k: "sr" }];
  // ランク: 「S+2」「C-1」「S二段階上昇の」「攻撃1段階上がった」
  m = s.match(/^([ABCDS])([+\-])([1-6])/);
  if (m) return [m[0].length, { k: "boost", stat: LETTER[m[1]], n: (m[2] === "-" ? -1 : 1) * Number(m[3]) }];
  m = s.match(/^([ABCDS]|攻撃|防御|特攻|特防|素早サ|スバヤサ)ガ?([1-6一二三四五六])段階(上昇|上ガッテタラ|上ガッタラ|上ガッタ|上ガッテル|アップ|下降|下ガッテタラ|下ガッタラ|下ガッタ|下ガッテル|ダウン)/);
  if (m) {
    const stat = LETTER[m[1]] ?? ({ 攻撃: "atk", 防御: "def", 特攻: "spa", 特防: "spd", 素早サ: "spe", スバヤサ: "spe" } as Record<string, Stat>)[m[1]];
    const n = Number(m[2]) || "一二三四五六".indexOf(m[2]) + 1;
    return [m[0].length, { k: "boost", stat, n: /下|ダウン/.test(m[3]) ? -n : n, conditional: /タラ$/.test(m[3]) }];
  }
  // 残り HP（名前の前に付く形）: 「HP半分の」「残りHP3割の」「HP120の」
  m = s.match(/^(?:残リ)?HP(?:ガ)?(半分|[1-9]割|\d{1,3}(?:%|パーセント)|\d{1,3})(?:残リ|残ッタ|残ッテル)?/);
  if (m) {
    const v = m[1];
    const left = /残/.test(m[0]);
    if (v === "半分") return [m[0].length, { k: "hp", percent: 50, left }];
    if (v.endsWith("割")) return [m[0].length, { k: "hp", percent: Number(v[0]) * 10, left }];
    if (/%|パーセント/.test(v)) return [m[0].length, { k: "hp", percent: Number(v.replace(/\D/g, "")), left }];
    return [m[0].length, { k: "hp", value: Number(v), left }];
  }
  m = s.match(/^([ABCDS])([+\-])([1-6])/);
  if (m) return [m[0].length, { k: "boost", stat: LETTER[m[1]], n: (m[2] === "-" ? -1 : 1) * Number(m[3]) }];
  return null;
}

/** 左から最長一致で語に分ける。説明できない文字が残れば null */
export function tokenize(text: string): Tok[] | null {
  const s = norm(text);
  const failed = new Set<string>();
  // 助詞は文頭や助詞の直後には来ない（「トヒドイデ」を「と」+ヒドイデ、「カラルヤドラン」を「から」+… と切らない）
  // 読点（、）は区切りなので、助詞の後にも来てよく、前の状態を引き継ぐ（「ステロ込みで、」）
  const isComma = (t: Tok) => t.k === "p" && /^[、,]$/.test(t.v);
  const isParticle = (t: Tok) => (t.k === "p" && !isComma(t)) || (t.k === "w" && t.v === "ヲ");
  // 先頭から順に語を当てる。行き詰まったら手前に戻って別の切り方を試す（「ミミック」を「ミミ」+「ック」と切って行き詰まる など）
  const walk = (i: number, afterParticle: boolean): Tok[] | null => {
    if (i >= s.length) return [];
    const memo = `${i}:${afterParticle}`;
    if (failed.has(memo)) return null;
    const next = (len: number, toks: Tok[]): Tok[] | null => {
      if (isParticle(toks[0]) && afterParticle) return null;
      const last = toks[toks.length - 1];
      const rest = walk(i + len, isComma(last) ? afterParticle : isParticle(last));
      return rest ? [...toks, ...rest] : null;
    };
    for (const [len, toks] of candidates(s, i)) {
      const r = next(len, toks);
      if (r) return r;
    }
    // 辞書で読めないときだけ: ポケモン・わざの聞き間違いかを読みの近さで調べる（「ミミックのじゃれつく」→ミミッキュ）
    for (const [len, t] of guessName(s.slice(i))) {
      const r = next(len, [t]);
      if (r) return r;
    }
    // 言い直し: 名前を言いかけて言い直した（「リザ、メガリザードンY」の「リザ」）。直後の名前に含まれる 1〜4 文字なら読み飛ばす
    for (let k = 1; k <= 4 && i + k < s.length; k++) {
      const frag = s.slice(i, i + k);
      const nx = candidates(s, i + k).find(([, ts]) => ts[0].k === "pokemon" || ts[0].k === "move");
      if (!nx || !norm((nx[1][0] as { ja: string }).ja).includes(frag)) continue;
      const rest = walk(i + k, afterParticle);
      if (rest) return rest;
    }
    failed.add(memo);
    return null;
  };
  return walk(0, true);
}

/** 位置 i から当てはまる語の候補（決まった言い回し → 辞書の長い順） */
function candidates(s: string, i: number): [number, Tok[]][] {
  const rest = s.slice(i);
  const out: [number, Tok[]][] = [];
  const pt = pattern(rest);
  if (pt) out.push([pt[0], [pt[1]]]);
  for (const [surface, t] of dictionary()) {
    if (!rest.startsWith(surface)) continue;
    let len = surface.length;
    // 持ち物・特性の後ろの「持ち」「込み」などは読み飛ばす
    if (t.k === "item") len += s.slice(i + len).match(/^(持チ|モチ)/)?.[0].length ?? 0;
    if (t.k === "ability") len += s.slice(i + len).match(/^(込ミ|コミ|持チ|アリ)/)?.[0].length ?? 0;
    out.push([len, [t]]);
  }
  return out;
}

/**
 * 文の先頭の 4〜10 文字（漢字を含めば 3 文字から）を、ポケモン・わざの名前の聞き間違いとして読みの近さで照合する。
 * 候補が 1 つに決まる長さだけを、違いの小さい順（同じなら長い順）に返す。後ろが読めない切り方は tokenize が捨てる
 */
function guessName(rest: string): [number, Tok][] {
  const found: { len: number; dist: number; tok: Tok }[] = [];
  // 名前の頭に来ない字（助詞の「ヲ」、ン・ッ・ー・小さい字）で始まる切り方は取らない（「をリザ」→オリーヴァ の誤り）
  if (!/^[ァ-ヶ一-龯]/.test(rest) || /^[ヲンッーァィゥェォャュョヮ]/.test(rest)) return [];
  // カナ 3 文字以下は別の名前に当たりやすいので 4 文字から（漢字を含むときは 3 文字も: 月光蛾）
  for (let len = Math.min(10, rest.length); len >= 3; len--) {
    const heard = rest.slice(0, len);
    if (/[、,?？!！。]/.test(heard) || (len === 3 && !/[一-龯]/.test(heard))) continue;
    // 英字・数字を含む切り方は取らない（「ドラゴンアローヲHB」の HB を名前に吸わせない）
    if (/[A-Za-z0-9]/.test(heard)) continue;
    // 辞書にある語 + 助詞（「ジシンヲ」「ドラゴンアローヲ…」）は聞き間違いではない。助詞から先を名前に吸わせない
    if ([...Array(heard.length).keys()].some((k) => k >= 2 && /[ノヲニデガトハヘモ]/.test(heard[k]) && surfaces().has(heard.slice(0, k)))) continue;
    for (const kind of ["pokemon", "moves"] as const) {
      const r = resolve(kind, heard);
      if (r.ok && r.fuzzy) found.push({ len, dist: r.dist ?? 0, tok: { k: kind === "pokemon" ? "pokemon" : "move", ja: r.ja, heard } });
    }
  }
  return found.sort((a, b) => a.dist - b.dist || b.len - a.len).map((f) => [f.len, f.tok]);
}

interface Side {
  name: string;
  cond: Obj;
  particle?: string;
}

function applyMods(cond: Obj, mods: Tok[]) {
  for (const t of mods) {
    if (t.k === "spread") {
      if (t.bare) cond.attack_max = true;
      // 性格補正だけ（「C↓」）のときは、振り方は指定なしのまま
      if (Object.keys(t.sp).length) cond.sp = { ...(cond.sp as Obj | undefined), ...t.sp };
      if (t.up) cond.nature_up = t.up;
      if (t.down) cond.nature_down = t.down;
    } else if (t.k === "item") cond.item = t.ja;
    else if (t.k === "nature") cond.nature = t.ja;
    else if (t.k === "boost") cond.boosts = { ...(cond.boosts as Obj | undefined), [t.stat]: t.n };
    else if (t.k === "status") cond.status = t.v;
    else if (t.k === "ability") cond.ability = t.ja;
    else if (t.k === "busted") cond.disguise_broken = true;
    else if (t.k === "hp") {
      if (t.percent !== undefined) cond.hp_left_percent = t.percent;
      if (t.value !== undefined) cond.hp_left = t.value;
    }
  }
}

/** 文を解釈する。確実に分かるときだけ結果を返す */
const GREETINGS = /^(コンニチ[ハワ]|コンバン[ハワ]|オハヨウ(ゴザイマス)?|アリガトウ?(ゴザイマス)?|ヨロシク(オネガイシマス)?|オヤスミ(ナサイ)?|サンキュー?)[!！。?？~〜ー]*$/;

/** 文頭の呼びかけ（「ねえロトム、」）を取り除く。ロトムはポケモン名でもあるので、後ろに続きがあるときだけ */
function stripCall(text: string): string {
  const n = text.normalize("NFKC").replace(/^\s*(ねえ|ねぇ|ねー|おい|ヘイ|へい)?\s*(ロトム|ろとむ)(さん|くん|ちゃん)?\s*[、,，!！]?\s*(?=\S)/, "");
  return n === text.normalize("NFKC") ? text : n;
}

export function parseRules(raw: string): Obj | null {
  const text = stripCall(raw);
  if (GREETINGS.test(norm(text))) return { intent: "chat" };
  const toks = tokenize(text);
  if (!toks || !toks.length) return null;
  // 「〇〇がS1段階上がったら」は前のポケモンの話だが、名前の前に付く条件と区別できないので AI に回す
  if (toks.some((t) => t.k === "boost" && t.conditional)) return null;
  const field: Obj = {};
  const sides: Side[] = [];
  const moves: string[] = [];
  const words = toks.filter((t): t is Extract<Tok, { k: "w" }> => t.k === "w").map((t) => t.v);
  let mods: Tok[] = [];
  let sr = false;
  const bothSpread: Tok[] = [];
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    const next = toks[i + 1];
    if (t.k === "weather" || t.k === "terrain") {
      if (field[t.k]) return null;
      field[t.k] = t.v;
      if (next?.k === "p" && ["ノ", "デ"].includes(next.v)) i++; // 「雨の」「晴れで」
      continue;
    }
    if (t.k === "flag") {
      field[t.f] = true;
      if (next?.k === "p" && ["ノ", "デ"].includes(next.v)) i++;
      continue;
    }
    if (t.k === "spread" && t.both) {
      bothSpread.push(t);
      continue;
    }
    if (t.k === "sr") {
      sr = true;
      if (next?.k === "p" && ["ノ", "デ"].includes(next.v)) i++; // 「ステロ込みで」
      continue;
    }
    // 名前の後ろの残り HP（「エンペルトのHP120残ってる」）: 直前のポケモンに付ける
    // （「〇〇のHP半分減る？」のように残り HP でない意味もあるので、「残り」「残ってる」が付いているときだけ）
    if (t.k === "hp" && !mods.length && (toks[i - 1] as Tok | undefined)?.k === "p" && (toks[i - 1] as { v: string }).v === "ノ" && toks[i - 2]?.k === "pokemon" && sides.length) {
      if (!t.left) return null;
      const last = sides[sides.length - 1];
      if (t.percent !== undefined) last.cond.hp_left_percent = t.percent;
      if (t.value !== undefined) last.cond.hp_left = t.value;
      last.particle = next?.k === "p" ? next.v : undefined;
      continue;
    }
    if (t.k === "spread" || t.k === "item" || t.k === "nature" || t.k === "boost" || t.k === "hp" || t.k === "status" || t.k === "ability" || t.k === "busted") {
      mods.push(t);
      continue;
    }
    if (t.k === "pokemon") {
      const cond: Obj = {};
      applyMods(cond, mods);
      mods = [];
      // 「ミミッキュを（倒せる）」の「を」も助詞として見る（防御側の印）
      sides.push({ name: t.heard ?? t.ja, cond, particle: next?.k === "p" ? next.v : next?.k === "w" && next.v === "ヲ" ? "ヲ" : undefined });
      continue;
    }
    if (t.k === "move") {
      // 「メガリザードンYのいのちのたまかえんほうしゃ」: 名前の直後（〜の）とわざの間の持ち物は、その名前のもの
      const lastSide = sides[sides.length - 1];
      if (mods.length && mods.every((x) => x.k === "item") && lastSide && lastSide.particle === "ノ" && toks[i - mods.length - 1]?.k === "p") {
        applyMods(lastSide.cond, mods);
        mods = [];
      }
      if (mods.length) return null; // わざの前の条件は付け先が分からない
      moves.push(t.heard ?? t.ja);
      continue;
    }
  }
  // 特性だけの質問（「へんげんじざいってどんな特性」）: 特性の語が名前の前に付かずに残っている
  if (!sides.length && !moves.length && mods.length === 1 && mods[0].k === "ability") {
    const hasW = (re: RegExp) => words.some((w) => re.test(w));
    if (hasW(/特性|トクセイ|効果/)) return { ability: mods[0].ja, intent: "ability" };
  }
  if (mods.length) return null; // 付け先のない条件が残った
  const has = (re: RegExp) => words.some((w) => re.test(w));
  // 能力を言わない「特化」はダメ計の攻撃側だけで使う。それ以外（素早さなど）では決まらないので AI に回す
  const bareSpec = sides.some((x) => x.cond.attack_max);
  if (bareSpec && !(sides.length === 2 && moves.length === 1)) return null;
  const conditions = (o: Obj) => {
    if (Object.keys(field).length) o.field = field;
    return o;
  };

  if ((sr || field.reflect || field.critical) && !(sides.length === 2 && moves.length === 1)) return null;
  if (bothSpread.length && !(sides.length === 2 && !moves.length)) return null;

  // 天候・フィールドが付いているのに、ダメージ・素早さ以外の質問になる場合は、条件を落とさないよう AI に回す
  const fieldUsed = Object.keys(field).length > 0;
  if (fieldUsed && !(sides.length === 2) && !(sides.length === 1 && has(/素早サ|スバヤサ|実数値/))) return null;

  // わざ 2 つの比べ（「しんそくとバレットパンチどっちが優先度高い？」）: それぞれの性能を答える
  if (!sides.length && moves.length === 2 && has(/優先度|ユウセンド|威力|イリョク/)) {
    return { queries: moves.map((m) => ({ move: m, intent: "move_info" })), intent: "multi" };
  }

  // わざの質問（ポケモンなし）
  if (!sides.length && moves.length === 1 && has(/タイプ|威力|イリョク|優先度|ユウセンド/)) return { move: moves[0], intent: "move_info" };

  // 覚える技: 「サーナイトってでんじは覚える？」
  if (sides.length === 1 && moves.length === 1 && has(/覚エ|オボエ/)) {
    if (Object.keys(sides[0].cond).length) return null;
    return { pokemon: sides[0].name, move: moves[0], intent: "learnset" };
  }

  // 相性: 「ハッサムにインファイトって効果抜群？」→ わざのタイプとポケモンの相性
  if (sides.length === 1 && moves.length === 1 && has(/効果|抜群|バツグン|効ク|効カナイ|イマヒトツ|今ヒトツ|相性/)) {
    if (Object.keys(sides[0].cond).length) return null;
    return { pokemon: sides[0].name, move: moves[0], intent: "type" };
  }

  // 1 匹とわざだけ: 足りない側を聞き返す（「ミミッキュのじゃれつく」→ 防御側がない）
  if (sides.length === 1 && moves.length === 1 && !has(/タイプ|威力|イリョク|覚エ|オボエ|弱点|種族値|素早サ|効果|抜群|効ク|効カナイ/)) {
    const sd = sides[0];
    const atkP = sd.particle === "ノ" || sd.particle === "ガ" || sd.particle === "カラ";
    const defP = sd.particle === "ニ" || sd.particle === "ヘ";
    if (atkP) return { attacker: sd.name, move: moves[0], missing: ["defender"], intent: "clarify" };
    if (defP) return { defender: sd.name, move: moves[0], missing: ["attacker"], intent: "clarify" };
    return null;
  }

  // 1 匹: タイプ・弱点・種族値・素早さ
  if (sides.length === 1 && !moves.length) {
    const p = sides[0];
    if (has(/特性|トクセイ/)) return { pokemon: p.name, intent: "ability" };
    if (has(/^ノコト$|^コト$/) && has(/教エテ/) && !has(/弱点|ジャクテン|タイプ|種族値|素早サ/)) return { pokemon: p.name, intent: "about" };
    if (has(/弱点|ジャクテン|タイプ|相性/) && !has(/素早サ|スバヤサ|種族値|シュゾクチ/)) return { pokemon: p.name, intent: "type" };
    if (has(/種族値|シュゾクチ/) && !has(/弱点|ジャクテン|タイプ/)) return { pokemon: p.name, intent: "stats" };
    if (has(/素早サ|スバヤサ|実数値/)) return { pokemon: p.name, conditions: conditions(Object.keys(p.cond).length ? { pokemon: p.cond } : {}), ask: "value", intent: "speed" };
    // 名前だけ（「ガブリアス」）: 何を調べるか聞き返す
    if (!words.length && !Object.keys(p.cond).length && toks.length === 1) return { pokemon: p.name, intent: "clarify" };
    return null;
  }

  // 2 匹・わざなし: 素早さ
  if (sides.length === 2 && !moves.length) {
    if (bothSpread.length) for (const sd of sides) applyMods(sd.cond, bothSpread);
    const threshold = has(/ドコマデ|何振リ/);
    if (!threshold && !has(/ドッチ|抜ケ|ヨリ速イ|ヨリハヤイ|ヨリ早イ|ヨリ遅イ/)) return null;
    const [a, b] = sides;
    const c: Obj = {};
    if (Object.keys(a.cond).length) c.attacker = a.cond;
    if (Object.keys(b.cond).length) c.defender = b.cond;
    if (threshold && b.cond.sp) return null; // 相手の振り方を聞いているのに、相手の振り方が指定されている
    return { attacker: a.name, defender: b.name, conditions: conditions(c), ask: threshold ? "threshold" : "compare", intent: "speed" };
  }

  // 2 匹・わざ 1 つ: ダメージ
  if (sides.length === 2 && moves.length === 1) {
    if (has(/タイプ|弱点|種族値|素早サ|スバヤサ|抜ケ|ドッチ|ヨリ速イ|ヨリハヤイ|ヨリ早イ|ヨリ遅イ/)) return null;
    if (sides.some((s) => s.particle === "ト")) return null; // 「AとBの〇〇」は向きが決まらない
    const role = (s: Side): "attacker" | "defender" | undefined =>
      s.particle === "ノ" || s.particle === "ガ" || s.particle === "カラ" ? "attacker" : s.particle === "ニ" || s.particle === "ヘ" || s.particle === "ヲ" ? "defender" : undefined;
    let [ra, rb] = sides.map(role);
    if (ra && !rb) rb = ra === "attacker" ? "defender" : "attacker";
    if (rb && !ra) ra = rb === "attacker" ? "defender" : "attacker";
    if (!ra || !rb || ra === rb) return null;
    const atk = ra === "attacker" ? sides[0] : sides[1];
    const def = ra === "attacker" ? sides[1] : sides[0];
    if (def.cond.attack_max) return null; // 防御側の「特化」は H・B か H・D か決まらない
    const c: Obj = {};
    if (sr) def.cond.stealth_rock = true;
    if (Object.keys(atk.cond).length) c.attacker = atk.cond;
    if (Object.keys(def.cond).length) c.defender = def.cond;
    return { attacker: atk.name, defender: def.name, move: moves[0], conditions: conditions(c), intent: "damage" };
  }
  return null;
}

/**
 * 続きの質問（「じゃあハチマキなら？」「じゃあ雨なら？」「じゃあガブがH振りだったら？」）を、直前の解釈に条件を足して解釈する。
 * 条件だけの発話のときだけ答える。足す先は、ポケモン名があればそのポケモン、なければ条件の種類で決める
 * （攻撃に効くもの → 攻撃側、耐久に効くもの → 防御側、天候など → 場）
 */
export function parseFollowUp(text: string, prev: Obj | null | undefined): Obj | null {
  if (!prev || (prev.intent !== "damage" && prev.intent !== "speed")) return null;
  const n = norm(text);
  if (!/^(ジャア|ジャ|デハ)/.test(n) || !/(ナラ|ダッタラ|ダト|場合ハ?|持ッテタラ|上ガッテタラ|下ガッテタラ|込ミダト|込ミナラ)[?？]?$/.test(n)) return null;
  const toks = tokenize(text);
  if (!toks) return null;
  const cond = JSON.parse(JSON.stringify(prev.conditions ?? {})) as Record<string, Obj>;
  const sideOf = (name: string) => (name === prev.attacker ? "attacker" : name === prev.defender ? "defender" : name === prev.pokemon ? "pokemon" : null);
  let target: string | null = null;
  let changed = false;
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    if (t.k === "p" || t.k === "w") continue;
    if (t.k === "pokemon") {
      target = sideOf(t.ja);
      if (!target) return null; // 前の質問にいないポケモン
      continue;
    }
    if (t.k === "move") return null;
    if (t.k === "weather" || t.k === "terrain") {
      cond.field = { ...(cond.field ?? {}), [t.k]: t.v };
      changed = true;
      continue;
    }
    // 足す先: 指定があればそのポケモン。なければ条件の種類で決める
    const side =
      target ??
      (prev.intent === "speed"
        ? prev.pokemon
          ? "pokemon"
          : "attacker"
        : t.k === "sr" || t.k === "hp"
          ? "defender"
          : t.k === "spread"
            ? (["atk", "spa"].includes(t.up ?? "") || Object.keys(t.sp).some((k) => k === "atk" || k === "spa"))
              ? "attacker"
              : "defender"
            : t.k === "boost"
              ? ["def", "spd"].includes(t.stat)
                ? "defender"
                : "attacker"
              : "attacker");
    const c = (cond[side] = { ...(cond[side] ?? {}) });
    if (t.k === "sr") c.stealth_rock = true;
    else applyMods(c, [t]);
    changed = true;
  }
  if (!changed) return null;
  return { ...prev, conditions: cond, uses_context: true };
}
