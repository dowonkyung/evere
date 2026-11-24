// Load known routes without document.write or parser-dependent script ordering.
(async () => {
    const status = document.querySelector('[data-route-status]');
    try {
        const { routeTemplate } = await import('/assets/evere/routes.js?v=wiki-culture-1');
        const template = routeTemplate(location.pathname);
        if (!template) {
            status.textContent = '페이지를 찾을 수 없습니다.';
            return;
        }
        const response = await fetch(template, { cache: 'no-store' });
        if (!response.ok) throw new Error('Template unavailable');
        const page = new DOMParser().parseFromString(await response.text(), 'text/html');
        // DOMParser keeps scripts inert. Install all markup before starting any scripts.
        document.documentElement.lang = page.documentElement.lang;
        document.head.replaceChildren(...page.head.childNodes);
        document.body.replaceWith(page.body);
        for (const template of document.querySelectorAll('template[shadowrootmode]')) {
            const host = template.parentElement;
            if (!host.shadowRoot) {
                const shadow = host.attachShadow({ mode: 'open' });
                shadow.append(template.content);
            }
            template.remove();
        }
        // Include the header shadow tree when collecting any script nodes.
        const scripts = [...document.querySelectorAll('script')];
        for (const inert of scripts) {
            const script = document.createElement('script');
            for (const attribute of inert.attributes) script.setAttribute(attribute.name, attribute.value);
            script.textContent = inert.textContent;
            const external = Boolean(script.src) || script.type === 'module';
            if (external) {
                await new Promise((resolve, reject) => {
                    script.onload = resolve;
                    script.onerror = () => reject(new Error('Page script failed: ' + script.src));
                    inert.replaceWith(script);
                });
            } else {
                inert.replaceWith(script);
            }
        }
    } catch (error) {
        console.error('Route loading failed', error);
        const message = document.querySelector('[data-route-status]');
        if (message) message.textContent = '페이지를 불러오지 못했습니다. 잠시 후 새로고침해 주세요.';
    }
})();
