const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM, VirtualConsole } = require('jsdom');

const root = path.join(__dirname, '..');
const CURRENT = '0000000000000001';
const TARGET = '8a7b6c5d4e3f2011';
const OTHER = '1234567890abcdef';
const plain = value => JSON.parse(JSON.stringify(value));
const pause = () => new Promise(resolve => setTimeout(resolve, 10));

// Function Test Waiting
async function until(condition, message) {
  const deadline = Date.now() + 4000;
  while (!condition()) {
    if (Date.now() > deadline) assert.fail(message);
    await pause();
  }
}

// Function Test App
async function app(t, remote, selectedId = TARGET, useCurrent = false, storedState = null) {
  const errors = [];
  const virtualConsole = new VirtualConsole();
  virtualConsole.on('jsdomError', error => errors.push(error.message));
  const info = {
    root: '/app/workspace', titleId: 'PPSA12345', accountId: CURRENT,
    files: [{ path: 'DATA/save.dat', size: 8, protected: false }],
  };
  const state = storedState || { accounts: [{ id: TARGET, name: 'Target account' }, { id: OTHER, name: 'Other account' }], selectedId, displayMode: 'name', useCurrent };
  const calls = { jobs: [], encrypt: [], writes: [], select: [], display: [], add: [], rename: [], closeFlush: null, closeResume: null, chooseInput: 0, releases: [] };
  const dom = new JSDOM(fs.readFileSync(path.join(root, 'electron/index.html'), 'utf8'), {
    url: `file://${path.join(root, 'electron/index.html')}`,
    runScripts: 'dangerously', resources: 'usable', virtualConsole,
    beforeParse(window) {
      window.TextEncoder = TextEncoder;
      window.TextDecoder = TextDecoder;
      window.eval(fs.readFileSync(path.join(__dirname, 'fixtures/cmp_bridge.js'), 'utf8'));
      const loader = require('../electron/skins.cjs');
      const bundled = path.join(root, 'electron/skins');
      window.saveTransfer.getSkins = async () => loader.loadSkins(bundled, '/nonexistent');
      window.saveTransfer.getSkinMascot = async id => loader.getSkinMascot(bundled, '/nonexistent', id);
      window.saveTransfer.openSkinsFolder = async () => '/Skins';
      const getSettings = window.saveTransfer.getSettings;
      window.saveTransfer.getSettings = async () => ({ ...await getSettings(), useRemoteOracle: remote });
      window.saveTransfer.localProfiles = async () => ({ profiles: [] });
      const inventory = {
        root: '/pc/Saves', active: true, warnings: [], users: [{ id: 'unassigned', name: 'Unassigned' }],
        entries: [{ id: 'PPSA12345', owner: 'unassigned', title: 'PPSA12345', name: 'Test Game', localSource: 'pc',
          files: [{ file: 'sdimg_DATA', path: 'PPSA12345/sdimg_DATA', size: 4096, sha256: '' }] }],
      };
      window.saveTransfer.localPcState = async () => ({ root: inventory.root, active: true, warnings: [] });
      window.saveTransfer.localPcInventory = async () => plain(inventory);
      window.saveTransfer.setLocalPcActive = async () => {};
      window.saveTransfer.importLocalSave = async value => {
        window.cmpFixture.calls.imports.push(plain(value));
        return { backup: '/app/backups/original-save' };
      };
      window.saveEditor.localFile = async () => ['/pc/Saves/PPSA12345/sdimg_DATA'];
      window.saveEditor.chooseInput = async () => { calls.chooseInput++; return ['/external/sdimg_DATA']; };
      window.saveEditor.chooseOutput = async () => '/exports/result.zip';
      window.saveEditor.run = async value => {
        calls.jobs.push(plain(value));
        return value.operation === 'decrypt'
          ? { operation: 'decrypt', workspace: info.root, archivePath: '/app/decrypted.zip', info: plain(info), temporaryId: 'workspace-1' }
          : { operation: value.operation, output: '/exports/result.zip' };
      };
      window.saveEditor.encryptLocal = async value => {
        calls.encrypt.push(plain(value));
        return { output: '/app/encrypted/sdimg_DATA', temporaryId: 'encrypted-1' };
      };
      window.saveEditor.read = async () => ({ data: Buffer.from('save data').toString('base64') });
      window.saveEditor.write = async value => { calls.writes.push(plain(value)); return plain(info); };
      window.saveEditor.releaseTemporary = async id => { calls.releases.push(id); return true; };
      window.saveAccounts = {
        onBeforeClose: (flush, resume) => { calls.closeFlush = flush; calls.closeResume = resume; return () => {}; },
        getState: async () => plain(state),
        select: async id => { calls.select.push(id); state.selectedId = id; return plain(state); },
        setUseCurrent: async value => { state.useCurrent = value; return plain(state); },
        setDisplayMode: async mode => { calls.display.push(mode); state.displayMode = mode; return plain(state); },
        add: async (id, name = '') => { calls.add.push({ id, name }); if (!state.accounts.some(account => account.id === id)) state.accounts.push({ id, name }); return plain(state); },
        rename: async (id, name) => { calls.rename.push({ id, name }); state.accounts.find(account => account.id === id).name = name; return plain(state); },
        remove: async id => { state.accounts = state.accounts.filter(account => account.id !== id); if (state.selectedId === id) state.selectedId = ''; return plain(state); },
      };
    },
  });
  t.after(() => dom.window.close());
  await new Promise(resolve => dom.window.addEventListener('load', resolve, { once: true }));
  const document = dom.window.document;
  await until(() => document.querySelector(`#targetAccountSelect option[value="${TARGET}"]`), 'Saved account selector did not load');
  document.querySelector('[data-page="library"]').click();
  await until(() => document.querySelector('#cmpLibraryTree .cmp-file-open'), 'Local PC file did not load');
  const idle = () => until(() => !document.getElementById('refreshMySavesBtn').disabled, 'Save action did not finish');
  async function selectAndDecrypt() {
    document.querySelector('#cmpLibraryTree .cmp-file-open').click();
    await until(() => !document.getElementById('selectedSavePanel').hidden, 'PC save was not selected');
    document.getElementById('mySaveDecryptBtn').click();
    await until(() => document.querySelector('.wizard-panel[data-wizard="2"]').classList.contains('active'), 'Decrypted workspace did not open');
    await idle();
  }
  return { dom, window: dom.window, document, state, calls, errors, info, idle, selectAndDecrypt };
}

for (const remote of [false, true]) {
  test(`saved target reaches Save & encrypt and resign in ${remote ? 'remote' : 'local'} worker mode`, async t => {
    const f = await app(t, remote);
    const { document, calls, window } = f;
    await f.selectAndDecrypt();
    assert.equal(document.getElementById('workspaceAccountId').textContent.includes(CURRENT), true);
    assert.equal(document.getElementById('encryptAccountId').value, TARGET);
    assert.equal(document.getElementById('targetAccountSelect').value, TARGET);

    document.querySelector('#workspaceFiles tr[data-file-path]').click();
    await until(() => !document.getElementById('fileEditorPanel').hidden, 'Workspace editor did not open');
    await f.idle();
    assert.equal(document.getElementById('encryptAccountId').value, TARGET, 'File refresh restored the source account over the selected target');
    const editor = document.getElementById('fileEditor');
    editor.value = 'edited save'; editor.dispatchEvent(new window.Event('input'));
    document.getElementById('saveEncryptFileBtn').click();
    await until(() => calls.encrypt.length === 1, 'Save & encrypt did not run');
    await f.idle();
    assert.equal(calls.writes.length, 1);
    assert.equal(calls.encrypt[0].accountId, TARGET);
    assert.equal(calls.encrypt[0].useRemoteOracle, remote);
    assert.equal(window.cmpFixture.calls.imports.length, 1);

    document.getElementById('mySaveResignBtn').click();
    assert.equal(document.getElementById('resignAccountId').value, TARGET);
    document.getElementById('confirmResignBtn').click();
    await until(() => calls.jobs.some(job => job.operation === 'resign'), 'Resign did not run');
    await f.idle();
    const resigned = calls.jobs.find(job => job.operation === 'resign');
    assert.equal(resigned.accountId, TARGET);
    assert.equal(resigned.useRemoteOracle, remote);
    assert.deepEqual(resigned.inputs, ['/pc/Saves/PPSA12345/sdimg_DATA']);
    assert.deepEqual(f.errors, []);
  });
}

test('display labels and target changes keep external encryption account bytes exact', async t => {
  const f = await app(t, true);
  const { document, calls, window, state } = f;
  await f.selectAndDecrypt();
  const selector = document.getElementById('targetAccountSelect');
  selector.value = OTHER; selector.dispatchEvent(new window.Event('change'));
  await until(() => state.selectedId === OTHER && document.getElementById('encryptAccountId').value === OTHER, 'Changing target did not update encryption');
  const display = document.getElementById('savedAccountDisplay');
  display.value = 'id'; display.dispatchEvent(new window.Event('change'));
  await until(() => selector.options[selector.selectedIndex].textContent.includes(OTHER), 'Account ID display did not update');
  assert.equal(selector.value, OTHER);

  document.getElementById('decryptExternalBtn').click();
  await until(() => calls.jobs.filter(job => job.operation === 'decrypt').length === 2, 'External save did not decrypt');
  await f.idle();
  document.getElementById('encryptSaveBtn').click();
  await until(() => calls.jobs.some(job => job.operation === 'encrypt'), 'External encryption did not run');
  await f.idle();
  assert.equal(calls.jobs.find(job => job.operation === 'encrypt').accountId, OTHER);
  assert.equal(document.getElementById('workspaceAccountId').textContent.includes(CURRENT), true);
  assert.deepEqual(f.errors, []);
});

