alter table public.evere_articles
  drop constraint evere_article_category_check,
  add constraint evere_article_category_check CHECK (((category IS NULL) OR (category = ANY (
CASE sector
    WHEN 'opinion'::evere_sector THEN ARRAY['editorial'::text, 'column'::text, 'contributions'::text]
    WHEN 'wiki'::evere_sector THEN ARRAY['general'::text, 'council'::text, 'informal-groups'::text, 'chair'::text, 'other-wikis'::text]
    WHEN 'virtual-nations'::evere_sector THEN ARRAY['general'::text, 'nations'::text, 'virtual-united-nations'::text, 'hangaker-wolbon'::text, 'kaguk-diguk'::text]
    WHEN 'politics'::evere_sector THEN ARRAY['general'::text, 'president'::text, 'assembly'::text, 'legal'::text, 'north-korea'::text, 'foreign-defense'::text, 'administration'::text]
    WHEN 'economy'::evere_sector THEN ARRAY['general'::text, 'policy'::text, 'industry'::text, 'finance'::text, 'real-estate'::text, 'technology'::text, 'automotive'::text]
    WHEN 'society'::evere_sector THEN ARRAY['general'::text, 'incidents'::text, 'justice'::text, 'education'::text, 'labor'::text, 'health-welfare'::text, 'environment'::text]
    WHEN 'international'::evere_sector THEN ARRAY['general'::text, 'china'::text, 'japan'::text, 'asia-oceania'::text, 'americas'::text, 'europe'::text, 'middle-east-africa'::text]
    WHEN 'health'::evere_sector THEN ARRAY['general'::text, 'living'::text, 'obituaries'::text, 'gukjim'::text]
    WHEN 'sports'::evere_sector THEN ARRAY['general'::text, 'baseball'::text, 'football'::text, 'basketball-volleyball'::text, 'golf'::text]
    WHEN 'culture'::evere_sector THEN ARRAY['general'::text, 'k-pop'::text, 'religion'::text, 'nam-gwang-hui'::text, 'film-music'::text, 'arts'::text, 'subculture'::text]
    ELSE NULL::text[]
END))));
