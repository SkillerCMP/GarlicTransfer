(function expose(root, build) {
  const api = build();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ConsoleInfo = api;
})(typeof window === 'object' ? window : globalThis, function build() {
  const DEFAULT_JB_FIRMWARE = '13.60';
  // Function Firmware Parsing
  function normalizeFirmware(value) {
    let major, minor;
    if (Array.isArray(value) && value.length === 2) [major, minor] = value;
    else {
      const text = typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
        ? String(value).padStart(8, '0') : typeof value === 'string' ? value.trim() : '';
      const dotted = /^(\d+)\.(\d{2})$/.exec(text);
      if (dotted) { major = Number(dotted[1]); minor = Number(dotted[2]); }
      else if (/^\d{8}$/.test(text)) { major = Number(text.slice(0, 2)); minor = Number(text.slice(2, 4)); }
      else return null;
    }
    return Number.isSafeInteger(major) && major > 0 && Number.isInteger(minor) && minor >= 0 && minor <= 99
      ? [major, minor] : null;
  }

  // Function Firmware Label
  function formatFirmware(value) {
    const version = normalizeFirmware(value);
    return version ? `${version[0]}.${String(version[1]).padStart(2, '0')}` : 'Unknown';
  }

  // Function Firmware Limit
  function firmwareEligible(value, limit = DEFAULT_JB_FIRMWARE) {
    const version = normalizeFirmware(value), maximum = normalizeFirmware(normalizeFirmwareLimit(limit));
    return Boolean(version && maximum && (version[0] < maximum[0] || (version[0] === maximum[0] && version[1] <= maximum[1])));
  }

  // Function IPv4 Parsing
  function canonicalIPv4(value) {
    if (typeof value !== 'string') return '';
    const text = value.trim();
    if (!/^\d{1,3}(?:\.\d{1,3}){3}$/.test(text)) return '';
    const parts = text.split('.').map(Number);
    return parts.every(part => part <= 255) ? parts.join('.') : '';
  }

  // Function Firmware Setting
  function normalizeFirmwareLimit(value) {
    if (typeof value !== 'string' || !/^\d+\.\d{2}$/.test(value.trim())) return '';
    const version = normalizeFirmware(value);
    return version ? formatFirmware(version) : '';
  }

  // Function Console Identity
  function normalizeConsole(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const host = canonicalIPv4(value.host);
    if (!host) return null;
    const type = typeof value.type === 'string' ? value.type.trim().toUpperCase() : '';
    const originalId = typeof value.hostId === 'string' ? value.hostId.trim() : '';
    const hostId = originalId.toUpperCase();
    const profileId = typeof value.profileId === 'string' ? value.profileId.trim() : originalId;
    const name = typeof value.name === 'string' && value.name.trim() ? value.name.trim() : type || 'PlayStation';
    return { ...value, host, type, hostId, profileId, name };
  }

  // Function Console Inventory
  function normalizeConsoles(values) {
    const found = new Map();
    for (const value of Array.isArray(values) ? values : []) {
      const console = normalizeConsole(value);
      if (console && !found.has(console.host)) found.set(console.host, console);
    }
    return [...found.values()];
  }

  return { DEFAULT_JB_FIRMWARE, normalizeFirmware, formatFirmware, firmwareEligible, canonicalIPv4, normalizeFirmwareLimit, normalizeConsole, normalizeConsoles };
});
