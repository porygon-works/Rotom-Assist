# Rotom-Assist
ポケモン対戦（ポケモンチャンピオンズ）のダメージ計算・音声アシスタント（v1 初期版）。方針は [CLAUDE.md](CLAUDE.md)。

## 使い方
```bash
npm install
# AI のキー（どちらか一方でも動く。両方あると、上限に当たったとき自動で切り替える）
export GEMINI_API_KEY=...   # Google AI Studio で作る（無料）
export GROQ_API_KEY=...     # Groq のコンソールで作る（無料）
npm run dev                 # http://localhost:3000 （マイクは https か localhost のみ）
```
Vercel では Settings → Environment Variables に同じ名前で登録する（コード・Git には書かない）。

1. 大きなボタンを**押しながら**話して、離す（PC はスペースキー。「タップで開始／終了」にも切り替えられる）
   - 例:「HB振りエンペルトのHP120残ってるんだけど、A特化ガブのじしん耐える？」
   - 例:「S二段階上昇のイダイトウって最速メガルカリオZ抜ける？」「メガルカリオZがどこまで振ってたら負ける？」
   - 例:「じゃあステロ込みだったら？」（直前の質問を引き継ぐ）
2. 結論・ダメージ・確定数（または素早さ）が画面に出て、読み上げられる
3. 音声が使えないときは、下の欄に文字で入力する

### 分かること
| 質問 | 例 |
|---|---|
| ダメージ・確定数・耐えるか | 特化・H振り・性格・ランク・持ち物・特性・残りHP・ステロ込み・天候・フィールド・壁・急所 |
| 素早さ | どっちが速いか、抜けるか、実数値、どこまで振ると抜かれるか（最速・準速・最遅・スカーフ・ランク） |
| タイプ・弱点、種族値、わざの性能、覚える技 | 「サーフゴーの弱点は？」「カイリューの種族値」「じゃれつくって何タイプ？」「サーナイトってでんじは覚える？」 |

- 振り方を言わなかった側は**無振り**で計算し、「振り方しだいで〇〜〇%」の幅も言う
- 「確定」と言うのは乱数の全範囲で倒せるときだけ。それ以外は「乱数」
- 自分のパーティ、雑談はまだ対応していない

## 構成（詳しくは [docs/architecture.md](docs/architecture.md) 15 章）
- `app/page.tsx`・`app/usePushToTalk.ts` 画面（押して話す、ブラウザの音声認識と読み上げ）
- `app/api/ask/route.ts` `POST /api/ask` 1 往復の処理（`lib/ask.ts`）
- `lib/llm.ts`・`lib/extractPrompt.ts` AI で質問の中身を取り出す（Gemini 3.5 Flash-Lite → 3.1 Flash-Lite → Groq の順に切り替え）
- `lib/resolve.ts` 名前の解決（正式名・あだ名・聞き間違い）。データは `data/names.json`（`scripts/build-names.ts` で生成）と `data/aliases.json`（手入力）
- `lib/battle.ts` @smogon/calc 第0世代（チャンピオンズ）で計算 ／ `lib/answer.ts` ロトム口調の回答文
- `eval/` AI の比較テストと再生テスト（[docs/eval-plan.md](docs/eval-plan.md)）

## API
`POST /api/ask` `{ "text": "ガブにミミッキュのじゃれつく", "history": [{ "user": "前の質問", "extraction": {…} }] }`
→ `{ speech, title, lines, intent, extraction, diagnostics }`。`history` は任意（直前の 1 件だけ使う）。

試作版の `POST /api/calc`（英語名・第9世代）も残している（画面からは使っていない）。

## テスト
`npm test`（単体＋API）／ `npm run typecheck` ／ `npm run build` ／ `npx tsx eval/replay.ts`（保存済みの AI の出力でアプリの回答を一覧にする。AI は呼ばない）

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
