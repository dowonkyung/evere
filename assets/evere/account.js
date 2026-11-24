import { setArticleTitle } from './article-label.js';
import { articlePath } from './routes.js?v=routes-1';
import { supabase } from './supabase.js';
import { sectors, articleCategories } from './article-taxonomy.js?v=corrections-1';
import { articleComposer } from './article-composer.js?v=guest-position-1';
import { renderBody, renderPhotos } from './article-content.js?v=paragraph-breaks-1';
const roleNames = {
    owner: '총수', director: '국장급', department_head: '부장급', reporter: '평기자', citizen: '시민기자',
};
const editorialStates = [
    ['draft', '작성중'], ['complete', '작성완료'], ['revising', '수정중'],
    ['desked', '데스킹完'], ['released', '출고'],
];
const editorialLabels = new Map(editorialStates);
const queueDate = new Intl.DateTimeFormat('ko-KR', {
    dateStyle: 'short', timeStyle: 'short', timeZone: 'Asia/Seoul',
});
const numberFormat = new Intl.NumberFormat('ko-KR', { maximumFractionDigits: 2 });
const limit = 20;
const ui = (id) => document.getElementById(id);
const accessForm = ui('access-form');
const articleForm = ui('article-form');
const articleDialog = ui('article-dialog');
const statusFilter = ui('newsroom-status-filter');
let listState = '';
let articleListRequest = 0;
let dialogRequest = 0;
let dialogEditor;
const compose = articleForm && articleComposer(articleForm);
const profileDetails = ui('profile-details-form');
const avatarForm = ui('avatar-form');
const headerAvatar = ui('newsroom-avatar');
const avatarBucket = supabase.storage.from('evere-avatars');
const avatarTypes = new Set(['image/jpeg', 'image/png', 'image/webp']);
const memberForm = ui('members-form');
const memberSelect = memberForm?.elements.member;
const memberRole = memberForm?.elements.role;
const approvedSectors = memberForm?.querySelector('.sector-fields');
let isSignup = new URLSearchParams(location.search).get('mode') === 'signup';
let user;
let member;
let members = [];
let articleOffset = 0;
let verificationEmail = '';

function message(text = '', error = false) {
    const status = articleDialog?.open ? ui('article-dialog-status') : ui('status');
    status.textContent = text;
    status.dataset.error = String(error);
}

function result(response) {
    if (response.error) throw response.error;
    return response.data;
}

function getError(error) {
    if (['user_already_exists', 'email_exists'].includes(error.code)) return '이미 등록된 이메일입니다. 로그인해 주세요.';
    if (error.code === 'EV002') return '기사가 더 이상 작성중 상태가 아닙니다. 목록을 새로고침해 주세요.';
    if (error.code === 'EV001') return '삭제된 이브레 계정입니다.';
    if (error.code === 'weak_password') return '비밀번호가 보안 요건을 충족하지 않습니다.';
    if (error.code === 'email_not_confirmed') return '이메일 인증을 마친 뒤 로그인해 주세요.';
    if (error.code === 'invalid_credentials') return '이메일 또는 비밀번호를 확인해 주세요.';
    if (error.code === 'over_email_send_rate_limit') return '잠시 뒤 인증 이메일을 다시 요청해 주세요.';
    if (error.code === 'email_address_not_authorized' || error.code === 'unexpected_failure') {
        return '인증 이메일을 보내지 못했습니다. 잠시 뒤 다시 시도해 주세요.';
    }
    if (error.code === '23514') return '기자명과 입력 내용이 올바른지 확인해 주세요.';
    if (error.code === '42501') return '이 작업을 수행할 권한이 없습니다.';
    return '요청을 처리하지 못했습니다. 입력 내용을 확인하고 다시 시도해 주세요.';
}

function handle(action) {
    return async (event) => {
        event.preventDefault();
        const control = event.submitter || (event.currentTarget instanceof HTMLButtonElement ? event.currentTarget : null);
        if (control) control.disabled = true;
        message();
        try {
            await action(event);
        } catch (error) {
            message(getError(error), true);
        } finally {
            if (control && control.id !== 'previous' && control.id !== 'next') control.disabled = false;
        }
    };
}

