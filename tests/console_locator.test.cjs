const test = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
const { normalizeFirmware, formatFirmware, firmwareEligible, canonicalIPv4, create } = require('../electron/console_locator.js');

// Function Locator Fixture
function fixture(t, isBusy = () => false) {
  const dom = new JSDOM('<table><tbody id="consoleLocatorRows"></tbody></table>');
  t.after(() => dom.window.close());
  const document = dom.window.document, tbody = document.getElementById('consoleLocatorRows'), calls = [];
  const locator = create(document, tbody, { onSelect: (role, console) => calls.push([role, console]), isBusy });
  const pick = (role, host) => tbody.querySelector(`input[data-role="${role}"][value="${host}"]`);
  const choose = (role, host) => { const input = pick(role, host); input.checked = true; input.dispatchEvent(new dom.window.Event('change', { bubbles: true })); };
  return { dom, document, tbody, locator, calls, pick, choose };
}
const ps5 = (host, firmware = '13600000', name = 'PS5') => ({ host, firmware, name, type: 'PS5', hostId: `id-${host}` });

test('firmware values normalize into integer tuples and format canonically', () => {
  for (const value of ['13.60', ' 13.60 ', '13600000', '13600007', 13600000, [13, 60]]) {
    assert.deepEqual(normalizeFirmware(value), [13, 60]);
    assert.equal(formatFirmware(value), '13.60');
  }
  assert.deepEqual(normalizeFirmware('0013.60'), [13, 60]);
  assert.equal(formatFirmware('01050000'), '1.05');
  assert.equal(formatFirmware('100.01'), '100.01');
  assert.equal(formatFirmware(1000000), '1.00');
});

test('unknown, ambiguous and unsafe firmware values fail closed', () => {
  for (const value of [undefined, null, '', 'unknown', '0.00', '00000000', 0, '13.6', 13.6, '13.600', '13.60.01', '-1.00', '13.100', '13600000x', '0x13600000', [13, 100], ['13', 60], [13], [0, 60], '9007199254740992.00']) {
    assert.equal(normalizeFirmware(value), null, String(value));
    assert.equal(formatFirmware(value), 'Unknown', String(value));
    assert.equal(firmwareEligible(value), false, String(value));
  }
});

test('the inclusive firmware ceiling compares integer version components', () => {
  assert.equal(firmwareEligible('13.60'), true);
  assert.equal(firmwareEligible('13600007'), true);
  assert.equal(firmwareEligible('13.59'), true);
  assert.equal(firmwareEligible('13.61'), false);
  assert.equal(firmwareEligible('14.00'), false);
  assert.equal(firmwareEligible('14.22', '14.22'), true);
  assert.equal(firmwareEligible('14.23', '14.22'), false);
  assert.equal(firmwareEligible('9.99', '10.00'), true);
  assert.equal(firmwareEligible('13.99', '14.01'), true);
  assert.equal(firmwareEligible('14.01', '13.99'), false);
  assert.equal(firmwareEligible('13.60', 'invalid'), false);
});

test('IPv4 parsing canonicalizes decimal octets and rejects invalid addresses', () => {
  assert.equal(canonicalIPv4(' 192.168.000.042 '), '192.168.0.42');
  assert.equal(canonicalIPv4('127.0.0.1'), '127.0.0.1');
  assert.equal(canonicalIPv4('255.255.255.255'), '255.255.255.255');
  for (const value of [null, 1234, '', '256.0.0.1', '1.2.3', '1.2.3.4.5', '1.2.3.-4', '192.168. 0.42', 'localhost', '::1', '1.2.3.4<script>', '0000.1.2.3']) {
    assert.equal(canonicalIPv4(value), '', String(value));
  }
});

test('discovery rows are safe, deduplicated and ordered by numeric IPv4', t => {
  const f = fixture(t);
  f.locator.render([ps5('192.168.0.10', '14.22'), ps5('192.168.000.002', '13.60', '<img src=x>'), ps5('192.168.0.2', '13.60', 'Duplicate'), ps5('bad-host')]);
  assert.deepEqual([...f.tbody.querySelectorAll('tr[data-host]')].map(row => row.dataset.host), ['192.168.0.2', '192.168.0.10']);
  assert.equal(f.tbody.querySelector('tr').cells.length, 8);
  assert.equal(f.tbody.querySelector('td').textContent, '<img src=x>');
  assert.equal(f.tbody.querySelector('img'), null);
  assert.equal(f.tbody.querySelectorAll('input').length, 4);
  assert.equal(f.tbody.querySelectorAll('input:checked').length, 0);
  assert.deepEqual(f.calls, []);
});

