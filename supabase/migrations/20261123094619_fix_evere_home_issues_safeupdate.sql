-- Scope replacement to valid issue positions so PostgREST safeupdate accepts it.
create or replace function public.evere_save_home_issues(items jsonb)
returns void language plpgsql security invoker set search_path = ''
as $$
begin
    if not coalesce(evere_private.can_edit_page('home'), false) then
        raise exception 'This page is outside your editorial scope' using errcode = '42501';
    end if;
    if jsonb_typeof(items) is distinct from 'array' then
        raise exception 'Expected an array of issue links' using errcode = '23514';
    end if;
    if exists (
        select 1 from jsonb_array_elements(items) entry
        where jsonb_typeof(entry->'label') is distinct from 'string'
           or jsonb_typeof(entry->'url') is distinct from 'string'
    ) then
        raise exception 'Expected a label and URL for each issue' using errcode = '23514';
    end if;
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('evere_home_issues', 0));
    delete from public.evere_home_issues where position > 0;
    insert into public.evere_home_issues (position, label, url)
    select ordinal::integer, trim(entry->>'label'), trim(entry->>'url')
    from jsonb_array_elements(items) with ordinality as links(entry, ordinal);
end;
$$;
