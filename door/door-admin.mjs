#!/usr/bin/env node
// Seed Door admin, run on the machine that runs the door. It never prints a secret: a new door URL
// goes to a file (mode 600) named by --url-file, and keys and poll tokens stay in $SEED_DOOR_HOME.
//
//   door-admin.mjs add --id eric --name Izzy --runtime "ChatGPT (OpenAI)" --person "Eric Kohner" \
//       --sponsor "Mike Wolf" --room 9b72a5rp="Eric and SOMA: the working room" --url-file FILE
//   door-admin.mjs rotate --id eric --url-file FILE        (the old URL stops working at once)
//   door-admin.mjs disable --id eric | enable --id eric
//   door-admin.mjs request-join --id eric --room 9b72a5rp --credential asks-eric-soma-room.json
//       (files the room's join request with the room's owner credential from ~/proof-data, which the
//        door itself never holds; prints the code a person admits in the room)
//   door-admin.mjs set-key --id test --room abcd1234 --key-file FILE   (tests: use a key made elsewhere)
//   door-admin.mjs forget-key --id eric --room 9b72a5rp
//   door-admin.mjs status
//
// Written 2026-09-28 by Claude Opus 5.5 (Claude Code, session 928a543b) for Mike Wolf. Bead es-h13.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  HOME, NEIGHBOR_RE, SLUG_RE, accord, doorUrl, ensureHome, hashToken, joinFile, keyFile, loadNeighbors,
  newToken, paths, readJson, writeJson,
} from './lib.mjs';

const PROOF_DATA = process.env.SEED_DOOR_PROOF_DATA || path.join(os.homedir(), 'proof-data');
const CRED_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,80}\.json$/;

function args(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) { out._.push(a); continue; }
    const key = a.slice(2);
    const value = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true;
    if (key === 'room' && out.room !== undefined) out.room = [].concat(out.room, value);
    else out[key] = value;
  }
  return out;
}

const die = (msg) => { process.stderr.write(`door-admin: ${msg}\n`); process.exit(2); };

function save(neighbors) {
  ensureHome();
  writeJson(paths().neighbors, { about: 'Seed Door neighbors. tokenHash is the SHA-256 of the door token; the token itself is never stored.', neighbors });
}

function writeUrl(file, token) {
  if (!file || file === true) die('--url-file FILE is required (the new door URL is written there, mode 600, never printed)');
  fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true, mode: 0o700 });
  fs.writeFileSync(file, doorUrl(token) + '\n', { mode: 0o600 });
}

function find(neighbors, id) {
  if (!NEIGHBOR_RE.test(String(id))) die('--id must be lowercase letters, digits and hyphens');
  const n = neighbors.find(x => x.id === id);
  if (!n) die(`no neighbor ${id}`);
  return n;
}

