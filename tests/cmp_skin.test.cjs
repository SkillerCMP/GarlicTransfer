const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM, VirtualConsole } = require('jsdom');
const { groupEntries, createTree } = require('../electron/cmp_skin.js');
const sourceRoot = path.join(__dirname, '..');
const tick = () => new Promise((resolve) => setTimeout(resolve, 30));

// Function Test Console
async function discoverConsole(document) {
  document.getElementById('discoverBtn').click(); await tick();
  const ofw = document.querySelector('#consoleLocatorRows input[data-role="ofw"][value="192.168.0.125"]');
  assert.ok(ofw, 'The discovered fixture PS5 was unavailable as an OFW target');
  ofw.click(); await tick();
  assert.equal(document.getElementById('consoleSelect').value, '192.168.0.125');
}

async function app() {
  const errors = [];
  const virtualConsole = new VirtualConsole();
  virtualConsole.on('jsdomError', (error) => errors.push(error));
  const dom = new JSDOM(fs.readFileSync(path.join(sourceRoot, 'electron/index.html'), 'utf8'), {
    url: `file://${path.join(sourceRoot, 'electron/index.html')}`, runScripts: 'dangerously', resources: 'usable', virtualConsole,
    beforeParse(window) {
      window.eval(fs.readFileSync(path.join(__dirname, 'fixtures/cmp_bridge.js'), 'utf8'));
      const loader = require('../electron/skins.cjs');
      const bundled = path.join(sourceRoot, 'electron/skins');
      window.saveTransfer.getSkins = async () => loader.loadSkins(bundled, '/nonexistent');
      window.saveTransfer.getSkinMascot = async (id) => loader.getSkinMascot(bundled, '/nonexistent', id);
      window.saveTransfer.openSkinsFolder = async () => '/Skins';
    },
  });
  await new Promise((resolve) => dom.window.addEventListener('load', resolve, { once: true }));
  await tick();
  assert.deepEqual(errors.map((error) => error.message), []);
  return { dom, window: dom.window, document: dom.window.document, errors };
}

test('tree keeps same-title saves separated by user and supports partial selection', () => {
  const dom = new JSDOM('<div id="tree"></div>');
  try {
    const root = dom.window.document.getElementById('tree');
    const selected = new Set();
    const entries = [{ id: 1, owner: 'A', title: 'PPSA12345' }, { id: 2, owner: 'A', title: 'PPSA54321' }, { id: 3, owner: 'B', title: 'PPSA12345' }];
    assert.equal(groupEntries(entries).size, 2);
    const tree = createTree(root);
    tree.render({ entries, selected: () => [...selected], onToggle: (ids, value) => ids.forEach((id) => value ? selected.add(id) : selected.delete(id)) });
    const checks = root.querySelectorAll('input');
    checks[1].click();
    assert.deepEqual([...selected], ['1']);
    assert.equal(checks[0].indeterminate, true);
    checks[0].click();
    assert.deepEqual([...selected], ['1', '2']);
    assert.equal(checks[0].indeterminate, false);
    tree.setBusy(true);
    assert.ok([...root.querySelectorAll('input')].every((check) => check.disabled));
  } finally { dom.window.close(); }
});

