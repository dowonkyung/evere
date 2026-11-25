import { showPress } from './newsroom-press.js?v=5';
import { configureHomeVisualEditor } from './newsroom-home-layout.js?v=opinion-visual-1';
import { categoryPath } from './routes.js?v=wiki-culture-1';
import { supabase } from './supabase.js';
import { sectors, articleCategories } from './article-taxonomy.js?v=wiki-culture-1';
import { seriesFor } from './series.js?v=numbered-link-1';
import { loadBottomLinks } from './home-bottom-links.js';
import { issueUrl, loadHomeIssues } from './home-issues.js?v=issues-1';

const ui = (id) => document.getElementById(id);
const panels = [...document.querySelectorAll('[data-panel]')];
const nav = [...document.querySelectorAll('.newsroom-nav [data-view]')];
const navToggle = ui('newsroom-nav-toggle');
const navPreference = 'evere-newsroom-nav-compact';
function setCompactNav(compact) {
    ui('workspace').classList.toggle('has-compact-nav', compact);
    navToggle.setAttribute('aria-pressed', String(compact));
    const label = compact ? '메뉴 너비 늘리기' : '메뉴 너비 줄이기';
    navToggle.title = label;
    navToggle.setAttribute('aria-label', label);
}
if (navToggle) {
    try { setCompactNav(localStorage.getItem(navPreference) === 'true'); } catch {}
    navToggle.onclick = () => {
        const compact = navToggle.getAttribute('aria-pressed') !== 'true';
        setCompactNav(compact);
        try { localStorage.setItem(navPreference, String(compact)); } catch {}
    };
}
const layout = ui('layout-form');
const layoutSubmit = layout.querySelector('[type="submit"]');
const slots = [...ui('layout-slots').querySelectorAll('select')];
const showHomeVisualEditor = configureHomeVisualEditor(() => {
    const { page, category } = layout.elements;
    return page.value === 'home' || (page.value === 'opinion' && !category.value) ? page.value : '';
}, openHomeIssues);

function sectionHeadLayout(page, category) {
    return page !== 'home' && page !== 'opinion' && category === '';
}

function configureLayoutSlots(page, category) {
    const sectionHead = sectionHeadLayout(page, category);
    const heading = page === 'home' ? '메인 기사 배치' : sectionHead ? '섹션 헤드 기사' : '기사 배치';
    ui('layout-slot-heading').textContent = heading;
    const labels = page === 'home' ? ['대표 헤드라인', '보조 헤드라인 1', '보조 헤드라인 2', '하단 대표 기사', '하단 보조 기사 1', '하단 보조 기사 2', '하단 보조 기사 3', '하단 마지막 기사']
        : sectionHead ? ['대표 기사', '보조 기사 1', '보조 기사 2', '보조 기사 3', '보조 기사 4']
            : ['첫 번째 기사', '두 번째 기사', '세 번째 기사'];
    slots.forEach((select, index) => {
        const label = select.closest('label');
        label.hidden = index >= labels.length;
        select.disabled = true;
        if (!label.hidden) select.previousElementSibling.textContent = labels[index];
    });
    return slots.slice(0, labels.length);
}
const seriesForm = ui('series-form');
const issuesForm = ui('home-issues-form');
const issuesDialog = ui('home-issues-dialog');
let issuesSaving = false;
let linkArea = '';
const issuesFields = ui('home-issues-fields');
let issuesRequest = 0;
let member = null;
let layoutRequest = 0;

function notify(text, failed = false) {
    const status = ui('status');
    status.textContent = text;
    status.dataset.error = String(failed);
}

function value(response) {
    if (response.error) throw response.error;
    return response.data;
}

function task(fn) {
    return async (event) => {
        event.preventDefault();
        const button = event.submitter || (event.currentTarget instanceof HTMLButtonElement ? event.currentTarget : null);
        if (button) button.disabled = true;
        try {
            await fn(event);
        } catch (error) {
            notify(error.code === '42501' ? '이 작업을 수행할 권한이 없습니다.' : '저장 또는 조회에 실패했습니다. 다시 시도해 주세요.', true);
        } finally {
            if (button) button.disabled = false;
        }
    };
}

