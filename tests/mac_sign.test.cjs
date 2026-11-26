const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');
const test = require('node:test');

const hookPath = require.resolve('../build/mac-sign.cjs');

function loadHook(calls) {
  const originalLoad = Module._load;
  Module._load = function (request, parent, isMain) {
    if (parent?.filename === hookPath && /@electron[\\/]osx-sign/.test(request)) {
      return { signAsync: async (options) => { calls.push(options); } };
    }
    return originalLoad.call(this, request, parent, isMain);
  };
  try {
    delete require.cache[hookPath];
    return require(hookPath);
  } finally {
    Module._load = originalLoad;
    delete require.cache[hookPath];
  }
}

test('macOS builds without a certificate are signed ad hoc with the app identity', async () => {
  const calls = [];
  const sign = loadHook(calls);
  const options = {
    app: '/tmp/GarlicTransfer.app', platform: 'darwin', type: 'distribution',
    identity: undefined, identityValidation: false, optionsForFile: () => ({ hardenedRuntime: true }),
  };
  await sign(options);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].identity, '-');
  assert.equal(calls[0].app, options.app);
  assert.equal(calls[0].identityValidation, false);
  assert.equal(calls[0].optionsForFile, options.optionsForFile);
});

test('macOS builds keep the identity electron-builder found', async () => {
  const calls = [];
  const sign = loadHook(calls);
  await sign({ app: '/tmp/GarlicTransfer.app', identity: 'ABCDEF0123456789ABCDEF0123456789ABCDEF01' });
  assert.equal(calls[0].identity, 'ABCDEF0123456789ABCDEF0123456789ABCDEF01');
});

test('the macOS build configuration uses the signing hook', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
  assert.equal(path.resolve(path.join(__dirname, '..'), pkg.build.mac.sign), hookPath);
});