test('layout switches persist and Classic remains available', async () => {
  const { dom, window, document, errors } = await app();
  try {
    assert.equal(document.body.dataset.layout, 'cmp');
    assert.equal(document.querySelector('[data-page="download"]').textContent, 'PS5 to PC');
    const select = document.getElementById('uiLayout');
    select.value = 'classic'; select.dispatchEvent(new window.Event('change')); await tick();
    assert.equal(document.body.dataset.layout, 'classic');
    assert.equal(document.querySelector('[data-page="download"]').textContent, 'Download');
    assert.equal(window.cmpFixture.settings.uiLayout, 'classic');
    select.value = 'cmp'; select.dispatchEvent(new window.Event('change')); await tick();
    assert.equal(window.cmpFixture.settings.uiLayout, 'cmp');
    select.value = 'evil'; select.dispatchEvent(new window.Event('change')); await tick();
    assert.equal(window.cmpFixture.settings.uiLayout, 'evil');
    assert.equal(document.body.dataset.skin, 'evil');
    assert.equal(document.body.dataset.layout, 'cmp');
    assert.ok(document.querySelector('.cmp-brand img').getAttribute('src').startsWith('data:image/png;base64,'));
    select.value = 'green'; select.dispatchEvent(new window.Event('change')); await tick();
    assert.equal(window.cmpFixture.settings.uiLayout, 'green');
    assert.equal(document.body.dataset.skin, 'green');
    assert.equal(document.body.dataset.layout, 'cmp');
    assert.ok(document.querySelector('.cmp-brand img').getAttribute('src').startsWith('data:image/png;base64,'));
    select.value = 'halo'; select.dispatchEvent(new window.Event('change')); await tick();
    assert.equal(window.cmpFixture.settings.uiLayout, 'halo');
    assert.equal(document.body.dataset.skin, 'halo');
    assert.equal(document.body.dataset.layout, 'cmp');
    assert.ok(document.querySelector('.cmp-brand img').getAttribute('src').startsWith('data:image/png;base64,'));
    select.value = 'chill'; select.dispatchEvent(new window.Event('change')); await tick();
    assert.equal(window.cmpFixture.settings.uiLayout, 'chill');
    assert.equal(document.body.dataset.layout, 'cmp');
    assert.equal(document.body.dataset.skin, 'chill');
    assert.ok(document.querySelector('.cmp-brand img').getAttribute('src').startsWith('data:image/png;base64,'));
    assert.ok(document.querySelector('.cmp-brand').textContent.includes('Onion'));
    select.value = 'cmp'; select.dispatchEvent(new window.Event('change')); await tick();
    assert.equal(document.body.dataset.skin, 'cmp');
    assert.ok(document.querySelector('.cmp-brand img').getAttribute('src').startsWith('data:image/png;base64,'));
    assert.equal(errors.length, 0);
  } finally { dom.window.close(); }
});

test('remote tree filters owners and forwards original download entry IDs', async () => {
  const { dom, window, document, errors } = await app();
  try {
    await discoverConsole(document);
    document.querySelector('[data-page="download"]').click();
    document.getElementById('downloadBtn').click(); await tick();
    const remote = document.getElementById('cmpRemoteTree');
    assert.ok(remote.textContent.includes('Alex'));
    assert.ok(remote.textContent.includes('Taylor'));
    assert.equal(remote.querySelectorAll('.cmp-file').length, 6);
    const filter = document.getElementById('cmpUserSelect');
    filter.value = '22aabbcc'; filter.dispatchEvent(new window.Event('change'));
    assert.ok(remote.textContent.includes('Taylor'));
    assert.ok(!remote.textContent.includes('Alex'));
    remote.querySelector('.cmp-check').click();
    document.getElementById('downloadSelectedBtn').click(); await tick();
    assert.deepEqual(Array.from(window.cmpFixture.calls.downloads.at(-1)), [124]);
    assert.equal(errors.length, 0);
  } finally { dom.window.close(); }
});

test('upload tree selects source entries without changing destination user', async () => {
  const { dom, window, document, errors } = await app();
  try {
    await discoverConsole(document);
    document.querySelector('[data-page="upload"]').click();
    document.getElementById('uploadBtn').click(); await tick();
    const destination = document.getElementById('userSelect');
    destination.value = '18c60ea2';
    const filter = document.getElementById('cmpUserSelect');
    filter.value = '22aabbcc'; filter.dispatchEvent(new window.Event('change'));
    document.getElementById('cmpUploadTree').querySelector('.cmp-check').click();
    assert.equal(destination.value, '18c60ea2');
    assert.deepEqual([...document.getElementById('uploadSaveSelect').selectedOptions].map((option) => option.value), ['124']);
    document.getElementById('confirmUploadBtn').click(); await tick();
    const upload = window.cmpFixture.calls.uploads[0];
    assert.deepEqual(Array.from(upload.entryIds), [124]);
    assert.equal(upload.userId, '18c60ea2');
    assert.equal(errors.length, 0);
  } finally { dom.window.close(); }
});