function optionList(select, entries, selected = '') {
    select.replaceChildren(...entries.map(([key, label]) => new Option(label, key, false, key === selected)));
}

function editablePages() {
    if (member?.role === 'owner' || member?.role === 'director') return [['home', '메인페이지'], ...Object.entries(sectors).filter(([key]) => !['notice', 'corrections'].includes(key))];
    if (member?.role === 'department_head') return Object.entries(sectors).filter(([key]) => !['notice', 'corrections'].includes(key) && member.sectors.includes(key));
    return [];
}

function selectView() {
    if (!member) return;
    const requested = location.hash.slice(1) || 'overview';
    const view = nav.some((link) => link.dataset.view === requested && !link.hidden) ? requested : 'overview';
    for (const panel of panels) panel.hidden = panel.dataset.panel !== view;
    for (const link of nav) {
        if (link.dataset.view === view) link.setAttribute('aria-current', 'page');
        else link.removeAttribute('aria-current');
    }
    if (view === 'press') showPress(member);
    if (view === 'profile') ui('profile-settings').open = true;

    if (view === 'layout') loadLayout().catch(() => notify('화면 배치를 불러오지 못했습니다.', true));
    if (view === 'series') loadSeries().catch(() => notify('기획·연재 분류를 불러오지 못했습니다.', true));
}

document.addEventListener('evere:member', (event) => {
    member = event.detail;
    const allowed = editablePages();
    for (const link of document.querySelectorAll('a[data-editor]')) link.hidden = allowed.length === 0;
    for (const link of document.querySelectorAll('a[data-owner]')) link.hidden = member?.role !== 'owner';
    optionList(layout.elements.page, allowed, layout.elements.page.value);
    optionList(seriesForm.elements.sector, allowed.filter(([key]) => key !== 'home'), seriesForm.elements.sector.value);
    resetCategories();

    if (member) selectView();
});
window.addEventListener('hashchange', selectView);

let seriesRequest = 0;
async function loadSeries() {
    const request = ++seriesRequest;
    const sector = seriesForm.elements.sector.value;
    const rows = await seriesFor(sector);
    if (request !== seriesRequest) return;
    const items = rows.map(({ id, title, series_number }) => {
        const item = document.createElement('li');
        const label = document.createElement('span');
        label.textContent = `${series_number}번 · ${title}`;
        const form = document.createElement('form');
        form.hidden = true;
        const name = document.createElement('input');
        name.required = true;
        name.maxLength = 100;
        name.setAttribute('aria-label', '새 기획·연재 분류명');
        const save = document.createElement('button');
        save.textContent = '저장';
        const rename = button('이름 수정', () => {
            name.value = title;
            form.hidden = false;
            rename.hidden = true;
            name.focus();
        });
        form.append(name, save, button('취소', () => {
            form.hidden = true;
            rename.hidden = false;
            rename.focus();
        }));
        form.addEventListener('submit', task(async () => {
            const next = name.value.trim();
            if (!next) { notify('기획·연재 분류명을 입력해 주세요.', true); return; }
            const { error } = await supabase.from('evere_series').update({ title: next }).eq('id', id).select('id').single();
            if (error?.code === '23505') { notify('이 섹터에 같은 이름의 분류가 있습니다.', true); return; }
            if (error) throw error;
            label.textContent = `${series_number}번 · ${next}`;
            document.dispatchEvent(new CustomEvent('evere:series-change', { detail: sector }));
            notify(`기획·연재 ${series_number}번의 이름을 저장했습니다.`);
            await loadSeries();
        }));
        item.append(label, ' ', rename, form);
        return item;
    });
    if (!items.length) {
        const empty = document.createElement('li');
        empty.textContent = '등록된 분류가 없습니다.';
        items.push(empty);
    }
    ui('series-list').replaceChildren(...items);
}

