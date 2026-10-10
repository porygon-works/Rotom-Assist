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

## 認識履歴の保存（Supabase・任意）
設定しなくてもアプリは動く（履歴はその画面の中だけ）。保存したい場合:
1. Supabase でプロジェクトを作り、SQL Editor で [`supabase/001_init.sql`](supabase/001_init.sql) を実行（`roas` スキーマに `history` テーブルを作る。他のアプリと1つのプロジェクトを共有できるよう、アプリごとにスキーマを分けている）
2. **Project Settings → Data API → Exposed schemas に `roas` を追加**して保存（忘れると API が `The schema must be one of the following` のエラーを返す）
3. Vercel の Settings → Environment Variables に **2つ** 追加して再デプロイ（コード・Git には書かない）
   - `SUPABASE_URL`：Project Settings → API の Project URL
   - `SUPABASE_SERVICE_ROLE_KEY`：同じ画面の `service_role`（または Secret）キー。**`NEXT_PUBLIC_` は付けない**
4. 画面の「診断」に「Supabaseに保存中」と出れば成功

- 書き込み・読み出しはサーバ（`/api/history`）だけが行う。テーブルは RLS 有効・ポリシーなしで、ブラウザから直接は触れない
- 履歴は端末ごとの匿名ID（localStorage）で絞って返す。ログインはないので、**IDを知らない他人には見えないが、端末を変える／ブラウザのデータを消すと過去の履歴は見えなくなる**
- 発話の文字起こしが保存される。公開URLを他人に共有する場合は注意

## 音声認識が反応しないとき
画面下の「診断」を開き、上から順に確認する。
| 診断の表示 | 意味と対処 |
|---|---|
| 何も出ない／「認識エンジン起動」が出ない | 「開始」が押せていない、またはブラウザ非対応（iPhone の Safari は不安定。Android の Chrome 推奨） |
| 「エラー: not-allowed」 | マイク未許可。ブラウザのサイト設定で許可 |
| 「エラー: network」 | 音声認識サーバに接続できない（Chrome は音声を外部サーバに送る） |
| 「話し声を検出」まで出るが「認識結果」が出ない | 声が小さい／周囲が騒がしい。マイクに近づく |
| 「認識結果: …」が出るが履歴が「合言葉なし（無視）」 | 「ダメ計」が別の表記になっている。その表記を `lib/wakeword.ts` の `WAKE_WORDS` に追加 |

## Vercel
そのままデプロイ可。環境変数は上記の Supabase 用（任意）のみ。

## 未確認・制限
- Gen9 データを使用。**ポケモンチャンピオンズ固有の仕様は未反映／未検証**。実測ダメージとのズレ確認が必要
- 努力値・性格・持ち物は仮定値（0振り・補正なし・なし）。特性・天候・ランク補正は未考慮
- Web Speech API の精度・対応はブラウザ依存。Chrome 系は音声が外部サーバに送られる
