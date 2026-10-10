// 1 往復の処理（構成設計 4.2）: AI 取り出し → 名前の解決 → 計算 → 回答文
// answerExtraction は通信をしないので、保存済みの AI の出力を流し込んで確かめられる（eval/replay.ts）
import { allTypes, damage, effectiveness, hasSpread, moveInfo, speciesInfo, speedOf, speedThreshold, speedVariants, type FieldInput, type SideInput, type Stat } from "./battle";
import { CATEGORY_JA, clarifySpeech, damageQuestionOf, damageSpeech, koText } from "./answer";
import { extract, type Attempt, type Turn } from "./llm";
import { resolve, resolveField, toJa, type NameKind } from "./resolve";
import { parseRules } from "./rules";

export interface AskResult {
  /** 読み上げる文 */
  speech: string;
  /** 画面の見出し（質問の解釈） */
  title: string;
  /** 画面に出す詳しい結果 */
  lines: string[];
  intent: string;
  /** 次の質問の文脈に使う取り出し結果 */
  extraction?: Record<string, unknown> | null;
  diagnostics?: { provider?: string; attempts: Attempt[]; totalMs: number };
}

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => (v && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : {});
const str = (v: unknown): string | undefined => (typeof v === "string" && v.trim() ? v.trim() : undefined);
const num = (v: unknown): number | undefined => {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : undefined;
};

const STAT_KEYS: Record<string, Stat> = {
  hp: "hp", h: "hp", atk: "atk", attack: "atk", a: "atk", def: "def", defense: "def", b: "def",
  spa: "spa", spatk: "spa", c: "spa", spd: "spd", spdef: "spd", d: "spd", spe: "spe", speed: "spe", s: "spe",
};
const statKey = (k: unknown): Stat | undefined => (typeof k === "string" ? STAT_KEYS[k.toLowerCase().replace(/[^a-z]/g, "")] : undefined);
const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, Math.round(n)));

/** 名前の解決で見つかった問題（「〇〇は分からないロト」など） */
class Problems {
  list: string[] = [];
  notes: string[] = [];
  /** 読み上げない注意（画面にだけ出す） */
  quiet: string[] = [];
  /** 解決できなくても読み上げない（特性など、AI が余計に書きがちで計算への影響が小さいもの） */
  soft(kind: NameKind, heard: string | undefined): { en: string; ja: string } | undefined {
    if (!heard) return undefined;
    const r = resolve(kind, heard);
    if (r.ok) return { en: r.en, ja: r.ja };
    this.quiet.push(`「${heard}」は${r.notInGame ? "チャンピオンズにない" : "分からない"}ので無視した`);
    return undefined;
  }
  name(kind: NameKind, heard: string | undefined): { en: string; ja: string } | undefined {
    if (!heard) return undefined;
    const r = resolve(kind, heard);
    if (r.ok) {
      if (r.fuzzy) this.notes.push(`${r.ja}のことだと思って計算したロト`);
      return { en: r.en, ja: r.ja };
    }
    if (r.notInGame) this.list.push(`${r.notInGame}はチャンピオンズに${kind === "pokemon" ? "いない" : "ない"}ロト`);
    else if (r.candidates.length) this.list.push(`${r.candidates.join("と")}、どれのことロト？`);
    else this.list.push(`${heard}は分からないロト`);
    return undefined;
  }
}

