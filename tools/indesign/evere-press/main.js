
const { app, ExportFormat, ExportRangeOrAllPages, JPEGOptionsQuality, JpegColorSpaceEnum } = require('indesign');
const { storage } = require('uxp');
const get = id => document.getElementById(id);
const origin = "https://qikhxlwthbtrwbrhryex.supabase.co";
const apiKey = "sb_publishable_itD8ySTzc0w6VIrC3XDCHQ_l5E27u0H";
const bucketPath = '/storage/v1/object/evere-press/';
let session;
let expiresAt = 0;
let refreshPending;
let pages = [];
const documents = new Map();

function report(message) { get('status').textContent = message; }

async function request(path, options = {}, publicRequest = false) {
    if (!publicRequest && session && Date.now() >= expiresAt - 60000) {
        if (!refreshPending) refreshPending = authenticate('refresh_token', { refresh_token: session.refresh_token })
            .finally(() => { refreshPending = null; });
        await refreshPending;
    }
    const headers = { apikey: apiKey, ...options.headers };
    if (!publicRequest && session) headers.Authorization = 'Bearer ' + session.access_token;
    let response;
    try {
        response = await fetch(origin + path, { ...options, headers });
    } catch {
        throw new Error('뉴스룸 서버에 연결하지 못했습니다. 인터넷 연결과 플러그인의 네트워크 설정을 확인해 주세요.');
    }
    if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        if (error.code === 'invalid_credentials' || error.error_code === 'invalid_credentials') {
            throw new Error('이메일 또는 비밀번호가 맞지 않습니다.');
        }
        if (error.code === 'email_not_confirmed' || error.error_code === 'email_not_confirmed') {
            throw new Error('뉴스룸 계정의 이메일 인증을 먼저 완료해 주세요.');
        }
        throw new Error(error.message || error.msg || error.error_description || ('요청 실패 (' + response.status + ')'));
    }
    return response;
}

async function authenticate(grant, fields) {
    session = await (await request('/auth/v1/token?grant_type=' + grant, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(fields)
    }, true)).json();
    expiresAt = Date.now() + session.expires_in * 1000;
}

let issues = [];
let pagesRequest = 0;

function selectedNumber(select, allowed) {
    const value = select.value;
    if (typeof value === 'number' || (typeof value === 'string' && /^\d+$/.test(value))) {
        const number = Number(value);
        if (allowed.includes(number)) return number;
    }
    return allowed[select.selectedIndex] ?? allowed[0];
}

function options(select, rows, selected) {
    select.innerHTML = '';
    for (const [value, label] of rows) {
        const item = document.createElement('option');
        item.setAttribute('value', String(value));
        if (value === selected) item.setAttribute('selected', 'selected');
        item.textContent = label;
        select.appendChild(item);
    }
}

async function loadIssues() {
    const previous = selectedNumber(get('issue'), issues.map(row => row.issue));
    issues = await (await request('/rest/v1/evere_press_issues?select=issue,publication_date,page_count&order=publication_date.desc,issue.desc')).json();
    const selected = issues.some(row => row.issue === previous) ? previous : issues[0]?.issue;
    options(get('issue'), issues.map(row => [row.issue, row.issue + '호 · ' + row.publication_date]), selected);
    get('issue').disabled = !issues.length;
    await loadPages(selected);
}

function activeIssue() {
    return selectedNumber(get('issue'), issues.map(row => row.issue));
}

async function changeWork(row, action, lease = null) {
    return (await request('/rest/v1/rpc/evere_press_work_change', {
        method: 'POST', headers: {'Content-Type':'application/json'},
        body: JSON.stringify({p_issue:row.issue,p_page:row.page,p_action:action,p_lease:lease})
    })).json();
}

function openDocument(row) {
    return [...documents.values()].find(state => state.owner === session?.user.id && state.doc.isValid
        && state.row.issue === row.issue && state.row.page === row.page);
}

function renderRows() {
    const container = get('page-rows');
    container.innerHTML = '';
    for (const row of pages) {
        const work = row.evere_press_work;
        const editing = work?.expires_at && Date.parse(work.expires_at) > Date.now();
        const finalized = Boolean(work?.finalized_at);
        const line = document.createElement('div');
        line.className = 'press-row';
        line.setAttribute('role','row');
        const updated = row.updated_at
            ? new Date(Date.parse(row.updated_at) + 9 * 3600000).toISOString().slice(0,16).replace('T',' ')
            : '–';
        for (const label of [row.page + '면', updated, finalized ? '강판' : editing ? '편집중 (' + work.editor_name + ')' : '-']) {
            const cell = document.createElement('span');
            cell.setAttribute('role','cell');
            cell.textContent = label;
            line.appendChild(cell);
        }
        const actions = document.createElement('span');
        actions.setAttribute('role','cell');
        const open = document.createElement('button');
        open.textContent = '열기';
        open.disabled = editing || finalized;
        open.onclick = action(async () => {
            open.disabled = true;
            try { await openPage(row); }
            finally { await loadPages(activeIssue()); }
        });
        const push = document.createElement('button');
        push.className = 'press-upload';
        push.textContent = '업로드';
        push.disabled = finalized || !openDocument(row);
        push.onclick = action(async () => {
            const state = openDocument(row);
            if (!state) throw new Error('이 면을 먼저 열어 주세요.');
            push.disabled = true;
            try {
                report(row.page + '면 업로드 중…');
                if (state.doc.modified) state.doc.save();
                else enqueue(state);
                await state.queue;
            } finally {
                push.disabled = !openDocument(row);
            }
        });
        actions.appendChild(open);
        actions.appendChild(push);
        line.appendChild(actions);
        container.appendChild(line);
    }
}

