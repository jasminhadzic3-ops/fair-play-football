alter table public.games
  add column if not exists tags text[] not null default '{}'::text[];

alter table public.games
  drop constraint if exists games_tags_max_five;

alter table public.games
  add constraint games_tags_max_five
  check (cardinality(tags) <= 5);

comment on column public.games.tags is
'Optional game labels shown to players. Values are selected from the application game-tag catalogue; a game can have at most five.';