test('only discovered PS5s receive roles and only known eligible firmware receives JB', t => {
  const f = fixture(t);
  f.locator.render([ps5('192.168.0.1', '13.60'), ps5('192.168.0.2', '14.22'), ps5('192.168.0.3', 'unknown'), { ...ps5('192.168.0.4', '12.00'), type: 'PS4' }, { ...ps5('192.168.0.5'), type: '' }]);
  assert.equal(f.pick('jb', '192.168.0.1').disabled, false);
  assert.equal(f.pick('jb', '192.168.0.2').disabled, true);
  assert.equal(f.pick('jb', '192.168.0.3').disabled, true);
  for (const host of ['192.168.0.1', '192.168.0.2', '192.168.0.3']) assert.equal(f.pick('ofw', host).disabled, false);
  for (const host of ['192.168.0.4', '192.168.0.5']) {
    assert.equal(f.pick('jb', host).disabled, true);
    assert.equal(f.pick('ofw', host).disabled, true);
  }
  assert.match(f.pick('jb', '192.168.0.2').title, /13\.60 or below/);
  assert.match(f.pick('jb', '192.168.0.3').title, /known PS5 firmware/);
  assert.match(f.pick('jb', '192.168.0.4').title, /PS4/);
});

test('radio groups and accessible labels identify independent JB and OFW choices', t => {
  const f = fixture(t), first = ps5('192.168.0.1', '13.60', 'Living room'), second = ps5('192.168.0.2');
  f.locator.render([first, second]);
  const jb = f.pick('jb', first.host), ofw = f.pick('ofw', second.host);
  assert.notEqual(jb.name, ofw.name);
  assert.match(jb.getAttribute('aria-label'), /Living room.*192\.168\.0\.1.*JB helper/);
  assert.match(ofw.getAttribute('aria-label'), /OFW target/);
  f.choose('jb', first.host);
  assert.equal(jb.checked, true); assert.equal(ofw.checked, false);
  f.choose('ofw', second.host);
  assert.equal(jb.checked, true); assert.equal(ofw.checked, true);
  assert.equal(f.calls.length, 2);
  assert.equal(f.calls[0][0], 'jb'); assert.equal(f.calls[0][1].hostId, first.hostId.toUpperCase());
  assert.equal(f.calls[1][0], 'ofw'); assert.equal(f.calls[1][1].host, second.host);
});

test('explicit roles render without callbacks and persist by IP across rescans', t => {
  const f = fixture(t), first = ps5('192.168.0.1'), second = ps5('192.168.0.2');
  f.locator.render([first, second], { jbHost: first.host, targetHost: second.host });
  const row = f.pick('jb', first.host).closest('tr'), input = f.pick('ofw', second.host);
  input.focus(); f.locator.render([second, first]);
  assert.equal(f.pick('jb', first.host).checked, true);
  assert.equal(f.pick('ofw', second.host).checked, true);
  assert.equal(f.pick('jb', first.host).closest('tr'), row);
  assert.equal(f.pick('ofw', second.host), input);
  assert.equal(f.document.activeElement, input);
  assert.deepEqual(f.calls, []);
  f.locator.render([first]);
  assert.equal(f.tbody.querySelectorAll('input[data-role="ofw"]:checked').length, 0);
  assert.equal(f.pick('ofw', first.host).checked, false);
  f.locator.render([second, first]);
  assert.equal(f.pick('ofw', second.host).checked, true);
  assert.deepEqual(f.calls, []);
});

test('new selections are remembered on rescans without selecting another role', t => {
  const f = fixture(t), first = ps5('192.168.0.1'), second = ps5('192.168.0.2');
  f.locator.render([first, second]); f.choose('ofw', second.host);
  f.locator.render([first, second]);
  assert.equal(f.pick('ofw', second.host).checked, true);
  assert.equal(f.tbody.querySelectorAll('input[data-role="jb"]:checked').length, 0);
  assert.equal(f.calls.length, 1);
});

test('changing the ceiling updates JB eligibility while OFW remains independent', t => {
  const f = fixture(t), console = ps5('192.168.0.42', '14.22');
  f.locator.render([console], { jbHost: console.host, targetHost: console.host });
  assert.equal(f.pick('jb', console.host).checked, false);
  assert.equal(f.pick('jb', console.host).disabled, true);
  assert.equal(f.pick('ofw', console.host).checked, true);
  f.locator.render([console], { firmwareLimit: '14.22' });
  assert.equal(f.pick('jb', console.host).disabled, false);
  f.locator.render([console], { firmwareLimit: '14.21' });
  assert.equal(f.pick('jb', console.host).disabled, true);
  assert.equal(f.pick('ofw', console.host).disabled, false);
  f.locator.render([console], { firmwareLimit: '14.2' });
  assert.equal(f.pick('jb', console.host).disabled, true);
  assert.equal(f.pick('ofw', console.host).disabled, false);
  assert.deepEqual(f.calls, []);
});

