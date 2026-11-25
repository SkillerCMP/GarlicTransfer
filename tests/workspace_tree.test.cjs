const test = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
const { create } = require('../electron/workspace_tree.js');

// Function Tree Fixture
function fixture(t, busy = () => false) {
  const dom = new JSDOM('<div class="workspace-files"><table><tbody id="workspaceFiles"></tbody></table></div>');
  t.after(() => dom.window.close());
  const document = dom.window.document, container = document.getElementById('workspaceFiles');
  const opened = [], actions = [];
  const tree = create(document, container, { onOpen: file => opened.push(file), onAction: (action, file) => actions.push([action, file]), isBusy: busy });
  const file = path => [...container.querySelectorAll('tr[data-file-path]')].find(row => row.dataset.filePath === path);
  const folder = path => [...container.querySelectorAll('tr[data-folder-path]')].find(row => row.dataset.folderPath === path);
  const key = (row, value, options = {}) => row.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: value, bubbles: true, cancelable: true, ...options }));
  const context = row => row.dispatchEvent(new dom.window.MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 10000, clientY: 10000 }));
  return { dom, document, container, tree, opened, actions, file, folder, key, context, menu: document.getElementById('workspaceFileContextMenu') };
}
const files = () => [
  { path: 'sdimg_sce_sdmemory/memory.dat', size: 8192, protected: false },
  { path: 'sdimg_sce_sdmemory/nested/config.bin', size: 12, protected: false },
  { path: 'sdimg_sce_sdmemory/sce_sys/icon0.png', size: 1024, protected: true },
  { path: 'root.dat', size: 3, protected: false },
];

test('file paths become nested folder rows with sizes and treegrid semantics', t => {
  const f = fixture(t), input = files();
  f.tree.render(input, input[0].path, 'save-1');
  assert.equal(f.container.closest('table').getAttribute('role'), 'treegrid');
  assert.equal(f.container.getAttribute('role'), 'rowgroup');
  assert.equal(f.container.querySelectorAll('tr[data-folder-path]').length, 3);
  assert.equal(f.container.querySelectorAll('tr[data-file-path]').length, 4);
  assert.equal(f.folder('sdimg_sce_sdmemory').getAttribute('aria-level'), '1');
  assert.equal(f.folder('sdimg_sce_sdmemory/nested').getAttribute('aria-level'), '2');
  const memory = f.file(input[0].path);
  assert.equal(memory.getAttribute('aria-level'), '2');
  assert.equal(memory.getAttribute('aria-selected'), 'true');
  assert.equal(memory.querySelector('.workspace-tree-label').textContent, 'memory.dat');
  assert.equal(memory.querySelector('.workspace-tree-size').textContent, '8.0 KiB');
  assert.equal(memory.title, input[0].path);
  assert.equal(memory.getAttribute('role'), 'row');
  assert.equal(memory.querySelector('td').getAttribute('role'), 'gridcell');
  assert.equal(f.container.querySelectorAll('[tabindex="0"]').length, 1);
});

test('folder toggles hide descendants without opening a file or removing its row', t => {
  const f = fixture(t), input = files(); f.tree.render(input, '', 'save');
  const root = f.folder('sdimg_sce_sdmemory'), memory = f.file(input[0].path);
  root.click();
  assert.equal(root.getAttribute('aria-expanded'), 'false');
  assert.equal(memory.hidden, true);
  assert.equal(f.folder('sdimg_sce_sdmemory/nested').hidden, true);
  assert.equal(f.file('root.dat').hidden, false);
  assert.deepEqual(f.opened, []);
  root.click();
  assert.equal(memory.hidden, false);
  assert.equal(f.file(input[0].path), memory);
  assert.equal(root.getAttribute('aria-expanded'), 'true');
});

test('click, Enter and Space open only the requested leaf with current file data', t => {
  const f = fixture(t), input = files(); f.tree.render(input, '', 'save');
  const memory = f.file(input[0].path);
  memory.click(); f.key(memory, 'Enter'); f.key(memory, ' ');
  assert.deepEqual(f.opened, [input[0], input[0], input[0]]);
  const refreshed = input.map(file => ({ ...file, size: file.size + 1 }));
  f.tree.render(refreshed, input[0].path, 'save'); memory.click();
  assert.equal(f.opened[3], refreshed[0]);
});

