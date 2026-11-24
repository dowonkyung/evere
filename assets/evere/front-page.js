import { setArticleTitle } from './article-label.js';
import { articlePath } from './routes.js?v=routes-1';
import { supabase } from './supabase.js';
import { photoBucket } from './article-content.js?v=inline-1';

const head = document.querySelector('[data-home-articles]');
const primary = head.querySelector('[data-home-primary]');
const secondary = head.querySelector('[data-home-secondary]');
const latest = head.querySelector('aside');
const placeholder = new URL('./media-placeholder.svg', import.meta.url).href;
const latestLimit = 6;
const lowerList = document.querySelector('[data-home-list]');
const opinionList = document.querySelector('[data-home-opinion]');

function articleDescription(data) {
    let text = data.body || '';
    if (data.body_html?.trim()) {
        const template = document.createElement('template');
        template.innerHTML = data.body_html;
        const content = template.content;
        for (const extra of content.querySelectorAll('figure, figcaption, script, style, template')) extra.remove();
        for (const block of content.querySelectorAll('br, p, div, li, blockquote, h1, h2, h3, h4, h5, h6')) {
            block.after(' ');
        }
        text = content.textContent;
    }
    return Array.from(text.replace(/\s+/g, ' ').trim()).slice(0, 120).join('');
}

function makeArticle(data, summary = false, thumbnailRatio = '700 / 467', textFirst = false) {
    const article = document.createElement('article');
    const picture = document.createElement('picture');
    const image = document.createElement('img');
    image.className = 'evere-media-placeholder';
    image.style.setProperty('--media-ratio', thumbnailRatio);
    image.src = placeholder;
    image.alt = '';
    if (!summary) image.loading = 'lazy';
    picture.append(image);

    const text = document.createElement('div');
    const title = document.createElement('a');
    title.href = articlePath(data);
    setArticleTitle(title, data.title, data.article_label);
    text.append(title);
    const excerpt = summary ? articleDescription(data) : '';
    if (excerpt) {
        const description = document.createElement('p');
        description.className = 'desc';
        description.textContent = excerpt;
        text.append(description);
    }
    if (textFirst) article.append(text, picture);
    else article.append(picture, text);
    return { article, image, path: data.photo_paths?.[0] };
}

let titleCheckFrame;

function scheduleTitleCheck() {
    cancelAnimationFrame(titleCheckFrame);
    titleCheckFrame = requestAnimationFrame(() => {
        const titles = [...document.querySelectorAll('main article > div > a')];
        // Measure using each section's own line limit before changing any styles.
        for (const title of titles) title.classList.remove('home-title-fits');
        const fitting = titles.filter(title =>
            title.clientWidth > 0 &&
            title.scrollWidth <= title.clientWidth &&
            title.scrollHeight <= title.clientHeight
        );
        for (const title of fitting) title.classList.add('home-title-fits');
    });
}

window.addEventListener('resize', scheduleTitleCheck);
document.fonts.ready.then(scheduleTitleCheck);
document.fonts.addEventListener('loadingdone', scheduleTitleCheck);
scheduleTitleCheck();

