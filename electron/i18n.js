(function (root) {
  const catalogs = new Map([['en', { name: 'English', messages: {} }]]);
  let language = 'en';

  function register(locale, name, messages) {
    catalogs.set(locale, { name, messages });
  }

  function preference(value) {
    return catalogs.has(value) ? value : 'auto';
  }

  function resolve(value, systemLanguages = []) {
    const selected = preference(value);
    if (selected !== 'auto') return selected;
    const supported = [...catalogs.keys()];
    for (const candidate of systemLanguages) {
      const locale = candidate.toLowerCase().replace(/_/g, '-');
      const exact = supported.find(key => key.toLowerCase() === locale);
      if (exact) return exact;
      const base = locale.split('-')[0];
      const match = supported.find(key => key.toLowerCase() === base)
        || supported.find(key => key.toLowerCase().split('-')[0] === base);
      if (match) return match;
    }
    return 'en';
  }

  function setLanguage(locale) {
    language = catalogs.has(locale) ? locale : 'en';
  }

  // Accept plain English text or a tagged template. Values remain separate
  // from the catalog key so names, paths, IDs and raw errors are preserved.
  function t(source, ...values) {
    const template = typeof source !== 'string';
    const key = template
      ? source.map((part, index) => index ? `{${index - 1}}${part}` : part).join('')
      : source;
    const messages = catalogs.get(language).messages;
    const translated = Object.hasOwn(messages, key) ? messages[key] : key;
    return template ? translated.replace(/\{(\d+)\}/g, (match, index) => (
      index < values.length ? String(values[index]) : match
    )) : translated;
  }

  function localizeDocument(document) {
    document.documentElement.lang = language;
    const select = document.getElementById('uiLanguage');
    for (const [locale, { name }] of catalogs) {
      select.add(new document.defaultView.Option(name, locale));
    }
    if (language === 'en') return;
    // Translate only text and accessibility copy in the initial HTML, before
    // any controls are populated with user data. Keep nested markup intact.
    const walker = document.createTreeWalker(document.body, document.defaultView.NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const node = walker.currentNode;
      if (node.parentElement.closest('script, style, textarea')) continue;
      const source = node.nodeValue.trim();
      if (source) node.nodeValue = node.nodeValue.replace(source, () => t(source));
    }
    const attrs = ['placeholder', 'title', 'aria-label', 'alt'];
    for (const element of document.querySelectorAll(attrs.map(attr => `[${attr}]`).join(','))) {
      for (const attr of attrs) {
        if (element.hasAttribute(attr)) element.setAttribute(attr, t(element.getAttribute(attr)));
      }
    }
  }

  const api = { register, preference, resolve, setLanguage, t, localizeDocument };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.GarlicI18n = api;
})(globalThis);
