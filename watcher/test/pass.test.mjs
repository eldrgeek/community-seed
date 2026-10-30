// Watcher passes against a fake door. No real door, claude, codex, or Chrome.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  acquireLock, pass, releaseLock, runLoop, saveState, scrubText, setEnabled, ensureState,
} from '../lib.mjs';
import { startFakeDoor } from './fake-door.mjs';
import { formatDoorStatus, formatReadRoom } from './format.mjs';

const MARKER = 'MARKER-ROOM-TEXT-9f3a';
const TOKEN = 'SuperSecretDoorToken123';
const BIN = fileURLToPath(new URL('../bin/seed-watcher.mjs', import.meta.url));

function statusText(rooms) {
  return formatDoorStatus({
    name: 'Izzy', runtime: 'Codex', person: 'a person', sponsor: 'a neighbor', writes: 0, limit: 40,
    rooms: rooms || [
      { title: 'The test room', id: 'room0001', detail: 'admitted: you can read and post', publicBase: 'http://127.0.0.1:4400' },
    ],
  });
}

function roomText(messages, since, page) {
  return formatReadRoom({
    title: 'The test room', id: 'room0001', publicBase: 'http://127.0.0.1:4400', since,
    messages: messages.filter((message) => message.id > since),
    page,
  });
}

async function scaffold(t, { messages = [], rooms, state = {}, urlToken = false } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'seed-watcher-'));
  fs.chmodSync(dir, 0o700);
  const world = { calls: [] };
  const door = await startFakeDoor(world);
  world.status = statusText(rooms);
  world.read = ({ since }) => roomText(messages, since);
  const urlFile = path.join(dir, 'door.url');
  const url = urlToken ? `http://127.0.0.1:${door.port}/d/${TOKEN}/mcp` : door.url;
  fs.writeFileSync(urlFile, `${url}\n`, { mode: 0o600 });
  fs.chmodSync(urlFile, 0o600);
  ensureState(dir);
  if (Object.keys(state).length) saveState(dir, state);
  t.after(async () => {
    await door.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });
  return { dir, world, urlFile, url, door };
}

function baseConfig(extra = {}) {
  return {
    names: ['Izzy'],
    runner: 'command',
    command: [process.execPath, '-e', 'process.exit(0)'],
    dailyCap: 20,
    minIntervalSeconds: 0,
    ...extra,
  };
}

const at = (id, by, text) => ({ id, by, text, createdAt: '2026-10-30T12:00:00.000Z' });

function filesExceptUrl(dir) {
  return fs.readdirSync(dir)
    .filter((name) => name !== 'door.url')
    .map((name) => fs.readFileSync(path.join(dir, name), 'utf8'))
    .join('\n');
}

test('a mention wakes the runner, and the door URL and room text stay out of the log', async (t) => {
  const record = path.join(os.tmpdir(), `seed-watcher-argv-${process.pid}-${Date.now()}.json`);
  const script = path.join(os.tmpdir(), `seed-watcher-record-${process.pid}-${Date.now()}.mjs`);
  fs.writeFileSync(script, `import fs from 'node:fs';
fs.writeFileSync(process.argv[2], JSON.stringify({ argv: process.argv, env: process.env }));
console.log('RUNNER-STDOUT-MARKER');
console.error('RUNNER-STDOUT-MARKER');
`);
  t.after(() => { fs.rmSync(record, { force: true }); fs.rmSync(script, { force: true }); });
  const env = await scaffold(t, {
    urlToken: true,
    messages: [at(4, 'human:ada', `before`), at(5, 'human:ada', `@Izzy please look\n${MARKER}`)],
  });
  const result = await pass({
    stateDir: env.dir,
    urlFile: env.urlFile,
    config: baseConfig({ command: [process.execPath, script, record] }),
    now: () => new Date('2026-10-30T18:00:00.000Z'),
  });
  assert.equal(result.wakes.length, 1);
  assert.equal(result.wakes[0].message, 5);
  assert.equal(result.wakes[0].outcome, 'ok');
  assert.equal(result.wakes[0].room, 'room0001');
  const recorded = JSON.parse(fs.readFileSync(record, 'utf8'));
  const cmdline = recorded.argv.join('\n');
  assert.match(cmdline, /since message 4/);
  assert.equal(cmdline.includes(MARKER), false);
  assert.equal(cmdline.includes(TOKEN), false);
  assert.equal(JSON.stringify(recorded.env).includes(MARKER), false);
  assert.equal(JSON.stringify(recorded.env).includes(TOKEN), false);
  const dumped = filesExceptUrl(env.dir);
  assert.equal(dumped.includes(MARKER), false);
  assert.equal(dumped.includes(TOKEN), false);
  assert.equal(dumped.includes('RUNNER-STDOUT-MARKER'), false);
  assert.equal(JSON.stringify(result).includes(MARKER), false);
  const reads = env.world.calls.filter((call) => call.name === 'read_room');
  assert.deepEqual(reads.map((call) => call.since), [0]);
  assert.equal(env.world.calls.some((call) => call.name === 'post_message'), false);
});

