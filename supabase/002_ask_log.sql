-- Supabase の SQL Editor で実行する（001_init.sql の後）。roas スキーマと権限は 001 で作成済み。
-- 質問 1 回ごとの記録（/api/ask が書く）。答えられなかった理由を後から調べるためのもの。

create table if not exists roas.ask_log (
  id bigint generated always as identity primary key,
  device_id text not null default '',
  question text not null,
  title text not null default '',
  speech text not null default '',
  intent text not null default '',
  -- rules = ルールで即答 / AI の名前 / 空 = 答えられなかった
  provider text not null default '',
  total_ms integer not null default 0,
  -- AI の呼び出しごとの結果 [{provider, ms, ok, error}]
  attempts jsonb not null default '[]',
  -- 質問の解釈（AI またはルールの取り出し結果）
  extraction jsonb,
  -- AI の設定の状態 {env, commit, keys: {GEMINI_API_KEY: true/false, ...}, providers}。キーの値は入れない
  setup jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index if not exists ask_log_created on roas.ask_log (created_at desc);
create index if not exists ask_log_device_created on roas.ask_log (device_id, created_at desc);

-- RLS を有効にしてポリシーを作らない = サーバ(service role キー)だけが読み書きできる
alter table roas.ask_log enable row level security;

-- 001 の alter default privileges で権限は付くが、念のため明示する
grant all on roas.ask_log to service_role;
