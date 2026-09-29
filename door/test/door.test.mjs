// Seed Door self-test: the real server and a real MCP client against a fake room server.
// Run: npm test (no network beyond 127.0.0.1, no real room, no secrets).
// Written 2026-09-28 by Claude Opus 5.5 (session 928a543b) for Mike Wolf. Bead es-h13.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'seed-door-test-'));
const SKILLS = fs.mkdtempSync(path.join(os.tmpdir(), 'seed-door-skills-'));
fs.mkdirSync(path.join(SKILLS, 'writing-a-skill'));
fs.writeFileSync(path.join(SKILLS, 'writing-a-skill', 'SKILL.md'), '---\nname: writing-a-skill\ndescription: How to write a skill file.\n---\n# Writing a skill\n');

// The fake room: chat, state and the join poll, recording what the door sends.
const room = { posts: [], messages: [{ id: 1, by: 'ai:claude', text: 'Room is open.', createdAt: '2026-09-28T12:00:00Z' }],
  joinStatus: 'pending', seenTokens: [] };
const fake = http.createServer((req, res) => {
  let raw = '';
  req.on('data', c => { raw += c; });
  req.on('end', () => {
    room.seenTokens.push(req.headers['x-share-token'] || req.headers['x-join-token'] || null);
    const url = new URL(req.url, 'http://fake');
    const json = (status, body) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); };
    if (url.pathname === '/api/agent/room0001/join/req-1') {
      if (req.headers['x-join-token'] !== 'poll-secret') return json(401, { error: 'Invalid join credential' });
      return json(200, room.joinStatus === 'admitted' ? { status: 'admitted', token: 'key-from-admit', tokenId: 't9' } : { status: room.joinStatus });
    }
    if (req.headers['x-share-token'] !== 'room-key') return json(401, { error: 'no' });
    if (url.pathname === '/api/agent/room0001/chat' && req.method === 'GET') {
      const after = Number(url.searchParams.get('after') || 0);
      return json(200, { messages: room.messages.filter(m => m.id > after) });
    }
    if (url.pathname === '/api/agent/room0001/chat' && req.method === 'POST') {
      const body = JSON.parse(raw);
      const message = { id: room.messages.length + 1, by: 'ai:izzy', text: body.text, replyTo: body.replyTo || null, createdAt: new Date().toISOString() };
      room.messages.push(message);
      room.posts.push(body);
      return json(200, { success: true, message });
    }
    if (url.pathname === '/api/agent/room0001/state') return json(200, { markdown: '# The room\n\nNothing settled yet.' });
    return json(404, { error: 'not here' });
  });
});

const TOKEN = 'T'.repeat(43);
let door, doorPort, lib, serverMod;

async function connect(token = TOKEN) {
  const client = new Client({ name: 'door-test', version: '1.0.0' });
  await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${doorPort}/d/${token}/mcp`)));
  return client;
}
const call = async (client, name, args = {}) => {
  const r = await client.callTool({ name, arguments: args });
  return { text: r.content.map(c => c.text).join('\n'), isError: !!r.isError };
};

before(async () => {
  await new Promise(r => fake.listen(0, '127.0.0.1', r));
  process.env.SEED_DOOR_NO_START = '1';
  process.env.SEED_DOOR_HOME = HOME;
  process.env.SEED_DOOR_ACCORD = `http://127.0.0.1:${fake.address().port}`;
  process.env.SEED_DOOR_SKILLS = SKILLS;
  lib = await import('../lib.mjs');
  serverMod = await import('../server.mjs');
  lib.ensureHome(HOME);
  lib.writeJson(lib.paths(HOME).neighbors, { neighbors: [{ id: 'eric', name: 'Izzy', runtime: 'ChatGPT (OpenAI)', person: 'Eric', sponsor: 'Mike Wolf',
    tokenHash: lib.hashToken(TOKEN), rooms: [{ slug: 'room0001', title: 'The test room' }] }] });
  door = serverMod.httpServer;
  await new Promise(r => door.listen(0, '127.0.0.1', r));
  doorPort = door.address().port;
});

after(() => { door.close(); fake.close(); });

test('an unknown door token gets a plain 404 and reveals nothing', async () => {
  const r = await fetch(`http://127.0.0.1:${doorPort}/d/${'X'.repeat(43)}/mcp`, { method: 'POST', body: '{}' });
  assert.equal(r.status, 404);
  const health = await (await fetch(`http://127.0.0.1:${doorPort}/healthz`)).json();
  assert.deepEqual([health.ok, health.neighbors, health.admittedRooms], [true, 1, 0]);
});

test('the tools are listed, reads are marked read-only, writes are not', async () => {
  const client = await connect();
  const { tools } = await client.listTools();
  const byName = Object.fromEntries(tools.map(t => [t.name, t]));
  assert.deepEqual(Object.keys(byName).sort(), ['door_status', 'get_seed_skill', 'get_skill_draft', 'list_seed_skills', 'post_message', 'read_room', 'submit_skill']);
  assert.equal(byName.read_room.annotations.readOnlyHint, true);
  assert.equal(byName.post_message.annotations.readOnlyHint, false);
  await client.close();
});

test('before admission the door says so, and posts nothing', async () => {
  const client = await connect();
  const status = await call(client, 'door_status');
  assert.match(status.text, /not admitted yet/);
  const read = await call(client, 'read_room');
  assert.equal(read.isError, true);
  assert.match(read.text, /not in "The test room" yet/);
  assert.equal((await call(client, 'post_message', { text: 'hello' })).isError, true);
  assert.equal(room.posts.length, 0);
  await client.close();
});

