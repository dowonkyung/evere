import { articleExcerpt } from './article-excerpt.js?v=1';
import { supabase } from './supabase.js';
import { articlePath } from './routes.js?v=routes-1';
import { articleListPicture, loadArticleListPhotos } from './article-list-media.js';
import { setArticleTitle } from './article-label.js';

const groups = {
    editorial: { root: '#editorial', lists: ['.type-a', '.type-b'], limits: [1, 2], category: 'editorial' },
    columns: { root: '#columns', lists: ['ul'], limits: [6], category: 'column' },
};
const uuid = /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i;

function firstPhoto(article) {
    const template = document.createElement('template');
    template.innerHTML = article.body_html || '';
    const paths = article.photo_paths || [];
    const figure = [...template.content.querySelectorAll('figure[data-photo]')]
        .find(node => paths.includes(node.dataset.photo));
    return figure?.dataset.photo || paths[0];
}

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
    desc.textContent = articleExcerpt(article, 180);
    info.append(title, desc);
    content.append(articleListPicture({ photoPath: category === 'column' ? firstPhoto(article) : article.photo_paths?.[0] }), info);
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
            .select('id,article_number,title,article_label,body,body_html,photo_paths,category,evere_series(title)')
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

function seriesCard(entry) {
    const article = document.createElement('article');
    const text = document.createElement('div');
    const label = document.createElement('p');
    label.className = 'issue';
    label.textContent = entry.series_title;
    const link = document.createElement('a');
    link.href = articlePath(entry);
    setArticleTitle(link, entry.title, entry.article_label);
    text.append(label, link);

    const details = document.createElement('dl');
    const item = document.createElement('dt');
    const photoPath = firstPhoto(entry);
    if (photoPath) {
        const photo = document.createElement('div');
        photo.className = 'photo';
        photo.append(articleListPicture({ photoPath }));
        item.append(photo);
    }
    if (entry.authors?.length) {
        const info = document.createElement('div');
        info.className = 'info opinion-series-byline';
        for (const author of entry.authors) {
            const person = document.createElement('div');
            person.className = 'opinion-series-author';
            const name = document.createElement('span');
            name.className = 'name';
            name.textContent = author.name;
            person.append(name);
            if (author.position?.trim()) {
                const position = document.createElement('p');
                position.className = 'dapartment';
                position.textContent = author.position.trim();
                person.append(position);
            }
            info.append(person);
        }
        item.append(info);
    }
    details.append(item);
    article.append(text, details);
    return article;
}

async function renderLatestSeries() {
    const section = document.querySelector('.outside-editor');
    const container = section.querySelector('.outside-editor-list');
    const list = container.querySelector('.swiper-wrapper');
    const status = section.querySelector('[data-opinion-series-status]');
    const { data, error } = await supabase.rpc('evere_latest_opinion_series_with_authors');
    if (error) throw error;
    const slides = [];
    for (let index = 0; index < data.length; index += 3) {
        const slide = document.createElement('li');
        slide.className = 'swiper-slide';
        slide.append(...data.slice(index, index + 3).map(seriesCard));
        slides.push(slide);
    }
    list.replaceChildren(...slides);
    container.hidden = !data.length;
    status.hidden = !!data.length;
    status.textContent = data.length ? '' : '출고된 기획·연재 글이 없습니다.';
    container.swiper?.update();
    void loadArticleListPhotos(section).catch(() => {});
}

void renderLatestSeries().catch(() => {
    const status = document.querySelector('[data-opinion-series-status]');
    status.hidden = false;
    status.textContent = '최신 기명 칼럼을 불러오지 못했습니다.';
});
