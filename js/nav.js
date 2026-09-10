// FairReact Mobile Navigation Handler
document.addEventListener('DOMContentLoaded', () => {
  const toggleBtn = document.getElementById('fr-nav-toggle');
  const mobileMenu = document.getElementById('fr-mobile-menu');

  if (toggleBtn && mobileMenu) {
    toggleBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const isOpen = mobileMenu.classList.toggle('show');
      toggleBtn.textContent = isOpen ? '✕' : '☰';
      toggleBtn.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
    });

    // Close menu when clicking outside
    document.addEventListener('click', (e) => {
      if (!mobileMenu.contains(e.target) && !toggleBtn.contains(e.target)) {
        if (mobileMenu.classList.contains('show')) {
          mobileMenu.classList.remove('show');
          toggleBtn.textContent = '☰';
          toggleBtn.setAttribute('aria-expanded', 'false');
        }
      }
    });

    // Close menu on link click
    const links = mobileMenu.querySelectorAll('a');
    links.forEach(link => {
      link.addEventListener('click', () => {
        mobileMenu.classList.remove('show');
        toggleBtn.textContent = '☰';
        toggleBtn.setAttribute('aria-expanded', 'false');
      });
    });
  }
});