test('busy states block real and synthetic changes without changing selected roles', t => {
  let externalBusy = false;
  const f = fixture(t, () => externalBusy), first = ps5('192.168.0.1'), second = ps5('192.168.0.2');
  f.locator.render([first, second], { targetHost: first.host });
  f.locator.setBusy(true);
  assert.equal(f.pick('jb', first.host).disabled, true);
  assert.equal(f.pick('ofw', first.host).disabled, true);
  f.choose('ofw', second.host);
  assert.equal(f.pick('ofw', first.host).checked, true);
  assert.equal(f.pick('ofw', second.host).checked, false);
  f.locator.setBusy(false); externalBusy = true;
  f.choose('jb', first.host); f.choose('ofw', second.host);
  assert.equal(f.pick('jb', first.host).checked, false);
  assert.equal(f.pick('ofw', first.host).checked, true);
  assert.deepEqual(f.calls, []);
});

test('disabled unknown or unsupported roles cannot be forced through synthetic changes', t => {
  const f = fixture(t), console = ps5('192.168.0.1', 'unknown');
  f.locator.render([console]); f.choose('jb', console.host);
  assert.equal(f.pick('jb', console.host).checked, false);
  assert.deepEqual(f.calls, []);
  f.locator.render([{ ...console, type: 'PS4' }]); f.choose('ofw', console.host);
  assert.equal(f.pick('ofw', console.host).checked, false);
  assert.deepEqual(f.calls, []);
});

test('reset renders the empty state and clears remembered role choices', t => {
  const f = fixture(t), console = ps5('192.168.0.1');
  f.locator.render([console], { jbHost: console.host, targetHost: console.host }); f.locator.reset();
  assert.equal(f.tbody.querySelector('td').colSpan, 8);
  assert.match(f.tbody.textContent, /No PlayStations found/);
  assert.equal(f.tbody.querySelector('input'), null);
  f.locator.render([console]);
  assert.equal(f.tbody.querySelectorAll('input:checked').length, 0);
  assert.deepEqual(f.calls, []);
});

test('pairing statuses use safe labels and refresh without replacing focused role controls', t => {
  const f = fixture(t);
  const statuses = [
    ['checking', 'Checking…'], ['paired', 'Paired'], ['previous', 'Pair again'],
    ['unpaired', 'Not paired'], ['unknown', 'Unknown'], [undefined, 'Unknown'],
    ['<img src=x>', 'Unknown'], ['constructor', 'Unknown'], [null, 'Unknown'],
  ];
  const consoles = statuses.map(([pairing], index) => ({ ...ps5(`192.168.0.${index + 1}`), pairing }));
  f.locator.render(consoles, { jbHost: consoles[0].host, targetHost: consoles[1].host });
  for (const [index, [status, label]] of statuses.entries()) {
    const row = f.pick('jb', consoles[index].host).closest('tr'), cell = row.cells[5];
    assert.equal(row.cells.length, 8);
    assert.equal(cell.textContent, label);
    assert.equal(cell.className, `console-locator-pairing ${['checking', 'paired', 'previous', 'unpaired', 'unknown'].includes(status) ? status : 'unknown'}`);
    assert.equal(cell.dataset.pairing, ['checking', 'paired', 'previous', 'unpaired', 'unknown'].includes(status) ? status : 'unknown');
  }
  assert.equal(f.tbody.querySelector('img'), null);
  const input = f.pick('ofw', consoles[1].host), row = input.closest('tr');
  input.focus();
  f.locator.render(consoles.map(console => console.host === consoles[1].host ? { ...console, pairing: 'previous' } : console));
  assert.equal(f.pick('ofw', consoles[1].host), input);
  assert.equal(input.closest('tr'), row);
  assert.equal(f.document.activeElement, input);
  assert.equal(row.cells[5].textContent, 'Pair again');
  assert.equal(row.cells[5].className, 'console-locator-pairing previous');
  assert.equal(input.checked, true);
  assert.equal(f.pick('jb', consoles[0].host).checked, true);
  assert.deepEqual(f.calls, []);
});

