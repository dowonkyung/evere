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
    if (summary) {
        const description = document.createElement('p');
        description.className = 'desc';
        description.textContent = data.subtitle || Array.from(data.body).slice(0, 120).join('');
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
            .select('slot,evere_articles!inner(id,article_number,title,article_label,subtitle,body,status,photo_paths)')
            .eq('page', 'home').eq('category', '').eq('evere_articles.status', 'published').order('slot'),
        supabase.from('evere_articles').select('id,article_number,title,article_label,photo_paths')
            .eq('status', 'published').order('published_at', { ascending: false, nullsFirst: false })
            .order('id').limit(latestLimit + 3),
    ]);
    const placements = saved.status === 'fulfilled' ? saved.value.data || [] : [];
    const recent = feed.status === 'fulfilled' ? feed.value.data || [] : [];

    const images = [];
    const secondaryList = secondary.querySelector('ul');
    const latestList = latest.querySelector('ul');
    const placed = new Set();
    for (const { slot, evere_articles: article } of placements) {
        placed.add(article.id);
        const rendered = makeArticle(article, slot === 1);
        images.push(rendered);
        const item = slot === 1 ? primary : secondaryList.children[slot - 2];
        item?.replaceChildren(rendered.article);
    }
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

