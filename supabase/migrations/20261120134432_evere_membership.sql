create schema evere_private;
revoke all on schema evere_private from public, anon, authenticated;
grant usage on schema evere_private to authenticated;

create type public.evere_role as enum ('owner', 'director', 'department_head', 'reporter', 'citizen');
create type public.evere_sector as enum ('opinion', 'wiki', 'virtual-nations', 'politics', 'economy', 'society', 'international', 'health', 'sports', 'culture');
create type public.evere_article_status as enum ('pending', 'published');

create table evere_private.owner_account (
    singleton boolean primary key default true check (singleton),
    user_id uuid not null unique references auth.users(id) on delete restrict
);
alter table evere_private.owner_account enable row level security;

create table public.evere_members (
    id uuid primary key references auth.users(id) on delete restrict,
    display_name text not null check (char_length(trim(display_name)) between 1 and 40),
    role public.evere_role not null default 'citizen',
    sectors public.evere_sector[] not null default '{}',
    check (role = 'department_head' or cardinality(sectors) = 0),
    check (array_position(sectors, null) is null)
);
create unique index evere_members_single_owner on public.evere_members (role) where role = 'owner';

create table public.evere_articles (
    id uuid primary key default gen_random_uuid(),
    created_by uuid not null default auth.uid() references public.evere_members(id),
    title text not null check (char_length(trim(title)) between 1 and 200),
    body text not null check (char_length(trim(body)) between 1 and 50000),
    sector public.evere_sector not null,
    byline uuid[] not null default array[auth.uid()],
    status public.evere_article_status not null default 'pending',
    created_at timestamptz not null default now(),
    published_at timestamptz
);
create index evere_articles_creator_idx on public.evere_articles (created_by, created_at desc);
create index evere_articles_sector_idx on public.evere_articles (sector, created_at desc);
create index evere_articles_publication_idx on public.evere_articles (published_at desc) where status = 'published';

create table public.evere_comments (
    id uuid primary key default gen_random_uuid(),
    article_id uuid not null references public.evere_articles(id) on delete cascade,
    author_id uuid not null default auth.uid() references public.evere_members(id),
    body text not null check (char_length(trim(body)) between 1 and 2000),
    created_at timestamptz not null default now()
);
create index evere_comments_article_idx on public.evere_comments (article_id, created_at);
create index evere_comments_author_idx on public.evere_comments (author_id);

alter table public.evere_members enable row level security;
alter table public.evere_articles enable row level security;
alter table public.evere_comments enable row level security;

revoke all on public.evere_members, public.evere_articles, public.evere_comments from public, anon, authenticated;
grant select on public.evere_members to authenticated;
grant update (role, sectors) on public.evere_members to authenticated;
grant select on public.evere_articles, public.evere_comments to anon, authenticated;
grant insert (title, body, sector, byline), update (title, body, sector, byline, status), delete
    on public.evere_articles to authenticated;
grant insert (article_id, body), update (body), delete on public.evere_comments to authenticated;

create function evere_private.member_role()
returns public.evere_role
language sql stable security definer set search_path = ''
as $$
    select role from public.evere_members where id = (select auth.uid());
$$;

create function evere_private.current_sectors()
returns public.evere_sector[]
language sql stable security definer set search_path = ''
as $$
    select sectors from public.evere_members where id = (select auth.uid());
$$;

create function evere_private.register_member(member_name text)
returns public.evere_members
language plpgsql security definer set search_path = ''
as $$
declare
    caller uuid := auth.uid();
    member public.evere_members;
begin
    if caller is null or not exists (
        select 1 from auth.users as u where u.id = caller and u.email_confirmed_at is not null
    ) then
        raise exception 'An email-confirmed account is required' using errcode = '42501';
    end if;

    select * into member from public.evere_members where id = caller;
    if found then return member; end if;

    insert into public.evere_members (id, display_name, role)
    values (
        caller, trim(member_name),
        case when exists (select 1 from evere_private.owner_account where user_id = caller)
             then 'owner'::public.evere_role else 'citizen'::public.evere_role end
    )
    on conflict (id) do nothing;
    select * into strict member from public.evere_members where id = caller;
    return member;
end;
$$;

