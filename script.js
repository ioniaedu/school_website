// School contact details — fill these in and they appear across the site.
// Anything left empty stays hidden, and the enquiry form needs `email` to send.
const SCHOOL_CONTACT = {
  email: '',
  phone: '',    // e.g. '+91 98765 43210'
  address: '',  // e.g. 'Street, Town, District, State – PIN'
};

(() => {
  const header = document.querySelector('[data-header]');
  const menuToggle = document.querySelector('.menu-toggle');
  const siteNav = document.querySelector('#site-nav');
  const enquiryForm = document.querySelector('#enquiry-form');
  const formStatus = document.querySelector('#form-status');

  const closeMenu = () => {
    if (!menuToggle || !siteNav) return;
    menuToggle.setAttribute('aria-expanded', 'false');
    menuToggle.setAttribute('aria-label', 'Open navigation');
    siteNav.classList.remove('is-open');
    document.body.classList.remove('menu-open');
  };

  const openMenu = () => {
    if (!menuToggle || !siteNav) return;
    menuToggle.setAttribute('aria-expanded', 'true');
    menuToggle.setAttribute('aria-label', 'Close navigation');
    siteNav.classList.add('is-open');
    document.body.classList.add('menu-open');
  };

  menuToggle?.addEventListener('click', () => {
    const isOpen = menuToggle.getAttribute('aria-expanded') === 'true';
    isOpen ? closeMenu() : openMenu();
  });

  siteNav?.querySelectorAll('a').forEach((link) => link.addEventListener('click', closeMenu));
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closeMenu();
  });

  const updateHeader = () => header?.classList.toggle('is-scrolled', window.scrollY > 8);
  updateHeader();
  window.addEventListener('scroll', updateHeader, { passive: true });

  const revealItems = document.querySelectorAll('.reveal');
  if ('IntersectionObserver' in window) {
    const observer = new IntersectionObserver((entries, instance) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add('is-visible');
        instance.unobserve(entry.target);
      });
    }, { threshold: 0.12, rootMargin: '0px 0px -34px' });
    revealItems.forEach((item) => observer.observe(item));
  } else {
    revealItems.forEach((item) => item.classList.add('is-visible'));
  }

  const { email: contactEmail, phone: contactPhone, address: contactAddress } = SCHOOL_CONTACT;
  const showContact = (key, value, href) => {
    if (!value) return;
    const row = document.querySelector(`[data-contact="${key}"]`);
    if (row) {
      row.hidden = false;
      row.querySelector('strong').textContent = value;
      if (href) row.setAttribute('href', href);
      document.querySelector('[data-contact-list]').hidden = false;
    }
    const footerLink = document.querySelector(`[data-contact-link="${key}"]`);
    if (footerLink && href) {
      footerLink.hidden = false;
      footerLink.setAttribute('href', href);
    }
  };
  showContact('email', contactEmail, `mailto:${contactEmail}`);
  showContact('phone', contactPhone, `tel:${contactPhone.replace(/[^\d+]/g, '')}`);
  showContact('address', contactAddress);

  const year = document.querySelector('[data-year]');
  if (year) year.textContent = String(new Date().getFullYear());

  enquiryForm?.addEventListener('submit', (event) => {
    event.preventDefault();
    if (!formStatus) return;
    const data = new FormData(enquiryForm);
    const name = String(data.get('name') || '').trim();
    const email = String(data.get('email') || '').trim();
    const message = String(data.get('message') || '').trim();

    formStatus.classList.remove('is-error');
    if (!contactEmail) {
      formStatus.textContent = 'Online enquiries are not available just yet — please contact the school office directly.';
      formStatus.classList.add('is-error');
      return;
    }
    if (!name || !email || !message) {
      formStatus.textContent = 'Please add your name, email and a short message so we can help.';
      formStatus.classList.add('is-error');
      (!name ? enquiryForm.elements.name : !email ? enquiryForm.elements.email : enquiryForm.elements.message).focus();
      return;
    }

    const subject = encodeURIComponent(`School enquiry from ${name}`);
    const body = encodeURIComponent([
      `Parent / guardian: ${name}`,
      `Email: ${email}`,
      `Child's class or age: ${String(data.get('year') || 'Not supplied')}`,
      `Preferred contact: ${String(data.get('contact') || 'Email')}`,
      '',
      message,
    ].join('\n'));

    formStatus.textContent = 'Thanks — your email app will open with the enquiry ready to send.';
    window.setTimeout(() => {
      window.location.href = `mailto:${contactEmail}?subject=${subject}&body=${body}`;
    }, 120);
  });
})();
