import test from 'node:test';
import assert from 'node:assert/strict';
import { feedbackError } from '../lib.mjs';

const valid = () => ({ guideId: 'test-guide', guideTitle: 'Test guide', stepIndex: 1, stepType: 'point', stepInstruction: 'Click the control.',
  url: 'https://example.test/path', userAgent: 'Test browser', extensionVersion: '0.1.0', targetSelector: '#control', targetMatched: true,
  note: 'The control is missing.', snapshot: { tag: 'section', role: 'dialog', children: [{ tag: 'button', label: 'Continue' }] } });

test('feedback schema accepts the exact payload', () => assert.equal(feedbackError(valid()), null));
test('feedback schema rejects unknown keys', () => assert.equal(feedbackError({ ...valid(), extra: true }), 'invalid fields'));
test('feedback schema enforces snapshot depth', () => {
  let snapshot = { tag: 'div' };
  for (let i = 0; i < 9; i++) snapshot = { tag: 'div', children: [snapshot] };
  assert.equal(feedbackError({ ...valid(), snapshot }), 'invalid snapshot');
});
test('feedback schema enforces the 300-node cap', () => {
  const snapshot = { tag: 'div', children: Array.from({ length: 300 }, () => ({ tag: 'span' })) };
  assert.equal(feedbackError({ ...valid(), snapshot }), 'invalid snapshot');
});