function side(species: string, c: Obj, pr: Problems): SideInput {
  const s: SideInput = { species };
  const item = pr.name("items", str(c.item));
  if (item) s.item = item.en;
  const ability = pr.soft("abilities", str(c.ability));
  if (ability) s.ability = ability.en;
  const natureName = str(c.nature);
  if (natureName) {
    const n = resolve("natures", natureName);
    if (n.ok) s.nature = n.en;
  }
  s.natureUp = statKey(c.nature_up);
  s.natureDown = statKey(c.nature_down);
  const sp: SideInput["sp"] = {};
  for (const [k, v] of Object.entries(obj(c.sp))) {
    const key = statKey(k);
    const n = num(v);
    if (key && n !== undefined) sp[key] = clamp(n === 252 ? 32 : n, 0, 32);
  }
  // 古い形（speed: max / min / neutral）
  if (c.speed === "max") [sp.spe, s.natureUp] = [32, "spe"];
  if (c.speed === "neutral") sp.spe = 32;
  if (c.speed === "min") [sp.spe, s.natureDown] = [0, "spe"];
  if (Object.keys(sp).length) s.sp = sp;
  const boosts: SideInput["boosts"] = {};
  for (const [k, v] of Object.entries(obj(c.boosts))) {
    const key = statKey(k);
    const n = num(v);
    if (key && key !== "hp" && n !== undefined && n !== 0) boosts[key] = clamp(n, -6, 6);
  }
  if (Object.keys(boosts).length) s.boosts = boosts;
  const hpLeft = num(c.hp_left);
  if (hpLeft !== undefined && hpLeft > 0) s.hpLeft = hpLeft;
  const hpPct = num(c.hp_left_percent);
  if (hpPct !== undefined && hpPct > 0 && hpPct <= 100) s.hpLeftPercent = hpPct;
  if (c.stealth_rock === true) s.stealthRock = true;
  return s;
}

function fieldOf(f: Obj): FieldInput {
  const out: FieldInput = {};
  const w = str(f.weather);
  if (w) out.weather = resolveField("weather", w);
  const t = str(f.terrain);
  if (t) out.terrain = resolveField("terrain", t);
  if (f.reflect === true) out.reflect = true;
  if (f.light_screen === true) out.lightScreen = true;
  if (f.critical === true) out.critical = true;
  return out;
}

const fail = (intent: string, title: string, msgs: string[]): AskResult => ({ speech: msgs.join("。"), title, lines: msgs, intent });

/** 側の条件を短い文字にする（画面の見出し用） */
function sideLabel(ja: string, s: SideInput): string {
  const parts: string[] = [];
  const sp = Object.entries(s.sp ?? {}).filter(([, v]) => v).map(([k, v]) => `${({ hp: "H", atk: "A", def: "B", spa: "C", spd: "D", spe: "S" } as Record<string, string>)[k]}${v}`);
  if (sp.length) parts.push(sp.join(""));
  if (s.natureUp) parts.push(`${({ hp: "H", atk: "A", def: "B", spa: "C", spd: "D", spe: "S" } as Record<string, string>)[s.natureUp]}↑`);
  if (s.natureDown) parts.push(`${({ atk: "A", def: "B", spa: "C", spd: "D", spe: "S" } as Record<string, string>)[s.natureDown]}↓`);
  if (s.nature) parts.push(toJa("natures", s.nature));
  for (const [k, v] of Object.entries(s.boosts ?? {})) parts.push(`${({ atk: "A", def: "B", spa: "C", spd: "D", spe: "S" } as Record<string, string>)[k]}${v > 0 ? "+" : ""}${v}`);
  if (s.item) parts.push(toJa("items", s.item));
  if (s.ability) parts.push(toJa("abilities", s.ability));
  if (s.hpLeft) parts.push(`残りHP${s.hpLeft}`);
  if (s.hpLeftPercent) parts.push(`残りHP${s.hpLeftPercent}%`);
  if (s.stealthRock) parts.push("ステロ込み");
  return parts.length ? `${ja}（${parts.join("・")}）` : ja;
}

function fieldLabel(f: FieldInput): string {
  const parts = [f.weather && `天候 ${f.weather}`, f.terrain && `${f.terrain} Terrain`, f.reflect && "リフレクター", f.lightScreen && "ひかりのかべ", f.critical && "急所"].filter(Boolean);
  return parts.length ? ` ［${parts.join("・")}］` : "";
}