async function loadPages(issue) {
    const current = ++pagesRequest;
    const result = !Number.isInteger(issue) || !issues.some(row => row.issue === issue) ? []
        : await (await request('/rest/v1/evere_press_pages?select=issue,page,revision,source_path,preview_path,updated_at,evere_press_work(editor_name,expires_at,finalized_at)&issue=eq.' + issue + '&order=page')).json();
    if (current !== pagesRequest) return;
    pages = result;
    renderRows();
}

function encodePath(path) { return path.split('/').map(encodeURIComponent).join('/'); }

function templateName(page) {
    if (page === 1) return 'front.indd';
    return page % 2 === 0 ? 'even.indd' : 'odd.indd';
}

async function readPageSource(row) {
    if (row.source_path) {
        const data = await request('/storage/v1/object/authenticated/evere-press/' + encodePath(row.source_path));
        return data.arrayBuffer();
    }
    const root = await storage.localFileSystem.getPluginFolder();
    const folder = await root.getEntry('templates');
    const file = await folder.getEntry(templateName(row.page));
    return file.read({ format: storage.formats.binary });
}

async function openPage(row) {
    if (documents.size && [...documents.values()].some(state => state.row.issue === row.issue && state.row.page === row.page)) {
        throw new Error('이미 열려 있는 면입니다.');
    }
    const owner = session.user.id;
    const lease = await changeWork(row,'claim');
    try {
        const root = await storage.localFileSystem.getDataFolder();
        const folder = await root.createFolder('issue-' + row.issue + '-page-' + row.page + '-' + Date.now());
        const file = await folder.createFile(row.issue + '-' + row.page + '.indd');
        await file.write(await readPageSource(row), { format: storage.formats.binary });
        const doc = app.open(file);
        const state = {doc,row,file,folder,owner,lease,queue:Promise.resolve()};
        const id = doc.id;
        documents.set(id,state);
        doc.addEventListener('afterSave', () => enqueue(state));
        doc.addEventListener('beforeClose', () => {
            setTimeout(() => { if (!doc.isValid) releaseClosedDocument(id,state); }, 1000);
        });
        report(row.issue + '호 ' + row.page + '면을 열었습니다.');
    } catch (error) {
        await changeWork(row,'release',lease).catch(() => {});
        throw error;
    }
}

function releaseClosedDocument(id,state) {
    if (documents.get(id) !== state || state.releasing) return;
    state.releasing = true;
    void state.queue.then(() => changeWork(state.row,'release',state.lease))
        .catch(error => report(error.message))
        .finally(() => {
            documents.delete(id);
            if (session) void loadPages(activeIssue()).catch(error => report(error.message));
        });
}

setInterval(async () => {
    if (!session) return;
    for (const [id,state] of documents) {
        if (!state.doc.isValid) {
            releaseClosedDocument(id,state);
            continue;
        }
        if (state.owner !== session.user.id) continue;
        try { await changeWork(state.row,'renew',state.lease); }
        catch (error) { report(error.message); }
    }
    try { await loadPages(activeIssue()); }
    catch (error) { report(error.message); }
}, 30000);

function exportPreview(doc, file) {
    if (doc.pages.length !== 1) throw new Error('한 면에 대응하는 1페이지 INDD 문서를 사용해 주세요.');
    const preferences = app.jpegExportPreferences;
    const keys = ['exportingSpread','jpegExportRange','jpegQuality','jpegColorSpace','exportResolution','useDocumentBleeds'];
    const previous = Object.fromEntries(keys.map(key => [key, preferences[key]]));
    try {
        preferences.exportingSpread = false;
        preferences.jpegExportRange = ExportRangeOrAllPages.EXPORT_ALL;
        preferences.jpegQuality = JPEGOptionsQuality.MAXIMUM;
        preferences.jpegColorSpace = JpegColorSpaceEnum.RGB;
        preferences.exportResolution = 240;
        preferences.useDocumentBleeds = false;
        doc.exportFile(ExportFormat.JPG, file, false);
    } finally {
        for (const key of keys) preferences[key] = previous[key];
    }
}

