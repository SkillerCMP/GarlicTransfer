const myControls = {};
for (const id of [
  'mySavesTab', 'mySaveEntries', 'myTitleEntries', 'myTitleList', 'myTitleSaveList',
  'mySavesBackBtn', 'mySavesLibraryLabel', 'localConsoleSelect', 'localUserSelect', 'chooseLocalPcFolderBtn', 'localPcFolderLabel',
  'refreshMySavesBtn', 'decryptExternalBtn', 'selectedSavePanel',
  'selectedSaveName', 'selectedSaveDetails', 'mySaveDecryptBtn', 'mySaveResignBtn', 'mySaveExportBtn',
  'saveMoreBtn', 'saveMoreOptions', 'decryptExportBtn', 'saveEncryptFileBtn',
  'uploadSaveBtn', 'uploadEncryptedBtn', 'workspaceMoreBtn', 'workspaceMoreOptions', 'fileMoreBtn', 'fileMoreOptions',
  'mySaveImportBtn', 'resignPanel', 'resignAccountId', 'confirmResignBtn', 'workspacePanel',
  'workspaceSummary', 'closeWorkspaceBtn', 'exportDecryptedBtn', 'addFilesBtn', 'encryptSaveBtn',
  'encryptPanel', 'encryptAccountId', 'confirmEncryptBtn', 'workspaceFiles', 'fileEditorPanel',
  'editorFileName', 'editorMode', 'fileEditor', 'editorHint', 'editorSearch', 'editorFindNext',
  'editorOffset', 'editorGoOffset', 'editorRevert', 'editorByteCount', 'saveFileBtn', 'downloadFileBtn',
  'replaceFileBtn', 'deleteFileBtn', 'mySavesStatus', 'mySavesLog',
]) myControls[id] = document.getElementById(id);
myControls.mySavesTab = document.getElementById('libraryPage');

let currentWizardStep = 0;
function goToLibraryStep(step) {
  currentWizardStep = step;
  const accountControls = document.getElementById('workspaceAccountControls');
  const accountHost = step === 1 ? myControls.selectedSavePanel : document.querySelector('.workspace-heading');
  if (accountControls && accountHost && accountControls.parentElement !== accountHost) {
    if (step === 1) accountHost.prepend(accountControls);
    else accountHost.append(accountControls);
  }
  for (const panel of document.querySelectorAll('.wizard-panel')) {
    const isTarget = panel.dataset.wizard === String(step);
    panel.classList.toggle('active', isTarget);
  }
  for (const btn of document.querySelectorAll('.wizard-step')) {
    const s = Number(btn.dataset.step);
    btn.classList.toggle('active', s === step);
    btn.classList.toggle('done', s < step);
  }
}
for (const btn of document.querySelectorAll('.wizard-step')) {
  btn.addEventListener('click', () => {
    const target = Number(btn.dataset.step);
    if (target === 1 && !selectedLocalSave) return;
    if (target === 2 && !decryptedWorkspace) return;
    goToLibraryStep(target);
  });
}
for (const btn of document.querySelectorAll('.wizard-back')) {
  btn.addEventListener('click', () => goToLibraryStep(Number(btn.dataset.go)));
}

let mySaves = [];
let cmpLocalUsers = [];
let cmpLocalRequest = 0;
let cmpInventoryRequest = 0;
let loadedLocalPath = null;
let localProfiles = [];
const LOCAL_PC_SOURCE = '__local_pc__';
let localPcMode = false;
let localPcInventory = { root: '', entries: [], users: [], warnings: [], active: false };
let localProfileRequest = 0;
let selectedLocalSource = '';
let selectedTitle = null;
let selectedLocalSave = null;
let decryptedWorkspace = null;
let decryptedArchive = null;
let decryptedTemporaryId = null;
let workspaceDetails = null;
let accountWorkspace = null;
let selectedWorkspaceFile = null;
let selectedFileBytes = null;
let editorDirty = false;
let workspaceModified = false;
let mySaveOperation = false;
let myOperationSequence = 0;
let myCancelOperation = 0;
let myCancellationSequence = 0;
let workspaceTree = null;
const MAX_EDITOR_FILE_BYTES = 8 * 1024 * 1024;

function myStatus(message) {
  myControls.mySavesStatus.textContent = message;
}

function myLog(message) {
  myControls.mySavesLog.textContent += `${message}\n`;
  myControls.mySavesLog.scrollTop = myControls.mySavesLog.scrollHeight;
}

// Function Account Selection
const savedAccounts = window.saveAccounts && window.SavedAccounts?.create(document, window.saveAccounts, {
  isBusy: () => Boolean(mySaveOperation || activeTransfer || browseSessionActive),
  onTargetChange: id => {
    myControls.encryptAccountId.value = id || workspaceDetails?.accountId || '';
    myControls.resignAccountId.value = id || '';
    const fixedAccount = savedAccounts.isUsingCurrent() || Boolean(savedAccounts.getSelectedId());
    myControls.encryptAccountId.readOnly = fixedAccount;
    myControls.resignAccountId.readOnly = fixedAccount;
  },
});

// Function Account Closing
window.saveAccounts?.onBeforeClose?.(async () => {
  setAccountClosing(true);
  savedAccounts?.setBusy(true);
  await savedAccounts?.prepareClose();
}, () => {
  setAccountClosing(false);
  savedAccounts?.setBusy(mySaveOperation);
});
document.addEventListener('transfer-state-changed', () => {
  savedAccounts?.setBusy(mySaveOperation || accountClosing);
  workspaceTree?.setBusy(mySaveOperation || accountClosing || Boolean(activeTransfer) || browseSessionActive);
});

function setMyOperation(value) {
  mySaveOperation = value;
  myControls.localConsoleSelect.disabled = value;
  myControls.localUserSelect.disabled = value;
  cmpLayout.setLibraryBusy(value);
  for (const button of document.querySelectorAll('#libraryPage button')) button.disabled = value;
  for (const input of document.querySelectorAll('.editor-tools input')) input.disabled = value;
  myControls.fileEditor.disabled = value;
  myControls.editorMode.disabled = value;
  myControls.resignAccountId.disabled = value;
  myControls.encryptAccountId.disabled = value;
  myControls.workspaceFiles.style.pointerEvents = value ? 'none' : '';
  workspaceTree?.setBusy(value || accountClosing);
  savedAccounts?.setBusy(value || accountClosing);
  if (!value) updateMyFileActions();
}

async function runMyOperation(action) {
  if (accountClosing || mySaveOperation || activeTransfer || browseSessionActive) {
    myStatus('Finish the current transfer or save operation first.');
    return null;
  }
  const operation = ++myOperationSequence;
  activeTransfer = 'save-editor';
  setMyOperation(true);
  busy(true);
  try {
    return await action();
  } catch (error) {
    if (myCancelOperation === operation) {
      myStatus('Save operation canceled.');
      status('Save operation canceled.');
      myLog('Save operation canceled.');
    } else {
      myStatus(error.message);
      myLog(`Error: ${error.message}`);
    }
    return null;
  } finally {
    if (myOperationSequence === operation) {
      if (myCancelOperation === operation) myCancelOperation = 0;
      if (activeTransfer === 'save-editor') activeTransfer = null;
      setMyOperation(false);
      busy(Boolean(activeTransfer));
    }
  }
}