create function public.evere_register_member(member_name text)
returns public.evere_members
language sql security invoker set search_path = ''
as $$ select evere_private.register_member(member_name); $$;

create function evere_private.check_article()
returns trigger
language plpgsql security invoker set search_path = ''
as $$
declare
    caller uuid := auth.uid();
    member_role public.evere_role := evere_private.member_role();
begin
    if cardinality(new.byline) not between 1 and 12
       or array_position(new.byline, null) is not null
       or (select count(distinct author) from unnest(new.byline) as author) <> cardinality(new.byline)
       or (select count(*) from public.evere_members where id = any(new.byline)) <> cardinality(new.byline) then
        raise exception 'The byline must name one to twelve distinct Evere members' using errcode = '23514';
    end if;

    if tg_op = 'INSERT' then
        if member_role = 'citizen' and new.byline <> array[caller] then
            raise exception 'Citizen reporters must use their own byline' using errcode = '42501';
        end if;
        if member_role = 'reporter' and not (caller = any(new.byline)) then
            raise exception 'Reporters must appear in their own byline' using errcode = '42501';
        end if;
    elsif old.status is distinct from new.status then
        new.published_at := case when new.status = 'published' then now() else null end;
    end if;
    return new;
end;
$$;
create trigger evere_validate_article before insert or update on public.evere_articles
for each row execute function evere_private.check_article();

revoke execute on all functions in schema evere_private from public, anon, authenticated;
grant execute on function evere_private.member_role(), evere_private.current_sectors(),
    evere_private.register_member(text) to authenticated;
revoke execute on function public.evere_register_member(text) from public, anon;
grant execute on function public.evere_register_member(text) to authenticated;

create policy evere_member_read on public.evere_members for select to authenticated
using (id = (select auth.uid()) or (select evere_private.member_role()) is not null);
create policy evere_member_assign on public.evere_members for update to authenticated
using ((select evere_private.member_role()) = 'owner' and role <> 'owner')
with check ((select evere_private.member_role()) = 'owner' and role <> 'owner');

create policy evere_published_read on public.evere_articles for select to anon, authenticated
using (status = 'published');
create policy evere_editorial_read on public.evere_articles for select to authenticated
using (
    created_by = (select auth.uid())
    or (select evere_private.member_role()) in ('owner', 'director')
    or ((select evere_private.member_role()) = 'department_head' and sector = any((select evere_private.current_sectors())::public.evere_sector[]))
);
create policy evere_article_submit on public.evere_articles for insert to authenticated
with check (
    created_by = (select auth.uid()) and status = 'pending'
    and (select evere_private.member_role()) is not null
);
create policy evere_article_edit on public.evere_articles for update to authenticated
using (
    (select evere_private.member_role()) in ('owner', 'director')
    or ((select evere_private.member_role()) = 'department_head' and sector = any((select evere_private.current_sectors())::public.evere_sector[]))
)
with check (
    (select evere_private.member_role()) in ('owner', 'director')
    or ((select evere_private.member_role()) = 'department_head' and sector = any((select evere_private.current_sectors())::public.evere_sector[]))
);
create policy evere_article_delete on public.evere_articles for delete to authenticated
using (
    (select evere_private.member_role()) in ('owner', 'director')
    or ((select evere_private.member_role()) = 'department_head' and sector = any((select evere_private.current_sectors())::public.evere_sector[]))
);

create policy evere_comment_read on public.evere_comments for select to anon, authenticated
using (exists (select 1 from public.evere_articles a where a.id = article_id and a.status = 'published'));
create policy evere_comment_submit on public.evere_comments for insert to authenticated
with check (
    author_id = (select auth.uid()) and (select evere_private.member_role()) is not null
    and exists (select 1 from public.evere_articles a where a.id = article_id and a.status = 'published')
);
create policy evere_comment_owner_read on public.evere_comments for select to authenticated
using ((select evere_private.member_role()) = 'owner');
create policy evere_comment_moderate on public.evere_comments for update to authenticated
using ((select evere_private.member_role()) = 'owner')
with check ((select evere_private.member_role()) = 'owner');
create policy evere_comment_remove on public.evere_comments for delete to authenticated
using ((select evere_private.member_role()) = 'owner');
