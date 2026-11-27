const nonBody = 'figure, figcaption, .photo-caption-title, .photo-caption-description, .article-subtitle, .editor-subtitle, script, style, template';
const breaks = 'br, p, div, li, blockquote, h1, h2, h3, h4, h5, h6';

export function articleExcerpt(article, limit, { ellipsis = false, document: dom = globalThis.document } = {}) {
    let text = article.body || '';
    if (article.body_html?.trim()) {
        const template = dom.createElement('template');
        template.innerHTML = article.body_html;
        const content = template.content;
        for (const node of content.querySelectorAll(nonBody)) node.remove();
        for (const node of content.querySelectorAll(breaks)) {
            node.before(' ');
            node.after(' ');
        }
        text = Array.from(content.childNodes, node => node.textContent).join('');
    }
    const characters = Array.from(text.replace(/[\s\u200b]+/gu, ' ').trim());
    if (characters.length <= limit) return characters.join('');
    const prefix = characters.slice(0, limit).join('').trimEnd();
    return ellipsis ? prefix + '…' : prefix;
}