// Function Save Confirmation
async function confirmSaveAction(message) {
  const cancellation = myCancellationSequence;
  const confirmed = await confirmAction(message);
  return confirmed && cancellation === myCancellationSequence;
}

// Function Save Cancellation
async function cancelMySaveOperation() {
  if (!mySaveOperation || activeTransfer !== 'save-editor') return;
  const operation = myOperationSequence;
  if (myCancelOperation === operation) return;
  myCancelOperation = operation;
  myCancellationSequence++;
  controls.cancelBtn.disabled = true;
  myStatus('Canceling the save operation…');
  status('Canceling the save operation…');
  try {
    const canceled = typeof window.saveEditor.cancel === 'function' && await window.saveEditor.cancel();
    if (myOperationSequence !== operation || !mySaveOperation || activeTransfer !== 'save-editor') return;
    if (!canceled) {
      if (myCancelOperation === operation) myCancelOperation = 0;
      if (mySaveOperation) {
        const message = 'Close any open file dialog or wait for this step to finish.';
        myStatus(message);
        status(message);
      }
    }
  } catch (error) {
    if (myCancelOperation === operation) myCancelOperation = 0;
    if (myOperationSequence === operation && mySaveOperation && activeTransfer === 'save-editor') {
      myStatus(`Could not cancel the save operation: ${error.message}`);
      status(`Could not cancel the save operation: ${error.message}`);
    }
  } finally {
    if (myOperationSequence === operation && mySaveOperation && activeTransfer === 'save-editor' && myCancelOperation !== operation) controls.cancelBtn.disabled = false;
  }
}

// Function Save File Key
function localSaveKey(save) { return window.SaveTreeBridge.fileKey(save.entry, save.file); }

// Function Save Source
function localSaveOptions(save = selectedLocalSave) {
  return { ...(save.entry.localSource === 'pc' ? { localSource: 'pc' } : { assets: options().assets }),
    entryId: save.entry.id, filename: save.file.file };
}

// Function Save Options
function saveJobOptions() {
  const current = options();
  return { serverUrl: current.serverUrl, workerKey: current.workerKey,
    useRemoteOracle: current.useRemoteOracle, oracleHost: current.oracleHost };
}

// Function Temporary Release
async function releaseSaveTemporary(id) {
  if (!id || typeof window.saveEditor.releaseTemporary !== 'function') return;
  try { await window.saveEditor.releaseTemporary(id); }
  catch (error) { myLog(`Could not clear temporary save files: ${error.message}`); }
}

// Function Empty Source
function emptyLocalMessage() {
  return localPcMode ? (localPcInventory.root ? 'No supported encrypted PS5 saves found in this folder.' : 'Choose a Saves folder on your PC to get started.')
    : 'Download a save with the Transfer tab, or decrypt another save.';
}

// Function Source Users
function renderLocalUsers(ids, users) {
  const previous = myControls.localUserSelect.value;
  myControls.localUserSelect.replaceChildren();
  const all = document.createElement('option'); all.value = ''; all.textContent = 'All users';
  myControls.localUserSelect.appendChild(all);
  for (const value of ids) {
    const id = String(value).toLowerCase(), name = users.find(user => String(user.id).toLowerCase() === id)?.name;
    const option = document.createElement('option'); option.value = id;
    option.textContent = id === 'unassigned' ? 'Unassigned' : name && name !== id ? `${name} (${id})` : id;
    myControls.localUserSelect.appendChild(option);
  }
  myControls.localUserSelect.value = ids.some(id => String(id).toLowerCase() === previous) ? previous : '';
}

// Function Local Tree
const libraryTree = window.SaveTreeBridge.library({
  layout: cmpLayout, onOpen: (save) => selectMySave(save),
  onAction: (action) => myControls[action].click(), isBusy: () => accountClosing || mySaveOperation,
});

function myTitleGroups() {
  const groups = new Map();
  for (const save of mySaves) {
    const key = save.entry.title || save.entry.name;
    if (!groups.has(key)) groups.set(key, { key, name: save.entry.name || save.entry.title, titleId: save.entry.title, saves: [], bytes: 0 });
    const group = groups.get(key);
    group.saves.push(save);
    group.bytes += save.file.size;
  }
  return groups;
}

function selectMyTitle(title) {
  selectedTitle = title;
  selectedLocalSave = null;
  myControls.selectedSavePanel.hidden = true;
  renderMySaves();
  const group = myTitleGroups().get(title);
  myStatus(`${group.name}: ${group.saves.length} save file(s). Select one to continue.`);
}

let saveContextMenu = null;

function closeSaveContextMenu() {
  if (saveContextMenu) saveContextMenu.remove();
  saveContextMenu = null;
}

document.addEventListener('pointerdown', (event) => {
  if (saveContextMenu && !saveContextMenu.contains(event.target)) closeSaveContextMenu();
});
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') closeSaveContextMenu();
});
window.addEventListener('blur', closeSaveContextMenu);

function openSaveContextMenu(event, actions, position = event) {
  event.preventDefault();
  event.stopPropagation();
  closeSaveContextMenu();
  if (accountClosing || mySaveOperation || activeTransfer || browseSessionActive) return;
  saveContextMenu = document.createElement('div');
  saveContextMenu.className = 'save-context-menu';
  saveContextMenu.setAttribute('role', 'menu');
  for (const action of actions) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = action.label;
    button.setAttribute('role', 'menuitem');
    button.addEventListener('click', () => {
      closeSaveContextMenu();
      action.run();
    });
    saveContextMenu.appendChild(button);
  }
  document.body.appendChild(saveContextMenu);
  const bounds = saveContextMenu.getBoundingClientRect();
  saveContextMenu.style.left = `${Math.max(8, Math.min(position.clientX || 8, window.innerWidth - bounds.width - 8))}px`;
  saveContextMenu.style.top = `${Math.max(8, Math.min(position.clientY || 8, window.innerHeight - bounds.height - 8))}px`;
  saveContextMenu.querySelector('button')?.focus();
}

function attachSaveContextMenu(row, actions, select) {
  row.tabIndex = 0;
  row.addEventListener('contextmenu', (event) => openSaveContextMenu(event, actions));
  row.addEventListener('keydown', (event) => {
    if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
      const bounds = row.getBoundingClientRect();
      openSaveContextMenu(event, actions, { clientX: bounds.left + 20, clientY: bounds.bottom });
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      select();
    }
  });
}

function localSaveActions(save) {
  const action = (label, control) => ({
    label,
    run: async () => {
      if (accountClosing || mySaveOperation || activeTransfer || browseSessionActive) return;
      if (!await selectMySave(save)) return;
      if (control) myControls[control].click();
    },
  });
  return [
    action('Select save'),
    action('Decrypt & edit', 'mySaveDecryptBtn'),
    action('Upload to PS5', 'uploadSaveBtn'),
    action('Decrypt and export', 'decryptExportBtn'),
    action('Export original', 'mySaveExportBtn'),
    action('Import replacement…', 'mySaveImportBtn'),
    action('Resign', 'mySaveResignBtn'),
  ];
}

