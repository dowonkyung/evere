import { renderBody, renderPhotos } from './article-content.js';
import { supabase } from './supabase.js';
import { sectors } from './article-taxonomy.js';

const ui = (id) => document.getElementById(id);
const articleId = new URLSearchParams(location.search).get('id');
const form = ui('comment-form');
const previous = ui('comments-previous');
const next = ui('comments-next');
const pageSize = 25;
const dateFormat = new Intl.DateTimeFormat('ko-KR', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Seoul' });
let offset = 0;

function checked(response) {
    if (response.error) throw response.error;
    return response.data;
}

async function commentsAt(newOffset) {
    const rows = checked(await supabase.from('evere_comments').select('author_name,body,created_at')
        .eq('article_id', articleId).order('created_at', { ascending: false }).order('id')
        .range(newOffset, newOffset + pageSize));
    offset = newOffset;
    previous.disabled = offset === 0;
    next.disabled = rows.length <= pageSize;
    ui('comments').replaceChildren(...rows.slice(0, pageSize).map((row) => {
        const item = document.createElement('li');
        const meta = document.createElement('p');
        meta.className = 'comment-meta';
        meta.textContent = (row.author_name || '이브레 회원') + ' · ' + dateFormat.format(new Date(row.created_at));
        const body = document.createElement('p');
        body.className = 'comment-body';
        body.textContent = row.body;
        item.append(meta, body);
        return item;
    }));
    if (!rows.length) {
        const empty = document.createElement('li');
        empty.textContent = '아직 댓글이 없습니다.';
        ui('comments').append(empty);
    }
}

async function navigateComments(button, newOffset) {
    button.disabled = true;
    try {
        await commentsAt(newOffset);
    } catch {
        button.disabled = false;
        ui('status').textContent = '댓글을 불러오지 못했습니다.';
    }
}

previous.addEventListener('click', () => navigateComments(previous, Math.max(0, offset - pageSize)));
next.addEventListener('click', () => navigateComments(next, offset + pageSize));
form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const submit = event.submitter;
    submit.disabled = true;
    try {
        checked(await supabase.from('evere_comments').insert({ article_id: articleId, body: form.elements.comment.value.trim() }));
        form.reset();
        ui('status').textContent = '댓글을 등록했습니다.';
        await commentsAt(0);
    } catch {
        ui('status').textContent = '댓글을 등록하지 못했습니다. 계정과 입력 내용을 확인해 주세요.';
    } finally {
        submit.disabled = false;
    }
});

async function render() {
    if (!articleId || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(articleId)) {
        ui('status').textContent = '기사를 찾을 수 없습니다.';
        return;
    }
    const data = checked(await supabase.from('evere_articles').select('title,subtitle,body,body_html,photo_paths,sector,byline_names,published_at')
        .eq('id', articleId).eq('status', 'published').maybeSingle());
    if (!data) {
        ui('status').textContent = '게시된 기사를 찾을 수 없습니다.';
        return;
    }
    document.title = data.title + ' | 이브레';
    ui('sector').textContent = sectors[data.sector];
    ui('title').textContent = data.title;
    ui('subtitle').textContent = data.subtitle;
    renderBody(ui('body'), data);
    void renderPhotos(ui('article-photos'), data.photo_paths);
    ui('byline').textContent = [...data.byline_names, dateFormat.format(new Date(data.published_at))].join(' · ');
    ui('published-article').hidden = false;
    ui('comments-section').hidden = false;
    await commentsAt(0);

    const { data: sessionData } = await supabase.auth.getSession();
    if (sessionData?.session) {
        const { data: profile } = await supabase.from('evere_members').select('id')
            .eq('id', sessionData.session.user.id).maybeSingle();
        form.hidden = !profile;
        ui('comment-sign-in').hidden = Boolean(profile);
    }
}

render().catch(() => { ui('status').textContent = '기사를 불러오지 못했습니다.'; });
