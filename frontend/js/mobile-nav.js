/* Menú de navegación móvil compartido (hamburguesa). */
(function () {
    function setIcon(open) {
        const btn = document.getElementById('menuToggleBtn');
        if (!btn) return;
        const icon = btn.querySelector('.material-symbols-outlined');
        if (icon) icon.textContent = open ? 'close' : 'menu';
    }

    window.closeMobileMenu = function () {
        const panel = document.getElementById('mobileNav');
        if (panel && !panel.classList.contains('hidden')) {
            panel.classList.add('hidden');
            setIcon(false);
        }
    };

    window.toggleMobileMenu = function () {
        const panel = document.getElementById('mobileNav');
        if (!panel) return;
        const hidden = panel.classList.contains('hidden');
        if (hidden) {
            panel.classList.remove('hidden');
            setIcon(true);
        } else {
            panel.classList.add('hidden');
            setIcon(false);
        }
    };

    document.addEventListener('click', function (e) {
        const panel = document.getElementById('mobileNav');
        if (!panel || panel.classList.contains('hidden')) return;
        if (!e.target.closest('#mobileNav') && !e.target.closest('#menuToggleBtn')) {
            closeMobileMenu();
        }
    });

    document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape') closeMobileMenu();
    });
})();