function renderMySaves() {
  closeSaveContextMenu();
  if (cmpLayout.active) {
    libraryTree.render({ saves: mySaves, users: cmpLocalUsers,
      filter: myControls.localUserSelect.value.toLowerCase(), busy: mySaveOperation, selected: selectedLocalSave });
    return;
  }
  renderClassicMySaves();
}

// Function Classic Save List
function renderClassicMySaves() {
  const groups = myTitleGroups();
  const selectedGroup = selectedTitle ? groups.get(selectedTitle) : null;
  if (selectedTitle && !selectedGroup) selectedTitle = null;
  myControls.myTitleList.hidden = Boolean(selectedTitle);
  myControls.myTitleSaveList.hidden = !selectedTitle;
  myControls.mySavesBackBtn.hidden = !selectedTitle;
  myControls.mySavesLibraryLabel.textContent = selectedGroup ? selectedGroup.name : 'All titles';
  myControls.myTitleEntries.replaceChildren();
  myControls.mySaveEntries.replaceChildren();
  if (!mySaves.length) {
    const row = document.createElement('tr'), cell = document.createElement('td');
    cell.colSpan = 4; cell.className = 'empty'; cell.textContent = emptyLocalMessage();
    row.appendChild(cell); myControls.myTitleEntries.appendChild(row);
    return;
  }
  if (!selectedTitle) {
    for (const group of groups.values()) {
      const row = document.createElement('tr');
      const title = document.createElement('td');
      title.textContent = group.name;
      const count = document.createElement('td');
      count.textContent = `${group.saves.length}`;
      const size = document.createElement('td');
      size.textContent = `${(group.bytes / 0x100000).toFixed(1)} MiB`;
      const actions = document.createElement('td');
      const open = document.createElement('button');
      open.type = 'button';
      open.className = 'secondary';
      open.textContent = 'View saves';
      open.addEventListener('click', (event) => { event.stopPropagation(); selectMyTitle(group.key); });
      actions.appendChild(open);
      row.append(title, count, size, actions);
      row.addEventListener('click', () => selectMyTitle(group.key));
      attachSaveContextMenu(row, [{ label: 'View saves', run: () => selectMyTitle(group.key) }], () => selectMyTitle(group.key));
      myControls.myTitleEntries.appendChild(row);
    }
    return;
  }
  for (const save of selectedGroup.saves) {
    const row = document.createElement('tr');
    if (selectedLocalSave && localSaveKey(selectedLocalSave) === localSaveKey(save)) row.className = 'selected';
    const file = document.createElement('td');
    file.textContent = save.file.file;
    const entryLabel = document.createElement('span');
    entryLabel.className = 'title-id';
    entryLabel.textContent = `Entry ${save.entry.id}`;
    file.appendChild(entryLabel);
    const size = document.createElement('td');
    size.textContent = `${(save.file.size / 0x100000).toFixed(1)} MiB`;
    const actions = document.createElement('td');
    const select = document.createElement('button');
    select.type = 'button';
    select.className = 'secondary';
    select.textContent = selectedLocalSave && localSaveKey(selectedLocalSave) === localSaveKey(save) ? 'Selected' : 'Select';
    select.addEventListener('click', (event) => { event.stopPropagation(); selectMySave(save); });
    actions.appendChild(select);
    row.append(file, size, actions);
    row.addEventListener('click', () => selectMySave(save));
    attachSaveContextMenu(row, localSaveActions(save), () => selectMySave(save));
    myControls.mySaveEntries.appendChild(row);
  }
}

myControls.mySavesBackBtn.addEventListener('click', () => {
  selectedTitle = null;
  selectedLocalSave = null;
  myControls.selectedSavePanel.hidden = true;
  renderMySaves();
  goToLibraryStep(0);
  myStatus('Select a title to see its saves.');
});

// Function Save Selection
function applyMySaveSelection(save) {
  selectedLocalSave = save;
  myControls.selectedSavePanel.hidden = false;
  myControls.selectedSaveName.textContent = save.entry.name || save.entry.title;
  myControls.selectedSaveDetails.textContent = `${save.file.file} · Entry ${save.entry.id} · ${(save.file.size / 0x100000).toFixed(1)} MiB · ${save.entry.title}`;
  myControls.resignPanel.hidden = true;
  renderMySaves();
  goToLibraryStep(1);
  myStatus(`${save.file.file} selected. Choose what you want to do next.`);
  return true;
}

function selectMySave(save) {
  if (accountClosing || mySaveOperation || activeTransfer || browseSessionActive) return false;
  if (!decryptedWorkspace || (selectedLocalSave && localSaveKey(save) === localSaveKey(selectedLocalSave))) {
    return applyMySaveSelection(save);
  }
  return runMyOperation(async () => {
    if (!await confirmSaveAction(workspaceModified || editorDirty
      ? 'Discard changes that have not been encrypted and select another save?'
      : 'Close the current decrypted files before selecting another save?')) return false;
    await closeMyWorkspace(true);
    return applyMySaveSelection(save);
  });
}

// Function Local Profile
async function selectLocalConsole(profileId, { inventory, persist = true, confirmed = false } = {}) {
  const pc = profileId === LOCAL_PC_SOURCE;
  const profile = localProfiles.find((candidate) => candidate.id === profileId);
  const nextPath = pc ? (inventory || localPcInventory).root || LOCAL_PC_SOURCE : profile?.path;
  const switching = localPcMode !== pc || loadedLocalPath !== nextPath;
  if (switching && decryptedWorkspace && !confirmed && !await confirmSaveAction(workspaceModified || editorDirty
    ? 'Discard changes that have not been encrypted and switch sources?'
    : 'Switch sources and close the current decrypted files?')) {
    myControls.localConsoleSelect.value = selectedLocalSource;
    return;
  }
  const selection = ++cmpLocalRequest;
  ++cmpInventoryRequest;
  if (switching) {
    cmpLayout.resetLibrary();
    if (decryptedWorkspace) await closeMyWorkspace(true);
    selectedTitle = null; selectedLocalSave = null;
    myControls.selectedSavePanel.hidden = true;
    myControls.localUserSelect.value = '';
  }
  localPcMode = pc;
  selectedLocalSource = profileId;
  myControls.chooseLocalPcFolderBtn.hidden = !pc;
  myControls.localPcFolderLabel.hidden = !pc;
  if (persist && typeof window.saveTransfer.setLocalPcActive === 'function') await window.saveTransfer.setLocalPcActive(pc);
  if (selection !== cmpLocalRequest) return;
  if (pc) {
    localPcInventory = inventory || (typeof window.saveTransfer.localPcInventory === 'function' ? await window.saveTransfer.localPcInventory() : localPcInventory);
    if (selection !== cmpLocalRequest) return;
    loadedLocalPath = localPcInventory.root || LOCAL_PC_SOURCE;
    myControls.localPcFolderLabel.textContent = localPcInventory.root || 'Choose a Saves folder with encrypted PS5 save files.';
    cmpLocalUsers = localPcInventory.users || [];
    renderLocalUsers(cmpLocalUsers.map(user => user.id), cmpLocalUsers);
    await refreshMySaves(localPcInventory);
    myStatus(mySaves.length ? `Local PC: ${mySaves.length} save file(s).` : emptyLocalMessage());
    return;
  }
  if (!profile) {
    loadedLocalPath = null; cmpLocalRequest++; cmpInventoryRequest++;
    cmpLayout.resetLibrary();
    selectedTitle = null; selectedLocalSave = null;
    myControls.selectedSavePanel.hidden = true;
    cmpLocalUsers = [];
    mySaves = [];
    renderMySaves();
    myStatus('No downloaded saves were found in this profile.');
    return;
  }
  loadedLocalPath = profile.path;
  controls.output.value = profile.path;
  controls.assets.value = profile.path;
  controls.metadata.value = '';
  cmpLocalUsers = profile.users.map((id) => ({ id, name: id }));
  try {
    const users = await window.saveTransfer.users(folderPaths.metadataPath(profile.path, 'metadata.db'));
    if (selection !== cmpLocalRequest) return;
    cmpLocalUsers = users;
  } catch { /* Older local saves may have no user catalogue. */ }
  if (selection !== cmpLocalRequest) return;
  renderLocalUsers(profile.users, cmpLocalUsers);
  await refreshMySaves();
  myStatus(`${profile.id}: ${mySaves.length} save file(s)${myControls.localUserSelect.value ? ` for ${myControls.localUserSelect.value}` : ''}.`);
}