test('right-click Replace targets a leaf without opening or reading it first', t => {
  const f = fixture(t), input = files(); f.tree.render(input, '', 'save');
  const row = f.file(input[0].path);
  assert.equal(f.context(row), false);
  assert.equal(f.menu.parentElement, f.document.body);
  assert.equal(f.menu.hidden, false);
  assert.equal(f.opened.length, 0);
  assert.ok(parseInt(f.menu.style.left, 10) >= 8);
  assert.ok(parseInt(f.menu.style.left, 10) + 200 <= f.dom.window.innerWidth);
  assert.ok(parseInt(f.menu.style.top, 10) + 164 <= f.dom.window.innerHeight);
  f.menu.querySelector('[data-action="replace"]').click();
  assert.deepEqual(f.actions, [['replace', input[0]]]);
  assert.deepEqual(f.opened, []);
  assert.equal(f.menu.hidden, true);
  assert.equal(f.document.activeElement, row);
});

test('protected files allow editing, replacement and export while only Delete is disabled', t => {
  const f = fixture(t), input = files(); f.tree.render(input, '', 'save');
  const protectedFile = input[2], row = f.file(protectedFile.path);
  for (const action of ['replace', 'export']) {
    f.context(row);
    assert.equal(f.menu.querySelector('[data-action="delete"]').disabled, true);
    assert.equal(f.menu.querySelector(`[data-action="${action}"]`).disabled, false);
    f.menu.querySelector(`[data-action="${action}"]`).click();
  }
  f.context(row); f.menu.querySelector('[data-action="edit"]').click();
  assert.deepEqual(f.actions, [['replace', protectedFile], ['export', protectedFile]]);
  assert.deepEqual(f.opened, [protectedFile]);
  f.context(f.file(input[0].path)); f.menu.querySelector('[data-action="delete"]').click();
  assert.deepEqual(f.actions[2], ['delete', input[0]]);
  f.context(f.folder('sdimg_sce_sdmemory'));
  assert.equal(f.menu.hidden, true);
});

test('tree keyboard navigation expands, collapses, moves focus and uses one tab stop', t => {
  const f = fixture(t), input = files(); f.tree.render(input, '', 'save');
  const root = f.folder('sdimg_sce_sdmemory'), nested = f.folder('sdimg_sce_sdmemory/nested');
  root.focus(); f.key(root, 'ArrowLeft');
  assert.equal(root.getAttribute('aria-expanded'), 'false');
  f.key(root, 'ArrowRight');
  assert.equal(root.getAttribute('aria-expanded'), 'true');
  f.key(root, 'ArrowRight'); assert.equal(f.document.activeElement, nested);
  f.key(nested, 'ArrowLeft'); assert.equal(nested.getAttribute('aria-expanded'), 'false');
  f.key(nested, 'ArrowLeft'); assert.equal(f.document.activeElement, root);
  f.key(root, 'End'); assert.equal(f.document.activeElement, f.file('root.dat'));
  f.key(f.file('root.dat'), 'Home'); assert.equal(f.document.activeElement, root);
  f.key(root, 'ArrowDown'); assert.equal(f.document.activeElement, nested);
  f.key(nested, 'ArrowUp'); assert.equal(f.document.activeElement, root);
  assert.equal(f.container.querySelectorAll('[tabindex="0"]').length, 1);
  assert.equal(root.tabIndex, 0);
});