async function upload(path, bytes, contentType) {
    await request(bucketPath + encodePath(path), {
        method: 'POST', headers: { 'Content-Type': contentType }, body: bytes
    });
}

async function sync(state, bytes, jpeg) {
    if (!session || state.owner !== session.user.id) throw new Error('문서를 연 뉴스룸 계정으로 로그인해 주세요.');
    await changeWork(state.row,'renew',state.lease);
    const { issue, page, revision } = state.row;
    if (bytes.byteLength > 52428800) throw new Error('INDD 파일 크기가 50MiB를 넘습니다.');
    const prefix = session.user.id + '/' + issue + '/' + page + '/' + Date.now() + '-' + Math.random().toString(36).slice(2);
    await upload(prefix + '.indd', bytes, 'application/octet-stream');
    await upload(prefix + '.jpg', jpeg, 'image/jpeg');
    await changeWork(state.row,'renew',state.lease);
    const saved = await (await request('/rest/v1/evere_press_pages?issue=eq.' + issue + '&page=eq.' + page + '&revision=eq.' + revision, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json', Prefer: 'return=representation' },
        body: JSON.stringify({ source_path: prefix + '.indd', preview_path: prefix + '.jpg', revision: revision + 1, updated_at: new Date().toISOString() })
    })).json();
    if (!saved.length) throw new Error('다른 편집자가 먼저 저장했습니다. 로컬 문서를 보관한 뒤 최신 파일을 다시 열어 주세요.');
    state.row = saved[0];
    await loadPages(activeIssue());
    report(issue + '호 ' + page + '면 웹 동기화 완료 · 버전 ' + state.row.revision);
}

function enqueue(state) {
    if (!session || state.owner !== session.user.id) {
        report('로컬에 저장했습니다. 웹 동기화에는 문서를 연 뉴스룸 계정이 필요합니다.');
        return;
    }
    // Export during the save event, while this document still contains that save's changes.
    const view = state.folder.createFile('preview-' + Date.now() + '.jpg');
    const source = state.file.read({ format: storage.formats.binary });
    const snapshot = Promise.all([view, source]).then(async ([file, bytes]) => {
        try {
            exportPreview(state.doc, file);
            return [bytes, await file.read({ format: storage.formats.binary })];
        } finally { await file.delete(); }
    }).then(value => ({value}), error => ({error}));
    state.queue = state.queue.then(async () => {
        const {value,error} = await snapshot;
        if (error) throw error;
        await sync(state, ...value);
    }).catch(error => report('웹 동기화 실패 · ' + error.message));
}

function action(work) {
    return async event => {
        event.preventDefault();
        try { await work(); }
        catch (error) { report(error.message); }
    };
}
const loginButton = get('login-submit');
loginButton.addEventListener('click', async () => {
    if (loginButton.disabled) return;
    const email = String(get('email').value || '').trim();
    const password = String(get('password').value || '');
    if (!email || !password) {
        report('뉴스룸 이메일과 비밀번호를 입력해 주세요.');
        return;
    }

    loginButton.disabled = true;
    let stage = '계정 인증';
    report(stage + ' 중…');
    try {
        await authenticate('password', { email, password });
        stage = '뉴스룸 권한 확인';
        report(stage + ' 중…');
        const rows = await (await request('/rest/v1/evere_members?select=role,removed_at&id=eq.' + encodeURIComponent(session.user.id))).json();
        const member = rows[0];
        if (!member || member.removed_at || !['owner','director','department_head','reporter'].includes(member.role)) {
            throw new Error('조판 기능은 유효한 뉴스룸 기자 계정부터 사용할 수 있습니다.');
        }
        stage = '발행 계획 불러오기';
        report(stage + ' 중…');
        await loadIssues();
        get('login').hidden = true;
        get('workspace').hidden = false;
        report(issues.length ? '로그인했습니다.' : '등록된 발행 계획이 없습니다. 뉴스룸에서 먼저 등록해 주세요.');
    } catch (error) {
        session = null;
        report(stage + ' 실패 · ' + error.message);
    } finally {
        get('password').value = '';
        loginButton.disabled = false;
    }
});
for (const id of ['email', 'password']) {
    get(id).addEventListener('keydown', event => {
        if (event.key !== 'Enter') return;
        event.preventDefault();
        loginButton.click();
    });
}
get('issue').onchange = action(() => loadPages(selectedNumber(get('issue'), issues.map(row => row.issue))));
get('reload').onclick = action(loadIssues);
get('logout').onclick = action(async () => {
    if (documents.size) throw new Error('열린 조판 문서를 닫은 뒤 로그아웃해 주세요.');
    session = null;
    get('workspace').hidden = true;
    get('login').hidden = false;
    report('로그아웃했습니다.');
});
