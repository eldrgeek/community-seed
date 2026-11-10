import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { WAKE_DAILY_CAP, awayFrame, chatPageUrl, mayOpenWakeTab, receiveAddressed, takePending, validateChatUrl, validateServerFrame, validateWakeLink, wokeFrame } from '../src/wake-core.js';

const token = 'a'.repeat(40);

test('wake links accept only the allowlisted host, paths, and a 40-character token', () => {
  assert.equal(validateWakeLink(`wss://vps.mike-wolf.com/soma-rooms/wake/${token}`), `wss://vps.mike-wolf.com/soma-rooms/wake/${token}`);
  assert.equal(validateWakeLink(`wss://vps.mike-wolf.com/soma-rooms-staging/wake/${token}`), `wss://vps.mike-wolf.com/soma-rooms-staging/wake/${token}`);
  assert.equal(validateWakeLink(`wss://vps.mike-wolf.com/soma-rooms/wake/${'_-'.repeat(20)}`), `wss://vps.mike-wolf.com/soma-rooms/wake/${'_-'.repeat(20)}`);
  for (const value of [`ws://vps.mike-wolf.com/soma-rooms/wake/${token}`, `wss://evil.test/soma-rooms/wake/${token}`, `wss://vps.mike-wolf.com/other/wake/${token}`, `wss://vps.mike-wolf.com/soma-rooms/wake/short`, `wss://vps.mike-wolf.com/soma-rooms/wake/${token}?x=1`]) assert.throws(() => validateWakeLink(value));
});

test('chat URLs bind to one normal or GPT ChatGPT conversation', () => {
  for (const value of ['https://chatgpt.com/c/abc-123', 'https://chatgpt.com/g/gpt-name/c/abc-123']) assert.equal(validateChatUrl(value), value);
  for (const value of ['http://chatgpt.com/c/abc', 'https://chatgpt.com/', 'https://chatgpt.com/c/abc?x=1', 'https://chatgpt.com/g/name/abc']) assert.throws(() => validateChatUrl(value));
});

test('tab matching ignores only query and hash', () => {
  assert.equal(chatPageUrl('https://chatgpt.com/c/abc?model=gpt-5#latest'), 'https://chatgpt.com/c/abc');
  assert.notEqual(chatPageUrl('https://chatgpt.com/c/other?model=gpt-5'), chatPageUrl('https://chatgpt.com/c/abc'));
});

test('a new tab can be opened at most once per ten minutes', () => {
  assert.equal(mayOpenWakeTab(undefined, 1_000), true);
  assert.equal(mayOpenWakeTab(1_000, 600_999), false);
  assert.equal(mayOpenWakeTab(1_000, 601_000), true);
});

test('addressed wakes coalesce for 20 seconds and keep the newest sequence', () => {
  let state = { day: '', count: 0, lastWakeAt: 0, pending: null };
  let result = receiveAddressed(state, { seq: 1, at: 900 }, 1_000); state = result.state;
  assert.equal(result.action, 'wake');
  result = receiveAddressed(state, { seq: 2, at: 1_100 }, 2_000); state = result.state;
  assert.equal(result.action, 'wait'); assert.equal(result.delay, 19_000);
  result = receiveAddressed(state, { seq: 3, at: 1_200 }, 3_000); state = result.state;
  assert.equal(state.pending.seq, 3);
  result = takePending(state, 21_000);
  assert.equal(result.action, 'wake'); assert.equal(result.frame.seq, 3); assert.equal(result.state.count, 2);
});

test('the daily cap resets on the fake clock local day', () => {
  assert.equal(WAKE_DAILY_CAP, 100);
  const noon = new Date(2026, 0, 2, 12).getTime();
  let state = { day: '2026-01-02', count: WAKE_DAILY_CAP, lastWakeAt: noon - 30_000, pending: null };
  assert.equal(receiveAddressed(state, { seq: 1, at: noon }, noon).action, 'cap');
  const tomorrow = new Date(2026, 0, 3, 12).getTime();
  const result = receiveAddressed(state, { seq: 2, at: tomorrow }, tomorrow);
  assert.equal(result.action, 'wake'); assert.equal(result.state.count, 1);
});

test('documented frames match the server contract and client output', async () => {
  const frames = JSON.parse(await readFile(new URL('./fixtures/wake-frames.example.json', import.meta.url), 'utf8'));
  for (const name of ['ready', 'ping', 'addressed']) assert.deepEqual(validateServerFrame(frames[name]), frames[name]);
  assert.deepEqual(wokeFrame(42), frames.woke);
  assert.deepEqual(awayFrame(42, 'busy'), frames.away);
  assert.equal(1762000000123 - frames.addressed.at, 123, 'latency is clickedAt - at');
});

test('server frames are strictly validated', () => {
  assert.deepEqual(validateServerFrame({ type: 'ping' }), { type: 'ping' });
  assert.deepEqual(validateServerFrame({ type: 'ready', room: 'r', roomName: 'Room', ai: 'AI', now: 1 }), { type: 'ready', room: 'r', roomName: 'Room', ai: 'AI', now: 1 });
  assert.deepEqual(validateServerFrame({ type: 'addressed', room: 'r', seq: 7, at: 10 }), { type: 'addressed', room: 'r', seq: 7, at: 10 });
  assert.equal(validateServerFrame({ type: 'ready', room: 'r', roomName: 'Room', ai: 'AI', now: Infinity }), null);
  assert.equal(validateServerFrame({ type: 'addressed', room: 'r', seq: 7, at: NaN }), null);
  for (const frame of [null, { type: 'ping', extra: true }, { type: 'ready' }, { type: 'addressed', seq: 1, at: 2 }, { type: 'addressed', room: 'r', seq: {}, at: 2 }, { type: 'unknown' }]) assert.equal(validateServerFrame(frame), null);
});
