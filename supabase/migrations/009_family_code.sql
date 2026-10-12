-- Lets Sharon (or Mom) choose the family code, so it can be short and easy to
-- remember. Family now open the plain address and type it with their name;
-- old family links (…/#join=<code>) keep working while their code is current.
--
-- Run it once in Supabase > SQL Editor (or with `supabase db query`) BEFORE
-- deploying the app version that has the "Family code" box on Visitors (that
-- version calls set_family_code()). Running it again does no harm: every
-- function is "create or replace", and the current code is left as it is.
-- It is one transaction, so it either all goes in or none of it does.
-- schema.sql already includes all of this for a brand-new project.
--
-- No rule (RLS) changes: guests still only read Mom's recipes.
--
-- A word on guessing: a short code is easier to guess than the old random
-- 12-character one. Each try needs a new anonymous sign-in, and Supabase
-- allows about 30 of those per hour per IP address, with join_family()
-- stopping one session after 10 wrong codes. So keep the code 6 characters or
-- more (set_family_code() insists), and pick something family know and
-- strangers wouldn't guess. Change it if it ever goes somewhere it shouldn't.

begin;

-- How codes are compared everywhere: lowercase, no spaces at the ends, and
-- any run of spaces inside made a single space. " Amma  Kitchen " and
-- "amma kitchen" are the same code.
create or replace function private.clean_family_code(code text) returns text
language sql
immutable
set search_path = ''
as $$
  select btrim(regexp_replace(lower(coalesce(code, '')), '[[:space:]]+', ' ', 'g'));
$$;

revoke execute on function private.clean_family_code(text) from public, anon, authenticated;

-- Mom and Sharon only: set the family code to one they choose. 6 to 40
-- characters once cleaned. Replaces the old code (people already in stay in)
-- and returns the code as it will be compared.
create or replace function public.set_family_code(code text) returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  clean text := private.clean_family_code(set_family_code.code);
begin
  if not public.is_allowed() then
    raise exception 'Only allowed users can change the family code' using errcode = '42501';
  end if;
  if char_length(clean) < 6 then
    raise exception 'The family code needs at least 6 letters or numbers.' using errcode = '22023';
  end if;
  if char_length(clean) > 40 then
    raise exception 'The family code can have at most 40 letters or numbers.' using errcode = '22023';
  end if;
  insert into private.family_code (id, code, created_at)
  values (true, clean, now())
  on conflict (id) do update set code = excluded.code, created_at = excluded.created_at;
  return clean;
end;
$$;

revoke execute on function public.set_family_code(text) from public, anon;
grant execute on function public.set_family_code(text) to authenticated;

-- As in 005, but both sides are cleaned the same way before the hashes are
-- compared (so spaces and capitals typed on a phone don't matter). The rate
-- limit is unchanged: 10 wrong codes in 15 minutes per anonymous session.
create or replace function public.join_family(code text, name text) returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  uid uuid := auth.uid();
  current_code text;
  clean_name text;
begin
  if uid is null or public.is_allowed() then
    return false;
  end if;

  if (select count(*) from private.join_failures f
      where f.user_id = uid and f.at > now() - interval '15 minutes') >= 10 then
    return false;
  end if;

  -- Across everyone: the app starts a fresh anonymous session for each try, so
  -- the limit above rarely bites. 30 wrong codes in an hour from anyone (someone
  -- guessing) pauses joining until the hour has passed; family can try later.
  if (select count(*) from private.join_failures f where f.at > now() - interval '1 hour') >= 30 then
    raise exception 'Too many wrong family codes just now. Try again later.' using errcode = 'P0001';
  end if;

  select fc.code into current_code from private.family_code fc where fc.id;

  -- Compared as hashes, so how long the comparison takes says nothing about the code.
  if current_code is null or
     sha256(convert_to(private.clean_family_code(join_family.code), 'UTF8')) <>
     sha256(convert_to(private.clean_family_code(current_code), 'UTF8')) then
    insert into private.join_failures (user_id) values (uid);
    delete from private.join_failures f where f.at < now() - interval '1 day';
    return false;
  end if;

  clean_name := trim(left(trim(regexp_replace(coalesce(join_family.name, ''), '[[:space:][:cntrl:]]+', ' ', 'g')), 40));
  if clean_name = '' then
    return false;
  end if;

  insert into public.guests as g (user_id, name)
  values (uid, clean_name)
  on conflict (user_id) do update set name = excluded.name, last_seen = now();
  return true;
end;
$$;

revoke execute on function public.join_family(text, text) from public, anon;
grant execute on function public.join_family(text, text) to authenticated;

create index if not exists join_failures_at_idx on private.join_failures (at);

commit;
