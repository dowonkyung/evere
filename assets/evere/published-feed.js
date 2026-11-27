import { articlePath } from './routes.js?v=routes-1';
import { supabase } from './supabase.js';

export async function publishedFeed(section, category = '', series = '', { all = false } = {}) {
    const fields = 'id,article_number,title,article_label,body,sector,category,published_at,photo_paths';
    let query = supabase.from('evere_articles').select(section === 'opinion' ? fields + ',evere_series(title)' : fields)
        .eq('sector', section).eq('status', 'published')
        .order('published_at', { ascending: false }).order('id');
    if (category) query = query.eq('category', category);
    if (series) query = query.eq('series_id', series);
    const entries = [];
    const batchSize = all ? 100 : 30;
    for (let offset = 0; ; offset += batchSize) {
        const { data, error } = await query.range(offset, offset + batchSize - 1);
        if (error) throw error;
        entries.push(...data);
        if (!all || data.length < batchSize) break;
    }
    return entries.map((entry) => ({
        section: entry.sector, category: entry.category, publishedAt: entry.published_at,
        seriesTitle: entry.evere_series?.title,
        title: entry.title, article_label: entry.article_label, summary: entry.body.slice(0, 220),
        href: articlePath(entry), photoPath: entry.photo_paths?.[0],
    }));
}

