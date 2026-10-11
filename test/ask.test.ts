import { describe, expect, it } from "vitest";
import { answerExtraction } from "../lib/ask";
import { damage, speedOf, speedThreshold, speedVariants } from "../lib/battle";
import { aiSetup, extract, providersFromEnv, type Provider } from "../lib/llm";
import { reading, resolve } from "../lib/resolve";
import aliases from "../data/aliases.json";
import names from "../data/names.json";

describe("名前の解決", () => {
  it("正式名・英語名・あだ名", () => {
    expect(resolve("pokemon", "ガブリアス")).toMatchObject({ ok: true, en: "Garchomp", fuzzy: false });
    expect(resolve("pokemon", "garchomp")).toMatchObject({ ok: true, en: "Garchomp" });
    expect(resolve("pokemon", "ガブ")).toMatchObject({ ok: true, en: "Garchomp" });
    expect(resolve("pokemon", "水ロトム")).toMatchObject({ ok: true, en: "Rotom-Wash" });
    // 音声認識が漢字にする（ask_log より）
    expect(resolve("pokemon", "サーフ号")).toMatchObject({ ok: true, en: "Gholdengo" });
    expect(resolve("pokemon", "メガルカリオZ")).toMatchObject({ ok: true, en: "Lucario-Mega-Z" });
    expect(resolve("pokemon", "めがるかりおぜっと")).toMatchObject({ ok: true, en: "Lucario-Mega-Z" });
    expect(resolve("items", "スカーフ")).toMatchObject({ ok: true, en: "Choice Scarf" });
  });
  it("聞き間違いは読みの近さで直す", () => {
    expect(resolve("pokemon", "ガフリアス")).toMatchObject({ ok: true, en: "Garchomp", fuzzy: true });
    expect(resolve("pokemon", "ミッキュ")).toMatchObject({ ok: true, en: "Mimikyu", fuzzy: true });
    expect(resolve("pokemon", "サアナイトウ")).toMatchObject({ ok: true, en: "Gardevoir", fuzzy: true });
    // 読み（ローマ字）で比べる: 小さい字・促音・伸ばす音のゆれ、漢字の書き起こし
    expect(resolve("pokemon", "ミミック")).toMatchObject({ ok: true, en: "Mimikyu", fuzzy: true });
    expect(resolve("pokemon", "エースバン")).toMatchObject({ ok: true, en: "Cinderace", fuzzy: true });
    expect(resolve("pokemon", "カイリュウ")).toMatchObject({ ok: true, en: "Dragonite", fuzzy: true });
    expect(resolve("pokemon", "月光蛾")).toMatchObject({ ok: true, en: "Greninja", fuzzy: true });
    expect(reading("ミミッキュ")).toBe("mimikyu");
    expect(reading("サーフゴウ")).toBe(reading("サーフゴー"));
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
  it("ミミッキュのじゃれつく → ガブリアス（無振り同士）は Showdown と同じ 98-116", () => {
    const r = damage({ species: "Mimikyu", sp: { atk: 0 } }, { species: "Garchomp" }, "Play Rough");
    expect([r.base.min, r.base.max]).toEqual([98, 116]);
    expect(r.base.ko).toMatchObject({ kind: "guaranteed", n: 2 });
    expect(r.attackerBoosted).toBeDefined(); // 性格補正の指定がないので補正ありも出す
    expect(r.defenderBulky).toBeDefined(); // 防御側の振り方の指定がないので耐久振りも出す
  });
  it("攻撃側の振り方を言わなければ全振り（SP32）・補正なしで計算し、補正ありも出す", () => {
    const r = damage({ species: "Mimikyu" }, { species: "Garchomp" }, "Play Rough");
    const full = damage({ species: "Mimikyu", sp: { atk: 32 } }, { species: "Garchomp" }, "Play Rough");
    expect(r.base.max).toBe(full.base.max);
    expect(r.attackerBoosted!.max).toBeGreaterThan(r.base.max);
    expect(r.assumed).toContain("攻撃側はA全振り・補正なし");
    // 性格補正を言ったら補正ありの場合分けはしない
    expect(damage({ species: "Mimikyu", natureDown: "spa" }, { species: "Garchomp" }, "Play Rough").attackerBoosted).toBeUndefined();
  });
  it("残り HP を確定数に反映する", () => {
    const a = { species: "Garchomp", sp: { atk: 32 }, natureUp: "atk" as const };
    const full = damage(a, { species: "Empoleon", sp: { hp: 32, def: 32 } }, "Earthquake");
    const hurt = damage(a, { species: "Empoleon", sp: { hp: 32, def: 32 }, hpLeft: 120 }, "Earthquake");
    expect(full.base.ko.kind).toBe("chance");
    expect(hurt.base.ko).toMatchObject({ kind: "guaranteed", n: 1 });
    expect(hurt.attackerBoosted).toBeUndefined(); // 両方とも振り方の指定がある
    expect(hurt.defenderBulky).toBeUndefined();
  });
  it("連続技は全部当たったときの合計（ドラゴンアロー）", () => {
    const r = damage({ species: "Dragapult", item: "Life Orb", sp: { atk: 0 } }, { species: "Dragonite", ability: "Inner Focus" }, "Dragon Darts");
    expect([r.base.min, r.base.max]).toEqual([176, 218]);
    expect(r.base.ko).toMatchObject({ kind: "guaranteed", n: 1 });
  });
  it("へんげんじざい・リベロ: 言わなかったら使い、どのわざもタイプ一致になる", () => {
    const pro = damage({ species: "Meowscarada" }, { species: "Garchomp" }, "Play Rough");
    expect(pro.abilities.attacker).toBe("Protean");
    expect(pro.base.max).toBeGreaterThan(damage({ species: "Meowscarada", ability: "Overgrow" }, { species: "Garchomp" }, "Play Rough").base.max);
    expect(damage({ species: "Cinderace" }, { species: "Kingambit" }, "High Jump Kick").abilities.attacker).toBe("Libero");
    expect(damage({ species: "Greninja" }, { species: "Garchomp" }, "Ice Beam").abilities.attacker).toBe("Protean");
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
  it("だいちのはどう: エレキフィールドででんきタイプ・威力 100、メガランチャーも乗る。カードと読み上げに前提を出す", () => {
    const r = damage({ species: "Blastoise-Mega" }, { species: "Charizard-Mega-Y" }, "Terrain Pulse", { terrain: "Electric" });
    expect([r.base.moveType, r.base.moveBp, r.abilities.attacker]).toEqual(["Electric", 100, "Mega Launcher"]);
    expect(r.base.ko).toMatchObject({ kind: "guaranteed", n: 1 });
    const a = answerExtraction({ intent: "damage", attacker: "メガカメックス", defender: "メガリザードンY", move: "だいちのはどう", conditions: { field: { terrain: "エレキフィールド" } } });
    expect(a.speech).toContain("だいちのはどうはでんきタイプ・威力100で計算したロト");
    expect(a.card?.move.type).toBe("でんき（エレキフィールドでノーマルから変化）");
    expect(a.speech).toContain("ひでりで晴れとして計算");
  });
  it("ばけのかわが剥がれた: 1 発目を防がず、剥がれた姿・残り HP 7/8 で計算する", () => {
    const broken = damage({ species: "Garchomp" }, { species: "Mimikyu", disguiseBroken: true }, "Earthquake").base;
    expect(broken.endured).toBeUndefined();
    expect(broken.curHP).toBe(broken.hp - Math.floor(broken.hp / 8));
    expect(damage({ species: "Garchomp" }, { species: "Mimikyu" }, "Earthquake").base.endured).toBe("Disguise");
  });
  it("ばけのかわ: 満タンなら 1 発目を防ぎ、確定数を 1 つ増やす（連続技・満タンでないときは対象外）", () => {
    const base = damage({ species: "Garchomp", sp: { atk: 0 } }, { species: "Mimikyu", ability: "Pressure" }, "Earthquake").base;
    const disguise = damage({ species: "Garchomp", sp: { atk: 0 } }, { species: "Mimikyu" }, "Earthquake").base;
    expect(disguise.endured).toBe("Disguise");
    expect(disguise.ko.n).toBeGreaterThan(base.ko.n);
    expect(damage({ species: "Garchomp" }, { species: "Mimikyu", hpLeftPercent: 50 }, "Earthquake").base.endured).toBeUndefined();
  });
  it("いかく: 防御側がいかくで物理技なら攻撃 −1。クリアボディは下がらない、攻撃ランクを言われたらそのまま", () => {
    expect(damage({ species: "Garchomp" }, { species: "Incineroar" }, "Earthquake").intimidate).toBe(-1);
    expect(damage({ species: "Metagross" }, { species: "Incineroar" }, "Meteor Mash").intimidate).toBe(0);
    expect(damage({ species: "Hydreigon" }, { species: "Incineroar" }, "Dark Pulse").intimidate).toBeUndefined();
    expect(damage({ species: "Garchomp", boosts: { atk: 1 } }, { species: "Incineroar" }, "Earthquake").intimidate).toBeUndefined();
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
    // 聞き間違いを直したことは画面にだけ出す。へんげんじざいでタイプ一致にしたことは言う
    const pro = answerExtraction({ intent: "damage", attacker: "ミミック", defender: "ガブリアス", move: "じゃれつく" });
    expect(pro.speech).not.toContain("ミミック");
    expect(pro.lines).toContain("「ミミック」はミミッキュとして計算した");
    expect(answerExtraction({ intent: "damage", attacker: "マスカーニャ", defender: "ガブリアス", move: "じゃれつく" }).speech).toContain("マスカーニャはへんげんじざいでタイプ一致として計算したロト");
    expect(answerExtraction({ intent: "type", pokemon: "ゲッコウガ" }).speech).toContain("わざを出すとそのわざのタイプに変わる");
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
  it("記録先（Supabase）が見えているかを診断に出す（URL とキーの両方が要る）", () => {
    expect(aiSetup({}).log).toBe(false);
    expect(aiSetup({ SUPABASE_URL: "u" }).log).toBe(false);
    expect(aiSetup({ SUPABASE_URL: "u", SUPABASE_SERVICE_ROLE_KEY: "k" }).log).toBe(true);
  });
});