function answerDamage(ex: Obj, text?: string): AskResult {
  const pr = new Problems();
  const c = obj(ex.conditions);
  const a = pr.name("pokemon", str(ex.attacker));
  const d = pr.name("pokemon", str(ex.defender));
  const m = pr.name("moves", str(ex.move));
  if (!str(ex.attacker) || !str(ex.defender) || !str(ex.move)) {
    const missing = [!str(ex.attacker) && "attacker", !str(ex.defender) && "defender", !str(ex.move) && "move"].filter(Boolean) as string[];
    return fail("clarify", "聞き返し", [...pr.list, clarifySpeech(missing)]);
  }
  if (!a || !d || !m) return fail("damage", "名前の確認", pr.list);
  const as = side(a.en, obj(c.attacker), pr);
  const ds = side(d.en, obj(c.defender), pr);
  const f = fieldOf(obj(c.field));
  const result = damage(as, ds, m.en, f);
  const special = result.category === "Special";
  const open = { attacker: !hasSpread(as, [special ? "spa" : "atk"]), defender: !hasSpread(ds, ["hp", special ? "spd" : "def"]) };
  const { speech, lines } = damageSpeech({ attacker: a.ja, defender: d.ja, move: m.ja }, result, [...pr.notes, ...pr.list], {
    question: damageQuestionOf(text),
    open,
    stealthRock: ds.stealthRock,
  });
  lines.push(...pr.quiet);
  if (result.assumed.length) lines.push(`仮定: ${result.assumed.map((x) => (x.includes("振り方") ? `${x}は無振り（幅も表示）` : x)).join("、")}`);
  lines.push(result.base.desc);
  return {
    speech,
    title: `${sideLabel(a.ja, as)}の${m.ja} → ${sideLabel(d.ja, ds)}${fieldLabel(f)}`,
    lines,
    intent: "damage",
  };
}

