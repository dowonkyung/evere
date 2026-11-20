import { supabase } from './supabase.js';

export async function publishedFeed(section, category = '', series = '') {
    let query = supabase.from('evere_articles').select('id,title,body,sector,category,published_at')
        .eq('sector', section).eq('status', 'published')
        .order('published_at', { ascending: false }).order('id').limit(30);
    if (category) query = query.eq('category', category);
    if (series) query = query.eq('series_id', series);
    const { data, error } = await query;
    if (error) throw error;
    return data.map((entry) => ({
        section: entry.sector, category: entry.category, publishedAt: entry.published_at,
        title: entry.title, summary: entry.body.slice(0, 220),
        href: new URL('../../article/?id=' + entry.id, import.meta.url).href,
    }));
}
