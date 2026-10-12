// Only called on the newly staged package; never mutates the running executable.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resedit } from '@electron/packager/resedit';
const desktopRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { version } = JSON.parse(fs.readFileSync(path.join(desktopRoot, 'package.json'), 'utf8'));
if (!/^\d+\.\d+\.\d+$/.test(version)) throw Error('Expected numeric desktop version');
const filename = path.resolve(process.argv[2] ?? '');
if (path.basename(filename) !== 'Branch Agent.exe' || path.basename(path.dirname(path.dirname(filename))) !== `v${version}`) {
  throw Error('Version stamping requires this app version in a newly staged version folder');
}
await resedit(filename, { fileVersion: version, productVersion: version });
console.log(`Stamped file/product version ${version}: ${filename}`);