test('Use current ID keeps source ownership for encryption and blocks a resign job', async t => {
  const f = await app(t, false, TARGET, true);
  const { document, calls } = f;
  await f.selectAndDecrypt();
  assert.equal(document.getElementById('useCurrentAccountId').checked, true);
  assert.equal(document.getElementById('targetAccountSelect').disabled, true);
  assert.equal(document.getElementById('encryptAccountId').value, CURRENT);
  document.getElementById('encryptSaveBtn').click();
  await until(() => calls.encrypt.length === 1, 'Source-account encryption did not run');
  await f.idle();
  assert.equal(calls.encrypt[0].accountId, CURRENT);
  document.getElementById('mySaveResignBtn').click();
  document.getElementById('resignAccountId').value = TARGET;
  document.getElementById('confirmResignBtn').click();
  await f.idle();
  assert.equal(calls.jobs.some(job => job.operation === 'resign'), false);
  assert.deepEqual(f.errors, []);
});

test('unchecking Use current ID enables the remembered target for subsequent saves', async t => {
  const f = await app(t, false, TARGET, true);
  const { document, calls, window, state } = f;
  await f.selectAndDecrypt();
  const checkbox = document.getElementById('useCurrentAccountId');
  checkbox.checked = false; checkbox.dispatchEvent(new window.Event('change'));
  await until(() => !state.useCurrent && !document.getElementById('targetAccountSelect').disabled
    && document.getElementById('encryptAccountId').value === TARGET, 'Saved target did not become active');
  document.getElementById('encryptSaveBtn').click();
  await until(() => calls.encrypt.length === 1, 'Target-account encryption did not run');
  await f.idle();
  assert.equal(calls.encrypt[0].accountId, TARGET);
  assert.deepEqual(f.errors, []);
});

test('an empty saved target allows manual Account ID entry when Use current ID is off', async t => {
  const f = await app(t, false, '', false);
  const { document, calls } = f;
  await f.selectAndDecrypt();
  document.getElementById('encryptAccountId').value = OTHER;
  document.getElementById('encryptSaveBtn').click();
  await until(() => calls.encrypt.length === 1, 'Manual encryption did not run');
  await f.idle();
  assert.equal(calls.encrypt[0].accountId, OTHER);
  assert.equal(document.getElementById('targetAccountSelect').value, '');
  assert.deepEqual(f.errors, []);
});

test('a saved target can be selected for resigning before decrypting a PC save', async t => {
  const f = await app(t, false, TARGET, true);
  const { document, calls, state, window } = f;
  document.querySelector('#cmpLibraryTree .cmp-file-open').click();
  await until(() => !document.getElementById('selectedSavePanel').hidden, 'PC save was not selected');
  assert.equal(document.getElementById('workspaceAccountControls').closest('#selectedSavePanel'), document.getElementById('selectedSavePanel'));
  assert.equal(document.querySelector('.wizard-panel[data-wizard="2"]').classList.contains('active'), false);
  const current = document.getElementById('useCurrentAccountId');
  assert.equal(current.checked, true);
  current.checked = false; current.dispatchEvent(new window.Event('change'));
  const selector = document.getElementById('targetAccountSelect');
  await until(() => !state.useCurrent && !selector.disabled, 'Target selector did not become available');
  selector.value = OTHER; selector.dispatchEvent(new window.Event('change'));
  await until(() => state.selectedId === OTHER && document.getElementById('resignAccountId').value === OTHER, 'Selected account did not reach resign input');
  document.getElementById('mySaveResignBtn').click();
  document.getElementById('confirmResignBtn').click();
  await until(() => calls.jobs.some(job => job.operation === 'resign'), 'Resign did not run');
  await f.idle();
  assert.equal(calls.jobs.some(job => job.operation === 'decrypt'), false);
  assert.equal(calls.jobs.find(job => job.operation === 'resign').accountId, OTHER);
  assert.equal(document.querySelector('.wizard-panel[data-wizard="2"]').classList.contains('active'), false);
  assert.deepEqual(f.errors, []);
});

for (const action of ['encrypt', 'resign']) {
  for (const succeeds of [true, false]) {
    test(`${action} waits for a pending target selection and ${succeeds ? 'uses its committed ID' : 'stops after persistence fails'}`, async t => {
      const f = await app(t, false);
      const { document, window, calls, state } = f;
      await f.selectAndDecrypt();
      if (action === 'resign') document.getElementById('mySaveResignBtn').click();
      let finishSelection;
      window.saveAccounts.select = id => {
        calls.select.push(id);
        return new Promise((resolve, reject) => {
          finishSelection = () => {
            if (!succeeds) { reject(new Error('Test account write failed')); return; }
            state.selectedId = id;
            resolve(plain(state));
          };
        });
      };
      const selector = document.getElementById('targetAccountSelect');
      selector.value = OTHER; selector.dispatchEvent(new window.Event('change'));
      await until(() => typeof finishSelection === 'function', 'Target persistence did not start');
      document.getElementById(action === 'encrypt' ? 'encryptSaveBtn' : 'confirmResignBtn').click();
      await pause(); await pause();
      assert.equal(calls.encrypt.length, 0, 'Encryption must not use the previously selected ID');
      assert.equal(calls.jobs.some(job => job.operation === 'resign'), false, 'Resign must not use the previously selected ID');
      finishSelection();
      if (succeeds) {
        await until(() => action === 'encrypt' ? calls.encrypt.length === 1 : calls.jobs.some(job => job.operation === 'resign'), 'Save action did not resume after target persistence');
        const job = action === 'encrypt' ? calls.encrypt[0] : calls.jobs.find(job => job.operation === 'resign');
        assert.equal(job.accountId, OTHER);
      } else {
        await until(() => document.getElementById('savedAccountStatus').textContent.includes('Test account write failed'), 'Account failure was not shown');
        assert.equal(state.selectedId, TARGET);
      }
      await f.idle();
      assert.equal(calls.encrypt.length, succeeds && action === 'encrypt' ? 1 : 0);
      assert.equal(calls.jobs.filter(job => job.operation === 'resign').length, succeeds && action === 'resign' ? 1 : 0);
      assert.deepEqual(f.errors, []);
    });
  }
}

test('a manual target survives workspace file changes and resets for a new workspace', async t => {
  const f = await app(t, false, '', false);
  const { document, window, calls } = f;
  await f.selectAndDecrypt();
  const target = document.getElementById('encryptAccountId');
  target.value = OTHER;
  document.querySelector('#workspaceFiles tr[data-file-path]').click();
  await until(() => !document.getElementById('fileEditorPanel').hidden, 'Workspace editor did not open');
  await f.idle();
  assert.equal(target.value, OTHER, 'Opening a file discarded the manual target');
  const editor = document.getElementById('fileEditor');
  editor.value = 'edited bytes'; editor.dispatchEvent(new window.Event('input'));
  document.getElementById('saveFileBtn').click();
  await until(() => calls.writes.length === 1, 'File changes did not save');
  await f.idle();
  assert.equal(target.value, OTHER, 'Saving a file discarded the manual target');

  const base = { root: '/app/workspace', titleId: 'PPSA12345', accountId: CURRENT,
    files: [{ path: 'DATA/save.dat', size: 8, protected: false }] };
  window.saveEditor.add = async () => ({ ...base, files: [...base.files, { path: 'added.dat', size: 8, protected: false }] });
  document.getElementById('addFilesBtn').click();
  await until(() => document.querySelectorAll('#workspaceFiles tr[data-file-path]').length === 2, 'Added file did not refresh the workspace');
  await f.idle();
  assert.equal(target.value, OTHER, 'Adding a file discarded the manual target');
  [...document.querySelectorAll('#workspaceFiles tr[data-file-path]')].find(row => row.textContent.includes('added.dat')).click();
  await f.idle();
  window.saveEditor.delete = async () => plain(base);
  document.getElementById('deleteFileBtn').click();
  await until(() => document.querySelectorAll('#workspaceFiles tr[data-file-path]').length === 1, 'Deleted file did not refresh the workspace');
  await f.idle();
  assert.equal(target.value, OTHER, 'Deleting a file discarded the manual target');
  document.getElementById('encryptSaveBtn').click();
  await until(() => calls.encrypt.length === 1, 'Manual target encryption did not run');
  await f.idle();
  assert.equal(calls.encrypt[0].accountId, OTHER);

  const run = window.saveEditor.run;
  window.saveEditor.run = async options => {
    const result = await run(options);
    return options.operation === 'decrypt'
      ? { ...result, workspace: '/app/next-workspace', info: { ...result.info, root: '/app/next-workspace' } }
      : result;
  };
  document.getElementById('decryptExternalBtn').click();
  await until(() => calls.jobs.filter(job => job.operation === 'decrypt').length === 2, 'Another save did not decrypt');
  await f.idle();
  assert.equal(target.value, CURRENT, 'A manual target from the previous workspace leaked into a new save');
  assert.deepEqual(f.errors, []);
});

