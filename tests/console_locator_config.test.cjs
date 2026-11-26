const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');

// Function Config Fixture
function fixture(t) {
  const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'garlic-locator-config-')));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const filename = path.join(__dirname, '../electron/config.cjs');
  const actualRequire = createRequire(filename);
  const load = () => {
    const module = { exports: {} };
    vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
      module, __dirname: path.dirname(filename), require: name => {
        if (name === 'electron') return { app: { isPackaged: true, getPath: key => {
          assert.equal(key, 'userData'); return root;
        } } };
        if (name === './paths.cjs') return { defaultDownloads: path.join(root, 'downloads') };
        return actualRequire(name);
      },
    }, { filename });
    return module.exports;
  };
  return { root, file: path.join(root, 'config.ini'), load, api: load() };
}

test('missing and legacy configurations default the JB limit to the string 13.60', t => {
  const f = fixture(t);
  let settings = f.api.loadSettings();
  assert.equal(settings.jbFirmwareLimit, '13.60');
  assert.equal(typeof settings.jbFirmwareLimit, 'string');
  assert.equal(settings.useRemoteOracle, true);
  assert.equal(settings.output, path.join(f.root, 'downloads'));
  fs.writeFileSync(f.file, 'oracleHost=192.0.2.42\nuiLayout=chill\nuseRemoteOracle=false\n');
  settings = f.api.loadSettings();
  assert.equal(settings.jbFirmwareLimit, '13.60');
  assert.equal(settings.oracleHost, '192.0.2.42');
  assert.equal(settings.uiLayout, 'chill');
  assert.equal(settings.useRemoteOracle, false);
});

test('the revoked shared key is replaced without overriding custom worker keys', t => {
  const f = fixture(t);
  const defaultKey = f.api.loadSettings().workerKey;
  fs.writeFileSync(f.file, 'workerKey=d398596b0dd4ad811173e3324a94d1cc90246a1c7f75b405a5696eed200b353e\n');
  assert.equal(f.api.loadSettings().workerKey, defaultKey);
  fs.writeFileSync(f.file, 'workerKey=custom-worker-key\n');
  assert.equal(f.api.loadSettings().workerKey, 'custom-worker-key');
});

test('the JB limit is normalized and persists without changing other settings', t => {
  const f = fixture(t);
  const settings = { ...f.api.loadSettings(), oracleHost: '192.0.2.99', serverUrl: 'https://example.invalid',
    workerKey: 'test-key', interface: 'Ethernet', output: 'D:/Saves', metadata: 'metadata.db', assets: 'D:/Assets',
    useRemoteOracle: false, preferIpv6: true, uiLayout: 'evil', jbFirmwareLimit: ' 013.60 ' };
  f.api.saveSettings(settings);
  assert.match(fs.readFileSync(f.file, 'utf8'), /^jbFirmwareLimit=13\.60$/m);
  const restored = f.load().loadSettings();
  for (const [key, expected] of Object.entries(settings)) {
    assert.equal(restored[key], key === 'jbFirmwareLimit' ? '13.60' : expected, key);
  }
});

test('valid dotted limits retain both minor-version digits', t => {
  const f = fixture(t);
  for (const [input, expected] of [['13.09', '13.09'], ['13.10', '13.10'], ['14.00', '14.00'], ['2.05', '2.05'], ['0014.20', '14.20']]) {
    f.api.saveSettings({ ...f.api.loadSettings(), jbFirmwareLimit: input });
    assert.equal(f.api.loadSettings().jbFirmwareLimit, expected);
  }
});

test('invalid stored firmware limits fall back without rewriting the configuration', t => {
  const f = fixture(t);
  for (const value of ['', '13', '13.6', '13.600', '13600000', 'unknown', '0.00', '-13.60', '13.60.1', '9007199254740992.60']) {
    const original = `oracleHost=192.0.2.9\njbFirmwareLimit=${value}\n`;
    fs.writeFileSync(f.file, original);
    const settings = f.api.loadSettings();
    assert.equal(settings.jbFirmwareLimit, '13.60', value);
    assert.equal(settings.oracleHost, '192.0.2.9');
    assert.equal(fs.readFileSync(f.file, 'utf8'), original);
  }
});

test('invalid explicit firmware limits reject before replacing any configuration bytes', t => {
  const f = fixture(t);
  f.api.saveSettings({ ...f.api.loadSettings(), oracleHost: '192.0.2.42', jbFirmwareLimit: '14.20' });
  const original = fs.readFileSync(f.file);
  for (const value of ['', null, false, 13.6, 13600000, {}, [], '13', '13.6', '13.600', '13600000',
    '0.00', 'unknown', '13.60\noracleHost=other', '9007199254740992.60']) {
    assert.throws(() => f.api.saveSettings({ ...f.api.loadSettings(), jbFirmwareLimit: value }), /JB firmware limit.*13\.60/);
    assert.deepEqual(fs.readFileSync(f.file), original);
  }
});

test('legacy saves that omit the new setting retain the existing firmware limit', t => {
  const f = fixture(t);
  f.api.saveSettings({ ...f.api.loadSettings(), jbFirmwareLimit: '14.20' });
  const legacy = { ...f.api.loadSettings(), uiLayout: 'chill' };
  delete legacy.jbFirmwareLimit;
  f.api.saveSettings(legacy);
  const restored = f.api.loadSettings();
  assert.equal(restored.jbFirmwareLimit, '14.20');
  assert.equal(restored.uiLayout, 'chill');
});
