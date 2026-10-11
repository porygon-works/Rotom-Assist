# ロトムアシスト 設計書

> **注記**：本書は試作版（第1段階）の設計記録。**新しい設計の正本は [architecture.md](architecture.md)**（実装の現状は同 15 章）。方針は [requirements.md](requirements.md) と [eval-plan.md](eval-plan.md) を優先する。画面は 2026-10-11 に「押して話す」方式（`/api/ask`）へ作り替えた。合言葉方式の `app/useVoiceAssistant.ts` と `/api/calc` は残しているが、画面からは使っていない

- 対象: ポケモン対戦ダメージ計算・音声アシスタント（略称 `roas` = Rotom Assist）
- 状態: 第1段階（音声 → ダメージ計算 → 表示・読み上げ）。実装は本書と一致させる。食い違ったら本書かコードを直す
- 方針の要約は [CLAUDE.md](../CLAUDE.md)、使い方は [README.md](../README.md)

## 1. 目的と範囲

**目的**: 対戦中に「ダメ計 ガブリアスにミミッキュのじゃれつく」と話すと、ダメージ範囲・確定数・前提条件を画面に出し、同じ内容を音声で返す。

**今回やること（第1段階）**
- 画面を開いている間だけマイクで連続認識し、合言葉「ダメ計」のあとの発話を質問として扱う
- 簡易ルールで質問を「攻撃側・防御側・わざ」に分解し、`@smogon/calc` で計算する
- 結果の画面表示と読み上げ、認識履歴の表示と（任意で）Supabase 保存

**やらないこと（次の段階）**
- Claude API による発話解釈（持ち物・努力値・天候など）→ 第2段階。現状のコードは `cli/` にあり、画面側では未使用
- 素早さ比較・先制判定 → 第3段階
- ログイン機能、複数ユーザー管理

**前提・制約**
- 計算は必ず `@smogon/calc`（Gen9 データ）。自前の式で数値を出さない
- ポケモンチャンピオンズ固有の仕様は**未反映・未検証**
- 公式大会やランクマッチでの外部ツール利用は、事前にルールを確認する

## 2. 全体構成

```
ブラウザ（Chrome 系推奨）
 ├─ Web Speech API  … 音声認識（連続・日本語）
 ├─ lib/wakeword, lib/parse, lib/speech … 合言葉・質問解釈・読み上げ文（純関数）
 └─ speechSynthesis … 読み上げ
        │ fetch
        ▼
Vercel（Next.js App Router）
 ├─ POST /api/calc     … @smogon/calc で計算
 ├─ POST /api/ask      … 質問 1 回の処理。答えた後に Supabase(roas.ask_log) へ記録（任意）
 └─ GET/POST /api/history … Supabase(roas.history) へ保存・取得（任意）
        │ service_role キー（サーバ側の環境変数）
        ▼
Supabase（プロジェクト porygon-works / スキーマ roas）
```

| 層 | ファイル | 役割 |
|---|---|---|
| 画面 | `app/page.tsx`, `app/useVoiceAssistant.ts` | 状態管理、認識の開始・停止・自動再開、結果と履歴の表示 |
| 解釈 | `lib/wakeword.ts`, `lib/parse.ts`, `lib/names.ts` | 合言葉検出、質問の分解、日英名変換 |
| 計算 | `lib/calc.ts`, `lib/validate.ts` | 計算本体、`/api/calc` の入力検証 |
| 読み上げ | `lib/speech.ts` | 結果 → 短い日本語文 |
| 保存 | `lib/history.ts`, `lib/validateHistory.ts`, `lib/askLog.ts` | Supabase REST の呼び出し、入力検証、質問の記録 |
| データ | `data/ja-en.json` | 日→英の対応表（ポケモン・わざ・持ち物） |

## 3. 画面と操作の流れ

### 3.1 状態
| 表示 | 条件 |
|---|---|
| 待機中 | 「開始」を押していない／「停止」後 |
| 合言葉待ち | 開始後、合言葉を待っている |
| 質問受付中 | 合言葉だけが言われ、次の発話を質問として待っている |
| 計算中 | 質問を受け、解釈・計算・読み上げ準備をしている |

```
待機中 ─開始→ 合言葉待ち ─「ダメ計」のみ→ 質問受付中 ─次の発話→ 計算中 ─完了→ 合言葉待ち
                │                              │ 15秒無言                 ▲
                └─「ダメ計 ＋質問」─────────────┴────────────────→ 計算中 ─┘
全状態 ─停止→ 待機中
```

