import { articleExcerpt } from './article-excerpt.js?v=1';
import { loadBottomLinks } from './home-bottom-links.js';
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

function makeArticle(data, summary = false, thumbnailRatio = '700 / 467') {
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
    const excerpt = summary ? articleExcerpt(data, 120) : '';
    if (excerpt) {
        const description = document.createElement('p');
        description.className = 'desc';
        description.textContent = excerpt;
        text.append(description);
    }
    article.append(picture, text);
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
            .eq('status', 'published').neq('sector', 'opinion')
            .order('published_at', { ascending: false, nullsFirst: false }).order('id').limit(latestLimit + 8),
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
        if (slot > 8) continue;
        placed.add(article.id);
        const rendered = makeArticle(article, slot === 1 || slot >= 4, slot >= 5 ? '300 / 200' : undefined);
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


const maxHomeOpinions = 10;

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
    const { data, error } = await query().or('category.neq.editorial,category.is.null').limit(maxHomeOpinions);
    if (error) throw error;
    return data;
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
    const entries = [...editorials.map(row => opinionItem(row, true)), ...others.slice(0, maxHomeOpinions - editorials.length).map(row => opinionItem(row, false))];
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

function articleListItem(article) {
    const item = document.createElement('li');
    const link = document.createElement('a');
    link.href = articlePath(article);
    setArticleTitle(link, article.title, article.article_label);
    item.append(link);
    return item;
}

async function renderBoardArticles(sector, selector) {
    const { data, error } = await supabase.from('evere_articles')
        .select('article_number,title,article_label')
        .eq('status', 'published').eq('sector', sector).not('article_number', 'is', null)
        .order('published_at', { ascending: false, nullsFirst: false }).order('id').limit(4);
    if (error) throw error;
    document.querySelector(selector).replaceChildren(...data.map(articleListItem));
}

const eventLinks = document.querySelector('[data-home-event-links]');
const eventLinksRegion = eventLinks.parentElement;
const eventLinksToggle = eventLinksRegion.querySelector('button');
function setEventLinksExpanded(expanded) {
    eventLinks.classList.toggle('active', expanded);
    eventLinksToggle.setAttribute('aria-expanded', String(expanded));
}
eventLinksToggle.onclick = () => setEventLinksExpanded(!eventLinks.classList.contains('active'));
eventLinksRegion.addEventListener('keydown', event => {
    if (event.key !== 'Escape' || !eventLinks.classList.contains('active')) return;
    event.stopPropagation();
    setEventLinksExpanded(false);
    eventLinksToggle.focus();
});

async function renderBottomLinks() {
    const rows = await loadBottomLinks();
    for (const [area, selector] of [['event_links', '[data-home-event-links]'], ['service_cards', '[data-home-service-cards]']]) {
        const list = document.querySelector(selector);
        list.replaceChildren(...rows.filter(row => row.area === area).map(row => {
            const item = document.createElement('li');
            const link = document.createElement('a');
            link.href = row.url;
            if (area === 'service_cards') {
                const title = document.createElement('p');
                title.textContent = row.label;
                const description = document.createElement('span');
                description.textContent = row.description;
                link.append(title, description);
            } else {
                link.textContent = row.label;
            }
            item.append(link);
            return item;
        }));
    }
    const count = eventLinks.childElementCount;
    eventLinksRegion.hidden = count === 0;
    eventLinksToggle.hidden = count < 2;
}

void renderBoardArticles('notice', '[data-home-events]').catch(() => {});
void renderBoardArticles('corrections', '[data-home-corrections]').catch(() => {});
void renderBottomLinks().catch(() => {});
