const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'electron', 'index.html'), 'utf8');
const saves = fs.readFileSync(path.join(root, 'electron', 'my_saves.js'), 'utf8');
const zh = fs.readFileSync(path.join(root, 'electron', 'locales', 'zh-CN.js'), 'utf8');
const { matches } = require('../electron/download_search.js');

test('local library has a search box beside the title list', () => {
  assert.match(html, /<label class="save-search"><span>Search saves<\/span>\s*<span id="mySavesSearchCount"[^>]*aria-live="polite"[^>]*><\/span>\s*<input id="mySavesSearch" type="search"/);
  // The box sits above the CMP tree so both layouts get it.
  assert.ok(html.indexOf('id="mySavesSearch"') < html.indexOf('id="cmpLibraryTree"'));
  assert.ok(html.indexOf('id="mySavesSearch"') < html.indexOf('id="myTitleEntries"'));
});

test('local library search filters both layouts with the download matcher', () => {
  assert.match(saves, /'mySavesSearch', 'mySavesSearchCount'/);
  assert.match(saves, /function searchedMySaves\(\)/);
  assert.match(saves, /window\.DownloadSearch\.matches\(\s*\{ \.\.\.save\.entry, files: \[save\.file\] \}, query, cmpLocalUsers/);
  assert.match(saves, /const searched = searchedMySaves\(\);/);
  assert.match(saves, /libraryTree\.render\(\{ saves: searched,/);
  // The tree shows a search-specific message instead of "no downloaded saves".
  assert.match(saves, /emptyText: query && mySaves\.length \? uiText`No saves match “\$\{query\}”\.` : undefined/);
  const bridge = fs.readFileSync(path.join(root, 'electron', 'tree_bridge.js'), 'utf8');
  const skin = fs.readFileSync(path.join(root, 'electron', 'cmp_skin.js'), 'utf8');
  assert.match(bridge, /function render\(\{ saves, users, filter, busy, selected, emptyText \}\)/);
  assert.match(bridge, /layout\.setLibrary\(\{ entries, users, filter, busy, emptyText,/);
  assert.match(skin, /emptyText: libraryData\.emptyText \|\| uiText\('No downloaded saves for this user/);
  assert.match(saves, /const groups = query \? myTitleGroups\(searchedMySaves\(\)\) : allGroups/);
  // An open title is resolved against the full library, so typing narrows it instead of closing it.
  assert.match(saves, /const selectedGroup = selectedTitle \? allGroups\.get\(selectedTitle\) : null/);
  assert.match(saves, /mySavesSearch\.addEventListener\('input', \(\) => renderMySaves\(\)\)/);
  assert.match(saves, /event\.key === 'Escape' && myControls\.mySavesSearch\.value/);
});

test('local library search messages are translated', () => {
  for (const key of [
    '· {0} of {1} saves in {2} titles',
    'No saves match “{0}”.', 'No saves in this title match “{0}”.',
  ]) {
    assert.ok(zh.includes(JSON.stringify(key)), `missing zh-CN translation: ${key}`);
  }
});

test('each local save matches on its own file, its title and its owner', () => {
  const entry = {
    id: 137, title: 'PPSA17597', name: 'Example Game', owner: '128f49b5',
    files: [{ file: 'sdimg_SAVEDATA00' }, { file: 'sdimg_SAVEDATA01' }],
  };
  const save = (file) => ({ ...entry, files: [{ file }] });
  const users = [{ id: '128f49b5', name: 'Player One' }];
  // Title name, title ID, entry ID and user name all find every save in the entry.
  for (const query of ['example', 'ppsa17597', '137', 'player one']) {
    assert.ok(matches(save('sdimg_SAVEDATA00'), query, users), query);
    assert.ok(matches(save('sdimg_SAVEDATA01'), query, users), query);
  }
  // A filename only finds that file, not its siblings in the same entry.
  assert.ok(matches(save('sdimg_SAVEDATA01'), 'savedata01', users));
  assert.ok(!matches(save('sdimg_SAVEDATA00'), 'savedata01', users));
  // Every word must match somewhere; case is ignored.
  assert.ok(matches(save('sdimg_SAVEDATA00'), 'EXAMPLE savedata00', users));
  assert.ok(!matches(save('sdimg_SAVEDATA00'), 'example savedata01', users));
});