test('local tree opens Garlic actions and external-folder upload stays supported', async () => {
  const { dom, window, document, errors } = await app();
  try {
    document.querySelector('[data-page="library"]').click(); await tick(); await tick();
    const local = document.getElementById('cmpLibraryTree');
    assert.equal(local.querySelectorAll('.cmp-file').length, 6);
    const file = local.querySelector('.cmp-file-open');
    file.dispatchEvent(new window.MouseEvent('contextmenu', { bubbles: true, clientX: 30, clientY: 30 }));
    const exportAction = [...document.querySelectorAll('.cmp-context button')].find((button) => button.textContent === 'Export original');
    assert.ok(exportAction); exportAction.click(); await tick();
    assert.equal(window.cmpFixture.calls.exports[0].filename, 'sdimg_DATA');
    await discoverConsole(document);
    document.querySelector('[data-page="upload"]').click();
    document.getElementById('uploadBtn').click(); await tick();
    document.getElementById('addExternalFolderBtn').click(); await tick();
    assert.ok(document.getElementById('cmpUploadTree').textContent.includes('PPSA99999'));
    document.getElementById('confirmUploadBtn').click(); await tick();
    const upload = window.cmpFixture.calls.uploads[0];
    assert.equal(upload.uploadKind, 'external'); assert.equal(upload.externalImage, '/external/PPSA99999');
    assert.equal(errors.length, 0);
  } finally { dom.window.close(); }
});

test('external skins reload, persist and render names as plain text', async () => {
  const { dom, window, document, errors } = await app();
  try {
    const original = await window.saveTransfer.getSkins();
    const custom = { ...original.skins[0], id: 'ext-custom', name: '<b>Custom Onion</b>', colors: { ...original.skins[0].colors, gold: '#aa9900' } };
    window.saveTransfer.getSkins = async () => ({ ...original, skins: [...original.skins, custom] });
    document.getElementById('reloadSkins').click(); await tick();
    const select = document.getElementById('uiLayout');
    select.value = custom.id; select.dispatchEvent(new window.Event('change')); await tick();
    assert.equal(window.cmpFixture.settings.uiLayout, custom.id);
    assert.equal(document.body.style.getPropertyValue('--gold'), '#aa9900');
    assert.ok(document.querySelector('.cmp-brand').textContent.includes(custom.name));
    assert.equal(document.querySelector('.cmp-brand b'), null);
    document.getElementById('reloadSkins').click(); await tick();
    assert.equal(select.value, custom.id);
    window.saveTransfer.getSkins = async () => original;
    document.getElementById('reloadSkins').click(); await tick();
    assert.equal(select.value, 'classic');
    assert.equal(document.body.dataset.layout, 'classic');
    assert.equal(document.body.style.getPropertyValue('--gold'), '');
    assert.equal(errors.length, 0);
  } finally { dom.window.close(); }
});

test('latest reload wins and older failures cannot overwrite its status', async () => {
  const { dom, window, document } = await app();
  try {
    const catalog = await window.saveTransfer.getSkins();
    const pending = [];
    window.saveTransfer.getSkins = () => new Promise((resolve, reject) => pending.push({ resolve, reject }));
    const button = document.getElementById('reloadSkins');
    button.click(); button.click();
    pending[1].resolve({ ...catalog, skins: [{ ...catalog.skins[0], id: 'ext-latest', name: 'Latest' }] }); await tick();
    pending[0].reject(new Error('Old failure')); await tick();
    assert.ok([...document.getElementById('uiLayout').options].some((o) => o.value === 'ext-latest'));
    assert.ok(!document.getElementById('layoutStatus').textContent.includes('Old failure'));
    button.click(); button.click();
    pending[3].resolve(catalog); await tick();
    pending[2].resolve({ skins: [], warnings: [] }); await tick();
    assert.equal(document.getElementById('uiLayout').options.length, 6);
  } finally { dom.window.close(); }
});

