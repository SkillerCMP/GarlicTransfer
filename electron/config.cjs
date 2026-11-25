const fs = require('node:fs');
const path = require('node:path');

const { app } = require('electron');
const { defaultDownloads } = require('./paths.cjs');
const { DEFAULT_JB_FIRMWARE, normalizeFirmwareLimit } = require('./console_info.js');
const i18n = require('./i18n.js');
require('./locales/zh-CN.js');
const configPath = app.isPackaged
  ? path.join(app.getPath('userData'), 'config.ini')
  : path.join(__dirname, '..', 'config.ini');
const fields = [
  'useRemoteOracle', 'serverUrl', 'workerKey', 'oracleHost', 'oraclePort',
  'interface', 'hardware', 'output', 'metadata', 'assets',
  'userId', 'titleId', 'entryId', 'userName', 'sourcePort', 'dataPort', 'discoveryPort', 'preferIpv6',
  'uploadDisplayName', 'uiLayout', 'jbFirmwareLimit', 'uiLanguage',
];
const defaults = {
  useRemoteOracle: true,
  serverUrl: 'https://garlicsaves.com',
  workerKey: 'd398596b0dd4ad811173e3324a94d1cc90246a1c7f75b405a5696eed200b353e',
  oracleHost: '192.168.0.125',
  oraclePort: 9022,
  interface: 'wlp4s0',
  hardware: 0,
  output: defaultDownloads,
  metadata: '',
  assets: defaultDownloads,
  userId: '',
  titleId: '',
  entryId: 137,
  userName: 'user',
  sourcePort: 1004,
  dataPort: 1005,
  discoveryPort: 1006,
  preferIpv6: false,
  uploadDisplayName: 'GarlicTransfer',
  uiLayout: 'classic',
  jbFirmwareLimit: DEFAULT_JB_FIRMWARE,
  uiLanguage: 'auto',
};

function parse(text) {
  const result = {};
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith(';') || trimmed.startsWith('#')) continue;
    const index = trimmed.indexOf('=');
    if (index < 0) continue;
    const key = trimmed.slice(0, index).trim();
    const value = trimmed.slice(index + 1).trim();
    if (fields.includes(key)) result[key] = value;
  }
  return result;
}

function loadSettings() {
  let stored = {};
  try {
    stored = parse(fs.readFileSync(configPath, 'utf8'));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  return {
    ...defaults,
    ...stored,
    useRemoteOracle: stored.useRemoteOracle
      ? stored.useRemoteOracle === 'true'
      : defaults.useRemoteOracle,
    workerKey: String(stored.workerKey || '').trim() || defaults.workerKey,
    oraclePort: Number(stored.oraclePort || defaults.oraclePort),
    hardware: Number(stored.hardware || defaults.hardware),
    entryId: Number(stored.entryId || defaults.entryId),
    sourcePort: Number(stored.sourcePort || defaults.sourcePort),
    dataPort: Number(stored.dataPort || defaults.dataPort),
    discoveryPort: Number(stored.discoveryPort || defaults.discoveryPort),
    uiLayout: /^[a-z][a-z0-9-]{0,63}$/.test(stored.uiLayout || '') ? stored.uiLayout : 'classic',
    uiLanguage: i18n.preference(stored.uiLanguage),
    preferIpv6: stored.preferIpv6 === 'true',
    jbFirmwareLimit: normalizeFirmwareLimit(stored.jbFirmwareLimit) || defaults.jbFirmwareLimit,
  };
}

function saveSettings(settings) {
  const limit = settings.jbFirmwareLimit === undefined ? loadSettings().jbFirmwareLimit : normalizeFirmwareLimit(settings.jbFirmwareLimit);
  if (!limit) throw new Error(`Enter the JB firmware limit as major.minor, for example ${DEFAULT_JB_FIRMWARE}.`);
  const lines = ['; GarlicTransfer settings'];
  for (const field of fields) {
    const value = field === 'uiLayout' ? (/^[a-z][a-z0-9-]{0,63}$/.test(settings[field] || '') ? settings[field] : 'classic')
      : field === 'uiLanguage' ? i18n.preference(settings[field])
      : field === 'useRemoteOracle' ? Boolean(settings[field]) : field === 'jbFirmwareLimit' ? limit : settings[field];
    lines.push(`${field}=${value ?? ''}`);
  }
  fs.writeFileSync(configPath, `${lines.join('\n')}\n`, { mode: 0o600 });
}

module.exports = { loadSettings, saveSettings };
