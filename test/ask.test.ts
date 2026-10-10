import { describe, expect, it } from "vitest";
import { answerExtraction } from "../lib/ask";
import { damage, speedOf, speedThreshold, speedVariants } from "../lib/battle";
import { extract, providersFromEnv, type Provider } from "../lib/llm";
import { resolve } from "../lib/resolve";
import aliases from "../data/aliases.json";
import names from "../data/names.json";

describe("名前の解決", () => {
  it("正式名・英語名・あだ名", () => {
    expect(resolve("pokemon", "ガブリアス")).toMatchObject({ ok: true, en: "Garchomp", fuzzy: false });
    expect(resolve("pokemon", "garchomp")).toMatchObject({ ok: true, en: "Garchomp" });
    expect(resolve("pokemon", "ガブ")).toMatchObject({ ok: true, en: "Garchomp" });
    expect(resolve("pokemon", "水ロトム")).toMatchObject({ ok: true, en: "Rotom-Wash" });
    expect(resolve("pokemon", "メガルカリオZ")).toMatchObject({ ok: true, en: "Lucario-Mega-Z" });
    expect(resolve("pokemon", "めがるかりおぜっと")).toMatchObject({ ok: true, en: "Lucario-Mega-Z" });
    expect(resolve("items", "スカーフ")).toMatchObject({ ok: true, en: "Choice Scarf" });
  });
  it("聞き間違いは読みの近さで直す", () => {
    expect(resolve("pokemon", "ガフリアス")).toMatchObject({ ok: true, en: "Garchomp", fuzzy: true });
    expect(resolve("pokemon", "ミッキュ")).toMatchObject({ ok: true, en: "Mimikyu", fuzzy: true });
    expect(resolve("pokemon", "サアナイトウ")).toMatchObject({ ok: true, en: "Gardevoir", fuzzy: true });
  });
  it("知らない名前・チャンピオンズにいないもの", () => {
    expect(resolve("pokemon", "アロロ")).toMatchObject({ ok: false, candidates: [] });
    expect(resolve("pokemon", "ハバタクカミ")).toMatchObject({ ok: false, notInGame: "ハバタクカミ" });
    expect(resolve("items", "ハチマキ")).toMatchObject({ ok: false, notInGame: "こだわりハチマキ" });
  });
  it("あだ名の表の行き先は、正式名の表かチャンピオンズにないものの一覧にある", () => {
    const n = names as unknown as Record<string, Record<string, string>> & { others: Record<string, string[]> };
    for (const kind of ["pokemon", "items", "moves"] as const) {
      for (const [alias, ja] of Object.entries((aliases as unknown as Record<string, Record<string, string>>)[kind])) {
        expect(ja in n[kind] || (n.others[kind] ?? []).includes(ja), `${alias} → ${ja}`).toBe(true);
      }
    }
  });
});

