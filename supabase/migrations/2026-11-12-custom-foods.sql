-- Foods you add yourself. Run once in Supabase: Dashboard → SQL Editor → New query → paste → Run.
-- (supabase/schema.sql already includes this, so new projects don't need it.)

-- Foods a person adds themselves (typed in, or read from a photo of the nutrition label), with the numbers for one serving.
create table if not exists public.custom_foods (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null check (length(trim(name)) > 0),
  serving_label text,                                                -- as the label words it, e.g. "2/3 cup"
  serving_amount numeric not null check (serving_amount > 0),         -- one serving in serving_unit
  serving_unit text not null default 'g' check (serving_unit in ('g', 'ml')),
  kcal numeric not null default 0 check (kcal >= 0),                 -- per serving
  protein numeric not null default 0 check (protein >= 0),
  carbs numeric not null default 0 check (carbs >= 0),
  fat numeric not null default 0 check (fat >= 0),
  created_at timestamptz not null default now()
);
alter table public.custom_foods enable row level security;
drop policy if exists "own custom foods" on public.custom_foods;
create policy "own custom foods" on public.custom_foods
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
