
alter table public.evere_articles add column audio_path text;
create index evere_articles_audio_path_idx on public.evere_articles(audio_path) where audio_path is not null;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values ('evere-article-audio','evere-article-audio',false,50331648,
 array['audio/mpeg','audio/mp4','audio/x-m4a','audio/wav','audio/x-wav','audio/ogg','audio/webm','audio/aac','audio/flac']);

create policy evere_audio_upload on storage.objects for insert to authenticated
with check (bucket_id='evere-article-audio' and (select evere_private.member_role()) is not null
  and (storage.foldername(name))[1]=(select auth.uid())::text);

create policy evere_audio_owner_read on storage.objects for select to authenticated
using (bucket_id='evere-article-audio' and (select evere_private.member_role()) is not null
  and (storage.foldername(name))[1]=(select auth.uid())::text);

create policy evere_audio_published_read on storage.objects for select to anon,authenticated
using (bucket_id='evere-article-audio' and exists (
    select 1 from public.evere_articles a where a.audio_path=storage.objects.name and a.status='published'
));

create policy evere_audio_unused_delete on storage.objects for delete to authenticated
using (bucket_id='evere-article-audio' and (storage.foldername(name))[1]=(select auth.uid())::text
  and (select evere_private.member_role()) is not null
  and not exists (select 1 from public.evere_articles a where a.audio_path=storage.objects.name));

create function evere_private.check_article_audio() returns trigger
language plpgsql set search_path='' as $$
begin
  if new.audio_path is null or (tg_op='UPDATE' and new.audio_path is not distinct from old.audio_path) then return new; end if;
  if (storage.foldername(new.audio_path))[1] is distinct from auth.uid()::text
     or not exists (select 1 from storage.objects where bucket_id='evere-article-audio' and name=new.audio_path) then
    raise exception 'Invalid article audio path' using errcode='42501';
  end if;
  return new;
end;
$$;
create trigger evere_check_article_audio before insert or update of audio_path on public.evere_articles
for each row execute function evere_private.check_article_audio();

create function evere_private.save_author_draft_audio(target uuid,new_title text,new_subtitle text,new_body text,
 new_body_html text,new_photo_paths text[],next_state text,new_print_issue integer,new_print_page integer,new_audio_path text)
returns void language plpgsql security definer set search_path='' as $$
begin
  perform evere_private.save_author_draft(target,new_title,new_subtitle,new_body,new_body_html,
    new_photo_paths,next_state,new_print_issue,new_print_page);
  update public.evere_articles set audio_path=new_audio_path where id=target and created_by=auth.uid();
end;
$$;
revoke all on function evere_private.save_author_draft_audio(uuid,text,text,text,text,text[],text,integer,integer,text) from public,anon;
grant execute on function evere_private.save_author_draft_audio(uuid,text,text,text,text,text[],text,integer,integer,text) to authenticated;
create function public.evere_save_author_draft_audio(target uuid,new_title text,new_subtitle text,new_body text,
 new_body_html text,new_photo_paths text[],next_state text,new_print_issue integer,new_print_page integer,new_audio_path text)
returns void language sql security invoker set search_path='' as $$
  select evere_private.save_author_draft_audio(target,new_title,new_subtitle,new_body,new_body_html,
    new_photo_paths,next_state,new_print_issue,new_print_page,new_audio_path);
$$;
revoke all on function public.evere_save_author_draft_audio(uuid,text,text,text,text,text[],text,integer,integer,text) from public,anon;
grant execute on function public.evere_save_author_draft_audio(uuid,text,text,text,text,text[],text,integer,integer,text) to authenticated;
