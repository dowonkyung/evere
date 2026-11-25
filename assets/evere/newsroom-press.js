
import { supabase } from './supabase.js';

const byId = id => document.getElementById('press-' + id);
const store = supabase.storage.from('evere-press');
const plan = byId('plan');
const issueSelect = byId('issue');
const pageFilter = byId('page-filter');
const gallery = byId('gallery');
const dialog = byId('detail');
const upload = byId('upload');
let selected;
let generation = 0;
let issueGeneration = 0;
let poll;
const panel = gallery.closest('[data-panel]');

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
    issueSelect.replaceChildren(...rows.map(row => new Option(
        row.issue + '호 · ' + row.publication_date + ' · ' + row.page_count + '면', row.issue
    )));
    if (rows.some(row => String(row.issue) === String(preferred))) issueSelect.value = preferred;
    await listPages();
}

async function listPages() {
    const request = ++generation;
    const issue = issueSelect.value;
    const pages = issue === '' ? [] : result(await supabase.from('evere_press_pages')
        .select('issue,page,revision,source_path,preview_path,updated_at').eq('issue', issue).order('page'));
    const paths = pages.flatMap(row => row.preview_path ? [row.preview_path] : []);
    const urls = paths.length ? result(await store.createSignedUrls(paths, 900)) : [];
    if (request !== generation) return;
    const previews = new Map(urls.map(row => [row.path, row.signedUrl]));
    const filter = pageFilter.value;
    pageFilter.replaceChildren(new Option('전면',''), ...pages.map(row => new Option(row.page + '면', row.page)));
    pageFilter.value = pages.some(row => String(row.page) === filter) ? filter : '';
    gallery.replaceChildren(...pages.filter(row => !pageFilter.value || String(row.page) === pageFilter.value).map(row => {
        const card = document.createElement('button');
        card.type = 'button';
        card.className = 'press-page';
        const title = document.createElement('strong');
        title.textContent = row.page + '면';
        const thumb = document.createElement('span');
        thumb.className = 'press-page-thumb';
        const preview = previews.get(row.preview_path);
        if (preview) {
            const image = new Image();
            image.loading = 'lazy';
            image.src = preview;
            image.alt = '';
            thumb.append(image);
        } else thumb.textContent = '미리보기 없음';
        const meta = document.createElement('span');
        meta.className = 'press-page-meta';
        meta.textContent = row.revision ? '버전 ' + row.revision + ' · ' +
            new Intl.DateTimeFormat('ko-KR', {dateStyle:'short', timeStyle:'short', timeZone:'Asia/Seoul'}).format(new Date(row.updated_at))
            : '파일 미등록';
        card.append(title, thumb, meta);
        card.onclick = () => openPage(row, preview).catch(error => notify(error.message));
        return card;
    }));
    notify(pages.length ? pages.filter(row => row.source_path).length + ' / ' + pages.length + '면 파일 등록' : '등록된 발행 계획이 없습니다.');
}

async function openPage(row, preview) {
    selected = row;
    upload.reset();
    byId('upload-status').textContent = '';
    byId('detail-title').textContent = row.issue + '호 ' + row.page + '면';
    const image = byId('detail-image');
    image.hidden = !preview;
    if (preview) image.src = preview;
    else image.removeAttribute('src');
    const source = byId('source');
    source.hidden = true;
    if (row.source_path) {
        const signed = result(await store.createSignedUrl(row.source_path, 900, {download: row.issue + '-' + row.page + '.indd'}));
        if (selected !== row) return;
        source.href = signed.signedUrl;
        source.hidden = false;
    }
    if (!dialog.open) dialog.showModal();
}

function handle(form, work) {
    form.addEventListener('submit', async event => {
        event.preventDefault();
        const button = form.querySelector('button[type="submit"]');
        button.disabled = true;
        try { await work(); }
        catch (error) {
            if (dialog.open) byId('upload-status').textContent = error.message;
            else notify(error.message);
        }
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
handle(upload, async () => {
    const row = selected;
    byId('upload-status').textContent = '파일 저장 중…';
    const source = upload.elements.source.files[0];
    const preview = upload.elements.preview.files[0];
    if (!source || !/\.indd$/i.test(source.name)) throw new Error('INDD 파일을 선택해 주세요.');
    if (preview && preview.type !== 'image/jpeg') throw new Error('미리보기는 JPEG 파일을 선택해 주세요.');
    const user = result(await supabase.auth.getUser()).user;
    const prefix = user.id + '/' + row.issue + '/' + row.page + '/' + crypto.randomUUID();
    result(await store.upload(prefix + '.indd', source, {contentType:'application/octet-stream'}));
    if (preview) result(await store.upload(prefix + '.jpg', preview, {contentType:'image/jpeg'}));
    const rows = result(await supabase.from('evere_press_pages').update({
        source_path: prefix + '.indd', preview_path: preview ? prefix + '.jpg' : null,
        revision: row.revision + 1, updated_at: new Date().toISOString()
    }).eq('issue',row.issue).eq('page',row.page).eq('revision',row.revision).select('revision'));
    dialog.close();
    await listPages();
    if (!rows.length) throw new Error('다른 편집자가 이 면을 먼저 저장했습니다. 최신 파일을 확인해 주세요.');
});
const refresh = work => () => work().catch(error => notify(error.message));
byId('refresh').onclick = refresh(listIssues);
issueSelect.onchange = refresh(async () => { pageFilter.value = ''; await listPages(); });
pageFilter.onchange = refresh(listPages);

export function showPress(member) {
    plan.hidden = !['owner','director'].includes(member.role);
    refresh(listIssues)();
    poll ??= window.setInterval(() => {
        if (!panel.hidden && !document.hidden && !dialog.open) refresh(listIssues)();
    }, 30000);
}
