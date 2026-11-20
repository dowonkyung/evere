import { supabase } from './supabase.js';

export const photoBucket = supabase.storage.from('evere-article-photos');
const allowed = new Set(['P', 'DIV', 'BR', 'H2', 'H3', 'STRONG', 'B', 'EM', 'I', 'U',
    'S', 'STRIKE', 'UL', 'OL', 'LI', 'BLOCKQUOTE', 'SPAN', 'FONT']);
const alignments = new Set(['left', 'center', 'right', 'justify']);
const fontSizes = ['', '10px', '13px', '16px', '18px', '24px', '32px', '48px'];
const colors = /^(?:#[\da-f]{3,8}|rgba?\([\d.,% /]+\))$/i;
const photoKey = /^(?:local-)?[a-f\d-]{36}(?:\/[a-f\d-]{36}\.(?:jpg|png|webp))?$/;

export function photoFigure(key, position, caption) {
    const figure = document.createElement('figure');
    figure.dataset.photo = key;
    figure.dataset.position = ['left', 'center', 'right'].includes(position) ? position : 'center';
    const label = document.createElement('figcaption');
    label.textContent = caption.slice(0, 500);
    figure.append(label);
    return figure;
}

export function formattedBody(html) {
    const template = document.createElement('template');
    template.innerHTML = html;
    const copy = (node, target) => {
        if (node.nodeType === Node.TEXT_NODE) {
            target.append(document.createTextNode(node.data));
        } else if (node.tagName === 'FIGURE' && photoKey.test(node.dataset.photo || '')) {
            target.append(photoFigure(node.dataset.photo, node.dataset.position,
                node.querySelector('figcaption')?.textContent || ''));
        } else if (allowed.has(node.tagName)) {
            const child = document.createElement(node.tagName === 'FONT' ? 'span' : node.tagName.toLowerCase());
            const alignment = node.style.textAlign || node.getAttribute('align');
            if (alignments.has(alignment)) child.style.textAlign = alignment;
            const color = node.style.color || node.getAttribute('color') || '';
            if (colors.test(color)) child.style.color = color;
            const size = node.style.fontSize || (node.tagName === 'FONT' ? fontSizes[Number(node.getAttribute('size'))] : '');
            if (size && fontSizes.includes(size)) child.style.fontSize = size;
            for (const item of node.childNodes) copy(item, child);
            target.append(child);
        }
    };
    const fragment = document.createDocumentFragment();
    for (const node of template.content.childNodes) copy(node, fragment);
    return fragment;
}

export function renderBody(target, article) {
    const content = formattedBody(article.body_html || '');
    target.replaceChildren(content.textContent.trim() ? content : article.body || '');
}

export function photoImage(src, description = '기사 첨부 사진') {
    const image = document.createElement('img');
    image.src = src;
    image.alt = description;
    image.loading = 'lazy';
    return image;
}

export function placePhotoImages(body, target, urls) {
    const placed = new Set();
    for (const figure of body?.querySelectorAll('figure[data-photo]') || []) {
        const key = figure.dataset.photo;
        placed.add(key);
        figure.querySelector('img')?.remove();
        if (urls.get(key)) figure.prepend(photoImage(urls.get(key), figure.textContent.trim() || undefined));
    }
    target.replaceChildren(...Array.from(urls)
        .filter(([key, src]) => src && !placed.has(key)).map(([, src]) => photoImage(src)));
}

export async function renderPhotos(target, paths, body) {
    target.replaceChildren();
    if (!paths?.length) return;
    const { data } = await photoBucket.createSignedUrls(paths, 3600);
    placePhotoImages(body, target, new Map((data || []).map(({ path, signedUrl }) => [path, signedUrl])));
}
