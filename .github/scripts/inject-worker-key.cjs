const fs = require('node:fs');

const key = process.env.GARLIC_WORKER_KEY || '';
if (!/^[0-9a-f]{64}$/.test(key)) {
  throw new Error('GARLIC_WORKER_KEY must be configured as a 64-character hexadecimal secret');
}

const configPath = 'electron/config.cjs';
const source = fs.readFileSync(configPath, 'utf8');
const marker = "workerKey: '',";
if (!source.includes(marker)) {
  throw new Error('Build-time worker key placeholder is missing');
}

fs.writeFileSync(configPath, source.replace(marker, `workerKey: '${key}',`));
console.log('Injected the shared worker key into the build configuration.');