test('changing skins during a reload keeps the latest user choice', async () => {
  const { dom, window, document } = await app();
  try {
    const catalog = await window.saveTransfer.getSkins();
    let finish;
    window.saveTransfer.getSkins = () => new Promise((resolve) => { finish = resolve; });
    document.getElementById('reloadSkins').click();
    const select = document.getElementById('uiLayout');
    select.value = 'chill'; select.dispatchEvent(new window.Event('change')); await tick();
    finish(catalog); await tick();
    assert.equal(select.value, 'chill');
    assert.equal(document.body.dataset.skin, 'chill');
    assert.equal(window.cmpFixture.settings.uiLayout, 'chill');
  } finally { dom.window.close(); }
});

test('color changes and reloads preserve remote, upload and local tree nodes and position', async () => {
  const { dom, window, document } = await app();
  try {
    await discoverConsole(document);
    document.querySelector('[data-page="download"]').click();
    document.getElementById('downloadBtn').click(); await tick();
    document.getElementById('finishBtn').click(); await tick();
    document.querySelector('[data-page="upload"]').click();
    document.getElementById('uploadBtn').click(); await tick();
    document.getElementById('uploadModalCloseBtn').click();
    document.querySelector('[data-page="library"]').click(); await tick(); await tick();
    const trees = ['cmpRemoteTree', 'cmpUploadTree', 'cmpLibraryTree'].map((id) => document.getElementById(id));
    const snapshots = trees.map((tree) => {
      const branch = tree.querySelector('details');
      assert.ok(branch, tree.id);
      branch.open = false; tree.scrollTop = 75;
      return { content: tree.firstElementChild, branch, scroll: tree.scrollTop };
    });
    const focused = document.getElementById('cmpLibraryTree').querySelector('summary'); focused.focus();
    const select = document.getElementById('uiLayout');
    select.value = 'chill'; select.dispatchEvent(new window.Event('change')); await tick();
    document.getElementById('reloadSkins').click(); await tick();
    trees.forEach((tree, index) => {
      assert.equal(tree.firstElementChild, snapshots[index].content);
      assert.equal(tree.querySelector('details'), snapshots[index].branch);
      assert.equal(tree.querySelector('details').open, false);
      assert.equal(tree.scrollTop, snapshots[index].scroll);
    });
    assert.equal(document.activeElement, focused);
    document.querySelector('[data-page="settings"]').click();
    select.value = 'evil'; select.dispatchEvent(new window.Event('change')); await tick();
    trees.forEach((tree, index) => assert.equal(tree.firstElementChild, snapshots[index].content));
  } finally { dom.window.close(); }
});

test('skin warnings remain visible after saving and options sort by display name', async () => {
  const { dom, window, document } = await app();
  try {
    const original = await window.saveTransfer.getSkins();
    window.saveTransfer.getSkins = async () => ({ ...original, skins: original.skins.slice().reverse(), warnings: ['Example invalid color warning'] });
    document.getElementById('reloadSkins').click(); await tick();
    const select = document.getElementById('uiLayout');
    const names = [...select.options].slice(1).map((option) => option.textContent);
    assert.deepEqual(names, names.slice().sort(new Intl.Collator(undefined, { sensitivity: 'base', numeric: true }).compare));
    select.value = 'chill'; select.dispatchEvent(new window.Event('change')); await tick();
    assert.equal(document.getElementById('layoutStatus').textContent, 'Skin saved.');
    assert.equal(document.getElementById('skinWarnings').hidden, false);
    assert.ok(document.getElementById('skinWarningList').textContent.includes('Example invalid color warning'));
    window.saveTransfer.getSkins = async () => original;
    document.getElementById('reloadSkins').click(); await tick();
    assert.equal(document.getElementById('skinWarnings').hidden, true);
  } finally { dom.window.close(); }
});

