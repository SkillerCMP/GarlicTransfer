/* Shared save-tree adapters. */
(function expose(root, build) {
  const api = build(root.CmpSkin || (typeof require === 'function' ? require('./cmp_skin.js') : null));
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.SaveTreeBridge = api;
})(typeof window === 'object' ? window : globalThis, function build(tree) {
  const { t: uiText } = typeof module === 'object' && module.exports ? require('./i18n.js') : globalThis.GarlicI18n;
  // Function Save File Key
  function fileKey(entry, file) { return `${tree.saveKey(entry)}:${JSON.stringify([file.file, file.path || ''])}`; }

  // Function Upload Tree Controls
  function upload({ layout, select, title, summary, getEntries }) {
    let previousEntries, entriesById = new Map(), optionsById = new Map();

    // Function Upload Selection
    function updateSelection() {
      summary.textContent = uiText`${select.selectedOptions.length} save entries selected across source users.`;
      layout.syncSelection();
    }

    // Function Upload Choice
    function toggle(ids, checked) {
      const selected = new Set(ids.map(String));
      for (const option of select.options) if (selected.has(option.value)) option.selected = checked;
      updateSelection();
    }

    // Function Upload Tree
    function render() {
      const inventory = getEntries();
      if (inventory !== previousEntries) {
        previousEntries = inventory;
        entriesById = new Map(inventory.map((entry) => [String(entry.id), entry]));
      }
      optionsById = new Map([...select.options].map((option) => [option.value, option]));
      const entries = [...select.options].map((option) => option.value === 'external'
        ? { id: 'external', owner: 'external', title: title.value.trim().toUpperCase() || 'External save', name: uiText('External upload'), external: option.textContent }
        : entriesById.get(option.value) || { id: option.value, owner: 'console', title: option.textContent });
      layout.setUpload({ entries,
        selected: () => [...select.selectedOptions].map((option) => option.value),
        onToggle: toggle,
        actions: (entry) => {
          const option = optionsById.get(String(entry.id));
          return [{ label: option?.selected ? uiText('Unselect save') : uiText('Select save'), run: () => toggle([entry.id], !option?.selected) }];
        },
      });
      updateSelection();
    }
    return { render, updateSelection };
  }

  // Function Local Tree Controls
  function library({ layout, onOpen, onAction, isBusy }) {
    let previousSaves, entries = [], filesByEntry = new Map(), savesByFile = new Map();
    const actions = [['Select save', null], ['Decrypt & edit', 'mySaveDecryptBtn'], ['Upload to PS5', 'uploadSaveBtn'], ['Export original', 'mySaveExportBtn'], ['Import replacement', 'mySaveImportBtn'], ['Resign', 'mySaveResignBtn']];

    // Function Local Tree Index
    function index(saves) {
      if (previousSaves === saves) return;
      previousSaves = saves;
      const unique = new Map(); filesByEntry = new Map(); savesByFile = new Map();
      for (const save of saves) {
        const key = tree.saveKey(save.entry); unique.set(key, save.entry);
        if (!filesByEntry.has(key)) filesByEntry.set(key, []);
        filesByEntry.get(key).push(save.file);
        savesByFile.set(fileKey(save.entry, save.file), save);
      }
      entries = [...unique.values()];
    }

    // Function Save Opening
    function openSave(save, action) {
      const complete = accepted => {
        if (accepted === false || accepted === null || isBusy()) return;
        return action ? onAction(action) : undefined;
      };
      const opened = onOpen(save);
      if (opened && typeof opened.then === 'function') return Promise.resolve(opened).then(complete).catch(() => {});
      const result = complete(opened);
      if (result && typeof result.then === 'function') return Promise.resolve(result).catch(() => {});
      return result;
    }

    // Function Local Tree
    function render({ saves, users, filter, busy, selected }) {
      index(saves);
      const selectedKey = selected ? fileKey(selected.entry, selected.file) : null;
      layout.setLibrary({ entries, users, filter, busy,
        files: (entry) => filesByEntry.get(tree.saveKey(entry)) || [],
        selectedFile: (entry, file) => selectedKey === fileKey(entry, file),
        onOpen: (entry, file) => {
          const save = savesByFile.get(fileKey(entry, file)); if (save && !isBusy()) return openSave(save);
        },
        fileActions: (entry, file) => actions.map(([label, action]) => ({ label: uiText(label), disabled: isBusy(), run: () => {
          const save = savesByFile.get(fileKey(entry, file));
          if (!save || isBusy()) return;
          return openSave(save, action);
        } })),
      });
    }
    return { render };
  }
  return { upload, library, fileKey };
});
