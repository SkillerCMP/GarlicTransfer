const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const i18n = require('../electron/i18n.js');
require('../electron/locales/zh-CN.js');

// Function Confirmation Fixture
function fixture() {
  const mainPath = path.join(__dirname, '../electron/main.cjs');
  const actualRequire = createRequire(mainPath);
  const handlers = new Map(), calls = [];
  const app = { getPreferredSystemLanguages: () => ['en-US'], getPath: () => '/unused-confirmation-test', whenReady: () => ({ then() {} }), on() {} };
  const dialog = { showMessageBox: async (owner, options) => { calls.push({ owner, options }); return { response: 0 }; } };
  class Store {}
  let destroyed = false, senderDestroyed = false;
  let settings = { uiLanguage: 'auto' };
  const owner = { isDestroyed: () => destroyed, webContents: { isDestroyed: () => senderDestroyed } };
  const context = vm.createContext({
    require(name) {
      if (name === 'electron') return { app, ipcMain: { handle: (name, handler) => handlers.set(name, handler) }, dialog, shell: {} };
      if (name === './local_pc.cjs') return { LocalPcStore: Store };
      if (name === './account_store.cjs') return { AccountStore: Store };
      if (name === './config.cjs') return { loadSettings: () => settings, saveSettings: value => { settings = value; } };
      if (name === './titles.cjs') return { titleName: () => '' };
      if (name === './paths.cjs') return { resourceRoot: '/unused-confirmation-test', localWorkerElf: '', workDir: '/unused-confirmation-test', pythonBin: () => 'python3' };
      return actualRequire(name);
    },
    __dirname: path.dirname(mainPath), process, console, Buffer, setTimeout, clearTimeout, owner,
  });
  vm.runInContext(fs.readFileSync(mainPath, 'utf8'), context);
  vm.runInContext('window = owner;', context);
  const invoke = (message = 'Replace this save?', event = { sender: owner.webContents }) => handlers.get('app:confirm')(event, message);
  return { owner, calls, dialog, context, invoke, handlers,
    destroy: () => { destroyed = true; }, destroySender: () => { senderDestroyed = true; } };
}

test('settings reload only for a different effective language and reopens Settings', async t => {
  const f = fixture();
  t.after(() => i18n.setLanguage('en'));
  const loads = [];
  f.owner.loadFile = async (_file, { query }) => { loads.push(query); };
  const frame = f.owner.webContents.mainFrame = {};
  const event = { sender: f.owner.webContents, senderFrame: frame };
  const save = f.handlers.get('settings:set');
  const reload = f.handlers.get('settings:reload-language');
  assert.equal(save(event, { uiLanguage: 'en' }), false);
  assert.equal(save(event, { uiLanguage: 'zh-CN' }), true);
  assert.equal(loads.length, 0);
  assert.equal(await reload({ ...event, senderFrame: {} }), false);
  vm.runInContext('active = {};', f.context);
  assert.equal(await reload(event), false);
  vm.runInContext('active = null;', f.context);
  assert.equal(await reload(event), true);
  assert.equal(loads.length, 1);
  assert.equal(loads[0].language, 'zh-CN');
  assert.equal(loads[0].page, 'settings');
  assert.equal(i18n.t('Cancel'), '取消');
  assert.equal(await reload(event), true);
  assert.equal(loads.length, 1);
});

test('confirmation belongs to the current window and defaults to Cancel', async () => {
  const f = fixture();
  assert.equal(await f.invoke('  Replace this save?  '), false);
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].owner, f.owner);
  const options = f.calls[0].options;
  assert.equal(options.message, 'Replace this save?');
  assert.equal(options.defaultId, 0);
  assert.equal(options.cancelId, 0);
  assert.deepEqual(Array.from(options.buttons), ['Cancel', 'Continue']);
  f.dialog.showMessageBox = async () => ({ response: 1 });
  assert.equal(await f.invoke(), true);
  f.dialog.showMessageBox = async () => ({ response: 2 });
  assert.equal(await f.invoke(), false);
});

test('invalid messages and unrelated senders cannot open a confirmation', async () => {
  const f = fixture();
  for (const message of ['', '  ', null, {}, 'x'.repeat(4097)]) {
    await assert.rejects(f.invoke(message), /confirmation message/);
  }
  assert.equal(await f.invoke('Replace?', { sender: {} }), false);
  assert.equal(await f.invoke('Replace?', {}), false);
  assert.equal(f.calls.length, 0);
  f.destroy();
  assert.equal(await f.invoke(), false);
  assert.equal(f.calls.length, 0);
});

test('duplicate requests cannot stack dialogs and a closed owner cannot confirm', async () => {
  const f = fixture();
  let resolve;
  f.dialog.showMessageBox = async () => new Promise(done => { resolve = done; });
  const first = f.invoke();
  assert.equal(await f.invoke(), false);
  f.destroy();
  resolve({ response: 1 });
  assert.equal(await first, false);
});

test('a replaced window cannot receive an earlier confirmation response', async () => {
  const f = fixture();
  let resolve;
  f.dialog.showMessageBox = async () => new Promise(done => { resolve = done; });
  const first = f.invoke();
  vm.runInContext('window = { isDestroyed: () => false, webContents: {} };', f.context);
  resolve({ response: 1 });
  assert.equal(await first, false);
});

test('dialog failure reports its error and releases the in-flight guard', async () => {
  const f = fixture();
  const failure = new Error('native dialog failed');
  f.dialog.showMessageBox = async () => { throw failure; };
  await assert.rejects(f.invoke(), error => error === failure);
  f.dialog.showMessageBox = async () => ({ response: 1 });
  assert.equal(await f.invoke(), true);
  f.destroySender();
  assert.equal(await f.invoke(), false);
});

test('preload confirms through the explicit main-process IPC channel', async () => {
  const exposed = {}, calls = [];
  const context = vm.createContext({ process, require: name => {
    assert.equal(name, 'electron');
    return { contextBridge: { exposeInMainWorld: (name, value) => { exposed[name] = value; } },
      ipcRenderer: { invoke: async (...args) => { calls.push(args); return true; } } };
  } });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../electron/preload.cjs'), 'utf8'), context);
  assert.equal(await exposed.saveTransfer.confirm('Replace?'), true);
  assert.deepEqual(calls, [['app:confirm', 'Replace?']]);
});
