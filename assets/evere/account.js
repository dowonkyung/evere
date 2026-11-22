import { supabase } from './supabase.js';
import { sectors, articleCategories } from './article-taxonomy.js';
import { articleComposer } from './article-composer.js?v=editor-1';
import { renderBody, renderPhotos } from './article-content.js?v=inline-1';
const roleNames = {
    owner: '총수', director: '국장급', department_head: '부장급', reporter: '평기자', citizen: '시민기자',
};
const limit = 20;
const ui = (id) => document.getElementById(id);
const accessForm = ui('access-form');
const articleForm = ui('article-form');
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
    ui('status').textContent = text;
    ui('status').dataset.error = String(error);
}

function result(response) {
    if (response.error) throw response.error;
    return response.data;
}

function getError(error) {
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
    const saved = result(await supabase.from('evere_member_profiles').select('position_title,bio')
        .eq('member_id', memberId).maybeSingle());
    if (member?.id !== memberId) return;
    profileDetails.elements.position.value = saved?.position_title || '';
    profileDetails.elements.bio.value = saved?.bio || '';
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
    fillOptions(form.elements.category, [['', '하위 분류 없음'], ...(articleCategories[form.elements.sector.value] || [])], [selected]);
}

function canEdit(sector) {
    return member.role === 'owner' || member.role === 'director' ||
        (member.role === 'department_head' && member.sectors.includes(sector));
}

async function refreshMembers() {
    ui('member-summary').textContent = member.display_name + ' · ' + roleNames[member.role];
    if (!articleForm) return;
    members = result(await supabase.from('evere_members').select('id,display_name,role,sectors').order('display_name'));
    compose.setMember(member, members);
    const admin = member.role === 'owner';
    ui('membership-admin').hidden = !admin;
    if (admin) {
        const selection = memberSelect.value;
        fillOptions(memberSelect, [['', '회원 선택'], ...members.filter((entry) => entry.id !== member.id)
            .map((entry) => [entry.id, entry.display_name + ' · ' + roleNames[entry.role] + ' · ' + entry.id.slice(0, 8)])], [selection]);
        updateMemberForm();
    }
}

