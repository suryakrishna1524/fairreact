// FairReact Mobile Navigation Handler
document.addEventListener('DOMContentLoaded', () => {
  const toggleBtn = document.getElementById('fr-nav-toggle');
  const mobileMenu = document.getElementById('fr-mobile-menu');

  const ICON_BURGER = `<svg viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" stroke-width="2.2" fill="none" stroke-linecap="round" stroke-linejoin="round"><line x1="3" y1="12" x2="21" y2="12"></line><line x1="3" y1="6" x2="21" y2="6"></line><line x1="3" y1="18" x2="21" y2="18"></line></svg>`;
  const ICON_CLOSE = `<svg viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" stroke-width="2.2" fill="none" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>`;

  if (toggleBtn && mobileMenu) {
    toggleBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const isOpen = mobileMenu.classList.toggle('show');
      toggleBtn.innerHTML = isOpen ? ICON_CLOSE : ICON_BURGER;
      toggleBtn.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
    });

    // Close menu when clicking outside
    document.addEventListener('click', (e) => {
      if (!mobileMenu.contains(e.target) && !toggleBtn.contains(e.target)) {
        if (mobileMenu.classList.contains('show')) {
          mobileMenu.classList.remove('show');
          toggleBtn.innerHTML = ICON_BURGER;
          toggleBtn.setAttribute('aria-expanded', 'false');
        }
      }
    });

    // Close menu on link click
    const links = mobileMenu.querySelectorAll('a');
    links.forEach(link => {
      link.addEventListener('click', () => {
        mobileMenu.classList.remove('show');
        toggleBtn.innerHTML = ICON_BURGER;
        toggleBtn.setAttribute('aria-expanded', 'false');
      });
    });
  }
});
