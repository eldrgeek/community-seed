import test from 'node:test';
import assert from 'node:assert/strict';
import { WAKE_SELECTORS, FIXED_WAKE_LINE } from '../src/wake-core.js';
import { wakeChatGPT } from '../src/wake-inject.js';

const BOUND_URL = 'https://chatgpt.com/c/bound';

function fixture({ generating = false, text = '', composer = true, location = BOUND_URL, sendEnabled = true, emptyOnSend = false } = {}) {
  let clock = 0; let clicked = 0; const turns = [];
  const editor = composer ? { textContent: text, focus() {}, dispatchEvent() {} } : null;
  const send = { disabled: !sendEnabled, click() { clicked++; if (emptyOnSend) editor.textContent = ''; else turns.push({}); } };
  let selected = false;
  const document = {
    querySelector(selector) {
      if (selector === WAKE_SELECTORS.stopButton) return generating ? {} : null;
      if (selector === WAKE_SELECTORS.composer) return editor;
      if (selector === WAKE_SELECTORS.sendButton) return send;
      return null;
    },
    querySelectorAll(selector) {
      if (selector === WAKE_SELECTORS.userTurn) return turns;
      const one = this.querySelector(selector);
      return one ? [one] : [];
    },
    execCommand(command, _ui, value) {
      if (command === 'insertText') { editor.textContent = value; return true; }
      if (command === 'selectAll') { selected = true; return true; }
      if (command === 'delete' && selected) { editor.textContent = ''; return true; }
      return false;
    },
  };
  const url = new URL(location);
  return { document, location: { origin: url.origin, pathname: url.pathname }, now: () => clock, sleep: async ms => { clock += ms; }, fixedLine: FIXED_WAKE_LINE, get clicked() { return clicked; }, get editor() { return editor; }, setLocation(value) { const next = new URL(value); this.location.origin = next.origin; this.location.pathname = next.pathname; } };
}

test('idle chat types exactly the fixed line and clicks send once', async () => {
  const env = fixture();
  assert.deepEqual(await wakeChatGPT(WAKE_SELECTORS, BOUND_URL, env), { outcome: 'woke', clickedAt: 0 });
  assert.equal(env.editor.textContent, FIXED_WAKE_LINE); assert.equal(env.clicked, 1);
});

test('generating waits 30 seconds and reports busy', async () => {
  const env = fixture({ generating: true });
  assert.deepEqual(await wakeChatGPT(WAKE_SELECTORS, BOUND_URL, env), { outcome: 'busy' }); assert.equal(env.clicked, 0);
});

test('composer text reports busy without typing', async () => {
  const env = fixture({ text: 'person is typing' });
  assert.deepEqual(await wakeChatGPT(WAKE_SELECTORS, BOUND_URL, env), { outcome: 'busy' });
  assert.equal(env.editor.textContent, 'person is typing'); assert.equal(env.clicked, 0);
});

test('missing composer reports not signed in', async () => {
  const env = fixture({ composer: false });
  assert.deepEqual(await wakeChatGPT(WAKE_SELECTORS, BOUND_URL, env), { outcome: 'not_signed_in' }); assert.equal(env.clicked, 0);
});

test('a different chat stays untouched before insertion', async () => {
  const env = fixture({ location: 'https://chatgpt.com/c/other' });
  assert.deepEqual(await wakeChatGPT(WAKE_SELECTORS, BOUND_URL, env), { outcome: 'busy' });
  assert.equal(env.editor.textContent, ''); assert.equal(env.clicked, 0);
});

test('navigation after insertion clears exactly our line and does not send', async () => {
  const env = fixture({ sendEnabled: false });
  let sleeps = 0;
  env.sleep = async ms => { env.setLocation('https://chatgpt.com/c/other'); sleeps += ms; };
  assert.deepEqual(await wakeChatGPT(WAKE_SELECTORS, BOUND_URL, env), { outcome: 'busy' });
  assert.equal(env.editor.textContent, ''); assert.equal(env.clicked, 0); assert.ok(sleeps > 0);
});

test('the bound URL is checked again immediately before Send', async () => {
  const env = fixture();
  const querySelector = env.document.querySelector.bind(env.document);
  env.document.querySelector = selector => {
    const result = querySelector(selector);
    if (selector === WAKE_SELECTORS.sendButton && env.editor.textContent === FIXED_WAKE_LINE) env.setLocation('https://chatgpt.com/c/other');
    return result;
  };
  assert.deepEqual(await wakeChatGPT(WAKE_SELECTORS, BOUND_URL, env), { outcome: 'busy' });
  assert.equal(env.editor.textContent, ''); assert.equal(env.clicked, 0);
});

test('clearing never removes text changed by the person', async () => {
  const env = fixture({ sendEnabled: false });
  env.sleep = async () => { env.editor.textContent = 'person took over'; };
  assert.deepEqual(await wakeChatGPT(WAKE_SELECTORS, BOUND_URL, env), { outcome: 'busy' });
  assert.equal(env.editor.textContent, 'person took over');
});

test('an emptied composer plus stop button confirms the send', async () => {
  const env = fixture({ emptyOnSend: true });
  let sent = false;
  const original = env.document.querySelector;
  env.document.querySelector = selector => selector === WAKE_SELECTORS.stopButton && env.clicked ? (sent = true, {}) : original(selector);
  assert.deepEqual(await wakeChatGPT(WAKE_SELECTORS, BOUND_URL, env), { outcome: 'woke', clickedAt: 0 });
  assert.equal(sent, true);
});
