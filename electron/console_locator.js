(function expose(root, build) {
  const api = build(root.ConsoleInfo || (typeof require === 'function' ? require('./console_info.js') : null));
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ConsoleLocator = api;
})(typeof window === 'object' ? window : globalThis, function build(info) {
  const { DEFAULT_JB_FIRMWARE, normalizeFirmware, formatFirmware, firmwareEligible, canonicalIPv4, normalizeFirmwareLimit, normalizeConsoles } = info;

  // Function Console Locator
  function create(document, tbody, { onSelect = () => {}, isBusy = () => false } = {}) {
    const uiText = document.defaultView.GarlicI18n?.t || ((source, ...values) =>
      typeof source === 'string' ? source : String.raw({ raw: source }, ...values));
    const rows = new Map();
    let consoles = new Map(), busy = false, firmwareLimit = DEFAULT_JB_FIRMWARE;
    let selected = { jb: '', ofw: '' };
    const blocked = () => busy || isBusy();
    const ps5 = console => console.type === 'PS5';
    const allowed = (role, console) => ps5(console) && (role === 'ofw' || firmwareEligible(console.firmware, firmwareLimit));
    const ipNumber = host => host.split('.').reduce((number, octet) => number * 256 + Number(octet), 0);
    const pairingLabels = new Map([['checking', 'Checking…'], ['paired', 'Paired'], ['previous', 'Pair again'], ['unpaired', 'Not paired'], ['unknown', 'Unknown']]);

    // Function Pairing Label
    function paintPairing(item, value) {
      const status = pairingLabels.has(value) ? value : 'unknown';
      if (item.pairing.dataset.pairing !== status) {
        item.pairing.className = `console-locator-pairing ${status}`;
        item.pairing.dataset.pairing = status;
        item.pairing.textContent = uiText(pairingLabels.get(status));
      }
      return status;
    }

    // Function Console Selection
    function update() {
      for (const [host, item] of rows) {
        const console = consoles.get(host);
        for (const role of ['jb', 'ofw']) {
          const input = item[role];
          const eligible = allowed(role, console);
          input.disabled = blocked() || !eligible;
          input.checked = selected[role] === host && eligible;
          const label = role === 'jb' ? uiText('JB helper') : uiText('OFW target');
          input.setAttribute('aria-label', uiText`Use ${console.name} (${host}) as ${label}`);
          input.title = !ps5(console) ? uiText`Select a discovered PS5; this device is ${console.type || uiText('Unknown')}.`
            : role === 'jb' && !normalizeFirmware(console.firmware) ? uiText('JB selection requires known PS5 firmware.')
            : role === 'jb' && !eligible ? uiText`JB selection requires firmware ${formatFirmware(firmwareLimit)} or below.`
            : uiText`Use this PS5 as the ${label}.`;
          item.row.classList.toggle(`${role}-selected`, input.checked);
        }
      }
    }

    // Function Console Row
    function makeRow(host) {
      const row = document.createElement('tr'); row.dataset.host = host; row.className = 'console-locator-row';
      const name = document.createElement('td'), address = document.createElement('td'), firmware = document.createElement('td'), pairing = document.createElement('td');
      address.textContent = host; address.className = 'console-locator-address';
      const type = document.createElement('td'), id = document.createElement('td');
      type.className = 'console-locator-type'; id.className = 'console-locator-id';
      row.append(name, type, address, firmware, id, pairing);
      const item = { row, name, type, firmware, id, pairing };
      for (const role of ['jb', 'ofw']) {
        const cell = document.createElement('td'), input = document.createElement('input');
        input.type = 'radio'; input.name = `console-locator-${role}`; input.value = host;
        input.dataset.role = role; input.dataset.host = host;
        cell.className = 'console-locator-pick'; cell.appendChild(input); row.appendChild(cell); item[role] = input;
      }
      return item;
    }

    // Function Console Rendering
    function render(values = [], options = {}) {
      if (Object.hasOwn(options, 'jbHost')) selected.jb = canonicalIPv4(options.jbHost);
      if (Object.hasOwn(options, 'targetHost')) selected.ofw = canonicalIPv4(options.targetHost);
      if (Object.hasOwn(options, 'firmwareLimit')) firmwareLimit = normalizeFirmwareLimit(options.firmwareLimit);
      const found = new Map(normalizeConsoles(values).map(console => [console.host, console]));
      const ordered = [...found.values()].sort((a, b) => ipNumber(a.host) - ipNumber(b.host)
        || a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
      consoles = found;
      const active = tbody.contains(document.activeElement) ? document.activeElement : null;
      for (const [host, item] of rows) if (!found.has(host)) { item.row.remove(); rows.delete(host); }
      tbody.querySelector('.console-locator-empty')?.remove();
      for (const [index, console] of ordered.entries()) {
        let item = rows.get(console.host);
        if (!item) { item = makeRow(console.host); rows.set(console.host, item); }
        item.name.textContent = console.name; item.name.title = console.type || uiText('Unknown console type');
        item.type.textContent = console.type || uiText('Unknown');
        item.id.textContent = console.hostId || uiText('Unknown'); item.id.title = console.hostId || uiText('Unknown');
        item.firmware.textContent = formatFirmware(console.firmware);
        item.firmware.title = typeof console.firmware === 'string' || typeof console.firmware === 'number' ? String(console.firmware) : '';
        paintPairing(item, console.pairing);
        if (tbody.children[index] !== item.row) tbody.insertBefore(item.row, tbody.children[index] || null);
      }
      if (!ordered.length) {
        const row = document.createElement('tr'), cell = document.createElement('td');
        row.className = 'console-locator-empty'; cell.colSpan = 8; cell.className = 'empty';
        cell.textContent = uiText('No PlayStations found. Find PlayStations or connect by IPv4.');
        row.appendChild(cell); tbody.appendChild(row);
      }
      update();
      if (active?.isConnected && !active.disabled && document.activeElement !== active) active.focus({ preventScroll: true });
    }

    // Function Console Choice
    tbody.addEventListener('change', event => {
      const input = event.target.closest('input[type="radio"][data-role]');
      if (!input || !tbody.contains(input) || !input.checked) return;
      const role = input.dataset.role, host = canonicalIPv4(input.dataset.host), console = consoles.get(host);
      if (!['jb', 'ofw'].includes(role) || !console || blocked() || !allowed(role, console)) { update(); return; }
      selected = { ...selected, [role]: host }; update(); onSelect(role, console);
    });
    return {
      render,
      // Function Pairing Update
      updatePairing(host, value) {
        const address = canonicalIPv4(host), item = rows.get(address), console = consoles.get(address);
        if (!item || !console) return false;
        const pairing = paintPairing(item, value);
        consoles.set(address, { ...console, pairing });
        return true;
      },
      setBusy(value) { busy = Boolean(value); update(); },
      reset() { render([], { jbHost: '', targetHost: '' }); },
    };
  }
  return { ...info, create };
});