async function loadLocalProfiles() {
  const request = ++localProfileRequest, previous = selectedLocalSource;
  const root = profileRoot || options().output;
  const [result, pcState] = await Promise.all([
    window.saveTransfer.localProfiles(root).catch(error => {
      myLog(`Console profiles unavailable: ${error.message}`);
      return { profiles: [] };
    }),
    typeof window.saveTransfer.localPcState === 'function' ? window.saveTransfer.localPcState() : localPcInventory,
  ]);
  if (request !== localProfileRequest) return;
  localProfiles = result.profiles || [];
  localPcInventory = pcState.root === localPcInventory.root
    ? { ...localPcInventory, ...pcState }
    : { ...pcState, entries: [], users: [] };
  const current = options().assets.split(/[\\/]/).pop();
  const selected = localProfiles.find((profile) => profile.id === current) || localProfiles[0];
  myControls.localConsoleSelect.replaceChildren();
  const pc = document.createElement('option'); pc.value = LOCAL_PC_SOURCE; pc.textContent = 'Local PC';
  myControls.localConsoleSelect.appendChild(pc);
  for (const profile of localProfiles) {
    const option = document.createElement('option');
    option.value = profile.id;
    option.textContent = `${profile.name ? `${profile.name} — ` : ''}${profile.id} (${profile.save_count} saves)`;
    myControls.localConsoleSelect.appendChild(option);
  }
  if (previous === LOCAL_PC_SOURCE || (!previous && pcState.active) || !selected) {
    const pcInventory = typeof window.saveTransfer.localPcInventory === 'function' ? await window.saveTransfer.localPcInventory() : localPcInventory;
    if (request !== localProfileRequest) return;
    myControls.localConsoleSelect.value = LOCAL_PC_SOURCE;
    await selectLocalConsole(LOCAL_PC_SOURCE, { inventory: pcInventory, persist: false });
  } else if (selected) {
    myControls.localConsoleSelect.value = selected.id;
    await selectLocalConsole(selected.id, { persist: false });
  } else {
    await selectLocalConsole('');
  }
}

myControls.localConsoleSelect.addEventListener('change', () => runMyOperation(() => selectLocalConsole(myControls.localConsoleSelect.value)));

// Function PC Folder
myControls.chooseLocalPcFolderBtn.addEventListener('click', () => runMyOperation(async () => {
  if (!localPcMode) return;
  if (decryptedWorkspace && !await confirmSaveAction(workspaceModified || editorDirty
    ? 'Choose another folder and discard changes that have not been encrypted?'
    : 'Choose another folder and close the current decrypted files?')) return;
  const inventory = await window.saveTransfer.chooseLocalPcFolder();
  if (!inventory) return;
  ++localProfileRequest;
  await selectLocalConsole(LOCAL_PC_SOURCE, { inventory, persist: false, confirmed: true });
}));
myControls.localUserSelect.addEventListener('change', () => runMyOperation(async () => {
  selectedTitle = null;
  selectedLocalSave = null;
  myControls.selectedSavePanel.hidden = true;
  await refreshMySaves(localPcMode ? localPcInventory : undefined);
  myStatus(`${mySaves.length} save file(s) in this view.`);
}));

// Function Save Refresh
async function refreshMySaves(inventory) {
  const pc = localPcMode, assets = pc ? loadedLocalPath : options().assets, owner = myControls.localUserSelect.value.toLowerCase();
  const request = ++cmpInventoryRequest;
  const result = pc ? inventory || await window.saveTransfer.localPcInventory() : await window.saveTransfer.localSaves(assets);
  if (request !== cmpInventoryRequest || pc !== localPcMode || assets !== (pc ? loadedLocalPath : options().assets)
      || owner !== myControls.localUserSelect.value.toLowerCase()) return mySaves.length;
  if (pc) {
    if ((result.root || LOCAL_PC_SOURCE) !== loadedLocalPath) return mySaves.length;
    localPcInventory = result; cmpLocalUsers = result.users || [];
    renderLocalUsers(cmpLocalUsers.map(user => user.id), cmpLocalUsers);
  }
  const filter = myControls.localUserSelect.value.toLowerCase();
  mySaves = (result.entries || [])
    .filter((entry) => !filter || entry.owner.toLowerCase() === filter)
    .flatMap((entry) => entry.files.map((file) => ({ entry, file })));
  if (selectedLocalSave) {
    selectedLocalSave = mySaves.find((save) => localSaveKey(save) === localSaveKey(selectedLocalSave)) || null;
    myControls.selectedSavePanel.hidden = !selectedLocalSave;
  }
  renderMySaves();
  for (const warning of result.warnings || []) myLog(`Skipped invalid save metadata: ${warning}`);
  return mySaves.length;
}

function updateMyFileActions() {
  const protectedSelection = selectedWorkspaceFile?.protected;
  myControls.deleteFileBtn.disabled = mySaveOperation || !selectedWorkspaceFile || protectedSelection;
  myControls.saveFileBtn.disabled = mySaveOperation || !selectedWorkspaceFile || selectedFileBytes === null;
  myControls.saveEncryptFileBtn.disabled = mySaveOperation || !selectedWorkspaceFile || selectedFileBytes === null;
  myControls.downloadFileBtn.disabled = mySaveOperation || !selectedWorkspaceFile;
  if (myControls.replaceFileBtn) myControls.replaceFileBtn.disabled = mySaveOperation || !selectedWorkspaceFile;
}