// Function Test Settings
async function openAccountSettings(f) {
  f.document.querySelector('[data-page="settings"]').click();
  const details = f.document.getElementById('accountListDetails');
  if (!details.open) details.querySelector('summary').click();
  await until(() => !f.document.getElementById('settingsPage').hidden && details.open, 'Saved accounts Settings did not open');
  return details;
}

// Function Test Name Guard
function enforceUniqueNames(f) {
  const key = value => String(value || '').trim().toLowerCase();
  const available = (id, name) => {
    const normalized = key(name);
    if (normalized && f.state.accounts.some(account => account.id !== id && key(account.name) === normalized)) {
      throw new Error('Name already in use.');
    }
  };
  const add = f.window.saveAccounts.add;
  const rename = f.window.saveAccounts.rename;
  f.window.saveAccounts.add = async (id, name) => { available(id, name); return add(id, name.trim()); };
  f.window.saveAccounts.rename = async (id, name) => { available(id, name); return rename(id, name.trim()); };
}

for (const useCurrent of [false, true]) {
  test(`Add current ID asks for a name and Settings editing persists while Use current ID is ${useCurrent ? 'on' : 'off'}`, async t => {
    const f = await app(t, false, TARGET, useCurrent);
    const { document, state, calls, window } = f;
    await f.selectAndDecrypt();
    document.getElementById('addCurrentAccountBtn').click();
    const dialog = document.getElementById('accountNameDialog');
    await until(() => dialog.open, 'Add account name dialog did not open');
    const name = document.getElementById('accountNameInput');
    assert.equal(document.getElementById('accountNameId').textContent, CURRENT);
    assert.equal(name.value, '');
    assert.equal(name.disabled, false);
    assert.equal(name.readOnly, false);
    assert.equal(document.activeElement, name);
    assert.equal(state.accounts.some(account => account.id === CURRENT), false, 'Opening the name dialog must not create an unnamed account');
    name.value = 'Main PS5'; name.dispatchEvent(new window.Event('input', { bubbles: true }));
    document.getElementById('accountNameSaveBtn').click();
    await until(() => !dialog.open && state.accounts.some(account => account.id === CURRENT), 'Named account did not save');
    assert.deepEqual(calls.add, [{ id: CURRENT, name: 'Main PS5' }]);
    assert.equal(document.getElementById('workspaceAccountId').textContent, 'Main PS5');
    assert.ok(document.getElementById('workspaceAccountId').title.includes(CURRENT));
    assert.equal(state.selectedId, TARGET);
    assert.equal(state.useCurrent, useCurrent);

    await openAccountSettings(f);
    const inline = document.querySelector(`#savedAccountRows input[data-account-id="${CURRENT}"]`);
    assert.ok(inline);
    assert.equal(inline.value, 'Main PS5');
    assert.equal(inline.disabled, false);
    assert.equal(inline.readOnly, false);
    assert.ok(inline.tabIndex >= 0);
    inline.click(); inline.focus();
    assert.equal(document.activeElement, inline);
    inline.value = 'Renamed PS5'; inline.dispatchEvent(new window.Event('input', { bubbles: true }));
    inline.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    await until(() => state.accounts.find(account => account.id === CURRENT)?.name === 'Renamed PS5'
      && document.getElementById('workspaceAccountId').textContent === 'Renamed PS5', 'Settings Enter rename did not persist');
    await until(() => !document.querySelector(`#savedAccountRows input[data-account-id="${CURRENT}"]`).disabled, 'Settings names stayed disabled after saving');
    assert.deepEqual(calls.rename, [{ id: CURRENT, name: 'Renamed PS5' }]);
    assert.equal(document.getElementById('workspaceAccountId').textContent, 'Renamed PS5');
    assert.ok(document.getElementById('workspaceAccountId').title.includes(CURRENT));
    assert.equal(state.selectedId, TARGET);
    assert.equal(state.useCurrent, useCurrent);
    assert.equal(document.getElementById('useCurrentAccountId').checked, useCurrent);

    const reloaded = await app(t, false, TARGET, useCurrent, plain(state));
    await reloaded.selectAndDecrypt();
    assert.equal(reloaded.document.getElementById('workspaceAccountId').textContent, 'Renamed PS5');
    assert.ok(reloaded.document.getElementById('workspaceAccountId').title.includes(CURRENT));
    await openAccountSettings(reloaded);
    assert.equal(reloaded.document.querySelector(`#savedAccountRows input[data-account-id="${CURRENT}"]`).value, 'Renamed PS5');
    assert.equal(reloaded.state.selectedId, TARGET);
    assert.equal(reloaded.state.useCurrent, useCurrent);
    document.querySelector('[data-page="library"]').click();
    await f.idle();
    document.getElementById('encryptSaveBtn').click();
    await until(() => calls.encrypt.length === 1, 'Named account encryption did not run');
    await f.idle();
    assert.equal(calls.encrypt[0].accountId, useCurrent ? CURRENT : TARGET, 'A display name changed the submitted Account ID');
    assert.deepEqual(f.errors, []);
    assert.deepEqual(reloaded.errors, []);
  });
}

test('inline Settings typing retains its node, focus and caret while earlier names are saving', async t => {
  const stored = { accounts: [{ id: CURRENT, name: 'Source account' }, { id: TARGET, name: 'Target account' },
    { id: OTHER, name: 'Other account' }], selectedId: TARGET, displayMode: 'name', useCurrent: false };
  const f = await app(t, false, TARGET, false, stored);
  const { document, window, state } = f;
  await f.selectAndDecrypt();
  await openAccountSettings(f);
  assert.equal(document.querySelectorAll('#savedAccountRows button[data-action="edit"]').length, 0);
  const input = document.querySelector(`#savedAccountRows input[data-account-id="${CURRENT}"]`);
  const requested = [];
  const rename = window.saveAccounts.rename;
  window.saveAccounts.rename = (id, name) => new Promise((resolve, reject) => {
    requested.push({ id, name, finish: () => rename(id, name).then(resolve, reject) });
  });
  input.click(); input.focus();
  input.value = 'Source One'; input.setSelectionRange(input.value.length, input.value.length);
  input.dispatchEvent(new window.Event('input', { bubbles: true }));
  input.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  await until(() => requested.length === 1, 'First inline name save did not start');
  assert.equal(requested[0].id, CURRENT);
  assert.equal(requested[0].name, 'Source One');
  assert.equal(document.querySelector(`#savedAccountRows input[data-account-id="${CURRENT}"]`), input);
  assert.equal(input.disabled, false);
  assert.equal(input.readOnly, false);
  assert.equal(document.activeElement, input);
  assert.equal(input.selectionStart, 'Source One'.length);

  input.setRangeText(' plus', input.selectionStart, input.selectionEnd, 'end');
  input.dispatchEvent(new window.Event('input', { bubbles: true }));
  input.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  const draft = input.value;
  const caret = input.selectionStart;
  assert.equal(draft, 'Source One plus');
  assert.equal(document.activeElement, input);
  assert.equal(input.disabled, false);
  requested[0].finish();
  await until(() => requested.length === 2, 'Latest typed name was not queued after the first save');
  assert.equal(document.querySelector(`#savedAccountRows input[data-account-id="${CURRENT}"]`), input);
  assert.equal(input.value, draft, 'An earlier save overwrote the newer typed name');
  assert.equal(document.activeElement, input, 'Refreshing a saved name stole focus');
  assert.equal(input.selectionStart, caret, 'Refreshing a saved name moved the caret');
  assert.equal(input.selectionEnd, caret);
  assert.equal(input.disabled, false);
  assert.equal(requested[1].name, draft);
  requested[1].finish();
  await until(() => state.accounts.find(account => account.id === CURRENT)?.name === draft, 'Latest typed name did not persist');
  await until(() => document.getElementById('workspaceAccountId').textContent === draft, 'Current account label did not refresh');
  assert.equal(document.querySelector(`#savedAccountRows input[data-account-id="${CURRENT}"]`), input);
  assert.equal(document.activeElement, input);
  assert.equal(input.selectionStart, caret);
  assert.equal(input.selectionEnd, caret);
  assert.equal(state.selectedId, TARGET);
  assert.equal(state.useCurrent, false);

  const reloaded = await app(t, false, TARGET, false, plain(state));
  await openAccountSettings(reloaded);
  assert.equal(reloaded.document.querySelector(`#savedAccountRows input[data-account-id="${CURRENT}"]`).value, draft);
  assert.deepEqual(f.errors, []);
  assert.deepEqual(reloaded.errors, []);
});