describe("計算（チャンピオンズ・第0世代）", () => {
  it("ミミッキュのじゃれつく → ガブリアス（無振り）は Showdown と同じ 98-116", () => {
    const r = damage({ species: "Mimikyu" }, { species: "Garchomp" }, "Play Rough");
    expect([r.base.min, r.base.max]).toEqual([98, 116]);
    expect(r.base.ko).toMatchObject({ kind: "guaranteed", n: 2 });
    expect(r.range).toBeDefined(); // 振り方の指定がないので幅も出す
  });
  it("残り HP を確定数に反映する", () => {
    const a = { species: "Garchomp", sp: { atk: 32 }, natureUp: "atk" as const };
    const full = damage(a, { species: "Empoleon", sp: { hp: 32, def: 32 } }, "Earthquake");
    const hurt = damage(a, { species: "Empoleon", sp: { hp: 32, def: 32 }, hpLeft: 120 }, "Earthquake");
    expect(full.base.ko.kind).toBe("chance");
    expect(hurt.base.ko).toMatchObject({ kind: "guaranteed", n: 1 });
    expect(hurt.range).toBeUndefined(); // 両方とも振り方の指定がある
  });
  it("連続技は全部当たったときの合計（ドラゴンアロー）", () => {
    const r = damage({ species: "Dragapult", item: "Life Orb" }, { species: "Dragonite", ability: "Inner Focus" }, "Dragon Darts");
    expect([r.base.min, r.base.max]).toEqual([176, 218]);
    expect(r.base.ko).toMatchObject({ kind: "guaranteed", n: 1 });
  });
  it("特性: 言わなかったら計算に効く代表的な特性（フェアリースキン・マルチスケイル）、天気を変える特性は天気に反映", () => {
    expect(damage({ species: "Sylveon" }, { species: "Garchomp" }, "Hyper Voice").abilities.attacker).toBe("Pixilate");
    const multi = damage({ species: "Garchomp" }, { species: "Dragonite" }, "Outrage");
    const plain = damage({ species: "Garchomp" }, { species: "Dragonite", ability: "Inner Focus" }, "Outrage");
    expect(multi.base.max).toBeLessThan(plain.base.max);
    const zard = damage({ species: "Charizard-Mega-Y" }, { species: "Kingambit" }, "Flamethrower");
    expect(zard.field.weather).toBe("Sun");
    expect(speedOf({ species: "Basculegion" }, { weather: "Rain" })).toBe(2 * speedOf({ species: "Basculegion" }));
  });
  it("気合の襷: 満タンなら 1 発目は耐える（計算ライブラリが反映しないのでアプリで補う）", () => {
    const a = { species: "Garchomp", sp: { atk: 32 }, natureUp: "atk" as const };
    expect(damage(a, { species: "Kingambit" }, "Earthquake").base.ko.n).toBe(1);
    const sash = damage(a, { species: "Kingambit", item: "Focus Sash" }, "Earthquake").base;
    expect(sash.ko).toMatchObject({ kind: "guaranteed", n: 2 });
    expect(sash.endured).toBe("Focus Sash");
    expect(damage(a, { species: "Kingambit", item: "Focus Sash", hpLeftPercent: 90 }, "Earthquake").base.endured).toBeUndefined();
  });
  it("素早さ: ランク・スカーフ・最速・最遅", () => {
    expect(speedOf({ species: "Garchomp", sp: { spe: 32 }, natureUp: "spe" })).toBe(169);
    expect(speedOf({ species: "Garchomp", sp: { spe: 32 }, item: "Choice Scarf" })).toBe(231);
    expect(speedOf({ species: "Basculegion", boosts: { spe: 2 } })).toBe(196);
    const v = speedVariants({ species: "Kingambit" });
    expect(v.slowest).toBeLessThan(v.none);
    expect(v.fastest).toBeGreaterThan(v.neutral);
  });
  it("どこまで振ると抜かれるか", () => {
    const t = speedThreshold(196, { species: "Lucario-Mega-Z" });
    expect(t.neutral.faster).toBe(26);
    expect(t.plus.faster).toBe(9);
  });
});

