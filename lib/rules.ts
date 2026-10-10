// ルール解析（構成設計 4.2 の 2）: よくある言い方を AI を使わずに解釈する。AI と同じ形（lib/extractPrompt.ts）を返す
// 方針: 文の中の語が**すべて**辞書・決まった言い回しで説明できたときだけ結果を返す。知らない語が少しでも残れば null（AI に回す）
// （試作版のルール解析が「HPに32振った」を黙って落とした反省。eval-plan.md 7.6）
import names from "../data/names.json";
import aliases from "../data/aliases.json";

type Obj = Record<string, unknown>;
type Stat = "hp" | "atk" | "def" | "spa" | "spd" | "spe";

/** NFKC・ひらがな→カタカナ・空白除去（句読点は区切りとして残す） */
function norm(s: string): string {
  return s
    .normalize("NFKC")
    .replace(/[ぁ-ゖ]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 0x60))
    .replace(/\s+/g, "")
    // 能力の略号の読み（音声認識がカタカナで書くことがある:「エー特化」「エイチビー振り」「エス二段階」）。
    // 特化・振り・段階・＋−・補正の直前に続くときだけ直す（「エースバーン」などを壊さない）
    .replace(/((?:エイチ|エッチ|エー|エイ|ビー|シー|ディー|デー|エス)+)(?=特化|振リ|段階|[+\-]|補正|252|ガ?[1-6一二三四五六]段階)/g, (m) =>
      LETTER_READING.reduce((x, [re, l]) => x.replace(re, l), m),
    )
    .replace(/([hbacds]+)(?=特化|振リ|段階|[+\-]|補正|252)/g, (m) => m.toUpperCase());
}

/** 能力の略号の読み → 略号 */
const LETTER_READING: [RegExp, string][] = [
  [/エイチ|エッチ/g, "H"], [/エー|エイ/g, "A"], [/ビー/g, "B"], [/シー/g, "C"], [/ディー|デー/g, "D"], [/エス/g, "S"],
];

type Tok =
  | { k: "pokemon"; ja: string }
  | { k: "move"; ja: string }
  | { k: "item"; ja: string }
  | { k: "nature"; ja: string }
  | { k: "ability"; ja: string } // 特性（直後のポケモン）
  | { k: "weather"; v: string }
  | { k: "terrain"; v: string }
  | { k: "spread"; sp: Partial<Record<Stat, number>>; up?: Stat; down?: Stat; both?: boolean } // both: 「準速同士」
  | { k: "boost"; stat: Stat; n: number; conditional?: boolean } // conditional: 「上がったら」の形（付け先が前か後ろか決まらない）
  | { k: "sr" } // ステロ込み（防御側）
  | { k: "flag"; f: "reflect" | "critical" } // 壁・急所（場）
  | { k: "hp"; percent?: number; value?: number; left?: boolean } // 残り HP（直後のポケモン）。left: 「残り」「残ってる」が付いていた
  | { k: "status"; v: string } // 状態異常（直後のポケモン）
  | { k: "p"; v: string } // 助詞・区切り
  | { k: "w"; v: string }; // 質問の言い回し

const LETTER: Record<string, Stat> = { H: "hp", A: "atk", B: "def", C: "spa", D: "spd", S: "spe" };