test('Cancel and Escape leave the account list unchanged, and a failed Add can be retried', async t => {
  const f = await app(t, false);
  const { document, state, calls, window } = f;
  await f.selectAndDecrypt();
  const add = document.getElementById('addCurrentAccountBtn');
  const dialog = document.getElementById('accountNameDialog');
  const input = document.getElementById('accountNameInput');
  add.click(); await until(() => dialog.open, 'Add dialog did not open');
  input.value = 'Canceled name';
  document.getElementById('accountNameCancelBtn').click();
  assert.equal(dialog.open, false);
  assert.equal(calls.add.length, 0);
  assert.equal(state.accounts.some(account => account.id === CURRENT), false);
  add.click(); await until(() => dialog.open, 'Add dialog did not reopen');
  input.value = 'Escape name';
  dialog.dispatchEvent(new window.Event('cancel', { cancelable: true }));
  assert.equal(dialog.open, false);
  assert.equal(calls.add.length, 0);

  const save = window.saveAccounts.add;
  let attempts = 0;
  window.saveAccounts.add = async (...args) => {
    attempts++;
    if (attempts === 1) throw new Error('Test name storage failure');
    return save(...args);
  };
  add.click(); await until(() => dialog.open, 'Retry name dialog did not open');
  input.value = 'Retained name';
  document.getElementById('accountNameSaveBtn').click();
  await until(() => document.getElementById('accountNameError').textContent.includes('Test name storage failure'), 'Name-save error did not appear in the dialog');
  assert.equal(dialog.open, true);
  assert.equal(input.value, 'Retained name');
  assert.equal(state.accounts.some(account => account.id === CURRENT), false);
  assert.equal(document.getElementById('accountNameSaveBtn').disabled, false);
  document.getElementById('accountNameSaveBtn').click();
  await until(() => !dialog.open && state.accounts.some(account => account.id === CURRENT), 'Retry did not create the named account');
  assert.equal(state.accounts.find(account => account.id === CURRENT).name, 'Retained name');
  assert.equal(attempts, 2);
  assert.equal(state.selectedId, TARGET);
  assert.equal(state.useCurrent, false);
  assert.deepEqual(f.errors, []);
});

test('Add rejects a duplicate display name and can retry without changing existing accounts or target IDs', async t => {
  const f = await app(t, false);
  const { document, window, state, calls } = f;
  enforceUniqueNames(f);
  await f.selectAndDecrypt();
  document.getElementById('addCurrentAccountBtn').click();
  const dialog = document.getElementById('accountNameDialog');
  await until(() => dialog.open, 'Add account dialog did not open');
  const name = document.getElementById('accountNameInput');
  name.value = '  tArGeT aCcOuNt  '; name.dispatchEvent(new window.Event('input', { bubbles: true }));
  document.getElementById('accountNameSaveBtn').click();
  await until(() => document.getElementById('accountNameError').textContent.includes('already in use'), 'Duplicate name error did not appear');
  assert.equal(dialog.open, true);
  assert.equal(name.value, '  tArGeT aCcOuNt  ');
  assert.equal(state.accounts.some(account => account.id === CURRENT), false);
  assert.deepEqual(state.accounts, [{ id: TARGET, name: 'Target account' }, { id: OTHER, name: 'Other account' }]);
  assert.equal(state.selectedId, TARGET);
  assert.equal(state.useCurrent, false);
  assert.equal(calls.add.length, 0);
  name.value = 'Personal PS5'; name.dispatchEvent(new window.Event('input', { bubbles: true }));
  document.getElementById('accountNameSaveBtn').click();
  await until(() => !dialog.open && state.accounts.some(account => account.id === CURRENT), 'Retry did not add the unique account name');
  assert.equal(state.accounts.find(account => account.id === CURRENT).name, 'Personal PS5');
  assert.equal(state.accounts.find(account => account.id === TARGET).name, 'Target account');
  assert.equal(state.accounts.find(account => account.id === OTHER).name, 'Other account');
  assert.equal(state.selectedId, TARGET);
  document.getElementById('encryptSaveBtn').click();
  await until(() => calls.encrypt.length === 1, 'Encryption after successful Add retry did not run');
  await f.idle();
  assert.equal(calls.encrypt[0].accountId, TARGET);
  assert.deepEqual(f.errors, []);
});

test('a duplicate inline name retains its draft, lets another row save, and blocks encryption until corrected', async t => {
  const f = await app(t, false);
  const { document, window, state, calls } = f;
  enforceUniqueNames(f);
  await f.selectAndDecrypt();
  await openAccountSettings(f);
  const duplicate = document.querySelector(`#savedAccountRows input[data-account-id="${OTHER}"]`);
  duplicate.focus(); duplicate.value = '  TARGET ACCOUNT  ';
  duplicate.dispatchEvent(new window.Event('input', { bubbles: true }));
  duplicate.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  await until(() => duplicate.getAttribute('aria-invalid') === 'true', 'Duplicate rename was not marked invalid');
  assert.equal(duplicate.value, '  TARGET ACCOUNT  ');
  assert.equal(state.accounts.find(account => account.id === OTHER).name, 'Other account');
  assert.equal(state.accounts.find(account => account.id === TARGET).name, 'Target account');
  assert.equal(document.querySelector(`[data-account-error="${OTHER}"]`).textContent.includes('already in use'), true);
  const target = document.querySelector(`#savedAccountRows input[data-account-id="${TARGET}"]`);
  assert.equal(target.disabled, false);
  target.focus(); target.value = 'Updated target';
  target.dispatchEvent(new window.Event('input', { bubbles: true }));
  target.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  await until(() => state.accounts.find(account => account.id === TARGET).name === 'Updated target', 'A failed row prevented another row from saving');
  assert.equal(duplicate.value, '  TARGET ACCOUNT  ');
  assert.equal(duplicate.getAttribute('aria-invalid'), 'true');
  assert.equal(state.selectedId, TARGET);

  document.querySelector('[data-page="library"]').click();
  await f.idle();
  document.getElementById('encryptSaveBtn').click();
  await until(() => /already in use|unsaved|failed/i.test(document.getElementById('mySavesStatus').textContent), 'Unsaved duplicate names did not block the save action');
  await f.idle();
  assert.equal(calls.encrypt.length, 0);
  await openAccountSettings(f);
  duplicate.focus(); duplicate.value = 'Second profile';
  duplicate.dispatchEvent(new window.Event('input', { bubbles: true }));
  duplicate.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  await until(() => state.accounts.find(account => account.id === OTHER).name === 'Second profile'
    && duplicate.getAttribute('aria-invalid') !== 'true', 'Correcting the duplicate did not persist');
  assert.equal(document.querySelector(`[data-account-error="${OTHER}"]`).textContent, '');
  document.querySelector('[data-page="library"]').click();
  await f.idle();
  document.getElementById('encryptSaveBtn').click();
  await until(() => calls.encrypt.length === 1, 'Encryption did not resume after correcting the name');
  await f.idle();
  assert.equal(calls.encrypt[0].accountId, TARGET);
  assert.equal(state.accounts.find(account => account.id === TARGET).name, 'Updated target');
  assert.equal(state.selectedId, TARGET);
  assert.equal(state.useCurrent, false);
  assert.deepEqual(f.errors, []);
});

test('closing flushes the latest inline name before debounce and freezes it until closing is canceled', async t => {
  const f = await app(t, false);
  const { document, state, calls, window } = f;
  await f.selectAndDecrypt();
  await openAccountSettings(f);
  await until(() => typeof calls.closeFlush === 'function', 'Account close hook was not registered');
  const input = document.querySelector(`#savedAccountRows input[data-account-id="${TARGET}"]`);
  input.focus(); input.value = 'Saved before exit';
  input.dispatchEvent(new window.Event('input', { bubbles: true }));
  assert.equal(state.accounts.find(account => account.id === TARGET).name, 'Target account');
  await calls.closeFlush();
  assert.equal(state.accounts.find(account => account.id === TARGET).name, 'Saved before exit');
  assert.equal(input.disabled, true, 'A successful close flush must keep names frozen until the close decision');
  assert.equal(document.querySelector(`#savedAccountRows input[data-account-id="${TARGET}"]`), input);
  calls.closeResume();
  assert.equal(input.disabled, false);
  assert.equal(input.value, 'Saved before exit');
  assert.equal(state.selectedId, TARGET);
  assert.equal(state.useCurrent, false);
  assert.deepEqual(f.errors, []);
});

test('closing rejects an unsaved duplicate name and canceled closing preserves the editable draft', async t => {
  const f = await app(t, false);
  const { document, state, calls, window } = f;
  enforceUniqueNames(f);
  await f.selectAndDecrypt();
  await openAccountSettings(f);
  await until(() => typeof calls.closeFlush === 'function', 'Account close hook was not registered');
  const input = document.querySelector(`#savedAccountRows input[data-account-id="${OTHER}"]`);
  input.focus(); input.value = '  target ACCOUNT  ';
  input.dispatchEvent(new window.Event('input', { bubbles: true }));
  await assert.rejects(calls.closeFlush(), /Name already in use/);
  assert.equal(state.accounts.find(account => account.id === OTHER).name, 'Other account');
  assert.equal(input.value, '  target ACCOUNT  ');
  assert.equal(input.getAttribute('aria-invalid'), 'true');
  calls.closeResume();
  assert.equal(input.disabled, false);
  assert.equal(input.readOnly, false);
  assert.equal(input.value, '  target ACCOUNT  ');
  assert.equal(state.selectedId, TARGET);
  assert.equal(state.useCurrent, false);
  assert.deepEqual(f.errors, []);
});

