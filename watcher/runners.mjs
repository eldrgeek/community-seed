// How the watcher wakes an AI the neighbor already pays for.
// The prompt it receives is fixed. This file never reads the room.
//
// Written 2026-10-30 by Cursor Grok 4.7 (seat cursor-worker) for Mike Wolf. Bead es-29wz.

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const DOOR_TOOLS = [
  'mcp__room__door_status',
  'mcp__room__read_room',
  'mcp__room__post_message',
  'mcp__room__submit_skill',
  'mcp__room__get_skill_draft',
  'mcp__room__list_seed_skills',
  'mcp__room__get_seed_skill',
];

export function assertAbsolute(bin, label) {
  if (!bin || !path.isAbsolute(bin)) {
    throw new Error(`The ${label} program must be an absolute path. A scheduled job has no shell search path.`);
  }
}

export function spawnProcess(bin, args, { env = process.env, timeoutMs = 10 * 60 * 1000 } = {}) {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(bin, args, { env, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch {
      resolve({ code: 127, stdout: '', stderr: '' });
      return;
    }
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => { child.kill('SIGKILL'); }, timeoutMs);
    child.stdout.on('data', (d) => { stdout += d; if (stdout.length > 200000) stdout = stdout.slice(-100000); });
    child.stderr.on('data', (d) => { stderr += d; if (stderr.length > 200000) stderr = stderr.slice(-100000); });
    child.on('error', () => { clearTimeout(timer); resolve({ code: 127, stdout, stderr: '' }); });
    child.on('close', (code) => { clearTimeout(timer); resolve({ code: code ?? 1, stdout, stderr: '' }); });
  });
}