// Function Workspace Tree
workspaceTree = window.WorkspaceTree?.create(document, myControls.workspaceFiles, {
  onOpen: file => runMyOperation(() => openWorkspaceFile(file)),
  onAction: (action, file) => runMyOperation(() => {
    if (action === 'replace') return replaceWorkspaceFile(file);
    if (action === 'export') return exportWorkspaceFile(file);
    if (action === 'delete') return deleteWorkspaceFile(file);
  }),
  isBusy: () => accountClosing || mySaveOperation || Boolean(activeTransfer) || browseSessionActive,
});

function renderWorkspace() {
  myControls.workspacePanel.hidden = !decryptedWorkspace;
  if (!decryptedWorkspace || !workspaceDetails) return;
  goToLibraryStep(2);
  myControls.workspaceSummary.textContent = `${workspaceDetails.files.length} file(s)${workspaceDetails.titleId ? ` · ${workspaceDetails.titleId}` : ''}`;
  const newAccountWorkspace = accountWorkspace !== decryptedWorkspace;
  accountWorkspace = decryptedWorkspace;
  savedAccounts?.setCurrentAccount(workspaceDetails.accountId || '');
  myControls.encryptAccountId.value = savedAccounts
    ? savedAccounts.getTargetId(newAccountWorkspace ? workspaceDetails.accountId || '' : myControls.encryptAccountId.value || workspaceDetails.accountId || '')
    : workspaceDetails.accountId || myControls.encryptAccountId.value;
  if (workspaceTree) {
    workspaceTree.render(workspaceDetails.files, selectedWorkspaceFile?.path, decryptedWorkspace);
    return;
  }
  myControls.workspaceFiles.replaceChildren();
  for (const file of workspaceDetails.files) {
    const row = document.createElement('tr');
    row.dataset.filePath = file.path;
    if (selectedWorkspaceFile?.path === file.path) row.className = 'selected';
    const name = document.createElement('td');
    name.textContent = file.path;
    const size = document.createElement('td');
    size.textContent = file.size < 1024 ? `${file.size} B` : `${(file.size / 1024).toFixed(1)} KiB`;
    row.append(name, size);
    row.addEventListener('click', () => runMyOperation(() => openWorkspaceFile(file)));
    myControls.workspaceFiles.appendChild(row);
  }
}

function bytesToHex(bytes) {
  const lines = [];
  for (let offset = 0; offset < bytes.length; offset += 16) {
    const chunk = [...bytes.slice(offset, offset + 16)];
    const hex = chunk.map((byte) => byte.toString(16).padStart(2, '0')).join(' ');
    const utf8 = chunk.map((byte) => byte >= 0x20 && byte <= 0x7e ? String.fromCharCode(byte) : '.').join('');
    lines.push(`${offset.toString(16).padStart(8, '0')}  ${hex.padEnd(47, ' ')} |${utf8}|`);
  }
  return lines.join('\n');
}

function editorBytes() {
  if (myControls.editorMode.value === 'text') return new TextEncoder().encode(myControls.fileEditor.value);
  const text = myControls.fileEditor.value
    .replace(/^[0-9a-f]{8}\s+/gm, '')
    .replace(/\s*\|[^|]*\|\s*$/gm, '')
    .replace(/\s+/g, '');
  if (text.length % 2 || /[^0-9a-f]/i.test(text)) throw new Error('Hex mode requires complete bytes written as two hexadecimal digits.');
  const bytes = new Uint8Array(text.length / 2);
  for (let index = 0; index < bytes.length; index++) bytes[index] = parseInt(text.slice(index * 2, index * 2 + 2), 16);
  return bytes;
}

function updateEditorByteCount() {
  let count = selectedFileBytes?.length || 0;
  if (selectedFileBytes) {
    try { count = editorBytes().length; } catch {}
  }
  myControls.editorByteCount.textContent = `${count} byte${count === 1 ? '' : 's'}`;
}

function findSubsequence(haystack, needle, start) {
  if (!needle.length) return -1;
  for (let index = start; index <= haystack.length - needle.length; index++) {
    if (needle.every((byte, offset) => haystack[index + offset] === byte)) return index;
  }
  return -1;
}

function selectEditorLine(line) {
  const lines = myControls.fileEditor.value.split('\n');
  const selected = Math.max(0, Math.min(line, lines.length - 1));
  const start = lines.slice(0, selected).reduce((total, text) => total + text.length + 1, 0);
  myControls.fileEditor.focus();
  myControls.fileEditor.setSelectionRange(start, start + lines[selected].length);
  myControls.fileEditor.scrollTop = Math.max(0, myControls.fileEditor.scrollHeight * (selected / lines.length) - 40);
}

function findInEditor() {
  if (!selectedFileBytes) return;
  const query = myControls.editorSearch.value;
  if (!query) return;
  if (myControls.editorMode.value === 'text') {
    const haystack = myControls.fileEditor.value.toLowerCase();
    const needle = query.toLowerCase();
    let index = haystack.indexOf(needle, myControls.fileEditor.selectionEnd);
    if (index < 0) index = haystack.indexOf(needle);
    if (index < 0) {
      myStatus(`Could not find ${query}.`);
      return;
    }
    myControls.fileEditor.focus();
    myControls.fileEditor.setSelectionRange(index, index + query.length);
    return;
  }
  let needle;
  const compact = query.replace(/\s+/g, '');
  if (compact.length % 2 === 0 && /^[0-9a-f]+$/i.test(compact)) {
    needle = new Uint8Array(compact.length / 2);
    for (let index = 0; index < needle.length; index++) needle[index] = parseInt(compact.slice(index * 2, index * 2 + 2), 16);
  } else {
    needle = new TextEncoder().encode(query);
  }
  let index = findSubsequence(selectedFileBytes, needle, 0);
  if (index < 0) index = findSubsequence(selectedFileBytes, needle, 0);
  if (index < 0) {
    myStatus(`Could not find ${query}.`);
    return;
  }
  selectEditorLine(Math.floor(index / 16));
  myStatus(`Found ${query} at 0x${index.toString(16)}.`);
}

function goToEditorOffset() {
  if (!selectedFileBytes) return;
  const value = myControls.editorOffset.value.trim();
  if (!/^[0-9a-f]+$/i.test(value)) {
    myStatus('Enter a hexadecimal offset, for example 1b8.');
    return;
  }
  const offset = Math.min(parseInt(value, 16), Math.max(0, selectedFileBytes.length - 1));
  selectEditorLine(Math.floor(offset / 16));
  myStatus(`Moved to offset 0x${offset.toString(16)}.`);
}

