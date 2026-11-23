import { articleListPicture, loadArticleListPhotos, renderMajorArticles } from './article-list-media.js';
import { setArticleTitle } from './article-label.js';
import { requestedSeries, seriesFor } from './series.js';

const main = document.querySelector('main');
const category = main.dataset.opinionCategory;
const list = main.querySelector('#recentList');
const contents = list.closest('section.contents');
let rows = [];
const series = requestedSeries();
const dateFormat = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul' });

try {
    const { publishedFeed } = await import('./published-feed.js?v=article-thumbs-1');
    rows = await publishedFeed('opinion', category, series);
    if (series) {
        const name = (await seriesFor('opinion')).find(({ id }) => id === series)?.title || '기획·연재';
        main.querySelector('.head')?.remove();
        const title = document.createElement('h2');
        title.textContent = name;
        list.before(title);
        list.replaceChildren();
        document.title = name + ' | ' + document.title;
    }
    const fragment = document.createDocumentFragment();
    for (const entry of rows) {
        const row = document.createElement('li');
        row.dataset.articleDate = dateFormat.format(new Date(entry.publishedAt));
        const article = document.createElement('article');
        const picture = articleListPicture(entry);
        const info = document.createElement('div');
        const link = document.createElement('a');
        link.href = entry.href;
        setArticleTitle(link, entry.title, entry.article_label);
        const description = document.createElement('p');
        description.className = 'desc';
        description.textContent = entry.summary;
        const date = document.createElement('p');
        date.className = 'date';
        date.textContent = row.dataset.articleDate.replaceAll('-', '.');
        info.append(link, description, date);
        article.append(picture, info);
        row.append(article);
        fragment.append(row);
    }
    list.prepend(fragment);
} catch {
    // The saved list is still available.
}
if (contents) {
    renderMajorArticles(contents, rows);
    void loadArticleListPhotos(contents).catch(() => {});
}
if (category || series) await import('./opinion-list.js?v=categories-1');

