// Runner and launchd tests. The programs and Chrome are fakes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { installLaunchd, wakePrompt } from '../lib.mjs';
import {
  measureIdleSeconds, parseHidIdleSeconds, pmsetSaysBusy, rollThread, runRunner, typeFixedLine,
} from '../runners.mjs';

const TOKEN = 'SuperSecretDoorToken123';
const DOOR = `http://127.0.0.1:9/d/${TOKEN}/mcp`;
const PROMPT = wakePrompt('The test room', 4);

function tempDir(name) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), name));
  return dir;
}

test('claude is limited to the door, and the mcp file is private and removed', async () => {
  let seen;
  const result = await runRunner({
    config: { runner: 'claude', bin: process.execPath },
    prompt: PROMPT,
    doorUrl: DOOR,
    spawn: async (bin, args) => {
      const file = args[args.indexOf('--mcp-config') + 1];
      seen = { args, mode: fs.statSync(file).mode & 0o777, body: fs.readFileSync(file, 'utf8'), file };
      return { code: 0, stdout: '', stderr: '' };
    },
  });
  assert.equal(result.outcome, 'ok');
  assert.equal(seen.mode, 0o600);
  assert.equal(fs.existsSync(seen.file), false);
  assert.match(seen.body, new RegExp(TOKEN));
  assert.equal(seen.args.join('\n').includes(TOKEN), false);
  assert.match(seen.args.join('\n'), /--strict-mcp-config/);
  assert.match(seen.args.join('\n'), /--sandbox|read-only|strict/);
  const allowed = seen.args[seen.args.indexOf('--allowedTools') + 1];
  assert.match(allowed, /mcp__room__door_status/);
  assert.match(allowed, /mcp__room__post_message/);
  assert.doesNotMatch(allowed, /(^|,)(Read|Write|Edit|Bash)(,|$)/);
  assert.equal(seen.body.includes('MARKER-ROOM-TEXT-9f3a'), false);
});

test('a claude failure still deletes the mcp file', async () => {
  let file;
  const result = await runRunner({
    config: { runner: 'claude', bin: process.execPath },
    prompt: PROMPT,
    doorUrl: DOOR,
    spawn: async (bin, args) => {
      file = args[args.indexOf('--mcp-config') + 1];
      throw new Error(`boom ${DOOR}`);
    },
  });
  assert.equal(result.outcome, 'error');
  assert.equal(JSON.stringify(result).includes(TOKEN), false);
  assert.equal(fs.existsSync(file), false);
});

test('codex uses a temporary home, resumes a thread, and then starts fresh', async () => {
  const home = tempDir('seed-watcher-user-');
  const codexDir = path.join(home, '.codex');
  fs.mkdirSync(codexDir, { recursive: true });
  const userConfig = path.join(codexDir, 'config.toml');
  const userAuth = path.join(codexDir, 'auth.json');
  fs.writeFileSync(userConfig, 'SENTINEL-DO-NOT-TOUCH\n');
  fs.writeFileSync(userAuth, '{"token":"SECRET-AUTH"}\n');
  const seen = [];
  const spawn = async (bin, args, opts) => {
    const dir = opts.env.CODEX_HOME;
    const auth = fs.lstatSync(path.join(dir, 'auth.json'));
    seen.push({
      args,
      dir,
      toml: fs.readFileSync(path.join(dir, 'config.toml'), 'utf8'),
      mode: fs.statSync(path.join(dir, 'config.toml')).mode & 0o777,
      link: auth.isSymbolicLink() ? fs.readlinkSync(path.join(dir, 'auth.json')) : '',
    });
    return { code: 0, stdout: '{"thread_id":"threadabc1"}\n', stderr: '' };
  };
  const config = { runner: 'codex', bin: process.execPath, freshThreadAfter: 2 };
  const first = await runRunner({ config, prompt: PROMPT, doorUrl: DOOR, spawn, homeDir: home });
  assert.equal(first.outcome, 'ok');
  assert.equal(first.thread.id, 'threadabc1');
  assert.equal(first.thread.runs, 1);
  assert.equal(seen[0].args.includes('resume'), false);
  assert.deepEqual(seen[0].args.slice(0, 3), ['exec', '--sandbox', 'read-only']);
  assert.match(seen[0].toml, /default_tools_approval_mode = "approve"/);
  assert.match(seen[0].toml, new RegExp(TOKEN));
  assert.equal(seen[0].mode, 0o600);
  assert.equal(seen[0].link, userAuth);
  assert.notEqual(seen[0].dir, codexDir);
  assert.equal(fs.existsSync(seen[0].dir), false);
  assert.equal(seen[0].args.join('\n').includes(TOKEN), false);
  const second = await runRunner({ config, prompt: PROMPT, doorUrl: DOOR, spawn, homeDir: home, thread: first.thread });
  assert.equal(second.thread.id, null);
  assert.ok(seen[1].args.includes('resume'));
  assert.ok(seen[1].args.includes('threadabc1'));
  const third = await runRunner({ config, prompt: PROMPT, doorUrl: DOOR, spawn, homeDir: home, thread: second.thread });
  assert.equal(third.thread.runs, 1);
  assert.equal(seen[2].args.includes('resume'), false);
  assert.equal(fs.readFileSync(userConfig, 'utf8'), 'SENTINEL-DO-NOT-TOUCH\n');
  assert.equal(fs.readFileSync(userAuth, 'utf8'), '{"token":"SECRET-AUTH"}\n');
  fs.rmSync(home, { recursive: true, force: true });
});