function answerSpeed(ex: Obj): AskResult {
  const pr = new Problems();
  const c = obj(ex.conditions);
  const f = fieldOf(obj(c.field));
  const ask = str(ex.ask) ?? "compare";
  const subjName = str(ex.attacker) ?? str(ex.pokemon);
  const otherName = str(ex.attacker) ? str(ex.defender) : str(ex.defender);
  const subj = pr.name("pokemon", subjName);
  const other = pr.name("pokemon", otherName);
  if (!subjName) return fail("clarify", "聞き返し", ["どのポケモンの素早さロト？"]);
  if (!subj || (otherName && !other)) return fail("speed", "名前の確認", pr.list);
  const sc = obj(str(ex.attacker) ? c.attacker : (c.pokemon ?? c.attacker));
  const ss = side(subj.en, sc, pr);
  const subjOpen = ss.sp?.spe === undefined && !ss.natureUp && !ss.nature;
  const notes = [...pr.notes, ...pr.list];
  const pre = notes.length ? `${notes.join("。")}。` : "";

  // 1 匹だけ（素早さの値）
  if (!other) {
    if (!subjOpen) {
      const v = speedOf(ss, f);
      return { speech: `${pre}${subj.ja}の素早さは${v}ロト`, title: `${sideLabel(subj.ja, ss)}の素早さ`, lines: [`素早さ ${v}`], intent: "speed" };
    }
    const v = speedVariants(ss, f);
    return {
      speech: `${pre}${subj.ja}の素早さは、最速${v.fastest}、準速${v.neutral}、無振り${v.none}ロト`,
      title: `${sideLabel(subj.ja, ss)}の素早さ`,
      lines: [`最速 ${v.fastest}／準速 ${v.neutral}／無振り ${v.none}／最遅 ${v.slowest}`],
      intent: "speed",
    };
  }

  const os = side(other.en, obj(c.defender), pr);
  const otherOpen = os.sp?.spe === undefined && !os.natureUp && !os.nature;
  const title = `${sideLabel(subj.ja, ss)} と ${sideLabel(other.ja, os)}の素早さ${fieldLabel(f)}`;
  const sv = speedOf(ss, f);

  if (ask === "threshold") {
    const t = speedThreshold(sv, os, f);
    const subjNote = subjOpen ? `${subj.ja}は無振りで${sv}として計算したロト。` : "";
    const part = (label: string, r: { faster: number | null; tie: number | null }) =>
      r.faster === null ? `${label}だと最大まで振っても抜けない` : `${label}でSP${r.faster}以上`;
    const lines = [
      `${subj.ja}: ${sv}`,
      `${other.ja}が上回る SP: 補正なし ${t.neutral.faster ?? "なし"}／補正あり ${t.plus.faster ?? "なし"}`,
      `同速になる SP: 補正なし ${t.neutral.tie ?? "なし"}／補正あり ${t.plus.tie ?? "なし"}`,
    ];
    if (t.neutral.faster === 0) {
      return { speech: `${pre}${subjNote}${other.ja}は無振りでも${subj.ja}より速いロト。抜けないロト`, title, lines, intent: "speed" };
    }
    if (t.neutral.faster === null && t.plus.faster === null) {
      return { speech: `${pre}${subjNote}${other.ja}が最速でも${subj.ja}の方が速いロト！`, title, lines, intent: "speed" };
    }
    return { speech: `${pre}${subjNote}${other.ja}が${part("補正なし", t.neutral)}、${part("補正あり", t.plus)}なら、${subj.ja}が抜かれるロト`, title, lines, intent: "speed" };
  }

  // 比べる（compare）
  const cmp = (x: number, y: number) => (x > y ? "速い" : x < y ? "遅い" : "同速");
  if (!otherOpen) {
    const ov = speedOf(os, f);
    if (subjOpen && otherOpen === false) {
      const v = speedVariants(ss, f);
      const lines = [`${other.ja}: ${ov}`, `${subj.ja}: 最速 ${v.fastest}／準速 ${v.neutral}／無振り ${v.none}`];
      const need: [string, number] | null = v.fastest > ov ? (v.neutral > ov ? (v.none > ov ? ["無振り", v.none] : ["準速", v.neutral]) : ["最速", v.fastest]) : null;
      const speech = need
        ? `${pre}${subj.ja}は${need[0]}${need[0] === "無振り" ? "でも" : "なら"}${need[1]}で、${other.ja}（${ov}）を抜けるロト！`
        : `${pre}${subj.ja}は最速でも${v.fastest}で、${other.ja}（${ov}）を抜けないロト`;
      return { speech, title, lines, intent: "speed" };
    }
    const r = cmp(sv, ov);
    const speech = r === "同速" ? `${pre}同速ロト！ どちらも${sv}ロト` : r === "速い" ? `${pre}${subj.ja}の方が速いロト！ ${sv}対${ov}ロト` : `${pre}${other.ja}の方が速いロト。${sv}対${ov}ロト`;
    return { speech, title, lines: [`${subj.ja} ${sv} ／ ${other.ja} ${ov}`], intent: "speed" };
  }
  // 相手の振り方が分からない: 相手の最速・準速・無振りと比べる
  const ov = speedVariants(os, f);
  const subjSpeech = subjOpen ? `最速同士なら` : "";
  const s2 = subjOpen ? speedOf({ ...ss, sp: { ...ss.sp, spe: 32 }, natureUp: "spe" }, f) : sv;
  const lines = [`${subj.ja}: ${s2}${subjOpen ? "（最速で計算）" : ""}`, `${other.ja}: 最速 ${ov.fastest}／準速 ${ov.neutral}／無振り ${ov.none}`];
  if (subjOpen) {
    const r = cmp(s2, ov.fastest);
    const speech = r === "同速" ? `${pre}最速同士だと同速ロト！ ${s2}ロト` : r === "速い" ? `${pre}最速同士なら${subj.ja}の方が速いロト！ ${s2}対${ov.fastest}ロト` : `${pre}最速同士なら${other.ja}の方が速いロト。${s2}対${ov.fastest}ロト`;
    return { speech: subjSpeech ? speech : speech, title, lines, intent: "speed" };
  }
  let speech: string;
  if (s2 > ov.fastest) speech = `${subj.ja}（${s2}）は、${other.ja}が最速（${ov.fastest}）でも抜けるロト！`;
  else if (s2 === ov.fastest) speech = `${other.ja}が最速だと同速ロト。${s2}ロト`;
  else if (s2 > ov.neutral) speech = `準速の${other.ja}（${ov.neutral}）なら抜けるけど、最速（${ov.fastest}）には抜かれるロト`;
  else if (s2 > ov.none) speech = `無振りの${other.ja}（${ov.none}）なら抜けるけど、準速（${ov.neutral}）には抜かれるロト`;
  else speech = `${other.ja}が無振り（${ov.none}）でも抜けないロト。${subj.ja}は${s2}ロト`;
  return { speech: pre + speech, title, lines, intent: "speed" };
}