let dict: [string, Tok][] | null = null;
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
  for (const [w, v] of Object.entries(a.weather)) add(w, { k: "weather", v: w });
  for (const [t] of Object.entries(a.terrain)) add(t, { k: "terrain", v: t });
  // 助詞・区切り
  for (const p of ["の", "に", "へ", "で", "が", "と", "から", "、", ",", "って", "は"]) add(p, { k: "p", v: norm(p) });
  // 質問の言い回し（意味を持たない、または質問の種類を表す語）
  for (const w of [
    "何発", "なんぱつ", "確定", "確定数", "耐える", "耐えれる", "耐えられる", "落ちる", "落とせる", "倒せる", "どれくらい", "どのくらい", "減る",
    "どっちが速い", "どっちがはやい", "どっちが早い", "どっちが先", "抜ける", "抜かれる", "素早さ", "すばやさ", "実数値", "いくつ",
    "タイプ", "弱点", "相性", "種族値", "威力", "何タイプ", "教えて", "？", "?", "。", "!", "！", "撃ったら", "うったら", "だと", "なら",
    "んだけど", "だけど", "けど",
    "じゃくてん", "しゅぞくち", "いりょく", "なんタイプ", "なんぱつ",
    "優先度", "ゆうせんど",
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
  m = s.match(/^([HABCDS]{1,3})(?:振リ|252|極振リ)/);
  if (m) return [m[0].length, { k: "spread", sp: Object.fromEntries([...m[1]].map((c) => [LETTER[c], 32])) }];
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
  const d = dictionary();
  const out: Tok[] = [];
  let i = 0;
  outer: while (i < s.length) {
    const rest = s.slice(i);
    const pt = pattern(rest);
    if (pt) {
      out.push(pt[1]);
      i += pt[0];
      continue;
    }
    for (const [surface, t] of d) {
      if (rest.startsWith(surface)) {
        // 持ち物の後ろの「持ち」「もち」は読み飛ばす
        out.push(t);
        i += surface.length;
        if (t.k === "item") {
          const mm = s.slice(i).match(/^(持チ|モチ)/);
          if (mm) i += mm[0].length;
        }
        if (t.k === "ability") {
          const mm = s.slice(i).match(/^(込ミ|コミ|持チ|アリ)/);
          if (mm) i += mm[0].length;
        }
        continue outer;
      }
    }
    return null;
  }
  return out;
}

interface Side {
  name: string;
  cond: Obj;
  particle?: string;
}

function applyMods(cond: Obj, mods: Tok[]) {
  for (const t of mods) {
    if (t.k === "spread") {
      cond.sp = { ...(cond.sp as Obj | undefined), ...t.sp };
      if (t.up) cond.nature_up = t.up;
      if (t.down) cond.nature_down = t.down;
    } else if (t.k === "item") cond.item = t.ja;
    else if (t.k === "nature") cond.nature = t.ja;
    else if (t.k === "boost") cond.boosts = { ...(cond.boosts as Obj | undefined), [t.stat]: t.n };
    else if (t.k === "status") cond.status = t.v;
    else if (t.k === "ability") cond.ability = t.ja;
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
    if (t.k === "spread" || t.k === "item" || t.k === "nature" || t.k === "boost" || t.k === "hp" || t.k === "status" || t.k === "ability") {
      mods.push(t);
      continue;
    }
    if (t.k === "pokemon") {
      const cond: Obj = {};
      applyMods(cond, mods);
      mods = [];
      sides.push({ name: t.ja, cond, particle: next?.k === "p" ? next.v : undefined });
      continue;
    }
    if (t.k === "move") {
      if (mods.length) return null; // わざの前の条件は付け先が分からない
      moves.push(t.ja);
      continue;
    }
  }
  if (mods.length) return null; // 付け先のない条件が残った
  const has = (re: RegExp) => words.some((w) => re.test(w));
  const conditions = (o: Obj) => {
    if (Object.keys(field).length) o.field = field;
    return o;
  };

  if ((sr || field.reflect || field.critical) && !(sides.length === 2 && moves.length === 1)) return null;
  if (bothSpread.length && !(sides.length === 2 && !moves.length)) return null;

  // 天候・フィールドが付いているのに、ダメージ・素早さ以外の質問になる場合は、条件を落とさないよう AI に回す
  const fieldUsed = Object.keys(field).length > 0;
  if (fieldUsed && !(sides.length === 2) && !(sides.length === 1 && has(/素早サ|スバヤサ|実数値/))) return null;

  // わざの質問（ポケモンなし）
  if (!sides.length && moves.length === 1 && has(/タイプ|威力|イリョク|優先度|ユウセンド/)) return { move: moves[0], intent: "move_info" };

  // 覚える技: 「サーナイトってでんじは覚える？」
  if (sides.length === 1 && moves.length === 1 && has(/覚エ|オボエ/)) {
    if (Object.keys(sides[0].cond).length) return null;
    return { pokemon: sides[0].name, move: moves[0], intent: "learnset" };
  }

  // 1 匹とわざだけ: 足りない側を聞き返す（「ミミッキュのじゃれつく」→ 防御側がない）
  if (sides.length === 1 && moves.length === 1 && !has(/タイプ|威力|イリョク|覚エ|オボエ|弱点|種族値|素早サ/)) {
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
      s.particle === "ノ" || s.particle === "ガ" || s.particle === "カラ" ? "attacker" : s.particle === "ニ" || s.particle === "ヘ" ? "defender" : undefined;
    let [ra, rb] = sides.map(role);
    if (ra && !rb) rb = ra === "attacker" ? "defender" : "attacker";
    if (rb && !ra) ra = rb === "attacker" ? "defender" : "attacker";
    if (!ra || !rb || ra === rb) return null;
    const atk = ra === "attacker" ? sides[0] : sides[1];
    const def = ra === "attacker" ? sides[1] : sides[0];
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
