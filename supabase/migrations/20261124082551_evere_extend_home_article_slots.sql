alter table public.evere_page_slots
    drop constraint evere_page_slots_slot_check,
    add constraint evere_page_slots_slot_check check (
        slot between 1 and case
            when page = 'home' then 8
            when page <> 'opinion' and category = '' then 5
            else 3 end
    );

CREATE OR REPLACE FUNCTION public.evere_save_layout(target_page text, target_category text, articles uuid[])
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
    positions integer := case when target_page = 'home' then 8 when target_page <> 'opinion' and target_category = '' then 5 else 3 end;
begin
    if not coalesce(evere_private.can_edit_page(target_page), false) then
        raise exception 'This page is outside your editorial scope' using errcode = '42501';
    end if;
    if target_page = 'home' and cardinality(articles) = 3 then
        positions := 3;
    end if;
    if cardinality(articles) is distinct from positions then
        raise exception 'Incorrect number of positions for this page' using errcode = '23514';
    end if;
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(target_page || ':' || target_category, 0));
    delete from public.evere_page_slots where page = target_page and category = target_category and slot <= positions;
    insert into public.evere_page_slots (page, category, slot, article_id)
    select target_page, target_category, p.slot::smallint, p.article_id
    from pg_catalog.unnest(articles) with ordinality p(article_id, slot)
    where p.article_id is not null;
end;
$function$;