function renderEditor() {
  if (!selectedWorkspaceFile || selectedFileBytes === null) {
    myControls.fileEditorPanel.hidden = true;
    return;
  }
  myControls.fileEditorPanel.hidden = false;
  myControls.editorFileName.textContent = selectedWorkspaceFile.path;
  myControls.fileEditor.value = myControls.editorMode.value === 'hex'
    ? bytesToHex(selectedFileBytes)
    : new TextDecoder().decode(selectedFileBytes);
  editorDirty = false;
  myControls.saveFileBtn.textContent = 'Save changes';
  myControls.editorHint.textContent = myControls.editorMode.value === 'hex'
    ? 'Offsets and hex bytes are on the left; UTF-8 text is on the right. Search or jump to an offset.'
    : 'Edit text directly. Switch to hex mode for byte-level editing.';
  updateEditorByteCount();
  updateMyFileActions();
}

async function openWorkspaceFile(file) {
  if (editorDirty && !await confirmSaveAction('Discard unsaved changes to this file?')) return;
  selectedWorkspaceFile = file;
  selectedFileBytes = null;
  myControls.fileEditorPanel.hidden = true;
  await readEditorFile(decryptedWorkspace, file.path);
  renderWorkspace();
}

// Function Read Editor
async function readEditorFile(root, path) {
  const result = await window.saveEditor.read({ root, path });
  selectedFileBytes = Uint8Array.from(atob(result.data), character => character.charCodeAt(0));
  if ([...selectedFileBytes.slice(0, 256)].includes(0)) myControls.editorMode.value = 'hex';
  renderEditor();
}

// Function Replace File
async function replaceWorkspaceFile(file) {
  const root = decryptedWorkspace;
  const current = workspaceDetails?.files.find(candidate => candidate.path === file.path);
  if (!root || !current || typeof window.saveEditor.replace !== 'function') return;
  const path = current.path;
  const replacingEditor = selectedWorkspaceFile?.path === path;
  if (replacingEditor && editorDirty
    && !await confirmSaveAction('Discard unsaved changes to this file and replace it?')) return;
  const result = await window.saveEditor.replace({ root, path });
  if (!result || root !== decryptedWorkspace) return;
  workspaceDetails = result;
  workspaceModified = true;
  let editorNotice = '';
  if (replacingEditor) {
    selectedWorkspaceFile = result.files.find(candidate => candidate.path === path) || null;
    selectedFileBytes = null;
    editorDirty = false;
    myControls.fileEditorPanel.hidden = true;
    if (selectedWorkspaceFile && selectedWorkspaceFile.size <= MAX_EDITOR_FILE_BYTES) {
      try {
        await readEditorFile(root, path);
      } catch (error) {
        editorNotice = ' Select the file again to retry opening it.';
        myLog(`Replaced ${path}, but could not open it in the editor: ${error.message}`);
      }
    } else if (selectedWorkspaceFile) {
      editorNotice = ' This file is larger than 8 MiB; export it to edit with another application.';
    }
  } else if (selectedWorkspaceFile) {
    selectedWorkspaceFile = result.files.find(candidate => candidate.path === selectedWorkspaceFile.path) || selectedWorkspaceFile;
  }
  renderWorkspace();
  myStatus(`${path} replaced in the decrypted workspace.${editorNotice}`);
  myLog(`Replaced ${path} in the decrypted workspace.`);
}

// Function Export File
async function exportWorkspaceFile(file) {
  if (!decryptedWorkspace || !workspaceDetails?.files.some(candidate => candidate.path === file.path)) return;
  const destination = await window.saveEditor.downloadFile({ root: decryptedWorkspace, path: file.path });
  if (destination) myStatus(`File exported to ${destination}`);
}

// Function Delete File
async function deleteWorkspaceFile(file) {
  const root = decryptedWorkspace;
  const current = workspaceDetails?.files.find(candidate => candidate.path === file.path);
  if (!root || !current || current.protected) return;
  if (!await confirmSaveAction(`Delete ${current.path} from the decrypted workspace?`)) return;
  const result = await window.saveEditor.delete({ root, path: current.path });
  if (!result || root !== decryptedWorkspace) return;
  workspaceDetails = result;
  workspaceModified = true;
  myLog(`Deleted ${current.path} from the decrypted workspace.`);
  if (selectedWorkspaceFile?.path === current.path) {
    selectedWorkspaceFile = null;
    selectedFileBytes = null;
    editorDirty = false;
    myControls.fileEditorPanel.hidden = true;
  }
  renderWorkspace();
}

async function closeMyWorkspace(confirmed = false) {
  if ((editorDirty || workspaceModified) && confirmed !== true
    && !await confirmSaveAction('Discard changes that have not been encrypted and close the decrypted files?')) return;
  const temporaryId = decryptedTemporaryId;
  decryptedTemporaryId = null;
  decryptedWorkspace = null;
  decryptedArchive = null;
  workspaceDetails = null;
  workspaceTree?.reset();
  accountWorkspace = null;
  selectedWorkspaceFile = null;
  selectedFileBytes = null;
  editorDirty = false;
  workspaceModified = false;
  myControls.workspacePanel.hidden = true;
  myControls.encryptPanel.hidden = true;
  savedAccounts?.setCurrentAccount('');
  goToLibraryStep(selectedLocalSave ? 1 : 0);
  myStatus('Decrypted files closed. Your original save is still selected.');
  void releaseSaveTemporary(temporaryId);
}

async function decryptInputs(inputs, { external = false } = {}) {
  if (!inputs.length) return false;
  if (decryptedWorkspace && !await confirmSaveAction(workspaceModified || editorDirty
    ? 'Discard changes that have not been encrypted and decrypt another save?'
    : 'Close the current decrypted files before decrypting another save?')) return false;
  myStatus('Decrypting your save…');
  const result = await window.saveEditor.run({
    operation: 'decrypt',
    inputs,
    platform: 'ps5',
    ...saveJobOptions(),
  });
  if (!result) return false;
  const previousTemporaryId = decryptedTemporaryId;
  decryptedTemporaryId = result.temporaryId || null;
  if (external) {
    selectedLocalSave = null;
    myControls.selectedSavePanel.hidden = true;
  }
  decryptedWorkspace = result.workspace;
  decryptedArchive = result.archivePath;
  workspaceDetails = result.info;
  selectedWorkspaceFile = null;
  selectedFileBytes = null;
  editorDirty = false;
  workspaceModified = false;
  renderWorkspace();
  myStatus('Your save is decrypted. Select a file to edit, or export the decrypted ZIP.');
  myLog('Decrypted files are ready to edit.');
  if (previousTemporaryId !== decryptedTemporaryId) await releaseSaveTemporary(previousTemporaryId);
  return true;
}

myControls.refreshMySavesBtn.addEventListener('click', () => runMyOperation(async () => {
  await loadLocalProfiles();
  myStatus(mySaves.length ? `Found ${mySaves.length} local save file(s).` : emptyLocalMessage());
}));

myControls.decryptExternalBtn.addEventListener('click', () => runMyOperation(async () => {
  const inputs = await window.saveEditor.chooseInput();
  await decryptInputs(inputs, { external: true });
}));