test('canceling a failed close during browsing unlocks names when browsing ends and preserves an active close freeze', async t => {
  const f = await app(t, false);
  const { document, state, calls, window } = f;
  await f.selectAndDecrypt();
  await openAccountSettings(f);
  const input = document.querySelector(`#savedAccountRows input[data-account-id="${TARGET}"]`);
  const rename = window.saveAccounts.rename;
  let failing = true;
  window.saveAccounts.rename = (...args) => {
    if (failing) return Promise.reject(new Error('Test rename storage failed'));
    return rename(...args);
  };
  input.value = 'Unsaved name'; input.dispatchEvent(new window.Event('input', { bubbles: true }));
  input.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  await until(() => input.getAttribute('aria-invalid') === 'true', 'Rename failure was not retained');
  window.cmpFixture.emit({ type: 'ready', users: window.cmpFixture.users, message: 'Browse session active' });
  await assert.rejects(calls.closeFlush(), /Test rename storage failed/);
  calls.closeResume();
  assert.equal(input.disabled, true, 'Names must remain disabled while a browse session is active');
  window.cmpFixture.emit({ type: 'done', message: 'Browse session finished' });
  await until(() => !input.disabled, 'Names stayed disabled after browsing and canceled closing finished');
  assert.equal(document.querySelector(`#savedAccountRows input[data-account-id="${TARGET}"]`), input);
  assert.equal(input.value, 'Unsaved name');
  assert.equal(state.accounts.find(account => account.id === TARGET).name, 'Target account');

  failing = false;
  input.value = 'Recovered name'; input.dispatchEvent(new window.Event('input', { bubbles: true }));
  input.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  await until(() => state.accounts.find(account => account.id === TARGET).name === 'Recovered name'
    && input.getAttribute('aria-invalid') !== 'true', 'Failed name did not recover');
  await calls.closeFlush();
  assert.equal(input.disabled, true);
  window.cmpFixture.emit({ type: 'ready', users: window.cmpFixture.users, message: 'Browse session active' });
  assert.equal(input.disabled, true);
  window.cmpFixture.emit({ type: 'done', message: 'Browse session finished' });
  assert.equal(input.disabled, true, 'Transfer completion must not release an active close freeze');
  calls.closeResume();
  assert.equal(input.disabled, false);
  assert.equal(input.value, 'Recovered name');
  assert.deepEqual(f.errors, []);
});

test('a late duplicate-name error does not invalidate a newer draft or block encryption', async t => {
  const f = await app(t, false);
  const { document, window, state, calls } = f;
  await f.selectAndDecrypt();
  await openAccountSettings(f);
  const input = document.querySelector(`#savedAccountRows input[data-account-id="${OTHER}"]`);
  const rename = window.saveAccounts.rename;
  let rejectOld;
  let submissions = 0;
  window.saveAccounts.rename = (id, name) => {
    if (submissions++ > 0) return rename(id, name);
    calls.rename.push({ id, name });
    return new Promise((_resolve, reject) => { rejectOld = reject; });
  };
  input.focus(); input.value = 'Target account';
  input.dispatchEvent(new window.Event('input', { bubbles: true }));
  input.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  await until(() => typeof rejectOld === 'function', 'The first name save did not start');
  input.value = 'Valid latest name';
  input.dispatchEvent(new window.Event('input', { bubbles: true }));
  input.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  rejectOld(new Error('Name already in use.'));
  await until(() => state.accounts.find(account => account.id === OTHER)?.name === 'Valid latest name'
    && input.getAttribute('aria-invalid') !== 'true', 'A stale error prevented the latest draft from saving');
  assert.equal(document.querySelector(`[data-account-error="${OTHER}"]`).textContent, '');
  assert.equal(input.value, 'Valid latest name');
  assert.equal(document.querySelector(`#savedAccountRows input[data-account-id="${OTHER}"]`), input);
  assert.equal(calls.rename.length, 2);
  document.querySelector('[data-page="library"]').click();
  await f.idle();
  document.getElementById('encryptSaveBtn').click();
  await until(() => calls.encrypt.length === 1, 'A resolved stale name error still blocked encryption');
  await f.idle();
  assert.equal(calls.encrypt[0].accountId, TARGET);
  assert.deepEqual(f.errors, []);
});

test('reverting a pending duplicate name to the saved name clears the stale error and permits closing', async t => {
  const f = await app(t, false);
  const { document, window, state, calls } = f;
  await f.selectAndDecrypt();
  await openAccountSettings(f);
  const input = document.querySelector(`#savedAccountRows input[data-account-id="${OTHER}"]`);
  let rejectOld;
  let submissions = 0;
  window.saveAccounts.rename = () => {
    submissions++;
    return new Promise((_resolve, reject) => { rejectOld = reject; });
  };
  input.value = 'Target account';
  input.dispatchEvent(new window.Event('input', { bubbles: true }));
  input.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  await until(() => typeof rejectOld === 'function', 'The pending name save did not start');
  input.value = 'Other account'; input.dispatchEvent(new window.Event('input', { bubbles: true }));
  const closing = calls.closeFlush();
  rejectOld(new Error('Name already in use.'));
  await closing;
  assert.equal(submissions, 1, 'Reverting to the saved value should not submit another rename');
  assert.equal(input.getAttribute('aria-invalid'), null);
  assert.equal(document.querySelector(`[data-account-error="${OTHER}"]`).textContent, '');
  assert.equal(input.value, 'Other account');
  assert.equal(state.accounts.find(account => account.id === OTHER).name, 'Other account');
  assert.equal(input.disabled, true);
  calls.closeResume();
  assert.equal(input.disabled, false);
  assert.deepEqual(f.errors, []);
});

test('pending account close flushing blocks discovery, downloads and uploads until closing resumes', async t => {
  const f = await app(t, false);
  const { document, window, state, calls } = f;
  await f.selectAndDecrypt();
  await openAccountSettings(f);
  const consoleSelect = document.getElementById('consoleSelect');
  const option = document.createElement('option');
  option.value = '192.168.0.42'; option.textContent = 'Test PS5';
  option.dataset.hostId = 'TEST-HOST'; option.dataset.firmware = '13600000';
  consoleSelect.appendChild(option); consoleSelect.value = option.value;
  const uploadDialog = document.getElementById('uploadModal');
  const userSelect = document.getElementById('userSelect');
  const user = document.createElement('option');
  user.value = 'remembered-user'; user.textContent = 'Remembered user';
  userSelect.appendChild(user); userSelect.value = user.value;
  uploadDialog.showModal();
  const started = { discover: 0, download: 0, inventory: 0, upload: 0 };
  for (const name of Object.keys(started)) {
    const original = window.saveTransfer[name];
    window.saveTransfer[name] = async (...args) => { started[name]++; return original(...args); };
  }
  const rename = window.saveAccounts.rename;
  let complete;
  window.saveAccounts.rename = (...args) => new Promise((resolve, reject) => {
    complete = () => Promise.resolve(rename(...args)).then(resolve, reject);
  });
  const input = document.querySelector(`#savedAccountRows input[data-account-id="${TARGET}"]`);
  input.value = 'Name before exit'; input.dispatchEvent(new window.Event('input', { bubbles: true }));
  const closing = calls.closeFlush();
  await until(() => typeof complete === 'function', 'Closing did not flush the pending name');
  for (const id of ['discoverBtn', 'downloadBtn', 'uploadBtn']) {
    const button = document.getElementById(id);
    assert.equal(button.disabled, true, `${id} was enabled during the close flush`);
    button.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
  }
  await pause(); await pause();
  assert.deepEqual(started, { discover: 0, download: 0, inventory: 0, upload: 0 }, 'An app action bypassed the pending close guard');
  assert.equal(uploadDialog.open, true, 'Pending closing hid an existing transfer dialog');
  assert.equal(userSelect.value, 'remembered-user');
  complete(); await closing;
  assert.equal(state.accounts.find(account => account.id === TARGET).name, 'Name before exit');
  for (const id of ['discoverBtn', 'downloadBtn', 'uploadBtn']) assert.equal(document.getElementById(id).disabled, true);
  calls.closeResume();
  for (const id of ['discoverBtn', 'downloadBtn', 'uploadBtn']) assert.equal(document.getElementById(id).disabled, false);
  assert.equal(uploadDialog.open, true, 'Canceled closing hid the existing transfer dialog');
  assert.equal(userSelect.value, 'remembered-user', 'Canceled closing discarded the selected destination user');
  document.getElementById('discoverBtn').click();
  await until(() => started.discover === 1, 'Discovery did not become available after canceled closing');
  assert.deepEqual(f.errors, []);
});

// Function Test File Drop
function dropEvent(f, type, files, destination = 'decryptExternalDropZone') {
  const event = new f.window.Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'dataTransfer', { value: {
    files, types: ['Files'], dropEffect: 'none',
    items: files.map(file => ({ kind: 'file', type: file.type, getAsFile: () => file })),
  } });
  (typeof destination === 'string' ? f.document.getElementById(destination) : destination).dispatchEvent(event);
  return event;
}