test('the cursor stays on a hit the cap or the interval will not answer yet', async (t) => {
  const messages = [at(1, 'human:ada', 'hello'), at(2, 'human:ada', '@Izzy hello')];
  const env = await scaffold(t, {
    messages,
    state: { wakes: { day: '2026-10-30', count: 20, lastAt: '2026-10-30T11:00:00.000Z' }, rooms: {} },
  });
  const now = new Date('2026-10-30T12:00:00.000Z');
  const config = baseConfig();
  const first = await pass({ stateDir: env.dir, config, now: () => now });
  assert.equal(first.wakes.length, 0);
  assert.equal(first.pending[0].reason, 'cap');
  assert.equal(first.pending[0].message, 2);
  const state = JSON.parse(fs.readFileSync(path.join(env.dir, 'state.json'), 'utf8'));
  assert.equal(state.rooms.room0001.cursor, 1);
  const second = await pass({ stateDir: env.dir, config, now: () => now });
  assert.equal(second.wakes.length, 0);
  const lines = fs.readFileSync(path.join(env.dir, 'wakes.jsonl'), 'utf8').trim().split('\n');
  assert.equal(lines.filter((line) => JSON.parse(line).event === 'cap').length, 1);
  const since = env.world.calls.filter((call) => call.name === 'read_room').map((call) => call.since);
  assert.deepEqual(since, [0, 1]);
});

test('nineteen wakes still leave room for one more, and the next day the cap lifts', async (t) => {
  const env = await scaffold(t, {
    messages: [at(3, 'human:ada', '@Izzy one')],
    state: { wakes: { day: '2026-10-30', count: 19, lastAt: '2026-10-29T11:00:00.000Z' }, rooms: { room0001: { cursor: 0, authors: [] } } },
  });
  const allowed = await pass({
    stateDir: env.dir,
    config: baseConfig(),
    now: () => new Date('2026-10-30T12:00:00.000Z'),
  });
  assert.equal(allowed.wakes.length, 1);
  env.world.read = ({ since }) => roomText([at(4, 'human:ada', '@Izzy two')], since);
  const blocked = await pass({
    stateDir: env.dir,
    config: baseConfig(),
    now: () => new Date('2026-10-30T13:00:00.000Z'),
  });
  assert.equal(blocked.pending[0].reason, 'cap');
  const nextDay = await pass({
    stateDir: env.dir,
    config: baseConfig(),
    now: () => new Date('2026-10-31T00:10:00.000Z'),
  });
  assert.equal(nextDay.wakes.length, 1);
  assert.equal(nextDay.wakes[0].message, 4);
});

test('a recent wake keeps the next hit pending until the interval passes', async (t) => {
  const env = await scaffold(t, {
    messages: [at(2, 'human:ada', '@Izzy soon')],
    state: { wakes: { day: '2026-10-30', count: 1, lastAt: '2026-10-30T12:00:00.000Z' }, rooms: {} },
  });
  const config = baseConfig({ minIntervalSeconds: 120 });
  const early = await pass({ stateDir: env.dir, config, now: () => new Date('2026-10-30T12:00:30.000Z') });
  assert.equal(early.pending[0].reason, 'interval');
  assert.equal(early.wakes.length, 0);
  const state = JSON.parse(fs.readFileSync(path.join(env.dir, 'state.json'), 'utf8'));
  assert.equal(state.rooms.room0001.cursor, 0);
  const later = await pass({ stateDir: env.dir, config, now: () => new Date('2026-10-30T12:02:01.000Z') });
  assert.equal(later.wakes.length, 1);
});

