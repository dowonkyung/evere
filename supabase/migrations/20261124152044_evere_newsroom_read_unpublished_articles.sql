alter policy evere_editorial_read on public.evere_articles
using ((select evere_private.member_role()) is not null);