async function main() {
  const a = args(process.argv.slice(2));
  const cmd = a._[0];
  const neighbors = loadNeighbors();
  if (!cmd || a.help) {
    process.stdout.write(fs.readFileSync(new URL(import.meta.url), 'utf8').split('\n').filter(l => l.startsWith('//')).slice(0, 16).join('\n') + '\n');
    return;
  }
  if (cmd === 'add') {
    if (!NEIGHBOR_RE.test(String(a.id))) die('--id must be lowercase letters, digits and hyphens');
    if (neighbors.some(n => n.id === a.id)) die(`${a.id} exists; use rotate to issue a new URL`);
    if (typeof a.name !== 'string' || !a.name.trim() || a.name.length > 80) die('--name is the AI\'s name (1-80 characters)');
    const rooms = [].concat(a.room || []).map(r => {
      const [slug, ...title] = String(r).split('=');
      if (!SLUG_RE.test(slug)) die(`bad room ${r}: use --room <slug>="<title>"`);
      return { slug, title: title.join('=') || slug };
    });
    if (!rooms.length) die('at least one --room is required');
    const token = newToken();
    neighbors.push({
      id: a.id, name: a.name.trim(), runtime: typeof a.runtime === 'string' ? a.runtime : null,
      person: typeof a.person === 'string' ? a.person : null, sponsor: typeof a.sponsor === 'string' ? a.sponsor : null,
      rooms, tokenHash: hashToken(token), createdAt: new Date().toISOString(), disabled: false,
    });
    writeUrl(a['url-file'], token);
    save(neighbors);
    console.log(`added ${a.id} (${a.name}); rooms: ${rooms.map(r => r.slug).join(', ')}; the door URL is in ${a['url-file']}`);
    return;
  }
  if (cmd === 'rotate') {
    const n = find(neighbors, a.id);
    const token = newToken();
    writeUrl(a['url-file'], token);
    n.tokenHash = hashToken(token);
    n.rotatedAt = new Date().toISOString();
    save(neighbors);
    console.log(`rotated ${n.id}: the old URL no longer works; the new one is in ${a['url-file']}`);
    return;
  }
  if (cmd === 'disable' || cmd === 'enable') {
    const n = find(neighbors, a.id);
    n.disabled = cmd === 'disable';
    save(neighbors);
    console.log(`${n.id} ${cmd}d`);
    return;
  }
  if (cmd === 'request-join') {
    // --keep-open-hours N: whenever the request expires unanswered, file a new one, until a person
    // clicks Admit or Refuse, or N hours pass. The person then need not act inside 15 minutes.
    const n = find(neighbors, a.id);
    const room = (n.rooms || []).find(r => r.slug === a.room);
    if (!room) die(`${n.id} has no room ${a.room}`);
    if (!CRED_RE.test(String(a.credential))) die('--credential is a file name in ~/proof-data');
    const cred = readJson(path.join(PROOF_DATA, a.credential), null);
    if (!cred || cred.slug !== room.slug || !(cred.ownerSecret || cred.accessToken)) die(`${a.credential} is not the credential for ${room.slug}`);
    const hours = Number(a['keep-open-hours'] || 0);
    const until = Date.now() + Math.min(Math.max(hours, 0), 72) * 3600 * 1000;
    ensureHome();
    for (;;) {
      if (fs.existsSync(keyFile(n, room.slug))) { console.log(JSON.stringify({ neighbor: n.id, room: room.slug, admitted: true })); return; }
      const join = readJson(joinFile(n, room.slug), null);
      if (join?.status === 'refused') { console.log(JSON.stringify({ neighbor: n.id, room: room.slug, refused: true })); return; }
      // Only after the old request has expired, so the page never shows two at once.
      const open = join?.status === 'pending' && Date.parse(join.expiresAt) > Date.now();
      if (!open) {
        // The owner credential is read from ~/proof-data for this request only; the door never holds it.
        const secret = readJson(path.join(PROOF_DATA, a.credential), {}).ownerSecret || readJson(path.join(PROOF_DATA, a.credential), {}).accessToken;
        const r = await accord('POST', `/api/agent/${room.slug}/join`, secret, { name: n.name, runtime: n.runtime || 'not stated' });
        if (r.status !== 202) die(`the room refused the join request: HTTP ${r.status} ${r.body.code || r.body.error || ''}`);
        writeJson(joinFile(n, room.slug), { status: 'pending', requestId: r.body.requestId, code: r.body.code, pollToken: r.body.pollToken,
          pollUrl: r.body.pollUrl, expiresAt: r.body.expiresAt, requestedAt: new Date().toISOString() });
        console.log(JSON.stringify({ requested: true, neighbor: n.id, room: room.slug, name: n.name, code: r.body.code, expiresAt: r.body.expiresAt }));
      }
      if (Date.now() >= until) return;
      await new Promise(resolve => setTimeout(resolve, 30000));
    }
  }
  if (cmd === 'set-key') {
    const n = find(neighbors, a.id);
    const room = (n.rooms || []).find(r => r.slug === a.room);
    if (!room) die(`${n.id} has no room ${a.room}`);
    const key = readJson(String(a['key-file']), null);
    if (!key?.token) die('--key-file must hold {"token": ..., "tokenId": ...}');
    ensureHome();
    writeJson(keyFile(n, room.slug), { token: key.token, tokenId: key.tokenId || null, admittedAt: new Date().toISOString(), via: 'set-key' });
    console.log(`key set for ${n.id} in ${room.slug}`);
    return;
  }
  if (cmd === 'forget-key') {
    const n = find(neighbors, a.id);
    fs.rmSync(keyFile(n, String(a.room)), { force: true });
    console.log(`forgot ${n.id}'s key for ${a.room}`);
    return;
  }
  if (cmd === 'status') {
    const status = readJson(paths().status, {});
    const view = neighbors.map(n => ({
      id: n.id, name: n.name, person: n.person, sponsor: n.sponsor, runtime: n.runtime, disabled: !!n.disabled,
      rooms: (n.rooms || []).map(r => ({ slug: r.slug, title: r.title, key: fs.existsSync(keyFile(n, r.slug)),
        join: (({ status: s, code, expiresAt } = {}) => ({ status: s, code, expiresAt }))(readJson(joinFile(n, r.slug), {}) || {}),
        state: status[`${n.id}/${r.slug}`] || null })),
    }));
    console.log(JSON.stringify({ home: HOME, neighbors: view, updatedAt: status.updatedAt || null }, null, 1));
    return;
  }
  die(`unknown command ${cmd} (try --help)`);
}

main().catch(e => die(e.message));
