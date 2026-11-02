#!/usr/bin/env node
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = resolve(root, 'dist');
const publicKey = process.env.GUIDE_PUBLIC_KEY_SPKI_BASE64 || (await readFile(resolve(root, 'public-key.txt'), 'utf8')).trim();
const baseUrl = process.env.GUIDE_BASE_URL || 'https://example.org/guides/';
const feedbackUrl = process.env.FEEDBACK_URL || 'https://vps.mike-wolf.com/seed-door/feedback';
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
await cp(resolve(root, 'src'), output, { recursive: true });
// Every build carries its own version, so the loaded build can be told apart.
const { execSync } = await import('node:child_process');
const commits = execSync('git rev-list --count HEAD', { cwd: root }).toString().trim();
const now = new Date();
const buildVersion = `0.2.${commits}.${now.getUTCHours() * 60 + now.getUTCMinutes()}`;
const manifestPath = resolve(output, 'manifest.json');
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
manifest.version = buildVersion;
await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
const coreSource = await readFile(resolve(root, 'src/guide-core.js'), 'utf8');
await writeFile(resolve(output, 'guide-runtime-core.js'), `(function(){\n${coreSource.replaceAll('export ', '')}\nglobalThis.SOMAGuideCore = { assertStepSite, buildFeedback, checkSaved, pickTarget, structureSnapshot };\n})();\n`);
const startPath = resolve(output, 'start.js');
const start = (await readFile(startPath, 'utf8')).replace('__GUIDE_PUBLIC_KEY__', publicKey).replace('__GUIDE_BASE_URL__', baseUrl);
await writeFile(startPath, start);
const backgroundPath = resolve(output, 'background.js');
await writeFile(backgroundPath, (await readFile(backgroundPath, 'utf8')).replace('__GUIDE_PUBLIC_KEY__', publicKey).replace('__FEEDBACK_URL__', feedbackUrl));
console.log(output);
