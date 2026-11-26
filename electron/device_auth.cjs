function apiOrigin(serverUrl) {
  const origin = String(serverUrl || '').trim().replace(/\/+$/, '');
  if (!/^https?:\/\//i.test(origin)) throw new Error('Enter a valid GarlicSaves server URL in Settings');
  return origin;
}

async function responseJson(response) {
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`GarlicSaves returned an invalid response (${response.status})`);
  }
}

async function authorizeDevice({
  serverUrl,
  name = 'GarlicTransfer installation',
  onPending,
  fetchImpl = fetch,
  sleep = ms => new Promise(resolve => setTimeout(resolve, ms)),
  timeoutMs = 10 * 60 * 1000,
}) {
  const origin = apiOrigin(serverUrl);
  const createdResponse = await fetchImpl(`${origin}/api/v1/device/code`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ name: String(name).slice(0, 64) }),
  });
  const created = await responseJson(createdResponse);
  if (!createdResponse.ok) throw new Error(created.error || 'Could not start installation authorization');
  if (!created.device_code || !created.user_code || !created.verification_uri) {
    throw new Error('GarlicSaves returned an incomplete authorization request');
  }
  const verificationUrl = new URL(created.verification_uri);
  if (!['http:', 'https:'].includes(verificationUrl.protocol)) {
    throw new Error('GarlicSaves returned an unsafe authorization URL');
  }
  if (onPending) await onPending({
    userCode: created.user_code,
    verificationUri: created.verification_uri,
    expiresIn: created.expires_in,
  });

  const deadline = Date.now() + timeoutMs;
  const interval = Math.max(3000, Number(created.interval || 3) * 1000);
  while (Date.now() < deadline) {
    await sleep(interval);
    const response = await fetchImpl(`${origin}/api/v1/device/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ device_code: created.device_code }),
    });
    const result = await responseJson(response);
    if (response.status === 202 && result.status === 'authorization_pending') continue;
    if (response.status === 429) continue;
    if (!response.ok) throw new Error(result.error || 'Installation authorization failed');
    if (result.status !== 'authorized' || !result.worker_key || !result.installation_id) {
      throw new Error('GarlicSaves returned incomplete installation credentials');
    }
    return {
      workerKey: result.worker_key,
      installationId: result.installation_id,
      authorizedUser: result.username || '',
    };
  }
  throw new Error('Installation authorization expired; try again');
}

module.exports = { authorizeDevice };
