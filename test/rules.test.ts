import { describe, expect, it } from "vitest";
import { parseFollowUp, parseRules } from "../lib/rules";

describe("ルール解析（確実に分かるときだけ答える）", () => {
  it("聞き間違い・言い間違いの名前は読みの近さで直し、聞こえた形のまま渡す（読み上げでは言わず、画面にだけ出す）", () => {
    // 「ミミ」（あだ名）+「ック」と切ると行き詰まるので、戻って「ミミック」を 1 語として読む
    expect(parseRules("ミミックのじゃれつくでガブリアス何発")).toMatchObject({ intent: "damage", attacker: "ミミック", defender: "ガブリアス", move: "じゃれつく" });
    expect(parseRules("ミミックって何が弱点")).toMatchObject({ intent: "type", pokemon: "ミミック" });
    expect(parseRules("ドラパルドのドラゴンアローでカイリュウ何発")).toMatchObject({ intent: "damage", attacker: "ドラパルド", defender: "カイリュウ" });
    expect(parseRules("エースバンとマスカニャどっちが速い")).toMatchObject({ intent: "speed", attacker: "エースバン", defender: "マスカニャ" });
  });
  it("性格補正の上げ下げ（C下降補正・Cマイナス補正・C↓・A↑）と、音声認識が略号を日本語にしたとき（し・市・絵）", () => {
    const def = (q: string) => (parseRules(q) as { conditions?: { defender?: unknown } } | null)?.conditions?.defender;
    expect(def("C下降補正のガブリアスにサーフゴーのシャドーボール")).toEqual({ nature_down: "spa" });
    expect(def("Cマイナス補正のガブリアスにサーフゴーのシャドーボール")).toEqual({ nature_down: "spa" });
    expect(def("C↓のガブリアスにサーフゴーのシャドーボール")).toEqual({ nature_down: "spa" });
    expect(def("し下降補正のガブリアスにサーフゴーのシャドーボール")).toEqual({ nature_down: "spa" });
    expect(def("市下降補正のガブリアスにサーフゴーのシャドーボール")).toEqual({ nature_down: "spa" });
    expect(def("資格補正のガブリアスにサーフゴーのシャドーボール")).toEqual({ nature_down: "spa" });
    expect(def("私加工補正のガブリアスにサーフゴーのシャドーボール")).toEqual({ nature_down: "spa" });
    expect(def("良い過去補正のガブリアスにサーフゴーのシャドーボール")).toEqual({ nature_down: "spa" });
    expect(def("HB特化C下降補正のサーフゴーにガブリアスのじしん")).toEqual({ sp: { hp: 32, def: 32 }, nature_up: "def", nature_down: "spa" });
    expect(parseRules("A↑C↓のガブリアスのじしんでサーフゴー何発")).toMatchObject({ conditions: { attacker: { nature_up: "atk", nature_down: "spa" } } });
    expect(parseRules("絵特化ガブリアスのじしんでサーフゴー何発")).toMatchObject({ conditions: { attacker: { sp: { atk: 32 }, nature_up: "atk" } } });
    // 技の後ろの「を」と条件を、技の聞き間違いとして吸わない（条件を黙って捨てない）。「振り」のない「HB」は HB振り（ask_log #155）
    expect(parseRules("ドラパルトのドラゴンアローをHBメガリザードンワイは買えますか")).toMatchObject({ move: "ドラゴンアロー", conditions: { defender: { sp: { hp: 32, def: 32 } } } });
    // 能力の文字のない「特化」: 攻撃側だけ、わざの分類で決める（ask_log #156）。防御側・素早さの質問・分類と使う能力が違うわざは AI に回す
    expect(parseRules("HBエンペルトに特化ガブのじしんはどれぐらい入る")).toMatchObject({ conditions: { attacker: { sp: { atk: 32 }, nature_up: "atk" }, defender: { sp: { hp: 32, def: 32 } } } });
    expect(parseRules("特化メガリザードンYのかえんほうしゃでガブリアス何発")).toMatchObject({ conditions: { attacker: { sp: { spa: 32 }, nature_up: "spa" } } });
    expect(parseRules("ガブリアスのじしんを特化エンペルトは耐える")).toBeNull();
    expect(parseRules("特化ガブリアスとエンペルトどっちが速い")).toBeNull();
    expect(parseRules("特化エンペルトのボディプレスでガブリアス何発")).toBeNull();
    // 「威力150」はダメージの質問でだけ受ける（値は lib/ask.ts が文から読む。ask_log #150・#151）
    expect(parseRules("イダイトウのおはかまいり威力150をハラバリーは耐えますか")).toMatchObject({ intent: "damage", attacker: "イダイトウ", defender: "ハラバリー", move: "おはかまいり" });
    expect(parseRules("威力150のじだんだ")).toBeNull();
    // 条件 → わざ → ポケモン の順（ask_log #157）: 条件はわざの後のポケモンのもの。そのポケモンが攻撃側のときだけ
    expect(parseRules("HB振りエンペルトにA特化のじしんガブリアスの")).toMatchObject({ attacker: "ガブリアス", conditions: { attacker: { sp: { atk: 32 }, nature_up: "atk" } } });
    expect(parseRules("A特化のじしんエンペルトにガブリアスの")).toBeNull();
    // 辞書だけで読めるときは聞き間違いの推定をしない（「でハラバリー」を「では」+「ラバリー」と切らない）
    expect(parseRules("イダイトウのおはかまいりでハラバリー耐える")).toMatchObject({ defender: "ハラバリー" });
    // 聞き間違いの補正（data/misheard.json）は、直す前の文を渡しても当たる
    expect(parseRules("シカ補正のマスカーニャのパワージェムをメガリザードンワイは買えますか")).toMatchObject({ conditions: { attacker: { nature_down: "spa" } } });
    // 名前の最後の「シ」は略号にしない
    expect(parseRules("カエンジシのかえんほうしゃでガブリアス何発")).toMatchObject({ attacker: "カエンジシ", conditions: {} });
  });
  it("よくあるダメージの言い方", () => {
    expect(parseRules("ガブリアスにミミッキュのじゃれつく")).toMatchObject({ intent: "damage", attacker: "ミミッキュ", defender: "ガブリアス", move: "じゃれつく" });
    expect(parseRules("A特化ガブのじしん、HB特化エンペルトに")).toMatchObject({
      attacker: "ガブリアス", defender: "エンペルト",
      conditions: { attacker: { sp: { atk: 32 }, nature_up: "atk" }, defender: { sp: { hp: 32, def: 32 }, nature_up: "def" } },
    });
    expect(parseRules("ガブのじしん、ステロ込みでエンペルト落ちる？")).toMatchObject({ conditions: { defender: { stealth_rock: true } } });
    expect(parseRules("雨のウォッシュロトムのハイドロポンプでバンギラス落ちる？")).toMatchObject({ conditions: { field: { weather: "雨" } } });
  });
  it("素早さ・タイプ・種族値・わざ", () => {
    expect(parseRules("準速ガブリアスと最速ドラパルトどっちが速い？")).toMatchObject({ intent: "speed", ask: "compare", conditions: { attacker: { sp: { spe: 32 } }, defender: { nature_up: "spe" } } });
    expect(parseRules("サーフゴーの弱点は？")).toMatchObject({ intent: "type", pokemon: "サーフゴー" });
    // 「何が」付きの言い方と、音声認識の漢字（ask_log より）
    expect(parseRules("サーフ号って何が弱点")).toMatchObject({ intent: "type", pokemon: "サーフゴー" });
    expect(parseRules("ガブリアスって弱点なに？")).toMatchObject({ intent: "type", pokemon: "ガブリアス" });
    expect(parseRules("カイリューの種族値教えて")).toMatchObject({ intent: "stats" });
    expect(parseRules("じゃれつくって何タイプ？")).toMatchObject({ intent: "move_info", move: "じゃれつく" });
  });
  it("ユーザーの質問例 1（後ろに付く残りHP・HB振り・A特化）", () => {
    expect(parseRules("HB振りエンペルトのHP120残ってるんだけど、A特化ガブのじしん耐える？")).toMatchObject({
      intent: "damage", attacker: "ガブリアス", defender: "エンペルト", move: "じしん",
      conditions: { attacker: { sp: { atk: 32 }, nature_up: "atk" }, defender: { sp: { hp: 32, def: 32 }, hp_left: 120 } },
    });
    expect(parseRules("スカーフ持ちガブのじしん、サーフゴーに")).toMatchObject({ conditions: { attacker: { item: "こだわりスカーフ" } } });
  });
  it("ユーザーの質問例（ランク・どこまで振ったら）", () => {
    expect(parseRules("S二段階上昇のイダイトウって最速メガルカリオZ抜ける？")).toMatchObject({
      intent: "speed", ask: "compare", attacker: "イダイトウ", defender: "メガルカリオZ",
      conditions: { attacker: { boosts: { spe: 2 } }, defender: { sp: { spe: 32 }, nature_up: "spe" } },
    });
    expect(parseRules("S二段階上昇のイダイトウってメガルカリオZがどこまですばやさ振ってたら負ける？")).toMatchObject({ ask: "threshold", conditions: { attacker: { boosts: { spe: 2 } } } });
    expect(parseRules("HP半分のドドゲザン、ガブのじしんで落ちる？")).toMatchObject({ conditions: { defender: { hp_left_percent: 50 } } });
  });
  it("知らない語が残ったら答えない（AI に回す）", () => {
    expect(parseRules("HPに32振ったガブリアス、サーフゴーのゴールドラッシュ耐える？")).toBeNull();
    expect(parseRules("じゃあA特化なら？")).toBeNull();
    expect(parseRules("が降りあすに見っきゅのじゃれつく")).toBeNull();
    expect(parseRules("ガブリアスとミミッキュのじしん")).toBeNull(); // 向きが決まらない
    expect(parseRules("CS特化サザンドラのりゅうせいぐん、ガブに")).toBeNull(); // 補正の先が決まらない
    expect(parseRules("ミミッキュのじゃれつく")).toMatchObject({ intent: "clarify", missing: ["defender"] }); // 相手がいない → 聞き返す
    expect(parseRules("エンペルトにじしん撃ったらどれくらい？")).toMatchObject({ intent: "clarify", missing: ["attacker"] });
    expect(parseRules("最速イダイトウがS1段階上がったらメガルカリオZ抜ける？")).toBeNull(); // 「上がったら」の付け先が決まらない
    expect(parseRules("ミミッキュのじゃれつくでガブリアスのHP半分減る？")).toBeNull(); // 「残ってる」がない後ろの HP は残り HP とは限らない
    expect(parseRules("雨のガブの弱点")).toBeNull(); // 条件を落とさない
  });
});

