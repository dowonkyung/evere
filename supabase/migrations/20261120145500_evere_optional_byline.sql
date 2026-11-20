create or replace function evere_private.check_article()
returns trigger
language plpgsql security invoker set search_path = ''
as $$
declare
    caller uuid := auth.uid();
    member_role public.evere_role := evere_private.member_role();
    previous_photos text[] := '{}';
    previous_guests text[] := '{}';
    author_count integer := cardinality(new.byline) + cardinality(new.guest_byline);
    allows_omission boolean := coalesce(
        (new.sector = 'opinion' and new.category = 'editorial') or
        (new.sector = 'health' and new.category = 'obituaries'), false
    );
begin
    if tg_op = 'UPDATE' then
        previous_photos := old.photo_paths;
        previous_guests := old.guest_byline;
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

    if new.guest_byline is distinct from previous_guests
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
$$;
