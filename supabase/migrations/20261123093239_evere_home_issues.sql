create table public.evere_home_issues (
    position integer primary key check (position > 0),
    label text not null check (char_length(trim(label)) between 1 and 100),
    url text not null check (
        char_length(url) between 1 and 2048
        and url ~* '^https?://[^/[:space:]]+'
        and url !~ '[[:space:]]'
        and position(chr(92) in url) = 0
    )
);
alter table public.evere_home_issues enable row level security;
revoke all on public.evere_home_issues from public, anon, authenticated;
grant select on public.evere_home_issues to anon, authenticated;
grant insert, update, delete on public.evere_home_issues to authenticated;
create policy evere_home_issues_read on public.evere_home_issues
for select to anon, authenticated using (true);
create policy evere_home_issues_manage on public.evere_home_issues
for all to authenticated
using ((select evere_private.can_edit_page('home')))
with check ((select evere_private.can_edit_page('home')));

create function public.evere_save_home_issues(items jsonb)
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
    delete from public.evere_home_issues;
    insert into public.evere_home_issues (position, label, url)
    select ordinal::integer, trim(entry->>'label'), trim(entry->>'url')
    from jsonb_array_elements(items) with ordinality as links(entry, ordinal);
end;
$$;
revoke execute on function public.evere_save_home_issues(jsonb) from public, anon;
grant execute on function public.evere_save_home_issues(jsonb) to authenticated;

insert into public.evere_home_issues (position, label, url) values
(1, '📌창간 80년 특집', 'https://www.khan.co.kr/80th'),
(2, '📺경향티비', 'https://www.khan.co.kr/introduce/kyunghyangtv/'),
(3, '시험장 침투한 AI', 'https://www.khan.co.kr/issue/articles/ahd68'),
(4, '젠슨 황 스캔들', 'https://www.khan.co.kr/issue/articles/ahd67'),
(5, '2027 대입 수능', 'https://www.khan.co.kr/issue/articles/ahd69');

