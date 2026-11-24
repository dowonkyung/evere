alter table public.evere_epaper_regions add column print_title text check (length(print_title) <= 300);