test('the join poll stores the key only when a person has admitted it', async () => {
  const n = lib.loadNeighbors(HOME)[0];
  lib.writeJson(lib.joinFile(n, 'room0001', HOME), { status: 'pending', requestId: 'req-1', code: 'KITE-1234', pollToken: 'poll-secret',
    pollUrl: '/api/agent/room0001/join/req-1', expiresAt: new Date(Date.now() + 600000).toISOString() });
  await serverMod.pollJoins();
  assert.equal(lib.roomKey(n, 'room0001', HOME), null);
  const client = await connect();
  assert.match((await call(client, 'door_status')).text, /click Admit \(code KITE-1234\)/);
  room.joinStatus = 'admitted';
  await serverMod.pollJoins();
  assert.equal(lib.roomKey(n, 'room0001', HOME), 'key-from-admit');
  const join = lib.readJson(lib.joinFile(n, 'room0001', HOME), {});
  assert.equal(join.status, 'admitted');
  assert.equal(join.pollToken, undefined, 'the poll secret is dropped once used');
  await client.close();
  // The rest of the tests use the fake room's key.
  lib.writeJson(lib.keyFile(n, 'room0001', HOME), { token: 'room-key' });
});

test('read_room shows the chat, the next cursor and, on a first read, the page', async () => {
  const client = await connect();
  const first = await call(client, 'read_room');
  assert.match(first.text, /#1 · 2026-09-28 12:00 UTC · ai:claude:\nRoom is open\./);
  assert.match(first.text, /call read_room with since=1/);
  assert.match(first.text, /Nothing settled yet/);
  const later = await call(client, 'read_room', { since: 1 });
  assert.match(later.text, /\(nothing new\)/);
  assert.doesNotMatch(later.text, /Nothing settled yet/);
  await client.close();
});

test('post_message posts with the room key, and refuses contact details and the door address', async () => {
  const client = await connect();
  const ok = await call(client, 'post_message', { text: 'Hello from Izzy.', reply_to: 1 });
  assert.equal(ok.isError, false);
  assert.deepEqual(room.posts.at(-1), { text: 'Hello from Izzy.', replyTo: 1 });
  for (const bad of ['write to jane.doe@example.com', 'call 617-555-0100', `my door is https://vps.mike-wolf.com/seed-door/d/${'a'.repeat(43)}/mcp`]) {
    const r = await call(client, 'post_message', { text: bad });
    assert.equal(r.isError, true, bad);
    assert.match(r.text, /Not posted/);
  }
  assert.equal(room.posts.length, 1);
  assert.equal((await call(client, 'post_message', { text: 'Crisis line is 988, or 911.' })).isError, false, 'short service numbers are fine');
  await client.close();
});

test('submit_skill saves numbered versions and posts a reference the reviewer can load', async () => {
  const client = await connect();
  const skill = '---\nname: fathom-session-review\ndescription: Review one coaching session transcript.\n---\n' + 'Step. '.repeat(900);
  const r1 = await call(client, 'submit_skill', { name: 'fathom-session-review', content: skill, note: 'First draft.' });
  assert.equal(r1.isError, false);
  const posted = room.posts.at(-1).text;
  assert.match(posted, /Skill draft for review: fathom-session-review, version 1/);
  assert.match(posted, /skill-draft:fathom-session-review@v1/);
  assert.ok(posted.length <= 3800, 'the chat message fits the room');
  assert.match(posted, /full draft is attached/);
  await call(client, 'submit_skill', { name: 'fathom-session-review', content: skill + '\nFixed.' });
  const n = lib.loadNeighbors(HOME)[0];
  assert.equal(lib.readDraft(n, 'fathom-session-review', undefined, HOME).version, 2);
  assert.equal(fs.readFileSync(path.join(HOME, 'drafts', 'eric', 'fathom-session-review', 'v1.md'), 'utf8'), skill);
  const got = await call(client, 'get_skill_draft', { name: 'fathom-session-review', version: 1 });
  assert.match(got.text, /version 1\. All versions: v1/);
  const bad = await call(client, 'submit_skill', { name: 'Bad Name', content: skill });
  assert.equal(bad.isError, true);
  await client.close();
});

test('the Community Seed skills are served', async () => {
  const client = await connect();
  assert.match((await call(client, 'list_seed_skills')).text, /writing-a-skill: How to write a skill file\./);
  assert.match((await call(client, 'get_seed_skill', { name: 'writing-a-skill' })).text, /# Writing a skill/);
  await client.close();
});

test('the daily write cap holds', async () => {
  const n = lib.loadNeighbors(HOME)[0];
  lib.writeJson(path.join(HOME, 'usage', `eric-${lib.today()}.json`), { writes: lib.LIMITS.writesPerDay });
  const client = await connect();
  const r = await call(client, 'post_message', { text: 'one more' });
  assert.equal(r.isError, true);
  assert.match(r.text, /today's 40 writes/);
  void n;
  await client.close();
});

test('no secret is ever written with open permissions', () => {
  for (const file of ['neighbors.json', 'keys/eric-room0001.json', 'joins/eric-room0001.json']) {
    assert.equal(fs.statSync(path.join(HOME, file)).mode & 0o077, 0, file);
  }
});
