begin;
do $$
declare editor_id uuid; first_id uuid; second_id uuid; first_number bigint; second_number bigint; expected bigint;
begin
 select id into editor_id from public.evere_members where role='owner' limit 1;
 if editor_id is null then raise exception 'Editor unavailable'; end if;
 select next_number into expected from evere_private.article_number_counter where singleton=true;
 perform set_config('request.jwt.claim.sub',editor_id::text,true);
 set local role authenticated;
 insert into public.evere_articles(title,body,sector,category,byline)
 values('route test','test','opinion','editorial','{}') returning id into first_id;
 if (select article_number from public.evere_articles where id=first_id) is not null then raise exception 'Draft received a number'; end if;
 update public.evere_articles set editorial_state='released' where id=first_id returning article_number into first_number;
 if first_number is distinct from expected then raise exception 'Wrong initial number'; end if;
 update public.evere_articles set editorial_state='complete' where id=first_id;
 update public.evere_articles set editorial_state='released' where id=first_id;
 if (select article_number from public.evere_articles where id=first_id) is distinct from first_number then raise exception 'Republication changed number'; end if;
 begin
  update public.evere_articles set article_number=999999 where id=first_id;
  raise exception 'Number mutation was allowed';
 exception when check_violation or insufficient_privilege then null; end;
 delete from public.evere_articles where id=first_id;
 insert into public.evere_articles(title,body,sector,category,byline)
 values('second route test','test','opinion','editorial','{}') returning id into second_id;
 update public.evere_articles set editorial_state='released' where id=second_id returning article_number into second_number;
 if second_number is distinct from first_number+1 then raise exception 'Deleted number reused'; end if;
 reset role;
end $$;
rollback;
select 'Draft, first publication, republication, immutable number and no-reuse checks passed; test writes rolled back' as result;