function updateMemberForm() {
    const target = members.find((entry) => entry.id === memberSelect.value);
    memberRole.value = target?.role || 'citizen';
    approvedSectors.hidden = memberRole.value !== 'department_head';
    for (const checkbox of approvedSectors.querySelectorAll('input')) {
        checkbox.checked = target?.sectors.includes(checkbox.value) || false;
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

function articleEditor(article) {
    const details = element('details');
    details.append(element('summary', '기사 수정'));
    details.addEventListener('toggle', () => {
        if (!details.open || details.querySelector('form')) return;
        const form = element('form', '', 'newsroom-compose');
        const editor = articleComposer(form, article);
        fillOptions(form.elements.sector, Object.entries(sectors).filter(([id]) => canEdit(id)), [article.sector]);
        setCategories(form, article.category || '');
        editor.setMember(member, members);
        form.elements.sector.addEventListener('change', () => setCategories(form));
        form.querySelector('button[type="submit"]').textContent = '수정 저장';
        form.addEventListener('submit', handle(async () => {
            if (!await editor.save(async (fields) => {
                result(await supabase.from('evere_articles').update(fields).eq('id', article.id).select('id').single());
            })) return;
            editor.reset();
            await loadArticles();
            message('기사를 수정했습니다.');
        }));
        details.append(form);
    });
    return details;
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

function articleCard(article) {
    const card = element('article', '', 'article');
    const summary = element('p', [
        sectors[article.sector], article.status === 'published' ? '게시됨' : '승인 대기',
        article.byline_names.join(', '),
    ].filter(Boolean).join(' · '), 'article-meta');
    const body = element('details');
    const copy = element('div', '', 'article-body');
    const photos = element('div', '', 'article-photos');
    renderBody(copy, article);
    body.append(element('summary', '본문'), element('p', article.subtitle, 'article-subtitle'), photos, copy);
    body.addEventListener('toggle', () => { if (body.open) void renderPhotos(photos, article.photo_paths, copy); });
    const title = element('h3');
    if (article.status === 'published') {
        const link = element('a', article.title);
        link.href = '../article/?id=' + encodeURIComponent(article.id);
        title.append(link);
    } else {
        title.textContent = article.title;
    }
    card.append(title, summary, body);
    if (canEdit(article.sector)) {
        const actions = element('div', '', 'article-action');
        if (article.status === 'pending') {
            actions.append(actionButton('승인 및 게시', async () => {
                result(await supabase.from('evere_articles').update({ status: 'published' })
                    .eq('id', article.id).eq('status', 'pending').select('id').single());
                await loadArticles();
                message('기사를 승인하고 게시했습니다.');
            }));
        }
        actions.append(actionButton('기사 삭제', async () => {
            if (!window.confirm('이 기사와 댓글을 삭제할까요?')) return;
            result(await supabase.from('evere_articles').delete().eq('id', article.id).select('id').single());
            await loadArticles();
            message('기사를 삭제했습니다.');
        }));
        card.append(actions, articleEditor(article));
    }
    if (article.status === 'published') card.append(commentPanel(article));
    return card;
}

async function loadArticles() {
    let query = supabase.from('evere_articles').select('id,title,subtitle,body,body_html,sector,category,series_id,byline,byline_names,guest_byline,photo_paths,status');
    const status = ui('newsroom-status-filter')?.value;
    if (status) query = query.eq('status', status);
    const articles = result(await query.order('created_at', { ascending: false }).order('id').range(articleOffset, articleOffset + limit));
    if (!articles.length && articleOffset) {
        articleOffset -= limit;
        return loadArticles();
    }
    ui('articles').replaceChildren(...articles.slice(0, limit).map(articleCard));
    if (!articles.length) ui('articles').append(element('p', '표시할 기사가 없습니다.'));
    ui('previous').disabled = articleOffset === 0;
    ui('next').disabled = articles.length <= limit;
}

async function refresh() {
    const { session } = result(await supabase.auth.getSession());
    user = session ? result(await supabase.auth.getUser()).user : null;
    member = user ? result(await supabase.from('evere_members').select('id,display_name,role,sectors').eq('id', user.id).maybeSingle()) : null;
    ui('sign-out').hidden = !user;
    ui('access').hidden = Boolean(user);
    ui('profile-setup').hidden = !user || Boolean(member);
    ui('workspace').hidden = !member;
    if (headerAvatar) ui('newsroom-identity').hidden = !member;
    if (user && !member) ui('profile-form').elements.displayName.value = user.user_metadata?.evere_display_name || '';
    if (member) {
        await refreshMembers();
        if (headerAvatar) void loadAvatar(member.id).catch(() => {});
        if (articleForm) await loadArticles();
    } else {
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
        result(await supabase.auth.signUp({
            email, password,
            options: {
                emailRedirectTo: accountUrl(),
                data: { evere_app: 'evere', evere_display_name: name },
            },
        }));
        accessForm.elements.password.value = '';
        ui('resend').hidden = false;
        message('이메일 인증을 마친 뒤 이브레로 돌아와 로그인해 주세요. 이미 계정이 있다면 바로 로그인할 수 있습니다.');
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
    }));
    message('프로필을 저장했습니다.');
}));
avatarForm.addEventListener('submit', handle(async () => {
    const photo = avatarForm.elements.avatar.files[0];
    if (!photo || !avatarTypes.has(photo.type) || photo.size === 0 || photo.size > 3 * 1024 * 1024) {
        message('3MB 이하의 JPG, PNG 또는 WebP 사진을 선택해 주세요.', true);
        return;
    }
    result(await avatarBucket.upload(avatarPath(), photo, { upsert: true, contentType: photo.type, cacheControl: '60' }));
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
    memberSelect.addEventListener('change', updateMemberForm);
    memberRole.addEventListener('change', () => { approvedSectors.hidden = memberRole.value !== 'department_head'; });
    memberForm.addEventListener('submit', handle(async () => {
        const role = memberRole.value;
        const assigned = role === 'department_head' ? [...approvedSectors.querySelectorAll('input:checked')].map((item) => item.value) : [];
        result(await supabase.from('evere_members').update({ role, sectors: assigned })
            .eq('id', memberSelect.value).select('id').single());
        await refreshMembers();
        message('회원 권한을 저장했습니다.');
    }));
    articleForm.addEventListener('submit', handle(async () => {
        if (!await compose.save(async (fields) => {
            result(await supabase.from('evere_articles').insert(fields));
        })) return;
        compose.reset();
        setCategories(articleForm);
        articleOffset = 0;
        await loadArticles();
        message('기사 승인을 요청했습니다.');
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
    ui('newsroom-status-filter')?.addEventListener('change', () => {
        articleOffset = 0;
        loadArticles().catch((error) => message(getError(error), true));
    });
}

setAccessMode();
refresh().catch((error) => {
    ui('access').hidden = false;
    message(getError(error), true);
});
