-- Supabase の SQL Editor で実行する。
create table if not exists public.history (
  id bigint generated always as identity primary key,
  device_id text not null,
  kind text not null check (kind in ('utterance', 'event')),
  text text not null,
  note text not null default '',
  created_at timestamptz not null default now()
);
create index if not exists history_device_created on public.history (device_id, created_at desc);

-- RLS を有効にしてポリシーを作らない = ブラウザ(anon)からは読み書きできず、
-- サーバ(/api/history が使う service role キー)だけが読み書きできる。
alter table public.history enable row level security;
