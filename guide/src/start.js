import { validateGuide, verifyGuideBytes, substitute } from './guide-core.js';

const PUBLIC_KEY = '__GUIDE_PUBLIC_KEY__';
const DEFAULT_BASE = '__GUIDE_BASE_URL__';
const form = document.querySelector('#form');
const address = document.querySelector('#url');
const status = document.querySelector('#status');
const review = document.querySelector('#review');
let pending;
let pendingBytes;
let pendingSignature;
let pendingParams;

const query = new URLSearchParams(location.search);
address.value = query.get('guide') || (DEFAULT_BASE.startsWith('https://') ? DEFAULT_BASE : '');

form.addEventListener('submit', async event => {
  event.preventDefault(); status.textContent = 'Checking the guide…'; review.hidden = true;
  try {
    const guideUrl = new URL(address.value);
    if (guideUrl.protocol !== 'https:') throw new Error('Guide addresses must use https.');
    const sourceOrigin = `${guideUrl.origin}/*`;
    const sourceWasGranted = await chrome.permissions.contains({ origins: [sourceOrigin] });
    const sourceGranted = await chrome.permissions.request({ origins: [sourceOrigin] });
    if (!sourceGranted) throw new Error(`Access to ${guideUrl.origin} was not granted.`);
    let bytes, signature;
    try {
      const [guideResponse, signatureResponse] = await Promise.all([fetch(guideUrl), fetch(`${guideUrl}.sig`)]);
      if (!guideResponse.ok) throw new Error('The guide could not be downloaded.');
      bytes = new Uint8Array(await guideResponse.arrayBuffer());
      signature = signatureResponse.ok ? (await signatureResponse.text()).trim() : '';
    } finally {
      if (!sourceWasGranted) await chrome.permissions.remove({ origins: [sourceOrigin] });
    }
    await verifyGuideBytes(bytes, signature, PUBLIC_KEY);
    const raw = validateGuide(JSON.parse(new TextDecoder().decode(bytes)));
    const params = {};
    for (const [name, definition] of Object.entries(raw.parameters || {})) {
      const supplied = query.get(name);
      const value = supplied ?? definition.default;
      if (value === undefined || value === '') throw new Error(`The link is missing the ${name} parameter.`);
      params[name] = value;
    }
    pending = validateGuide(substitute(raw, params));
    pendingBytes = Array.from(bytes);
    pendingSignature = signature;
    pendingParams = params;
    document.querySelector('#title').textContent = pending.title;
    document.querySelector('#sites').replaceChildren(...pending.allowedSites.map(site => { const li = document.createElement('li'); li.textContent = site; return li; }));
    review.hidden = false; status.textContent = '';
  } catch (error) { status.textContent = error.message; }
});

document.querySelector('#start').addEventListener('click', async () => {
  status.textContent = 'Chrome will ask you to approve the named site.';
  const origins = pending.allowedSites.map(site => `${site}/*`);
  const alreadyGranted = await Promise.all(origins.map(origin => chrome.permissions.contains({ origins: [origin] })));
  const granted = await chrome.permissions.request({ origins });
  if (!granted) { status.textContent = 'Site access was not granted, so the guide did not start.'; return; }
  const removableOrigins = origins.filter((_, index) => !alreadyGranted[index]);
  const result = await chrome.runtime.sendMessage({ type: 'start-guide', bytes: pendingBytes, signature: pendingSignature, params: pendingParams, removableOrigins });
  if (result?.error && removableOrigins.length) await chrome.permissions.remove({ origins: removableOrigins });
  status.textContent = result?.error || 'Guide started.';
});
