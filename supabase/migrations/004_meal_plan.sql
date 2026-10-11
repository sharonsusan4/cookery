-- Adds the meal plan (the Plan tab) to a project that was set up before it.
-- Paste all of this into Supabase > SQL Editor and click Run, once, BEFORE
-- deploying the app version that uses it (the app reads and writes meal_plan,
-- and the Plan tab would fail without it).
-- Running it again does no harm: everything is "if not exists" or checked first.
-- schema.sql already includes all of this for a brand-new project.

-- One row per dish she's planned: a day, a meal and the recipe.
create table if not exists public.meal_plan (
  id bigint generated always as identity primary key,
  -- Her own calendar date (the phone's clock, in India), not a UTC moment.
  day date not null,
  -- Breakfast, Lunch, Snacks, Dinner, Desserts or Drinks (MEALS in app/app.js).
  meal text not null,
  -- Recipes are never deleted, but if one ever is, it simply leaves the plan.
  recipe_id bigint not null references public.recipes (id) on delete cascade,
  created_at timestamptz not null default now(),
  -- The same dish only once per meal.
  constraint meal_plan_day_meal_recipe_id_key unique (day, meal, recipe_id)
);

create index if not exists meal_plan_day_idx on public.meal_plan (day);

-- Same rule as recipes and the shopping list: only signed-in people on the
-- allowed list. Dishes are added and taken off; moving one is both, so rows
-- are never changed and there's no update rule.
alter table public.meal_plan enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'meal_plan'
                 and policyname = 'Allowed users can read the meal plan') then
    create policy "Allowed users can read the meal plan"
      on public.meal_plan for select to authenticated
      using ((select public.is_allowed()));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'meal_plan'
                 and policyname = 'Allowed users can add to the meal plan') then
    create policy "Allowed users can add to the meal plan"
      on public.meal_plan for insert to authenticated
      with check ((select public.is_allowed()));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'meal_plan'
                 and policyname = 'Allowed users can take dishes off the meal plan') then
    create policy "Allowed users can take dishes off the meal plan"
      on public.meal_plan for delete to authenticated
      using ((select public.is_allowed()));
  end if;
end
$$;

revoke all on public.meal_plan from anon, authenticated;
grant select, insert, delete on public.meal_plan to authenticated;
