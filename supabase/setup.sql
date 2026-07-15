-- 拼音快线 cloud schema — paste the whole file into the Supabase SQL Editor and Run.
-- Creates invites / profiles / scores / badges + row-level security + the leaderboard view.
-- ⚠ Change the seed invite code at the bottom before running, if you want your own.
-- Re-running DROPS AND RECREATES everything (fine before launch, destructive after).

drop function if exists public.register_profile(text,text,text,text);
drop function if exists public.check_invite(text);
drop view if exists public.leaderboard;
drop table if exists public.badges;
drop table if exists public.scores;
drop table if exists public.profiles;
drop table if exists public.invites;

-- invite codes gate registration; RLS with no policies = invisible to the API
create table public.invites (
  code     text primary key check (char_length(code) between 4 and 40),
  max_uses int  not null default 1000000,
  used     int  not null default 0,
  active   boolean not null default true
);

-- one row per account: leaderboard nickname + synced UI preferences.
-- Rows are only ever created through register_profile() below.
create table public.profiles (
  id         uuid primary key references auth.users(id) on delete cascade,
  nickname   text not null check (char_length(nickname) between 2 and 20),
  lang       text check (lang in ('zh','en')),
  theme      text check (theme in ('dark','light')),
  created_at timestamptz not null default now()
);
create unique index profiles_nickname_key on public.profiles (lower(nickname));

-- one row per finished run; checks double as cheap anti-cheat caps
create table public.scores (
  id         bigint generated always as identity primary key,
  user_id    uuid not null references auth.users(id) on delete cascade,
  mode       text not null check (mode in ('l1','l2','l3','boss')),
  score      int  not null check (score between 0 and 200000),
  wpm        int  not null check (wpm between 0 and 200),
  acc        numeric(5,2) not null check (acc between 0 and 100),
  max_combo  int  not null check (max_combo between 0 and 500),
  duration_s numeric(7,1) not null check (duration_s between 5 and 3600),
  stars      int  not null check (stars between 1 and 3),
  created_at timestamptz not null default now()
);
create index scores_mode_score on public.scores (mode, score desc);
create index scores_user on public.scores (user_id);

create table public.badges (
  user_id   uuid not null references auth.users(id) on delete cascade,
  badge     text not null check (char_length(badge) <= 24),
  earned_at timestamptz not null default now(),
  primary key (user_id, badge)
);

-- best score per player per mode; clients order by score and limit
create view public.leaderboard with (security_invoker = on) as
  select distinct on (s.mode, s.user_id)
         s.mode, s.user_id, p.nickname, s.score, s.wpm, s.acc, s.stars, s.created_at
  from public.scores s
  join public.profiles p on p.id = s.user_id
  order by s.mode, s.user_id, s.score desc, s.created_at asc;

-- non-consuming pre-check so the client can reject a bad code before signup
create function public.check_invite(p_code text) returns boolean
language sql security definer set search_path = public as $$
  select exists (select 1 from invites where code = p_code and active and used < max_uses)
$$;

-- the only way to create a profile: consumes one invite use, all-or-nothing
create function public.register_profile(p_nickname text, p_code text, p_lang text, p_theme text)
returns void language plpgsql security definer set search_path = public as $$
declare v_ok boolean;
begin
  if auth.uid() is null then
    raise exception 'not signed in' using errcode = 'IV002';
  end if;
  update invites set used = used + 1
    where code = p_code and active and used < max_uses
    returning true into v_ok;
  if v_ok is null then
    raise exception 'invalid invite code' using errcode = 'IV001';
  end if;
  insert into profiles(id, nickname, lang, theme) values (auth.uid(), p_nickname, p_lang, p_theme);
end $$;

revoke all on function public.check_invite(text) from public;
revoke all on function public.register_profile(text,text,text,text) from public;
grant execute on function public.check_invite(text) to anon, authenticated;
grant execute on function public.register_profile(text,text,text,text) to authenticated;

-- RLS: anyone (incl. signed-out players) may read; users write only their own rows,
-- and only once registered via invite (profile exists). Scores/badges are immutable.
-- invites has RLS enabled with NO policies: unreadable and unwritable via the API.
alter table public.invites  enable row level security;
alter table public.profiles enable row level security;
alter table public.scores   enable row level security;
alter table public.badges   enable row level security;

create policy "profiles readable by all" on public.profiles for select using (true);
create policy "update own profile" on public.profiles for update
  using (auth.uid() = id) with check (auth.uid() = id);

create policy "scores readable by all" on public.scores for select using (true);
create policy "insert own scores" on public.scores for insert
  with check (auth.uid() = user_id and exists (select 1 from public.profiles where id = auth.uid()));

create policy "badges readable by all" on public.badges for select using (true);
create policy "insert own badges" on public.badges for insert
  with check (auth.uid() = user_id and exists (select 1 from public.profiles where id = auth.uid()));

-- ▶ your invite code — change it here, or manage codes later, e.g.:
--   update public.invites set active = false where code = 'GZMETRO2026';   (disable)
--   insert into public.invites (code, max_uses) values ('FRIENDS50', 50);  (add another)
--   select * from public.invites;                                          (check usage)
insert into public.invites (code) values ('GZMETRO2026');
