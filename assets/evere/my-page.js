import { supabase } from './supabase.js';
import { articlePath } from './routes.js?v=routes-1';
import { seriesLink } from './series.js';
import { collections } from './reader-collections.js';

const tabs = [...document.querySelectorAll('[data-my-tab]')];
const sections = [...document.querySelectorAll('[data-my-panel]')];
let account = null;
let request = 0;
let swiper;

function choose() {
    const key = location.hash.slice(1);
    const active = tabs.some(tab => tab.dataset.myTab === key) ? key : 'profile';
    for (const tab of tabs) {
        const current = tab.dataset.myTab === active;
        tab.classList.toggle('active', current);
        if (current) tab.setAttribute('aria-current', 'page');
        else tab.removeAttribute('aria-current');
    }
    for (const panel of sections) panel.hidden = panel.dataset.myPanel !== active;
    if (account && typeof Swiper === 'function') {
        if (!swiper) swiper = new Swiper('.account-main .swiper-container', { slidesPerView: 'auto', freeMode: true });
        swiper.update();
        swiper.slideTo(tabs.findIndex(tab => tab.dataset.myTab === active), 0);
    }
    const turn = ++request;
    if (account && active !== 'profile') void load(active, turn);
}

async function importDeviceSeries() {
    const prefix = 'evere:series-follow:';
    const keys = Object.keys(localStorage).filter(key => key.startsWith(prefix)
        && /^[1-9][0-9]{0,8}$/.test(key.slice(prefix.length)) && localStorage.getItem(key) === '1');
    for (const key of keys) {
        const { data } = await supabase.from('evere_series').select('id').eq('series_number', Number(key.slice(prefix.length))).maybeSingle();
        if (!data) continue;
        const { error } = await supabase.from(collections.series[0]).insert({ series_id: data.id });
        if (!error || error.code === '23505') localStorage.removeItem(key);
    }
}

const lists = {
    bookmarks: ['evere_articles(article_number,title)', 'evere_articles', articlePath, '북마크한 기사가 없습니다.'],
    series: ['evere_series(id,sector,title,series_number)', 'evere_series', row => seriesLink(row.sector,row.id,row.series_number), '구독한 기획·연재가 없습니다.'],
    reporters: ['evere_members!reporter_id(display_name)', 'evere_members', null, '구독한 기자가 없습니다.'],
};
async function loadList(kind, turn) {
    const list = document.querySelector('[data-my-list="' + kind + '"]');
    const [select, relation, href, empty] = lists[kind];
    const [table, key] = collections[kind];
    list.textContent = '불러오는 중입니다.';
    try {
        const rows = [];
        for (let offset = 0; ; offset += 200) {
            const { data, error } = await supabase.from(table).select(key + ',' + select)
                .order('created_at', { ascending: false }).order(key).range(offset, offset + 199);
            if (turn !== request) return;
            if (error) throw error;
            rows.push(...data);
            if (data.length < 200) break;
        }
        list.replaceChildren();
        for (const entry of rows) {
            const row = entry[relation];
            if (!row) continue;
            const item = document.createElement('li');
            const title = document.createElement(href ? 'a' : 'span');
            title.textContent = row.title || row.display_name;
            if (href) title.href = href(row);
            const remove = document.createElement('button');
            remove.type = 'button';
            remove.textContent = kind === 'bookmarks' ? '삭제' : '구독 취소';
            remove.addEventListener('click', async () => {
                remove.disabled = true;
                try {
                    const { error } = await supabase.from(table).delete().eq(key, entry[key]);
                    if (error) throw error;
                    item.remove();
                    if (!list.childElementCount) list.textContent = empty;
                } catch {
                    remove.disabled = false;
                    document.querySelector('#status').textContent = '변경하지 못했습니다. 다시 시도해 주세요.';
                }
            });
            item.append(title, remove);
            list.append(item);
        }
        if (!list.childElementCount) list.textContent = empty;
    } catch {
        if (turn === request) list.textContent = '목록을 불러오지 못했습니다.';
    }
}

async function load(active, turn) {
    if (active === 'subscriptions') {
        await importDeviceSeries().catch(() => {});
        if (turn === request) await Promise.all([loadList('series', turn), loadList('reporters', turn)]);
    } else await loadList('bookmarks', turn);
}

window.addEventListener('hashchange', choose);
document.addEventListener('evere:member', ({ detail }) => {
    account = detail;
    if (!account) for (const list of document.querySelectorAll('[data-my-list]')) list.replaceChildren();
    choose();
});
choose();
