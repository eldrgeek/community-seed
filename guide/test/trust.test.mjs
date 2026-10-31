import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign, webcrypto } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { assertStepSite, buildFeedback, checkSaved, pickTarget, structureSnapshot, substitute, validateGuide, verifyGuideBytes } from '../src/guide-core.js';

const basic = {
  id: 'test-guide', title: 'Test', allowedSites: ['https://example.test'],
  steps: [{ type: 'done', instruction: 'Done.' }]
};

function signed() {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const bytes = new TextEncoder().encode(JSON.stringify(basic));
  const signature = sign(null, bytes, privateKey).toString('base64');
  const publicKeyBase64 = publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
  return { bytes, signature, publicKeyBase64 };
}

test('accepts a valid Ed25519 signature and refuses a changed signature', async () => {
  const fixture = signed();
  await assert.doesNotReject(() => verifyGuideBytes(fixture.bytes, fixture.signature, fixture.publicKeyBase64, webcrypto));
  const changed = Uint8Array.from(fixture.bytes); changed[0] ^= 1;
  await assert.rejects(() => verifyGuideBytes(changed, fixture.signature, fixture.publicKeyBase64, webcrypto), /signature is not valid/);
});

test('refuses an unsigned guide', async () => {
  const fixture = signed();
  await assert.rejects(() => verifyGuideBytes(fixture.bytes, '', fixture.publicKeyBase64, webcrypto), /unsigned/);
});

test('refuses a step on the wrong site', () => {
  assert.throws(() => assertStepSite(basic.steps[0], basic.allowedSites, 'https://elsewhere.test/page'), /not allowed/);
});

test('refuses an open step before it navigates to an undeclared site', () => {
  const guide = structuredClone(basic);
  guide.steps = [{ type: 'open', instruction: 'Open.', url: 'https://elsewhere.test/' }];
  assert.throws(() => validateGuide(guide), /not allowed/);
});

test('refuses copy text over 4000 characters', () => {
  const guide = structuredClone(basic);
  guide.steps = [{ type: 'copy', instruction: 'Copy.', copy: 'x'.repeat(4001) }];
  assert.throws(() => validateGuide(guide), /over 4000/);
});

test('refuses parameters that expand copy text over 4000 characters', () => {
  const guide = structuredClone(basic);
  guide.parameters = { message: {} };
  guide.steps = [{ type: 'copy', instruction: 'Copy.', copy: '{{message}}' }];
  assert.throws(() => validateGuide(substitute(validateGuide(guide), { message: 'x'.repeat(4001) })), /over 4000/);
});

test('built output contains no automation entry points and only the fixed feedback host permission', async () => {
  const dist = resolve(import.meta.dirname, '../dist');
  const names = await readdir(dist);
  const text = (await Promise.all(names.filter(name => /\.(js|json|html)$/.test(name)).map(name => readFile(resolve(dist, name), 'utf8')))).join('\n');
  for (const forbidden of ['debugger', 'socket.io', 'relay', 'side_panel', 'click(', '.click()', 'dispatchEvent', 'sendKeys', 'executeAutomation', 'skill_run']) {
    assert.equal(text.includes(forbidden), false, `bundle contains forbidden automation marker: ${forbidden}`);
  }
  const manifest = JSON.parse(await readFile(resolve(dist, 'manifest.json'), 'utf8'));
  assert.deepEqual(manifest.permissions, ['storage', 'scripting']);
  assert.deepEqual(manifest.host_permissions, ['https://vps.mike-wolf.com/*']);
  assert.deepEqual(manifest.optional_host_permissions, ['https://*/*']);
});

test('feedback contains the exact context and removes query strings and hashes', () => {
  const step = { type: 'point', instruction: 'Choose it.', target: '#target' };
  assert.deepEqual(buildFeedback({ guide: basic, step, stepIndex: 2, url: 'https://example.test/path?q=secret#part', userAgent: 'Test',
    extensionVersion: '0.1.0', targetMatched: 1, note: 'It moved.', snapshot: null }), {
    guideId: 'test-guide', guideTitle: 'Test', stepIndex: 2, stepType: 'point', stepInstruction: 'Choose it.',
    url: 'https://example.test/path', userAgent: 'Test', extensionVersion: '0.1.0', targetSelector: '#target',
    targetMatched: true, note: 'It moved.', snapshot: null,
  });
});

