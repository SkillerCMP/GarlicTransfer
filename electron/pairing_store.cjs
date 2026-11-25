const fs = require('node:fs');
const path = require('node:path');

function pairingPrefixPath(userData, { hostId, systemVersion }) {
  if (typeof hostId !== 'string' || !/^[0-9a-f]{12}$/i.test(hostId)) {
    throw new Error('Discover a console with a valid host ID before pairing');
  }
  if (typeof systemVersion !== 'string' || !/^[0-9a-f]{8}$/i.test(systemVersion)) {
    throw new Error('Discover the console firmware before pairing');
  }
  return path.join(userData, 'pairings', `${hostId.toUpperCase()}-${systemVersion.toUpperCase()}`, 'pairing-prefix.bin');
}

function existingPairingPrefix(userData, identity) {
  const file = pairingPrefixPath(userData, identity);
  try {
    const stat = fs.lstatSync(file);
    return stat.isFile() && stat.size === 32 ? file : null;
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

// Function Pairing Containment
function insideDirectory(root, selected) {
  const relative = path.relative(root, selected);
  return relative !== '' && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

// Function Pairing Folder
function pairingDirectory(root, selected) {
  try {
    const stat = fs.lstatSync(selected);
    if (!stat.isDirectory() || stat.isSymbolicLink()) return null;
    const actual = fs.realpathSync(selected);
    return insideDirectory(root, actual) ? actual : null;
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

// Function Pairing File
function pairingFile(root, selected) {
  try {
    const stat = fs.lstatSync(selected);
    return stat.isFile() && !stat.isSymbolicLink() && stat.size === 32 && insideDirectory(root, fs.realpathSync(selected));
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}

// Function Pairing Cache
function readOnce(cache, key, read) {
  if (!cache.has(key)) {
    try { cache.set(key, { value: read() }); }
    catch (error) { cache.set(key, { error }); }
  }
  const result = cache.get(key);
  if (Object.hasOwn(result, 'error')) throw result.error;
  return result.value;
}

// Function Pairing Lookup
function pairingLookup(userData) {
  const shared = new Map(), directories = new Map(), prefixes = new Map(), identities = new Map();
  const folderAt = (root, selected) => readOnce(directories, selected, () => pairingDirectory(root, selected));
  const prefixAt = (root, identity = null) => readOnce(prefixes, path.join(root, 'pairing-prefix.bin'), () => {
    if (identity && !existingPairingPrefix(userData, identity)) return false;
    return pairingFile(root, path.join(root, 'pairing-prefix.bin'));
  });
  const pairingRoot = () => readOnce(shared, 'root', () => {
    let base;
    try { base = fs.realpathSync(userData); }
    catch (error) {
      if (error.code === 'ENOENT') return null;
      throw error;
    }
    return folderAt(base, path.join(userData, 'pairings'));
  });
  const history = folder => readOnce(shared, 'history', () => {
    const hosts = new Map();
    for (const name of fs.readdirSync(folder)) {
      if (name.length !== 21) continue;
      const match = /^([0-9a-f]{12})-([0-9a-f]{8})$/i.exec(name);
      if (!match) continue;
      const host = match[1].toUpperCase();
      if (!hosts.has(host)) hosts.set(host, []);
      hosts.get(host).push({ name, firmware: match[2].toUpperCase() });
    }
    return hosts;
  });
  return identity => {
    if (!identity || typeof identity.hostId !== 'string' || identity.hostId.length !== 12 || !/^[0-9a-f]{12}$/i.test(identity.hostId)
        || typeof identity.systemVersion !== 'string' || identity.systemVersion.length !== 8 || !/^[0-9a-f]{8}$/i.test(identity.systemVersion)) {
      return 'unknown';
    }
    const host = identity.hostId.toUpperCase(), firmware = identity.systemVersion.toUpperCase();
    return readOnce(identities, `${host}-${firmware}`, () => {
      const folder = pairingRoot();
      if (!folder) return 'unpaired';
      const current = folderAt(folder, path.join(folder, `${host}-${firmware}`));
      if (current && prefixAt(current, identity)) return 'paired';
      for (const previous of history(folder).get(host) || []) {
        if (previous.firmware === firmware) continue;
        const directory = folderAt(folder, path.join(folder, previous.name));
        if (directory && prefixAt(directory)) return 'previous';
      }
      return 'unpaired';
    });
  };
}

// Function Pairing Information
function pairingInfo(userData, identity) {
  return { status: pairingLookup(userData)(identity) };
}

// Function Pairing Batch
function pairingInfos(userData, identities) {
  if (!Array.isArray(identities)) throw new TypeError('Pass an array of console identities.');
  if (identities.length > 256) throw new Error('Check no more than 256 consoles at once.');
  const lookup = pairingLookup(userData);
  return Array.from(identities, identity => {
    try { return { status: lookup(identity) }; }
    catch { return { status: 'unknown' }; }
  });
}

module.exports = { pairingPrefixPath, existingPairingPrefix, pairingInfo, pairingInfos };
