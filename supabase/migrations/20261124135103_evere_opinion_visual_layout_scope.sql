alter table public.evere_opinion_layout drop constraint evere_opinion_layout_area_check;
alter table public.evere_opinion_layout add constraint evere_opinion_layout_area_check check (area in ('editorial', 'columns'));
alter table public.evere_opinion_layout add constraint evere_opinion_layout_slot_count check (
    jsonb_array_length(items) = case area when 'editorial' then 3 else 6 end
);