test('Type and full Console ID render safely with canonical identity casing', t => {
  const f = fixture(t), host = '192.168.0.42';
  const rawId = '  <img src=x>0123456789ABCDEF0123456789ABCDEF  ';
  const console = { ...ps5(host), type: ' PS5 ', hostId: rawId };
  f.locator.render([console]);
  const input = f.pick('ofw', host), row = input.closest('tr');
  assert.equal(row.cells[1].className, 'console-locator-type');
  assert.equal(row.cells[1].textContent, 'PS5');
  assert.equal(row.cells[2].textContent, host);
  assert.equal(row.cells[4].className, 'console-locator-id');
  assert.equal(row.cells[4].textContent, rawId.trim().toUpperCase());
  assert.equal(row.cells[4].title, rawId.trim().toUpperCase());
  assert.equal(row.querySelector('img'), null);
  f.choose('ofw', host);
  assert.equal(f.calls[0][1].hostId, rawId.trim().toUpperCase());
  assert.equal(f.calls[0][1].firmware, console.firmware);
  input.focus();
  f.locator.render([{ ...console, type: 'ps5', hostId: ' AABBCCDDEEFF00112233445566778899 ' }]);
  assert.equal(f.pick('ofw', host), input);
  assert.equal(f.document.activeElement, input);
  assert.equal(row.cells[1].textContent, 'PS5');
  assert.equal(row.cells[4].textContent, 'AABBCCDDEEFF00112233445566778899');
  assert.equal(row.cells[4].title, 'AABBCCDDEEFF00112233445566778899');
  f.locator.render([{ ...console, type: '<b>PS4</b>', hostId: '<script>identity</script>' }]);
  assert.equal(row.cells[1].textContent, '<B>PS4</B>');
  assert.equal(row.cells[4].textContent, '<SCRIPT>IDENTITY</SCRIPT>');
  assert.equal(row.querySelector('b, script'), null);
  f.locator.render([{ host, type: ' ', firmware: '13.60', hostId: 123 }]);
  assert.equal(row.cells[1].textContent, 'Unknown');
  assert.equal(row.cells[4].textContent, 'Unknown');
  assert.equal(f.pick('jb', host).disabled, true);
  assert.equal(f.pick('ofw', host).disabled, true);
  assert.equal(f.calls.length, 1);
});

test('pairing-only updates change one status cell without touching rows, roles or focus', async t => {
  const f = fixture(t), first = ps5('192.168.0.1'), second = ps5('192.168.0.2');
  f.locator.render([{ ...first, pairing: 'checking' }, { ...second, pairing: 'unpaired' }], { jbHost: first.host, targetHost: second.host });
  const input = f.pick('ofw', second.host), row = input.closest('tr'), cell = row.cells[5];
  const rowOrder = [...f.tbody.children], cells = [...row.children], mutations = [];
  input.focus();
  const observer = new f.dom.window.MutationObserver(records => mutations.push(...records));
  observer.observe(f.tbody, { subtree: true, attributes: true, childList: true, characterData: true });
  assert.equal(f.locator.updatePairing(' 192.168.000.002 ', 'paired'), true);
  await new Promise(resolve => setImmediate(resolve));
  assert.ok(mutations.length > 0);
  assert.equal(mutations.every(mutation => mutation.target === cell || cell.contains(mutation.target)), true);
  assert.deepEqual([...f.tbody.children], rowOrder); assert.deepEqual([...row.children], cells);
  assert.equal(f.document.activeElement, input); assert.equal(input.checked, true);
  assert.equal(f.pick('jb', first.host).checked, true);
  assert.equal(cell.textContent, 'Paired'); assert.equal(cell.dataset.pairing, 'paired');
  assert.equal(f.pick('jb', first.host).closest('tr').cells[5].textContent, 'Checking…');
  assert.deepEqual(f.calls, []);
  mutations.length = 0;
  assert.equal(f.locator.updatePairing(second.host, 'paired'), true);
  assert.equal(f.locator.updatePairing('192.168.0.99', 'paired'), false);
  assert.equal(f.locator.updatePairing('invalid', 'paired'), false);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(mutations.length, 0);
  f.choose('ofw', second.host);
  assert.equal(f.calls[0][1].pairing, 'paired');
  assert.equal(f.calls[0][1].firmware, second.firmware);
  assert.equal(f.locator.updatePairing(second.host, '<img src=x>'), true);
  assert.equal(cell.textContent, 'Unknown'); assert.equal(cell.dataset.pairing, 'unknown');
  assert.equal(cell.querySelector('img'), null);
  observer.disconnect();
});
