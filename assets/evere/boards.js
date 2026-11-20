import { supabase } from './supabase.js';

const ui = (id) => document.getElementById(id);
const limit = 20;
const selected = new URLSearchParams(location.search).get('id');
let activeBoard;
let offset = 0;

function element(tag, text) {
    const el = document.createElement(tag);
    el.textContent = text;
    return el;
}

async function loadPosts(start) {
    const { data, error } = await supabase.from('evere_board_posts').select('title,body')
        .eq('board_id', activeBoard.id).order('created_at', { ascending: false }).order('id')
        .range(start, start + limit);
    if (error) throw error;
    offset = start;
    ui('post-list').replaceChildren(...data.slice(0, limit).map((post) => {
        const card = element('article', '');
        card.className = 'article';
        const body = element('p', post.body);
        body.className = 'article-body';
        card.append(element('h3', post.title), body);
        return card;
    }));
    if (!data.length) ui('post-list').append(element('p', '아직 게시글이 없습니다.'));
    ui('prev').disabled = offset === 0;
    ui('next').disabled = data.length <= limit;
}

function fail() { ui('status').textContent = '게시판을 불러오지 못했습니다.'; }
ui('prev').addEventListener('click', () => loadPosts(Math.max(0, offset - limit)).catch(fail));
ui('next').addEventListener('click', () => loadPosts(offset + limit).catch(fail));

async function render() {
    const { data, error } = await supabase.from('evere_boards').select('id,name,description').eq('visible', true).order('name');
    if (error) throw error;
    if (!data.length) {
        ui('status').textContent = '공개된 게시판이 없습니다.';
        return;
    }
    activeBoard = data.find((board) => board.id === selected) || data[0];
    ui('boards').replaceChildren(...data.map((board) => {
        const link = element('a', board.name);
        link.href = '?id=' + encodeURIComponent(board.id);
        link.style.marginRight = '16px';
        if (board.id === activeBoard.id) link.setAttribute('aria-current', 'page');
        return link;
    }));
    ui('board-name').textContent = activeBoard.name;
    ui('board-description').textContent = activeBoard.description;
    ui('posts').hidden = false;
    await loadPosts(0);
}
render().catch(fail);
