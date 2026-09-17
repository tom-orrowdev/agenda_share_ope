-- Backing table for the "make-server-dfb18bbe" edge function's key-value store.
create table if not exists public.kv_store_dfb18bbe (
  key text not null primary key,
  value jsonb not null
);

alter table public.kv_store_dfb18bbe enable row level security;

-- The edge function talks to Postgres with the service_role key, which
-- bypasses RLS. No policy is granted to anon/authenticated, so the table
-- is unreachable directly from the browser.
