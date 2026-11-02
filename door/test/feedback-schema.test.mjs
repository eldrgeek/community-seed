import test from 'node:test';
import assert from 'node:assert/strict';
import { feedbackError } from '../lib.mjs';

const valid = () => ({ guideId: 'test-guide', guideTitle: 'Test guide', stepIndex: 1,
  url: 'https://example.test', userAgent: 'Test browser', extensionVersion: '0.1.0', targetMatched: true,
  note: 'The control is missing.', snapshot: { tag: 'section', role: 'dialog', children: [{ tag: 'button', label: 'Continue' }] } });

test('feedback schema accepts the exact payload', () => assert.equal(feedbackError(valid()), null));
test('feedback schema rejects unknown keys', () => assert.equal(feedbackError({ ...valid(), extra: true }), 'invalid fields'));
test('feedback schema accepts an omitted substituted title and requires an origin-only URL', () => {
  const body = valid(); delete body.guideTitle;
  assert.equal(feedbackError(body), null);
  assert.equal(feedbackError({ ...body, url: 'https://example.test/private/path' }), 'invalid value');
});
test('feedback schema caps aria-labels and requires a dialog or menu snapshot root', () => {
  assert.equal(feedbackError({ ...valid(), snapshot: { tag: 'section', role: 'dialog', 'aria-label': 'x'.repeat(41) } }), 'invalid snapshot');
  assert.equal(feedbackError({ ...valid(), snapshot: { tag: 'section' } }), 'invalid snapshot');
});
test('feedback schema enforces snapshot depth', () => {
  let snapshot = { tag: 'div' };
  for (let i = 0; i < 9; i++) snapshot = { tag: 'div', children: [snapshot] };
  assert.equal(feedbackError({ ...valid(), snapshot }), 'invalid snapshot');
});
test('feedback schema enforces the 300-node cap', () => {
  const snapshot = { tag: 'div', children: Array.from({ length: 300 }, () => ({ tag: 'span' })) };
  assert.equal(feedbackError({ ...valid(), snapshot }), 'invalid snapshot');
});
