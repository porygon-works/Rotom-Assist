import { describe, expect, it } from "vitest";
import { parseRules } from "../lib/rules";

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
  it("知らない語が残ったら答えない（AI に回す）", () => {
    expect(parseRules("HPに32振ったガブリアス、サーフゴーのゴールドラッシュ耐える？")).toBeNull();
    expect(parseRules("HP半分のドドゲザン、ガブのじしんで落ちる？")).toBeNull();
    expect(parseRules("じゃあA特化なら？")).toBeNull();
    expect(parseRules("が降りあすに見っきゅのじゃれつく")).toBeNull();
    expect(parseRules("ガブリアスとミミッキュのじしん")).toBeNull(); // 向きが決まらない
    expect(parseRules("CS特化サザンドラのりゅうせいぐん、ガブに")).toBeNull(); // 補正の先が決まらない
    expect(parseRules("ミミッキュのじゃれつく")).toBeNull(); // 相手がいない（聞き返しは AI 側で）
  });
});
