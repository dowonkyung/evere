
import { supabase } from './supabase.js';

const bucket = supabase.storage.from('evere-article-audio');
const formats = new Map([
    ['mp3','audio/mpeg'], ['m4a','audio/mp4'], ['aac','audio/aac'], ['wav','audio/wav'],
    ['ogg','audio/ogg'], ['opus','audio/ogg'], ['webm','audio/webm'], ['flac','audio/flac'],
]);

export function createArticleAudioField(form, original = null) {
    const input = form.elements.articleAudio;
    const note = form.querySelector('[data-audio-note]');
    const remove = form.querySelector('[data-audio-remove]');
    let previous = original;
    let uploaded;

    const file = () => input.files[0];
    const extension = () => file()?.name.split('.').pop()?.toLowerCase();
    function refresh() {
        note.textContent = file()?.name || (previous ? '저장된 음성 파일이 있습니다.' : 'MP3 권장 · 최대 48MB');
        remove.hidden = !file() && !previous;
    }
    input.addEventListener('change', refresh);
    remove.addEventListener('click', () => {
        if (file()) input.value = '';
        else previous = null;
        refresh();
    });
    refresh();
    return {
        reset() { previous = original; refresh(); },
        error() {
            if (!file()) return '';
            if (!formats.has(extension()) || !file().size) return '지원되는 음성 파일을 선택해 주세요.';
            return file().size > 48 * 1024 * 1024 ? '음성 파일은 최대 48MB까지 첨부할 수 있습니다.' : '';
        },
        async stage(userId) {
            if (!file()) return previous;
            const ext = extension();
            const path = userId + '/' + crypto.randomUUID() + '.' + ext;
            const {error} = await bucket.upload(path,file(),{contentType:formats.get(ext)});
            if (error) throw new Error('음성 파일을 업로드하지 못했습니다. 다시 시도해 주세요.');
            uploaded = path;
            return path;
        },
        committed() { uploaded = null; },
        async discard() {
            if (!uploaded) return;
            const path = uploaded;
            uploaded = null;
            await Promise.resolve(bucket.remove([path])).catch(() => {});
        },
    };
}
