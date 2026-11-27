import { articleExcerpt } from './article-excerpt.js?v=1';
import { setArticleTitle } from './article-label.js';
import { articlePath, categoryFromURL } from './routes.js?v=wiki-culture-1';
import { supabase } from './supabase.js';
import { photoBucket } from './article-content.js?v=caption-1';
import { requestedSeries } from './series.js';

const script = document.querySelector('script[data-layout-page]');
const page = script.dataset.layoutPage;
const category = script.dataset.layoutCategory ?? categoryFromURL(page);
const main = document.querySelector('main .wrap');
const sectionHead = !category && page !== 'home' && page !== 'opinion';
const placeholder = '/assets/evere/media-placeholder.svg';

function headlineCard(article, primary) {
    const card = document.createElement('article');
    const picture = document.createElement('picture');
    const image = document.createElement('img');
    image.src = placeholder;
    image.alt = '';
    if (!primary) image.loading = 'lazy';
    picture.append(image);
    const copy = document.createElement('div');
    const link = document.createElement('a');
    link.href = articlePath(article);
    setArticleTitle(link, article.title, article.article_label);
    copy.append(link);
    if (primary) {
        const summary = document.createElement('p');
        summary.className = 'desc';
        summary.textContent = articleExcerpt(article, 180);
        copy.append(summary);
    }
    card.append(picture, copy);
    return { card, image, path: article.photo_paths?.[0] };
}

async function showSectionHead(rows) {
    const head = document.createElement('section');
    head.className = 'head';
    head.setAttribute('aria-label', '주요 기사');
    const layout = document.createElement('dl');
    const secondary = document.createElement('dd');
    const list = document.createElement('ul');
    const images = [];
    for (const { slot, evere_articles: article } of rows) {
        const primary = slot === 1;
        const { card, image, path } = headlineCard(article, primary);
        const item = document.createElement(primary ? 'dt' : 'li');
        item.append(card);
        (primary ? layout : list).append(item);
        if (path) images.push({ image, path });
    }
    if (list.childElementCount) {
        secondary.append(list);
        layout.append(secondary);
    }
    head.append(layout);
    main.querySelector('.child-section').after(head);

    if (!images.length) return;
    const paths = [...new Set(images.map(({ path }) => path))];
    const { data } = await photoBucket.createSignedUrls(paths, 3600);
    const urls = new Map((data || []).map(({ path, signedUrl }) => [path, signedUrl]));
    for (const { image, path } of images) {
        const url = urls.get(path);
        if (url) image.src = url;
    }
}

async function showPlacements() {
    if (!main || category.length > 64 || (sectionHead && requestedSeries())) return;
    const { data, error } = await supabase.from('evere_page_slots')
        .select('slot,evere_articles(id,article_number,title,article_label,body,body_html,photo_paths,status,sector,category)')
        .eq('page', page).eq('category', category).order('slot');
    if (error || !data.length) return;
    const rows = data.filter(({ evere_articles: article }) =>
        article?.status === 'published' &&
        (page === 'home' || article.sector === page) &&
        (!category || article.category === category)
    );
    if (!rows.length) return;
    if (sectionHead) return showSectionHead(rows);

    const block = document.createElement('div');
    block.className = 'evere-front-placements';
    const heading = document.createElement('h2');
    heading.textContent = '주요 기사';
    const list = document.createElement('ul');
    for (const { evere_articles: article } of rows) {
        const item = document.createElement('li');
        const link = document.createElement('a');
        link.href = articlePath(article);
        setArticleTitle(link, article.title, article.article_label);
        const summary = document.createElement('p');
        summary.textContent = articleExcerpt(article, 120);
        item.append(link, summary);
        list.append(item);
    }
    block.append(heading, list);
    const tabs = main.querySelector('.child-section');
    if (tabs) tabs.after(block);
    else main.prepend(block);
}

showPlacements().catch(() => {});

