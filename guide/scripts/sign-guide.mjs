#!/usr/bin/env node
import { createPrivateKey, sign } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';

const [guidePath, keyPath] = process.argv.slice(2);
if (!guidePath || !keyPath) {
  console.error('Usage: npm run sign -- path/to/guide.json path/to/private-key.pem');
  process.exit(1);
}
const bytes = await readFile(guidePath);
const key = createPrivateKey(await readFile(keyPath));
if (key.asymmetricKeyType !== 'ed25519') throw new Error('The private key must be Ed25519.');
await writeFile(`${guidePath}.sig`, `${sign(null, bytes, key).toString('base64')}\n`, { flag: 'wx' });
console.log(`${guidePath}.sig`);
