alter table public.evere_page_slots
    drop constraint evere_page_slots_slot_check,
    add constraint evere_page_slots_slot_check check (
        slot between 1 and case
            when page = 'home' then 12
            when page <> 'opinion' and category = '' then 5
            else 3 end
    );

CREATE OR REPLACE FUNCTION public.evere_save_layout(target_page text, target_category text, articles uuid[])
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
    positions integer := case when target_page = 'home' then 12 when target_page <> 'opinion' and target_category = '' then 5 else 3 end;
begin
    if not coalesce(evere_private.can_edit_page(target_page), false) then
        raise exception 'This page is outside your editorial scope' using errcode = '42501';
    end if;
    if target_page = 'home' and cardinality(articles) in (3, 8) then
        positions := cardinality(articles);
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

create table public.evere_home_bottom_links (
    area text not null check (area in ('event_links', 'service_cards')),
    position integer not null check (position > 0),
    label text not null check (char_length(trim(label)) between 1 and 100),
    url text not null check (char_length(url) <= 2048 and url ~* '^https?://[^/[:space:]]+' and url !~ '[[:space:]]' and position(chr(92) in url) = 0),
    description text not null default '' check (char_length(description) <= 240),
    primary key (area, position)
);
alter table public.evere_home_bottom_links enable row level security;
revoke all on public.evere_home_bottom_links from public, anon, authenticated;
grant select on public.evere_home_bottom_links to anon, authenticated;
grant insert, delete on public.evere_home_bottom_links to authenticated;
create policy evere_home_bottom_links_read on public.evere_home_bottom_links
for select to anon, authenticated using (true);
create policy evere_home_bottom_links_manage on public.evere_home_bottom_links
for all to authenticated
using ((select evere_private.can_edit_page('home')))
with check ((select evere_private.can_edit_page('home')));

create function public.evere_save_home_bottom_links(target_area text, items jsonb)
returns void language plpgsql security invoker set search_path = ''
as $$
begin
    if not coalesce(evere_private.can_edit_page('home'), false) then
        raise exception 'This page is outside your editorial scope' using errcode = '42501';
    end if;
    if target_area is null or target_area not in ('event_links', 'service_cards')
        or jsonb_typeof(items) is distinct from 'array' then
        raise exception 'Invalid home link group' using errcode = '23514';
    end if;
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('evere_home_bottom_links:' || target_area, 0));
    delete from public.evere_home_bottom_links where area = target_area;
    insert into public.evere_home_bottom_links (area, position, label, url, description)
    select target_area, ordinal::integer, trim(entry->>'label'), trim(entry->>'url'), coalesce(trim(entry->>'description'), '')
    from jsonb_array_elements(items) with ordinality as links(entry, ordinal);
end;
$$;
revoke execute on function public.evere_save_home_bottom_links(text, jsonb) from public, anon;
grant execute on function public.evere_save_home_bottom_links(text, jsonb) to authenticated;
insert into public.evere_home_bottom_links (area, position, label, url, description) values
('event_links', 1, '정동문화축제', 'https://business.khan.co.kr/jeongdong', ''),
('event_links', 2, '이화경향음악콩쿠르', 'https://business.khan.co.kr/ekconcours', ''),
('event_links', 3, '경향실용음악콩쿠르', 'https://business.khan.co.kr/khconcours', ''),
('event_links', 4, '경향뮤지컬콩쿠르', 'https://business.khan.co.kr/musical', ''),
('event_links', 5, '대통령금배전국고교축구대회', 'https://business.khan.co.kr/soccer', ''),
('event_links', 6, '열린경제교육프로젝트', 'https://business.khan.co.kr/finance', ''),
('event_links', 7, '경제포럼', 'http://www.khanforum.com/', ''),
('service_cards', 1, '경향포럼', 'http://www.khanforum.com/', '대전환의 시대 지속 가능한 미래로 가는 길. 한국 사회의 더 나은 내일을 고민합니다.'),
('service_cards', 2, '기사 제보', 'https://jebo.khan.co.kr/', '독자분들의 소중한 제보와 이야기를 24시간 기다립니다.'),
('service_cards', 3, 'e경향신문', 'https://epaper.khan.co.kr/', '신문과 잡지를 온라인 지면보기 서비스로 구독해 보세요.'),
('service_cards', 4, '경향 콘텐츠몰', 'https://content.khan.co.kr/', '분야별 기사와 150여만장의 사진을 이용해 보세요.');