function setAccessMode() {
    ui('access-title').textContent = isSignup ? '회원가입' : '로그인';
    ui('access-submit').textContent = isSignup ? '회원가입' : '로그인';
    ui('switch-mode').textContent = isSignup ? '로그인' : '회원가입';
    ui('signup-name').hidden = !isSignup;
    accessForm.elements.displayName.required = isSignup;
    accessForm.elements.password.minLength = isSignup ? 8 : 0;
    accessForm.elements.password.autocomplete = isSignup ? 'new-password' : 'current-password';
}

function accountUrl() {
    return new URL('../account/', location.href).href;
}

function avatarPath() {
    return member.id + '/profile';
}

function showAvatar(url) {
    ui('remove-avatar').hidden = !url;
    for (const image of [ui('profile-avatar'), headerAvatar].filter(Boolean)) {
        image.hidden = !url;
        if (url) image.src = url;
        else image.removeAttribute('src');
    }
}

async function loadProfile() {
    const memberId = member.id;
    const saved = result(await supabase.from('evere_member_profiles').select('position_title,bio,reporter_email')
        .eq('member_id', memberId).maybeSingle());
    if (member?.id !== memberId) return;
    if (profileDetails.elements.displayName) profileDetails.elements.displayName.value = member.display_name;
    profileDetails.elements.position.value = saved?.position_title || '';
    profileDetails.elements.bio.value = saved?.bio || '';
    if (profileDetails.elements.reporterEmail) profileDetails.elements.reporterEmail.value = saved?.reporter_email || '';
    if (!headerAvatar) await loadAvatar(memberId);
}

async function loadAvatar(memberId) {
    const entries = result(await avatarBucket.list(memberId, { limit: 2, search: 'profile' }));
    if (member?.id !== memberId) return;
    if (!entries.some((entry) => entry.name === 'profile')) {
        showAvatar('');
        return;
    }
    const signed = result(await avatarBucket.createSignedUrl(avatarPath(), 3600));
    if (member?.id === memberId) showAvatar(signed.signedUrl);
}

function fillOptions(select, values, selected = []) {
    const chosen = new Set(selected);
    select.replaceChildren(...values.map(([id, name]) => {
        const option = document.createElement('option');
        option.value = id;
        option.textContent = name;
        option.selected = chosen.has(id);
        return option;
    }));
}

function setCategories(form, selected = '') {
    fillOptions(form.elements.category, [['', '2차 섹션 없음'], ...(articleCategories[form.elements.sector.value] || [])], [selected]);
}

function canEdit(sector) {
    return member.role === 'owner' || member.role === 'director' ||
        (member.role === 'department_head' && member.sectors.includes(sector));
}

function displayName(id) {
    return members.find((entry) => entry.id === id)?.display_name || '이브레 회원';
}

async function refreshMembers() {
    const summary = ui('member-summary');
    summary.textContent = summary.closest('.account-greeting')
        ? member.display_name + '님, 반가워요!'
        : member.display_name + ' · ' + roleNames[member.role];
    if (!articleForm) return;
    members = result(await supabase.from('evere_members').select('id,display_name,role,sectors').order('display_name'));
    compose.setMember(member, members);
    const admin = member.role === 'owner';
    ui('membership-admin').hidden = !admin;
    if (admin) void renderMemberTable().catch(() => memberTableMessage('회원 목록을 불러오지 못했습니다.'));
    else ui('member-rows').replaceChildren();
}

