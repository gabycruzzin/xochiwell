-- Optional weight tracking. Run once in Supabase: Dashboard → SQL Editor → New query → paste → Run.
-- (supabase/schema.sql already includes this, so new projects don't need it.)

-- Off unless the person turns it on in settings, and the unit they prefer to see.
alter table public.profiles add column if not exists weight_tracking boolean not null default false;
alter table public.profiles add column if not exists weight_unit text not null default 'lb' check (weight_unit in ('lb', 'kg'));

-- One weigh-in per person per day, stored in kilograms whatever unit they use.
create table if not exists public.weights (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  day date not null,
  kg numeric not null check (kg > 0 and kg < 700),
  note text,
  created_at timestamptz not null default now(),
  unique (user_id, day)
);

alter table public.weights enable row level security;
drop policy if exists "own weights" on public.weights;
create policy "own weights" on public.weights
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
