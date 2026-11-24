import { supabase } from './supabase.js';
import { articlePath } from './routes.js?v=routes-1';
import { articleListPicture, loadArticleListPhotos } from './article-list-media.js';
import { setArticleTitle } from './article-label.js';

const groups = {
    editorial: { root: '#editorial', lists: ['.type-a', '.type-b'], limits: [1, 2], category: 'editorial' },
    columns: { root: '#columns', lists: ['ul'], limits: [6], category: 'column' },
};
const uuid = /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i;

function card(article, category) {
    const row = document.createElement('li');
    const content = document.createElement('article');
    const info = document.createElement('div');
    if (category === 'column' && article.evere_series?.title) {
        const issue = document.createElement('p');
        issue.className = 'issue';
        issue.textContent = article.evere_series.title;
        info.append(issue);
    }
    const title = document.createElement('a');
    title.href = articlePath(article);
    setArticleTitle(title, article.title, article.article_label);
    const desc = document.createElement('p');
    desc.className = 'desc';
    desc.textContent = article.subtitle || (article.body || '').slice(0, 180);
    info.append(title, desc);
    content.append(articleListPicture({ photoPath: article.photo_paths?.[0] }), info);
    row.append(content);
    return row;
}

async function applyLayout() {
    const { data, error } = await supabase.from('evere_opinion_layout').select('area,items');
    if (error) throw error;
    const ids = [...new Set(data.flatMap(row => row.items).filter(value => typeof value === 'string' && uuid.test(value)))];
    const articles = new Map();
    if (ids.length) {
        const { data: rows, error: articleError } = await supabase.from('evere_articles')
            .select('id,article_number,title,article_label,subtitle,body,photo_paths,category,evere_series(title)')
            .in('id', ids).eq('status', 'published').eq('sector', 'opinion').not('article_number', 'is', null);
        if (articleError) throw articleError;
        for (const row of rows) articles.set(row.id, row);
    }
    for (const { area, items } of data) {
        const group = groups[area];
        if (!group) continue;
        const section = document.querySelector(group.root);
        let offset = 0;
        for (const [index, selector] of group.lists.entries()) {
            const limit = group.limits[index];
            const rows = items.slice(offset, offset + limit).flatMap(id => {
                const article = articles.get(id);
                return article?.category === group.category ? [card(article, group.category)] : [];
            });
            section.querySelector(selector).replaceChildren(...rows);
            offset += limit;
        }
        void loadArticleListPhotos(section).catch(() => {});
    }
}

void applyLayout().catch(() => {});
