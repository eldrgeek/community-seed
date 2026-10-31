import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { generateKeyPairSync, sign, webcrypto } from 'node:crypto';
import { mkdtemp, readFile } from 'node:fs/promises';
import { createServer } from 'node:https';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { verifyGuideBytes } from '../src/guide-core.js';

const run = promisify(execFile);
// Branded Chrome ignores --load-extension, so set CHROME_PATH to Chrome for Testing or Chromium.
const chromePath = [process.env.CHROME_PATH, '/Applications/Chromium.app/Contents/MacOS/Chromium'].filter(Boolean).find(path => { try { process.getBuiltinModule('fs').accessSync(path); return true; } catch { return false; } });

test('a signed sample guide copies only on click and advances on doneWhen in real Chrome', { skip: !chromePath, timeout: 30000 }, async t => {
  const temp = await mkdtemp(join(tmpdir(), 'soma-guide-browser-'));
  await run('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', join(temp, 'key.pem'), '-out', join(temp, 'cert.pem'), '-subj', '/CN=localhost', '-days', '1']);
  const server = createServer({ key: await readFile(join(temp, 'key.pem')), cert: await readFile(join(temp, 'cert.pem')) }, (_, response) => response.end('<!doctype html><button id="target">Target</button><main>Fixture</main>'));
  try { await new Promise((resolveReady, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolveReady); }); }
  catch (error) { t.skip(`local HTTPS fixture cannot listen here: ${error.code || error.message}`); return; }
  t.after(() => server.close());
  const origin = `https://127.0.0.1:${server.address().port}`;
  const guide = { id:'fixture', title:'Fixture', allowedSites:[origin], steps:[
    { type:'copy', instruction:'Copy this.', target:'#target', copy:'Visible copy text' },
    { type:'wait', instruction:'Wait.', doneWhen:{ textAppears:'Task created' } },
    { type:'done', instruction:'Done.' }
  ] };
  const bytes = new TextEncoder().encode(JSON.stringify(guide));
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  await verifyGuideBytes(bytes, sign(null, bytes, privateKey).toString('base64'), publicKey.export({ type:'spki', format:'der' }).toString('base64'), webcrypto);

  const profile = join(temp, 'profile');
  const dist = resolve(import.meta.dirname, '../dist');
  const chrome = spawn(chromePath, ['--headless=new', '--ignore-certificate-errors', '--remote-debugging-port=0', `--user-data-dir=${profile}`, `--disable-extensions-except=${dist}`, `--load-extension=${dist}`, `${origin}/fixture`], { stdio:['ignore','ignore','pipe'] });
  t.after(() => chrome.kill());
  let stderr = '';
  chrome.stderr.on('data', chunk => { stderr += chunk; });
  let endpoint;
  try { endpoint = await waitFor(() => stderr.match(/DevTools listening on (ws:\/\/[^\s]+)/)?.[1], 50); }
  catch { t.skip('Chrome cannot launch inside this sandbox'); return; }
  const browser = new WebSocket(endpoint);
  await opened(browser);
  let id = 0; const pending = new Map();
  browser.onmessage = event => { const msg = JSON.parse(event.data); if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); } };
  const call = (method, params = {}, sessionId) => new Promise((resolveCall, reject) => { const callId = ++id; pending.set(callId, msg => msg.error ? reject(new Error(msg.error.message)) : resolveCall(msg.result)); browser.send(JSON.stringify({ id:callId, method, params, ...(sessionId ? {sessionId} : {}) })); });
  let targets;
  for (let tries = 0; tries < 40; tries++) {
    targets = await call('Target.getTargets');
    if (targets.targetInfos.some(item => item.type === 'service_worker' && item.url.startsWith('chrome-extension://'))) break;
    await new Promise(done => setTimeout(done, 250));
  }
  assert.ok(targets.targetInfos.some(item => item.type === 'service_worker' && item.url.startsWith('chrome-extension://')), 'the built MV3 extension loaded');
  const target = targets.targetInfos.find(item => item.type === 'page' && item.url.startsWith(origin));
  const { sessionId } = await call('Target.attachToTarget', { targetId:target.targetId, flatten:true });
  await call('Runtime.enable', {}, sessionId);
  await call('Runtime.evaluate', { expression:`globalThis.__messages=[];globalThis.__copied='';globalThis.chrome={runtime:{onMessage:{addListener(fn){globalThis.__guideListener=fn}},sendMessage(msg){globalThis.__messages.push(msg);return Promise.resolve({ok:true})}}};Object.defineProperty(navigator,'clipboard',{value:{writeText(value){globalThis.__copied=value;return Promise.resolve()}}});` }, sessionId);
  const core = (await readFile(resolve(import.meta.dirname, '../src/guide-core.js'), 'utf8')).replaceAll('export ', '') + '\nglobalThis.SOMAGuideCore={assertStepSite};';
  await call('Runtime.evaluate', { expression:core }, sessionId);
  const runner = await readFile(resolve(import.meta.dirname, '../src/runner.js'), 'utf8');
  await call('Runtime.evaluate', { expression:runner }, sessionId);
  await call('Runtime.evaluate', { expression:`__guideListener({type:'show-guide',session:{guide:${JSON.stringify(guide)},index:0,skipped:[]}})` }, sessionId);
  assert.equal(await value(call, sessionId, `document.querySelector('#soma-guide-host').shadowRoot`), null);
  assert.equal(await value(call, sessionId, '__copied'), '');
  await call('Runtime.evaluate', { expression:`document.querySelector('#soma-guide-host').click()` }, sessionId);
  assert.equal(await value(call, sessionId, '__copied'), '', 'an untrusted page click cannot copy');
  await clickClosedShadowButton(call, sessionId, 'copyButton');
  assert.equal(await waitFor(async () => (await value(call, sessionId, '__copied')) || false), 'Visible copy text');
  await call('Runtime.evaluate', { expression:`__guideListener({type:'show-guide',session:{guide:${JSON.stringify(guide)},index:1,skipped:[]}});document.querySelector('main').textContent='Task created'` }, sessionId);
  assert.equal(await waitFor(async () => (await value(call, sessionId, `__messages.some(x=>x.type==='guide-index'&&x.index===2)`)) || false), true);
  browser.close();
});

