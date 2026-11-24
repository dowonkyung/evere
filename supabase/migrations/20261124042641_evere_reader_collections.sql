create table public.evere_bookmarks (
    member_id uuid not null default auth.uid() references public.evere_members(id) on delete cascade,
    article_id uuid not null references public.evere_articles(id) on delete cascade,
    created_at timestamptz not null default now(),
    primary key (member_id, article_id)
);
create index evere_bookmarks_article_id_idx on public.evere_bookmarks (article_id);
alter table public.evere_bookmarks enable row level security;
revoke all on public.evere_bookmarks from public, anon, authenticated;
grant select, delete on public.evere_bookmarks to authenticated;
grant insert (article_id) on public.evere_bookmarks to authenticated;
create policy evere_bookmarks_own on public.evere_bookmarks to authenticated
    using (member_id = (select auth.uid()))
    with check (member_id = (select auth.uid()));

create table public.evere_series_follows (
    member_id uuid not null default auth.uid() references public.evere_members(id) on delete cascade,
    series_id uuid not null references public.evere_series(id) on delete cascade,
    created_at timestamptz not null default now(),
    primary key (member_id, series_id)
);
create index evere_series_follows_series_id_idx on public.evere_series_follows (series_id);
alter table public.evere_series_follows enable row level security;
revoke all on public.evere_series_follows from public, anon, authenticated;
grant select, delete on public.evere_series_follows to authenticated;
grant insert (series_id) on public.evere_series_follows to authenticated;
create policy evere_series_follows_own on public.evere_series_follows to authenticated
    using (member_id = (select auth.uid()))
    with check (member_id = (select auth.uid()));

create table public.evere_reporter_follows (
    member_id uuid not null default auth.uid() references public.evere_members(id) on delete cascade,
    reporter_id uuid not null references public.evere_members(id) on delete cascade,
    created_at timestamptz not null default now(),
    primary key (member_id, reporter_id)
);
create index evere_reporter_follows_reporter_id_idx on public.evere_reporter_follows (reporter_id);
alter table public.evere_reporter_follows enable row level security;
revoke all on public.evere_reporter_follows from public, anon, authenticated;
grant select, delete on public.evere_reporter_follows to authenticated;
grant insert (reporter_id) on public.evere_reporter_follows to authenticated;
create policy evere_reporter_follows_own on public.evere_reporter_follows to authenticated
    using (member_id = (select auth.uid()))
    with check (member_id = (select auth.uid()));

create function public.evere_set_my_display_name(new_name text)
returns void language plpgsql security definer set search_path = ''
as $$
begin
    if auth.uid() is null then raise exception 'Sign in required' using errcode = '42501'; end if;
    update public.evere_members set display_name = pg_catalog.btrim(new_name) where id = auth.uid();
    if not found then raise exception 'Member required' using errcode = '42501'; end if;
end;
$$;
revoke all on function public.evere_set_my_display_name(text) from public, anon, authenticated;
grant execute on function public.evere_set_my_display_name(text) to authenticated;
notify pgrst, 'reload schema';
