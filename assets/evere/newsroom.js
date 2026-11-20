import { supabase } from './supabase.js';
import { sectors, articleCategories } from './article-taxonomy.js';

const ui = (id) => document.getElementById(id);
const panels = [...document.querySelectorAll('[data-panel]')];
const nav = [...document.querySelectorAll('.newsroom-nav [data-view]')];
const compose = ui('article-form');
const layout = ui('layout-form');
const layoutSubmit = layout.querySelector('[type="submit"]');
const slots = [layout.elements.slot1, layout.elements.slot2, layout.elements.slot3];
const boardForm = ui('board-form');
const postForm = ui('board-post-form');
let member = null;
let boards = [];
let editingPost = null;
let layoutRequest = 0;
let boardRequest = 0;

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
    if (member?.role === 'owner' || member?.role === 'director') return [['home', '메인페이지'], ...Object.entries(sectors)];
    if (member?.role === 'department_head') return Object.entries(sectors).filter(([key]) => member.sectors.includes(key));
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
    if (view === 'profile') ui('profile-settings').open = true;
    if (view === 'write') preview();
    if (view === 'layout') loadLayout().catch(() => notify('화면 배치를 불러오지 못했습니다.', true));
    if (view === 'boards') loadBoards().catch(() => notify('게시판을 불러오지 못했습니다.', true));
}

document.addEventListener('evere:member', (event) => {
    member = event.detail;
    const allowed = editablePages();
    for (const link of document.querySelectorAll('a[data-editor]')) link.hidden = allowed.length === 0;
    for (const link of document.querySelectorAll('a[data-owner]')) link.hidden = member?.role !== 'owner';
    optionList(layout.elements.page, allowed, layout.elements.page.value);
    resetCategories();
    if (member) selectView();
});
window.addEventListener('hashchange', selectView);

function preview() {
    ui('preview-sector').textContent = sectors[compose.elements.sector.value] || '';
    ui('preview-title').textContent = compose.elements.title.value.trim() || '기사 제목';
    ui('preview-byline').textContent = [...compose.elements.byline.selectedOptions].map((option) => option.text).join(', ');
    ui('preview-body').textContent = compose.elements.body.value.trim();
}
compose.addEventListener('input', preview);
compose.addEventListener('change', preview);
compose.addEventListener('reset', () => requestAnimationFrame(preview));

function resetCategories() {
    const page = layout.elements.page.value;
    optionList(layout.elements.category, [['', '전체'], ...(articleCategories[page] || [])]);
    layout.elements.category.disabled = page === 'home';
}

function publicPage(page, category) {
    if (page === 'home') return '../';
    if (page === 'opinion') return '../opinion/' + (category ? category + '/' : '');
    return '../' + page + '/' + (category ? '?category=' + encodeURIComponent(category) : '');
}

async function loadLayout() {
    const page = layout.elements.page.value;
    const category = layout.elements.category.value;
    if (!page) return;
    const request = ++layoutRequest;
    layoutSubmit.disabled = true;
    slots.forEach((select) => { select.disabled = true; });
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
    slots.forEach((select, i) => {
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
    const articleIds = slots.map((select) => select.value || null);
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

function resetPostForm() {
    editingPost = null;
    postForm.reset();
    postForm.querySelector('[type="submit"]').textContent = '게시글 등록';
}

async function showBoard() {
    const selected = boards.find((board) => board.id === boardForm.elements.board.value);
    const request = ++boardRequest;
    boardForm.elements.name.value = selected?.name || '';
    boardForm.elements.description.value = selected?.description || '';
    boardForm.elements.visible.checked = Boolean(selected?.visible);
    ui('remove-board').hidden = !selected;
    postForm.hidden = !selected;
    resetPostForm();
    ui('board-posts').replaceChildren();
    if (!selected) return;
    const posts = value(await supabase.from('evere_board_posts').select('id,title,body')
        .eq('board_id', selected.id).order('created_at', { ascending: false }).limit(100));
    if (request !== boardRequest) return;
    ui('board-posts').replaceChildren(...posts.map((post) => {
        const card = document.createElement('article');
        card.className = 'board-post';
        const title = document.createElement('strong');
        title.textContent = post.title;
        const body = document.createElement('p');
        body.textContent = post.body;
        card.append(title, body, button('수정', () => {
            editingPost = post.id;
            postForm.elements.title.value = post.title;
            postForm.elements.body.value = post.body;
            postForm.querySelector('[type="submit"]').textContent = '수정 저장';
            postForm.elements.title.focus();
        }), button('삭제', async () => {
            if (!window.confirm('게시글을 삭제할까요?')) return;
            value(await supabase.from('evere_board_posts').delete().eq('id', post.id).select('id').single());
            await showBoard();
            notify('게시글을 삭제했습니다.');
        }));
        return card;
    }));
}

async function loadBoards(selected = boardForm.elements.board.value) {
    boards = value(await supabase.from('evere_boards').select('id,name,description,visible').order('name'));
    optionList(boardForm.elements.board, [['', '새 게시판'], ...boards.map((board) => [board.id, board.name])], selected);
    await showBoard();
}

boardForm.elements.board.addEventListener('change', () => {
    showBoard().catch(() => notify('게시글을 불러오지 못했습니다.', true));
});
boardForm.addEventListener('submit', task(async () => {
    const id = boardForm.elements.board.value;
    const fields = {
        name: boardForm.elements.name.value.trim(),
        description: boardForm.elements.description.value.trim(),
        visible: boardForm.elements.visible.checked,
    };
    const table = supabase.from('evere_boards');
    const query = id ? table.update(fields).eq('id', id) : table.insert(fields);
    const saved = value(await query.select('id').single());
    await loadBoards(saved.id);
    notify('게시판을 저장했습니다.');
}));
ui('remove-board').addEventListener('click', task(async () => {
    if (!window.confirm('게시판과 그 안의 모든 글을 삭제할까요?')) return;
    value(await supabase.from('evere_boards').delete().eq('id', boardForm.elements.board.value).select('id').single());
    await loadBoards('');
    notify('게시판을 삭제했습니다.');
}));
postForm.addEventListener('submit', task(async () => {
    const fields = { title: postForm.elements.title.value.trim(), body: postForm.elements.body.value.trim() };
    const table = supabase.from('evere_board_posts');
    const query = editingPost
        ? table.update(fields).eq('id', editingPost)
        : table.insert({ ...fields, board_id: boardForm.elements.board.value });
    value(await query.select('id').single());
    await showBoard();
    notify('게시글을 저장했습니다.');
}));
