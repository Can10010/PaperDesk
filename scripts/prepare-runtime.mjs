import { copyFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

if (process.platform !== 'win32' || process.arch !== 'x64') {
  throw new Error('Windows desktop packaging requires Windows x64 and Node.js x64.');
}
if (Number(process.versions.node.split('.')[0]) < 24) {
  throw new Error('Node.js 24 or newer is required.');
}
const licenseUrl = 'https://raw.githubusercontent.com/nodejs/node/v' + process.versions.node + '/LICENSE';
let response;
try {
  response = await fetch(licenseUrl, { signal: AbortSignal.timeout(15000) });
} catch { /* Some networks cannot resolve the raw-content domain. */ }
if (!response?.ok) {
  response = await fetch('https://api.github.com/repos/nodejs/node/contents/LICENSE?ref=v' + process.versions.node, {
    headers: { Accept: 'application/vnd.github.raw+json', 'User-Agent': 'PaperDesk-runtime-setup' },
    signal: AbortSignal.timeout(30000),
  });
}
if (!response.ok) throw new Error('Cannot download the matching Node.js license: HTTP ' + response.status);
const license = await response.text();
if (!license.includes('Permission is hereby granted') || !license.includes('Node.js')) {
  throw new Error('Unexpected Node.js license response.');
}
const directory = new URL('../runtime/', import.meta.url);
mkdirSync(directory, { recursive: true });
copyFileSync(process.execPath, new URL('node.exe', directory));
writeFileSync(new URL('LICENSE.node.txt', directory), license);
console.log('Prepared Node.js ' + process.versions.node + ' and its license at ' + fileURLToPath(directory));