function answerType(ex: Obj): AskResult {
  const pr = new Problems();
  const p = pr.name("pokemon", str(ex.pokemon) ?? str(ex.attacker) ?? str(ex.defender));
  if (!p) return fail("type", "名前の確認", pr.list.length ? pr.list : ["どのポケモンのタイプロト？"]);
  const info = speciesInfo(p.en);
  if (!info) return fail("type", p.ja, [`${p.ja}のデータが見つからないロト`]);
  const tj = (t: string) => toJa("types", t);
  const by = new Map<number, string[]>();
  for (const t of allTypes()) {
    const x = effectiveness(t, info.types);
    by.set(x, [...(by.get(x) ?? []), tj(t)]);
  }
  const weak4 = by.get(4) ?? [];
  const weak2 = by.get(2) ?? [];
  const immune = by.get(0) ?? [];
  const types = info.types.map(tj).join("・");
  const weak = [...weak4.map((t) => `${t}（4倍）`), ...weak2].join("、") || "なし";
  const lines = [`タイプ: ${types}`, `弱点: ${weak}`, `半減: ${[...(by.get(0.25) ?? []).map((t) => `${t}（1/4）`), ...(by.get(0.5) ?? [])].join("、") || "なし"}`, `無効: ${immune.join("、") || "なし"}`];
  const speech = `${pr.notes.length ? pr.notes.join("。") + "。" : ""}${p.ja}は${types}タイプ。弱点は${weak}ロト${immune.length ? `。${immune.join("と")}は効かないロト` : ""}`;
  return { speech, title: `${p.ja}のタイプ`, lines, intent: "type" };
}

function answerStats(ex: Obj): AskResult {
  const pr = new Problems();
  const p = pr.name("pokemon", str(ex.pokemon) ?? str(ex.attacker));
  if (!p) return fail("stats", "名前の確認", pr.list.length ? pr.list : ["どのポケモンの種族値ロト？"]);
  const b = speciesInfo(p.en)!.baseStats;
  const total = Object.values(b).reduce((x, y) => x + y, 0);
  const t = `H${b.hp} A${b.atk} B${b.def} C${b.spa} D${b.spd} S${b.spe}`;
  return { speech: `${p.ja}の種族値は、H${b.hp}、A${b.atk}、B${b.def}、C${b.spa}、D${b.spd}、S${b.spe}。合計${total}ロト`, title: `${p.ja}の種族値`, lines: [`${t}（合計 ${total}）`], intent: "stats" };
}

function answerMove(ex: Obj): AskResult {
  const pr = new Problems();
  const m = pr.name("moves", str(ex.move));
  if (!m) return fail("move_info", "名前の確認", pr.list.length ? pr.list : ["どの技ロト？"]);
  const i = moveInfo(m.en);
  const type = toJa("types", i.type);
  const cat = CATEGORY_JA[i.category] ?? i.category;
  const pri = i.priority ? `、優先度${i.priority > 0 ? "+" : ""}${i.priority}` : "";
  const bp = i.bp ? `威力${i.bp}` : "威力なし";
  return { speech: `${m.ja}は${type}タイプの${cat}技。${bp}${pri}ロト`, title: `${m.ja}の性能`, lines: [`${type}・${cat}・${bp}${pri}`], intent: "move_info" };
}