// Function Save ZIP Drop
{
  const zone = document.getElementById('decryptExternalDropZone');
  let dragDepth = 0;
  const available = () => !accountClosing && !mySaveOperation && !activeTransfer && !browseSessionActive;
  const fileDrag = event => {
    const transfer = event.dataTransfer;
    return Boolean(transfer && (Array.from(transfer.types || []).includes('Files')
      || transfer.files?.length || Array.from(transfer.items || []).some(item => item.kind === 'file')));
  };
  const clear = () => { dragDepth = 0; zone?.classList.remove('drag-active'); };
  const preview = event => {
    const files = Array.from(event.dataTransfer.files || []);
    if (files.length) return files.length === 1 && /\.zip$/i.test(files[0].name);
    const items = Array.from(event.dataTransfer.items || []).filter(item => item.kind === 'file');
    return items.length <= 1;
  };
  const highlight = event => {
    const ready = available();
    zone.classList.toggle('drag-active', ready && preview(event));
    event.dataTransfer.dropEffect = ready ? 'copy' : 'none';
  };
  zone?.addEventListener('dragenter', event => {
    if (!fileDrag(event)) return;
    event.preventDefault(); event.stopPropagation();
    dragDepth++;
    highlight(event);
  });
  zone?.addEventListener('dragover', event => {
    if (!fileDrag(event)) return;
    event.preventDefault(); event.stopPropagation();
    highlight(event);
  });
  zone?.addEventListener('dragleave', event => {
    if (!fileDrag(event) && !dragDepth) return;
    event.preventDefault(); event.stopPropagation();
    dragDepth = Math.max(0, dragDepth - 1);
    if (!dragDepth) clear();
  });
  zone?.addEventListener('drop', event => {
    clear();
    if (!fileDrag(event)) return;
    event.preventDefault(); event.stopPropagation();
    if (!available()) {
      myStatus('Finish the current transfer or save operation first.');
      return;
    }
    const files = Array.from(event.dataTransfer.files || []);
    if (files.length !== 1) {
      myStatus('Drop one encrypted save ZIP at a time.');
      return;
    }
    const file = files[0];
    if (!/\.zip$/i.test(file.name)) {
      myStatus('Drop an encrypted save ZIP (.zip).');
      return;
    }
    if (typeof file.path !== 'string' || !file.path.trim()) {
      myStatus('This ZIP has no local file path. Drop it from your file manager.');
      return;
    }
    void runMyOperation(() => decryptInputs([file.path], { external: true }));
  });
  document.addEventListener('dragover', event => {
    if (!fileDrag(event)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'none';
    clear();
  });
  document.addEventListener('drop', event => {
    if (!fileDrag(event)) return;
    event.preventDefault();
    clear();
  });
  document.addEventListener('dragend', clear);
  document.addEventListener('transfer-state-changed', () => { if (!available()) clear(); });
  window.addEventListener('blur', clear);
}

myControls.mySaveDecryptBtn.addEventListener('click', () => runMyOperation(async () => {
  if (!selectedLocalSave) return;
  const inputs = await window.saveEditor.localFile(localSaveOptions());
  await decryptInputs(inputs);
}));

async function uploadCurrentSave() {
  if (accountClosing || !selectedLocalSave) return;
  let selection;
  if (selectedLocalSave.entry.localSource === 'pc') {
    const prepared = await runMyOperation(() => window.saveTransfer.prepareLocalPcUpload({ entryId: selectedLocalSave.entry.id }));
    if (!prepared) return;
    selection = { external: prepared };
  } else {
    selection = { entryIds: [selectedLocalSave.entry.id], userId: selectedLocalSave.entry.owner };
  }
  if (accountClosing) {
    if (selection.external?.stageId) {
      try { await window.saveTransfer.releaseLocalPcUpload(selection.external.stageId); }
      catch (error) { myLog(`Could not remove upload staging: ${error.message}`); }
    }
    return;
  }
  document.querySelector('[data-page="upload"]').click();
  await startUpload(selection);
}

myControls.uploadSaveBtn.addEventListener('click', uploadCurrentSave);
myControls.uploadEncryptedBtn.addEventListener('click', uploadCurrentSave);

function closeExportMenu() {
  for (const [button, options] of [
    ['saveMoreBtn', 'saveMoreOptions'],
    ['workspaceMoreBtn', 'workspaceMoreOptions'],
    ['fileMoreBtn', 'fileMoreOptions'],
  ]) {
    myControls[options].hidden = true;
    myControls[button].setAttribute('aria-expanded', 'false');
  }
}

for (const [button, options] of [
  ['saveMoreBtn', 'saveMoreOptions'],
  ['workspaceMoreBtn', 'workspaceMoreOptions'],
  ['fileMoreBtn', 'fileMoreOptions'],
]) {
  myControls[button].addEventListener('click', (event) => {
    event.stopPropagation();
    const wasOpen = !myControls[options].hidden;
    closeExportMenu();
    myControls[options].hidden = wasOpen;
    myControls[button].setAttribute('aria-expanded', String(!wasOpen));
  });
}
document.addEventListener('click', (event) => {
  if (!event.target.closest('.dropdown')) closeExportMenu();
});

myControls.decryptExportBtn.addEventListener('click', () => runMyOperation(async () => {
  closeExportMenu();
  if (!selectedLocalSave) return;
  const inputs = await window.saveEditor.localFile(localSaveOptions());
  if (!await decryptInputs(inputs)) return;
  if (!decryptedArchive) return;
  const destination = await window.saveEditor.downloadArchive(decryptedArchive);
  if (destination) {
    await closeMyWorkspace();
    myStatus(`Decrypted save exported to ${destination}`);
  }
}));

myControls.mySaveExportBtn.addEventListener('click', () => runMyOperation(async () => {
  closeExportMenu();
  if (!selectedLocalSave) return;
  const result = await window.saveTransfer.exportLocalSave(localSaveOptions());
  if (result) myStatus(`Original save exported to ${result.destination}`);
}));

myControls.mySaveImportBtn.addEventListener('click', () => {
  if (selectedLocalSave) chooseImportReplacement(selectedLocalSave.entry, selectedLocalSave.file);
});

myControls.mySaveResignBtn.addEventListener('click', () => {
  if (!selectedLocalSave) return;
  myControls.resignPanel.hidden = !myControls.resignPanel.hidden;
});

myControls.confirmResignBtn.addEventListener('click', () => runMyOperation(async () => {
  if (!selectedLocalSave) return;
  await savedAccounts?.waitForChanges();
  if (savedAccounts?.isUsingCurrent()) {
    myStatus('Uncheck Use current ID and choose a target account before resigning.');
    return;
  }
  const accountId = savedAccounts?.getTargetId(myControls.resignAccountId.value.trim()) || myControls.resignAccountId.value.trim();
  if (!/^[0-9a-f]{16}$/i.test(accountId)) {
    myStatus('Enter a 16-digit hexadecimal account ID before resigning.');
    return;
  }
  const output = await window.saveEditor.chooseOutput(`${selectedLocalSave.file.file}-resigned.zip`);
  if (!output) return;
  const inputs = await window.saveEditor.localFile(localSaveOptions());
  myStatus('Resigning your save…');
  const result = await window.saveEditor.run({
    operation: 'resign', inputs, accountId, output, platform: 'ps5',
    ...saveJobOptions(),
  });
  if (result) {
    myControls.resignPanel.hidden = true;
    myStatus(`Resigned save exported to ${result.output}`);
    myLog(`Resigned copy: ${result.output}`);
  }
}));

myControls.exportDecryptedBtn.addEventListener('click', () => runMyOperation(async () => {
  if (!decryptedArchive) return;
  const destination = await window.saveEditor.downloadArchive(decryptedArchive);
  if (destination) myStatus(`Decrypted ZIP exported to ${destination}`);
}));

myControls.addFilesBtn.addEventListener('click', () => runMyOperation(async () => {
  if (!decryptedWorkspace) return;
  const result = await window.saveEditor.add(decryptedWorkspace);
  if (result) {
    workspaceDetails = result;
    workspaceModified = true;
    renderWorkspace();
    myStatus('Files added to the decrypted workspace.');
  }
}));

myControls.encryptSaveBtn.addEventListener('click', () => runMyOperation(encryptWorkspace));

async function encryptWorkspace() {
  if (!decryptedWorkspace) return null;
  await savedAccounts?.waitForChanges();
  const accountId = savedAccounts?.getTargetId(myControls.encryptAccountId.value.trim()) || myControls.encryptAccountId.value.trim();
  if (!/^[0-9a-f]{16}$/i.test(accountId)) {
    myStatus('Enter a 16-digit hexadecimal account ID before encrypting.');
    return null;
  }
  myStatus('Encrypting your edited save…');
  let result;
  if (selectedLocalSave) {
    if (!await confirmSaveAction(`Replace ${selectedLocalSave.file.file} with your edited save? A backup will be created first.`)) return null;
    const pc = selectedLocalSave.entry.localSource === 'pc';
    const selection = localSaveOptions();
    let backup = pc ? null : await window.saveEditor.backupLocal(selection);
    result = await window.saveEditor.encryptLocal({
      workspace: decryptedWorkspace, accountId, platform: 'ps5',
      ...saveJobOptions(),
    });
    if (!result) return null;
    try {
      const replacement = await window.saveTransfer.importLocalSave({
        ...selection,
        source: result.output,
      });
      if (pc) backup = replacement?.backup;
      await refreshMySaves();
      if (backup) myLog(`Backup: ${backup}`);
    } finally { await releaseSaveTemporary(result.temporaryId); }
  } else {
    const output = await window.saveEditor.chooseOutput(`${workspaceDetails.titleId || 'save'}-encrypted.zip`);
    if (!output) return null;
    result = await window.saveEditor.run({
      operation: 'encrypt', workspace: decryptedWorkspace, accountId, output, platform: 'ps5',
      ...saveJobOptions(),
    });
  }
  if (result) {
    workspaceModified = false;
    myControls.encryptPanel.hidden = true;
    myStatus(selectedLocalSave
      ? `${selectedLocalSave.file.file} was replaced with your edited save. A backup is available.`
      : `Encrypted save exported to ${result.output}`);
    myLog(selectedLocalSave ? `Encrypted save updated: ${selectedLocalSave.file.file}` : `Encrypted copy: ${result.output}`);
  }
  return result;
}

myControls.confirmEncryptBtn.addEventListener('click', () => runMyOperation(encryptWorkspace));

myControls.closeWorkspaceBtn.addEventListener('click', () => runMyOperation(() => closeMyWorkspace()));
myControls.editorMode.addEventListener('change', () => {
  if (!selectedFileBytes) return;
  const previousMode = myControls.editorMode.value === 'hex' ? 'text' : 'hex';
  try {
    if (editorDirty) {
      selectedFileBytes = editorBytes();
      editorDirty = false;
    }
    renderEditor();
  } catch (error) {
    myControls.editorMode.value = previousMode;
    myStatus(error.message);
  }
});
myControls.editorFindNext.addEventListener('click', findInEditor);
myControls.editorSearch.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') findInEditor();
});
myControls.editorGoOffset.addEventListener('click', goToEditorOffset);
myControls.editorOffset.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') goToEditorOffset();
});
myControls.editorRevert.addEventListener('click', () => runMyOperation(async () => {
  if (selectedWorkspaceFile) await openWorkspaceFile(selectedWorkspaceFile);
}));
myControls.fileEditor.addEventListener('input', () => {
  editorDirty = true;
  myControls.saveFileBtn.textContent = 'Save changes *';
  updateEditorByteCount();
});
async function saveCurrentEditorFile() {
  if (!selectedWorkspaceFile || selectedFileBytes === null) return false;
  const bytes = editorBytes();
  const binary = Array.from(bytes, (byte) => String.fromCharCode(byte)).join('');
  workspaceDetails = await window.saveEditor.write({
    root: decryptedWorkspace,
    path: selectedWorkspaceFile.path,
    data: btoa(binary),
  });
  selectedFileBytes = bytes;
  editorDirty = false;
  workspaceModified = true;
  myControls.saveFileBtn.textContent = 'Save changes';
  renderWorkspace();
  return true;
}

