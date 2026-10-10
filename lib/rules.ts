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
    .replace(/\s+/g, "");
}

type Tok =
  | { k: "pokemon"; ja: string }
  | { k: "move"; ja: string }
  | { k: "item"; ja: string }
  | { k: "nature"; ja: string }
  | { k: "weather"; v: string }
  | { k: "terrain"; v: string }
  | { k: "spread"; sp: Partial<Record<Stat, number>>; up?: Stat; down?: Stat }
  | { k: "boost"; stat: Stat; n: number; conditional?: boolean } // conditional: 「上がったら」の形（付け先が前か後ろか決まらない）
  | { k: "sr" } // ステロ込み（防御側）
  | { k: "hp"; percent?: number; value?: number } // 残り HP（直後のポケモン）
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
  for (const ja of Object.keys(n.pokemon)) add(ja, { k: "pokemon", ja });
  for (const [al, ja] of Object.entries(a.pokemon)) if (n.pokemon[ja]) add(al, { k: "pokemon", ja });
  for (const ja of Object.keys(n.moves)) add(ja, { k: "move", ja });
  for (const [al, ja] of Object.entries(a.moves)) if (n.moves[ja]) add(al, { k: "move", ja });
  for (const ja of Object.keys(n.items)) add(ja, { k: "item", ja });
  // チャンピオンズにない持ち物（ハチマキなど）も持ち物として拾い、回答で「ないロト」と言わせる
  for (const [al, ja] of Object.entries(a.items)) add(al, { k: "item", ja });
  for (const ja of Object.keys(n.natures)) add(ja, { k: "nature", ja });
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
    "持ってたら", "持ってる", "もってたら", "だったら", "の場合は", "の場合", "場合", "じゃあ", "じゃ", "では", "なら", "だと",
    "覚える", "おぼえる", "覚えた", "を",
    "どこまで", "すばやさ振ってたら", "素早さ振ってたら", "振ってたら", "振ったら", "何振りまで", "何振りなら", "負ける", "抜かれる", "までなら", "まで",
  ]) add(w, { k: "w", v: norm(w) });
  // 長い語から先に照合する
  list.sort((x, y) => y[0].length - x[0].length);
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
    if (v === "半分") return [m[0].length, { k: "hp", percent: 50 }];
    if (v.endsWith("割")) return [m[0].length, { k: "hp", percent: Number(v[0]) * 10 }];
    if (/%|パーセント/.test(v)) return [m[0].length, { k: "hp", percent: Number(v.replace(/\D/g, "")) }];
    return [m[0].length, { k: "hp", value: Number(v) }];
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
    else if (t.k === "hp") {
      if (t.percent !== undefined) cond.hp_left_percent = t.percent;
      if (t.value !== undefined) cond.hp_left = t.value;
    }
  }
}

/** 文を解釈する。確実に分かるときだけ結果を返す */
export function parseRules(text: string): Obj | null {
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
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    const next = toks[i + 1];
    if (t.k === "weather" || t.k === "terrain") {
      if (field[t.k]) return null;
      field[t.k] = t.v;
      if (next?.k === "p" && ["ノ", "デ"].includes(next.v)) i++; // 「雨の」「晴れで」
      continue;
    }
    if (t.k === "sr") {
      sr = true;
      if (next?.k === "p" && ["ノ", "デ"].includes(next.v)) i++; // 「ステロ込みで」
      continue;
    }
    // 名前の後ろの残り HP（「エンペルトのHP120残ってる」）: 直前のポケモンに付ける
    if (t.k === "hp" && !mods.length && (toks[i - 1] as Tok | undefined)?.k === "p" && (toks[i - 1] as { v: string }).v === "ノ" && toks[i - 2]?.k === "pokemon" && sides.length) {
      const last = sides[sides.length - 1];
      if (t.percent !== undefined) last.cond.hp_left_percent = t.percent;
      if (t.value !== undefined) last.cond.hp_left = t.value;
      last.particle = next?.k === "p" ? next.v : undefined;
      continue;
    }
    if (t.k === "spread" || t.k === "item" || t.k === "nature" || t.k === "boost" || t.k === "hp") {
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

  if (sr && !(sides.length === 2 && moves.length === 1)) return null;

  // わざの質問（ポケモンなし）
  if (!sides.length && moves.length === 1 && has(/タイプ|威力|イリョク/)) return { move: moves[0], intent: "move_info" };

  // 覚える技: 「サーナイトってでんじは覚える？」
  if (sides.length === 1 && moves.length === 1 && has(/覚エ|オボエ/)) {
    if (Object.keys(sides[0].cond).length) return null;
    return { pokemon: sides[0].name, move: moves[0], intent: "learnset" };
  }

  // 1 匹: タイプ・弱点・種族値・素早さ
  if (sides.length === 1 && !moves.length) {
    const p = sides[0];
    if (has(/弱点|ジャクテン|タイプ|相性/) && !has(/素早サ|スバヤサ|種族値|シュゾクチ/)) return { pokemon: p.name, intent: "type" };
    if (has(/種族値|シュゾクチ/) && !has(/弱点|ジャクテン|タイプ/)) return { pokemon: p.name, intent: "stats" };
    if (has(/素早サ|スバヤサ|実数値/)) return { pokemon: p.name, conditions: conditions(Object.keys(p.cond).length ? { pokemon: p.cond } : {}), ask: "value", intent: "speed" };
    return null;
  }

  // 2 匹・わざなし: 素早さ
  if (sides.length === 2 && !moves.length) {
    const threshold = has(/ドコマデ|何振リ/);
    if (!threshold && !has(/ドッチガ|抜ケ/)) return null;
    const [a, b] = sides;
    const c: Obj = {};
    if (Object.keys(a.cond).length) c.attacker = a.cond;
    if (Object.keys(b.cond).length) c.defender = b.cond;
    if (threshold && b.cond.sp) return null; // 相手の振り方を聞いているのに、相手の振り方が指定されている
    return { attacker: a.name, defender: b.name, conditions: conditions(c), ask: threshold ? "threshold" : "compare", intent: "speed" };
  }

  // 2 匹・わざ 1 つ: ダメージ
  if (sides.length === 2 && moves.length === 1) {
    if (has(/タイプ|弱点|種族値|素早サ|スバヤサ|抜ケ|ドッチガ/)) return null;
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