### 3.2 認識の制御
- 「開始」を押すまでマイクは動かさない。設定は `continuous: true`、`interimResults: false`、`lang: ja-JP`
- 認識が途中で終了したら自動で再開する（通常 300ms 後、開始から 1 秒以内に終わった場合は 1.5 秒後）。**「停止」後は再開しない**
- 画面が非表示になったら認識・WakeLock・読み上げを止め、表示に戻ったとき「開始中だった場合だけ」再開する
- マイク拒否（`not-allowed`、`service-not-allowed`）は再開せず、画面に案内を出す
- WakeLock API が使えれば、認識中は画面を消えにくくする。使えなくても動く
- 読み上げ中に次の質問が来たら、`speechSynthesis.cancel()` で止めてから新しい結果を読む。古い計算結果はリクエスト番号で破棄する
- 読み上げの失敗は計算結果に影響させない

### 3.3 画面の要素
開始／停止ボタン、状態バッジ、マイク状態（停止中・聞いています・話し声を検出）、結果カード（ダメージ範囲・確定数・前提条件・計算内訳・読み上げ文）、認識履歴（最大 50 件）、診断パネル（最大 30 件、反応しないときの切り分け用）

## 4. 合言葉と質問の解釈

### 4.1 合言葉（`lib/wakeword.ts`）
- 基準は「ダメ計」。音声認識の聞き違い候補（ダメ経、ダメージ計算 など）を `WAKE_WORDS` に並べる。変えるときはこの配列だけを直す
- 空白を除いたテキストで最も早い出現位置を採用し、同位置なら長い候補を優先する
- 合言葉のあとの文字列を質問とする。空なら、次の発話（15 秒以内）を質問として待つ

### 4.2 質問の分解（`lib/parse.ts`、Claude API は使わない）
1. わざを先に拾い、拾った範囲を伏せる（わざ名の一部がポケモン名に当たるのを防ぐ）
2. ポケモン名を長い名前から順に拾う
3. 役割の判定: ポケモン名の直後が「の・が・から」なら**攻撃側**、「に・へ」なら**防御側**。一方が決まれば他方は残り
4. 解釈できないときは、分からなかった内容を返す（画面表示と音声の両方）
   - 対応表にないカタカナ語 → 「『○○』は対応表にありません」
   - わざがない／複数ある、ポケモンが 2 匹に満たない／3 匹以上、攻撃側が決められない

例: 「ガブリアスにミミッキュのじゃれつく」→ 攻撃側 ミミッキュ、防御側 ガブリアス、わざ じゃれつく

### 4.3 名前の対応表（`data/ja-en.json`）
`pokemon` / `moves` / `items` の 3 区分。**日本語名をコードに書かない**。足りない名前はここに追加し、`test/parse.test.ts` が全エントリのライブラリ存在確認を行う。

## 5. 計算の方針（`lib/calc.ts`）

- 世代は Gen9、Lv50、個体値 31
- **前提は仮定値**: 努力値 0 振り、性格補正なし、持ち物なし、特性・天候・フィールド・ランク補正は考慮しない。画面と音声の両方で「仮定値」と明示する
- ダメージ範囲は乱数 16 通り（連続技は全組合せ）の最小〜最大。割合は Showdown 表示と同じ切り捨て
- **「確定」と言う条件**: `@smogon/calc` の `kochance()` が `chance === 1` を返したときだけ。それ以外は「乱数N発（確率）」、4 発以上は「確定数なし」
- ダメージ 0（無効）のときは `kochance()` / `desc()` が例外を出すため呼ばず、「ダメージなし」とする
- 入力が不明なときは推定の幅を示し、「分からない」を明示する（第2段階で拡張）

## 6. API 仕様

### 6.1 `POST /api/calc`
リクエスト（英語名）:
```json
{ "attacker": "Mimikyu", "defender": "Garchomp", "move": "Play Rough", "gen": 9 }
```
- `gen` は省略で 9。各文字列は 64 文字以内。存在しない種族・わざは 400
- 成功（200）: `{ min, max, minPercent, maxPercent, hp, ko:{kind,n,chance}, koText, assumptions[], description }`
- 失敗（400）: `{ "error": "…" }`（JSON 不正、型不正、世代不正、存在しない名前、計算失敗）

### 6.2 `POST /api/history`
`{ device_id, kind: "utterance"|"event", text, note }` → 保存。`text`・`note` は 500 文字に切る。Supabase 未設定なら `{configured:false, saved:false}`（200）。Supabase 失敗は 502（エラー本文にキーを含めない）

### 6.3 `GET /api/history?device_id=…`
その端末の `utterance` を新しい順に最大 50 件返す。未設定なら `{configured:false, items:[]}`

