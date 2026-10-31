import { assertStepSite, substitute, validateGuide, verifyGuideBytes } from './guide-core.js';

const PUBLIC_KEY = '__GUIDE_PUBLIC_KEY__';

const sessionKey = tabId => `guide-tab-${tabId}`;
const getSession = async tabId => (await chrome.storage.session.get(sessionKey(tabId)))[sessionKey(tabId)];
const setSession = async (tabId, session) => chrome.storage.session.set({ [sessionKey(tabId)]: session });
const removeSession = async tabId => chrome.storage.session.remove(sessionKey(tabId));

async function releaseGuidePermissions(session, tabId) {
  const stored = await chrome.storage.session.get(null);
  const otherSites = new Set(Object.entries(stored).filter(([key]) => key !== sessionKey(tabId)).flatMap(([, value]) => value?.guide?.allowedSites || []));
  const origins = (session.removableOrigins || []).filter(origin => !otherSites.has(new URL(origin).origin));
  if (origins.length) await chrome.permissions.remove({ origins });
}

async function placeRunner(tabId) {
  const session = await getSession(tabId);
  if (!session) return;
  try {
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
      await setSession(tab.id, { guide, index: 0, skipped: [], removableOrigins });
      respond({ ok: true });
    })().catch(error => respond({ error: error.message }));
    return true;
  }
  const tabId = sender.tab?.id;
  (async () => {
    const session = await getSession(tabId);
    if (!session) return;
    if (message.type === 'guide-index') {
      if (!Number.isInteger(message.index) || message.index < 0 || message.index > session.guide.steps.length || ![session.index - 1, session.index + 1].includes(message.index)) return respond({ error: 'Invalid guide step transition.' });
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
