import { categoryFromURL } from './routes.js?v=routes-1';
import { articles, latestSeries } from './section-data.js';
import { recentSeries, requestedSeries, seriesFor } from './series.js';

const main = document.querySelector('[data-news-section]');
const section = main.dataset.newsSection;
const requested = categoryFromURL(section);
const tabs = [...main.querySelectorAll('[data-category-tab]')];
const selected = tabs.some((tab) => tab.dataset.categoryTab === requested) ? requested : '';
const contents = main.querySelector('#section-contents');
const recentList = main.querySelector('#recentList');
const lead = main.querySelector('.head');
const seriesBlock = main.querySelector('.section-series');
const placeholder = new URL('./media-placeholder.svg', import.meta.url).href;
const seriesFilter = requestedSeries();

if (selected || seriesFilter) {
    lead?.remove();
    contents.classList.add('sub');
    if (selected) {
        const label = tabs.find((tab) => tab.dataset.categoryTab === selected).textContent;
        document.title = label + ' | ' + document.title;
    }

    for (const row of recentList.children) {
        if (seriesFilter || !(row.dataset.category || '').split(' ').includes(selected)) row.hidden = true;
    }
}
for (const tab of tabs) {
    const active = tab.dataset.categoryTab === selected;
    tab.classList.toggle('active', active);
    if (active) tab.setAttribute('aria-current', 'page');
    else tab.removeAttribute('aria-current');
}
for (const row of [...recentList.children]) {
    if (row.hidden) row.remove();
}

function makePicture(source, className) {
    const picture = document.createElement('picture');
    const img = document.createElement('img');
    img.alt = '';
    img.loading = 'lazy';
    img.src = source || placeholder;
    if (className) img.className = className;
    picture.append(img);
    return picture;
}

const now = Date.now();
let series = selected || seriesFilter ? [] : latestSeries(articles, section, now);
if (!selected && !seriesFilter) {
    try {
        const live = await recentSeries(section);
        if (live.length) series = live;
    } catch {
        // Keep the section available when the feed is unreachable.
    }
}
if (series.length) {
    const list = seriesBlock.querySelector('ul');
    for (const entry of series) {
        const card = document.createElement('li');
        card.className = 'swiper-slide';
        const link = document.createElement('a');
        link.href = entry.href;
        link.textContent = entry.title;
        card.append(makePicture(entry.image, entry.image ? '' : 'evere-media-placeholder'), link);
        list.append(card);
    }
    seriesBlock.hidden = false;
}

const dateFormat = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul' });
let live = [];
try {
    const { publishedFeed } = await import('./published-feed.js?v=routes-1');
    live = await publishedFeed(section, selected, seriesFilter);
    if (seriesFilter) {
        const name = (await seriesFor(section)).find(({ id }) => id === seriesFilter)?.title || '기획·연재';
        const heading = document.createElement('h2');
        heading.textContent = name;
        recentList.before(heading);
        document.title = name + ' | ' + document.title;
    }
} catch {
    // The saved preview stays available when the news feed is unreachable.
}
const published = [...live, ...(seriesFilter ? [] : articles)].filter((entry) =>
    entry.section === section && (!selected || entry.category === selected) &&
    Number.isFinite(Date.parse(entry.publishedAt)) && Date.parse(entry.publishedAt) <= now
).sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt));
const rows = document.createDocumentFragment();
for (const item of published) {
    const row = document.createElement('li');
    row.dataset.articleDate = dateFormat.format(new Date(item.publishedAt));

    const article = document.createElement('article');
    const copy = document.createElement('div');
    const link = document.createElement('a');
    link.href = item.href;
    link.textContent = item.title;
    const summary = document.createElement('p');
    summary.className = 'desc';
    summary.textContent = item.summary || '';
    const date = document.createElement('p');
    date.className = 'date';
    date.textContent = row.dataset.articleDate.replaceAll('-', '.');
    copy.append(link, summary, date);
    article.append(makePicture(item.image, item.image ? '' : 'evere-media-placeholder'), copy);
    row.append(article);
    rows.append(row);
}
recentList.prepend(rows);

await import('./opinion-list.js?v=categories-1');