async function value(call, sessionId, expression) { return (await call('Runtime.evaluate', { expression, returnByValue:true }, sessionId)).result.value; }
async function clickClosedShadowButton(call, sessionId, className) {
  await call('DOM.enable', {}, sessionId);
  const { nodes } = await call('DOM.getFlattenedDocument', { depth:-1, pierce:true }, sessionId);
  const node = nodes.find(item => {
    const attributes = Object.fromEntries(Array.from({ length:(item.attributes || []).length / 2 }, (_, index) => [item.attributes[index * 2], item.attributes[index * 2 + 1]]));
    return item.nodeName === 'BUTTON' && String(attributes.class || '').split(/\s+/).includes(className);
  });
  assert.ok(node, `found ${className} in the closed shadow root`);
  const { model } = await call('DOM.getBoxModel', { backendNodeId:node.backendNodeId }, sessionId);
  const [x1, y1, x2, , , y2] = model.content;
  const x = (x1 + x2) / 2; const y = (y1 + y2) / 2;
  await call('Input.dispatchMouseEvent', { type:'mousePressed', x, y, button:'left', clickCount:1 }, sessionId);
  await call('Input.dispatchMouseEvent', { type:'mouseReleased', x, y, button:'left', clickCount:1 }, sessionId);
}
async function waitFor(fn, attempts = 100) { for (let i=0;i<attempts;i++) { const found = await fn(); if (found) return found; await new Promise(resolve => setTimeout(resolve, 100)); } throw new Error('Timed out'); }
async function opened(socket) { if (socket.readyState === WebSocket.OPEN) return; await new Promise((resolve, reject) => { socket.onopen=resolve; socket.onerror=reject; }); }
