const test = require('node:test');
const assert = require('node:assert/strict');
const { authorizeDevice } = require('../electron/device_auth.cjs');

function response(status, body) {
  return { status, ok: status >= 200 && status < 300, text: async () => JSON.stringify(body) };
}

test('device authorization polls and returns per-installation credentials', async () => {
  const requests = [];
  const pending = [];
  let polls = 0;
  const result = await authorizeDevice({
    serverUrl: 'https://garlicsaves.test/',
    name: 'Test workstation',
    fetchImpl: async (url, options) => {
      requests.push({ url, options });
      if (url.endsWith('/device/code')) return response(201, {
        device_code: 'private-device-code', user_code: 'ABCD-2345',
        verification_uri: 'https://garlicsaves.test/device?code=ABCD-2345', interval: 3,
      });
      polls += 1;
      if (polls === 1) return response(202, { status: 'authorization_pending' });
      return response(200, {
        status: 'authorized', worker_key: 'per-installation-key',
        installation_id: 'installation-id', username: 'test-user',
      });
    },
    sleep: async () => {},
    onPending: async detail => pending.push(detail),
  });
  assert.deepEqual(result, {
    workerKey: 'per-installation-key', installationId: 'installation-id', authorizedUser: 'test-user',
  });
  assert.equal(pending[0].userCode, 'ABCD-2345');
  assert.equal(requests.length, 3);
  assert.equal(JSON.parse(requests[0].options.body).name, 'Test workstation');
  assert.equal(JSON.parse(requests[1].options.body).device_code, 'private-device-code');
});

test('device authorization rejects unsafe browser URLs and server errors', async () => {
  await assert.rejects(authorizeDevice({
    serverUrl: 'https://garlicsaves.test',
    fetchImpl: async () => response(201, {
      device_code: 'private-device-code', user_code: 'ABCD-2345',
      verification_uri: 'file:///tmp/unsafe', interval: 3,
    }),
  }), /unsafe authorization URL/);
  await assert.rejects(authorizeDevice({
    serverUrl: 'https://garlicsaves.test',
    fetchImpl: async () => response(403, { error: 'denied' }),
  }), /denied/);
});