test('codex refuses to run without auth.json and does not write the user config', async () => {
  const home = tempDir('seed-watcher-noauth-');
  fs.mkdirSync(path.join(home, '.codex'), { recursive: true });
  const userConfig = path.join(home, '.codex', 'config.toml');
  fs.writeFileSync(userConfig, 'SENTINEL-DO-NOT-TOUCH\n');
  let spawned = false;
  const result = await runRunner({
    config: { runner: 'codex', bin: process.execPath },
    prompt: PROMPT,
    doorUrl: DOOR,
    homeDir: home,
    spawn: async () => { spawned = true; return { code: 0, stdout: '', stderr: '' }; },
  });
  assert.equal(result.outcome, 'error');
  assert.equal(spawned, false);
  assert.equal(fs.readFileSync(userConfig, 'utf8'), 'SENTINEL-DO-NOT-TOUCH\n');
  fs.rmSync(home, { recursive: true, force: true });
});

test('thread accounting drops the thread after the limit', () => {
  assert.deepEqual(rollThread(null, { resumed: false, printedId: 'threadabc1', limit: 20 }), { id: 'threadabc1', runs: 1 });
  assert.deepEqual(rollThread({ id: 'threadabc1', runs: 18 }, { resumed: true, printedId: null, limit: 20 }), { id: 'threadabc1', runs: 19 });
  assert.equal(rollThread({ id: 'threadabc1', runs: 19 }, { resumed: true, printedId: 'threadabc1', limit: 20 }).id, null);
});

test('idle time comes from HIDIdleTime, and pmset marks the person busy', async () => {
  const sample = '"HIDIdleTime" = 120000000000';
  assert.equal(parseHidIdleSeconds(sample), 120);
  assert.equal(parseHidIdleSeconds('no idle here'), null);
  assert.equal(pmsetSaysBusy('PreventUserIdleSystemSleep named: "coreaudiod"'), true);
  const idle = await measureIdleSeconds(async (bin) => (bin === 'ioreg' ? sample : ''));
  assert.equal(idle, 120);
  const busy = await measureIdleSeconds(async (bin) => (bin === 'pmset' ? 'PreventUserIdleDisplaySleep' : ''));
  assert.equal(busy, 0);
  const unknown = await measureIdleSeconds(async () => { throw new Error('missing'); });
  assert.equal(unknown, null);
});

test('chatgpt nudge types only the fixed line, and only when opted in and idle', async () => {
  const calls = [];
  const cdp = async ({ port, line }) => { calls.push({ port, line }); };
  const off = await runRunner({
    config: { runner: 'chatgpt-nudge', chatgptNudge: false },
    prompt: PROMPT,
    cdp,
    exec: async () => { throw new Error('should not run'); },
  });
  assert.equal(off.outcome, 'disabled');
  assert.equal(calls.length, 0);
  const active = await runRunner({
    config: { runner: 'chatgpt-nudge', chatgptNudge: true, idleSeconds: 60, cdpPort: 9333 },
    prompt: PROMPT,
    cdp,
    exec: async () => '"HIDIdleTime" = 1000000000',
  });
  assert.equal(active.outcome, 'skipped-not-idle');
  assert.equal(calls.length, 0);
  const ready = await runRunner({
    config: { runner: 'chatgpt-nudge', chatgptNudge: true, idleSeconds: 60, cdpPort: 9333 },
    prompt: PROMPT,
    cdp,
    exec: async () => '"HIDIdleTime" = 120000000000',
  });
  assert.equal(ready.outcome, 'ok');
  assert.deepEqual(calls, [{ port: 9333, line: PROMPT }]);
  assert.equal(PROMPT.includes('MARKER-ROOM-TEXT-9f3a'), false);
});

