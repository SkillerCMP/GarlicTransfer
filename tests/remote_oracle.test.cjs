const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const net = require('node:net');
const { startRemoteOracle, stopRemoteOracle } = require('../electron/remote_oracle.cjs');

test('remote oracle submits and reads a job with its read token', async t => {
  const requests = [];
  const result = {
    key1: '11'.repeat(16), key2: '22'.repeat(16), nonce1: '33'.repeat(4), nonce2: '44'.repeat(4),
  };
  const server = http.createServer((request, response) => {
    requests.push({ method: request.method, url: request.url, jobToken: request.headers['x-job-token'] });
    request.resume();
    request.on('end', () => {
      response.setHeader('Content-Type', 'application/json');
      if (request.method === 'POST') response.end(JSON.stringify({ job_id: 'ppr-job', job_token: 'read-secret' }));
      else if (request.url.endsWith('/result')) response.end(JSON.stringify(result));
      else response.end(JSON.stringify({ status: 'done', logs: [] }));
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const logs = [];
  const relay = await startRemoteOracle({
    serverUrl: `http://127.0.0.1:${server.address().port}`, workerKey: 'worker-key', onLog: message => logs.push(message),
  });
  t.after(() => {
    stopRemoteOracle(relay);
    server.closeAllConnections();
    server.close();
  });
  const socket = net.createConnection({ host: '127.0.0.1', port: relay.port });
  const chunks = [];
  socket.on('data', chunk => chunks.push(chunk));
  socket.write(Buffer.alloc(32, 7));
  await new Promise((resolve, reject) => {
    socket.once('end', resolve);
    socket.once('error', reject);
  });
  assert.equal(Buffer.concat(chunks).toString('hex'), '11'.repeat(16) + '22'.repeat(16) + '33'.repeat(4) + '44'.repeat(4), logs.join('\n'));
  assert.equal(requests.length, 3);
  assert.deepEqual(requests.slice(1).map(request => request.jobToken), ['read-secret', 'read-secret']);
});
