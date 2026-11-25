/* Shared skin settings and presentation. */
(function expose(root, build) {
  const api = build();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.SkinAppearance = api;
})(typeof window === 'object' ? window : globalThis, function build() {
  const { t: uiText } = typeof module === 'object' && module.exports ? require('./i18n.js') : globalThis.GarlicI18n;
  // Function Skin Controls
  function create(document, bridge, onApply) {
    const byId = (id) => document.getElementById(id);
    const select = byId('uiLayout'), status = byId('layoutStatus');
    const brand = document.querySelector('.cmp-brand');
    let image = brand.querySelector('img');
    image.style.visibility = 'hidden';
    const warningBox = byId('skinWarnings'), warningList = byId('skinWarningList');
    const compare = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true });
    let catalog = [], appliedColors = [], request = 0, choice = 0, saves = Promise.resolve();
    let artworkRequest = 0, artworkKey = '', catalogWarnings = [];
    const artworkWarnings = new Map();

    // Function Skin Warnings
    function showWarnings() {
      const warnings = [...new Set([...catalogWarnings, ...[...artworkWarnings.values()].flat()])];
      warningList.replaceChildren(...warnings.map((message) => {
        const item = document.createElement('li'); item.textContent = message; return item;
      }));
      warningBox.hidden = !warnings.length;
      byId('skinWarningSummary').textContent = uiText`Skin warnings (${warnings.length})`;
    }

    // Function Mascot Display
    function displayMascot(skin, current, source, warnings, fallback = false) {
      if (current !== artworkRequest) return;
      const candidate = image.cloneNode(false);
      candidate.removeAttribute('src'); candidate.hidden = false;
      candidate.style.visibility = 'hidden';
      candidate.onload = () => {
        if (current === artworkRequest && image === candidate) candidate.style.visibility = 'visible';
      };
      candidate.onerror = () => {
        if (current !== artworkRequest || image !== candidate) return;
        if (!fallback) {
          const messages = [...warnings, `${skin.name}: mascot image could not display; using default mascot.`];
          displayMascot(skin, current, 'skins/cmp/mascot.png', messages, true);
        } else {
          candidate.onerror = null; candidate.onload = null; candidate.removeAttribute('src');
          candidate.style.visibility = 'hidden';
          artworkWarnings.set(skin.id, [...warnings, 'Default mascot image could not display.']); showWarnings();
        }
      };
      image.replaceWith(candidate); image = candidate;
      artworkWarnings.set(skin.id, warnings); showWarnings();
      candidate.src = source;
    }

    // Function Mascot Loading
    function loadMascot(skin) {
      if (!skin) {
        artworkRequest++; artworkKey = ''; image.onerror = null; image.onload = null;
        image.style.visibility = 'hidden'; image.hidden = false; image.removeAttribute('src'); return;
      }
      const key = `${skin.id}:${skin.mascotRevision || ''}`;
      if (key === artworkKey) return;
      image.onerror = null; image.onload = null; image.style.visibility = 'hidden';
      image.hidden = false; image.removeAttribute('src');
      artworkKey = key;
      const current = ++artworkRequest;
      bridge.getSkinMascot(skin.id).then((result) => {
        if (current !== artworkRequest) return;
        const fallback = !result.mascot;
        displayMascot(skin, current, result.mascot || 'skins/cmp/mascot.png', result.warnings || [], fallback);
      }).catch((error) => {
        if (current !== artworkRequest) return;
        artworkKey = '';
        displayMascot(skin, current, 'skins/cmp/mascot.png', [`${skin.name}: could not load mascot: ${error.message}`], true);
      });
    }

    // Function Skin Colors
    function apply(id) {
      const skin = catalog.find((item) => item.id === id);
      select.value = skin?.id || 'classic';
      document.body.dataset.skin = skin?.id || 'classic';
      for (const key of appliedColors) document.body.style.removeProperty(`--${key}`);
      appliedColors = Object.keys(skin?.colors || {});
      for (const key of appliedColors) document.body.style.setProperty(`--${key}`, skin.colors[key]);
      document.body.style.setProperty('--skin-scheme', skin?.mode || 'dark');
      image.alt = `${skin?.name || 'Spicy Garlic'} mascot`;
      const title = brand.querySelector('span'); title.textContent = skin?.name || 'Spicy Garlic';
      const subtitle = document.createElement('small'); subtitle.textContent = 'GarlicTransfer'; title.appendChild(subtitle);
      loadMascot(skin);
      onApply(Boolean(skin));
    }

    // Function Skin Loading
    async function reload(selected = select.value) {
      const current = ++request, selectedAtStart = choice;
      try {
        const result = await bridge.getSkins();
        if (current !== request) return;
        if (choice !== selectedAtStart) selected = select.value;
        catalog = [...result.skins].sort((a, b) => compare.compare(a.name, b.name) || compare.compare(a.id, b.id));
        catalogWarnings = result.warnings || [];
        for (const id of artworkWarnings.keys()) if (!catalog.some((skin) => skin.id === id)) artworkWarnings.delete(id);
        showWarnings();
        const option = (name, value) => {
          const item = document.createElement('option'); item.textContent = name; item.value = value; return item;
        };
        select.replaceChildren(option(uiText('Garlic Classic'), 'classic'), ...catalog.map((skin) => option(skin.name, skin.id)));
        select.value = catalog.some((skin) => skin.id === selected) ? selected : 'classic';
        apply(select.value);
        const missing = selected && selected !== select.value ? uiText('Selected skin unavailable; showing Garlic Classic. ') : '';
        status.textContent = missing + uiText`${catalog.length} tree skins loaded. Choose a skin to save it.`;
      } catch (error) {
        if (current === request) status.textContent = uiText`Could not load skins: ${error.message}`;
      }
    }

    // Function Skin Saving
    select.addEventListener('change', () => {
      const id = select.value, revision = ++choice;
      apply(id);
      saves = saves.then(async () => {
        const settings = await bridge.getSettings();
        await bridge.saveSettings({ ...settings, uiLayout: id });
        if (revision === choice) status.textContent = uiText('Skin saved.');
      }).catch((error) => {
        if (revision === choice) status.textContent = uiText`Skin changed but could not be saved: ${error.message}`;
      });
    });
    byId('reloadSkins').addEventListener('click', () => reload());
    byId('openSkinsFolder').addEventListener('click', async () => {
      try { await bridge.openSkinsFolder(); }
      catch (error) { status.textContent = uiText`Could not open skins folder: ${error.message}`; }
    });
    return { apply, reload };
  }
  return { create };
});
