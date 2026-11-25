/* Offline UI fixture: no console or worker connections. */
(function installFixture(window) {
  const users = [{ id: '18c60ea2', name: 'Alex' }, { id: '22aabbcc', name: 'Taylor' }];
  const entries = [
    { id: 122, owner: users[0].id, title: 'PPSA12345', name: 'Adventure Game', kind: 'save', size: 0x1800000, downloaded: true },
    { id: 123, owner: users[0].id, title: 'PPSA54321', name: 'Racing Game', kind: 'save', size: 0x800000, downloaded: true },
    { id: 124, owner: users[1].id, title: 'PPSA12345', name: 'Adventure Game', kind: 'save', size: 0x1000000, downloaded: true },
  ];
  const local = entries.map((entry) => ({ ...entry, files: [
    { file: 'sdimg_DATA', path: `/user/home/${entry.owner}/savedata_prospero/${entry.title}/sdimg_DATA`, size: entry.size - 2048, sha256: 'demo' },
    { file: 'sdimg_sce_sdmemory', path: `/user/home/${entry.owner}/savedata_prospero/${entry.title}/sdimg_sce_sdmemory`, size: 2048, sha256: 'demo' },
  ] }));
  const calls = { downloads: [], uploads: [], exports: [], imports: [], settings: [] };
  let listener = () => {}, settings = { uiLayout: 'cmp', output: '/profiles', assets: '/profiles', metadata: '', useRemoteOracle: true, serverUrl: 'https://example.invalid', workerKey: 'TEST-ONLY' };
  window.cmpFixture = { users, entries, local, calls, emit: (event) => listener(event), get settings() { return settings; } };
  window.confirm = () => true;
  window.alert = () => {};
  if (window.HTMLDialogElement && !window.HTMLDialogElement.prototype.showModal) {
    window.HTMLDialogElement.prototype.showModal = function showModal() { this.open = true; };
    window.HTMLDialogElement.prototype.close = function close() { this.open = false; };
  }
  window.saveTransfer = {
    confirm: async message => window.confirm(message),
    pairingAvailable: true, firewallAvailable: false,
    getSettings: async () => ({ ...settings }), saveSettings: async (value) => { settings = { ...value }; calls.settings.push(value); },
    version: async () => '0.3.1-cmp-skin1', pairingStatus: async () => true,
    discover: async () => [{ type: 'PS5', host: '192.168.0.125', hostId: 'HOST1', firmware: '13600000', name: 'PS5 · Demo' }],
    localProfiles: async () => ({ profiles: [{ id: 'HOST1', name: 'Demo console', path: '/profiles/HOST1', users: users.map((user) => user.id), save_count: 6 }] }),
    localSaves: async () => ({ entries: local, warnings: [] }), users: async () => users,
    inventory: async () => ({ entries, users }),
    onEvent: (callback) => { listener = callback; },
    download: async (value) => { calls.downloads.push(value); listener({ type: 'entries', entries, users }); listener({ type: 'ready', message: 'Offline preview · choose the saves to download', users }); },
    select: async (ids) => { calls.downloads.push(ids); },
    cancel: async () => {}, finish: async () => listener({ type: 'done', message: 'Session finished.' }),
    upload: async (value) => { calls.uploads.push(value); listener({ type: 'error', message: 'Offline test: no upload was sent.' }); },
    exportLocalSave: async (value) => { calls.exports.push(value); return { destination: '/exports/save' }; },
    importLocalSave: async (value) => { calls.imports.push(value); },
    chooseExternalFolder: async () => '/external/PPSA99999', chooseExternalSave: async () => '/external/PPSA99999/sdimg_DATA',
    chooseOutput: async () => null, chooseAssets: async () => null, chooseMetadata: async () => null,
    power: async () => {}, pair: async () => {}, runFirewallHelper: async () => {},
  };
  window.saveEditor = new Proxy({ onEvent: () => {} }, { get: (target, key) => target[key] || (async () => null) });
})(window);
