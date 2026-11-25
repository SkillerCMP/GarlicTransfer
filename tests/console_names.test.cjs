const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { loadConsoleNames, recordConsoleNames } = require('../electron/console_names.cjs');

test('console names persist by host ID', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'garlic-console-names-'));
  recordConsoleNames(root, [{ hostId: 'aaa', name: 'fert', firmware: '13.60' }]);
  recordConsoleNames(root, [{ hostId: 'bbb', name: '1360', firmware: '13.60' }]);
  assert.deepEqual(loadConsoleNames(root), {
    aaa: { name: 'fert', firmware: '13.60' },
    bbb: { name: '1360', firmware: '13.60' },
  });
});

// Function Profile Name Cache
test('normalized console identities keep names attached to the original profile folder', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'garlic-console-profile-names-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const { normalizeConsole } = require('../electron/console_info.js');
  const raw = { host: '192.0.2.42', hostId: ' aabbccddeeff ', name: 'My PS5', type: 'PS5', firmware: '13600000' };
  recordConsoleNames(root, [raw]);
  assert.deepEqual(loadConsoleNames(root), { aabbccddeeff: { name: 'My PS5', firmware: '13600000' } });
  recordConsoleNames(root, [normalizeConsole({ ...raw, name: 'Renamed PS5' })]);
  assert.deepEqual(loadConsoleNames(root), { aabbccddeeff: { name: 'Renamed PS5', firmware: '13600000' } });
});
