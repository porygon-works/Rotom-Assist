-- Supabase の SQL Editor で実行する。
-- 1つのプロジェクトを複数アプリで共有する想定で、テーブル名に rotom_ を付けている。
create table if not exists public.rotom_history (
  id bigint generated always as identity primary key,
  device_id text not null,
  kind text not null check (kind in ('utterance', 'event')),
  text text not null,
  note text not null default '',
  created_at timestamptz not null default now()
);
create index if not exists rotom_history_device_created on public.rotom_history (device_id, created_at desc);

-- RLS を有効にしてポリシーを作らない = ブラウザ(anon)からは読み書きできず、
-- サーバ(/api/history が使う service role キー)だけが読み書きできる。
alter table public.rotom_history enable row level security;