// Function Test ZIP
function zipFile(f, name = 'save.zip', nativePath = '/external/save.zip') {
  const file = new f.window.File(['encrypted archive'], name, { type: 'application/zip' });
  if (nativePath !== null) Object.defineProperty(file, 'path', { value: nativePath });
  return file;
}

for (const remote of [false, true]) {
  test(`dropping one ${remote ? '.ZIP' : '.zip'} automatically decrypts through the ${remote ? 'remote' : 'local'} worker and keeps target IDs`, async t => {
    const f = await app(t, remote);
    const { document, calls } = f;
    await f.idle();
    const name = remote ? 'My Save.ZIP' : 'My Save.zip';
    const nativePath = `/external/${name}`;
    const files = [zipFile(f, name, nativePath)];
    const zone = document.getElementById('decryptExternalDropZone');
    assert.ok(zone);
    assert.equal(dropEvent(f, 'dragover', files).defaultPrevented, true);
    assert.equal(zone.classList.contains('drag-active'), true);
    assert.equal(dropEvent(f, 'drop', files).defaultPrevented, true);
    await until(() => calls.jobs.some(job => job.operation === 'decrypt'), 'Dropping the ZIP did not start decrypting');
    await f.idle();
    const decrypted = calls.jobs.find(job => job.operation === 'decrypt');
    assert.deepEqual(decrypted.inputs, [nativePath]);
    assert.equal(decrypted.useRemoteOracle, remote);
    assert.equal(decrypted.platform, 'ps5');
    assert.equal(calls.chooseInput, 0);
    assert.deepEqual(calls.writes, [], 'Dropping an archive must not write to its original file');
    assert.deepEqual(calls.releases, [], 'The original archive must not be released as a temporary workspace');
    assert.equal(zone.classList.contains('drag-active'), false);
    assert.equal(document.querySelector('.wizard-panel[data-wizard="2"]').classList.contains('active'), true);
    assert.equal(document.getElementById('selectedSavePanel').hidden, true);
    assert.equal(document.getElementById('workspaceAccountId').textContent, CURRENT);
    assert.equal(document.getElementById('targetAccountSelect').value, TARGET);
    document.getElementById('encryptSaveBtn').click();
    await until(() => calls.jobs.some(job => job.operation === 'encrypt'), 'Dropped workspace could not be encrypted');
    await f.idle();
    const encrypted = calls.jobs.find(job => job.operation === 'encrypt');
    assert.equal(encrypted.accountId, TARGET);
    assert.equal(encrypted.useRemoteOracle, remote);
    assert.equal(calls.encrypt.length, 0, 'An external ZIP must not replace a selected local save');
    assert.deepEqual(calls.writes, []);
    assert.deepEqual(calls.releases, []);
    assert.deepEqual(f.errors, []);
  });
}

for (const invalid of ['multiple', 'non-ZIP', 'missing native path']) {
  test(`an encrypted ZIP drop rejects ${invalid} without opening a chooser or starting a job`, async t => {
    const f = await app(t, false);
    await f.idle();
    const files = invalid === 'multiple' ? [zipFile(f), zipFile(f, 'second.zip', '/external/second.zip')]
      : invalid === 'non-ZIP' ? [zipFile(f, 'save.dat', '/external/save.dat')]
      : [zipFile(f, 'save.zip', null)];
    assert.equal(dropEvent(f, 'drop', files).defaultPrevented, true);
    const message = invalid === 'multiple' ? 'one encrypted save ZIP' : invalid === 'non-ZIP' ? '(.zip)' : 'no local file path';
    await until(() => f.document.getElementById('mySavesStatus').textContent.includes(message), 'Invalid drop did not explain the problem');
    await f.idle();
    assert.equal(f.calls.jobs.length, 0);
    assert.equal(f.calls.chooseInput, 0);
    assert.equal(f.document.getElementById('decryptExternalDropZone').classList.contains('drag-active'), false);
    assert.deepEqual(f.errors, []);
  });
}

test('file drops outside the encrypted ZIP target prevent navigation without decrypting', async t => {
  const f = await app(t, false);
  await f.idle();
  const files = [zipFile(f)];
  assert.equal(dropEvent(f, 'dragover', files, f.document.body).defaultPrevented, true);
  assert.equal(dropEvent(f, 'drop', files, f.document.body).defaultPrevented, true);
  await pause();
  assert.equal(f.calls.jobs.length, 0);
  assert.equal(f.calls.chooseInput, 0);
  assert.deepEqual(f.errors, []);
});

test('a second ZIP drop while decryption is pending starts no additional job', async t => {
  const f = await app(t, false);
  const { window, document, calls } = f;
  await f.idle();
  const run = window.saveEditor.run;
  let release;
  window.saveEditor.run = async options => {
    const result = await run(options);
    await new Promise(resolve => { release = resolve; });
    return result;
  };
  dropEvent(f, 'drop', [zipFile(f)]);
  await until(() => typeof release === 'function', 'First ZIP did not start decrypting');
  assert.equal(dropEvent(f, 'drop', [zipFile(f, 'second.zip', '/external/second.zip')]).defaultPrevented, true);
  await pause();
  assert.equal(calls.jobs.length, 1);
  assert.equal(calls.chooseInput, 0);
  release();
  await f.idle();
  assert.equal(document.getElementById('decryptExternalDropZone').classList.contains('drag-active'), false);
  assert.deepEqual(f.errors, []);
});

test('ZIP drops during pending app close flushing start no decryption', async t => {
  const f = await app(t, false);
  const { window, document, calls, state } = f;
  await f.selectAndDecrypt();
  await openAccountSettings(f);
  const input = document.querySelector(`#savedAccountRows input[data-account-id="${TARGET}"]`);
  const rename = window.saveAccounts.rename;
  let release;
  window.saveAccounts.rename = (...args) => new Promise(resolve => { release = async () => resolve(await rename(...args)); });
  input.value = 'Closing name'; input.dispatchEvent(new window.Event('input', { bubbles: true }));
  const closing = calls.closeFlush();
  await until(() => typeof release === 'function', 'Close flushing did not wait for the edited name');
  assert.equal(dropEvent(f, 'drop', [zipFile(f)]).defaultPrevented, true);
  await pause();
  assert.equal(calls.jobs.filter(job => job.operation === 'decrypt').length, 1);
  assert.equal(calls.chooseInput, 0);
  await release(); await closing;
  assert.equal(state.accounts.find(account => account.id === TARGET).name, 'Closing name');
  calls.closeResume();
  assert.equal(document.getElementById('decryptExternalDropZone').classList.contains('drag-active'), false);
  assert.deepEqual(f.errors, []);
});

test('canceling the ZIP drop discard confirmation keeps the current edited workspace', async t => {
  const f = await app(t, false);
  const { document, window, calls } = f;
  await f.selectAndDecrypt();
  document.querySelector('#workspaceFiles tr[data-file-path]').click();
  await f.idle();
  const editor = document.getElementById('fileEditor');
  editor.value = 'Keep these unsaved edits'; editor.dispatchEvent(new window.Event('input'));
  const prompts = [];
  window.saveTransfer.confirm = async message => { prompts.push(message); return false; };
  dropEvent(f, 'drop', [zipFile(f)]);
  await until(() => prompts.length === 1, 'Dropping another ZIP did not ask before discarding edits');
  await f.idle();
  assert.match(prompts[0], /discard|close/i);
  assert.equal(calls.jobs.filter(job => job.operation === 'decrypt').length, 1);
  assert.equal(editor.value, 'Keep these unsaved edits');
  assert.equal(document.getElementById('workspaceAccountId').textContent, CURRENT);
  assert.equal(document.getElementById('targetAccountSelect').value, TARGET);
  assert.deepEqual(calls.releases, []);
  assert.deepEqual(f.errors, []);
});

test('a failed ZIP drop decryption keeps the old workspace and removes drag highlighting', async t => {
  const f = await app(t, false);
  const { document, window, calls } = f;
  await f.selectAndDecrypt();
  document.querySelector('#workspaceFiles tr[data-file-path]').click();
  await f.idle();
  const previousText = document.getElementById('fileEditor').value;
  window.saveEditor.run = async options => { calls.jobs.push(plain(options)); throw new Error('Test ZIP decrypt failed'); };
  const files = [zipFile(f)];
  dropEvent(f, 'dragover', files);
  dropEvent(f, 'drop', files);
  await until(() => document.getElementById('mySavesStatus').textContent.includes('Test ZIP decrypt failed'), 'Decryption failure was not reported');
  await f.idle();
  assert.equal(document.getElementById('fileEditor').value, previousText);
  assert.equal(document.getElementById('workspaceAccountId').textContent, CURRENT);
  assert.equal(document.getElementById('decryptExternalDropZone').classList.contains('drag-active'), false);
  assert.deepEqual(calls.releases, []);
  assert.deepEqual(f.errors, []);
});