test('the structure snapshot keeps controls but no page text, field values, or messages', () => {
  const element = (tag, attributes = {}, text = '', children = [], extra = {}) => ({ tagName: tag.toUpperCase(), children, textContent: text, innerText: text,
    isContentEditable: !!extra.isContentEditable, value: extra.value, getAttribute: name => attributes[name] ?? null,
    matches: selector => selector.split(',').some(part => {
      const value = part.trim();
      return value === '[contenteditable]' && attributes.contenteditable !== undefined
        || value === '[data-message-id]' && attributes['data-message-id'] !== undefined
        || value === '[data-testid^="conversation"]' && String(attributes['data-testid'] || '').startsWith('conversation')
        || value === 'article' && tag === 'article' || value === '[role="log"]' && attributes.role === 'log';
    }),
  });
  const marker = 'PRIVATE-MARKER';
  const root = element('section', { role: 'dialog', 'aria-label': 'Settings' }, marker, [
    element('textarea', {}, marker, [], { value: marker }), element('p', {}, marker),
    element('button', { type: 'submit' }, 'Save changes'), element('div', { 'data-message-id': '1' }, marker, [element('button', {}, marker)]),
  ]);
  const snapshot = structureSnapshot(root);
  assert.deepEqual(snapshot.children.find(node => node.tag === 'button'), { tag: 'button', type: 'submit', label: 'Save changes' });
  assert.equal(JSON.stringify(snapshot).includes(marker), false);
});

test('the background posts feedback only to its fixed build constant', async () => {
  const background = await readFile(resolve(import.meta.dirname, '../dist/background.js'), 'utf8');
  assert.match(background, /const FEEDBACK_URL = 'https:\/\/vps\.mike-wolf\.com\/seed-door\/feedback'/);
  assert.match(background, /fetch\(FEEDBACK_URL, \{ method: 'POST'/);
  assert.equal([...background.matchAll(/method: 'POST'/g)].length, 1);
});

test('the built start, background, and runner wire in both trust checks', async () => {
  const dist = resolve(import.meta.dirname, '../dist');
  const start = await readFile(resolve(dist, 'start.js'), 'utf8');
  const background = await readFile(resolve(dist, 'background.js'), 'utf8');
  const runner = await readFile(resolve(dist, 'runner.js'), 'utf8');
  assert.match(start, /await verifyGuideBytes\(/);
  assert.match(background, /await verifyGuideBytes\(/);
  assert.match(background, /assertStepSite\(/);
  assert.match(runner, /SOMAGuideCore\.assertStepSite\(/);
});

test('the committed guides match their committed signatures', async () => {
  const root = resolve(import.meta.dirname, '..');
  const publicKey = (await readFile(resolve(root, 'public-key.txt'), 'utf8')).trim();
  for (const name of ['chatgpt-project-rule.json', 'chatgpt-one-time-task.json']) {
    const bytes = new Uint8Array(await readFile(resolve(root, 'guides', name)));
    const signature = (await readFile(resolve(root, 'guides', `${name}.sig`), 'utf8')).trim();
    await verifyGuideBytes(bytes, signature, publicKey, webcrypto);
    validateGuide(JSON.parse(new TextDecoder().decode(bytes)));
  }
});

test('the saved check matches, waits, and reports a difference', () => {
  assert.equal(checkSaved('the rule ', 'the rule'), 'match');
  assert.equal(checkSaved(null, 'the rule'), 'waiting');
  assert.equal(checkSaved('', 'the rule'), 'different');
  assert.equal(checkSaved('another rule', 'the rule'), 'different');
});

test('a check must loop back to an earlier step', () => {
  const steps = [{ type: 'done', instruction: 'A.' }, { type: 'wait', instruction: 'B.', verify: { selector: 'textarea', equals: 'x', failMessage: 'No.', retryStep: 1 } }];
  assert.throws(() => validateGuide({ ...basic, steps }), /invalid check/);
  steps[1].verify.retryStep = 0;
  assert.ok(validateGuide({ ...basic, steps }));
});

test('target text picks the named item, and never a neighbouring one', () => {
  const items = [{ innerText: 'Pin project' }, { innerText: 'Project settings' }, { innerText: 'Delete project' }];
  assert.equal(pickTarget(items, 'Project settings'), items[1]);
  assert.equal(pickTarget(items, 'Missing'), null);
  assert.equal(pickTarget(items), items[0]);
});
