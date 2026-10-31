import { assertStepSite, isAllowedStepTransition, substitute, validateGuide, verifyGuideBytes } from './guide-core.js';

const PUBLIC_KEY = '__GUIDE_PUBLIC_KEY__';
const FEEDBACK_URL = '__FEEDBACK_URL__';
const REMOVABLE_ORIGINS_KEY = 'guide-removable-origins';

const sessionKey = tabId => `guide-tab-${tabId}`;
const getSession = async tabId => (await chrome.storage.session.get(sessionKey(tabId)))[sessionKey(tabId)];
const setSession = async (tabId, session) => chrome.storage.session.set({ [sessionKey(tabId)]: session });
const removeSession = async tabId => chrome.storage.session.remove(sessionKey(tabId));
let permissionQueue = Promise.resolve();
const serializePermissionUpdate = task => {
  const next = permissionQueue.then(task, task);
  permissionQueue = next.catch(() => {});
  return next;
};

async function releaseGuidePermissions(session, tabId) {
  return serializePermissionUpdate(async () => {
    const stored = await chrome.storage.session.get(null);
    const inUse = new Set(Object.entries(stored).filter(([key]) => key !== sessionKey(tabId)).flatMap(([, value]) => (value?.guide?.allowedSites || []).map(site => `${site}/*`)));
    const local = await chrome.storage.local.get(REMOVABLE_ORIGINS_KEY);
    const tracked = local[REMOVABLE_ORIGINS_KEY] || [];
    const origins = tracked.filter(origin => !inUse.has(origin));
    if (origins.length) await chrome.permissions.remove({ origins });
    await chrome.storage.local.set({ [REMOVABLE_ORIGINS_KEY]: tracked.filter(origin => inUse.has(origin)) });
  });
}

async function rememberGuidePermissions(origins) {
  return serializePermissionUpdate(async () => {
    const local = await chrome.storage.local.get(REMOVABLE_ORIGINS_KEY);
    await chrome.storage.local.set({ [REMOVABLE_ORIGINS_KEY]: [...new Set([...(local[REMOVABLE_ORIGINS_KEY] || []), ...origins])] });
  });
}

async function clearRememberedPermissions() {
  return serializePermissionUpdate(async () => {
    const local = await chrome.storage.local.get(REMOVABLE_ORIGINS_KEY);
    const origins = local[REMOVABLE_ORIGINS_KEY] || [];
    if (origins.length) await chrome.permissions.remove({ origins });
    await chrome.storage.local.remove(REMOVABLE_ORIGINS_KEY);
  });
}

async function placeRunner(tabId) {
  const session = await getSession(tabId);
  if (!session) return;
  try {
    const tab = await chrome.tabs.get(tabId);
    const origin = (() => { try { return new URL(tab.url).origin; } catch { return null; } })();
    if (!origin || !session.guide.allowedSites.includes(origin)) throw new Error('The tab is not on a site allowed by this guide.');
    await chrome.scripting.executeScript({ target: { tabId }, files: ['guide-runtime-core.js', 'runner.js'] });
    await chrome.tabs.sendMessage(tabId, { type: 'show-guide', session });
  } catch (error) {
    console.warn('SOMA Guide could not show this step:', error.message);
  }
}

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (message.type === 'start-guide') {
    (async () => {
      const bytes = Uint8Array.from(message.bytes || []);
      await verifyGuideBytes(bytes, message.signature, PUBLIC_KEY);
      const raw = validateGuide(JSON.parse(new TextDecoder().decode(bytes)));
      const guide = validateGuide(substitute(raw, message.params || {}));
      const first = guide.steps[0];
      const tab = await chrome.tabs.create({ url: first.type === 'open' ? first.url : guide.allowedSites[0] });
      const allowedOrigins = new Set(guide.allowedSites.map(site => `${site}/*`));
      const removableOrigins = (message.removableOrigins || []).filter(origin => allowedOrigins.has(origin));
      await setSession(tab.id, { guide, signedTitle: raw.title, index: 0, skipped: [], removableOrigins });
      await rememberGuidePermissions(removableOrigins);
      respond({ ok: true });
    })().catch(error => respond({ error: error.message }));
    return true;
  }
  if (message.type === 'guide-feedback') {
    if (!sender.tab?.id || sender.id !== chrome.runtime.id || sender.url?.startsWith(`chrome-extension://${chrome.runtime.id}/`)) {
      respond({ error: 'Feedback is accepted only from this extension on a guide page.' });
      return false;
    }
    (async () => {
      const response = await fetch(FEEDBACK_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(message.payload) });
      if (!response.ok) throw new Error(`Feedback was not sent (HTTP ${response.status}).`);
      respond({ ok: true });
    })().catch(error => respond({ error: error.message }));
    return true;
  }
  const tabId = sender.tab?.id;
  (async () => {
    const session = await getSession(tabId);
    if (!session) return;
    if (message.type === 'guide-index') {
      if (!isAllowedStepTransition(session.guide, session.index, message.index)) return respond({ error: 'Invalid guide step transition.' });
      if (message.skipped && message.skippedIndex !== session.index) return respond({ error: 'Invalid skipped step.' });
      session.index = message.index;
      if (message.skipped) session.skipped.push(message.skippedIndex);
      if (session.index >= session.guide.steps.length) { await removeSession(tabId); await releaseGuidePermissions(session, tabId); }
      else { await setSession(tabId, session); await placeRunner(tabId); }
      respond({ ok: true });
    } else if (message.type === 'guide-navigate') {
      const step = session.guide.steps[session.index];
      assertStepSite(step, session.guide.allowedSites, sender.tab.url);
      if (step.type !== 'open' || message.url !== step.url) return respond({ error: 'Navigation is not allowed for this step.' });
      await chrome.tabs.update(tabId, { url: step.url }); respond({ ok: true });
    }
  })();
  return true;
});

chrome.tabs.onUpdated.addListener((tabId, change) => { if (change.status === 'complete') placeRunner(tabId); });
chrome.tabs.onRemoved.addListener(async tabId => { const session = await getSession(tabId); if (session) { await removeSession(tabId); await releaseGuidePermissions(session, tabId); } });
chrome.runtime.onStartup.addListener(() => { clearRememberedPermissions().catch(error => console.warn('SOMA Guide could not clear site access:', error.message)); });
