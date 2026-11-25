const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const info = require('../electron/console_info.js');

// Function Firmware Setting Test
test('the shared firmware setting accepts only canonicalizable dotted strings', () => {
  assert.equal(info.DEFAULT_JB_FIRMWARE, '13.60');
  assert.equal(info.normalizeFirmwareLimit(' 0013.60 '), '13.60');
  assert.equal(info.normalizeFirmwareLimit('14.22'), '14.22');
  assert.equal(info.normalizeFirmwareLimit('100.01'), '100.01');
  for (const value of ['13.6', '13600000', 13600000, 13.6, [13, 60], '0.00', 'unknown', '', null, undefined]) {
    assert.equal(info.normalizeFirmwareLimit(value), '', String(value));
  }
  assert.deepEqual(info.normalizeFirmware('13600007'), [13, 60]);
  assert.equal(info.firmwareEligible('13600007', '13.60'), true);
  assert.equal(info.firmwareEligible('13600007', '13600000'), false);
});

test('console normalization canonicalizes identity without changing raw firmware or source records', () => {
  const source = Object.freeze({ host: ' 192.168.000.042 ', type: ' ps5 ', hostId: ' abcdEf012345 ', name: ' Living room ', firmware: '13600007', requestPort: '1004' });
  const console = info.normalizeConsole(source);
  assert.deepEqual(console, { ...source, host: '192.168.0.42', type: 'PS5', hostId: 'ABCDEF012345', profileId: 'abcdEf012345', name: 'Living room' });
  assert.equal(console.firmware, '13600007');
  assert.equal(source.hostId, ' abcdEf012345 ');
  const dotted = info.normalizeConsole({ ...source, firmware: '13.60' });
  assert.equal(dotted.firmware, '13.60');
  const rawWhitespace = info.normalizeConsole({ ...source, firmware: ' 13600007 ' });
  assert.equal(rawWhitespace.firmware, ' 13600007 ');
});

test('missing console identity remains unknown and invalid addresses are omitted', () => {
  const console = info.normalizeConsole({ host: '192.168.0.1', type: 5, hostId: 123, name: '' });
  assert.equal(console.type, ''); assert.equal(console.hostId, ''); assert.equal(console.name, 'PlayStation');
  assert.equal(Object.hasOwn(console, 'firmware'), false);
  assert.equal(info.normalizeConsole({ host: '192.168.0.1', type: ' PS4 ' }).type, 'PS4');
  for (const value of [null, undefined, [], '192.168.0.1', {}, { host: '256.0.0.1' }, { host: 'localhost' }]) {
    assert.equal(info.normalizeConsole(value), null);
  }
});

test('console inventories retain the first record per canonical IP without sorting or mutating input', () => {
  const first = { host: '192.168.000.010', type: ' ps5 ', hostId: ' aabb ', name: 'First', firmware: '13600000' };
  const duplicate = { host: '192.168.0.10', type: 'PS5', hostId: 'different', name: 'Second', firmware: '14000000' };
  const next = { host: '192.168.0.2', type: 'PS4', hostId: ' ccdd ' };
  const values = [first, null, { host: 'invalid' }, duplicate, next];
  const consoles = info.normalizeConsoles(values);
  assert.deepEqual(consoles.map(console => console.host), ['192.168.0.10', '192.168.0.2']);
  assert.equal(consoles[0].name, 'First'); assert.equal(consoles[0].hostId, 'AABB');
  assert.equal(consoles[0].firmware, '13600000'); assert.equal(consoles[1].type, 'PS4');
  assert.equal(first.hostId, ' aabb '); assert.equal(values.length, 5);
  assert.deepEqual(info.normalizeConsoles(null), []);
});

test('the locator compatibility exports reuse the shared helpers', () => {
  const locator = require('../electron/console_locator.js');
  for (const key of Object.keys(info)) assert.equal(locator[key], info[key], key);
});

test('the shared browser API initializes without CommonJS or DOM dependencies', () => {
  const context = { window: {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../electron/console_info.js'), 'utf8'), context);
  assert.equal(context.window.ConsoleInfo.DEFAULT_JB_FIRMWARE, '13.60');
  assert.equal(context.window.ConsoleInfo.normalizeFirmwareLimit('14.22'), '14.22');
  assert.equal(context.window.ConsoleInfo.normalizeConsole({ host: '192.168.0.1', type: 'ps5', hostId: 'abcd' }).hostId, 'ABCD');
});

test('profile IDs preserve original folder spelling across repeated identity normalization', () => {
  const console = info.normalizeConsole({ host: '192.168.0.42', type: 'ps5', hostId: ' aabbccddeeff ', firmware: '13600007' });
  assert.equal(console.hostId, 'AABBCCDDEEFF');
  assert.equal(console.profileId, 'aabbccddeeff');
  assert.deepEqual(info.normalizeConsole(console), console);
  const remembered = info.normalizeConsole({ ...console, hostId: ' AABBCCDDEEFF ', profileId: ' aAbBcCdDeEfF ' });
  assert.equal(remembered.hostId, 'AABBCCDDEEFF');
  assert.equal(remembered.profileId, 'aAbBcCdDeEfF');
  assert.equal(info.normalizeConsole(remembered).profileId, 'aAbBcCdDeEfF');
  assert.equal(remembered.firmware, '13600007');
});