seriesForm.elements.sector.addEventListener('change', () => {
    loadSeries().catch(() => notify('기획·연재 분류를 불러오지 못했습니다.', true));
});
seriesForm.addEventListener('submit', task(async () => {
    const sector = seriesForm.elements.sector.value;
    const title = seriesForm.elements.title.value.trim();
    if (!title) { notify('기획·연재 분류명을 입력해 주세요.', true); return; }
    const { data, error } = await supabase.from('evere_series').insert({ sector, title })
        .select('series_number').single();
    if (error?.code === '23505') { notify('이 섹터에 같은 이름의 분류가 있습니다.', true); return; }
    if (error) throw error;
    seriesForm.elements.title.value = '';
    document.dispatchEvent(new CustomEvent('evere:series-change', { detail: sector }));
    const created = `기획·연재 ${data.series_number}번을 만들었습니다.`;
    notify(created);
    await loadSeries().catch(() => notify(created + ' 목록을 갱신하지 못했습니다.', true));
}));

function resetCategories() {
    const page = layout.elements.page.value;
    optionList(layout.elements.category, [['', '전체'], ...(articleCategories[page] || [])]);
    layout.elements.category.disabled = page === 'home';
    configureLayoutSlots(page, layout.elements.category.value);
}

function publicPage(page, category) {
    if (page === 'home') return '../';
    return categoryPath(page, category);
}

async function loadLayout() {
    const page = layout.elements.page.value;
    const category = layout.elements.category.value;
    if (!page) return;
    const request = ++layoutRequest;
    layoutSubmit.disabled = true;
    const isVisual = page === 'home' || (page === 'opinion' && !category);
    ui('layout-slots').hidden = isVisual;
    layoutSubmit.hidden = isVisual;
    showHomeVisualEditor(isVisual ? page : '');
    if (isVisual) {
        ui('public-page').href = publicPage(page, category);
        return;
    }
    const activeSlots = configureLayoutSlots(page, category);
    ui('public-page').href = publicPage(page, category);
    let articles = supabase.from('evere_articles').select('id,title').eq('status', 'published');
    if (page !== 'home') articles = articles.eq('sector', page);
    if (category) articles = articles.eq('category', category);
    const [savedResult, articlesResult] = await Promise.all([
        supabase.from('evere_page_slots').select('slot,article_id,evere_articles(id,title,status,sector,category)')
            .eq('page', page).eq('category', category).order('slot'),
        articles.order('published_at', { ascending: false }).limit(100),
    ]);
    if (request !== layoutRequest) return;
    const saved = value(savedResult);
    const choices = new Map(value(articlesResult).map((article) => [article.id, article.title]));
    for (const { evere_articles: article } of saved) {
        if (article?.status === 'published' && (page === 'home' || article.sector === page) &&
            (!category || article.category === category)) choices.set(article.id, article.title);
    }
    activeSlots.forEach((select, i) => {
        const current = saved.find((item) => item.slot === i + 1)?.article_id;
        optionList(select, [['', '배치하지 않음'], ...choices], choices.has(current) ? current : '');
        select.disabled = false;
    });
    layoutSubmit.disabled = false;
}
layout.elements.page.addEventListener('change', () => {
    resetCategories();
    loadLayout().catch(() => notify('화면 배치를 불러오지 못했습니다.', true));
});
layout.elements.category.addEventListener('change', () => {
    loadLayout().catch(() => notify('화면 배치를 불러오지 못했습니다.', true));
});
layout.addEventListener('submit', task(async () => {
    if (layout.elements.page.value === 'home' || (layout.elements.page.value === 'opinion' && !layout.elements.category.value)) return;
    const articleIds = slots.filter((select) => !select.closest('label').hidden).map((select) => select.value || null);
    const populated = articleIds.filter(Boolean);
    if (new Set(populated).size !== populated.length) {
        notify('같은 기사는 한 위치에만 배치해 주세요.', true);
        return;
    }
    value(await supabase.rpc('evere_save_layout', {
        target_page: layout.elements.page.value,
        target_category: layout.elements.category.value,
        articles: articleIds,
    }));
    await loadLayout();
    notify('공개 페이지에 기사 배치를 저장했습니다.');
}));

function button(label, run) {
    const el = document.createElement('button');
    el.type = 'button';
    el.textContent = label;
    el.addEventListener('click', task(run));
    return el;
}

function issuesStatus(message, failed = false) {
    ui('home-issues-status').textContent = message;
    ui('home-issues-status').dataset.error = String(failed);
}

