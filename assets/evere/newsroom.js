import { loadMemorialCounts } from './home-memorial.js?v=2';
import { showPress } from './newsroom-press.js?v=press-plan-manage-2';
import { configureHomeVisualEditor } from './newsroom-home-layout.js?v=memorial-1';
import { categoryPath } from './routes.js?v=wiki-culture-1';
import { supabase } from './supabase.js';
import { sectors, articleCategories } from './article-taxonomy.js?v=wiki-culture-1';
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
}, openHomeIssues, openMemorialEditor);

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
const memorialDialog = ui('home-memorial-dialog');
const memorialForm = ui('home-memorial-form');
const memorialInputs = ['victim_count', 'revived_count'].map(name => memorialForm.elements[name]);
const memorialSave = memorialForm.querySelector('[type="submit"]');
let memorialRequest = 0;
let memorialSaving = false;

function memorialStatus(text, failed = false) {
    const status = ui('home-memorial-status');
    status.textContent = text;
    status.dataset.error = String(failed);
}

async function openMemorialEditor() {
    if (!['owner', 'director'].includes(member?.role) || memorialDialog.open) return;
    const request = ++memorialRequest;
    memorialForm.reset();
    memorialSave.disabled = true;
    for (const input of memorialInputs) input.disabled = true;
    memorialDialog.showModal();
    memorialStatus('집계를 불러오는 중입니다.');
    try {
        const counts = await loadMemorialCounts();
        if (request !== memorialRequest) return;
        for (const input of memorialInputs) {
            input.value = counts[input.name] ?? '';
            input.disabled = false;
        }
        memorialSave.disabled = false;
        memorialStatus('');
        memorialInputs[0].focus();
    } catch {
        if (request === memorialRequest) memorialStatus('집계를 불러오지 못했습니다. 다시 열어 주세요.', true);
    }
}

memorialDialog.addEventListener('close', () => { memorialRequest++; });
memorialDialog.addEventListener('cancel', event => { if (memorialSaving) event.preventDefault(); });
memorialDialog.querySelector('form[method="dialog"]').addEventListener('submit', event => {
    if (memorialSaving) event.preventDefault();
});
memorialForm.addEventListener('submit', async event => {
    event.preventDefault();
    if (memorialSave.disabled || !memorialForm.reportValidity() || !['owner', 'director'].includes(member?.role)) return;
    const counts = Object.fromEntries(memorialInputs.map(input => [input.name, input.value ? input.valueAsNumber : null]));
    memorialSaving = memorialSave.disabled = true;
    for (const input of memorialInputs) input.disabled = true;
    memorialStatus('저장 중입니다.');
    try {
        value(await supabase.from('evere_home_memorial').update(counts)
            .eq('id', true).select('victim_count,revived_count').single());
        memorialDialog.close();
        ui('home-preview').contentWindow.location.reload();
        notify('희생자 수를 저장했습니다.');
    } catch {
        memorialStatus('저장하지 못했습니다. 다시 시도해 주세요.', true);
    } finally {
        memorialSaving = memorialSave.disabled = false;
        for (const input of memorialInputs) input.disabled = false;
    }
});

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
    if (view === 'issues') loadManagedIssues().catch(() => notify('이슈 목록을 불러오지 못했습니다.', true));
    if (view === 'series') loadSeries().catch(() => notify('기획·연재 분류를 불러오지 못했습니다.', true));
}

document.addEventListener('evere:member', (event) => {
    member = event.detail;
    const allowed = editablePages();
    for (const link of document.querySelectorAll('a[data-editor]')) link.hidden = allowed.length === 0;
    for (const link of document.querySelectorAll('a[data-issue-editor]')) link.hidden = !canManageIssues();
    for (const link of document.querySelectorAll('a[data-owner]')) link.hidden = member?.role !== 'owner';
    optionList(layout.elements.page, allowed, layout.elements.page.value);
    optionList(seriesForm.elements.sector, allowed.filter(([key]) => key !== 'home'), seriesForm.elements.sector.value);
    resetCategories();

    if (member) selectView();
});
window.addEventListener('hashchange', selectView);

const issueManagementForm = ui('issue-management-form');
const issueManagementRows = ui('issue-management-rows');
const canManageIssues = () => ['owner', 'director'].includes(member?.role);
let managedIssueRequest = 0;

async function loadManagedIssues() {
    const request = ++managedIssueRequest;
    if (!canManageIssues()) return;
    const entries = value(await supabase.from('evere_issues')
        .select('issue_number,title,evere_articles(count)').order('issue_number'));
    if (request !== managedIssueRequest || !canManageIssues()) return;
    const rows = entries.map(issue => {
        const row = document.createElement('tr');
        row.insertCell().textContent = issue.issue_number;
        const title = row.insertCell();
        title.className = 'queue-title';
        title.textContent = issue.title;
        const count = issue.evere_articles?.[0]?.count ?? 0;
        row.insertCell().textContent = count.toLocaleString('ko-KR') + '건';
        return row;
    });
    if (!rows.length) {
        const row = document.createElement('tr');
        const empty = row.insertCell();
        empty.colSpan = 3;
        empty.className = 'queue-empty';
        empty.textContent = '등록된 이슈가 없습니다.';
        rows.push(row);
    }
    issueManagementRows.replaceChildren(...rows);
}