test('upload instructions close from their button and from normal transfer completion', async t => {
  const f = await app(t, false);
  const { document, window } = f;
  await f.idle();
  const consoleSelect = document.getElementById('consoleSelect');
  const option = document.createElement('option');
  option.value = '192.168.0.42'; option.textContent = 'Test PS5';
  option.dataset.hostId = 'TEST-HOST'; option.dataset.firmware = '13600000';
  consoleSelect.appendChild(option); consoleSelect.value = option.value;
  const pending = [];
  window.saveTransfer.upload = value => new Promise(resolve => {
    window.cmpFixture.calls.uploads.push(plain(value));
    pending.push(resolve);
  });
  const instructions = document.getElementById('uploadModal');
  async function beginUpload() {
    const count = pending.length;
    document.querySelector('[data-page="upload"]').click();
    document.getElementById('uploadBtn').click();
    await until(() => !document.getElementById('confirmUploadBtn').hidden,
      'Preparing upload did not expose the upload selection');
    const entry = document.getElementById('uploadSaveSelect').options[0];
    assert.ok(entry, 'The downloaded fixture save was unavailable for upload');
    entry.selected = true;
    document.getElementById('confirmUploadBtn').click();
    await until(() => pending.length === count + 1 && instructions.open,
      'Starting the upload did not show its instructions');
    assert.equal(document.getElementById('uploadBtn').disabled, true);
  }

  await beginUpload();
  assert.deepEqual(window.cmpFixture.calls.uploads[0].entryIds, [122]);
  document.getElementById('uploadModalCloseBtn').click();
  assert.equal(instructions.open, false);
  pending[0]();
  window.cmpFixture.emit({ type: 'done', message: 'First upload finished.' });
  await until(() => !document.getElementById('uploadBtn').disabled,
    'Completing the first upload did not restore idle controls');

  await beginUpload();
  assert.equal(instructions.open, true);
  window.cmpFixture.emit({ type: 'done', message: 'Second upload finished.' });
  await until(() => !instructions.open && !document.getElementById('uploadBtn').disabled,
    'Normal upload completion did not dismiss its instructions and restore idle controls');
  pending[1]();
  assert.equal(document.getElementById('confirmUploadBtn').hidden, true);
  assert.deepEqual(f.errors, []);
});

// Function Workspace File
function workspaceLeaf(f, path) {
  return [...f.document.querySelectorAll('#workspaceFiles tr[data-file-path]')]
    .find(row => row.dataset.filePath === path);
}

// Function Tree Action
async function workspaceAction(f, path, action) {
  const row = workspaceLeaf(f, path);
  assert.ok(row, `The workspace tree is missing ${path}`);
  row.dispatchEvent(new f.window.MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 20, clientY: 30 }));
  await until(() => f.document.querySelector(`#workspaceFileContextMenu button[data-action="${action}"]`),
    `The workspace context menu is missing ${action}`);
  const button = f.document.querySelector(`#workspaceFileContextMenu button[data-action="${action}"]`);
  assert.equal(button.disabled, false, `${action} is unavailable for ${path}`);
  button.click();
}

test('the decrypted tree replaces an unopened large nested file at its exact original path', async t => {
  const f = await app(t, false);
  const { document, window, calls, info } = f;
  const path = 'DATA/slot one/save.dat';
  info.files = [
    { path, size: 9 * 1024 * 1024, protected: false },
    { path: 'DATA/slot two/save.dat', size: 8, protected: false },
    { path: 'chives.json', size: 20, protected: true },
  ];
  const reads = [], replacements = [];
  window.saveEditor.read = async value => { reads.push(plain(value)); throw new Error('Large files cannot open in the editor'); };
  window.saveEditor.replace = async value => {
    replacements.push(plain(value));
    return { ...plain(info), files: info.files.map(file => ({ ...file, size: file.path === path ? 10 * 1024 * 1024 : file.size })) };
  };
  await f.selectAndDecrypt();
  assert.ok(document.querySelector('#workspaceFiles tr[data-folder-path="DATA"]'));
  assert.ok(document.querySelector('#workspaceFiles tr[data-folder-path="DATA/slot one"]'));
  await workspaceAction(f, path, 'replace');
  await until(() => replacements.length === 1, 'Replacing the unopened tree leaf did not reach the bridge');
  await f.idle();
  assert.deepEqual(replacements, [{ root: info.root, path }]);
  assert.deepEqual(reads, [], 'Replacing an unopened file must not try to read it into the editor');
  assert.deepEqual([...document.querySelectorAll('#workspaceFiles tr[data-file-path]')].map(row => row.dataset.filePath).sort(),
    [path, 'DATA/slot two/save.dat', 'chives.json'].sort());
  assert.match(workspaceLeaf(f, path).textContent, /10240/);
  assert.equal(document.getElementById('fileEditorPanel').hidden, true);
  assert.match(document.getElementById('mySavesStatus').textContent, /replaced in the decrypted workspace/);
  const prompts = [];
  window.saveTransfer.confirm = async message => { prompts.push(message); return false; };
  document.getElementById('closeWorkspaceBtn').click(); await f.idle();
  assert.equal(prompts.length, 1, 'A successful replacement must mark the workspace as modified');
  assert.match(prompts[0], /have not been encrypted/);
  assert.ok(workspaceLeaf(f, path));
  window.saveTransfer.confirm = async () => true;
  document.getElementById('encryptSaveBtn').click();
  await until(() => calls.encrypt.length === 1, 'The replaced workspace did not encrypt');
  await f.idle();
  assert.equal(calls.encrypt[0].accountId, TARGET);
  assert.deepEqual(f.errors, []);
});

for (const remote of [false, true]) {
  test(`replacing the current file refreshes its editor and retains the ${remote ? 'remote' : 'local'} encryption target`, async t => {
    const f = await app(t, remote);
    const { document, window, info, calls } = f;
    const replacements = [], reads = [];
    let replaced = false;
    window.saveEditor.read = async value => {
      reads.push(plain(value));
      return { data: Buffer.from(replaced ? 'replacement content' : 'original content').toString('base64') };
    };
    window.saveEditor.replace = async value => {
      replacements.push(plain(value)); replaced = true;
      return { ...plain(info), files: info.files.map(file => ({ ...file, size: 19 })) };
    };
    await f.selectAndDecrypt();
    workspaceLeaf(f, 'DATA/save.dat').click(); await f.idle();
    const editor = document.getElementById('fileEditor');
    editor.value = 'unsaved current content'; editor.dispatchEvent(new window.Event('input'));
    const prompts = [];
    window.saveTransfer.confirm = async message => { prompts.push(message); return true; };
    document.getElementById('replaceFileBtn').click();
    await until(() => replacements.length === 1 && editor.value === 'replacement content', 'The current editor did not refresh after replacement');
    await f.idle();
    assert.match(prompts[0], /Discard unsaved changes.*replace/i);
    assert.deepEqual(replacements, [{ root: info.root, path: 'DATA/save.dat' }]);
    assert.deepEqual(reads, [{ root: info.root, path: 'DATA/save.dat' }, { root: info.root, path: 'DATA/save.dat' }]);
    assert.equal(document.getElementById('editorFileName').textContent, 'DATA/save.dat');
    assert.equal(document.getElementById('saveFileBtn').textContent, 'Save changes');
    document.getElementById('saveEncryptFileBtn').click();
    await until(() => calls.encrypt.length === 1, 'Save and encrypt did not run after replacement');
    await f.idle();
    assert.equal(calls.writes[0].path, 'DATA/save.dat');
    assert.equal(Buffer.from(calls.writes[0].data, 'base64').toString(), 'replacement content');
    assert.equal(calls.encrypt[0].accountId, TARGET);
    assert.equal(calls.encrypt[0].useRemoteOracle, remote);
    assert.deepEqual(f.errors, []);
  });
}

test('replacement cancellation and bridge failure preserve the current unsaved editor', async t => {
  const f = await app(t, false);
  const { document, window, info } = f;
  const replacements = [];
  let behavior = 'cancel';
  window.saveEditor.replace = async value => {
    replacements.push(plain(value));
    if (behavior === 'fail') throw new Error('Test replacement failed');
    return null;
  };
  await f.selectAndDecrypt();
  workspaceLeaf(f, 'DATA/save.dat').click(); await f.idle();
  const editor = document.getElementById('fileEditor');
  editor.value = 'keep my unsaved bytes'; editor.dispatchEvent(new window.Event('input'));
  window.saveTransfer.confirm = async () => false;
  await workspaceAction(f, 'DATA/save.dat', 'replace'); await f.idle();
  assert.equal(replacements.length, 0, 'Canceling discard must not open the replacement chooser');
  window.saveTransfer.confirm = async () => true;
  await workspaceAction(f, 'DATA/save.dat', 'replace'); await f.idle();
  assert.deepEqual(replacements, [{ root: info.root, path: 'DATA/save.dat' }]);
  assert.equal(editor.value, 'keep my unsaved bytes');
  assert.match(document.getElementById('saveFileBtn').textContent, /\*/);
  behavior = 'fail';
  await workspaceAction(f, 'DATA/save.dat', 'replace');
  await until(() => document.getElementById('mySavesStatus').textContent === 'Test replacement failed', 'Replacement failure was not reported');
  await f.idle();
  assert.equal(editor.value, 'keep my unsaved bytes');
  assert.equal(document.getElementById('editorFileName').textContent, 'DATA/save.dat');
  assert.equal(document.getElementById('saveFileBtn').disabled, false);
  assert.equal(document.getElementById('targetAccountSelect').value, TARGET);
  assert.deepEqual(f.errors, []);
});