function issueEntries() {
    return [...ui('home-issues-rows').children].map((row) => ({
        label: row.querySelector('[name="issueLabel"]').value.trim(),
        url: row.querySelector('[name="issueUrl"]').value.trim(),
        description: row.querySelector('[name="issueDescription"]')?.value.trim() || '',
    }));
}

function addIssueRow(entry = { label: '', url: '' }) {
    const row = document.createElement('div');
    row.className = 'home-issue-row';
    for (const [name, title, field, maxLength] of [
        ['issueLabel', '표시 이름', 'label', 100],
        ['issueUrl', '링크 (https://… 또는 /경로)', 'url', 2048],
        ...(linkArea === 'service_cards' ? [['issueDescription', '설명', 'description', 240]] : []),
    ]) {
        const label = document.createElement('label');
        label.textContent = title;
        const input = document.createElement('input');
        input.name = name;
        input.value = entry[field] || '';
        input.required = field !== 'description';
        input.maxLength = maxLength;
        input.addEventListener('input', () => { input.setCustomValidity(''); });
        label.append(input);
        row.append(label);
    }
    row.append(button('삭제', () => {
        row.remove();
        ui('add-home-issue').focus();
    }));
    ui('home-issues-rows').append(row);
    return row;
}

async function openHomeIssues(area = '') {
    if (issuesDialog.open || !['owner', 'director'].includes(member?.role) || layout.elements.page.value !== 'home') return;
    const request = ++issuesRequest;
    linkArea = area;
    ui('home-issues-title').textContent = { event_links: '이벤트 링크', service_cards: '하단 바로가기' }[area] || '메인 이슈 링크';
    issuesFields.disabled = true;
    issuesDialog.showModal();
    issuesStatus('링크를 불러오는 중입니다.');
    try {
        const entries = await (linkArea ? loadBottomLinks(linkArea) : loadHomeIssues());
        if (request !== issuesRequest) return;
        ui('home-issues-rows').replaceChildren();
        entries.forEach(addIssueRow);
        issuesFields.disabled = false;
        issuesStatus('');
    } catch {
        if (request === issuesRequest) issuesStatus('링크를 불러오지 못했습니다. 팝업을 다시 열어 주세요.', true);
    }
}

issuesDialog.addEventListener('close', () => { issuesRequest++; });
issuesDialog.addEventListener('cancel', event => { if (issuesSaving) event.preventDefault(); });
issuesDialog.querySelector('form[method="dialog"]').addEventListener('submit', event => {
    if (issuesSaving) event.preventDefault();
});

ui('add-home-issue').addEventListener('click', () => {
    const row = addIssueRow();
    row.querySelector('input').focus();
});
issuesForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (issuesFields.disabled || !['owner', 'director'].includes(member?.role)) return;
    const entries = issueEntries();
    const rows = [...ui('home-issues-rows').children];
    for (const [index, entry] of entries.entries()) {
        const input = rows[index].querySelector(entry.label ? '[name="issueUrl"]' : '[name="issueLabel"]');
        if (!entry.label || !issueUrl(entry.url)) {
            input.setCustomValidity(entry.label ? 'http://, https:// 또는 /로 시작하는 올바른 링크를 입력해 주세요.' : '표시 이름을 입력해 주세요.');
            input.reportValidity();
            return;
        }
        entry.url = issueUrl(entry.url);
    }
    const request = issuesRequest;
    issuesFields.disabled = true;
    issuesSaving = true;
    issuesStatus('저장 중입니다.');
    try {
        value(await (linkArea
            ? supabase.rpc('evere_save_home_bottom_links', { target_area: linkArea, items: entries })
            : supabase.rpc('evere_save_home_issues', { items: entries })));
        if (request === issuesRequest) {
            issuesDialog.close();
            ui('home-preview').contentWindow.location.reload();
            notify('메인페이지에 링크를 저장했습니다.');
        }
    } catch {
        if (request === issuesRequest) issuesStatus('저장하지 못했습니다. 입력 내용은 유지됩니다. 다시 시도해 주세요.', true);
    } finally {
        issuesSaving = false;
        if (request === issuesRequest) issuesFields.disabled = false;
    }
});