test('the kill switch is checked before every wake and holds the hit', async (t) => {
  const script = path.join(os.tmpdir(), `seed-watcher-off-${process.pid}.mjs`);
  fs.writeFileSync(script, `import fs from 'node:fs';
fs.writeFileSync(process.argv[2], '{"enabled":false}\\n');
`);
  t.after(() => fs.rmSync(script, { force: true }));
  const env = await scaffold(t, {
    messages: [at(1, 'human:ada', '@Izzy first'), at(2, 'human:ada', '@Izzy second')],
  });
  const first = await pass({
    stateDir: env.dir,
    config: baseConfig({ command: [process.execPath, script, path.join(env.dir, 'switch.json')] }),
    now: () => new Date('2026-10-30T12:00:00.000Z'),
  });
  assert.equal(first.wakes.length, 1);
  assert.equal(first.pending[0].reason, 'off');
  assert.equal(first.pending[0].message, 2);
  const held = JSON.parse(fs.readFileSync(path.join(env.dir, 'state.json'), 'utf8'));
  assert.equal(held.rooms.room0001.cursor, 1);
  setEnabled(env.dir, true);
  const second = await pass({
    stateDir: env.dir,
    config: baseConfig(),
    now: () => new Date('2026-10-30T12:05:00.000Z'),
  });
  assert.equal(second.wakes.length, 1);
  assert.equal(second.wakes[0].message, 2);
});

test('off keeps a hit pending, and a closed room is not read', async (t) => {
  const env = await scaffold(t, {
    messages: [at(1, 'human:ada', '@Izzy hello')],
    rooms: [
      { title: 'The test room', id: 'room0001', detail: 'admitted: you can read and post', publicBase: 'http://127.0.0.1:4400' },
      { title: 'Closed room', id: 'room0002', detail: 'not admitted yet', publicBase: 'http://127.0.0.1:4400' },
    ],
  });
  setEnabled(env.dir, false);
  const held = await pass({ stateDir: env.dir, config: baseConfig(), now: () => new Date('2026-10-30T12:00:00.000Z') });
  assert.equal(held.wakes.length, 0);
  assert.equal(held.pending[0].reason, 'off');
  assert.equal(env.world.calls.filter((call) => call.name === 'read_room').length, 1);
  assert.equal(env.world.calls.find((call) => call.name === 'read_room').room, 'room0001');
});

test('own posts and @Izzybel do not wake, and a later @Izzy does', async (t) => {
  const env = await scaffold(t, {
    messages: [
      at(1, 'ai:izzy', '@Izzy I already spoke'),
      at(2, 'human:ada', '@Izzybel is a different name'),
      at(3, 'human:ada', 'ping @Izzy now'),
    ],
  });
  const result = await pass({ stateDir: env.dir, config: baseConfig(), now: () => new Date('2026-10-30T12:00:00.000Z') });
  assert.equal(result.wakes.length, 1);
  assert.equal(result.wakes[0].message, 3);
  const promptCursor = result.wakes[0];
  assert.equal(promptCursor.message, 3);
  const state = JSON.parse(fs.readFileSync(path.join(env.dir, 'state.json'), 'utf8'));
  assert.equal(state.rooms.room0001.cursor, 3);
});

