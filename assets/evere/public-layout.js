import { articlePath, categoryFromURL } from './routes.js?v=routes-1';
import { supabase } from './supabase.js';

const script = document.querySelector('script[data-layout-page]');
const page = script.dataset.layoutPage;
const category = script.dataset.layoutCategory ?? categoryFromURL(page);
const main = document.querySelector('main .wrap');

async function showPlacements() {
    if (!main || category.length > 64) return;
    const { data, error } = await supabase.from('evere_page_slots')
        .select('slot,evere_articles(id,article_number,title,body,status,sector,category)')
        .eq('page', page).eq('category', category).order('slot');
    if (error || !data.length) return;
    const articles = data.map((row) => row.evere_articles).filter((article) =>
        article?.status === 'published' &&
        (page === 'home' || article.sector === page) &&
        (!category || article.category === category)
    );
    if (!articles.length) return;

    const block = document.createElement('div');
    block.className = 'evere-front-placements';
    const heading = document.createElement('h2');
    heading.textContent = '주요 기사';
    const list = document.createElement('ul');
    for (const article of articles) {
        const item = document.createElement('li');
        const link = document.createElement('a');
        link.href = articlePath(article);
        link.textContent = article.title;
        const summary = document.createElement('p');
        summary.textContent = article.body.slice(0, 120);
        item.append(link, summary);
        list.append(item);
    }
    block.append(heading, list);
    const tabs = main.querySelector('.child-section');
    if (tabs) tabs.after(block);
    else main.prepend(block);
}

showPlacements().catch(() => {});