test('replacing another leaf preserves the current dirty editor and a manual account target', async t => {
  const f = await app(t, false, '');
  const { document, window, info, calls } = f;
  info.files.push({ path: 'OTHER/save.dat', size: 5, protected: false });
  const reads = [], replacements = [], prompts = [];
  window.saveEditor.read = async value => { reads.push(plain(value)); return { data: Buffer.from('original').toString('base64') }; };
  window.saveEditor.replace = async value => { replacements.push(plain(value)); return plain(info); };
  window.saveTransfer.confirm = async message => { prompts.push(message); return true; };
  await f.selectAndDecrypt();
  document.getElementById('encryptAccountId').value = OTHER;
  workspaceLeaf(f, 'DATA/save.dat').click(); await f.idle();
  const editor = document.getElementById('fileEditor');
  editor.value = 'unsaved selected file'; editor.dispatchEvent(new window.Event('input'));
  await workspaceAction(f, 'OTHER/save.dat', 'replace');
  await until(() => replacements.length === 1, 'Replacing another leaf did not start');
  await f.idle();
  assert.deepEqual(replacements, [{ root: info.root, path: 'OTHER/save.dat' }]);
  assert.deepEqual(reads, [{ root: info.root, path: 'DATA/save.dat' }]);
  assert.deepEqual(prompts, [], 'Replacing another leaf must not discard or prompt about the current editor');
  assert.equal(editor.value, 'unsaved selected file');
  assert.equal(document.getElementById('editorFileName').textContent, 'DATA/save.dat');
  assert.match(document.getElementById('saveFileBtn').textContent, /\*/);
  assert.equal(document.getElementById('encryptAccountId').value, OTHER);
  document.getElementById('saveEncryptFileBtn').click();
  await until(() => calls.encrypt.length === 1, 'The preserved editor could not save and encrypt');
  await f.idle();
  assert.equal(calls.writes[0].path, 'DATA/save.dat');
  assert.equal(Buffer.from(calls.writes[0].data, 'base64').toString(), 'unsaved selected file');
  assert.equal(calls.encrypt[0].accountId, OTHER);
  assert.deepEqual(f.errors, []);
});

test('a successful large current-file replacement stays successful without reading stale editor bytes', async t => {
  const f = await app(t, false);
  const { document, window, info, calls } = f;
  let reads = 0, replacements = 0;
  window.saveEditor.read = async () => {
    reads++;
    if (reads > 1) throw new Error('This file is larger than 8 MiB');
    return { data: Buffer.from('old editor bytes').toString('base64') };
  };
  window.saveEditor.replace = async () => {
    replacements++;
    return { ...plain(info), files: info.files.map(file => ({ ...file, size: 9 * 1024 * 1024 })) };
  };
  await f.selectAndDecrypt();
  workspaceLeaf(f, 'DATA/save.dat').click(); await f.idle();
  await workspaceAction(f, 'DATA/save.dat', 'replace');
  await until(() => replacements === 1, 'The current file replacement did not run');
  await f.idle();
  assert.equal(reads, 1, 'Large replaced files must not be loaded through the editor read limit');
  assert.equal(document.getElementById('fileEditorPanel').hidden, true);
  assert.match(document.getElementById('mySavesStatus').textContent, /replaced.*larger than 8 MiB/);
  assert.equal(document.getElementById('saveFileBtn').disabled, true);
  document.getElementById('saveFileBtn').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await f.idle();
  assert.deepEqual(calls.writes, [], 'Hidden stale editor content must not overwrite a large replacement');
  assert.deepEqual(f.errors, []);
});

test('a replacement read-back failure reports the committed replacement and allows retrying the editor', async t => {
  const f = await app(t, false);
  const { document, window, info } = f;
  let reads = 0;
  window.saveEditor.read = async () => {
    reads++;
    if (reads === 2) throw new Error('Test editor read failed');
    return { data: Buffer.from(reads > 2 ? 'replaced bytes' : 'old bytes').toString('base64') };
  };
  window.saveEditor.replace = async () => plain(info);
  await f.selectAndDecrypt();
  workspaceLeaf(f, 'DATA/save.dat').click(); await f.idle();
  await workspaceAction(f, 'DATA/save.dat', 'replace');
  await until(() => reads === 2, 'Replacement did not attempt to refresh the editor');
  await f.idle();
  assert.match(document.getElementById('mySavesStatus').textContent, /replaced.*retry opening/);
  assert.equal(document.getElementById('fileEditorPanel').hidden, true);
  workspaceLeaf(f, 'DATA/save.dat').click(); await f.idle();
  assert.equal(document.getElementById('fileEditor').value, 'replaced bytes');
  assert.equal(document.getElementById('fileEditorPanel').hidden, false);
  assert.deepEqual(f.errors, []);
});

test('metadata replacement is available while protected-file deletion remains disabled', async t => {
  const f = await app(t, false);
  const { document, window, info } = f;
  info.files.push({ path: 'sce_sys/param.sfo', size: 50, protected: true });
  const replacements = [];
  window.saveEditor.replace = async value => { replacements.push(plain(value)); return plain(info); };
  await f.selectAndDecrypt();
  await workspaceAction(f, 'sce_sys/param.sfo', 'replace');
  await until(() => replacements.length === 1, 'Protected metadata could not be replaced like an editor write');
  await f.idle();
  assert.deepEqual(replacements, [{ root: info.root, path: 'sce_sys/param.sfo' }]);
  workspaceLeaf(f, 'sce_sys/param.sfo').dispatchEvent(new window.MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
  assert.equal(document.querySelector('#workspaceFileContextMenu [data-action="delete"]').disabled, true);
  assert.equal(document.querySelector('#workspaceFileContextMenu [data-action="replace"]').disabled, false);
  assert.deepEqual(f.errors, []);
});

test('a pending replacement locks the workspace and retains its captured file target', async t => {
  const f = await app(t, false);
  const { document, window, info } = f;
  info.files.push({ path: 'OTHER/save.dat', size: 8, protected: false });
  const replacements = [], reads = [];
  let release;
  window.saveEditor.read = async value => { reads.push(plain(value)); return { data: Buffer.from('current bytes').toString('base64') }; };
  window.saveEditor.replace = value => {
    replacements.push(plain(value));
    return new Promise(resolve => { release = () => resolve(plain(info)); });
  };
  await f.selectAndDecrypt();
  workspaceLeaf(f, 'DATA/save.dat').click(); await f.idle();
  await workspaceAction(f, 'OTHER/save.dat', 'replace');
  await until(() => typeof release === 'function', 'Replacement did not wait for the native file choice');
  workspaceLeaf(f, 'OTHER/save.dat').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  document.getElementById('replaceFileBtn').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  assert.equal(document.getElementById('closeWorkspaceBtn').disabled, true);
  assert.equal(document.getElementById('fileEditor').disabled, true);
  assert.equal(replacements.length, 1, 'A forced event started a second replacement while the chooser was pending');
  assert.deepEqual(reads, [{ root: info.root, path: 'DATA/save.dat' }]);
  release(); await f.idle();
  assert.deepEqual(replacements, [{ root: info.root, path: 'OTHER/save.dat' }]);
  assert.equal(document.getElementById('editorFileName').textContent, 'DATA/save.dat');
  assert.equal(document.getElementById('fileEditor').disabled, false);
  assert.deepEqual(f.errors, []);
});

test('tree export and delete act on the clicked leaf while preserving another open editor', async t => {
  const f = await app(t, false);
  const { document, window, info } = f;
  info.files.push({ path: 'OTHER/save.dat', size: 8, protected: false });
  const exports = [], deletions = [], prompts = [];
  window.saveEditor.downloadFile = async value => { exports.push(plain(value)); return '/exports/save.dat'; };
  window.saveEditor.delete = async value => {
    deletions.push(plain(value));
    return { ...plain(info), files: info.files.filter(file => file.path !== value.path) };
  };
  window.saveTransfer.confirm = async message => { prompts.push(message); return true; };
  await f.selectAndDecrypt();
  workspaceLeaf(f, 'DATA/save.dat').click(); await f.idle();
  const editor = document.getElementById('fileEditor');
  editor.value = 'preserve this draft'; editor.dispatchEvent(new window.Event('input'));
  await workspaceAction(f, 'OTHER/save.dat', 'export');
  await until(() => exports.length === 1, 'The tree export did not run'); await f.idle();
  assert.deepEqual(exports, [{ root: info.root, path: 'OTHER/save.dat' }]);
  await workspaceAction(f, 'OTHER/save.dat', 'delete');
  await until(() => deletions.length === 1, 'The tree delete did not run'); await f.idle();
  assert.deepEqual(deletions, [{ root: info.root, path: 'OTHER/save.dat' }]);
  assert.deepEqual(prompts, ['Delete OTHER/save.dat from the decrypted workspace?']);
  assert.equal(workspaceLeaf(f, 'OTHER/save.dat'), undefined);
  assert.equal(document.getElementById('editorFileName').textContent, 'DATA/save.dat');
  assert.equal(editor.value, 'preserve this draft');
  assert.match(document.getElementById('saveFileBtn').textContent, /\*/);
  assert.deepEqual(f.errors, []);
});
