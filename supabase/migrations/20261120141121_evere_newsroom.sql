create table public.evere_page_slots (
    page text not null check (page in ('home','opinion','wiki','virtual-nations','politics','economy','society','international','health','sports','culture')),
    category text not null default '' check (char_length(category) <= 64),
    slot smallint not null check (slot between 1 and 3),
    article_id uuid not null references public.evere_articles(id) on delete cascade,
    primary key (page, category, slot),
    unique (page, category, article_id),
    check (page <> 'home' or category = '')
);
create index evere_page_slots_article_idx on public.evere_page_slots (article_id);
alter table public.evere_page_slots enable row level security;
revoke all on public.evere_page_slots from public, anon, authenticated;
grant select on public.evere_page_slots to anon, authenticated;
grant insert, update, delete on public.evere_page_slots to authenticated;

create function evere_private.can_edit_page(target_page text)
returns boolean language sql stable security invoker set search_path = ''
as $$
    select (select evere_private.member_role()) in ('owner','director')
        or ((select evere_private.member_role()) = 'department_head'
            and target_page = any((select evere_private.current_sectors())::text[]));
$$;
revoke execute on function evere_private.can_edit_page(text) from public, anon, authenticated;
grant execute on function evere_private.can_edit_page(text) to authenticated;

create function evere_private.check_page_slot()
returns trigger language plpgsql security invoker set search_path = ''
as $$
begin
    if not exists (
        select 1 from public.evere_articles a
        where a.id = new.article_id and a.status = 'published'
            and (new.page = 'home' or a.sector::text = new.page)
            and (new.category = '' or a.category = new.category)
    ) then
        raise exception 'Only a published article in this section can be placed' using errcode = '23514';
    end if;
    return new;
end;
$$;
revoke execute on function evere_private.check_page_slot() from public, anon, authenticated;
create trigger evere_check_page_slot before insert or update on public.evere_page_slots
for each row execute function evere_private.check_page_slot();

create policy evere_layout_public_read on public.evere_page_slots for select to anon, authenticated
using (exists (
    select 1 from public.evere_articles a where a.id = article_id and a.status = 'published'
        and (page = 'home' or a.sector::text = page)
        and (evere_page_slots.category = '' or a.category = evere_page_slots.category)
));
create policy evere_layout_manage on public.evere_page_slots for all to authenticated
using (evere_private.can_edit_page(page))
with check (evere_private.can_edit_page(page));

create function public.evere_save_layout(target_page text, target_category text, articles uuid[])
returns void language plpgsql security invoker set search_path = ''
as $$
begin
    if not coalesce(evere_private.can_edit_page(target_page), false) then
        raise exception 'This page is outside your editorial scope' using errcode = '42501';
    end if;
    if cardinality(articles) is distinct from 3 then
        raise exception 'The layout must contain exactly three positions' using errcode = '23514';
    end if;
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(target_page || ':' || target_category, 0));
    delete from public.evere_page_slots where page = target_page and category = target_category;
    insert into public.evere_page_slots (page, category, slot, article_id)
    select target_page, target_category, p.slot::smallint, p.article_id
    from unnest(articles) with ordinality p(article_id, slot)
    where p.article_id is not null;
end;
$$;
revoke execute on function public.evere_save_layout(text,text,uuid[]) from public, anon;
grant execute on function public.evere_save_layout(text,text,uuid[]) to authenticated;

create table public.evere_boards (
    id uuid primary key default gen_random_uuid(),
    name text not null check (char_length(trim(name)) between 1 and 60),
    description text not null default '' check (char_length(description) <= 400),
    visible boolean not null default false,
    created_at timestamptz not null default now()
);
create table public.evere_board_posts (
    id uuid primary key default gen_random_uuid(),
    board_id uuid not null references public.evere_boards(id) on delete cascade,
    title text not null check (char_length(trim(title)) between 1 and 200),
    body text not null check (char_length(trim(body)) between 1 and 20000),
    created_at timestamptz not null default now()
);
create index evere_board_posts_board_idx on public.evere_board_posts (board_id, created_at desc);
alter table public.evere_boards enable row level security;
alter table public.evere_board_posts enable row level security;
revoke all on public.evere_boards, public.evere_board_posts from public, anon, authenticated;
grant select on public.evere_boards, public.evere_board_posts to anon, authenticated;
grant insert, update, delete on public.evere_boards, public.evere_board_posts to authenticated;

create policy evere_public_boards on public.evere_boards for select to anon, authenticated using (visible);
create policy evere_public_board_posts on public.evere_board_posts for select to anon, authenticated
using (exists (select 1 from public.evere_boards b where b.id = board_id and b.visible));
create policy evere_owner_boards on public.evere_boards for all to authenticated
using ((select evere_private.member_role()) = 'owner')
with check ((select evere_private.member_role()) = 'owner');
create policy evere_owner_board_posts on public.evere_board_posts for all to authenticated
using ((select evere_private.member_role()) = 'owner')
with check ((select evere_private.member_role()) = 'owner');