test('keyboard context menus navigate actions, Escape restores row focus and outside events close', t => {
  const f = fixture(t), input = files(); f.tree.render(input, '', 'save');
  const row = f.file(input[2].path); row.focus();
  f.key(row, 'F10', { shiftKey: true });
  assert.equal(f.menu.hidden, false);
  assert.equal(f.document.activeElement.dataset.action, 'edit');
  f.key(f.document.activeElement, 'ArrowDown'); assert.equal(f.document.activeElement.dataset.action, 'replace');
  f.key(f.document.activeElement, 'End'); assert.equal(f.document.activeElement.dataset.action, 'export');
  f.key(f.document.activeElement, 'Escape');
  assert.equal(f.menu.hidden, true); assert.equal(f.document.activeElement, row);
  f.key(row, 'ContextMenu'); assert.equal(f.menu.hidden, false);
  f.document.body.click(); assert.equal(f.menu.hidden, true);
  f.context(row); f.container.parentElement.dispatchEvent(new f.dom.window.Event('scroll')); assert.equal(f.menu.hidden, true);
  f.context(row); f.dom.window.dispatchEvent(new f.dom.window.Event('resize')); assert.equal(f.menu.hidden, true);
});

test('busy work blocks leaf, folder and menu actions and closes a visible menu', t => {
  let externalBusy = false;
  const f = fixture(t, () => externalBusy), input = files(); f.tree.render(input, '', 'save');
  const row = f.file(input[0].path), folder = f.folder('sdimg_sce_sdmemory');
  f.context(row); f.tree.setBusy(true);
  assert.equal(f.menu.hidden, true);
  row.click(); f.key(row, 'Enter'); folder.click(); f.context(row);
  assert.deepEqual(f.opened, []); assert.deepEqual(f.actions, []);
  assert.equal(folder.getAttribute('aria-expanded'), 'true');
  assert.equal(row.getAttribute('aria-disabled'), 'true');
  assert.equal(f.menu.hidden, true);
  f.tree.setBusy(false); f.context(row); externalBusy = true;
  f.menu.querySelector('[data-action="replace"]').click();
  assert.deepEqual(f.actions, []);
});

test('refresh preserves expansion, row identity, focus and scroll within a workspace', t => {
  const f = fixture(t), input = files(); f.tree.render(input, '', 'save');
  const root = f.folder('sdimg_sce_sdmemory'), memory = f.file(input[0].path);
  root.click(); const scroll = f.container.closest('.workspace-files'); scroll.scrollTop = 73;
  f.tree.render(input.map(file => ({ ...file, size: file.size + 4 })), '', 'save');
  assert.equal(f.folder('sdimg_sce_sdmemory'), root);
  assert.equal(f.file(input[0].path), memory);
  assert.equal(root.getAttribute('aria-expanded'), 'false');
  assert.equal(memory.hidden, true);
  assert.equal(f.document.activeElement, root);
  assert.equal(scroll.scrollTop, 73);
  f.tree.render(input, input[0].path, 'different-save');
  assert.equal(root.getAttribute('aria-expanded'), 'true');
  assert.equal(memory.hidden, false);
  assert.equal(scroll.scrollTop, 0);
});

test('removed files leave no stale action and reset clears the workspace', t => {
  const f = fixture(t), input = files(); f.tree.render(input, '', 'save');
  const removed = f.file(input[0].path); removed.focus(); f.context(removed);
  f.tree.render(input.slice(1), '', 'save');
  assert.equal(f.menu.hidden, true);
  assert.equal(removed.isConnected, false);
  f.tree.reset();
  assert.equal(f.container.children.length, 0);
  assert.equal(f.menu.hidden, true);
  f.tree.render(input, '', 'save');
  assert.equal(f.folder('sdimg_sce_sdmemory').getAttribute('aria-expanded'), 'true');
});

test('file names use safe text and duplicate paths do not create duplicate leaves', t => {
  const f = fixture(t), value = { path: '<img src=x>/"memory".dat', size: 1 };
  f.tree.render([value, value, { path: '', size: 0 }, null], '', 'save');
  assert.equal(f.container.querySelectorAll('tr[data-file-path]').length, 1);
  assert.equal(f.container.querySelector('img'), null);
  assert.equal(f.folder('<img src=x>').querySelector('.workspace-tree-label').textContent, '<img src=x>');
  assert.equal(f.file(value.path).querySelector('.workspace-tree-label').textContent, '"memory".dat');
  f.file(value.path).click(); assert.equal(f.opened[0], value);
});
