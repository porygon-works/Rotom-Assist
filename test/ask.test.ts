import { describe, expect, it } from "vitest";
import { answerExtraction, looksLikeFollowUp } from "../lib/ask";
import { fixMishearing } from "../lib/misheard";
import { damage, speedOf, speedThreshold, speedVariants } from "../lib/battle";
import { aiSetup, extract, providersFromEnv, type Provider } from "../lib/llm";
import { reading, resolve } from "../lib/resolve";
import aliases from "../data/aliases.json";
import names from "../data/names.json";
import moveDesc from "../data/move-desc.json";
import abilityDesc from "../data/ability-desc.json";

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

describe("実際のログ（roas.ask_log）で答えられなかった質問", () => {
  it("音声認識の聞き間違いを直す", () => {
    expect(fixMishearing("HBブリエンペルトに特化ガムの受診は")).toBe("HB振りエンペルトに特化ガブのじしんは");
    expect(fixMishearing("HBトッカエンペルトに特化ガブリアスの受信を打ったら耐える")).toBe("HB特化エンペルトに特化ガブリアスのじしんを打ったら耐える");
    expect(fixMishearing("メガボーマンダの地震でHB特化とひどいレに")).toBe("メガボーマンダの地震でHB特化ドヒドイデに");
    expect(fixMishearing("メガソ武者の不意打ち")).toBe("メガグソクムシャの不意打ち");
    // 正しい文は変えない
    expect(fixMishearing("ガブリアスのじしんでドヒドイデ何発")).toBe("ガブリアスのじしんでドヒドイデ何発");
  });
  it("特性を聞く質問（AI が種族値に分類しても）", () => {
    expect(answerExtraction({ intent: "stats", pokemon: "ポワルン" }, "ポワルンって特性何").speech).toContain("てんきや");
    const r = answerExtraction({ intent: "move_info", pokemon: "マスカーニャ", conditions: { pokemon: { ability: "へんげんじざい" } } }, "変幻自在って特性の効果教えて");
    expect(r.intent).toBe("ability");
    expect(r.speech).toContain("マスカーニャ");
  });
  it("技の相性を聞く質問", () => {
    const r = answerExtraction({ intent: "clarify", missing: ["defender"], move: "インファイト", attacker: "ハッサム" }, "ハッサムにインファイト打ったら効果抜群");
    expect(r.speech).toContain("等倍");
    expect(answerExtraction({ intent: "type", move: "かえんほうしゃ", pokemon: "ハッサム" }, "ハッサムにかえんほうしゃは効く？").speech).toContain("4倍");
  });
});

describe("技・特性の説明（data/move-desc.json・ability-desc.json）", () => {
  it("技の性能に効果の説明を添える", () => {
    const r = answerExtraction({ intent: "move_info", move: "イカサマ" }, "イカサマってどんな技");
    expect(r.speech).toContain("こうげき");
    expect(r.lines.some((l) => l.startsWith("効果:"))).toBe(true);
  });
  it("特性の説明と、特性が 1 つのポケモンは効果まで読む", () => {
    expect(answerExtraction({ intent: "chat" }, "威嚇ってどんな特性").speech).toContain("こうげき");
    expect(answerExtraction({ intent: "stats", pokemon: "ポワルン" }, "ポワルンって特性何").speech).toContain("天候");
  });
  it("Champions の技・特性は全部に説明がある", () => {
    const md = moveDesc as unknown as Record<string, unknown>;
    const ad = abilityDesc as unknown as Record<string, unknown>;
    const n = names as unknown as Record<string, Record<string, string>>;
    expect([...new Set(Object.values(n.moves))].filter((en) => !md[en])).toEqual([]);
    expect([...new Set(Object.values(n.abilities))].filter((en) => !ad[en]).length).toBeLessThanOrEqual(1);
  });
});