function tomlBasic(value) {
  return `"${String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

export function parseThreadId(text) {
  const raw = String(text || '');
  const patterns = [
    /"thread_id"\s*:\s*"([A-Za-z0-9_-]{6,80})"/,
    /"threadId"\s*:\s*"([A-Za-z0-9_-]{6,80})"/,
    /thread[_ ]id:\s*([A-Za-z0-9_-]{6,80})/i,
  ];
  for (const pattern of patterns) {
    const match = raw.match(pattern);
    if (match) return match[1];
  }
  return null;
}

// After `limit` runs the stored thread is dropped. Resumed context grows
// (about 87k input tokens per run was measured), so the next wake starts fresh.
export function rollThread(previous, { resumed, printedId, limit }) {
  if (!resumed) {
    if (!printedId) return { id: null, runs: 0 };
    return { id: printedId, runs: 1 };
  }
  const runs = (previous?.runs || 0) + 1;
  if (runs >= limit) return { id: null, runs: 0 };
  return { id: printedId || previous?.id || null, runs };
}

export function claudeInvocation(bin, prompt, mcpFile) {
  assertAbsolute(bin, 'claude');
  return {
    bin,
    args: [
      '-p', prompt,
      '--mcp-config', mcpFile,
      '--strict-mcp-config',
      '--allowedTools', DOOR_TOOLS.join(','),
    ],
  };
}

export function codexInvocation(bin, prompt, threadId) {
  assertAbsolute(bin, 'codex');
  const args = threadId
    ? ['exec', 'resume', threadId, '--sandbox', 'read-only', prompt]
    : ['exec', '--sandbox', 'read-only', prompt];
  return { bin, args };
}

function writePrivate(file, contents) {
  fs.writeFileSync(file, contents, { mode: 0o600 });
  fs.chmodSync(file, 0o600);
}

function removeDir(dir) {
  if (dir) fs.rmSync(dir, { recursive: true, force: true });
}

async function runClaude(ctx) {
  const bin = ctx.config.bin;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'seed-watcher-claude-'));
  fs.chmodSync(dir, 0o700);
  const mcpFile = path.join(dir, 'mcp.json');
  try {
    writePrivate(mcpFile, JSON.stringify({
      mcpServers: { room: { type: 'http', url: ctx.doorUrl } },
    }, null, 2) + '\n');
    const call = claudeInvocation(bin, ctx.prompt, mcpFile);
    const spawn = ctx.spawn || spawnProcess;
    const result = await spawn(call.bin, call.args, { env: process.env, timeoutMs: ctx.config.runnerTimeoutMs });
    return { outcome: result?.code === 0 ? 'ok' : 'error' };
  } catch {
    return { outcome: 'error' };
  } finally {
    removeDir(dir);
  }
}

async function runCodex(ctx) {
  const bin = ctx.config.bin;
  const limit = ctx.config.freshThreadAfter ?? 20;
  const previous = ctx.thread?.id && (ctx.thread.runs || 0) < limit ? ctx.thread : null;
  const userHome = ctx.homeDir || os.homedir();
  const authSource = path.join(userHome, '.codex', 'auth.json');
  if (!fs.existsSync(authSource)) {
    return { outcome: 'error', thread: previous };
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'seed-watcher-codex-'));
  fs.chmodSync(dir, 0o700);
  try {
    fs.symlinkSync(authSource, path.join(dir, 'auth.json'));
    writePrivate(path.join(dir, 'config.toml'), [
      'default_tools_approval_mode = "approve"',
      '',
      '[mcp_servers.room]',
      `url = ${tomlBasic(ctx.doorUrl)}`,
      '',
    ].join('\n'));
    const call = codexInvocation(bin, ctx.prompt, previous?.id || null);
    const env = { ...process.env, CODEX_HOME: dir };
    const spawn = ctx.spawn || spawnProcess;
    const result = await spawn(call.bin, call.args, { env, timeoutMs: ctx.config.runnerTimeoutMs });
    const printedId = parseThreadId(`${result?.stdout || ''}\n${result?.stderr || ''}`);
    const thread = rollThread(previous, { resumed: !!previous, printedId, limit });
    return { outcome: result?.code === 0 ? 'ok' : 'error', thread };
  } catch {
    return { outcome: 'error', thread: previous };
  } finally {
    removeDir(dir);
  }
}

async function runCommand(ctx) {
  const command = ctx.config.command;
  if (!Array.isArray(command) || command.length === 0) {
    throw new Error('The command runner needs a command array, and the program must be an absolute path.');
  }
  assertAbsolute(command[0], 'command');
  const spawn = ctx.spawn || spawnProcess;
  const result = await spawn(command[0], [...command.slice(1), ctx.prompt], {
    env: process.env,
    timeoutMs: ctx.config.runnerTimeoutMs,
  });
  return { outcome: result.code === 0 ? 'ok' : 'error' };
}

export function parseHidIdleSeconds(text) {
  const match = String(text || '').match(/HIDIdleTime"?\s*=\s*(\d+)/);
  if (!match) return null;
  const seconds = Number(match[1]) / 1e9;
  return Number.isFinite(seconds) ? seconds : null;
}

export function pmsetSaysBusy(text) {
  return /PreventUserIdle|UserIsActive/i.test(String(text || ''));
}

export async function measureIdleSeconds(exec) {
  try {
    const ioreg = await exec('ioreg', ['-c', 'IOHIDSystem', '-r']);
    const seconds = parseHidIdleSeconds(ioreg);
    if (seconds != null) return seconds;
  } catch { /* try pmset */ }
  try {
    const pmset = await exec('pmset', ['-g', 'assertions']);
    if (pmsetSaysBusy(pmset)) return 0;
  } catch { /* unknown */ }
  return null;
}

export async function typeFixedLine({ port, line, fetchImpl = globalThis.fetch, WebSocketImpl = globalThis.WebSocket }) {
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('The Chrome debugging port must be a local port number.');
  }
  const res = await fetchImpl(`http://127.0.0.1:${port}/json/list`);
  if (!res.ok) throw new Error('Chrome debugging did not answer on the local port.');
  const tabs = await res.json();
  const tab = (Array.isArray(tabs) ? tabs : []).find((t) => (
    typeof t?.url === 'string' && /^https:\/\/chatgpt\.com\//.test(t.url) && t.webSocketDebuggerUrl
  ));
  if (!tab) throw new Error('No ChatGPT tab was open on the local debugging port.');
  const socket = new URL(tab.webSocketDebuggerUrl);
  if (socket.hostname !== '127.0.0.1' && socket.hostname !== 'localhost') {
    throw new Error('The debugging socket is not local.');
  }
  if (typeof WebSocketImpl !== 'function') throw new Error('This Node has no WebSocket client.');
  const ws = new WebSocketImpl(socket.href);
  const waiters = new Map();
  let seq = 0;
  ws.addEventListener('message', (ev) => {
    let msg;
    try { msg = JSON.parse(ev.data); } catch { return; }
    const done = waiters.get(msg.id);
    if (!done) return;
    waiters.delete(msg.id);
    done(msg);
  });
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve);
    ws.addEventListener('error', () => reject(new Error('Chrome debugging did not connect.')));
  });
  const call = (method, params) => new Promise((resolve, reject) => {
    const id = ++seq;
    const timer = setTimeout(() => reject(new Error('Chrome debugging timed out.')), 10000);
    waiters.set(id, (msg) => {
      clearTimeout(timer);
      if (msg.error) reject(new Error('Chrome debugging rejected a command.'));
      else resolve(msg.result);
    });
    ws.send(JSON.stringify({ id, method, params }));
  });
  try {
    const focused = await call('Runtime.evaluate', {
      expression: `(() => {
        const el = document.querySelector('#prompt-textarea, textarea, [contenteditable="true"]');
        if (!el) return false;
        el.focus();
        return true;
      })()`,
      returnByValue: true,
    });
    if (!focused?.result?.value) throw new Error('The ChatGPT box was not found.');
    await call('Input.insertText', { text: line });
    const enter = { key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 };
    await call('Input.dispatchKeyEvent', { type: 'keyDown', ...enter });
    await call('Input.dispatchKeyEvent', { type: 'keyUp', ...enter });
  } finally {
    try { ws.close(); } catch { /* already closed */ }
  }
}

async function runChatGptNudge(ctx) {
  if (ctx.config.chatgptNudge !== true) return { outcome: 'disabled' };
  const exec = ctx.exec || (async (bin, args) => {
    const result = await spawnProcess(bin, args, { timeoutMs: 5000 });
    return result.stdout || '';
  });
  const idle = await measureIdleSeconds(exec);
  const need = ctx.config.idleSeconds ?? 60;
  if (!(typeof idle === 'number' && idle >= need)) return { outcome: 'skipped-not-idle' };
  const cdp = ctx.cdp || (({ port, line }) => typeFixedLine({ port, line }));
  await cdp({ port: ctx.config.cdpPort ?? 9222, line: ctx.prompt });
  return { outcome: 'ok' };
}

export async function runRunner(ctx) {
  const runner = ctx.config.runner;
  if (runner === 'claude') return runClaude(ctx);
  if (runner === 'codex') return runCodex(ctx);
  if (runner === 'command') return runCommand(ctx);
  if (runner === 'chatgpt-nudge') return runChatGptNudge(ctx);
  throw new Error('The config runner must be claude, codex, command, or chatgpt-nudge.');
}