async function renderArticles() {
    const [saved, feed] = await Promise.allSettled([
        supabase.from('evere_page_slots')
            .select('slot,evere_articles!inner(id,article_number,title,article_label,body,body_html,status,photo_paths)')
            .eq('page', 'home').eq('category', '').eq('evere_articles.status', 'published').order('slot'),
        supabase.from('evere_articles').select('id,article_number,title,article_label,photo_paths')
            .eq('status', 'published').order('published_at', { ascending: false, nullsFirst: false })
            .order('id').limit(latestLimit + 8),
    ]);
    const placements = saved.status === 'fulfilled' ? saved.value.data || [] : [];
    const recent = feed.status === 'fulfilled' ? feed.value.data || [] : [];

    const images = [];
    const secondaryList = secondary.querySelector('ul');
    const latestList = latest.querySelector('ul');
    const placed = new Set();
    const lowerItems = new Map([...lowerList.querySelectorAll('[data-home-slot]')]
        .map(item => [Number(item.dataset.homeSlot), item]));
    for (const { slot, evere_articles: article } of placements) {
        placed.add(article.id);
        const rendered = makeArticle(article, slot === 1 || slot >= 4, slot >= 5 ? '300 / 200' : undefined, slot === 4);
        images.push(rendered);
        const item = lowerItems.get(slot) || (slot === 1 ? primary : secondaryList.children[slot - 2]);
        if (item) {
            item.replaceChildren(rendered.article);
            item.hidden = false;
        }
    }
    const hasLower = [...lowerItems.values()].some(item => !item.hidden);
    lowerList.querySelector('.main-block').hidden = !hasLower;
    lowerList.hidden = !hasLower;
    document.querySelector('[data-home-list-empty]').hidden = hasLower;
    lowerList.querySelector('[data-home-sub-list]').hidden = ![5, 6, 7].some(slot => !lowerItems.get(slot).hidden);
    recent.filter(({ id }) => !placed.has(id)).slice(0, latestLimit).forEach((article, index) => {
        const rendered = makeArticle(article, false, '300 / 200');
        latestList.children[index].replaceChildren(rendered.article);
        images.push(rendered);
    });

    scheduleTitleCheck();

    const paths = [...new Set(images.map(({ path }) => path).filter(Boolean))];
    if (!paths.length) return;
    const { data } = await photoBucket.createSignedUrls(paths, 3600);
    const urls = new Map((data || []).map(({ path, signedUrl }) => [path, signedUrl]));
    for (const { image, path } of images) {
        const url = urls.get(path);
        if (!url) continue;
        image.addEventListener('error', () => {
            image.classList.add('evere-media-placeholder');
            image.src = placeholder;
        }, { once: true });
        image.classList.remove('evere-media-placeholder');
        image.src = url;
    }
}

void renderArticles().catch(() => {});


async function loadOpinion(editorial) {
    const query = () => supabase.from('evere_articles')
        .select('article_number,title,byline,evere_series(title)')
        .eq('status', 'published').eq('sector', 'opinion')
        .not('article_number', 'is', null)
        .order('published_at', { ascending: false, nullsFirst: false }).order('id');

    if (editorial) {
        const { data, error } = await query().eq('category', 'editorial').limit(3);
        if (error) throw error;
        return data;
    }
    const rows = [];
    const size = 100;
    for (let start = 0; ; start += size) {
        const { data, error } = await query().or('category.neq.editorial,category.is.null')
            .range(start, start + size - 1);
        if (error) throw error;
        rows.push(...data);
        if (data.length < size) return rows;
    }
}

function opinionItem(row, editorial) {
    const item = document.createElement('li');
    const article = document.createElement('article');
    const text = document.createElement('div');
    const link = document.createElement('a');
    link.href = articlePath(row);
    const name = editorial ? '사설' : row.evere_series?.title;
    if (name) {
        const label = document.createElement('span');
        label.textContent = name;
        link.append(label);
    }
    link.append(row.title);
    text.append(link);
    article.append(text);
    item.append(article);
    const reporter = !editorial && row.byline?.[0];
    return { item, article, avatarPath: reporter ? reporter + '/profile' : null };
}

async function renderOpinion() {
    const [editorials, others] = await Promise.all([loadOpinion(true), loadOpinion(false)]);
    const entries = [...editorials.map(row => opinionItem(row, true)), ...others.map(row => opinionItem(row, false))];
    if (!entries.length) return;
    opinionList.replaceChildren(...entries.map(({ item }) => item));
    scheduleTitleCheck();

    const paths = [...new Set(entries.map(({ avatarPath }) => avatarPath).filter(Boolean))];
    const bucket = supabase.storage.from('evere-avatars');
    for (let offset = 0; offset < paths.length; offset += 100) {
        const { data } = await bucket.createSignedUrls(paths.slice(offset, offset + 100), 3600);
        const urls = new Map((data || []).map(({ path, signedUrl }) => [path, signedUrl]));
        for (const { item, article, avatarPath } of entries) {
            const url = urls.get(avatarPath);
            if (!url) continue;
            const picture = document.createElement('picture');
            const image = document.createElement('img');
            image.alt = '';
            image.loading = 'lazy';
            image.addEventListener('error', () => {
                picture.remove();
                item.classList.remove('editor');
                scheduleTitleCheck();
            }, { once: true });
            image.src = url;
            picture.append(image);
            item.classList.add('editor');
            article.prepend(picture);
        }
    }
    scheduleTitleCheck();
}

void renderOpinion().catch(() => {
    if (opinionList.querySelector('article')) return;
    opinionList.firstElementChild.textContent = '오피니언을 불러오지 못했습니다.';
});