test('the debugging client sends the fixed line and refuses a socket that is not local', async () => {
  const sent = [];
  class FakeSocket {
    constructor(url) {
      this.url = url;
      this.listeners = {};
      queueMicrotask(() => this.emit('open'));
    }
    addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); }
    emit(type, ev) { for (const fn of this.listeners[type] || []) fn(ev); }
    send(data) {
      const msg = JSON.parse(data);
      sent.push(msg);
      queueMicrotask(() => {
        const result = msg.method === 'Runtime.evaluate' ? { result: { value: true } } : {};
        this.emit('message', { data: JSON.stringify({ id: msg.id, result }) });
      });
    }
    close() {}
  }
  let fetched = '';
  await typeFixedLine({
    port: 9222,
    line: PROMPT,
    WebSocketImpl: FakeSocket,
    fetchImpl: async (url) => {
      fetched = url;
      return { ok: true, json: async () => [{ url: 'https://chatgpt.com/c/room', webSocketDebuggerUrl: 'ws://127.0.0.1:9222/devtools/page/ABC' }] };
    },
  });
  assert.equal(fetched, 'http://127.0.0.1:9222/json/list');
  const insert = sent.find((msg) => msg.method === 'Input.insertText');
  assert.equal(insert.params.text, PROMPT);
  assert.equal(sent.some((msg) => JSON.stringify(msg).includes('MARKER-ROOM-TEXT-9f3a')), false);
  const expression = sent.find((msg) => msg.method === 'Runtime.evaluate').params.expression;
  assert.equal(expression.includes(PROMPT), false);
  await assert.rejects(() => typeFixedLine({
    port: 9222,
    line: PROMPT,
    WebSocketImpl: FakeSocket,
    fetchImpl: async () => ({ ok: true, json: async () => [{ url: 'https://chatgpt.com/c/room', webSocketDebuggerUrl: 'ws://evil.example/devtools/page/1' }] }),
  }), /not local/);
});

test('install-launchd writes the job and loads it only with --load', async () => {
  const stateDir = tempDir('seed-watcher-state-');
  const agentsDir = tempDir('seed-watcher-agents-');
  fs.writeFileSync(path.join(stateDir, 'door.url'), `http://127.0.0.1/d/${TOKEN}/mcp\n`);
  const loads = [];
  const plist = await installLaunchd({
    stateDir,
    agentsDir,
    nodePath: '/usr/local/bin/node',
    scriptPath: '/opt/watcher/bin/seed-watcher.mjs',
    load: false,
    launchctl: async (file) => { loads.push(file); },
  });
  assert.equal(loads.length, 0);
  assert.equal(plist, path.join(agentsDir, 'com.communityseed.watcher.plist'));
  const body = fs.readFileSync(plist, 'utf8');
  assert.doesNotMatch(body, /AbandonProcessGroup/);
  assert.match(body, /<key>StartInterval<\/key>\s*<integer>60<\/integer>/);
  assert.match(body, /<key>StandardOutPath<\/key>/);
  assert.match(body, /<key>StandardErrorPath<\/key>/);
  assert.match(body, /<string>\/usr\/local\/bin\/node<\/string>/);
  assert.match(body, /<string>once<\/string>/);
  assert.equal(body.includes(TOKEN), false);
  assert.equal(path.isAbsolute(body.match(/<key>StandardOutPath<\/key>\s*<string>([^<]+)<\/string>/)[1]), true);
  await installLaunchd({
    stateDir,
    agentsDir,
    nodePath: '/usr/local/bin/node',
    scriptPath: '/opt/watcher/bin/seed-watcher.mjs',
    load: true,
    launchctl: async (file) => { loads.push(file); },
  });
  assert.deepEqual(loads, [plist]);
  fs.rmSync(stateDir, { recursive: true, force: true });
  fs.rmSync(agentsDir, { recursive: true, force: true });
});

test('rollThread ignores a printed blob that is not an id', () => {
  assert.equal(rollThread(null, { resumed: false, printedId: null, limit: 20 }).id, null);
});