test('the loop breaker stays quiet after two AI turns and still answers a person', async (t) => {
  const env = await scaffold(t, {
    messages: [
      at(1, 'ai:claude', 'first'),
      at(2, 'ai:other', 'second'),
      at(3, 'ai:third', '@Izzy join us'),
    ],
  });
  const quiet = await pass({ stateDir: env.dir, config: baseConfig(), now: () => new Date('2026-10-30T12:00:00.000Z') });
  assert.equal(quiet.wakes.length, 0);
  const state = JSON.parse(fs.readFileSync(path.join(env.dir, 'state.json'), 'utf8'));
  assert.equal(state.rooms.room0001.cursor, 3);
  env.world.read = ({ since }) => roomText([
    at(1, 'ai:claude', 'first'),
    at(2, 'ai:other', '@Izzy second is still allowed'),
    at(3, 'human:ada', '@Izzy a person'),
  ], since);
  saveState(env.dir, { rooms: { room0001: { cursor: 0, authors: [] } }, wakes: { day: '2026-10-30', count: 1, lastAt: '2026-10-30T11:00:00.000Z' } });
  const answered = await pass({
    stateDir: env.dir,
    config: baseConfig({ minIntervalSeconds: 0 }),
    now: () => new Date('2026-10-30T12:10:00.000Z'),
  });
  assert.equal(answered.wakes[0].message, 2);
});

test('a runner failure is logged, counts toward the cap, and does not crash the pass', async (t) => {
  const env = await scaffold(t, {
    messages: [at(1, 'human:ada', '@Izzy one'), at(2, 'human:ada', '@Izzy two')],
  });
  const result = await pass({
    stateDir: env.dir,
    config: baseConfig({ command: [process.execPath, '-e', 'process.exit(1)'], dailyCap: 1 }),
    now: () => new Date('2026-10-30T12:00:00.000Z'),
  });
  assert.equal(result.wakes.length, 1);
  assert.equal(result.wakes[0].outcome, 'error');
  assert.equal(result.pending[0].reason, 'cap');
  assert.equal(result.pending[0].message, 2);
  const state = JSON.parse(fs.readFileSync(path.join(env.dir, 'state.json'), 'utf8'));
  assert.equal(state.wakes.count, 1);
  assert.equal(state.rooms.room0001.cursor, 1);
});

test('a page that names the AI is not a message', async (t) => {
  const env = await scaffold(t, { messages: [at(1, 'human:ada', 'no name here')] });
  env.world.read = ({ since }) => roomText([at(1, 'human:ada', 'no name here')], since, `@Izzy ${MARKER}`);
  const result = await pass({ stateDir: env.dir, config: baseConfig(), now: () => new Date('2026-10-30T12:00:00.000Z') });
  assert.equal(result.wakes.length, 0);
  assert.equal(filesExceptUrl(env.dir).includes(MARKER), false);
  const state = JSON.parse(fs.readFileSync(path.join(env.dir, 'state.json'), 'utf8'));
  assert.equal(state.rooms.room0001.cursor, 1);
});

test('two passes cannot overlap, and a dead lock does not stick', async (t) => {
  const env = await scaffold(t, { messages: [at(1, 'human:ada', '@Izzy hello')] });
  const sleeper = spawn('sleep', ['30'], { stdio: 'ignore' });
  t.after(() => { if (!sleeper.killed) sleeper.kill(); });
  fs.writeFileSync(path.join(env.dir, 'lock'), String(sleeper.pid), { mode: 0o600 });
  const busy = await pass({ stateDir: env.dir, config: baseConfig(), now: () => new Date('2026-10-30T12:00:00.000Z') });
  assert.equal(busy.skipped, 'locked');
  assert.equal(env.world.calls.length, 0);
  sleeper.kill();
  await new Promise((resolve) => sleeper.on('close', resolve));
  const stalePid = sleeper.pid;
  fs.writeFileSync(path.join(env.dir, 'lock'), String(stalePid), { mode: 0o600 });
  const again = await pass({ stateDir: env.dir, config: baseConfig(), now: () => new Date('2026-10-30T12:00:00.000Z') });
  assert.equal(again.wakes.length, 1);
  assert.equal(fs.existsSync(path.join(env.dir, 'lock')), false);
});

test('the state directory is private to the owner', async (t) => {
  const env = await scaffold(t, { messages: [] });
  await pass({ stateDir: env.dir, config: baseConfig(), now: () => new Date('2026-10-30T12:00:00.000Z') });
  assert.equal(fs.statSync(env.dir).mode & 0o077, 0);
});

