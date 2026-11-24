import { articleCategories } from './article-taxonomy.js?v=wiki-culture-1';

export function articlePath(article) {
    const number = Number(article.article_number);
    if (!Number.isSafeInteger(number) || number < 1) throw new Error('Missing article number');
    return '/article/' + number;
}

export function categoryPath(sector, category = '') {
    if (!Object.hasOwn(articleCategories, sector)) throw new Error('Unknown section');
    if (category && !articleCategories[sector].some(([key]) => key === category)) throw new Error('Unknown category');
    return '/' + sector + (category ? '/' + category + '/' : '/');
}

export function articleNumberFromURL(href = location.href) {
    const url = new URL(href);
    const match = /^\/article\/([1-9]\d*)\/?$/.exec(url.pathname);
    const candidate = match?.[1] ?? (/^\/article\/(?:index\.html)?$/.test(url.pathname) ? url.searchParams.get('number') : null);
    if (!/^[1-9]\d*$/.test(candidate ?? '')) return null;
    const number = Number(candidate);
    return Number.isSafeInteger(number) ? number : null;
}

export function categoryFromURL(sector, href = location.href) {
    const url = new URL(href);
    const segments = url.pathname.split('/').filter(Boolean);
    const candidate = segments[0] === sector && segments[1] && segments[1] !== 'index.html'
        ? segments[1] : url.searchParams.get('category');
    return (articleCategories[sector] || []).some(([key]) => key === candidate) ? candidate : '';
}

export function routeTemplate(pathname) {
    if (articleNumberFromURL('https://evere.invalid' + pathname)) return '/article/index.html';
    const match = /^\/([a-z-]+)\/([a-z-]+)\/?$/.exec(pathname);
    if (!match || !(articleCategories[match[1]] || []).some(([key]) => key === match[2])) return null;
    return match[1] === 'opinion' ? '/opinion/' + match[2] + '/index.html' : '/' + match[1] + '/index.html';
}
