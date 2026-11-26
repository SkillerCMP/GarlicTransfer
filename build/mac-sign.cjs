// electron-builder "mac.sign" hook.
//
// Signs with the identity electron-builder found, or ad hoc ("-") when no Developer ID
// certificate is available, as in CI (CSC_IDENTITY_AUTO_DISCOVERY=false). Without a
// signature of our own, the app keeps the linker signature of Electron's prebuilt
// binary, whose code-signing identifier is "Electron" rather than this app's bundle ID.
// macOS Local Network privacy then does not apply the GarlicTransfer permission, and
// connections from the app and its Python backends to the PS5 fail with "No route to
// host" (EHOSTUNREACH), even when GarlicTransfer is allowed under Local Network.
const path = require('node:path');

// Use the same @electron/osx-sign that electron-builder itself would call.
const appBuilderLib = path.dirname(require.resolve('app-builder-lib/package.json'));
const { signAsync } = require(require.resolve('@electron/osx-sign', { paths: [appBuilderLib] }));

module.exports = async function signMacApp(options) {
  await signAsync({ ...options, identity: options.identity || '-' });
};