/** 取り出し結果から答えを作る（通信なし） */
export function answerExtraction(ex: Obj, text?: string): AskResult {
  const intent = str(ex.intent) ?? "clarify";
  const missing = Array.isArray(ex.missing) ? (ex.missing as string[]) : [];
  try {
    switch (intent) {
      case "damage":
        return answerDamage(ex, text);
      case "speed":
        return answerSpeed(ex);
      case "type":
        return answerType(ex);
      case "stats":
        return answerStats(ex);
      case "move_info":
        return answerMove(ex);
      case "learnset":
        return fail("learnset", "覚える技", ["覚える技のデータはまだ準備中ロト"]);
      case "my_team":
        return fail("my_team", "自分のパーティ", ["自分のパーティの機能はまだ勉強中ロト"]);
      case "chat":
        return fail("chat", "雑談", ["おしゃべりはまだ勉強中ロト。計算なら任せてロト！"]);
      case "multi": {
        const qs = (Array.isArray(ex.queries) ? ex.queries : []).map(obj).slice(0, 3);
        if (!qs.length) return fail("clarify", "聞き返し", [clarifySpeech([])]);
        const rs = qs.map((q) => answerExtraction(q));
        return { speech: rs.map((r) => r.speech).join("。"), title: rs.map((r) => r.title).join(" ／ "), lines: rs.flatMap((r) => r.lines), intent: "multi" };
      }
      case "clarify": {
        // 攻撃側・防御側・わざが揃っているのに聞き返しになっている場合は、ダメージ計算として扱う（eval-plan.md 7.7 の補正案）
        if (!missing.length && str(ex.attacker) && str(ex.defender) && str(ex.move)) return answerDamage(ex, text);
        const pr = new Problems();
        for (const [k, kind] of [["attacker", "pokemon"], ["defender", "pokemon"], ["move", "moves"]] as const) pr.name(kind, str(ex[k]));
        return fail("clarify", "聞き返し", [...pr.list, clarifySpeech(missing)]);
      }
      default:
        return fail("clarify", "聞き返し", [clarifySpeech([])]);
    }
  } catch (e) {
    // 計算ライブラリの例外（知らない技・ポケモンの組み合わせなど）。読み上げは短く、画面に原因を出す
    return { speech: "ごめん、うまく計算できなかったロト", title: "エラー", lines: [String((e as Error).message)], intent };
  }
}

/** 文字の質問に答える（AI 取り出しを含む 1 往復） */
export async function ask(text: string, opts: { history?: Turn[]; useRules?: boolean } = {}): Promise<AskResult> {
  const t0 = Date.now();
  // まずルールで即答を試す（確実に分かるときだけ結果が返る）。駄目なら AI
  const ruled = opts.useRules === false ? null : parseRules(text);
  if (ruled) {
    const out = answerExtraction(ruled, text);
    return { ...out, extraction: ruled, diagnostics: { provider: "rules", attempts: [], totalMs: Date.now() - t0 } };
  }
  const r = await extract(text, { history: opts.history });
  if (!r.extraction) {
    return {
      speech: r.attempts.length ? "いま混み合ってるロト。少し待ってからもう一回聞いてほしいロト" : "AI の設定がまだロト（API キーが必要）",
      title: "AI に接続できない",
      lines: r.attempts.map((a) => `${a.provider}: ${a.error}`),
      intent: "error",
      extraction: null,
      diagnostics: { attempts: r.attempts, totalMs: Date.now() - t0 },
    };
  }
  const out = answerExtraction(r.extraction, text);
  return { ...out, extraction: r.extraction, diagnostics: { provider: r.provider, attempts: r.attempts, totalMs: Date.now() - t0 } };
}

export { koText };
