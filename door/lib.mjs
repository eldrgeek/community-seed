// Seed Door: shared pieces for the server and the admin tool (no network at import time).
//
// Written 2026-09-28 by Claude Opus 5.5 (Claude Code, session 928a543b) for Mike Wolf, who asked that
// "you and Izzy can coordinate without Eric and me in the middle", connected to Community Seed.
// Bead es-h13.

import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const HOME = process.env.SEED_DOOR_HOME || path.join(os.homedir(), 'seed-door');
export const ACCORD = process.env.SEED_DOOR_ACCORD || 'http://127.0.0.1:4400';
export const PUBLIC_ACCORD = process.env.SEED_DOOR_PUBLIC_ACCORD || 'https://proof.vpsmikewolf.duckdns.org';
export const PUBLIC_DOOR = process.env.SEED_DOOR_PUBLIC || 'https://vps.mike-wolf.com/seed-door';

export const LIMITS = {
  writesPerDay: 40,          // posts plus skill submissions, per neighbor, per UTC day
  requestsPerWindow: 120,    // any request, per neighbor
  windowMs: 10 * 60 * 1000,
  maxPost: 3800,             // the Accord chat keeps 4,000 characters; leave room
  maxSkill: 40000,
  minSkill: 200,
  pageChars: 12000,          // how much of a room's page read_room returns
  chatPage: 100,
};

// Ids and names that reach the filesystem are checked here, so a path never comes from input.
export const NEIGHBOR_RE = /^[a-z0-9][a-z0-9-]{0,31}$/;
export const SLUG_RE = /^[a-z0-9]{6,16}$/;
export const SKILL_RE = /^[a-z0-9][a-z0-9-]{1,63}$/;

export const ACCORD_HEADERS = {
  'Content-Type': 'application/json',
  'X-Proof-Client-Version': '0.33.0',
  'X-Proof-Client-Build': 'seed-door',
  'X-Proof-Client-Protocol': '3',
};

export const hashToken = token => crypto.createHash('sha256').update(String(token)).digest('hex');
export const newToken = () => crypto.randomBytes(32).toString('base64url');

export function doorUrl(token) {
  return `${PUBLIC_DOOR}/d/${token}/mcp`;
}

export function paths(home = HOME) {
  return {
    home,
    neighbors: path.join(home, 'neighbors.json'),
    status: path.join(home, 'status.json'),
    keys: path.join(home, 'keys'),
    joins: path.join(home, 'joins'),
    drafts: path.join(home, 'drafts'),
    usage: path.join(home, 'usage'),
  };
}

export function ensureHome(home = HOME) {
  const p = paths(home);
  for (const dir of [p.home, p.keys, p.joins, p.drafts, p.usage]) fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  return p;
}

export function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}

// Write-then-rename, so a reader never sees half a file. Secrets are written 0600.
export function writeJson(file, value, mode = 0o600) {
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 1) + '\n', { mode });
  fs.renameSync(tmp, file);
}

export function loadNeighbors(home = HOME) {
  const data = readJson(paths(home).neighbors, { neighbors: [] });
  return Array.isArray(data.neighbors) ? data.neighbors : [];
}

export function neighborForToken(token, home = HOME) {
  if (typeof token !== 'string' || token.length < 32 || token.length > 128) return null;
  const want = Buffer.from(hashToken(token), 'hex');
  let found = null;
  for (const n of loadNeighbors(home)) {
    if (!n || n.disabled || typeof n.tokenHash !== 'string' || n.tokenHash.length !== 64) continue;
    // Compare every candidate in constant time, and keep going after a match.
    if (crypto.timingSafeEqual(want, Buffer.from(n.tokenHash, 'hex')) && !found) found = n;
  }
  return found;
}

export const keyFile = (n, slug, home = HOME) => path.join(paths(home).keys, `${n.id}-${slug}.json`);
export const joinFile = (n, slug, home = HOME) => path.join(paths(home).joins, `${n.id}-${slug}.json`);

