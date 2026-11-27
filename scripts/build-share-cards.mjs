import { parseHTML } from 'linkedom';
import { articleExcerpt } from '../assets/evere/article-excerpt.js';
import { createHash } from 'node:crypto';
import { copyFile, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';

const { document } = parseHTML('<!doctype html><html><body></body></html>');
const root = resolve(process.argv[2] || '_site');
const origin = 'https://evere.saevit.online';
const logo = '/assets/evere/share-default.png';
const siteDescription = '양심 있는 세상을 만드는 언론, 세계 최초 창업(주) 언론 이브레입니다.';
const client = await readFile(join(root, 'assets/evere/supabase.js'), 'utf8');
const [, api, key] = client.match(/createClient\(['"](https:\/\/[^'"]+)['"],\s*['"](sb_publishable_[^'"]+)['"]/);
const headers = { apikey: key };
const taxonomy = await readFile(join(root, 'assets/evere/article-taxonomy.js'), 'utf8');
const { articleCategories, sectors } = await import('data:text/javascript,' + encodeURIComponent(taxonomy));
const opinionCategories = new Map(articleCategories.opinion);

async function request(url, options) {
    for (let attempt = 0; attempt < 3; attempt++) {
        const response = await fetch(url, { ...options, signal: AbortSignal.timeout(20000) });
        if (response.ok || (response.status < 500 && response.status !== 429)) return response;
    }
    throw new Error('Request failed after retries: ' + new URL(url).pathname);
}

async function rows(table, params) {
    const output = [];
    const size = 200;
    for (let offset = 0; ; offset += size) {
        const query = new URLSearchParams({ ...params, limit: size, offset });
        const response = await request(api + '/rest/v1/' + table + '?' + query, { headers });
        if (!response.ok) throw new Error(table + ' returned ' + response.status + ': ' + await response.text());
        const batch = await response.json();
        output.push(...batch);
        if (batch.length < size) return output;
    }
}

function escape(text) {
    const entities = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
    return String(text).replace(/[&<>"']/g, char => entities[char]);
}

function normalize(text) {
    return String(text ?? '').replace(/[\s\u200b]+/gu, ' ').trim();
}

function pageTitle(html) {
    const title = html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1] || '이브레';
    const unescaped = title.replace(/&(amp|lt|gt|quot|apos|#39);/g,
        (_, entity) => ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", '#39': "'" })[entity]);
    return normalize(unescaped).replace(/\s+\|\s+이브레$/, '');
}

function card(html, path, { title = pageTitle(html), description = siteDescription, image = logo, type = 'website' } = {}) {
    const url = new URL(path, origin).href;
    const thumbnail = new URL(image, origin).href;
    const fields = {
        'og:type': type, 'og:locale': 'ko_KR', 'og:site_name': '이브레',
        'og:url': url, 'og:title': title, 'og:description': description, 'og:image': thumbnail,
        'og:image:alt': image === logo ? '이브레 로고' : title,
    };
    if (image === logo) Object.assign(fields, { 'og:image:width': '1600', 'og:image:height': '837' });
    const twitter = { 'twitter:card': 'summary_large_image', 'twitter:title': title,
        'twitter:description': description, 'twitter:image': thumbnail, 'twitter:image:alt': fields['og:image:alt'] };
    const tags = [
        ...Object.entries(fields).map(([name, value]) => '<meta property="' + name + '" content="' + escape(value) + '">'),
        ...Object.entries(twitter).map(([name, value]) => '<meta name="' + name + '" content="' + escape(value) + '">'),
    ];
    return html.replace(/<meta\b(?=[^>]*\b(?:name|property)=["'](?:og:|twitter:))[^>]*>\s*/gi, '')
        .replace(/<\/head>/i, () => '  ' + tags.join('\n  ') + '\n</head>');
}

async function inject(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
        const file = join(directory, entry.name);
        if (entry.isDirectory()) {
            if (!['assets', 'downloads', 'supabase'].includes(entry.name)) await inject(file);
        } else if (entry.name.endsWith('.html') && entry.name !== '404.html') {
            const html = await readFile(file, 'utf8');
            if (!/<\/head>/i.test(html)) continue;
            const path = '/' + relative(root, file).replaceAll('\\', '/').replace(/(^|\/)index\.html$/, '$1');
            await writeFile(file, card(html, path));
        }
    }
}

async function writePage(path, template, settings) {
    const file = join(root, path, 'index.html');
    const title = escape(settings.title + ' | 이브레');
    const html = template.replace(/<title\b[^>]*>[\s\S]*?<\/title>/i, () => '<title>' + title + '</title>');
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, card(html, path, settings));
}

function articleTitle(article) {
    let title = normalize(article.title);
    const label = { breaking: '속보', exclusive: '단독' }[article.article_label];
    if (label && !title.startsWith('[' + label + ']')) title = '[' + label + '] ' + title;
    const corner = article.sector === 'opinion'
        ? normalize(article.evere_series?.title) || opinionCategories.get(article.category) : '';
    if (corner && !title.startsWith('[' + corner + ']')) title = '[' + corner + '] ' + title;
    return title;
}

async function inBatches(items, size, process) {
    for (let offset = 0; offset < items.length; offset += size) {
        await Promise.all(items.slice(offset, offset + size).map(process));
    }
}

async function storeThumbnails(articles) {
    const paths = [...new Set(articles.map(article => article.photo_paths?.[0]).filter(path =>
        /^[a-f\d-]{36}\/[a-f\d-]{36}\.(?:jpg|png|webp)$/i.test(path ?? '')))];
    const outputPath = '/assets/evere/share/';
    const destination = join(root, outputPath);
    const cache = process.env.EVERE_THUMBNAIL_CACHE;
    await mkdir(destination, { recursive: true });
    if (cache) await mkdir(cache, { recursive: true });
    const cachedNames = new Set(cache ? await readdir(cache) : []);
    const images = new Map();
    const names = new Map(paths.map(path => [
        path, createHash('sha256').update(path).digest('hex').slice(0, 24) + '.' + path.split('.').at(-1),
    ]));
    await inBatches(paths, 32, async path => {
        const name = names.get(path);
        if (!cachedNames.has(name)) return;
        await copyFile(join(cache, name), join(destination, name));
        images.set(path, outputPath + name);
    });

    const missing = paths.filter(path => !images.has(path));
    const bucket = '/storage/v1/object/sign/evere-article-photos';
    for (let offset = 0; offset < missing.length; offset += 50) {
        const response = await request(api + bucket, { method: 'POST', headers: { ...headers,
            'content-type': 'application/json' }, body: JSON.stringify({ paths: missing.slice(offset, offset + 50), expiresIn: 600 }) });
        if (!response.ok) throw new Error('Photo signing failed: ' + response.status + ': ' + await response.text());
        const signed = await response.json();
        await inBatches(signed, 12, async ({ path, signedURL }) => {
            if (!names.has(path) || !signedURL?.startsWith('/object/sign/evere-article-photos/')) return;
            const media = await request(api + '/storage/v1' + signedURL);
            if (!media.ok || !/^image\/(?:jpeg|png|webp)\b/i.test(media.headers.get('content-type') || '')) return;
            const name = names.get(path);
            const bytes = Buffer.from(await media.arrayBuffer());
            await writeFile(join(destination, name), bytes);
            if (cache) await writeFile(join(cache, name), bytes);
            images.set(path, outputPath + name);
        });
    }
    console.log('Reused ' + (paths.length - missing.length) + ' thumbnails and fetched ' +
        (images.size - paths.length + missing.length) + ' new ones.');
    return images;
}

const fingerprintPath = '/assets/evere/share-card-revision.txt';
const [articleRevisions, series, issues] = await Promise.all([
    rows('evere_articles', {
        select: 'article_number,published_at,modified_at',
        status: 'eq.published', article_number: 'not.is.null', order: 'article_number',
    }),
    rows('evere_series', { select: 'series_number,title', series_number: 'not.is.null', order: 'series_number' }),
    rows('evere_issues', { select: 'issue_number,title', order: 'issue_number' }),
]);
const fingerprint = createHash('sha256').update(JSON.stringify([articleRevisions, series, issues])).digest('hex');

if (process.argv.includes('--check')) {
    const deployed = await request(origin + fingerprintPath + '?check=' + Date.now()).catch(() => null);
    const unchanged = deployed?.ok && (await deployed.text()).trim() === fingerprint;
    console.log(unchanged ? 'false' : 'true');
    process.exit(0);
}

const articles = await rows('evere_articles', {
    select: 'id,article_number,title,article_label,sector,category,body,body_html,photo_paths,print_issue,print_page,byline,evere_series(title)',
    status: 'eq.published', article_number: 'not.is.null', order: 'article_number',
});
await inject(root);
const articleTemplate = await readFile(join(root, 'article/index.html'), 'utf8');
const thumbnails = await storeThumbnails(articles);
await inBatches(articles, 12, async article => {
    if (!Number.isSafeInteger(article.article_number) || article.article_number < 1) return;
    await writePage('/article/' + article.article_number, articleTemplate, { title: articleTitle(article),
        description: articleExcerpt(article, 150, { ellipsis: true, document }) || siteDescription, image: thumbnails.get(article.photo_paths?.[0]) || logo,
        type: 'article' });
});
const seriesTemplate = await readFile(join(root, 'series/articles/index.html'), 'utf8');
await inBatches(series, 12, async entry => {
    if (!Number.isSafeInteger(entry.series_number) || entry.series_number < 1) return;
    const path = '/series/articles/' + entry.series_number;
    const template = await readFile(join(root, path, 'index.html'), 'utf8').catch(error => {
        if (error.code !== 'ENOENT') throw error;
        return seriesTemplate;
    });
    await writePage(path, template, { title: entry.title });
});
const issueTemplate = await readFile(join(root, 'issue/articles/index.html'), 'utf8');
await inBatches(issues, 12, entry =>
    writePage('/issue/articles/' + entry.issue_number, issueTemplate, { title: entry.title }));

for (const [sector, categories] of Object.entries(articleCategories)) {
    const base = await readFile(join(root, sector, 'index.html'), 'utf8').catch(error => {
        if (error.code !== 'ENOENT') throw error;
        return null;
    });
    if (!base || sector === 'opinion') continue;
    for (const [slug, title] of categories) {
        const path = '/' + sector + '/' + slug;
        const template = await readFile(join(root, path, 'index.html'), 'utf8').catch(error => {
            if (error.code !== 'ENOENT') throw error;
            return base;
        });
        await writePage(path, template, { title: sectors[sector] + ' · ' + title });
    }
}
const reporterTemplate = await readFile(join(root, 'reporter/index.html'), 'utf8');
const knownAuthors = new Set();
const reporterArticles = articles.filter(article => {
    const byline = article.byline || [];
    if (!byline.some(id => !knownAuthors.has(id))) return false;
    byline.forEach(id => knownAuthors.add(id));
    return true;
});
const reporters = new Map();
await inBatches(reporterArticles, 8, async article => {
    const cards = await rows('rpc/evere_article_reporter_cards', { target_article: article.id });
    for (const card of cards) {
        if (Number.isSafeInteger(card.reporter_number) && card.reporter_number > 0) {
            reporters.set(card.reporter_number, card.display_name);
        }
    }
});
await inBatches([...reporters], 12, ([number, name]) =>
    writePage('/reporter/' + number, reporterTemplate, { title: name + ' | 기자' }));

const epaperTemplate = await readFile(join(root, 'epaper/index.html'), 'utf8');
const editions = JSON.parse(await readFile(join(root, 'epaper/editions.json'), 'utf8')).editions;
const printPages = new Map();
for (const { issue, pageCount } of editions) {
    if (!Number.isSafeInteger(issue) || issue < 1) continue;
    printPages.set(issue, new Set(Array.from({ length: Math.min(pageCount || 1, 300) }, (_, index) => index + 1)));
}
for (const { print_issue: issue, print_page: page } of articles) {
    if (!Number.isSafeInteger(issue) || issue < 1) continue;
    if (!printPages.has(issue)) printPages.set(issue, new Set([1]));
    if (Number.isSafeInteger(page) && page > 0) printPages.get(issue).add(page);
}
for (const [issue, pages] of printPages) {
    const path = '/epaper/' + issue;
    const title = '이브레 ' + issue + '호 지면보기';
    await writePage(path, epaperTemplate, { title });
    await inBatches([...pages], 12, page =>
        writePage(path + '/' + page, epaperTemplate, { title: title + ' · ' + page + '면' }));
}
await writeFile(join(root, fingerprintPath), fingerprint + '\n');
console.log('Generated ' + articles.length + ' article cards, ' + series.length + ' series cards, and ' + thumbnails.size + ' article thumbnails.');
