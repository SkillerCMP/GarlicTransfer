/* CMP presentation; Garlic owns every operation. */
(function expose(root, build) {
  const api = build();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.CmpSkin = api;
})(typeof window === 'object' ? window : globalThis, function buildSkin() {
  const { t: uiText } = typeof module === 'object' && module.exports ? require('./i18n.js') : globalThis.GarlicI18n;
  // Function File Size
  function sizeText(value) {
    const bytes = Number(value) || 0;
    return bytes >= 0x40000000 ? `${(bytes / 0x40000000).toFixed(2)} GiB` : `${(bytes / 0x100000).toFixed(1)} MiB`;
  }

  // Function Save Groups
  function groupEntries(entries) {
    const users = new Map();
    for (const entry of entries) {
      const owner = String(entry.owner || 'console').toLowerCase();
      if (!users.has(owner)) users.set(owner, new Map());
      const title = entry.title || 'Other content';
      const games = users.get(owner);
      if (!games.has(title)) games.set(title, []);
      games.get(title).push(entry);
    }
    return users;
  }

  // Function Save Identity
  function saveKey(entry) {
    const id = String(entry.id ?? '').trim();
    const normalized = /^\d+$/.test(id) && Number.isSafeInteger(Number(id)) ? String(Number(id)) : id;
    return JSON.stringify([String(entry.owner || 'console').trim().toLowerCase(), String(entry.title || '').trim().toUpperCase(), normalized]);
  }

  // Function Save Tree
  function createTree(container) {
    const document = container.ownerDocument;
    const expanded = new Map();
    let checks = [], buttons = [], selectedRows = [], current = {}, menu = null, menuTrigger = null, signature = null, stateVersion = 0;
    let entryMap = new Map(), fileMap = new Map();
    container.classList.add('cmp-tree');

    // Function Tree Element
    function node(tag, className, text) {
      const element = document.createElement(tag);
      if (className) element.className = className;
      if (text !== undefined) element.textContent = text;
      return element;
    }

    // Function File Identity
    function fileKey(file) { return JSON.stringify([file.file, file.path || '']); }

    // Function Branch Memory
    function rememberBranch(key, open) {
      expanded.delete(key);
      if (!open) expanded.set(key, false);
      while (expanded.size > 4096) expanded.delete(expanded.keys().next().value);
    }

    // Function Menu Focus
    function focusTrigger(trigger) {
      if (!trigger?.isConnected || trigger.disabled) return;
      for (let parent = trigger; parent; parent = parent.parentElement) {
        if (parent.hidden) return;
        if (parent.tagName === 'DETAILS' && !parent.open) {
          const summary = [...parent.children].find((child) => child.tagName === 'SUMMARY');
          if (!summary?.contains(trigger)) return;
        }
      }
      trigger.focus({ preventScroll: true });
    }

    // Function Menu Closing
    function closeMenu(restoreFocus = false) {
      const trigger = menuTrigger, ownedFocus = menu?.contains(document.activeElement);
      if (menu) menu.remove(); menu = null; menuTrigger = null;
      if (restoreFocus && ownedFocus) focusTrigger(trigger);
    }
    document.addEventListener('pointerdown', (event) => { if (menu && !menu.contains(event.target)) closeMenu(); });
    document.addEventListener('keydown', (event) => {
      if (menu && event.key === 'Escape') { event.preventDefault(); closeMenu(true); }
    });

    // Function Menu Actions
    function openMenu(event, getActions, trigger) {
      const actions = getActions();
      if (!actions.length) return;
      event.preventDefault(); closeMenu();
      menu = node('div', 'cmp-context'); menu.setAttribute('role', 'menu'); menuTrigger = trigger;
      actions.forEach((action, index) => {
        const button = node('button', '', action.label);
        button.type = 'button'; button.setAttribute('role', 'menuitem');
        button.disabled = Boolean(current.busy || action.disabled);
        button.addEventListener('click', () => {
          const selected = getActions()[index]; closeMenu(true);
          if (!current.busy && selected && !selected.disabled) selected.run();
        });
        menu.appendChild(button);
      });
      document.body.appendChild(menu);
      const bounds = menu.getBoundingClientRect(), view = document.defaultView;
      menu.style.left = `${Math.max(8, Math.min(event.clientX || 8, view.innerWidth - bounds.width - 8))}px`;
      menu.style.top = `${Math.max(8, Math.min(event.clientY || 8, view.innerHeight - bounds.height - 8))}px`;
      menu.querySelector('button:not(:disabled)')?.focus();
    }

    // Function Menu Controls
    function context(element, getActions) {
      const trigger = (event) => {
        const target = event.target.closest?.('[data-tree-focus]');
        return target && element.contains(target) ? target
          : element.matches('[data-tree-focus]') ? element : element.querySelector('[data-tree-focus]');
      };
      element.addEventListener('contextmenu', (event) => { event.stopPropagation(); openMenu(event, getActions, trigger(event)); });
      element.addEventListener('keydown', (event) => {
        if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
          event.stopPropagation();
          const box = element.getBoundingClientRect();
          openMenu({ preventDefault: () => event.preventDefault(), clientX: box.left + 20, clientY: box.bottom }, getActions, trigger(event));
        }
      });
    }

    // Function Save Selection
    function syncSelection() {
      const selected = new Set((current.selected?.() || []).map(String));
      for (const { check, ids } of checks) {
        const count = ids.filter((id) => selected.has(id)).length;
        check.checked = Boolean(ids.length && count === ids.length);
        check.indeterminate = count > 0 && count < ids.length;
        check.disabled = Boolean(current.busy || !ids.length);
      }
      for (const { button, action, label } of buttons) {
        const value = action();
        button.disabled = Boolean(current.busy || !value || value.disabled);
        if (label) button.textContent = value?.label || label;
      }
      for (const { line, selected } of selectedRows) line.classList.toggle('cmp-file-selected', Boolean(selected()));
      if (current.busy) closeMenu();
    }

    // Function Group Checkbox
    function checkbox(ids, label, key) {
      ids = [...new Set(ids.map(String))];
      const check = node('input', 'cmp-check'); check.type = 'checkbox';
      check.dataset.treeFocus = key; check.setAttribute('aria-label', uiText`Select ${label}`);
      check.addEventListener('click', (event) => event.stopPropagation());
      check.addEventListener('change', () => {
        if (current.busy) return;
        current.onToggle?.(ids, check.checked); syncSelection();
      });
      checks.push({ check, ids }); return check;
    }

    // Function Tree Branch
    function branch(key, label, hint, ids) {
      const version = stateVersion;
      const details = node('details', 'cmp-branch'); details.dataset.treeBranch = key;
      details.open = expanded.has(key) ? expanded.get(key) : true;
      details.addEventListener('toggle', () => { if (version === stateVersion && container.contains(details)) rememberBranch(key, details.open); });
      const summary = node('summary', 'cmp-tree-row'); summary.dataset.treeFocus = `${key}:summary`;
      if (current.onToggle) summary.appendChild(checkbox(ids, label, `${key}:check`));
      summary.append(node('span', 'cmp-tree-label', label), node('span', 'cmp-tree-meta', hint));
      details.appendChild(summary); return { details, summary };
    }

    // Function Action Button
    function actionButton(getAction, key) {
      const value = getAction();
      const button = node('button', 'cmp-tree-action', value?.label || uiText('Action')); button.type = 'button';
      button.dataset.treeFocus = key;
      button.addEventListener('click', (event) => {
        event.stopPropagation(); const action = getAction();
        if (!current.busy && action && !action.disabled) action.run();
      });
      buttons.push({ button, action: getAction, label: value?.label || uiText('Action') }); return button;
    }

    // Function Tree Refresh
    function render(options) {
      const scrollTop = container.scrollTop, scrollLeft = container.scrollLeft;
      const focused = container.contains(document.activeElement) ? document.activeElement.dataset.treeFocus : null;
      for (const details of container.querySelectorAll('[data-tree-branch]')) rememberBranch(details.dataset.treeBranch, details.open);
      current = options;
      const entries = options.entries || [];
      entryMap = new Map(entries.map((entry) => [saveKey(entry), entry]));
      fileMap = new Map();
      const rows = entries.map((entry) => {
        const files = options.files?.(entry) || entry.files || [];
        const key = saveKey(entry);
        fileMap.set(key, new Map(files.map((file) => [fileKey(file), file])));
        return { entry, key, files };
      });
      const nextSignature = JSON.stringify({
        rows: rows.map(({ entry, files }) => [saveKey(entry), entry.owner, entry.title, entry.name, entry.size, entry.external, entry.downloaded,
          files.map((file) => [file.file, file.path, file.size])]),
        users: options.users || [], toggles: Boolean(options.onToggle), empty: options.emptyText,
        actions: rows.map(({ entry, files }) => [(options.actions?.(entry) || []).length,
          files.map((file) => (options.fileActions?.(entry, file) || options.actions?.(entry) || []).length)]),
      });
      if (signature === nextSignature) { syncSelection(); return; }
      signature = nextSignature; closeMenu(); stateVersion++; checks = []; buttons = []; selectedRows = [];
      container.replaceChildren();
      if (!entries.length) container.appendChild(node('p', 'cmp-empty', options.emptyText || uiText('No saves in this view.')));
      else {
        const names = new Map((options.users || []).map((user) => [String(user.id).toLowerCase(), user.name]));
        const tree = node('div', 'cmp-tree-content');
        for (const [owner, games] of groupEntries(entries)) {
          const userEntries = [...games.values()].flat();
          const label = names.get(owner) ? `${names.get(owner)} · ${owner}` : owner === 'external' ? uiText('External upload') : uiText`User ${owner}`;
          const user = branch(`u:${owner}`, label, uiText`${games.size} game${games.size === 1 ? '' : 's'}`, userEntries.map((entry) => entry.id));
          for (const [title, items] of games) {
            const first = items[0];
            const name = first.name && first.name !== 'Unknown title' ? `${first.name} · ${title}` : title;
            const total = items.reduce((sum, entry) => sum + (Number(entry.size) || 0), 0);
            const game = branch(`g:${owner}:${title}`, name, sizeText(total), items.map((entry) => entry.id));
            for (const entry of items) {
              const key = saveKey(entry);
              const getEntry = () => entryMap.get(key);
              const getActions = () => current.actions?.(getEntry()) || [];
              if (items.length === 1 && getActions().length) {
                context(game.summary, getActions);
                game.summary.appendChild(actionButton(() => getActions()[0], `${key}:action`));
              }
              const files = [...fileMap.get(key).values()];
              if (!files.length) {
                const line = node('div', 'cmp-tree-row cmp-file-placeholder');
                line.appendChild(node('span', 'cmp-tree-label', entry.external ? entry.external : uiText`Save entry ${entry.id} · ${uiText(entry.downloaded ? 'Downloaded' : 'Download to view files')}`));
                if (items.length > 1 && options.onToggle) line.prepend(checkbox([entry.id], `save entry ${entry.id}`, `${key}:check`));
                if (getActions().length && items.length > 1) line.appendChild(actionButton(() => getActions()[0], `${key}:action`));
                context(line, getActions); game.details.appendChild(line);
              }
              for (const file of files) {
                const identity = fileKey(file), getFile = () => fileMap.get(key)?.get(identity);
                const fileActions = () => current.fileActions?.(getEntry(), getFile()) || getActions();
                const open = () => current.onOpen ? { run: () => current.onOpen(getEntry(), getFile()) } : fileActions()[0];
                const line = node('div', 'cmp-tree-row cmp-file');
                const label = node('button', 'cmp-file-open', file.file); label.type = 'button';
                label.dataset.treeFocus = `${key}:${identity}:file`; label.title = file.path || file.file;
                label.addEventListener('click', () => { const action = open(); if (!current.busy && action && !action.disabled) action.run(); });
                buttons.push({ button: label, action: open });
                selectedRows.push({ line, selected: () => current.selectedFile?.(getEntry(), getFile()) });
                line.append(label, node('span', 'cmp-tree-meta', sizeText(file.size)));
                context(label, fileActions); context(line, fileActions); game.details.appendChild(line);
              }
            }
            user.details.appendChild(game.details);
          }
          tree.appendChild(user.details);
        }
        container.appendChild(tree);
      }
      syncSelection();
      if (focused) [...container.querySelectorAll('[data-tree-focus]')].find((element) => element.dataset.treeFocus === focused)?.focus({ preventScroll: true });
      container.scrollTop = scrollTop; container.scrollLeft = scrollLeft;
    }

    // Function Tree Reset
    function clearState() {
      closeMenu(); stateVersion++; expanded.clear(); signature = null;
      checks = []; buttons = []; selectedRows = []; current = {};
      entryMap.clear(); fileMap.clear(); container.replaceChildren();
      container.scrollTop = 0; container.scrollLeft = 0;
    }

    return { render, syncSelection, setBusy: (value) => { current.busy = value; syncSelection(); }, closeMenu, clearState };
  }

  // Function Tree Controls
  function createController(document, callbacks) {
    const byId = (id) => document.getElementById(id);
    const remote = createTree(byId('cmpRemoteTree'));
    const upload = createTree(byId('cmpUploadTree'));
    const library = createTree(byId('cmpLibraryTree'));
    let active = false, page = 'console', remoteEntries = [], users = [], localFiles = new Map(), libraryData = null;
    let remoteFilter = '', localFilter = '', busy = false, libraryBusy = false, uploadData = null;
    const filter = byId('cmpUserSelect');
    const originalLabels = new Map([...document.querySelectorAll('.nav-item')].map((button) => [button, button.textContent]));
    const labels = { console: 'Locate PS5', download: 'PS5 to PC', upload: 'PC to PS5', library: 'Local files', settings: 'Settings' };

    // Function Save Files
    function files(entry) {
      return localFiles.get(saveKey(entry)) || [];
    }

    // Function User Filter
    function visible(entries, owner) { return entries.filter((entry) => !owner || String(entry.owner).toLowerCase() === owner || entry.owner === 'external'); }

    // Function User List
    function renderUsers() {
      const local = page === 'library';
      const entries = local ? (libraryData?.entries || []) : remoteEntries;
      const candidates = local ? (libraryData?.users || []) : users;
      const owners = new Map(candidates.map((user) => [String(user.id).toLowerCase(), user.name]));
      for (const entry of entries) if (entry.owner && entry.owner !== 'external') owners.set(String(entry.owner).toLowerCase(), owners.get(String(entry.owner).toLowerCase()) || entry.owner);
      const all = document.createElement('option'); all.value = ''; all.textContent = uiText('All users');
      filter.replaceChildren(all);
      for (const [id, name] of owners) {
        const option = document.createElement('option'); option.value = id; option.textContent = name && name !== id ? `${name} · ${id}` : id;
        filter.appendChild(option);
      }
      const value = local ? localFilter : remoteFilter;
      filter.value = owners.has(value) ? value : '';
      if (local) localFilter = filter.value; else remoteFilter = filter.value;
      updateBusy();
    }

    // Function Busy Controls
    function updateBusy() {
      const localBusy = busy || libraryBusy;
      filter.disabled = Boolean(busy || (page === 'library' && localBusy) || filter.options.length <= 1);
      remote.setBusy(busy); upload.setBusy(busy); library.setBusy(localBusy);
    }

    // Function Console Tree
    function renderRemote() {
      remote.render({ entries: visible(remoteEntries, remoteFilter).map((entry) => ({ ...entry, downloaded: entry.downloaded || files(entry).length > 0 })), users, files, busy,
        selected: callbacks.remoteSelection, onToggle: callbacks.toggleRemote,
        actions: (entry) => [{ label: entry.downloaded ? uiText('Download again') : uiText('Download'), run: () => callbacks.download(entry.id) }],
        emptyText: remoteEntries.length ? uiText('No saves for this user.') : uiText('Browse the console to load its users and saves.') });
    }

    // Function Upload Tree
    function renderUpload() {
      if (!uploadData) return;
      upload.render({ ...uploadData, entries: visible(uploadData.entries, remoteFilter), users, files, busy,
        emptyText: uiText('Download a save or add an external save folder to upload.') });
    }

    // Function Local Tree
    function renderLibrary() {
      if (!libraryData) return;
      library.render({ ...libraryData, entries: visible(libraryData.entries, localFilter), busy: busy || libraryBusy,
        emptyText: uiText('No downloaded saves for this user. Refresh local files or download from the console.') });
    }

    filter.addEventListener('change', () => {
      if (page === 'library') { localFilter = filter.value; callbacks.localUser?.(localFilter); renderLibrary(); }
      else { remoteFilter = filter.value; renderRemote(); renderUpload(); callbacks.filterChanged?.(); }
    });

    // Function Tree Layout
    function applyLayout(enabled) {
      const next = Boolean(enabled);
      if (document.body.dataset.layout === (next ? 'cmp' : 'classic') && active === next) return false;
      active = next;
      document.body.dataset.layout = active ? 'cmp' : 'classic';
      for (const [button, label] of originalLabels) button.textContent = active ? uiText(labels[button.dataset.page] || label) : label;
      byId('cmpConnection').hidden = !active;
      for (const tree of [remote, upload, library]) tree.closeMenu();
      return true;
    }

    return {
      get active() { return active; }, applyLayout,
      setPage: (value) => { if (page !== value) { page = value; renderUsers(); } },
      setRemote: (entries, names) => { remoteEntries = entries; users = names; renderUsers(); renderRemote(); renderUpload(); },
      setFiles: (entries) => { localFiles = new Map(entries.map((entry) => [saveKey(entry), entry.files || []])); renderRemote(); renderUpload(); },
      setUpload: (value) => { uploadData = value; renderUpload(); },
      setLibrary: (value) => { libraryData = value; libraryBusy = Boolean(value.busy); localFilter = value.filter || ''; if (page === 'library') renderUsers(); renderLibrary(); },
      setLibraryBusy: (value) => { libraryBusy = Boolean(value); updateBusy(); },
      setBusy: (value) => { busy = value; updateBusy(); },
      syncSelection: () => { remote.syncSelection(); upload.syncSelection(); },
      visibleRemoteEntries: () => visible(remoteEntries, remoteFilter),
      resetLibrary: () => { library.clearState(); libraryData = null; localFilter = ''; libraryBusy = false; },
      reset: () => { remote.clearState(); upload.clearState(); remoteEntries = []; users = []; localFiles.clear(); remoteFilter = ''; uploadData = null; renderUsers(); renderRemote(); upload.render({ entries: [] }); },
    };
  }

  return { sizeText, saveKey, groupEntries, createTree, createController };
});