test('mascots load only on selection and stale artwork cannot replace a newer skin', async () => {
  const { dom, window, document } = await app();
  try {
    const select = document.getElementById('uiLayout');
    const calls = [];
    window.saveTransfer.getSkinMascot = (id) => new Promise((resolve) => calls.push({ id, resolve }));
    const original = await window.saveTransfer.getSkins();
    assert.ok(original.skins.every((skin) => !skin.mascot));
    select.value = 'classic'; select.dispatchEvent(new window.Event('change')); await tick();
    document.getElementById('reloadSkins').click(); await tick();
    assert.equal(calls.length, 0);
    select.value = 'evil'; select.dispatchEvent(new window.Event('change'));
    select.value = 'chill'; select.dispatchEvent(new window.Event('change'));
    assert.deepEqual(calls.map((call) => call.id), ['evil', 'chill']);
    calls[1].resolve({ mascot: 'data:image/png;base64,bmV3', warnings: [] }); await tick();
    calls[0].resolve({ mascot: 'data:image/png;base64,b2xk', warnings: ['Obsolete mascot warning'] }); await tick();
    assert.equal(document.querySelector('.cmp-brand img').getAttribute('src'), 'data:image/png;base64,bmV3');
    assert.ok(!document.getElementById('skinWarningList').textContent.includes('Obsolete mascot warning'));
  } finally { dom.window.close(); }
});

test('unchanged reload keeps the current mascot and changed artwork revision reloads it', async () => {
  const { dom, window, document } = await app();
  try {
    const original = await window.saveTransfer.getSkins();
    const realMascot = window.saveTransfer.getSkinMascot;
    const calls = [];
    window.saveTransfer.getSkinMascot = async (id) => { calls.push(id); return realMascot(id); };
    const image = document.querySelector('.cmp-brand img');
    const initial = image.getAttribute('src');
    document.getElementById('reloadSkins').click(); await tick();
    assert.deepEqual(calls, []);
    assert.equal(image.getAttribute('src'), initial);
    window.saveTransfer.getSkins = async () => ({ ...original, skins: original.skins.map((skin) => skin.id === 'cmp' ? { ...skin, mascotRevision: skin.mascotRevision + '-edited' } : skin) });
    document.getElementById('reloadSkins').click(); await tick();
    assert.deepEqual(calls, ['cmp']);
  } finally { dom.window.close(); }
});

test('sidebar skin selector sits below source users and saves each selection once', async () => {
  const { dom, window, document, errors } = await app();
  try {
    const sidebar = document.getElementById('uiLayout');
    const panel = document.getElementById('sidebarSkinPanel');
    const source = document.getElementById('cmpUserPanel');
    assert.ok(sidebar.closest('.sidebar'));
    assert.equal(document.getElementById('settingsPage').querySelector('#uiLayout'), null);
    assert.equal(document.querySelectorAll('#uiLayout').length, 1);
    assert.equal(panel.previousElementSibling, source);
    const before = window.cmpFixture.calls.settings.length;
    sidebar.value = 'chill'; sidebar.dispatchEvent(new window.Event('change')); await tick();
    assert.equal(document.body.dataset.skin, 'chill');
    assert.equal(window.cmpFixture.settings.uiLayout, 'chill');
    assert.equal(window.cmpFixture.calls.settings.length, before + 1);
    assert.equal(document.getElementById('layoutStatus').textContent, 'Skin saved.');
    sidebar.value = 'green'; sidebar.dispatchEvent(new window.Event('change')); await tick();
    assert.equal(document.body.dataset.skin, 'green');
    assert.equal(window.cmpFixture.calls.settings.length, before + 2);
    assert.deepEqual(errors, []);
  } finally { dom.window.close(); }
});