const memberDate = new Intl.DateTimeFormat('ko-KR', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Seoul' });
let memberTableRequest = 0;

function memberTableMessage(message) {
    const row = element('tr');
    const cell = element('td', message, 'queue-empty');
    cell.colSpan = 8;
    row.append(cell);
    ui('member-rows').replaceChildren(row);
}

let memberPhotoRequest = 0;
let memberProfileRequest = 0;

async function setMemberPhoto(path, target) {
    const request = ++memberPhotoRequest;
    const image = ui('member-photo-preview');
    image.hidden = true;
    image.removeAttribute('src');
    if (!path) return;
    const { data, error } = await avatarBucket.createSignedUrl(path, 300);
    if (error) throw error;
    if (request === memberPhotoRequest && ui('member-dialog').open && memberSelect.value === target) {
        image.src = data.signedUrl;
        image.hidden = false;
    }
}

function validAvatar(photo) {
    return photo && avatarTypes.has(photo.type) && photo.size > 0 && photo.size <= 3 * 1024 * 1024;
}

async function uploadAvatar(path, photo) {
    result(await avatarBucket.upload(path, photo, { upsert: true, contentType: photo.type, cacheControl: '60' }));
}

async function editMember(entry) {
    memberForm.reset();
    memberSelect.value = entry.id;
    memberForm.elements.accountId.value = entry.id;
    memberForm.elements.email.value = entry.email || '';
    memberForm.elements.displayName.value = entry.display_name;
    memberForm.elements.positionTitle.value = entry.position_title || '';
    const roles = Object.entries(roleNames).filter(([id]) => entry.role === 'owner' ? id === 'owner' : id !== 'owner');
    fillOptions(memberRole, roles, [entry.role]);
    memberRole.disabled = entry.role === 'owner';
    approvedSectors.hidden = entry.role !== 'department_head';
    for (const checkbox of approvedSectors.querySelectorAll('input')) {
        checkbox.checked = entry.sectors.includes(checkbox.value);
    }
    ui('member-dialog-status').textContent = '';
    ui('member-remove').disabled = entry.role === 'owner';
    ui('member-recovery-link').hidden = true;
    ui('member-recovery-link').value = '';
    ui('member-photo-status').textContent = '';
    ui('member-dialog').showModal();
    void setMemberPhoto(entry.avatar_path, entry.id).catch(() => {});
    const fields = [memberForm.elements.memberBio, memberForm.elements.reporterEmail];
    const submit = memberForm.querySelector('[type="submit"]');
    const status = ui('member-dialog-status');
    const request = ++memberProfileRequest;
    for (const field of fields) field.disabled = true;
    submit.disabled = true;
    status.textContent = '프로필을 불러오는 중입니다.';
    try {
        const profile = result(await supabase.rpc('evere_owner_member_profiles')
            .eq('member_id', entry.id).single());
        if (request !== memberProfileRequest || !ui('member-dialog').open) return;
        fields[0].value = profile.bio;
        fields[1].value = profile.reporter_email;
        for (const field of fields) field.disabled = false;
        submit.disabled = false;
        status.textContent = '';
    } catch (error) {
        if (request === memberProfileRequest && ui('member-dialog').open) {
            status.textContent = getError(error);
        }
    }
}

async function renderMemberTable() {
    const request = ++memberTableRequest;
    memberTableMessage('회원 목록을 불러오는 중입니다.');
    const rows = [];
    for (let offset = 0; ; offset += 200) {
        const batch = result(await supabase.rpc('evere_owner_members_numbered').order('member_number').range(offset, offset + 199));
        if (request !== memberTableRequest || member?.role !== 'owner') return;
        rows.push(...batch);
        if (batch.length < 200) break;
    }
    if (!rows.length) { memberTableMessage('등록된 회원이 없습니다.'); return; }
    const photos = new Map();
    ui('member-rows').replaceChildren(...rows.map(entry => {
        const row = element('tr');
        const avatar = element('td');
        const placeholder = element('span', Array.from(entry.display_name)[0], 'member-avatar');
        avatar.append(placeholder);
        if (entry.avatar_path) photos.set(entry.avatar_path, avatar);
        row.append(element('td', String(entry.member_number)), avatar);
        for (const value of [entry.email, entry.display_name, roleNames[entry.role], entry.position_title,
            entry.last_sign_in_at && memberDate.format(new Date(entry.last_sign_in_at))]) {
            row.append(element('td', value || '—'));
        }
        const actions = element('td');
        actions.append(actionButton('조회·수정', () => editMember(entry)));
        row.append(actions);
        return row;
    }));
    const paths = [...photos.keys()];
    for (let offset = 0; offset < paths.length; offset += 100) {
        const { data } = await Promise.resolve(avatarBucket.createSignedUrls(paths.slice(offset, offset + 100), 300)).catch(() => ({ data: null }));
        if (request !== memberTableRequest || member?.role !== 'owner') return;
        for (const item of data || []) {
            if (!item.signedUrl || !photos.has(item.path)) continue;
            const image = element('img', '', 'member-avatar');
            image.alt = '';
            const cell = photos.get(item.path);
            image.addEventListener('load', () => cell.replaceChildren(image), { once: true });
            image.src = item.signedUrl;
        }
    }
}

function element(tag, text, className) {
    const node = document.createElement(tag);
    if (text) node.textContent = text;
    if (className) node.className = className;
    return node;
}

function actionButton(label, action) {
    const button = element('button', label);
    button.type = 'button';
    button.addEventListener('click', handle(action));
    return button;
}

function stateButtons(selected, allowed, onChange) {
    const field = element('fieldset', '', 'article-state-field');
    field.append(element('legend', '상태'));
    const group = element('div', '', 'article-state-buttons');
    const buttons = editorialStates.map(([value, title]) => {
        const button = element('button', title, 'article-state-button');
        button.type = 'button';
        button.dataset.state = value;
        button.disabled = !allowed.has(value);
        button.addEventListener('click', () => {
            if (selected === value) return;
            select(value);
            onChange?.(value);
        });
        return button;
    });
    function select(value) {
        selected = value;
        for (const button of buttons) button.setAttribute('aria-pressed', String(button.dataset.state === value));
    }
    group.append(...buttons);
    field.append(group);
    select(selected);
    return { field, select, get value() { return selected; } };
}

const authorStates = new Set(['draft', 'complete']);
const allStates = new Set(editorialLabels.keys());

function articleEditor(article, contentOnly) {
    const form = element('form', '', 'newsroom-compose');
    const editor = articleComposer(form, article, { contentOnly });
    dialogEditor = editor;
    fillOptions(form.elements.sector, Object.entries(sectors).filter(([id]) => contentOnly ? id === article.sector : canEdit(id)), [article.sector]);
    setCategories(form, article.category || '');
    editor.setMember(member, members);
    form.elements.sector.addEventListener('change', () => setCategories(form));
    const state = stateButtons(article.editorial_state, contentOnly ? authorStates : allStates);
    form.querySelector('.compose-heading').after(state.field);
    form.querySelector('button[type="submit"]').textContent = '수정 저장';
    form.addEventListener('submit', handle(async () => {
        const nextState = state.value;
        if (!await editor.save(async (fields) => {
            if (contentOnly) {
                result(await supabase.rpc('evere_save_author_draft', {
                    target: article.id, next_state: nextState, new_title: fields.title,
                    new_subtitle: fields.subtitle, new_body: fields.body,
                    new_body_html: fields.body_html, new_photo_paths: fields.photo_paths,
                }));
                return;
            }
            result(await supabase.from('evere_articles').update({ ...fields, editorial_state: nextState })
                .eq('id', article.id).select('id').single());
        })) return;
        articleDialog.close();
        await loadArticles();
        message('기사를 수정했습니다.');
    }));
    return form;
}

function commentPanel(article) {
    const details = element('details');
    details.append(element('summary', '댓글'));
    const list = element('ul', '', 'comment-list');
    const form = element('form');
    const label = element('label', '댓글 쓰기');
    const input = element('textarea');
    input.required = true;
    input.maxLength = 2000;
    input.rows = 3;
    const submit = element('button', '댓글 등록');
    submit.type = 'submit';
    label.append(input);
    form.append(label, submit);
    details.append(list, form);

    async function loadComments() {
        const comments = result(await supabase.from('evere_comments').select('id,body,author_id,created_at')
            .eq('article_id', article.id).order('created_at', { ascending: false }));
        list.replaceChildren(...comments.map((comment) => {
            const li = element('li');
            const body = element('p', comment.body, 'comment-body');
            li.append(element('span', displayName(comment.author_id), 'comment-meta'), body);
            if (member.role === 'owner') {
                li.append(actionButton('댓글 수정', async () => {
                    const updated = window.prompt('댓글 내용', comment.body);
                    if (!updated?.trim()) return;
                    result(await supabase.from('evere_comments').update({ body: updated.trim() })
                        .eq('id', comment.id).select('id').single());
                    await loadComments();
                }), actionButton('댓글 삭제', async () => {
                    if (!window.confirm('이 댓글을 삭제할까요?')) return;
                    result(await supabase.from('evere_comments').delete().eq('id', comment.id).select('id').single());
                    await loadComments();
                }));
            }
            return li;
        }));
        if (!comments.length) list.append(element('li', '아직 댓글이 없습니다.'));
    }

    details.addEventListener('toggle', () => {
        if (details.open) loadComments().catch((error) => message(getError(error), true));
    });
    form.addEventListener('submit', handle(async () => {
        result(await supabase.from('evere_comments').insert({ article_id: article.id, body: input.value.trim() }));
        input.value = '';
        await loadComments();
        message('댓글을 등록했습니다.');
    }));
    return details;
}

async function openArticle(id) {
    const request = ++dialogRequest;
    const content = ui('article-dialog-content');
    const publicLink = ui('article-dialog-public');
    publicLink.hidden = true;
    publicLink.removeAttribute('href');
    content.replaceChildren();
    articleDialog.showModal();
    message('기사를 불러오는 중입니다.');
    try {
        const article = result(await supabase.from('evere_articles')
            .select('id,article_number,title,article_label,subtitle,body,body_html,sector,category,series_id,byline,guest_byline,guest_byline_positions,photo_paths,status,editorial_state,created_by')
            .eq('id', id).single());
        if (!articleDialog.open || request !== dialogRequest) return;
        ui('article-dialog-title').textContent = article.title;
        const editorialAccess = canEdit(article.sector);
        const ownDraft = article.created_by === member.id && article.editorial_state === 'draft' && article.status === 'pending';
        if (editorialAccess || ownDraft) {
            content.append(articleEditor(article, !editorialAccess));
        } else {
            const copy = element('div', '', 'article-body');
            const photos = element('div', '', 'article-photos');
            renderBody(copy, article);
            content.append(element('p', article.subtitle, 'article-subtitle'), photos, copy);
            void renderPhotos(photos, article.photo_paths, copy);
        }

        const actions = element('div', '', 'article-action dialog-actions');
        if (article.status === 'published') {
            publicLink.href = articlePath(article);
            publicLink.hidden = false;
        }
        if (canEdit(article.sector)) {
            actions.append(actionButton('기사 삭제', async () => {
                if (!window.confirm('이 기사와 댓글을 삭제할까요?')) return;
                result(await supabase.from('evere_articles').delete().eq('id', id).select('id').single());
                articleDialog.close();
                await loadArticles();
                message('기사를 삭제했습니다.');
            }));
        }
        if (actions.childElementCount) content.append(actions);
        if (article.status === 'published') content.append(commentPanel(article));
        message();
    } catch (error) {
        if (articleDialog.open && request === dialogRequest) message(getError(error), true);
    }
}

function articleRow(article) {
    const row = element('tr');
    const status = element('td');
    const badge = element('span', editorialLabels.get(article.editorial_state), 'queue-status');
    badge.dataset.state = article.editorial_state;
    status.append(badge);
    const characters = Array.from(article.body).length;
    const manuscript = element('td', numberFormat.format(characters / 200) + '매 (' +
        numberFormat.format(characters) + '자)');
    const date = element('td');
    const time = element('time', queueDate.format(new Date(article.created_at)));
    time.dateTime = article.created_at;
    date.append(time);
    const action = element('td');
    const view = element('button', '보기');
    view.type = 'button';
    view.setAttribute('aria-label', article.title + ' 보기');
    view.addEventListener('click', () => void openArticle(article.id));
    action.append(view);
    const title = element('td', '', 'queue-title');
    setArticleTitle(title, article.title, article.article_label);
    row.append(status, element('td', sectors[article.sector]), title,
        element('td', displayName(article.created_by)), manuscript, date, action);
    return row;
}

async function loadArticles() {
    let query = supabase.from('evere_articles').select('id,title,article_label,body,sector,editorial_state,created_by,created_at');
    const request = ++articleListRequest;
    if (listState) query = query.eq('editorial_state', listState);
    const articles = result(await query.order('created_at', { ascending: false }).order('id').range(articleOffset, articleOffset + limit));
    if (request !== articleListRequest) return;
    if (!articles.length && articleOffset) {
        articleOffset -= limit;
        return loadArticles();
    }
    const table = ui('articles');
    table.replaceChildren(...articles.slice(0, limit).map(articleRow));
    if (!articles.length) {
        const row = element('tr');
        const empty = element('td', '표시할 기사가 없습니다.', 'queue-empty');
        empty.colSpan = 7;
        row.append(empty);
        table.append(row);
    }
    ui('previous').disabled = articleOffset === 0;
    ui('next').disabled = articles.length <= limit;
}

async function refresh() {
    const { session } = result(await supabase.auth.getSession());
    user = session ? result(await supabase.auth.getUser()).user : null;
    member = user ? result(await supabase.from('evere_members').select('id,display_name,role,sectors,removed_at').eq('id', user.id).maybeSingle()) : null;
    ui('sign-out').hidden = !user;
    ui('access').hidden = Boolean(user);
    const removed = Boolean(member?.removed_at);
    if (removed) member = null;
    ui('profile-setup').hidden = !user || Boolean(member) || removed;
    if (removed) message('삭제된 이브레 계정입니다.', true);
    ui('workspace').hidden = !member;
    if (headerAvatar) ui('newsroom-identity').hidden = !member;
    if (user && !member) ui('profile-form').elements.displayName.value = user.user_metadata?.evere_display_name || '';
    if (member) {
        await refreshMembers();
        if (ui('profile-settings').tagName !== 'DETAILS') void loadProfile().catch((error) => message(getError(error), true));
        if (headerAvatar) void loadAvatar(member.id).catch(() => {});
        if (articleForm) await loadArticles();
    } else {
        if (memberForm) {
            memberTableRequest++;
            ui('member-dialog').close();
            memberForm.reset();
            ui('member-rows').replaceChildren();
        }
        ui('profile-settings').open = false;
        profileDetails.reset();
        avatarForm.reset();
        showAvatar('');
    }
    document.dispatchEvent(new CustomEvent('evere:member', { detail: member }));
}

ui('switch-mode').addEventListener('click', () => {
    isSignup = !isSignup;
    setAccessMode();
    message();
});
accessForm.addEventListener('submit', handle(async () => {
    const email = accessForm.elements.email.value.trim();
    const password = accessForm.elements.password.value;
    verificationEmail = email;
    if (isSignup) {
        const name = accessForm.elements.displayName.value.trim();
        if (!name) {
            message('이름을 입력해 주세요.', true);
            accessForm.elements.displayName.focus();
            return;
        }
        const signup = await supabase.auth.signUp({
            email, password,
            options: {
                emailRedirectTo: accountUrl(),
                data: { evere_app: 'evere', evere_display_name: name },
            },
        });
        if (['user_already_exists', 'email_exists'].includes(signup.error?.code)) {
            isSignup = false;
            setAccessMode();
            accessForm.elements.password.value = '';
            message(getError(signup.error), true);
            return;
        }
        const { session } = result(signup);
        accessForm.elements.password.value = '';
        if (session) {
            await refresh();
            return;
        }
        ui('resend').hidden = false;
        message('이메일 인증을 마친 뒤 이브레로 돌아와 로그인해 주세요.');
    } else {
        const response = await supabase.auth.signInWithPassword({ email, password });
        if (response.error?.code === 'email_not_confirmed') ui('resend').hidden = false;
        result(response);
        accessForm.reset();
        await refresh();
    }
}));
ui('resend').addEventListener('click', handle(async () => {
    const email = accessForm.elements.email.value.trim() || verificationEmail;
    if (!email) return;
    result(await supabase.auth.resend({ type: 'signup', email, options: { emailRedirectTo: accountUrl() } }));
    message('인증 이메일을 다시 요청했습니다.');
}));
ui('sign-out').addEventListener('click', handle(async () => {
    result(await supabase.auth.signOut({ scope: 'local' }));
    isSignup = false;
    setAccessMode();
    articleOffset = 0;
    await refresh();
}));
ui('profile-form').addEventListener('submit', handle(async (event) => {
    result(await supabase.rpc('evere_register_member', { member_name: event.currentTarget.elements.displayName.value.trim() }));
    await refresh();
    message('이브레 회원 등록을 마쳤습니다.');
}));

ui('profile-settings').addEventListener('toggle', () => {
    if (member && ui('profile-settings').open) loadProfile().catch((error) => message(getError(error), true));
});
profileDetails.addEventListener('submit', handle(async () => {
    result(await supabase.from('evere_member_profiles').upsert({
        member_id: member.id,
        position_title: profileDetails.elements.position.value.trim(),
        bio: profileDetails.elements.bio.value.trim(),
        ...(profileDetails.elements.reporterEmail ? { reporter_email: profileDetails.elements.reporterEmail.value.trim() } : {}),
    }));
    const name = profileDetails.elements.displayName;
    if (name && name.value.trim() !== member.display_name) {
        result(await supabase.rpc('evere_set_my_display_name', { new_name: name.value.trim() }));
        member.display_name = name.value.trim();
        await refreshMembers();
    }
    message('프로필을 저장했습니다.');
}));
avatarForm.addEventListener('submit', handle(async () => {
    const photo = avatarForm.elements.avatar.files[0];
    if (!validAvatar(photo)) {
        message('3MB 이하의 JPG, PNG 또는 WebP 사진을 선택해 주세요.', true);
        return;
    }
    await uploadAvatar(avatarPath(), photo);
    avatarForm.reset();
    const signed = result(await avatarBucket.createSignedUrl(avatarPath(), 3600));
    showAvatar(signed.signedUrl);
    message('프로필 사진을 저장했습니다.');
}));
ui('remove-avatar').addEventListener('click', handle(async () => {
    if (!window.confirm('프로필 사진을 삭제할까요?')) return;
    result(await avatarBucket.remove([avatarPath()]));
    showAvatar('');
    message('프로필 사진을 삭제했습니다.');
}));

if (articleForm && memberForm) {
    const clearStatus = ui('newsroom-status-all');
    const filter = stateButtons('', allStates, changeFilter);
    filter.field.querySelector('.article-state-buttons').prepend(clearStatus);
    statusFilter.append(filter.field);
    function changeFilter(value) {
        listState = value;
        filter.select(value);
        clearStatus.setAttribute('aria-pressed', String(!value));
        articleOffset = 0;
        loadArticles().catch((error) => message(getError(error), true));
    }
    clearStatus.addEventListener('click', () => changeFilter(''));
    const writeSubmit = articleForm.querySelector('button[type="submit"]');
    const writeState = stateButtons('complete', authorStates, value => {
        writeSubmit.textContent = value === 'draft' ? '작성중 저장' : '승인 요청';
    });
    articleForm.querySelector('.compose-heading').after(writeState.field);
    const isSaving = () => Boolean(articleDialog.querySelector('form[inert]'));
    ui('article-dialog-close').addEventListener('click', () => {
        if (!isSaving()) articleDialog.close();
    });
    articleDialog.addEventListener('cancel', (event) => {
        if (isSaving()) event.preventDefault();
    });
    articleDialog.addEventListener('close', () => {
        dialogRequest++;
        dialogEditor?.reset();
        dialogEditor = null;
        ui('article-dialog-content').replaceChildren();
        ui('article-dialog-status').textContent = '';
        ui('article-dialog-title').textContent = '기사 보기';
    });
    fillOptions(articleForm.elements.sector, Object.entries(sectors));
    setCategories(articleForm);
    articleForm.elements.sector.addEventListener('change', () => setCategories(articleForm));
    document.addEventListener('evere:series-change', ({ detail }) => {
        if (articleForm.elements.sector.value === detail) void compose.refreshSeries();
    });
    fillOptions(memberRole, Object.entries(roleNames).filter(([id]) => id !== 'owner'), ['citizen']);
    for (const [id, name] of Object.entries(sectors)) {
        const label = element('label', name);
        const input = element('input');
        input.type = 'checkbox';
        input.name = 'sector';
        input.value = id;
        label.prepend(input);
        approvedSectors.querySelector('.checkbox-grid').append(label);
    }
    memberRole.addEventListener('change', () => { approvedSectors.hidden = memberRole.value !== 'department_head'; });
    const memberPhotoSave = ui('member-photo-save');
    memberPhotoSave.addEventListener('click', async () => {
        if (member?.role !== 'owner' || memberPhotoSave.disabled) return;
        const target = memberSelect.value;
        const input = memberForm.elements.memberPhoto;
        const status = ui('member-photo-status');
        const photo = input.files[0];
        if (!target || !validAvatar(photo)) {
            status.textContent = '3MB 이하의 JPG, PNG 또는 WebP 사진을 선택해 주세요.';
            return;
        }
        const path = target + '/profile';
        memberPhotoSave.disabled = true;
        status.textContent = '사진을 저장하는 중입니다.';
        try {
            await uploadAvatar(path, photo);
            if (target === member?.id) void loadAvatar(target).catch(() => {});
            if (ui('member-dialog').open && memberSelect.value === target) {
                input.value = '';
                status.textContent = '프로필 사진을 저장했습니다.';
                void setMemberPhoto(path, target).catch(() => {});
            }
            void renderMemberTable().catch(() => memberTableMessage('회원 목록을 갱신하지 못했습니다.'));
        } catch (error) {
            if (ui('member-dialog').open && memberSelect.value === target) status.textContent = getError(error);
        } finally {
            memberPhotoSave.disabled = false;
        }
    });
    memberForm.addEventListener('submit', async (event) => {
        event.preventDefault();
        const submit = event.submitter || memberForm.querySelector('[type="submit"]');
        if (submit.disabled || member?.role !== 'owner') return;
        const status = ui('member-dialog-status');
        const dialog = ui('member-dialog');
        submit.disabled = true;
        status.textContent = '저장 중입니다.';
        try {
            const role = memberRole.value;
            const assigned = role === 'department_head' ? [...approvedSectors.querySelectorAll('input:checked')].map(item => item.value) : [];
            const name = memberForm.elements.displayName.value.trim();
            result(await supabase.rpc('evere_owner_save_member', {
                target: memberSelect.value, new_name: name, new_position: memberForm.elements.positionTitle.value.trim(),
                new_role: role, new_sectors: assigned,
                new_bio: memberForm.elements.memberBio.value.trim(),
                new_reporter_email: memberForm.elements.reporterEmail.value.trim(),
            }));
            if (memberSelect.value === member.id) member.display_name = name;
            dialog.close();
            await refreshMembers();
            message('회원 정보를 저장했습니다.');
        } catch (error) {
            if (dialog.open) status.textContent = getError(error);
            else message('회원 정보 저장 후 목록을 갱신하지 못했습니다.', true);
        } finally {
            submit.disabled = false;
        }
    });
    for (const action of ['remove', 'recovery']) {
        const button = ui('member-' + action);
        button.addEventListener('click', async () => {
            const target = memberSelect.value;
            const dialog = ui('member-dialog');
            const status = ui('member-dialog-status');
            const link = ui('member-recovery-link');
            if (!target || button.disabled) return;
            const remove = action === 'remove';
            if (remove && !window.confirm('이브레 계정을 삭제할까요? 작성한 기사와 댓글은 유지됩니다.')) return;
            button.disabled = true;
            link.hidden = true;
            link.value = '';
            status.textContent = '';
            try {
                if (remove) {
                    result(await supabase.rpc('evere_owner_remove_member', { target }));
                    if (dialog.open && memberSelect.value === target) dialog.close();
                    await refreshMembers();
                    message('이브레 계정을 삭제했습니다.');
                } else {
                    const data = result(await supabase.functions.invoke('evere-member-recovery', { body: { target } }));
                    if (!dialog.open || memberSelect.value !== target) return;
                    link.value = data.link;
                    link.hidden = false;
                    link.select();
                    status.textContent = '일회용 링크를 복사해 해당 회원에게만 전달해 주세요.';
                }
            } catch (error) {
                if (dialog.open && memberSelect.value === target) {
                    status.textContent = remove ? getError(error) : '초기화 링크를 만들지 못했습니다. 다시 시도해 주세요.';
                }
            } finally {
                if (memberSelect.value === target) button.disabled = false;
            }
        });
    }
    articleForm.addEventListener('submit', handle(async () => {
        const state = writeState.value;
        if (!await compose.save(async (fields) => {
            result(await supabase.from('evere_articles').insert({ ...fields, editorial_state: state }));
        })) return;
        compose.reset();
        writeState.select('complete');
        writeSubmit.textContent = '승인 요청';
        setCategories(articleForm);
        articleOffset = 0;
        await loadArticles();
        message(state === 'draft' ? '작성중으로 저장했습니다.' : '기사 승인을 요청했습니다.');
    }));
    for (const [id, distance] of [['previous', -limit], ['next', limit]]) {
        ui(id).addEventListener('click', handle(async () => {
            articleOffset += distance;
            try {
                await loadArticles();
            } catch (error) {
                articleOffset -= distance;
                ui(id).disabled = false;
                throw error;
            }
        }));
    }
    window.addEventListener('hashchange', () => {
        if (!member || location.hash !== '#review') return;
        articleOffset = 0;
        loadArticles().catch((error) => message(getError(error), true));
    });
}

setAccessMode();
refresh().catch((error) => {
    ui('access').hidden = false;
    message(getError(error), true);
});