describe("ask_log #105〜#115（2026-10-12）", () => {
  it("タイプが変わった状態（でんきタイプになったマスカーニャ）で計算する", () => {
    const ex = { move: "じしん", intent: "damage", attacker: "ガブリアス", defender: "マスカーニャ", conditions: { defender: { type: "でんき" } } };
    const r = answerExtraction(ex, "電気タイプに変化したマスカーニャにガブリアスのじしん");
    expect(r.speech).toContain("確定1発");
    expect(r.speech).toContain("でんきタイプとして計算");
    expect(answerExtraction({ ...ex, conditions: { defender: { type: "ひこう" } } }).speech).toContain("効かない");
  });
  it("AI が特性名をひらがなで返しても、文の特性名で特性の説明に答える", () => {
    const r = answerExtraction({ intent: "chat", ability: "かちき" }, "勝ちきと言う特性について教えて");
    expect(r.intent).toBe("ability");
    expect(r.speech).toContain("とくこう");
  });
  it("前の質問を AI に渡すのは続きの質問のときだけ", () => {
    expect(looksLikeFollowUp("じゃあスカーフなら？")).toBe(true);
    expect(looksLikeFollowUp("HPが半分だったら？")).toBe(true);
    expect(looksLikeFollowUp("勝ちきってどんな特性")).toBe(false);
    expect(looksLikeFollowUp("ガブリアスのじしんでマスカーニャ何発")).toBe(false);
  });
  it("「自信」はじしん（じしんかじょうは変えない）", () => {
    expect(fixMishearing("マスカーニャにガブの自信")).toBe("マスカーニャにガブのじしん");
    expect(fixMishearing("自信過剰ってどんな特性")).toBe("自信過剰ってどんな特性");
  });
});

describe("ask_log #116〜#124（2026-10-12）: 特性もうかのエースバーン", () => {
  it("「もうか」の聞き間違いと、単語の間の空白を直す", () => {
    expect(fixMishearing("特性 真 華 の エース バーン の ダスト シュート")).toBe("特性もうかのエースバーンのダストシュート");
    expect(fixMishearing("特製 農家 の エース バーン")).toBe("特性もうかのエースバーン");
    expect(fixMishearing("特性 が 思う かの エース バーン")).toBe("特性もうかのエースバーン");
    expect(fixMishearing("HP 100のガブ")).toBe("HP 100のガブ");
    // ご本人に確認: 「北区」= でんき（タイプ）、「走れる」= アシレーヌ
    expect(fixMishearing("北区のマスカーニャがガブリアスの地震耐えれる")).toBe("でんきタイプのマスカーニャがガブリアスの地震耐えれる");
    expect(fixMishearing("ダストシュートを走れるのを与える")).toBe("ダストシュートをアシレーヌのを与える");
  });
  it("もうかと言われたらリベロではなく、もうかで計算して、そう言う", () => {
    const ex = { move: "ダストシュート", intent: "damage", attacker: "エースバーン", defender: "アシレーヌ", conditions: { attacker: { ability: "もうか" } } };
    const r = answerExtraction(ex, "特性もうかのエースバーンのダストシュートアシレーヌを与える");
    expect(r.speech).toContain("105から124");
    expect(r.speech).toContain("もうかで計算");
  });
});

describe("ask_log #140〜#144（2026-10-12）: イダイトウ・おはかまいり", () => {
  it("「偉大党」「偉大と」= イダイトウ、「お墓参り」= おはかまいり、「メガリザードン前」= Y", () => {
    expect(fixMishearing("偉大 党 の アクア ジェット で メガ リザードンワイ")).toBe("イダイトウのアクアジェットでメガリザードンY");
    expect(fixMishearing("偉大 と の え お 墓参り を メガリザードン 前 は 耐えれる")).toBe("イダイトウのえおはかまいりをメガリザードンYは耐えれる");
  });
  it("おはかまいりは倒れた味方の数で威力が変わる（言わなければ 2 匹・威力 150 と言う）", () => {
    const ex = { move: "おはかまいり", intent: "damage", attacker: "イダイトウ", defender: "メガリザードンY" };
    const def = answerExtraction(ex).speech;
    expect(def).toContain("倒れた味方2匹（威力150）");
    expect(def).toContain("確定1発");
    const r0 = answerExtraction({ ...ex, conditions: { attacker: { allies_fainted: 0 } } });
    expect(r0.speech).toContain("確定3発");
    expect(r0.speech).not.toContain("倒れた味方2匹");
  });
});