test('sidebar Open and Reload use one folder action and preserve sorted skin choices', async () => {
  const { dom, window, document } = await app();
  try {
    const sidebar = document.getElementById('uiLayout');
    sidebar.value = 'evil'; sidebar.dispatchEvent(new window.Event('change')); await tick();
    let opens = 0, reloads = 0;
    const original = await window.saveTransfer.getSkins();
    window.saveTransfer.openSkinsFolder = async () => { opens++; return '/GarlicTransfer/Skins'; };
    window.saveTransfer.getSkins = async () => { reloads++; return original; };
    document.getElementById('openSkinsFolder').click(); await tick();
    assert.equal(opens, 1);
    document.getElementById('reloadSkins').click(); await tick();
    assert.equal(reloads, 1);
    assert.equal(sidebar.value, 'evil');
    const custom = { ...original.skins[0], id: 'ext-added', name: 'Added Onion' };
    window.saveTransfer.getSkins = async () => ({ ...original, skins: [...original.skins.slice().reverse(), custom] });
    document.getElementById('reloadSkins').click(); await tick();
    assert.ok([...sidebar.options].some((option) => option.value === 'ext-added'));
    const names = [...sidebar.options].slice(1).map((option) => option.textContent);
    assert.deepEqual(names, names.slice().sort(new Intl.Collator(undefined, { sensitivity: 'base', numeric: true }).compare));
    assert.equal(sidebar.value, 'evil');
    window.saveTransfer.openSkinsFolder = async () => { throw new Error('Example folder error'); };
    document.getElementById('openSkinsFolder').click(); await tick();
    assert.ok(document.getElementById('layoutStatus').textContent.includes('Example folder error'));
  } finally { dom.window.close(); }
});

test('sidebar selector remains available in Garlic Classic and can restore a tree skin', async () => {
  const { dom, window, document } = await app();
  try {
    const sidebar = document.getElementById('uiLayout');
    sidebar.value = 'classic'; sidebar.dispatchEvent(new window.Event('change')); await tick();
    assert.equal(document.body.dataset.layout, 'classic');
    assert.equal(sidebar.closest('[hidden], .cmp-only'), null);
    sidebar.value = 'halo'; sidebar.dispatchEvent(new window.Event('change')); await tick();
    assert.equal(document.body.dataset.skin, 'halo');
    assert.equal(document.body.dataset.layout, 'cmp');
    assert.equal(window.cmpFixture.settings.uiLayout, 'halo');
  } finally { dom.window.close(); }
});

test('upload checkbox changes keep console and upload tree nodes in place', async () => {
  const { dom, window, document } = await app();
  try {
    await discoverConsole(document);
    document.querySelector('[data-page="upload"]').click();
    document.getElementById('uploadBtn').click(); await tick();
    const remote = document.getElementById('cmpRemoteTree'), upload = document.getElementById('cmpUploadTree');
    const remoteNode = remote.firstElementChild, uploadNode = upload.firstElementChild;
    const checkbox = upload.querySelector('.cmp-check');
    checkbox.click();
    assert.equal(remote.firstElementChild, remoteNode);
    assert.equal(upload.firstElementChild, uploadNode);
    assert.ok(document.getElementById('cmpUploadSummary').textContent.startsWith('2 save entries'));
    checkbox.click();
    assert.equal(upload.firstElementChild, uploadNode);
    assert.ok(document.getElementById('cmpUploadSummary').textContent.startsWith('0 save entries'));
  } finally { dom.window.close(); }
});

test('refreshing the same local profile preserves the selected save', async () => {
  const { dom, document } = await app();
  try {
    document.querySelector('[data-page="library"]').click(); await tick(); await tick();
    document.querySelector('#cmpLibraryTree .cmp-file-open').click();
    const name = document.getElementById('selectedSaveName').textContent;
    assert.equal(document.getElementById('selectedSavePanel').hidden, false);
    document.getElementById('refreshMySavesBtn').click(); await tick(); await tick();
    assert.equal(document.getElementById('selectedSavePanel').hidden, false);
    assert.equal(document.getElementById('selectedSaveName').textContent, name);
    assert.equal(document.querySelectorAll('#cmpLibraryTree .cmp-file-selected').length, 1);
  } finally { dom.window.close(); }
});