myControls.saveFileBtn.addEventListener('click', () => runMyOperation(async () => {
  if (await saveCurrentEditorFile()) myStatus(`${selectedWorkspaceFile.path} updated in the decrypted workspace.`);
}));
myControls.saveEncryptFileBtn.addEventListener('click', () => runMyOperation(async () => {
  if (await saveCurrentEditorFile()) await encryptWorkspace();
}));
myControls.downloadFileBtn.addEventListener('click', () => runMyOperation(async () => {
  if (!selectedWorkspaceFile) return;
  await exportWorkspaceFile(selectedWorkspaceFile);
}));
myControls.replaceFileBtn?.addEventListener('click', () => runMyOperation(async () => {
  if (selectedWorkspaceFile) await replaceWorkspaceFile(selectedWorkspaceFile);
}));
myControls.deleteFileBtn.addEventListener('click', () => runMyOperation(async () => {
  if (selectedWorkspaceFile) await deleteWorkspaceFile(selectedWorkspaceFile);
}));

for (const tab of document.querySelectorAll('.nav-item')) {
  tab.addEventListener('click', () => {
    myControls.mySavesTab.hidden = tab.dataset.page !== 'library';
    if (tab.dataset.page === 'library') {
      goToLibraryStep(decryptedWorkspace ? 2 : selectedLocalSave ? 1 : 0);
      runMyOperation(async () => {
        await loadLocalProfiles();
        myStatus(mySaves.length ? 'Select a save to get started.' : emptyLocalMessage());
      });
    }
  });
}

document.addEventListener('local-save-replaced', async () => {
  await refreshMySaves();
  myStatus(localPcMode ? 'PC save replaced. A backup is available.' : 'Save replaced and its upload metadata refreshed.');
});

window.saveEditor.onEvent((event) => {
  if (event.type === 'status') myStatus(event.message);
  if (event.type === 'log') myLog(event.message);
  if (event.type === 'error') myStatus(event.message);
});

// Refresh alternate layout.
document.addEventListener('cmp-layout-changed', renderMySaves);