describe("続きの質問（直前の解釈に条件を足す）", () => {
  const prev = parseRules("ウォッシュロトムのハイドロポンプ、ガブリアスに");
  it("条件の種類で足す先を決める", () => {
    expect(parseFollowUp("じゃあ雨なら？", prev)).toMatchObject({ uses_context: true, conditions: { field: { weather: "雨" } } });
    expect(parseFollowUp("じゃあH振りなら？", prev)).toMatchObject({ conditions: { defender: { sp: { hp: 32 } } } });
    expect(parseFollowUp("じゃあA特化なら？", prev)).toMatchObject({ conditions: { attacker: { sp: { atk: 32 }, nature_up: "atk" } } });
    expect(parseFollowUp("じゃあステロ込みだったら？", prev)).toMatchObject({ conditions: { defender: { stealth_rock: true } } });
    expect(parseFollowUp("じゃあハチマキ持ってたら？", prev)).toMatchObject({ conditions: { attacker: { item: "こだわりハチマキ" } } });
  });
  it("ポケモンの入れ替えや、前の質問がない場合は答えない（AI に回す）", () => {
    expect(parseFollowUp("じゃあミミッキュなら？", prev)).toBeNull();
    expect(parseFollowUp("じゃあ雨なら？", null)).toBeNull();
    expect(parseFollowUp("雨", prev)).toBeNull();
  });
  it("フィールド（わざの名前と同じもの）・壁・急所・同士", () => {
    expect(parseRules("サイコフィールドのサーナイトのサイコキネシス、カイリューに")).toMatchObject({ move: "サイコキネシス", conditions: { field: { terrain: "サイコフィールド" } } });
    expect(parseRules("リフレクターありでガブのじしん、サーフゴー耐える？")).toMatchObject({ conditions: { field: { reflect: true } } });
    expect(parseRules("急所に当たったらミミッキュのじゃれつくでガブ落ちる？")).toMatchObject({ conditions: { field: { critical: true } } });
    expect(parseRules("ドラパルトとメガルカリオZ、準速同士だとどっちが速い？")).toMatchObject({ conditions: { attacker: { sp: { spe: 32 } }, defender: { sp: { spe: 32 } } } });
  });
  it("音声認識の表記ゆれ（略号の読み・小文字・メガの X/Y/Z の読み）", () => {
    expect(parseRules("エー特化ガブのじしん、エイチビー振りエンペルトに")).toMatchObject({
      conditions: { attacker: { sp: { atk: 32 }, nature_up: "atk" }, defender: { sp: { hp: 32, def: 32 } } },
    });
    expect(parseRules("エス二段階上昇のイダイトウって最速メガルカリオゼット抜ける？")).toMatchObject({ defender: "メガルカリオZ", conditions: { attacker: { boosts: { spe: 2 } } } });
    expect(parseRules("c特化サザンドラのあくのはどう、サーフゴーに")).toMatchObject({ conditions: { attacker: { nature_up: "spa" } } });
    expect(parseRules("エースバーンのとびひざげり、ガブに")).toMatchObject({ attacker: "エースバーン" }); // 「エー」を A にしない
  });
  it("特性を名前の前に付ける言い方", () => {
    expect(parseRules("マルチスケイルのカイリューにガブのげきりん")).toMatchObject({ conditions: { defender: { ability: "マルチスケイル" } } });
    expect(parseRules("フェアリースキンのニンフィアのハイパーボイス、ガブに")).toMatchObject({ conditions: { attacker: { ability: "フェアリースキン" } } });
  });
  it("状態異常・無振り", () => {
    expect(parseRules("やけどのガブのじしん、ドドゲザンに")).toMatchObject({ conditions: { attacker: { status: "やけど" } } });
    expect(parseRules("まひしたドラパルトと無振りガブリアスどっちが速い？")).toMatchObject({ conditions: { attacker: { status: "まひ" }, defender: { sp: { spe: 0 } } } });
  });
  it("ひらがなだけの質問", () => {
    expect(parseRules("がぶりあすのじゃくてん")).toMatchObject({ intent: "type", pokemon: "ガブリアス" });
  });
});