test('a group- or world-readable door URL file is refused and never echoed', async (t) => {
  const env = await scaffold(t, { urlToken: true, messages: [at(1, 'human:ada', '@Izzy hi')] });
  for (const mode of [0o644, 0o640, 0o660]) {
    fs.chmodSync(env.urlFile, mode);
    const result = await pass({ stateDir: env.dir, config: baseConfig(), now: () => new Date('2026-10-30T12:00:00.000Z') });
    assert.match(result.error, /mode 600/);
    assert.equal(result.error.includes(TOKEN), false);
    assert.equal(env.world.calls.length, 0);
  }
  fs.chmodSync(env.urlFile, 0o600);
});

test('a fetch error loses the door URL before it is returned or logged', async (t) => {
  const env = await scaffold(t, { urlToken: true });
  const secret = `http://127.0.0.1:9/d/${TOKEN}/mcp`;
  const result = await pass({
    stateDir: env.dir,
    urlFile: env.urlFile,
    config: baseConfig(),
    connect: async () => { throw new Error(`connect ECONNREFUSED ${secret}`); },
  });
  assert.equal(result.error.includes(TOKEN), false);
  assert.equal(result.error.includes('127.0.0.1:9'), false);
  assert.match(result.error, /redacted/);
  assert.equal(filesExceptUrl(env.dir).includes(TOKEN), false);
  const scrubbed = scrubText(`failed ${secret}`, secret);
  assert.equal(scrubbed.includes(TOKEN), false);
});

test('run waits the configured poll and holds the lock across passes', async (t) => {
  const env = await scaffold(t, { messages: [] });
  const delays = [];
  let releaseSleep;
  const looping = runLoop({
    stateDir: env.dir,
    config: baseConfig({ pollSeconds: 60 }),
    maxPasses: 2,
    sleep: (ms) => {
      delays.push(ms);
      return new Promise((resolve) => { releaseSleep = resolve; });
    },
  });
  const started = Date.now();
  while (!releaseSleep) {
    if (Date.now() - started > 5000) throw new Error('the loop did not reach its pause');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  const outside = await pass({ stateDir: env.dir, config: baseConfig() });
  assert.equal(outside.skipped, 'locked');
  releaseSleep();
  const done = await looping;
  assert.equal(done.passes, 2);
  assert.deepEqual(delays, [60000]);
});

test('the command line tools refuse a loose URL file and do not print it', async (t) => {
  const env = await scaffold(t, { urlToken: true });
  fs.chmodSync(env.urlFile, 0o644);
  fs.writeFileSync(path.join(env.dir, 'config.json'), JSON.stringify(baseConfig()));
  const child = spawn(process.execPath, [BIN, 'once', '--state', env.dir], { stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk) => { stdout += chunk; });
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  const code = await new Promise((resolve) => child.on('close', resolve));
  assert.notEqual(code, 0);
  assert.equal(`${stdout}\n${stderr}`.includes(TOKEN), false);
  assert.match(stderr, /mode 600/);
  const off = spawn(process.execPath, [BIN, 'off', '--state', env.dir]);
  const offCode = await new Promise((resolve) => off.on('close', resolve));
  assert.equal(offCode, 0);
  const status = spawn(process.execPath, [BIN, 'status', '--state', env.dir], { stdio: ['ignore', 'pipe', 'pipe'] });
  let statusOut = '';
  status.stdout.on('data', (chunk) => { statusOut += chunk; });
  const statusCode = await new Promise((resolve) => status.on('close', resolve));
  assert.equal(statusCode, 0);
  assert.match(statusOut, /The watcher is off/);
  assert.equal(statusOut.includes(TOKEN), false);
  assert.equal(statusOut.includes(MARKER), false);
});

test('acquireLock and releaseLock agree on the owner', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'seed-watcher-lock-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  assert.equal(acquireLock(dir), true);
  assert.equal(acquireLock(dir), false);
  releaseLock(dir);
  assert.equal(fs.existsSync(path.join(dir, 'lock')), false);
});
