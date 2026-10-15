// No analytics, external scripts or audio uploads.
const platform = navigator.userAgentData?.platform || navigator.platform || navigator.userAgent;
const mobile =
  /android|iphone|ipad|cros/i.test(navigator.userAgent) ||
  (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const os = mobile
  ? null
  : /win/i.test(platform)
    ? 'windows'
    : /mac/i.test(platform) && !/iphone|ipad/i.test(navigator.userAgent)
      ? 'mac'
      : /linux/i.test(platform) && !/android/i.test(navigator.userAgent)
        ? 'linux'
        : null;
if (os) {
  const group = document.querySelector(`[data-os="${os}"]`);
  group?.classList.add('is-detected');
  group?.querySelector('.detected-label')?.removeAttribute('hidden');
  const primary = document.querySelector('[data-primary-download]');
  if (primary) {
    primary.querySelector('span').textContent =
      os === 'windows'
        ? 'Download for Windows'
        : os === 'mac'
          ? 'Choose your Mac download'
          : 'Choose your Linux download';
    // Mac chip type and Linux package format need a choice; never guess them.
    if (os === 'windows') primary.href = group.querySelector('.primary-download').href;
  }
}
const tabs = [...document.querySelectorAll('[data-tab]')];
const panels = [...document.querySelectorAll('[data-panel]')];
function selectTab(name, focus = false) {
  tabs.forEach((tab) => {
    const active = tab.dataset.tab === name;
    tab.setAttribute('aria-selected', String(active));
    tab.tabIndex = active ? 0 : -1;
    if (active && focus) tab.focus();
  });
  panels.forEach((panel) => (panel.hidden = panel.dataset.panel !== name));
}
if (tabs.length) {
  document.querySelector('[data-tabs]').setAttribute('role', 'tablist');
  tabs.forEach((tab, index) => {
    tab.setAttribute('role', 'tab');
    tab.setAttribute('aria-controls', `install-${tab.dataset.tab}`);
    tab.addEventListener('click', () => selectTab(tab.dataset.tab));
    tab.addEventListener('keydown', (event) => {
      const next =
        event.key === 'ArrowRight'
          ? (index + 1) % tabs.length
          : event.key === 'ArrowLeft'
            ? (index + tabs.length - 1) % tabs.length
            : event.key === 'Home'
              ? 0
              : event.key === 'End'
                ? tabs.length - 1
                : null;
      if (next !== null) {
        event.preventDefault();
        selectTab(tabs[next].dataset.tab, true);
      }
    });
  });
  panels.forEach((panel) => {
    panel.setAttribute('role', 'tabpanel');
    panel.setAttribute('aria-labelledby', `tab-${panel.dataset.panel}`);
  });
  const fromHash = () => {
    const requested = location.hash.match(/^#install-(windows|mac|linux)$/)?.[1];
    if (requested) {
      selectTab(requested);
      document.getElementById('install').scrollIntoView();
    }
  };
  selectTab(location.hash.match(/^#install-(windows|mac|linux)$/)?.[1] || os || 'windows');
  window.addEventListener('hashchange', fromHash);
  if (location.hash.startsWith('#install-')) requestAnimationFrame(fromHash);
}
const dialog = document.querySelector('.image-dialog');
document.querySelectorAll('[data-lightbox]').forEach((button) =>
  button.addEventListener('click', () => {
    if (!dialog?.showModal) {
      window.open(button.querySelector('img').src, '_blank', 'noopener');
      return;
    }
    const source = button.querySelector('img');
    const large = dialog.querySelector('[data-image-large]');
    large.src = source.src;
    large.alt = source.alt;
    dialog.querySelector('[data-image-title]').textContent = source.alt;
    dialog.querySelector('[data-image-original]').href = source.src;
    dialog.showModal();
  }),
);
dialog?.querySelector('[data-image-close]').addEventListener('click', () => dialog.close());
dialog?.addEventListener('click', (event) => {
  if (event.target === dialog) {
    const rect = dialog.getBoundingClientRect();
    if (
      event.clientX < rect.left ||
      event.clientX > rect.right ||
      event.clientY < rect.top ||
      event.clientY > rect.bottom
    )
      dialog.close();
  }
});
document.querySelectorAll('[data-copy]').forEach((button) =>
  button.addEventListener('click', async () => {
    const code = button.closest('.command').querySelector('code');
    try {
      await navigator.clipboard.writeText(code.textContent);
      button.textContent = 'Copied';
      document.querySelector('.copy-status').textContent = 'Command copied.';
      setTimeout(() => {
        button.textContent = 'Copy';
      }, 2200);
    } catch {
      const range = document.createRange();
      range.selectNodeContents(code);
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      document.querySelector('.copy-status').textContent =
        'Command selected. Use your usual copy shortcut.';
    }
  }),
);
document.querySelector('[data-print]')?.addEventListener('click', () => window.print());
const search = document.querySelector('#guide-search');
const sections = [...document.querySelectorAll('[data-guide-section]')];
const contents = [...document.querySelectorAll('.guide-sidebar nav a')];
function filterGuide() {
  const query = search.value.trim().toLocaleLowerCase();
  let matches = 0;
  sections.forEach((section) => {
    const match =
      !query ||
      `${section.textContent} ${section.dataset.keywords}`.toLocaleLowerCase().includes(query);
    section.hidden = !match;
    if (match) matches++;
    const link = contents.find((link) => link.hash === `#${section.id}`);
    if (link) link.hidden = !match;
  });
  document.querySelector('[data-search-status]').textContent = query
    ? `${matches} ${matches === 1 ? 'topic' : 'topics'} found`
    : '';
  document.querySelector('.search-empty').hidden = matches > 0;
  document.querySelector('.guide-title').hidden = !!query;
}
search?.addEventListener('input', filterGuide);
contents.forEach((link) =>
  link.addEventListener('click', () => {
    if (search?.value) {
      search.value = '';
      filterGuide();
    }
  }),
);
document.querySelectorAll('.guide-content a[href^="#"]').forEach((link) =>
  link.addEventListener('click', () => {
    if (search?.value) {
      search.value = '';
      filterGuide();
    }
  }),
);
if (sections.length && 'IntersectionObserver' in window) {
  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries)
        if (entry.isIntersecting)
          contents.forEach((link) => {
            if (link.hash === `#${entry.target.id}`) link.setAttribute('aria-current', 'location');
            else link.removeAttribute('aria-current');
          });
    },
    { rootMargin: '-100px 0px -60% 0px' },
  );
  sections.forEach((section) => observer.observe(section));
}
// Print every help answer and OS section, regardless of the current search or tab.
const expanded = new Set();
window.addEventListener('beforeprint', () => {
  document.querySelectorAll('details:not([open])').forEach((element) => {
    expanded.add(element);
    element.open = true;
  });
});
window.addEventListener('afterprint', () => {
  expanded.forEach((element) => (element.open = false));
  expanded.clear();
});
