import { categoryFromURL, categoryPath } from './routes.js?v=direct-route-1';

const url = new URL(location.href);
const sector = url.pathname.split('/')[1];
const category = categoryFromURL(sector);
if (category) {
    url.searchParams.delete('category');
    url.pathname = categoryPath(sector, category);
    if (location.href !== url.href) history.replaceState(null, '', url.href);
    const canonical = document.querySelector('link[rel="canonical"]') || document.createElement('link');
    canonical.rel = 'canonical';
    canonical.href = new URL(url.pathname, location.origin).href;
    document.head.append(canonical);
}
