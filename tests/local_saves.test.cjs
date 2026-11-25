const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'electron', 'index.html'), 'utf8');
const renderer = fs.readFileSync(path.join(root, 'electron', 'renderer.js'), 'utf8');
const main = fs.readFileSync(path.join(root, 'electron', 'main.cjs'), 'utf8');
const preload = fs.readFileSync(path.join(root, 'electron', 'preload.cjs'), 'utf8');

test('local save browser exposes export and confirmed import', () => {
  assert.match(html, /id="browseLocalBtn"[^>]*>Browse local saves/);
  assert.match(html, /id="localEntries"/);
  assert.match(html, /This will replace an existing save\. Make sure you have backed it up\. Are you sure you want to do this\?/);
  assert.match(renderer, /refreshLocalSaves/);
  assert.match(renderer, /exportLocalSave/);
  assert.match(renderer, /importLocalSave/);
  assert.match(renderer, /confirmImportBtn\.addEventListener\('click'/);
  assert.match(renderer, /Discover your console first\./);
});

test('local save IPC uses the backend inventory, export, and import operations', () => {
  assert.match(main, /local:inventory/);
  assert.match(main, /local:export/);
  assert.match(main, /local:import/);
  assert.match(main, /poc\.dt_local_saves/);
  assert.match(main, /name: titleName\(entry\.title\)/);
  assert.match(renderer, /entry\.name \|\|/);
  assert.match(preload, /localSaves:/);
  assert.match(preload, /exportLocalSave:/);
  assert.match(preload, /importLocalSave:/);
  assert.match(main, /filters: \[\{ name: i18n\.t\('All files'\), extensions: \['\*'\] \}, \{ name: i18n\.t\('PS5 save containers'\)/);
});

test('external save upload is not exposed', () => {
  assert.doesNotMatch(html, /id="uploadExternalBtn"/);
  assert.doesNotMatch(html, /External save \(not in the console library\)/);
  assert.doesNotMatch(renderer, /controls\.uploadExternalBtn/);
});

test('local save rows expose the full context menu by mouse and keyboard', () => {
  const saves = fs.readFileSync(path.join(root, 'electron', 'my_saves.js'), 'utf8');
  const styles = fs.readFileSync(path.join(root, 'electron', 'style.css'), 'utf8');
  assert.match(saves, /attachSaveContextMenu\(row, localSaveActions\(save\)/);
  assert.match(saves, /attachSaveContextMenu\(row, \[\{ label: 'View saves'/);
  for (const action of ['Select save', 'Decrypt & edit', 'Upload to PS5', 'Decrypt and export', 'Export original', 'Import replacement…', 'Resign']) {
    assert.ok(saves.includes(`action('${action}'`), `missing context action: ${action}`);
  }
  assert.match(saves, /event\.key === 'ContextMenu'/);
  assert.match(saves, /event\.shiftKey && event\.key === 'F10'/);
  assert.match(styles, /\.save-context-menu/);
});
