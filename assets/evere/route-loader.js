// GitHub Pages fallback, following angangjin's template-loading approach.
// Only known article/category paths may load a same-origin page template.
(async () => {
    const status = document.querySelector('[data-route-status]');
    try {
        const { routeTemplate } = await import('/assets/evere/routes.js?v=routes-1');
        const template = routeTemplate(location.pathname);
        if (!template) {
            status.textContent = '페이지를 찾을 수 없습니다.';
            return;
        }
        const response = await fetch(template, { cache: 'no-store' });
        if (!response.ok) throw new Error('Template unavailable');
        const html = await response.text();
        document.open();
        document.write(html);
        document.close();
    } catch {
        status.textContent = '페이지를 불러오지 못했습니다. 잠시 후 새로고침해 주세요.';
    }
})();
