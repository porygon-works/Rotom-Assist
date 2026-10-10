-- Supabase の SQL Editor で実行する。
-- 1つのプロジェクトを複数アプリで共有する想定で、アプリごとにスキーマを分ける（このアプリは roas = Rotom Assist）。

create schema if not exists roas;

create table if not exists roas.history (
  id bigint generated always as identity primary key,
  device_id text not null,
  kind text not null check (kind in ('utterance', 'event')),
  text text not null,
  note text not null default '',
  created_at timestamptz not null default now()
);
create index if not exists history_device_created on roas.history (device_id, created_at desc);

-- RLS を有効にしてポリシーを作らない = ブラウザ(anon)からは読み書きできず、
-- サーバ(/api/history が使う service role キー)だけが読み書きできる。
alter table roas.history enable row level security;

-- service_role に、このスキーマを使う権限を与える（忘れると "permission denied for schema" になる）。
grant usage on schema roas to service_role;
grant all on all tables in schema roas to service_role;
grant all on all sequences in schema roas to service_role;
alter default privileges in schema roas grant all on tables to service_role;
alter default privileges in schema roas grant all on sequences to service_role;

-- このあと必ず: Project Settings → Data API → Exposed schemas に「roas」を追加して保存する。