describe("回答（AI の出力から）", () => {
  it("ユーザーの例 1: 残りHP120のエンペルトにA特化ガブのじしん", () => {
    const a = answerExtraction(
      {
        intent: "damage", attacker: "ガブリアス", defender: "エンペルト", move: "じしん",
        conditions: { attacker: { sp: { atk: 32 }, nature_up: "atk" }, defender: { sp: { hp: 32, def: 32 }, hp_left: 120 } },
      },
      "HB振りエンペルトのHP120残ってるんだけど、A特化ガブのじしん耐える？",
    );
    expect(a.speech).toMatch(/^耐えられないロト。確定1発/);
    expect(a.speech).toContain("残りHP120");
  });
  it("聞き返し・知らない名前・チャンピオンズにいない", () => {
    expect(answerExtraction({ intent: "clarify", attacker: "ミミッキュ", move: "じゃれつく", missing: ["defender"] }).speech).toBe("どのポケモンに撃つロト？");
    expect(answerExtraction({ intent: "damage", attacker: "アロロ", defender: "ガブリアス", move: "じゃれつく" }).speech).toBe("アロロは分からないロト");
    expect(answerExtraction({ intent: "damage", attacker: "ハバタクカミ", defender: "ガブリアス", move: "ムーンフォース" }).speech).toContain("チャンピオンズにいない");
  });
  it("3 つ揃っているのに clarify の場合はダメージ計算にする", () => {
    expect(answerExtraction({ intent: "clarify", attacker: "ミミッキュ", defender: "ガブリアス", move: "じゃれつく", missing: [] }).intent).toBe("damage");
  });
  it("タイプ・種族値・わざ", () => {
    expect(answerExtraction({ intent: "type", pokemon: "サーフゴー" }).speech).toContain("はがね・ゴースト");
    expect(answerExtraction({ intent: "stats", pokemon: "カイリュー" }).speech).toContain("合計600");
    expect(answerExtraction({ intent: "move_info", move: "じゃれつく" }).speech).toContain("フェアリータイプの物理技");
  });
  it("覚える技（チャンピオンズ。メガシンカは元のポケモンの一覧）", () => {
    expect(answerExtraction({ intent: "learnset", pokemon: "サーナイト", move: "でんじは" }).speech).toBe("サーナイトはでんじはを覚えるロト！");
    expect(answerExtraction({ intent: "learnset", pokemon: "ガブリアス", move: "ムーンフォース" }).speech).toBe("ガブリアスはムーンフォースを覚えないロト");
    expect(answerExtraction({ intent: "learnset", pokemon: "メガガブリアス", move: "じしん" }).speech).toContain("覚えるロト");
  });
  it("3 匹以上の素早さ比べは最速同士の順番", () => {
    const a = answerExtraction({ intent: "multi", queries: ["ガブリアス", "ドラパルト", "サーフゴー"].map((p) => ({ intent: "speed", ask: "value", pokemon: p })) });
    expect(a.speech).toBe("最速同士なら、ドラパルトが一番速いロト！ ドラパルト213、ガブリアス169、サーフゴー149ロト");
  });
  it("変化技はダメージがないと答える（タイプで無効と区別する）", () => {
    expect(answerExtraction({ intent: "damage", attacker: "ガブリアス", defender: "ミミッキュ", move: "つるぎのまい" }).speech).toBe("つるぎのまいは変化技だから、ダメージはないロト");
  });
  it("数値は計算の結果だけ（AI が書いた数値は使わない）", () => {
    const a = answerExtraction({ intent: "damage", attacker: "ミミッキュ", defender: "ガブリアス", move: "じゃれつく", damage: "999%" } as never);
    expect(a.speech).not.toContain("999");
  });
});

describe("AI 取り出しの切り替え", () => {
  const p = (name: string): Provider => ({ name, url: `https://example.invalid/${name}`, key: "k", model: name });
  it("上限エラーなら次の候補に切り替える", async () => {
    const fake = (async (url: string) => {
      if (String(url).endsWith("/a")) return new Response("{}", { status: 429 });
      return Response.json({ choices: [{ message: { content: '{"intent":"chat"}' } }] });
    }) as typeof fetch;
    const r = await extract("こんにちは", { providers: [p("a"), p("b")], fetchImpl: fake });
    expect(r.provider).toBe("b");
    expect(r.extraction).toEqual({ intent: "chat" });
    expect(r.attempts.map((x) => x.ok)).toEqual([false, true]);
  });
  it("全部だめなら extraction は null", async () => {
    const fake = (async () => new Response("err", { status: 500 })) as unknown as typeof fetch;
    const r = await extract("x", { providers: [p("c")], fetchImpl: fake });
    expect(r.extraction).toBeNull();
  });
  it("環境変数から候補を作る（キーがなければ空）", () => {
    expect(providersFromEnv({})).toEqual([]);
    expect(providersFromEnv({ GEMINI_API_KEY: "g", GROQ_API_KEY: "q" }).map((x) => x.name)).toEqual(["gemini-3.5-flash-lite", "gemini-3.1-flash-lite", "groq-gpt-oss-120b"]);
  });
});
