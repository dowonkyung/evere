
import { supabase } from './supabase.js';
import { previewPath } from './press-preview-source.js?v=1';

const get = id => document.getElementById('proof-' + id);
const params = new URLSearchParams(location.search);
const store = supabase.storage.from('evere-press');
const image = get('image');
const size = get('size');
const status = get('status');

function readNumber(key, low, high) {
    const raw = params.get(key);
    const value = Number(raw);
    if (!raw || !/^\d+$/.test(raw) || !Number.isInteger(value) || value < low || value > high) {
        throw new Error('지면 번호를 확인해 주세요.');
    }
    return value;
}

image.onload = () => { image.hidden = false; status.hidden = true; };
image.onerror = () => { status.hidden = false; status.textContent = '미리보기를 불러오지 못했습니다. 지면 창을 다시 열어 주세요.'; };
size.onchange = () => get('sheet').classList.toggle('is-actual', size.value === 'actual');
get('close').onclick = () => window.close();

async function load() {
    const issue = readNumber('issue',0,2147483647);
    const page = readNumber('page',1,200);
    const { data: auth, error: authError } = await supabase.auth.getSession();
    if (authError || !auth.session) throw new Error('뉴스룸에 로그인한 뒤 지면 창을 열어 주세요.');
    const [edition, proof] = await Promise.all([
        supabase.from('evere_press_issues').select('publication_date').eq('issue',issue).maybeSingle(),
        supabase.from('evere_press_pages').select('revision,source_path,preview_path').eq('issue',issue).eq('page',page).maybeSingle()
    ]);
    if (edition.error || proof.error) throw new Error('지면 정보를 불러오지 못했습니다.');
    if (!edition.data || !proof.data) throw new Error('이 지면을 볼 권한이 없거나 등록된 지면이 없습니다.');
    const date = edition.data.publication_date;
    const title = Number(date.slice(5,7)) + '월 ' + Number(date.slice(8,10)) + '일자 · 이브레 ' + issue + '호 ' + page + '면';
    get('title').textContent = title;
    document.title = title + ' | 지면 미리보기';
    image.alt = title;
    const path = previewPath(proof.data);
    if (!path) throw new Error('등록된 미리보기가 없습니다.');
    const { data, error } = await store.createSignedUrl(path,900);
    if (error || !data?.signedUrl) throw new Error('미리보기를 불러올 권한을 확인해 주세요.');
    size.disabled = false;
    image.src = data.signedUrl;
}

load().catch(error => { status.hidden = false; status.textContent = error.message; });
