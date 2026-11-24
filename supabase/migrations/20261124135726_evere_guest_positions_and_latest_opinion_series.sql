alter table public.evere_articles add column guest_byline_positions text[] not null default '{}';
grant select (guest_byline_positions), insert (guest_byline_positions), update (guest_byline_positions)
on public.evere_articles to authenticated;

CREATE OR REPLACE FUNCTION evere_private.check_article()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
    caller uuid := auth.uid();
    member_role public.evere_role := evere_private.member_role();
    previous_photos text[] := '{}';
    previous_guests text[] := '{}';
    previous_guest_positions text[] := '{}';
    author_count integer := cardinality(new.byline) + cardinality(new.guest_byline);
    allows_omission boolean := coalesce(
        (new.sector = 'opinion' and new.category = 'editorial') or
        (new.sector = 'health' and new.category = 'obituaries'), false
    );
begin
    if tg_op = 'UPDATE' then
        previous_photos := old.photo_paths;
        previous_guests := old.guest_byline;
        previous_guest_positions := old.guest_byline_positions;
        if old.status is distinct from new.status then
            new.published_at := case when new.status = 'published' then now() else null end;
        end if;
    end if;

    if author_count > 12 or (author_count = 0 and not allows_omission)
       or (select count(*) from public.evere_members where id = any(new.byline)) <> cardinality(new.byline)
       or exists (select 1 from unnest(new.guest_byline) n
                  where n is null or char_length(n) not between 1 and 80 or btrim(n) <> n or n ~ '[[:cntrl:]]') then
        raise exception 'Invalid article byline' using errcode = '23514';
    end if;

    if cardinality(new.guest_byline_positions) not in (0, cardinality(new.guest_byline))
       or exists (select 1 from unnest(new.guest_byline_positions) position_title
                  where position_title is null or char_length(position_title) > 80
                     or btrim(position_title) <> position_title or position_title ~ '[[:cntrl:]]') then
        raise exception 'Invalid guest byline position' using errcode = '23514';
    end if;
    if (new.guest_byline is distinct from previous_guests
        or new.guest_byline_positions is distinct from previous_guest_positions)
       and coalesce(member_role not in ('owner', 'director', 'department_head'), true) then
        raise exception 'Only editors may set guest bylines' using errcode = '42501';
    end if;
    if tg_op = 'INSERT' and author_count > 0 then
        if member_role = 'citizen' and new.byline <> array[caller] then
            raise exception 'Citizen reporters must use their own byline' using errcode = '42501';
        end if;
        if member_role = 'reporter' and not (caller = any(new.byline)) then
            raise exception 'Reporters must appear in their own byline' using errcode = '42501';
        end if;
        if member_role = 'department_head' and cardinality(new.guest_byline) > 0
           and not (new.sector = any(evere_private.current_sectors()::public.evere_sector[])) then
            raise exception 'Guest bylines require editorial sector access' using errcode = '42501';
        end if;
    end if;

    if cardinality(new.photo_paths) > 8
       or (select count(distinct p) from unnest(new.photo_paths) p) <> cardinality(new.photo_paths)
       or exists (
           select 1 from unnest(new.photo_paths) p
           where not (p = any(previous_photos))
           and (split_part(p, '/', 1) is distinct from caller::text
                or not exists (select 1 from storage.objects o
                               where o.bucket_id = 'evere-article-photos' and o.name = p))
       ) then
        raise exception 'Invalid article photo list' using errcode = '23514';
    end if;
    return new;
end;
$function$
;
CREATE OR REPLACE FUNCTION evere_private.snapshot_byline()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
    select coalesce(array_agg(m.display_name order by b.pos), '{}') || array(
        select concat_ws(' ', guest.name, nullif(new.guest_byline_positions[guest.pos::int], ''))
        from unnest(new.guest_byline) with ordinality guest(name, pos)
        order by guest.pos
    )
      into new.byline_names
    from unnest(new.byline) with ordinality b(id, pos)
    join public.evere_members m on m.id = b.id;
    return new;
end;
$function$
;
create or replace trigger evere_snapshot_byline before insert or update of byline, guest_byline, guest_byline_positions
on public.evere_articles for each row execute function evere_private.snapshot_byline();

create function public.evere_latest_opinion_series_articles()
returns table (series_title text, article_number bigint, title text, article_label text, body_html text, photo_paths text[], byline_names text[])
language sql stable security invoker set search_path = ''
as $$
    select picked.series_title, picked.article_number, picked.title, picked.article_label,
           picked.body_html, picked.photo_paths, picked.byline_names
    from (
        select distinct on (s.id) s.title as series_title, a.article_number, a.title, a.article_label::text,
               a.body_html, a.photo_paths, a.byline_names, a.published_at, a.id
        from public.evere_series s
        join public.evere_articles a on a.series_id = s.id and a.sector = s.sector
        where s.sector = 'opinion' and a.status = 'published' and a.article_number is not null
        order by s.id, a.published_at desc nulls last, a.id
    ) picked
    order by picked.published_at desc nulls last, picked.id;
$$;
revoke all on function public.evere_latest_opinion_series_articles() from public, anon, authenticated;
grant execute on function public.evere_latest_opinion_series_articles() to anon, authenticated;
notify pgrst, 'reload schema';
