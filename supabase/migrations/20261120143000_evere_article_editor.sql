alter table public.evere_articles
    add column subtitle text not null default '' check (char_length(subtitle) <= 500),
    add column body_html text not null default '' check (octet_length(body_html) <= 400000),
    add column guest_byline text[] not null default '{}',
    add column photo_paths text[] not null default '{}';

grant insert (subtitle, body_html, guest_byline, photo_paths),
      update (subtitle, body_html, guest_byline, photo_paths)
on public.evere_articles to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('evere-article-photos', 'evere-article-photos', false, 5242880,
        array['image/jpeg', 'image/png', 'image/webp']);

create policy evere_photo_upload on storage.objects for insert to authenticated
with check (
    bucket_id = 'evere-article-photos' and (select evere_private.member_role()) is not null
    and split_part(name, '/', 1) = (select auth.uid())::text
    and name ~ '^[a-f0-9-]{36}/[a-f0-9-]{36}[.](jpg|png|webp)$'
);

create policy evere_photo_read on storage.objects for select to anon, authenticated
using (
    bucket_id = 'evere-article-photos'
    and (split_part(name, '/', 1) = (select auth.uid())::text
         or exists (select 1 from public.evere_articles a where a.photo_paths @> array[objects.name]))
);

create policy evere_photo_discard on storage.objects for delete to authenticated
using (
    bucket_id = 'evere-article-photos' and split_part(name, '/', 1) = (select auth.uid())::text
    and not exists (select 1 from public.evere_articles a where a.photo_paths @> array[objects.name])
);

create index evere_article_photo_paths_idx on public.evere_articles using gin (photo_paths);

create or replace function evere_private.check_article()
returns trigger
language plpgsql security invoker set search_path = ''
as $$
declare
    caller uuid := auth.uid();
    member_role public.evere_role := evere_private.member_role();
    previous_photos text[] := '{}';
    previous_guests text[] := '{}';
begin
    if tg_op = 'UPDATE' then
        previous_photos := old.photo_paths;
        previous_guests := old.guest_byline;
        if old.status is distinct from new.status then
            new.published_at := case when new.status = 'published' then now() else null end;
        end if;
    end if;

    if cardinality(new.byline) + cardinality(new.guest_byline) not between 1 and 12
       or (select count(*) from public.evere_members where id = any(new.byline)) <> cardinality(new.byline)
       or exists (select 1 from unnest(new.guest_byline) n
                  where n is null or char_length(n) not between 1 and 80 or btrim(n) <> n or n ~ '[[:cntrl:]]') then
        raise exception 'Invalid article byline' using errcode = '23514';
    end if;

    if new.guest_byline is distinct from previous_guests
       and coalesce(member_role not in ('owner', 'director', 'department_head'), true) then
        raise exception 'Only editors may set guest bylines' using errcode = '42501';
    end if;
    if tg_op = 'INSERT' then
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

create or replace function evere_private.snapshot_byline()
returns trigger
language plpgsql security invoker set search_path = ''
as $$
begin
    select coalesce(array_agg(m.display_name order by b.pos), '{}') || new.guest_byline
      into new.byline_names
    from unnest(new.byline) with ordinality b(id, pos)
    join public.evere_members m on m.id = b.id;
    return new;
end;
$$;

drop trigger evere_snapshot_byline on public.evere_articles;
create trigger evere_snapshot_byline before insert or update of byline, guest_byline on public.evere_articles
for each row execute function evere_private.snapshot_byline();
