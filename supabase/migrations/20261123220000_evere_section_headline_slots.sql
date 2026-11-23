alter table public.evere_page_slots
    drop constraint evere_page_slots_slot_check,
    add constraint evere_page_slots_slot_check check (
        slot between 1 and
        case when page not in ('home', 'opinion') and category = '' then 5 else 3 end
    );

create or replace function public.evere_save_layout(target_page text, target_category text, articles uuid[])
returns void
language plpgsql
set search_path = ''
as $$
declare
    positions integer := case when target_page not in ('home', 'opinion') and target_category = '' then 5 else 3 end;
begin
    if not coalesce(evere_private.can_edit_page(target_page), false) then
        raise exception 'This page is outside your editorial scope' using errcode = '42501';
    end if;
    if cardinality(articles) is distinct from positions then
        raise exception 'Incorrect number of positions for this page' using errcode = '23514';
    end if;
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(target_page || ':' || target_category, 0));
    delete from public.evere_page_slots where page = target_page and category = target_category;
    insert into public.evere_page_slots (page, category, slot, article_id)
    select target_page, target_category, p.slot::smallint, p.article_id
    from pg_catalog.unnest(articles) with ordinality p(article_id, slot)
    where p.article_id is not null;
end;
$$;
