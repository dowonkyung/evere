
import { supabase } from './supabase.js';

function clock(seconds) {
    const value = Number.isFinite(seconds) ? Math.floor(Math.max(0,seconds)) : 0;
    const pair = n => String(n).padStart(2,'0');
    const hours = Math.floor(value / 3600);
    return (hours ? pair(hours) + ':' : '') + pair(Math.floor(value / 60) % 60) + ':' + pair(value % 60);
}

export function mountArticleAudio(panel,path) {
    if (!panel || !path || !panel.hidden) return;
    const audio = panel.querySelector('audio');
    const toggle = panel.querySelector('[data-listen-toggle]');
    const elapsed = panel.querySelector('[data-listen-time]');
    const error = panel.querySelector('[data-listen-error]');
    const playIcon = panel.querySelector('[data-listen-play]');
    const pauseIcon = panel.querySelector('[data-listen-pause]');
    let validUntil = 0;
    let pending;

    function source() {
        if (audio.getAttribute('src') && Date.now() < validUntil) return;
        pending ??= (async () => {
            const {data,error: failure} = await supabase.storage.from('evere-article-audio').createSignedUrl(path,3600);
            if (failure || !data?.signedUrl) throw new Error('음성 파일을 불러오지 못했습니다.');
            const position = audio.currentTime;
            if (position) audio.addEventListener('loadedmetadata', () => { audio.currentTime = position; }, {once:true});
            audio.src = data.signedUrl;
            validUntil = Date.now() + 55 * 60 * 1000;
        })().finally(() => { pending = null; });
        return pending;
    }

    function update() {
        elapsed.textContent = clock(audio.currentTime) + (Number.isFinite(audio.duration) ? '/' + clock(audio.duration) : '');
        const paused = audio.paused || audio.ended;
        toggle.setAttribute('aria-label',paused ? '기사 음성 재생' : '기사 음성 일시정지');
        playIcon.toggleAttribute('hidden', !paused);
        pauseIcon.toggleAttribute('hidden', paused);
    }

    for (const event of ['loadedmetadata','durationchange','timeupdate','play','pause','ended']) audio.addEventListener(event,update);
    audio.addEventListener('error', () => {
        validUntil = 0;
        error.textContent = '음성을 재생하지 못했습니다.';
        error.hidden = false;
    });
    toggle.addEventListener('click', async () => {
        if (!audio.paused) { audio.pause(); return; }
        toggle.disabled = true;
        error.hidden = true;
        try {
            if (!audio.getAttribute('src') || Date.now() >= validUntil) await source();
            await audio.play();
        } catch {
            error.textContent = '음성을 재생하지 못했습니다. 다시 눌러 주세요.';
            error.hidden = false;
        } finally { toggle.disabled = false; }
    });
    panel.hidden = false;
    void Promise.resolve(source()).catch(() => {});
}
