import test from 'node:test';
import assert from 'node:assert/strict';
import { WAKE_SELECTORS, FIXED_WAKE_LINE } from '../src/wake-core.js';
import { wakeChatGPT } from '../src/wake-inject.js';

function fixture({ generating = false, text = '', composer = true } = {}) {
  let clock = 0; let clicked = 0; const turns = [];
  const editor = composer ? { textContent: text, focus() {}, dispatchEvent() {} } : null;
  const send = { click() { clicked++; turns.push({}); } };
  const document = {
    querySelector(selector) {
      if (selector === WAKE_SELECTORS.stopButton) return generating ? {} : null;
      if (selector === WAKE_SELECTORS.composer) return editor;
      if (selector === WAKE_SELECTORS.sendButton) return send;
      return null;
    },
    querySelectorAll(selector) { return selector === WAKE_SELECTORS.userTurn ? turns : []; },
    execCommand(command, _ui, value) { assert.equal(command, 'insertText'); editor.textContent = value; return true; },
  };
  return { document, now: () => clock, sleep: async ms => { clock += ms; }, fixedLine: FIXED_WAKE_LINE, get clicked() { return clicked; }, get editor() { return editor; } };
}

test('idle chat types exactly the fixed line and clicks send once', async () => {
  const env = fixture();
  assert.deepEqual(await wakeChatGPT(WAKE_SELECTORS, env), { outcome: 'woke', clickedAt: 0 });
  assert.equal(env.editor.textContent, FIXED_WAKE_LINE); assert.equal(env.clicked, 1);
});

test('generating waits 30 seconds and reports busy', async () => {
  const env = fixture({ generating: true });
  assert.deepEqual(await wakeChatGPT(WAKE_SELECTORS, env), { outcome: 'busy' }); assert.equal(env.clicked, 0);
});

test('composer text reports busy without typing', async () => {
  const env = fixture({ text: 'person is typing' });
  assert.deepEqual(await wakeChatGPT(WAKE_SELECTORS, env), { outcome: 'busy' });
  assert.equal(env.editor.textContent, 'person is typing'); assert.equal(env.clicked, 0);
});

test('missing composer reports not signed in', async () => {
  const env = fixture({ composer: false });
  assert.deepEqual(await wakeChatGPT(WAKE_SELECTORS, env), { outcome: 'not_signed_in' }); assert.equal(env.clicked, 0);
});