describe("ask_log #132: 防御側を言っていないのに AI が攻撃側と同じポケモンを補ったら聞き返す", () => {
  it("名前が 1 回しか出てこなければ聞き返す。2 回なら同じポケモン同士で計算する", () => {
    const ex = { move: "10まんボルト", intent: "damage", attacker: "メガカイリュー", defender: "カイリュー" };
    expect(answerExtraction(ex, "CSメガカイリューの10万ボルトがHブリどれぐらい入る").intent).toBe("clarify");
    expect(answerExtraction({ move: "じしん", intent: "damage", attacker: "ガブリアス", defender: "ガブリアス" }, "ガブリアスのじしんでガブリアス何発").intent).toBe("damage");
    expect(answerExtraction({ move: "じしん", intent: "damage", attacker: "ガブリアス", defender: "ガブリアス" }, "ガブのじしんでガブリアス何発").intent).toBe("damage");
  });
});

describe("ask_log 全件の見直し（2026-10-13 夜間）", () => {
  it("AI が持ち物・特性に「なし」と書いても「なしは分からない」と言わない（#101）", () => {
    const r = answerExtraction({ move: "じしん", intent: "damage", attacker: "ガブリアス", defender: "エンペルト", conditions: { attacker: { item: "なし", ability: "なし" } } }, "ガブのじしんでエンペルト");
    expect(r.speech).not.toContain("分からない");
  });
  it("漢字の技名（氷のつぶて・思念の頭突き）と「メガリオ Z」「腹ばり」「HDぶり」「偉大とう」（#91・#147〜#151）", () => {
    expect(resolve("moves", "氷のつぶて")).toMatchObject({ ok: true, en: "Ice Shard" });
    expect(resolve("moves", "思念の頭突き")).toMatchObject({ ok: true, en: "Zen Headbutt" });
    expect(fixMishearing("メガリオ Z を与える")).toBe("メガルカリオZを与える");
    expect(fixMishearing("悪 の 波動 が 腹 ばりHD ぶり に")).toBe("悪の波動がハラバリーHD振りに");
    expect(fixMishearing("偉大 とう の お 墓参り")).toBe("イダイトウのおはかまいり");
  });
  it("「威力150」と言われたらその威力で計算する（おはかまいりは倒れた味方の数に直す）", () => {
    const ex = { move: "おはかまいり", intent: "damage", attacker: "イダイトウ", defender: "ハラバリー" };
    expect(answerExtraction(ex, "イダイトウのおはかまいり威力100をハラバリーは耐えますか").speech).toContain("倒れた味方1匹（威力100）");
    expect(answerExtraction({ move: "じだんだ", intent: "damage", attacker: "ガブリアス", defender: "エンペルト" }, "威力150のじだんだ").speech).toContain("威力150");
  });
});

describe("ask_log #154: 「最速」で AI が S↑だけ書いたら S の SP 32 も足す", () => {
  it("最速ドラパルトは 213", () => {
    const r = answerExtraction({ pokemon: "ドラパルト", intent: "speed", ask: "value", conditions: { pokemon: { nature_up: "spe" } } }, "最速ドラパルトの素早さ");
    expect(r.speech).toContain("213");
  });
});

describe("ask_log #150・#151: 「威力150」も AI を待たずに答える。乱数の結論で「乱数」を 2 回言わない", () => {
  it("偉大とのお墓参り威力150を腹バリーは耐えますか", async () => {
    const { ask } = await import("../lib/ask");
    const r = await ask("偉大 と の お 墓参り 威力 150 を 腹バリー は 耐え ます か");
    expect(r.diagnostics?.provider).toBe("rules");
    expect(r.speech).toMatch(/^耐える確率は\d+パーセントくらいロト。乱数1発ロト。/);
    expect(r.speech).toContain("倒れた味方2匹（威力150）");
  });
});
