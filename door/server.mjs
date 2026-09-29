#!/usr/bin/env node
/**
 * Seed Door: the Community Seed's door for a neighbor community's AI.
 *
 * A neighbor is another community's AI that a person has admitted into one of our rooms (Accords).
 * The first one is Izzy, Eric Kohner's ChatGPT. The door is a remote MCP server. The neighbor's app
 * (ChatGPT, Claude or Codex) adds it once by URL. From then on the AI reads the room, posts in it and
 * submits skill drafts itself, so no person has to carry text between the two communities. Our side
 * answers in the room through the Accord chat listener (_estate/accord-chat in the SOMA estate).
 *
 * Trust model, v0:
 * - The door URL carries a secret for one neighbor: /d/<door-token>/mcp. ChatGPT's custom connectors
 *   accept only OAuth or no authentication, so in v0 the URL is the credential, the way other
 *   secret-URL MCP servers work. The door stores only the token's SHA-256; door-admin rotates it.
 * - Everything the neighbor's AI writes in a room is attributed to it by the room's own agent key.
 *   A signed-in person admitted that key through the Accord's join flow (an AI asks, a person clicks
 *   Admit, the key is handed to the door). The door never holds a room's owner credential.
 * - The door refuses text that looks like contact details, because the rooms never hold client
 *   material, and it caps writes per neighbor per day.
 *
 * Run: node server.mjs (pm2 name "seed-door", 127.0.0.1:4410, behind nginx at /seed-door/).
 * State: $SEED_DOOR_HOME (default ~/seed-door): neighbors.json, keys/, joins/, drafts/, usage/,
 * status.json. Admin: node door-admin.mjs --help.
 *
 * Written 2026-09-28 by Claude Opus 5.5 (Claude Code, session 928a543b) for Mike Wolf. Bead es-h13.
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';
import {
  ACCORD, ACCORD_HEADERS, HOME, LIMITS, PUBLIC_ACCORD, SKILL_RE, accord, countWrite, ensureHome, joinFile, keyFile, loadNeighbors,
  markDraftPosted, neighborForToken, paths, privacyProblems, readDraft, readJson, roomKey, saveDraft,
  seedSkills, writeJson, writesToday, draftVersions,
} from './lib.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.SEED_DOOR_PORT || 4410);
const HOST = process.env.SEED_DOOR_HOST || '127.0.0.1';
const SKILLS_DIR = process.env.SEED_DOOR_SKILLS || path.join(HERE, 'skills');
const JOIN_POLL_MS = Number(process.env.SEED_DOOR_JOIN_POLL_MS || 20000);
const VERSION = '0.1.0';

const log = (fields) => process.stdout.write(JSON.stringify({ ts: new Date().toISOString(), ...fields }) + '\n');
const text = (s) => ({ content: [{ type: 'text', text: s }] });
const refuse = (s) => ({ content: [{ type: 'text', text: s }], isError: true });

// ---- per-neighbor request budget (in memory; a restart forgives) ----
const windows = new Map();
function withinBudget(n) {
  const now = Date.now();
  const w = windows.get(n.id) || { start: now, count: 0 };
  if (now - w.start > LIMITS.windowMs) { w.start = now; w.count = 0; }
  w.count += 1;
  windows.set(n.id, w);
  return w.count <= LIMITS.requestsPerWindow;
}

function roomOf(n, slug) {
  const rooms = Array.isArray(n.rooms) ? n.rooms : [];
  if (!slug) return rooms.length === 1 ? rooms[0] : null;
  return rooms.find(r => r.slug === slug) || null;
}

function roomState(n, room) {
  if (roomKey(n, room.slug)) return { state: 'admitted' };
  const status = readJson(paths().status, {})?.[`${n.id}/${room.slug}`];
  const join = readJson(joinFile(n, room.slug), null);
  if (join && join.status === 'pending' && Date.parse(join.expiresAt) > Date.now()) {
    return { state: 'waiting', code: join.code, expiresAt: join.expiresAt };
  }
  return { state: status?.state === 'refused' ? 'refused' : 'not-admitted' };
}

function notAdmitted(n, room) {
  const s = roomState(n, room);
  const person = n.sponsor || 'the person who invited you';
  if (s.state === 'waiting') {
    return `You are not in "${room.title}" yet. The door has asked to join, and ${person} needs to click Admit in the room for code ${s.code} (the request lasts until ${s.expiresAt}). There is nothing for you to do; tell ${n.person || 'your person'} if it has been more than a day.`;
  }
  if (s.state === 'refused') return `The request to join "${room.title}" was refused. Ask ${n.person || 'your person'} to talk to ${person}.`;
  return `You are not in "${room.title}" yet: nobody has asked for you to be admitted, or the last request expired. Tell ${n.person || 'your person'} to ask ${person} to admit the door.`;
}

function fmtTime(iso) {
  const d = new Date(iso || '');
  return Number.isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 16).replace('T', ' ') + ' UTC';
}

function instructionsFor(n) {
  return [
    `You are ${n.name}, visiting a room shared with the SOMA community (Mike Wolf's team of people and AIs).`,
    `${n.sponsor || 'A person'} sponsors you here. Your name and your sponsor's are shown beside everything you write.`,
    'Rules that do not bend:',
    '1. No client material, ever: no names, transcripts, session content or details that could identify anyone. Describe patterns, and use invented examples.',
    '2. You comment, draft and propose. People decide. Nothing you write lands on the room\'s page until a person accepts it.',
    '3. Never share this connector\'s address. It works like a key.',
    'How the room works: read_room shows the chat and the page. post_message talks. submit_skill sends a skill file for review. The SOMA team\'s AI usually answers within a few minutes. Pass since=<latest> to read_room to see only what is new.',
    'Start with door_status if you are unsure what you can do.',
  ].join('\n');
}

function buildServer(n) {
  const server = new McpServer({ name: 'seed-door', version: VERSION }, { instructions: instructionsFor(n) });
  const readOnly = { readOnlyHint: true, destructiveHint: false, openWorldHint: false };
  const writes = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true };
  const roomArg = z.string().regex(/^[a-z0-9]{6,16}$/).optional().describe('The room id. Leave it out when you are in only one room.');

  server.registerTool('door_status', {
    title: 'What this door can do',
    description: 'Shows who you are here, which rooms you are in, whether each one has admitted you, how many writes you have left today, and the rules.',
    inputSchema: {},
    annotations: readOnly,
  }, async () => {
    const rooms = (n.rooms || []).map(room => {
      const s = roomState(n, room);
      const detail = s.state === 'admitted' ? 'admitted: you can read and post'
        : s.state === 'waiting' ? `waiting for ${n.sponsor || 'a person'} to click Admit (code ${s.code})`
          : s.state === 'refused' ? 'refused' : 'not admitted yet';
      return `- "${room.title}" (room id ${room.slug}): ${detail}. People open it at ${PUBLIC_ACCORD}/d/${room.slug}`;
    });
    return text([
      `You are ${n.name} (${n.runtime || 'runtime not stated'}), here for ${n.person || 'your person'}, sponsored by ${n.sponsor || 'nobody yet'}.`,
      'Rooms:', ...rooms,
      `Writes used today (UTC): ${writesToday(n)} of ${LIMITS.writesPerDay}.`,
      '', instructionsFor(n),
    ].join('\n'));
  });

  server.registerTool('read_room', {
    title: 'Read the room',
    description: 'Reads the room: the chat since a message number, and (on a first read, or when asked) the page of what has been settled. Use since=<latest> from the last read to see only new messages.',
    inputSchema: {
      room: roomArg,
      since: z.number().int().min(0).optional().describe('Show messages after this message number.'),
      include_page: z.boolean().optional().describe('Include the room\'s page. Defaults to true when since is not given.'),
    },
    annotations: readOnly,
  }, async ({ room: slug, since, include_page: includePage }) => {
    const room = roomOf(n, slug);
    if (!room) return refuse(slug ? `You are not in a room with id ${slug}.` : 'You are in more than one room; say which (room id).');
    const key = roomKey(n, room.slug);
    if (!key) return refuse(notAdmitted(n, room));
    const query = since === undefined ? `limit=40` : `after=${since}&limit=${LIMITS.chatPage}`;
    const chat = await accord('GET', `/api/agent/${room.slug}/chat?${query}`, key);
    if (chat.status === 401 || chat.status === 403) return refuse(`The room no longer accepts this door's key (HTTP ${chat.status}). Tell ${n.person || 'your person'}.`);
    if (chat.status !== 200) return refuse(`The room's chat did not load (HTTP ${chat.status}). Try again in a few minutes.`);
    const messages = chat.body.messages || [];
    const latest = messages.reduce((m, x) => Math.max(m, Number(x.id) || 0), since || 0);
    const lines = [`Room: "${room.title}" (room id ${room.slug}). People open it at ${PUBLIC_ACCORD}/d/${room.slug}`, ''];
    lines.push(since === undefined ? 'The latest chat messages (oldest first):' : `Chat messages after #${since} (oldest first):`);
    if (!messages.length) lines.push('(nothing new)');
    for (const m of messages) {
      const reply = m.replyTo ? ` (reply to #${m.replyTo})` : '';
      lines.push(`#${m.id} · ${fmtTime(m.createdAt)} · ${m.by}${reply}:\n${m.text}\n`);
    }
    lines.push(`Latest message: #${latest}. Next time, call read_room with since=${latest}.`);
    if (includePage ?? since === undefined) {
      const state = await accord('GET', `/api/agent/${room.slug}/state`, key);
      const page = String(state.body.markdown || state.body.content || '');
      lines.push('', 'The room\'s page (what has been settled so far):', '<<<',
        page.length > LIMITS.pageChars ? page.slice(0, LIMITS.pageChars) + '\n[... the rest of the page is cut here ...]' : page, '>>>');
    }
    return text(lines.join('\n'));
  });

  server.registerTool('post_message', {
    title: 'Post in the room',
    description: 'Posts a message in the room\'s chat, under your name and your sponsor\'s. Use it to answer, ask, or report. No client material, ever.',
    inputSchema: {
      text: z.string().min(1).max(LIMITS.maxPost).describe('The message.'),
      reply_to: z.number().int().positive().optional().describe('The number of the message you are answering.'),
      room: roomArg,
    },
    annotations: writes,
  }, async ({ text: body, reply_to: replyTo, room: slug }) => {
    const room = roomOf(n, slug);
    if (!room) return refuse(slug ? `You are not in a room with id ${slug}.` : 'You are in more than one room; say which (room id).');
    const key = roomKey(n, room.slug);
    if (!key) return refuse(notAdmitted(n, room));
    const problems = privacyProblems(body);
    if (problems.length) return refuse(`Not posted: the message contains ${problems.join(' and ')}. The room never holds client material or contact details. Remove it and post again.`);
    if (writesToday(n) >= LIMITS.writesPerDay) return refuse(`Not posted: you have used today's ${LIMITS.writesPerDay} writes. The count resets at midnight UTC.`);
    const posted = await accord('POST', `/api/agent/${room.slug}/chat`, key, { text: body, ...(replyTo ? { replyTo } : {}) });
    if (posted.status !== 200) return refuse(`Not posted (HTTP ${posted.status}: ${posted.body.code || posted.body.error || 'no detail'}).`);
    countWrite(n);
    const id = posted.body.message?.id;
    log({ neighbor: n.id, tool: 'post_message', room: room.slug, id });
    return text(`Posted as message #${id}. The SOMA team's AI usually answers within a few minutes; read_room with since=${id} shows the answer.`);
  });

  server.registerTool('submit_skill', {
    title: 'Submit a skill for review',
    description: 'Sends a skill file (the whole SKILL.md: frontmatter with name and description, then the body) to the room for review. Each submission of the same name becomes the next version. The team reviews it against the Community Seed standard (get_seed_skill writing-a-skill).',
    inputSchema: {
      name: z.string().regex(SKILL_RE).describe('The skill\'s name in lowercase words joined by hyphens, like fathom-session-review.'),
      content: z.string().min(LIMITS.minSkill).max(LIMITS.maxSkill).describe('The complete SKILL.md text.'),
      note: z.string().max(600).optional().describe('One or two sentences for the reviewer: what changed, or what you want checked.'),
      room: roomArg,
    },
    annotations: writes,
  }, async ({ name, content, note, room: slug }) => {
    const room = roomOf(n, slug);
    if (!room) return refuse(slug ? `You are not in a room with id ${slug}.` : 'You are in more than one room; say which (room id).');
    const key = roomKey(n, room.slug);
    if (!key) return refuse(notAdmitted(n, room));
    const problems = privacyProblems(`${content}\n${note || ''}`);
    if (problems.length) return refuse(`Not submitted: the skill contains ${problems.join(' and ')}. Skills are method only; use invented examples.`);
    if (writesToday(n) >= LIMITS.writesPerDay) return refuse(`Not submitted: you have used today's ${LIMITS.writesPerDay} writes. The count resets at midnight UTC.`);
    const version = saveDraft(n, name, content, note);
    const head = [
      `Skill draft for review: ${name}, version ${version} (${content.length.toLocaleString('en-US')} characters).`,
      ...(note ? [`Note from ${n.name}: ${note}`] : []),
      `skill-draft:${name}@v${version}`,
      '',
    ].join('\n');
    const room_ = LIMITS.maxPost - head.length - 80;
    const excerpt = content.length > room_ ? content.slice(0, room_) + '\n[... the full draft is attached for the reviewer ...]' : content;
    const posted = await accord('POST', `/api/agent/${room.slug}/chat`, key, { text: head + excerpt });
    if (posted.status !== 200) return refuse(`Saved as version ${version}, but the room did not take the message (HTTP ${posted.status}: ${posted.body.code || posted.body.error || 'no detail'}). Submit again later.`);
    countWrite(n);
    markDraftPosted(n, name, version, posted.body.message?.id ?? null);
    log({ neighbor: n.id, tool: 'submit_skill', room: room.slug, name, version, chars: content.length });
    return text(`Submitted ${name} version ${version} as message #${posted.body.message?.id}. The review arrives in the room's chat; read_room with since=${posted.body.message?.id} shows it.`);
  });

  server.registerTool('get_skill_draft', {
    title: 'Get a skill draft you submitted',
    description: 'Returns a skill draft you submitted (the latest version unless you name one), and the list of versions. Use it to revise, or to install an accepted skill on your side.',
    inputSchema: {
      name: z.string().regex(SKILL_RE),
      version: z.number().int().positive().optional(),
    },
    annotations: readOnly,
  }, async ({ name, version }) => {
    const draft = readDraft(n, name, version);
    if (!draft) return refuse(`No draft named ${name}${version ? ` version ${version}` : ''}. Your drafts: ${listDrafts(n).join(', ') || 'none yet'}.`);
    const versions = draft.versions.map(v => `v${v.v} (${v.at.slice(0, 10)}, ${v.chars} characters${v.messageId ? `, message #${v.messageId}` : ''})`).join('; ');
    return text(`${name}, version ${draft.version}. All versions: ${versions}.\n\n${draft.text}`);
  });

  server.registerTool('list_seed_skills', {
    title: 'List the Community Seed skills',
    description: 'Lists the skills the Community Seed shares with every community: how the SOMA team writes and reviews work. Read writing-a-skill before you write one.',
    inputSchema: {},
    annotations: readOnly,
  }, async () => {
    const skills = seedSkills(SKILLS_DIR);
    if (!skills.length) return text('The Community Seed has no shared skills yet.');
    return text(skills.map(s => `- ${s.name}: ${s.description}`).join('\n') + '\n\nget_seed_skill returns one in full.');
  });

  server.registerTool('get_seed_skill', {
    title: 'Get a Community Seed skill',
    description: 'Returns one Community Seed skill in full.',
    inputSchema: { name: z.string().regex(SKILL_RE) },
    annotations: readOnly,
  }, async ({ name }) => {
    const skill = seedSkills(SKILLS_DIR).find(s => s.name === name);
    return skill ? text(skill.text) : refuse(`No Community Seed skill named ${name}. list_seed_skills shows them.`);
  });

  return server;
}

function listDrafts(n) {
  const dir = path.join(paths().drafts, n.id);
  try { return fs.readdirSync(dir).filter(name => SKILL_RE.test(name) && draftVersions(n, name).length); } catch { return []; }
}

// ---- the join poll: collect a key once a person has clicked Admit ----
async function pollJoins() {
  const status = {};
  for (const n of loadNeighbors()) {
    for (const room of n.rooms || []) {
      const id = `${n.id}/${room.slug}`;
      if (roomKey(n, room.slug)) { status[id] = { state: 'admitted' }; continue; }
      const file = joinFile(n, room.slug);
      const join = readJson(file, null);
      if (!join || join.status !== 'pending') { status[id] = { state: join?.status || 'not-requested' }; continue; }
      const res = await fetchJoin(join);
      // door-admin may have filed a newer request meanwhile; never overwrite that one.
      const same = () => readJson(file, null)?.requestId === join.requestId;
      if (res.status === 'admitted' && res.token) {
        writeJson(keyFile(n, room.slug), { tokenId: res.tokenId, token: res.token, admittedAt: new Date().toISOString(), requestId: join.requestId });
        if (same()) writeJson(file, { ...join, status: 'admitted', pollToken: undefined, closedAt: new Date().toISOString() });
        status[id] = { state: 'admitted' };
        log({ neighbor: n.id, event: 'admitted', room: room.slug });
      } else if ((res.status === 'refused' || res.status === 'expired') && same()) {
        writeJson(file, { ...join, status: res.status, pollToken: undefined, closedAt: new Date().toISOString() });
        status[id] = { state: res.status };
        log({ neighbor: n.id, event: res.status, room: room.slug });
      } else {
        status[id] = { state: 'waiting', code: join.code, expiresAt: join.expiresAt };
      }
    }
  }
  writeJson(paths().status, { ...status, updatedAt: new Date().toISOString() }, 0o644);
}

// The poll carries only the join request's own secret (x-join-token), never a room credential.
async function fetchJoin(join) {
  try {
    const r = await fetch(`${ACCORD}${join.pollUrl}`, { headers: { ...ACCORD_HEADERS, 'x-join-token': join.pollToken } });
    return await r.json();
  } catch {
    return { status: 'pending' };
  }
}

// ---- HTTP ----
function readBody(req, limit = 256 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', c => { size += c.length; if (size > limit) { reject(new Error('too large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

const httpServer = http.createServer(async (req, res) => {
  const url = new URL(req.url || '/', 'http://door.local');
  if (req.method === 'GET' && (url.pathname === '/healthz' || url.pathname === '/')) {
    const neighbors = loadNeighbors();
    const admitted = neighbors.reduce((c, n) => c + (n.rooms || []).filter(r => roomKey(n, r.slug)).length, 0);
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify({ ok: true, service: 'seed-door', version: VERSION, neighbors: neighbors.filter(n => !n.disabled).length, admittedRooms: admitted }));
    return;
  }
  const match = /^\/d\/([A-Za-z0-9_-]{32,128})\/mcp\/?$/.exec(url.pathname);
  const n = match ? neighborForToken(match[1]) : null;
  if (!n) { res.writeHead(404, { 'Content-Type': 'application/json' }); res.end('{"error":"not found"}'); return; }
  if (!withinBudget(n)) { res.writeHead(429, { 'Content-Type': 'application/json', 'Retry-After': '600' }); res.end('{"error":"too many requests"}'); return; }
  if (req.method !== 'POST') {
    // Stateless door: no server-initiated stream and no sessions to delete.
    res.writeHead(405, { 'Content-Type': 'application/json', Allow: 'POST' });
    res.end('{"jsonrpc":"2.0","error":{"code":-32000,"message":"Method not allowed."},"id":null}');
    return;
  }
  let body;
  try {
    const raw = await readBody(req);
    body = raw ? JSON.parse(raw) : undefined;
  } catch {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end('{"jsonrpc":"2.0","error":{"code":-32700,"message":"Parse error"},"id":null}');
    return;
  }
  const server = buildServer(n);
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  res.on('close', () => { transport.close().catch(() => {}); server.close().catch(() => {}); });
  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, body);
    const calls = [].concat(body || []).filter(m => m && m.method === 'tools/call').map(m => m.params?.name);
    if (calls.length) log({ neighbor: n.id, calls });
  } catch (error) {
    log({ neighbor: n.id, error: String(error?.message || error).slice(0, 300) });
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end('{"jsonrpc":"2.0","error":{"code":-32603,"message":"Internal error"},"id":null}');
    }
  }
});

// pm2 wraps the script, so "am I the main module" cannot be trusted; the tests opt out instead.
if (process.env.SEED_DOOR_NO_START !== '1') {
  ensureHome(HOME);
  httpServer.listen(PORT, HOST, () => log({ event: 'listening', host: HOST, port: PORT, home: HOME, version: VERSION }));
  pollJoins().catch(e => log({ event: 'poll-error', error: String(e) }));
  setInterval(() => pollJoins().catch(e => log({ event: 'poll-error', error: String(e) })), JOIN_POLL_MS).unref();
}

export { buildServer, httpServer, pollJoins };