export function roomKey(n, slug, home = HOME) {
  const key = readJson(keyFile(n, slug, home), null);
  return key && typeof key.token === 'string' ? key.token : null;
}

// The rooms never hold client material. The door cannot judge meaning, but it can refuse
// contact details, and it refuses its own address, which is the neighbor's key.
export function privacyProblems(text) {
  const problems = [];
  const s = String(text ?? '');
  if (/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/.test(s)) problems.push('an email address');
  if (/(?<![\d-])(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}(?![\d-])/.test(s)) problems.push('a phone number');
  if (/seed-door\/d\/[A-Za-z0-9_-]{20,}/.test(s)) problems.push("the door's own address, which works like a key");
  return problems;
}

export function today() {
  return new Date().toISOString().slice(0, 10);
}

export function writesToday(n, home = HOME) {
  const file = path.join(paths(home).usage, `${n.id}-${today()}.json`);
  return readJson(file, { writes: 0 }).writes || 0;
}

export function countWrite(n, home = HOME) {
  const file = path.join(paths(home).usage, `${n.id}-${today()}.json`);
  const used = readJson(file, { writes: 0 });
  used.writes = (used.writes || 0) + 1;
  writeJson(file, used, 0o600);
  return used.writes;
}

export async function accord(method, route, token, body) {
  const headers = { ...ACCORD_HEADERS };
  if (token) headers['x-share-token'] = token;
  let response;
  try {
    response = await fetch(ACCORD + route, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  } catch (error) {
    return { status: 0, body: { error: `the room's server did not answer (${error.message})` } };
  }
  let parsed = {};
  try { parsed = await response.json(); } catch { parsed = {}; }
  return { status: response.status, body: parsed };
}

// Skill drafts are files: drafts/<neighbor>/<skill>/v<N>.md plus meta.json.
export function draftDir(n, name, home = HOME) {
  return path.join(paths(home).drafts, n.id, name);
}

export function draftVersions(n, name, home = HOME) {
  return readJson(path.join(draftDir(n, name, home), 'meta.json'), { versions: [] }).versions || [];
}

export function saveDraft(n, name, content, note, home = HOME) {
  const dir = draftDir(n, name, home);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const meta = readJson(path.join(dir, 'meta.json'), { versions: [] });
  const version = (meta.versions.at(-1)?.v || 0) + 1;
  fs.writeFileSync(path.join(dir, `v${version}.md`), content, { mode: 0o600 });
  meta.versions.push({ v: version, at: new Date().toISOString(), chars: content.length, note: note || null, messageId: null });
  writeJson(path.join(dir, 'meta.json'), meta);
  return version;
}

export function markDraftPosted(n, name, version, messageId, home = HOME) {
  const file = path.join(draftDir(n, name, home), 'meta.json');
  const meta = readJson(file, { versions: [] });
  const row = meta.versions.find(v => v.v === version);
  if (row) row.messageId = messageId;
  writeJson(file, meta);
}

export function readDraft(n, name, version, home = HOME) {
  const versions = draftVersions(n, name, home);
  const v = version || versions.at(-1)?.v;
  if (!v) return null;
  try {
    return { version: v, text: fs.readFileSync(path.join(draftDir(n, name, home), `v${v}.md`), 'utf8'), versions };
  } catch {
    return null;
  }
}

// The Community Seed's skills pack, bundled beside the door: skills/<name>/SKILL.md.
export function seedSkills(dir) {
  let names = [];
  try { names = fs.readdirSync(dir).filter(name => SKILL_RE.test(name)); } catch { return []; }
  const out = [];
  for (const name of names.sort()) {
    let text;
    try { text = fs.readFileSync(path.join(dir, name, 'SKILL.md'), 'utf8'); } catch { continue; }
    const description = /^description:\s*(.+)$/m.exec(text)?.[1]?.replace(/^["']|["']$/g, '') || '';
    out.push({ name, description, text });
  }
  return out;
}
