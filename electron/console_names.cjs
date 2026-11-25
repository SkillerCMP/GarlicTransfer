const fs = require('node:fs');
const path = require('node:path');

function namesPath(root) {
  return path.join(root, 'console-names.json');
}

function loadConsoleNames(root) {
  try {
    return JSON.parse(fs.readFileSync(namesPath(root), 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return {};
    throw error;
  }
}

function recordConsoleNames(root, consoles) {
  const names = loadConsoleNames(root);
  for (const console of consoles) {
    const profile = typeof console.profileId === 'string' ? console.profileId.trim()
      : typeof console.hostId === 'string' ? console.hostId.trim() : '';
    if (!profile || !console.name) continue;
    names[profile] = {
      name: console.name,
      firmware: console.firmware || '',
    };
  }
  if (!consoles.length) return;
  fs.mkdirSync(root, { recursive: true });
  const temporary = `${namesPath(root)}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(names, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(temporary, namesPath(root));
}

module.exports = { loadConsoleNames, recordConsoleNames };
