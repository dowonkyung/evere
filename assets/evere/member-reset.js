import { supabase } from './supabase.js';

const form = document.querySelector('#reset-form');
const status = document.querySelector('#reset-status');
const token = new URLSearchParams(location.hash.slice(1)).get('token');
history.replaceState(null, '', location.pathname);
let recoveryUser = null;

if (!token) {
    form.hidden = true;
    status.textContent = '비밀번호 초기화 링크를 다시 요청해 주세요.';
}

form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const password = form.elements.password.value;
    if (password !== form.elements.confirmation.value) {
        status.textContent = '두 비밀번호가 일치하지 않습니다.';
        return;
    }
    const button = form.querySelector('button');
    button.disabled = true;
    try {
        if (!recoveryUser) {
            const { data, error } = await supabase.auth.verifyOtp({ type: 'recovery', token_hash: token });
            if (error || !data.user) {
                form.hidden = true;
                status.textContent = '링크가 만료되었거나 이미 사용되었습니다. 초기화 링크를 다시 요청해 주세요.';
                return;
            }
            recoveryUser = data.user.id;
        }
        const { data: { user } } = await supabase.auth.getUser();
        if (user?.id !== recoveryUser) {
            form.hidden = true;
            status.textContent = '초기화 세션이 종료되었습니다. 초기화 링크를 다시 요청해 주세요.';
            return;
        }
        const { error } = await supabase.auth.updateUser({ password });
        if (error) {
            status.textContent = error.code === 'same_password' ? '기존과 다른 비밀번호를 입력해 주세요.'
                : error.code === 'weak_password' ? '더 강한 비밀번호를 입력해 주세요.'
                : '비밀번호를 저장하지 못했습니다. 다시 시도해 주세요.';
            return;
        }
        form.reset();
        form.hidden = true;
        status.textContent = '비밀번호를 변경했습니다. 새 비밀번호로 로그인해 주세요.';
        await supabase.auth.signOut({ scope: 'global' });
    } catch {
        status.textContent = '요청을 처리하지 못했습니다. 잠시 뒤 다시 시도해 주세요.';
    } finally {
        button.disabled = false;
    }
});
