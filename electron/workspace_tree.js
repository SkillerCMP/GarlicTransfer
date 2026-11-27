(function expose(root, build) {
  const api = build();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.WorkspaceTree = api;
})(typeof window === 'object' ? window : globalThis, function build() {
  // Function Workspace Tree
  function create(document, container, { onOpen = () => {}, onAction = () => {}, isBusy = () => false } = {}) {
    const window = document.defaultView;
    const uiText = window.GarlicI18n?.t || ((source, ...values) =>
      typeof source === 'string' ? source : String.raw({ raw: source }, ...values));
    const scroll = container.closest('.workspace-files') || container.parentElement;
    const rows = new Map(), expanded = new Set();
    let nodes = [], workspace = null, focusKey = '', selected = '', busy = false, menuFile = null, menuRow = null;
    const blocked = () => busy || isBusy();
    container.setAttribute('role', 'rowgroup');
    container.closest('table')?.setAttribute('role', 'treegrid');
    container.closest('table')?.setAttribute('aria-label', uiText('Decrypted save files'));
    const menu = document.createElement('div');
    menu.id = 'workspaceFileContextMenu'; menu.className = 'save-context-menu workspace-file-menu';
    menu.hidden = true; menu.setAttribute('role', 'menu'); menu.setAttribute('aria-label', uiText('File actions'));
    const actions = [['edit', 'Edit file'], ['replace', 'Replace file…'], ['export', 'Export file'], ['delete', 'Delete file']];
    for (const [action, label] of actions) {
      const button = document.createElement('button');
      button.type = 'button'; button.dataset.action = action; button.textContent = uiText(label);
      button.setAttribute('role', 'menuitem');
      if (action === 'delete') button.className = 'danger';
      menu.appendChild(button);
    }
    document.body.appendChild(menu);

    const visible = () => nodes.filter(node => !node.row.hidden);

    // Function Tree Focus
    function focus(node) {
      if (!node) return;
      focusKey = node.key;
      for (const item of nodes) item.row.tabIndex = item === node ? 0 : -1;
      node.row.focus({ preventScroll: true });
    }

    // Function Menu Closing
    function closeMenu(restore = false) {
      menu.hidden = true; menuFile = null;
      if (restore && menuRow?.isConnected) menuRow.focus({ preventScroll: true });
      menuRow = null;
    }

    // Function File Action
    function act(action, file) {
      if (blocked() || !file || (action === 'delete' && file.protected)) return;
      return action === 'edit' ? onOpen(file) : onAction(action, file);
    }

    // Function File Menu
    function showMenu(node, x, y) {
      closeMenu();
      if (blocked() || node.folder) return;
      focus(node); menuFile = node.file; menuRow = node.row;
      for (const button of menu.querySelectorAll('button')) {
        button.disabled = button.dataset.action === 'delete' && Boolean(node.file.protected);
        button.title = button.disabled ? uiText('Metadata and sce_sys files are protected from deletion.') : '';
      }
      menu.hidden = false;
      const width = menu.offsetWidth || 208, height = menu.offsetHeight || 168;
      menu.style.left = `${Math.max(8, Math.min(x, window.innerWidth - width - 8))}px`;
      menu.style.top = `${Math.max(8, Math.min(y, window.innerHeight - height - 8))}px`;
      menu.querySelector('button:not(:disabled)')?.focus();
    }

    // Function Folder Visibility
    function refresh() {
      for (const node of nodes) {
        node.row.hidden = node.parents.some(path => !expanded.has(path));
        if (node.folder) {
          node.row.setAttribute('aria-expanded', String(expanded.has(node.path)));
          node.icon.textContent = expanded.has(node.path) ? '▾' : '▸';
        } else node.row.setAttribute('aria-selected', String(node.path === selected));
        node.row.classList.toggle('selected', !node.folder && node.path === selected);
        node.row.setAttribute('aria-disabled', String(blocked()));
      }
      const items = visible();
      const current = items.find(node => node.key === focusKey) || items.find(node => !node.folder && node.path === selected) || items[0];
      focusKey = current?.key || '';
      for (const node of nodes) node.row.tabIndex = node === current ? 0 : -1;
    }

    // Function Tree Row
    function makeRow(node) {
      const row = document.createElement('tr'); row.setAttribute('role', 'row'); row.dataset.nodeKey = node.key;
      row.tabIndex = -1;
      const name = document.createElement('td'); name.className = 'workspace-tree-name'; name.setAttribute('role', 'gridcell');
      const icon = document.createElement('span'); icon.className = 'workspace-tree-icon'; icon.setAttribute('aria-hidden', 'true');
      const label = document.createElement('span'); label.className = 'workspace-tree-label';
      name.append(icon, label);
      const size = document.createElement('td'); size.className = 'workspace-tree-size'; size.setAttribute('role', 'gridcell');
      row.append(name, size);
      return { row, icon, label, size };
    }

    // Function Tree Rendering
    function render(files = [], selectedPath = '', workspaceKey = '') {
      const changedWorkspace = workspace !== workspaceKey;
      const activeKey = container.contains(document.activeElement) ? document.activeElement.closest('tr')?.dataset.nodeKey : null;
      const scrollTop = changedWorkspace ? 0 : scroll?.scrollTop || 0;
      closeMenu();
      if (changedWorkspace) { expanded.clear(); focusKey = ''; workspace = workspaceKey; }
      selected = selectedPath || '';
      const branches = new Map(), roots = [], used = new Set();
      for (const file of files) {
        if (!file || typeof file.path !== 'string' || !file.path || used.has(file.path)) continue;
        used.add(file.path);
        const parts = file.path.split('/').filter(Boolean);
        if (!parts.length) continue;
        let children = roots, parents = [];
        for (let index = 0; index < parts.length - 1; index++) {
          const path = parts.slice(0, index + 1).join('/');
          let branch = branches.get(path);
          if (!branch) {
            branch = { key: `folder:${path}`, path, name: parts[index], folder: true, children: [], parents: [...parents] };
            branches.set(path, branch); children.push(branch);
            if (changedWorkspace || !rows.has(branch.key)) expanded.add(path);
          }
          children = branch.children; parents = [...parents, path];
        }
        children.push({ key: `file:${file.path}`, path: file.path, name: parts[parts.length - 1], folder: false, file, parents });
      }
      const ordered = [];
      function visit(children) {
        children.sort((a, b) => Number(b.folder) - Number(a.folder) || a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));
        for (const node of children) { ordered.push(node); if (node.folder) visit(node.children); }
      }
      visit(roots);
      const keys = new Set(ordered.map(node => node.key));
      for (const [key, item] of rows) if (!keys.has(key)) { item.row.remove(); rows.delete(key); }
      for (const [index, node] of ordered.entries()) {
        let item = rows.get(node.key);
        if (!item) { item = makeRow(node); rows.set(node.key, item); }
        Object.assign(node, item);
        node.row.classList.toggle('workspace-tree-folder', node.folder);
        node.row.classList.toggle('workspace-tree-file', !node.folder);
        node.row.setAttribute('aria-level', String(node.parents.length + 1));
        node.row.setAttribute('aria-label', node.folder ? uiText`${node.name}, folder` : uiText`${node.name}, ${node.file.size || 0} bytes`);
        node.row.title = node.path;
        node.row.dataset[node.folder ? 'folderPath' : 'filePath'] = node.path;
        node.row.style.setProperty('--tree-depth', node.parents.length);
        node.label.textContent = node.name;
        if (!node.folder) node.icon.textContent = '▪';
        node.size.textContent = node.folder ? '' : node.file.size < 1024 ? `${node.file.size} B` : `${(node.file.size / 1024).toFixed(1)} KiB`;
        if (container.children[index] !== node.row) container.insertBefore(node.row, container.children[index] || null);
      }
      nodes = ordered;
      if (activeKey) focusKey = activeKey;
      refresh();
      if (activeKey) focus(visible().find(node => node.key === focusKey));
      if (scroll) scroll.scrollTop = scrollTop;
    }

    // Function Tree Selection
    container.addEventListener('click', event => {
      const row = event.target.closest('tr[data-node-key]');
      const node = nodes.find(item => item.row === row);
      if (!node || blocked()) return;
      focus(node);
      if (node.folder) { if (expanded.has(node.path)) expanded.delete(node.path); else expanded.add(node.path); refresh(); }
      else act('edit', node.file);
    });
    container.addEventListener('contextmenu', event => {
      const node = nodes.find(item => item.row === event.target.closest('tr[data-node-key]'));
      if (!node) return;
      event.preventDefault(); event.stopPropagation();
      showMenu(node, event.clientX, event.clientY);
    });
    container.addEventListener('keydown', event => {
      const node = nodes.find(item => item.row === event.target.closest('tr[data-node-key]'));
      if (!node || blocked()) return;
      const items = visible(), index = items.indexOf(node);
      let next;
      if (event.key === 'ArrowDown') next = items[index + 1];
      else if (event.key === 'ArrowUp') next = items[index - 1];
      else if (event.key === 'Home') next = items[0];
      else if (event.key === 'End') next = items[items.length - 1];
      else if (event.key === 'ArrowRight') {
        if (node.folder && !expanded.has(node.path)) { expanded.add(node.path); refresh(); }
        else if (node.folder) next = items[index + 1];
      } else if (event.key === 'ArrowLeft') {
        if (node.folder && expanded.has(node.path)) { expanded.delete(node.path); refresh(); }
        else next = items.find(item => item.folder && item.path === node.parents[node.parents.length - 1]);
      } else if (event.key === 'Enter' || event.key === ' ') {
        if (node.folder) { if (expanded.has(node.path)) expanded.delete(node.path); else expanded.add(node.path); refresh(); }
        else act('edit', node.file);
      } else if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
        const rect = node.row.getBoundingClientRect(); showMenu(node, rect.left + 20, rect.bottom);
      } else return;
      event.preventDefault();
      if (next) { focus(next); next.row.scrollIntoView?.({ block: 'nearest' }); }
    });

    // Function Menu Actions
    menu.addEventListener('click', event => {
      const button = event.target.closest('button[data-action]');
      if (!button || button.disabled || !menuFile) return;
      const file = menuFile; closeMenu(true); act(button.dataset.action, file);
    });
    menu.addEventListener('keydown', event => {
      if (event.key === 'Escape') { event.preventDefault(); closeMenu(true); return; }
      if (event.key === 'Tab') { closeMenu(); return; }
      const buttons = [...menu.querySelectorAll('button:not(:disabled)')];
      const index = buttons.indexOf(document.activeElement);
      let next;
      if (event.key === 'ArrowDown') next = buttons[(index + 1) % buttons.length];
      else if (event.key === 'ArrowUp') next = buttons[(index - 1 + buttons.length) % buttons.length];
      else if (event.key === 'Home') next = buttons[0];
      else if (event.key === 'End') next = buttons[buttons.length - 1];
      if (next) { event.preventDefault(); next.focus(); }
    });
    document.addEventListener('click', event => { if (!menu.contains(event.target)) closeMenu(); });
    document.addEventListener('scroll', () => closeMenu(), true);
    window.addEventListener('resize', () => closeMenu());
    return {
      render,
      setBusy(value) { busy = Boolean(value); if (busy) closeMenu(); refresh(); },
      reset() { closeMenu(); container.replaceChildren(); rows.clear(); expanded.clear(); nodes = []; workspace = null; focusKey = ''; selected = ''; if (scroll) scroll.scrollTop = 0; },
    };
  }
  return { create };
});
