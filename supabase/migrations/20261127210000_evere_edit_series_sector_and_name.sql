grant update (sector) on public.evere_series to authenticated;

alter table public.evere_articles
    alter constraint evere_articles_series_sector_fk deferrable initially immediate;

create function public.evere_update_series(target uuid, next_sector public.evere_sector, next_title text,
    move_articles boolean)
returns void
language plpgsql
security invoker
set search_path to ''
as $$
declare
    current_sector public.evere_sector;
begin
    select s.sector into current_sector from public.evere_series s where s.id = target for update;
    if not found then
        raise exception 'Series unavailable' using errcode = '42501';
    end if;
    if current_sector is distinct from next_sector then
        if not coalesce(move_articles, false) and exists (
            select 1 from public.evere_articles a where a.series_id = target
        ) then
            raise exception 'Confirm series article move' using errcode = 'EV004';
        end if;
        if exists (
            select 1 from public.evere_articles a
            where a.series_id = target and cardinality(a.byline) + cardinality(a.guest_byline) = 0
        ) then
            raise exception 'Add bylines before moving the series' using errcode = 'EV005';
        end if;
        set constraints public.evere_articles_series_sector_fk deferred;
    end if;
    update public.evere_series s set sector = next_sector, title = btrim(next_title) where s.id = target;
    if not found then
        raise exception 'Series unavailable' using errcode = '42501';
    end if;
    if current_sector is distinct from next_sector then
        update public.evere_articles a set sector = next_sector, category = null where a.series_id = target;
        set constraints public.evere_articles_series_sector_fk immediate;
    end if;
end;
$$;

revoke all on function public.evere_update_series(uuid, public.evere_sector, text, boolean) from public, anon;
grant execute on function public.evere_update_series(uuid, public.evere_sector, text, boolean) to authenticated;