### 6.4 端末ID
`localStorage` の `rotom-device-id`（UUID）。ログインはなく、このIDで履歴を絞る。**IDを知らない他人には見えないが、ブラウザのデータを消すと過去の履歴は見えなくなる**

### 6.4b 聞き間違いの補正と、特性・相性の質問
- `/api/ask` は最初に `lib/misheard.ts` で音声認識の聞き間違いを直す（「受診」→「じしん」、「HBブリ」→「HB振り」など。表は `data/misheard.json`）。ルールも AI も直した文で読む。直した文は画面の「診断」に出す。表は `roas.ask_log` の実際の質問を見て足す
- 計算の言葉（入る・耐える・何発など）がない質問は、AI の分類がぶれても文の言葉で振り分ける: 「特性」→ そのポケモンの特性の一覧（特性名を言ったときは持っているポケモン。効果の説明文はデータがないので未対応）、「抜群・効く・相性」＋技 → その技の相性

### 6.5 `POST /api/ask` の記録
`/api/ask` は答えを返した後（`next/server` の `after`）に、質問・答え・答え方・AI の呼び出し結果・AI の設定の状態を `roas.ask_log` に 1 行書く。Supabase 未設定なら書かない。記録の失敗は答えに影響させず、Vercel の Logs に出す。
AI の設定の状態（`diagnostics.setup`）は画面の「診断」にも出す: 環境（`VERCEL_ENV`）、コミット、各キーの有無（値は出さない）。AI の候補が 0 件のときは、画面の詳しい結果にも「キーが見えていない」ことと確認手順を出す。

## 7. データベース設計

プロジェクト `porygon-works`（東京、Free）の `roas` スキーマ。作成 SQL は `supabase/001_init.sql`。

### 7.1 `roas.history`
| 列 | 型 | 説明 |
|---|---|---|
| `id` | bigint identity | 主キー |
| `device_id` | text | 端末ID |
| `kind` | text | `utterance`（発話）／`event`（エラーなど）。check 制約あり |
| `text` | text | 認識した文字、またはエラー名 |
| `note` | text | 処理結果（例: `53.5〜63.3% 確定2発`、`合言葉なし（無視）`） |
| `created_at` | timestamptz | 既定 `now()` |

索引: `history_device_created (device_id, created_at desc)`。RLS は有効でポリシーなし（サーバの `service_role` だけが読み書きできる）。

### 7.2 `roas.ask_log`（`supabase/002_ask_log.sql`）
質問 1 回ごとの記録。答えられなかった理由（AI のキーが見えていない、AI が混んでいる、解釈できない）を後から調べるためのもの。
| 列 | 型 | 説明 |
|---|---|---|
| `id` | bigint identity | 主キー |
| `device_id` | text | 端末ID（6.4。無ければ空） |
| `question` | text | 質問文（音声認識の結果） |
| `title`・`speech`・`intent` | text | 画面の見出し・読み上げ文・答えの種類（`error`、`clarify` など） |
| `provider` | text | `rules`（ルールで即答）／AI の名前／空（答えられなかった） |
| `total_ms` | integer | サーバ側の処理時間 |
| `attempts` | jsonb | AI の呼び出しごとの結果 `[{provider, ms, ok, error}]` |
| `extraction` | jsonb | 質問の解釈 |
| `setup` | jsonb | AI の設定の状態 `{env, commit, keys, providers}`。キーの値は入れない |
| `created_at` | timestamptz | 既定 `now()` |

索引: `ask_log_created (created_at desc)`、`ask_log_device_created (device_id, created_at desc)`。RLS は有効でポリシーなし。

### 7.3 Supabase 側の必須設定（作成後の 3 点セット）
1. `supabase/001_init.sql`、`supabase/002_ask_log.sql` を SQL Editor で順に実行（スキーマ作成・テーブル・RLS・`service_role` への権限付与）
2. Project Settings → Data API → **Exposed schemas に `roas` を追加**
3. Vercel の環境変数 `SUPABASE_URL`、`SUPABASE_SERVICE_ROLE_KEY` を設定して再デプロイ

## 8. 共有 Supabase の規則

1つのプロジェクト（`porygon-works`）を複数アプリで共有するための規則。新しいアプリを足すときは、この章に従う。

### 8.1 命名
- **アプリごとにスキーマを作る。** スキーマ名はアプリの略称で、小文字・英数字・スネークケース（例: `roas`、`gymlog`）。大文字は使わない（引用符が必要になり事故のもと）
- テーブル・列は小文字のスネークケース。テーブル名にアプリ接頭辞は付けない（スキーマが名前空間になる）
- 共通で使うテーブルが必要になったら、`shared` スキーマに置く

