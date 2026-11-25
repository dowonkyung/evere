import { previewPath } from './press-preview-source.js?v=1';

import { supabase } from './supabase.js';

const byId = id => document.getElementById('press-' + id);
const store = supabase.storage.from('evere-press');
const plan = byId('plan');
const issueSelect = byId('issue');
const pageFilter = byId('page-filter');
const gallery = byId('gallery');
let generation = 0;
let issueGeneration = 0;
let issueDates = new Map();
let canFinalize = false;

function result(response) {
    if (response.error) throw response.error;
    return response.data;
}

function notify(message = '') {
    byId('status').textContent = message;
}

async function listIssues(preferred = issueSelect.value) {
    const request = ++issueGeneration;
    const rows = result(await supabase.from('evere_press_issues')
        .select('issue,publication_date,page_count').order('publication_date', { ascending: false }).order('issue', { ascending: false }));
    if (request !== issueGeneration) return;
    issueDates = new Map(rows.map(row => [String(row.issue), row.publication_date]));
    issueSelect.replaceChildren(...rows.map(row => new Option(
        row.issue + '호 · ' + row.publication_date + ' · ' + row.page_count + '면', row.issue
    )));
    if (rows.some(row => String(row.issue) === String(preferred))) issueSelect.value = preferred;
    await listPages();
}

async function listPages() {
    const request = ++generation;
    const issue = issueSelect.value;
    const date = issueDates.get(issue);
    byId('heading').textContent = date ? '지면 모니터링 (' + Number(date.slice(5, 7)) + '월 ' + Number(date.slice(8, 10)) + '일자)' : '지면 모니터링';
    const pages = issue === '' ? [] : result(await supabase.from('evere_press_pages')
        .select('issue,page,revision,source_path,preview_path,updated_at,evere_press_work(editor_name,expires_at,finalized_at)').eq('issue', issue).order('page'));
    const paths = [...new Set(pages.map(previewPath).filter(Boolean))];
    const urls = paths.length ? result(await store.createSignedUrls(paths, 900)) : [];
    if (request !== generation) return;
    const previews = new Map(urls.map(row => [row.path, row.signedUrl]));
    const filter = pageFilter.value;
    pageFilter.replaceChildren(new Option('전면',''), ...pages.map(row => new Option(row.page + '면', row.page)));
    pageFilter.value = pages.some(row => String(row.page) === filter) ? filter : '';
    gallery.replaceChildren(...pages.filter(row => !pageFilter.value || String(row.page) === pageFilter.value).map(row => {
        const preview = previews.get(previewPath(row));
        const card = document.createElement(preview ? 'a' : 'article');
        card.className = 'press-page';
        const work = row.evere_press_work;
        const editing = Date.parse(work?.expires_at) > Date.now();
        const finalized = Boolean(work?.finalized_at);
        card.dataset.finalized = String(Boolean(work?.finalized_at));
        const title = document.createElement('strong');
        title.textContent = row.issue + '호 ' + row.page + '면';
        const thumb = document.createElement('span');
        thumb.className = 'press-page-thumb';
        if (preview) {
            const image = new Image();
            image.loading = 'lazy';
            image.src = preview;
            image.alt = '';
            thumb.append(image);
        } else thumb.textContent = '미리보기 없음';
        const meta = document.createElement('span');
        meta.className = 'press-page-meta';
        const state = finalized ? '강판' : editing
            ? '편집중 (' + work.editor_name + ')' : row.revision ? '편집본 저장' : '초안';
        const time = work?.finalized_at || row.updated_at;
        meta.textContent = time ? state + ' · ' +
            new Intl.DateTimeFormat('ko-KR', {dateStyle:'short', timeStyle:'short', timeZone:'Asia/Seoul'}).format(new Date(time)) : state;
        card.append(title, thumb, meta);
        if (preview) {
            const params = new URLSearchParams({issue: row.issue, page: row.page});
            card.href = '/newsroom/press-preview/?' + params;
            card.target = '_blank';
            card.rel = 'noopener';
            card.setAttribute('aria-label', title.textContent + ' 미리보기 새 창');
            card.addEventListener('click', event => {
                if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
                const popup = window.open('', '_blank', 'popup,width=1060,height=860,resizable=yes,scrollbars=yes');
                if (!popup) return;
                event.preventDefault();
                popup.opener = null;
                popup.location.replace(card.href);
            });
        }
        if (!canFinalize || (!finalized && (!row.revision || !row.preview_path))) return card;
        const group = document.createElement('article');
        group.className = 'press-page-actions';
        const finish = document.createElement('button');
        finish.type = 'button';
        finish.className = 'press-finalize';
        finish.textContent = finalized ? '강판 해제' : '강판';
        finish.setAttribute('aria-label', title.textContent + ' ' + finish.textContent);
        finish.disabled = editing;
        finish.onclick = async () => {
            finish.disabled = true;
            try {
                result(await supabase.rpc('evere_press_work_change', {
                    p_issue: row.issue, p_page: row.page, p_action: finalized ? 'reopen' : 'finalize'
                }));
                await listPages();
            } catch (error) {
                notify(error.message);
                finish.disabled = editing;
            }
        };
        group.append(card, finish);
        return group;
    }));
    notify(pages.length ? '' : '등록된 발행 계획이 없습니다.');
}

function handle(form, work) {
    form.addEventListener('submit', async event => {
        event.preventDefault();
        const button = form.querySelector('button[type="submit"]');
        button.disabled = true;
        try { await work(); }
        catch (error) { notify(error.message); }
        finally { button.disabled = false; }
    });
}

handle(plan, async () => {
    const fields = new FormData(plan);
    const issue = Number(fields.get('issue'));
    result(await supabase.rpc('evere_create_press_issue', {
        p_issue: issue, p_date: fields.get('date'), p_pages: Number(fields.get('pages'))
    }));
    plan.reset();
    await listIssues(issue);
});
const refresh = work => () => work().catch(error => notify(error.message));
byId('refresh').onclick = refresh(listIssues);
issueSelect.onchange = refresh(async () => { pageFilter.value = ''; await listPages(); });
pageFilter.onchange = refresh(listPages);

export function showPress(member) {
    canFinalize = ['owner','director'].includes(member.role);
    plan.hidden = !canFinalize;
    refresh(listIssues)();
}
