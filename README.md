# Rotom-Assist
ポケモン対戦のダメージ計算・音声アシスタント（最小版）。方針は [CLAUDE.md](CLAUDE.md)。

## 使い方
```bash
npm install
npm run dev        # http://localhost:3000 （マイクは https か localhost のみ）
```
1. 「開始」を押す（押すまでマイクは動かない）。Chrome / Edge / Safari で開く
2. 「**ダメ計** ガブリアスにミミッキュのじゃれつく」と話す
   - 「ダメ計」だけ言った場合は、次の発話（15秒以内）を質問として受け付ける
   - 「Xの…」＝攻撃側、「Xに…」＝防御側。語順は不問
3. 画面にダメージ範囲・確定数・前提条件が出て、同じ内容が読み上げられる

画面を閉じる／別タブにすると認識を止め、戻ると（開始中だったときだけ）再開する。

## 構成
- `lib/wakeword.ts` 合言葉（候補は `WAKE_WORDS`）／ `lib/parse.ts` 質問の解釈（簡易ルール）
- `lib/calc.ts` @smogon/calc 呼び出し ／ `lib/validate.ts` APIの入力検証 ／ `lib/speech.ts` 読み上げ文
- `app/api/calc/route.ts` `POST /api/calc` ／ `app/useVoiceAssistant.ts` 認識・自動再開・WakeLock・読み上げ
- `data/ja-en.json` 日→英の対応表（ポケモン・わざは少数。足りない名前はここに追加）
- `cli/` コマンドライン版と Claude API 版（`npm run calc`, `npm run ask`。後者は `ANTHROPIC_API_KEY` が必要）

## API
`POST /api/calc` `{ "attacker": "Mimikyu", "defender": "Garchomp", "move": "Play Rough", "gen": 9 }`（英語名。`gen` は省略で9）
→ `{ min, max, minPercent, maxPercent, hp, ko, koText, assumptions, description }`。不正入力は 400 `{ error }`。

## テスト
`npm test`（単体＋API）／ `npm run typecheck` ／ `npm run build`

### Showdown との照合（手動・未実施）
計算エンジンは Showdown と同じ @smogon/calc だが、画面での突き合わせは未実施。
https://calc.pokemonshowdown.com/ で Gen9・Lv50・性格補正なし・努力値0・持ち物なし・特性は初期値にして比べる:
| 攻撃側 | わざ | 防御側 | 本アプリの結果 |
|---|---|---|---|
| Mimikyu | Play Rough | Garchomp | 98-116 (53.5 - 63.3%) 確定2発 |
| Archaludon | Flash Cannon | Flutter Mane | `npm run calc -- ブリジュラス ラスターカノン ハバタクカミ` で確認 |
| Gouging Fire | Earthquake | Charizard | ダメージなし（ひこう） |

## Vercel
そのままデプロイ可（環境変数は不要）。

## 未確認・制限
- Gen9 データを使用。**ポケモンチャンピオンズ固有の仕様は未反映／未検証**。実測ダメージとのズレ確認が必要
- 努力値・性格・持ち物は仮定値（0振り・補正なし・なし）。特性・天候・ランク補正は未考慮
- Web Speech API の精度・対応はブラウザ依存。Chrome 系は音声が外部サーバに送られる