| スキーマ | アプリ | 状態 |
|---|---|---|
| `roas` | ロトムアシスト | 使用中 |
| `shared` | アプリ間の共通データ | 予約（未作成） |

### 8.2 列
- 主キーは `id`（`bigint generated always as identity` または `uuid`）
- `created_at timestamptz not null default now()` を必ず付ける。更新があるテーブルは `updated_at` も付ける
- 端末・ユーザーの区別は `device_id` または `user_id` に統一する

### 8.3 安全
- **全テーブルで RLS を有効にする。** ポリシーを作らなければ、サーバ専用になる
- `service_role`（Secret）キーはサーバ側（Vercel の環境変数）だけに置く。`NEXT_PUBLIC_` は付けない。コード・Git・チャットに貼らない
- ブラウザから直接つなぐ場合は、`anon`（Publishable）キーと RLS ポリシーを必須とする
- 全アプリが同じ `service_role` キーを使う間、スキーマ分けは**整理と事故防止であって、セキュリティの分離ではない**。分離が必要になったらアプリ専用のロール、またはプロジェクトを分ける
- 個人情報・パスワードは保存しない。保存するデータはアプリごとの設計書に書く

### 8.4 新しいスキーマを足す手順（3 点セット）
```sql
create schema if not exists <app>;
grant usage on schema <app> to service_role;
grant all on all tables in schema <app> to service_role;
grant all on all sequences in schema <app> to service_role;
alter default privileges in schema <app> grant all on tables to service_role;
alter default privileges in schema <app> grant all on sequences to service_role;
```
そのあと、Exposed schemas に `<app>` を追加する。API 呼び出しでは、書き込みに `Content-Profile: <app>`、読み出しに `Accept-Profile: <app>` を付ける。

### 8.5 変更の管理
- テーブルの作成・変更は SQL ファイルとしてリポジトリに残す（`supabase/NNN_内容.sql` の連番。本アプリは `001_init.sql`）
- **適用済みの SQL は書き換えない。** 変更は新しい番号のファイルで足す
- `drop`・`delete`・`truncate` は、実行前に対象と影響を確認する

### 8.6 運用
- 無料プランは**バックアップがない**。大事なデータは Table Editor の Export で CSV に書き出して保管する
- 約 1 週間使われないと一時停止する。ダッシュボードの Restore で再開できる（データは消えない）
- 無料枠: アクティブなプロジェクトは 2 つまで、データベース 500MB を全アプリで合算。数値は変わりうるので https://supabase.com/pricing で確認する
- GitHub 連携は使わない（マイグレーションは手動で実行する）

## 9. 運用

- デプロイ: Vercel に GitHub リポジトリを Import。環境変数は Supabase 用 2 つのみ（任意）
- マイクは https か localhost でのみ使える
- Chrome 系の音声認識は、音声が外部サーバに送られる。他人に共有する場合は伝える
- 履歴には発話の文字起こしが保存される。`roas.ask_log` には質問文と答えが保存される

## 10. テスト

`npm test`（単体＋API ルート）、`npm run typecheck`、`npm run build`。主な観点:
- 日英名で同じ結果／基準ケース（Mimikyu Play Rough vs Garchomp = 98-116, 確定2発）
- 「確定」の判定、ダメージ 0、不正入力の 400
- 質問解釈（語順違い、未登録名、わざ欠落、役割不明）／合言葉の候補と最長一致
- 履歴: Supabase 未設定、保存・取得、スキーマ指定ヘッダ、失敗時にキーを漏らさない
- ブラウザ結合: 偽の SpeechRecognition で、開始→合言葉→計算→読み上げ→自動再開→非表示→停止後に再開しない

## 11. 未確認事項と今後

| 項目 | 状態 |
|---|---|
| Showdown の画面との照合 | 未実施（README に照合表） |
| ポケモンチャンピオンズ固有の仕様（ステータスポイント制など） | 未反映・未検証。実測ダメージとのズレ確認が必要 |
| 実機（スマホ）での音声認識精度、合言葉の表記 | 未確認。診断パネルの履歴を見て `WAKE_WORDS` を調整 |
| 本物の Supabase との接続 | 未確認（モックでの結合確認のみ） |
| 対応表の拡充 | ポケモン 11 匹、わざ 11 個、持ち物 4 つだけ |
| 第2段階 | Claude API で発話を解釈。API を公開する場合は認証・レート制限を入れる |
| 第3段階 | 素早さ比較、確定数の拡張、先制判定 |
