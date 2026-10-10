import { describe, expect, it } from "vitest";
import { parseFollowUp, parseRules } from "../lib/rules";

describe("ルール解析（確実に分かるときだけ答える）", () => {
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
  it("状態異常・無振り", () => {
    expect(parseRules("やけどのガブのじしん、ドドゲザンに")).toMatchObject({ conditions: { attacker: { status: "やけど" } } });
    expect(parseRules("まひしたドラパルトと無振りガブリアスどっちが速い？")).toMatchObject({ conditions: { attacker: { status: "まひ" }, defender: { sp: { spe: 0 } } } });
  });
  it("ひらがなだけの質問", () => {
    expect(parseRules("がぶりあすのじゃくてん")).toMatchObject({ intent: "type", pokemon: "ガブリアス" });
  });
});