test('an older local inventory cannot replace the newest refresh', async () => {
  const { dom, window, document } = await app();
  try {
    document.querySelector('[data-page="library"]').click(); await tick(); await tick();
    const pending = [];
    window.saveTransfer.localSaves = () => new Promise((resolve) => pending.push(resolve));
    document.dispatchEvent(new window.Event('local-save-replaced'));
    document.dispatchEvent(new window.Event('local-save-replaced'));
    assert.equal(pending.length, 2);
    const entry = window.cmpFixture.local[0];
    pending[1]({ entries: [{ ...entry, files: [{ ...entry.files[0], file: 'newest-save' }] }], warnings: [] }); await tick();
    pending[0]({ entries: [{ ...entry, files: [{ ...entry.files[0], file: 'older-save' }] }], warnings: [] }); await tick();
    assert.ok(document.getElementById('cmpLibraryTree').textContent.includes('newest-save'));
    assert.ok(!document.getElementById('cmpLibraryTree').textContent.includes('older-save'));
  } finally { dom.window.close(); }
});

test('tree mode skips hidden Classic save tables and switching fills current data', async () => {
  const { dom, window, document } = await app();
  try {
    const classicEntries = document.getElementById('entries');
    const placeholder = classicEntries.firstElementChild;
    await discoverConsole(document);
    document.querySelector('[data-page="download"]').click();
    document.getElementById('downloadBtn').click(); await tick();
    assert.equal(classicEntries.firstElementChild, placeholder);
    assert.equal(classicEntries.querySelectorAll('.entry-check').length, 0);
    document.getElementById('finishBtn').click(); await tick();
    document.querySelector('[data-page="library"]').click(); await tick(); await tick();
    assert.equal(document.getElementById('myTitleEntries').querySelectorAll('button').length, 0);
    const select = document.getElementById('uiLayout');
    select.value = 'classic'; select.dispatchEvent(new window.Event('change')); await tick();
    assert.equal(classicEntries.querySelectorAll('.entry-check').length, 3);
    assert.ok(document.getElementById('myTitleEntries').textContent.includes('Adventure Game'));
    const entry = window.cmpFixture.local[0];
    window.saveTransfer.localSaves = async () => ({ entries: [{ ...entry, files: [{ ...entry.files[0], file: 'classic-refresh-save' }] }], warnings: [] });
    document.getElementById('refreshMySavesBtn').click(); await tick(); await tick();
    select.value = 'cmp'; select.dispatchEvent(new window.Event('change')); await tick();
    assert.ok(document.getElementById('cmpLibraryTree').textContent.includes('classic-refresh-save'));
    const classicTitles = document.getElementById('myTitleEntries').firstElementChild;
    document.getElementById('refreshMySavesBtn').click(); await tick(); await tick();
    assert.equal(document.getElementById('myTitleEntries').firstElementChild, classicTitles);
  } finally { dom.window.close(); }
});

test('other content stays available in tree mode', async () => {
  const { dom, window, document } = await app();
  try {
    const extra = { id: 900, owner: '18c60ea2', title: 'PPSA99999', name: 'Application Entry', kind: 'app', size: 4096 };
    window.cmpFixture.emit({ type: 'entries', entries: [...window.cmpFixture.entries, extra], users: window.cmpFixture.users }); await tick();
    assert.equal(document.getElementById('otherBlock').hidden, false);
    assert.ok(document.getElementById('appEntries').textContent.includes('Application Entry'));
    assert.equal(document.getElementById('entries').querySelectorAll('.entry-check').length, 0);
  } finally { dom.window.close(); }
});
