import { articlePath } from './routes.js?v=routes-1';
import { supabase } from './supabase.js';

export async function publishedFeed(section, category = '', series = '') {
    let query = supabase.from('evere_articles').select('id,article_number,title,article_label,body,sector,category,published_at,photo_paths')
        .eq('sector', section).eq('status', 'published')
        .order('published_at', { ascending: false }).order('id').limit(30);
    if (category) query = query.eq('category', category);
    if (series) query = query.eq('series_id', series);
    const { data, error } = await query;
    if (error) throw error;
    return data.map((entry) => ({
        section: entry.sector, category: entry.category, publishedAt: entry.published_at,
        title: entry.title, article_label: entry.article_label, summary: entry.body.slice(0, 220),
        href: articlePath(entry), photoPath: entry.photo_paths?.[0],
    }));
}

