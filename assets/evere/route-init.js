import { categoryFromURL, categoryPath } from './routes.js?v=routes-1';

const url = new URL(location.href);
const sector = url.pathname.split('/')[1];
const category = categoryFromURL(sector);
if (category) {
    const path = categoryPath(sector, category);
    const legacy = url.searchParams.has('category');
    url.searchParams.delete('category');
    url.pathname = path;
    if (legacy && location.pathname.replace(/\/$/, '') !== path) {
        location.replace(url.href);
    } else {
        if (location.href !== url.href) history.replaceState(null, '', url.href);
        const canonical = document.querySelector('link[rel="canonical"]') || document.createElement('link');
        canonical.rel = 'canonical';
        canonical.href = new URL(path, location.origin).href;
        document.head.append(canonical);
    }
}
