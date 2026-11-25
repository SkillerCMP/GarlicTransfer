const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { pathToFileURL } = require('node:url');
const { JSDOM, VirtualConsole } = require('jsdom');
const i18n = require('../electron/i18n.js');
require('../electron/locales/zh-CN.js');

test('automatic language follows preferred system languages and defaults to English', () => {
  assert.equal(i18n.resolve('auto', ['zh-CN', 'en-US']), 'zh-CN');
  assert.equal(i18n.resolve(undefined, ['fr-FR', 'zh_HK']), 'zh-CN');
  assert.equal(i18n.resolve('old-locale', ['en-US', 'zh-CN']), 'en');
  assert.equal(i18n.resolve('auto', ['ja-JP']), 'en');
  assert.equal(i18n.resolve('en', ['zh-CN']), 'en');
  assert.equal(i18n.resolve('zh-CN', ['en-US']), 'zh-CN');
});

test('translation preserves interpolation values and falls back per message', () => {
  i18n.setLanguage('zh-CN');
  try {
    const file = 'save-{1}.bin';
    assert.equal(i18n.t`Could not export ${file}: ${'<error>'}`, '无法导出 save-{1}.bin：<error>');
    assert.equal(i18n.t`File not found: ${file}`, 'File not found: save-{1}.bin');
    assert.equal(i18n.t('constructor'), 'constructor');
  } finally {
    i18n.setLanguage('en');
  }
});

test('config.ini preserves valid selections and uses Automatic for missing or invalid values', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'garlic-i18n-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const file = path.join(__dirname, '../electron/config.cjs');
  const requireConfig = createRequire(file);
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), {
    module,
    require(name) {
      if (name === 'electron') return { app: { isPackaged: true, getPath: () => root } };
      if (name === './paths.cjs') return { defaultDownloads: root };
      return requireConfig(name);
    },
  });
  const { loadSettings, saveSettings } = module.exports;
  assert.equal(loadSettings().uiLanguage, 'auto');
  for (const locale of ['zh-CN', 'en', 'auto']) {
    saveSettings({ ...loadSettings(), uiLanguage: locale });
    assert.equal(loadSettings().uiLanguage, locale);
  }
  saveSettings({ ...loadSettings(), uiLanguage: 'invalid\noutput=unexpected' });
  assert.equal(loadSettings().uiLanguage, 'auto');
  assert.equal(loadSettings().output, root);
});

test('Chinese renderer localizes settings, markup, and dynamic status and saves the selected preference', async t => {
  const html = path.join(__dirname, '../electron/index.html');
  const url = pathToFileURL(html);
  url.searchParams.set('language', 'zh-CN');
  url.searchParams.set('page', 'settings');
  const problems = [];
  const virtualConsole = new VirtualConsole();
  virtualConsole.on('jsdomError', error => problems.push(error.message));
  const dom = new JSDOM(fs.readFileSync(html, 'utf8'), {
    url: url.href, resources: 'usable', runScripts: 'dangerously', virtualConsole,
    beforeParse(window) {
      window.eval(fs.readFileSync(path.join(__dirname, 'fixtures/cmp_bridge.js'), 'utf8'));
      const getSettings = window.saveTransfer.getSettings;
      window.saveTransfer.getSettings = async () => ({ ...await getSettings(), uiLayout: 'classic', uiLanguage: 'auto' });
      window.saveTransfer.getSkins = async () => ({ skins: [] });
      window.saveTransfer.discover = async () => [];
    },
  });
  t.after(() => dom.window.close());
  const { document } = dom.window;
  await new Promise(resolve => dom.window.addEventListener('load', resolve, { once: true }));
  const byId = id => document.getElementById(id);
  assert.equal(document.documentElement.lang, 'zh-CN');
  assert.equal(document.querySelector('[data-page="console"]').textContent, '主机');
  assert.equal(document.querySelector('[data-page="settings"]').textContent, '设置');
  assert.equal(byId('settingsPage').hidden, false);
  assert.equal(byId('downloadBtn').querySelector('small').textContent, '在主机上启动数据传输以列出存档');
  assert.match(byId('saveSearch').placeholder, /游戏 ID/);
  assert.equal(byId('pairingState').textContent, '请先搜索 PS5 以检查配对状态。');
  const select = byId('uiLanguage');
  assert.deepEqual(Array.from(select.options, option => option.value), ['auto', 'en', 'zh-CN']);
  assert.equal(select.value, 'auto');
  assert.equal(select.options[0].textContent, '自动（跟随系统）');

  select.value = 'en';
  byId('settingsSave').click();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(dom.window.cmpFixture.settings.uiLanguage, 'en');
  assert.equal(byId('settingsStatus').textContent, '设置已保存到 config.ini。');

  byId('discoverBtn').click();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(byId('status').textContent, '未找到主机。请检查网络和防火墙。');
  assert.deepEqual(problems, []);

  const saveSettings = dom.window.saveTransfer.saveSettings;
  dom.window.saveTransfer.saveSettings = async value => {
    await saveSettings(value);
    return value.uiLanguage !== 'zh-CN';
  };
  let reloads = 0;
  dom.window.saveTransfer.reloadLanguage = async () => { reloads++; return true; };
  const saveLanguage = async locale => {
    select.value = locale;
    byId('settingsSave').click();
    await new Promise(resolve => setImmediate(resolve));
  };

  await saveLanguage('zh-CN');
  assert.equal(reloads, 0);
  dom.window.eval("decryptedWorkspace = '/editing';");
  await saveLanguage('en');
  assert.equal(reloads, 0);
  assert.equal(dom.window.cmpFixture.settings.uiLanguage, 'en');
  assert.match(byId('settingsStatus').textContent, /完成当前操作/);
  dom.window.eval('decryptedWorkspace = null;');
  await saveLanguage('en');
  assert.equal(reloads, 1);
});
