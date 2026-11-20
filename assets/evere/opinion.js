new Swiper('.inside-editor-list.swiper-container', {
    slidesPerView: 'auto',
    spaceBetween: 20,
});

const outsideEditor = document.querySelector('.outside-editor');
new Swiper(outsideEditor.querySelector('.outside-editor-list'), {
    slidesPerView: 'auto',
    spaceBetween: 20,
    navigation: {
        nextEl: outsideEditor.querySelector('.swiper-button-next'),
        prevEl: outsideEditor.querySelector('.swiper-button-prev'),
    },
    breakpoints: {
        768: { slidesPerView: 2, slidesPerGroup: 2, spaceBetween: 24 },
        1024: { slidesPerView: 3, slidesPerGroup: 3, spaceBetween: 24 },
        1280: { slidesPerView: 4, slidesPerGroup: 4, spaceBetween: 24 },
    },
    pagination: {
        el: outsideEditor.querySelector('.outside-editor-wrap-pagignation'),
        type: 'fraction',
        renderFraction: (current, total) =>
            '<span class="' + current + '"></span> / <span class="' + total + '"></span>',
    },
});
