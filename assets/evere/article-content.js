import { supabase } from './supabase.js';

export const photoBucket = supabase.storage.from('evere-article-photos');
const allowed = new Set(['P', 'DIV', 'BR', 'H2', 'H3', 'STRONG', 'B', 'EM', 'I', 'U',
    'S', 'STRIKE', 'UL', 'OL', 'LI', 'BLOCKQUOTE']);

export function formattedBody(html) {
    const template = document.createElement('template');
    template.innerHTML = html;
    const copy = (node, target) => {
        if (node.nodeType === Node.TEXT_NODE) {
            target.append(document.createTextNode(node.data));
        } else if (allowed.has(node.tagName)) {
            const child = document.createElement(node.tagName.toLowerCase());
            for (const item of node.childNodes) copy(item, child);
            target.append(child);
        } else if (node.tagName === 'SPAN') {
            for (const item of node.childNodes) copy(item, target);
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

export async function renderPhotos(target, paths) {
    target.replaceChildren();
    if (!paths?.length) return;
    const { data } = await photoBucket.createSignedUrls(paths, 3600);
    target.replaceChildren(...(data || []).filter(({ signedUrl }) => signedUrl)
        .map(({ signedUrl }) => photoImage(signedUrl)));
}
