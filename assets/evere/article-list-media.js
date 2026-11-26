import { setArticleTitle } from './article-label.js';
import { photoBucket } from './article-content.js?v=caption-1';

export function articleListPicture(entry) {
    if (!entry.image && !entry.photoPath) return document.createDocumentFragment();
    const picture = document.createElement('picture');
    const image = document.createElement('img');
    image.alt = '';
    image.loading = 'lazy';
    image.addEventListener('error', () => {
        const frame = picture.parentElement;
        if (frame?.matches('div.photo') && frame.childElementCount === 1) frame.remove();
        else picture.remove();
    }, { once: true });
    if (entry.image) image.src = entry.image;
    else picture.style.display = 'none';
    if (entry.photoPath) image.dataset.listPhoto = entry.photoPath;
    picture.append(image);
    return picture;
}

export async function loadArticleListPhotos(contents, { visibleOnly = false } = {}) {
    const images = [...contents.querySelectorAll('img[data-list-photo]')]
        .filter(image => !image.dataset.photoSigned && (!visibleOnly || !image.closest('[hidden]')));
    const paths = [...new Set(images.map(image => image.dataset.listPhoto))];
    if (!paths.length) return;

    const { data, error } = await photoBucket.createSignedUrls(paths, 3600);
    if (error) return;
    const urls = new Map((data || []).map(({ path, signedUrl }) => [path, signedUrl]));
    for (const image of images) {
        const url = urls.get(image.dataset.listPhoto);
        if (!url) continue;
        image.dataset.photoSigned = 'true';
        const picture = image.parentElement;
        image.src = url;
        picture?.style.removeProperty('display');
    }
}

export function renderMajorArticles(contents, entries) {
    let list = contents.querySelector('aside .major-art-wrap');
    if (!list) {
        const aside = document.createElement('aside');
        aside.setAttribute('aria-label', '주요 기사');
        const groups = document.createElement('ul');
        const group = document.createElement('li');
        const heading = document.createElement('h3');
        heading.textContent = '주요 기사';
        list = document.createElement('ul');
        list.className = 'list major-art-wrap m-major';
        group.append(heading, list);
        groups.append(group);
        aside.append(groups);
        contents.append(aside);
    }
    const rows = entries.slice(0, 5).map(entry => {
        const row = document.createElement('li');
        const card = document.createElement('article');
        const copy = document.createElement('div');
        const link = document.createElement('a');
        link.href = entry.href;
        setArticleTitle(link, entry.title, entry.article_label);
        copy.append(link);
        card.append(articleListPicture(entry), copy);
        row.append(card);
        return row;
    });
    if (!rows.length) {
        const empty = document.createElement('li');
        empty.textContent = '등록된 주요 기사가 없습니다.';
        rows.push(empty);
    }
    list.replaceChildren(...rows);
}
