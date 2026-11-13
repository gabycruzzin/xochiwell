-- Run this once in your Supabase project: Dashboard → SQL Editor → New query → paste → Run.
-- Every table is locked down with row level security, so a signed-in user can only see and change their own rows.

-- One row per food logged.
create table if not exists public.diary_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  day date not null,
  meal text not null check (meal in ('Breakfast', 'Lunch', 'Dinner', 'Snacks')),
  name text not null,
  grams numeric not null check (grams > 0),   -- amount logged, in `unit`
  unit text not null default 'g',              -- 'g', or 'ml' for drinks
  servings numeric,                            -- null for entries logged by weight only
  kcal numeric not null default 0,
  protein numeric not null default 0,
  carbs numeric not null default 0,
  fat numeric not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists diary_entries_user_day on public.diary_entries (user_id, day);

-- Daily calorie and macro goals, one row per user.
create table if not exists public.goals (
  user_id uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  kcal numeric not null default 2000,
  protein numeric not null default 150,
  carbs numeric not null default 200,
  fat numeric not null default 65,
  updated_at timestamptz not null default now()
);

-- Serving sizes a user set for foods that don't list one, keyed by Open Food Facts product code.
create table if not exists public.custom_servings (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  food_id text not null,
  grams numeric not null check (grams > 0),
  primary key (user_id, food_id)
);

-- Setup answers and preferences, one row per user. No body measurements are stored.
create table if not exists public.profiles (
  user_id uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  setup_choice text check (setup_choice in ('log', 'goals')),  -- null until the welcome screen is answered
  reasons text[] not null default '{}',                         -- what brings them here, e.g. 'energy', 'strength'
  activity text check (activity in ('low', 'moderate', 'high')),
  targets_on boolean not null default false,                    -- false = just track, no goal bars
  goals_offer_dismissed boolean not null default false,         -- the one-time "want help setting goals?" offer
  typical_day jsonb,
  weight_tracking boolean not null default false,                 -- optional weight tracking, off by default
  weight_unit text not null default 'lb' check (weight_unit in ('lb', 'kg')),                                            -- foods they listed as a normal day, kept apart from the diary
  updated_at timestamptz not null default now()
);

alter table public.diary_entries enable row level security;
alter table public.goals enable row level security;
alter table public.custom_servings enable row level security;
alter table public.profiles enable row level security;

drop policy if exists "own diary entries" on public.diary_entries;
create policy "own diary entries" on public.diary_entries
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "own goals" on public.goals;
create policy "own goals" on public.goals
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "own custom servings" on public.custom_servings;
create policy "own custom servings" on public.custom_servings
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "own profile" on public.profiles;
create policy "own profile" on public.profiles
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Lets a signed-in user permanently delete their own account and, through the cascades above, all their data.
create or replace function public.delete_my_account()
returns void
language sql
security definer
set search_path = ''
as $$
  delete from auth.users where id = auth.uid();
$$;

revoke all on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;

-- Optional weigh-ins, one per person per day, stored in kilograms.
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