issueManagementForm.addEventListener('submit', task(async () => {
    if (!canManageIssues()) return;
    const input = issueManagementForm.elements.title;
    const title = input.value.trim();
    if (!title) { notify('이슈 이름을 입력해 주세요.', true); input.focus(); return; }
    const { error } = await supabase.from('evere_issues').insert({ title });
    if (error?.code === '23505') { notify('같은 이름의 이슈가 있습니다.', true); return; }
    if (error) throw error;
    issueManagementForm.reset();
    document.dispatchEvent(new CustomEvent('evere:issues-change'));
    notify('새 이슈를 등록했습니다.');
    await loadManagedIssues().catch(() => notify('이슈를 등록했습니다. 목록을 다시 불러오려면 화면을 다시 열어 주세요.', true));
}));

let seriesRequest = 0;
const editableSeriesSectors = () => editablePages().filter(([key]) => key !== 'home');

function seriesRow(entry, allowed) {
    const { id, sector, title, series_number } = entry;
    const count = entry.evere_articles?.[0]?.count ?? 0;
    const row = document.createElement('tr');
    const numberCell = row.insertCell();
    numberCell.textContent = String(series_number);
    const sectionCell = row.insertCell();
    const nameCell = row.insertCell();
    const countCell = row.insertCell();
    const actions = row.insertCell();
    const sectionLabel = document.createElement('span');
    sectionLabel.textContent = sectors[sector] || sector;
    const nameLabel = document.createElement('span');
    nameLabel.textContent = title;
    sectionCell.append(sectionLabel);
    nameCell.append(nameLabel);
    countCell.textContent = count.toLocaleString('ko-KR') + '건';

    const form = document.createElement('form');
    form.id = 'series-edit-' + id;
    form.hidden = true;
    const section = document.createElement('select');
    section.setAttribute('aria-label', '섹션');
    const name = document.createElement('input');
    name.setAttribute('aria-label', '기획·연재 이름');
    name.required = true;
    name.maxLength = 100;
    for (const field of [section, name]) {
        field.setAttribute('form', form.id);
        field.hidden = true;
    }
    sectionCell.append(section);
    nameCell.append(name);
    const save = document.createElement('button');
    save.type = 'submit';
    save.textContent = '저장';
    const edit = button('수정', () => {
        optionList(section, allowed, sector);
        name.value = title;
        setEditing(true);
        name.focus();
    });
    edit.setAttribute('aria-label', title + ' 수정');
    const cancel = button('취소', () => {
        setEditing(false);
        edit.focus();
    });
    function setEditing(editing) {
        sectionLabel.hidden = nameLabel.hidden = edit.hidden = editing;
        section.hidden = name.hidden = form.hidden = !editing;
    }
    form.append(save, cancel);
    actions.append(edit, form);
    form.addEventListener('submit', task(async () => {
        const nextTitle = name.value.trim();
        const nextSector = section.value;
        if (!nextTitle) { notify('기획·연재 이름을 입력해 주세요.', true); return; }
        const changingSector = nextSector !== sector;
        const warning = '연결된 기사도 새 섹션으로 이동하며 기존 2차 섹션은 해제됩니다. 계속할까요?';
        const confirmed = changingSector && count > 0;
        if (confirmed && !window.confirm(count + '건의 ' + warning)) return;
        const update = moveArticles => supabase.rpc('evere_update_series', {
            target: id, next_sector: nextSector, next_title: nextTitle, move_articles: moveArticles,
        });
        section.disabled = name.disabled = cancel.disabled = true;
        try {
            let { error } = await update(confirmed);
            if (error?.code === 'EV004') {
                if (!window.confirm(warning)) return;
                ({ error } = await update(true));
            }
            if (error?.code === '23505') { notify('이 섹션에 같은 이름의 기획·연재가 있습니다.', true); return; }
            if (error?.code === 'EV005') { notify('작성자가 없는 기사에 기자를 추가한 뒤 섹션을 옮겨 주세요.', true); return; }
            if (error) throw error;
            for (const affected of new Set([sector, nextSector])) {
                document.dispatchEvent(new CustomEvent('evere:series-change', { detail: affected }));
            }
            const saved = '기획·연재 ' + series_number + '번을 저장했습니다.';
            notify(saved);
            await loadSeries().catch(() => notify(saved + ' 목록을 갱신하지 못했습니다.', true));
        } finally {
            section.disabled = name.disabled = cancel.disabled = false;
        }
    }));
    return row;
}

async function loadSeries() {
    const request = ++seriesRequest;
    const allowed = editableSeriesSectors();
    if (!allowed.length) return;
    const entries = value(await supabase.from('evere_series')
        .select('id,sector,title,series_number,evere_articles(count)')
        .in('sector', allowed.map(([key]) => key)).order('series_number'));
    if (request !== seriesRequest) return;
    const rows = entries.map(entry => seriesRow(entry, allowed));
    if (!rows.length) {
        const row = document.createElement('tr');
        const cell = row.insertCell();
        cell.colSpan = 5;
        cell.className = 'queue-empty';
        cell.textContent = '등록된 기획·연재가 없습니다.';
        rows.push(row);
    }
    ui('series-list').replaceChildren(...rows);
}

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
