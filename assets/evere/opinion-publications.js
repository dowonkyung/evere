const main = document.querySelector('main');
const category = main.dataset.opinionCategory;
const list = main.querySelector('#recentList');
const dateFormat = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul' });

try {
    const { publishedFeed } = await import('./published-feed.js');
    const rows = await publishedFeed('opinion', category);
    const fragment = document.createDocumentFragment();
    for (const entry of rows) {
        const row = document.createElement('li');
        row.dataset.articleDate = dateFormat.format(new Date(entry.publishedAt));
        const article = document.createElement('article');
        const picture = document.createElement('picture');
        const img = document.createElement('img');
        img.alt = '';
        img.src = new URL('./media-placeholder.svg', import.meta.url).href;
        img.className = 'evere-media-placeholder';
        img.loading = 'lazy';
        picture.append(img);
        const info = document.createElement('div');
        const link = document.createElement('a');
        link.href = entry.href;
        link.textContent = entry.title;
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
if (category) await import('./opinion-list.js?v=categories-1');
