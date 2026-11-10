import { CHATGPT_ORIGIN, WAKE_SELECTORS, dayKey, receiveAddressed, takePending, validateChatUrl, validateServerFrame, validateWakeLink } from './wake-core.js';
import { wakeChatGPT } from './wake-inject.js';

const SETTINGS_KEY = 'wake-settings';
const STATUS_KEY = 'wake-status';
const LOG_KEY = 'wake-log';
const LIMIT_KEY = 'wake-limit';
const ALARM = 'wake-reconnect';
let socket = null;
let reconnectTimer = null;
let pendingTimer = null;
let backoff = 1_000;
let generation = 0;
let limiter = { day: dayKey(Date.now()), count: 0, lastWakeAt: 0, pending: null };
let limiterReady = chrome.storage.local.get(LIMIT_KEY).then(stored => { if (stored[LIMIT_KEY]) limiter = stored[LIMIT_KEY]; });
let addressedQueue = Promise.resolve();

async function saveLimiter() { await chrome.storage.local.set({ [LIMIT_KEY]: limiter }); }

async function settings() { return (await chrome.storage.local.get(SETTINGS_KEY))[SETTINGS_KEY] || { enabled: false }; }
async function setStatus(state, detail = '') {
  await chrome.storage.local.set({ [STATUS_KEY]: { state, detail, updatedAt: Date.now(), wakesToday: limiter.day === dayKey(Date.now()) ? limiter.count : 0 } });
  await chrome.action.setBadgeText({ text: state === 'connected' || state === 'reconnecting' ? 'W' : '' });
  if (state !== 'off') await chrome.action.setBadgeBackgroundColor({ color: state === 'connected' ? '#287a45' : '#777777' });
}
function send(frame) { if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(frame)); }

async function appendLog(seq, outcome, latencyMs) {
  const stored = await chrome.storage.local.get(LOG_KEY);
  const entry = { time: Date.now(), seq, outcome };
  if (Number.isFinite(latencyMs)) entry.latencyMs = Math.max(0, Math.round(latencyMs));
  const log = [...(stored[LOG_KEY] || []), entry].slice(-100);
  await chrome.storage.local.set({ [LOG_KEY]: log, [STATUS_KEY]: { ...((await chrome.storage.local.get(STATUS_KEY))[STATUS_KEY] || {}), lastWakeTime: entry.time, wakesToday: limiter.count } });
}

async function waitForTab(tabId) {
  try { if ((await chrome.tabs.get(tabId)).status === 'complete') return true; } catch { return false; }
  return new Promise(resolve => {
    const done = value => { clearTimeout(timeout); chrome.tabs.onUpdated.removeListener(updated); chrome.tabs.onRemoved.removeListener(removed); resolve(value); };
    const updated = (id, change) => { if (id === tabId && change.status === 'complete') done(true); };
    const removed = id => { if (id === tabId) done(false); };
    const timeout = setTimeout(() => done(false), 20_000);
    chrome.tabs.onUpdated.addListener(updated); chrome.tabs.onRemoved.addListener(removed);
  });
}

async function findOrOpenTab(chatUrl) {
  const tabs = await chrome.tabs.query({ url: [CHATGPT_ORIGIN] });
  const found = tabs.find(tab => tab.url === chatUrl);
  if (found) return { tab: found, loaded: found.status === 'complete' || await waitForTab(found.id) };
  try {
    const tab = await chrome.tabs.create({ url: chatUrl, active: false });
    return { tab, loaded: await waitForTab(tab.id) };
  } catch { return { tab: null, loaded: false }; }
}

async function performWake(frame) {
  const config = await settings();
  if (!config.enabled) return;
  let chatUrl;
  try { chatUrl = validateChatUrl(config.chatUrl); } catch { await disable('Invalid saved ChatGPT chat URL.'); return; }
  const { tab, loaded } = await findOrOpenTab(chatUrl);
  let outcome = 'tab_closed';
  let latencyMs;
  if (tab && loaded) {
    try {
      const [{ result }] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: wakeChatGPT, args: [WAKE_SELECTORS] });
      outcome = result?.outcome || 'busy';
      if (outcome === 'woke') latencyMs = result.clickedAt - frame.at;
    } catch { outcome = 'tab_closed'; }
  }
  send(outcome === 'woke' ? { type: 'woke', seq: frame.seq } : { type: 'away', seq: frame.seq, why: outcome });
  await appendLog(frame.seq, outcome, latencyMs);
  await setStatus(socket?.readyState === WebSocket.OPEN ? 'connected' : 'reconnecting');
}

function schedulePending(delay) {
  clearTimeout(pendingTimer);
  pendingTimer = setTimeout(async () => {
    await limiterReady;
    const next = takePending(limiter, Date.now()); limiter = next.state;
    await saveLimiter();
    if (next.action === 'wake') await performWake(next.frame);
  }, delay);
}

async function addressed(frame) {
  await limiterReady;
  const next = receiveAddressed(limiter, frame, Date.now()); limiter = next.state;
  await saveLimiter();
  if (next.action === 'wake') await performWake(next.frame);
  else if (next.action === 'wait') schedulePending(next.delay);
  else send({ type: 'away', seq: frame.seq, why: 'busy' });
}

function queueAddressed(frame) {
  addressedQueue = addressedQueue.then(() => addressed(frame), () => addressed(frame));
}

function scheduleReconnect(myGeneration) {
  clearTimeout(reconnectTimer);
  reconnectTimer = setTimeout(() => { if (myGeneration === generation) connect(); }, backoff);
  backoff = Math.min(backoff * 2, 60_000);
}

async function connect() {
  const config = await settings();
  if (!config.enabled || socket?.readyState === WebSocket.OPEN || socket?.readyState === WebSocket.CONNECTING) return;
  let wakeLink;
  try { wakeLink = validateWakeLink(config.wakeLink); } catch { await disable('Invalid saved wake link.'); return; }
  const myGeneration = ++generation;
  await setStatus('reconnecting');
  try { socket = new WebSocket(wakeLink); } catch { scheduleReconnect(myGeneration); return; }
  socket.onopen = async () => { if (myGeneration !== generation) return; backoff = 1_000; await setStatus('connected'); };
  socket.onmessage = event => {
    let parsed; try { parsed = JSON.parse(event.data); } catch { return; }
    const frame = validateServerFrame(parsed);
    if (frame?.type === 'addressed') queueAddressed(frame);
  };
  socket.onclose = async event => {
    if (myGeneration !== generation) return;
    socket = null;
    if (event.code === 4401) { await disable('The wake link is no longer valid.'); return; }
    if ((await settings()).enabled) { await setStatus('reconnecting'); scheduleReconnect(myGeneration); }
  };
  socket.onerror = () => {};
}

async function disable(detail = '') {
  generation++;
  clearTimeout(reconnectTimer); clearTimeout(pendingTimer);
  const old = socket; socket = null;
  if (old && old.readyState < WebSocket.CLOSING) old.close();
  const config = await settings();
  await chrome.storage.local.set({ [SETTINGS_KEY]: { ...config, enabled: false } });
  await chrome.permissions.remove({ origins: [CHATGPT_ORIGIN] });
  await setStatus('off', detail);
}

async function restart() {
  generation++;
  clearTimeout(reconnectTimer);
  const old = socket; socket = null;
  if (old && old.readyState < WebSocket.CLOSING) old.close();
  backoff = 1_000;
  await connect();
}

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (sender.id !== chrome.runtime.id) return;
  if (message.type === 'wake-settings-changed') { restart().then(() => respond({ ok: true })); return true; }
  if (message.type === 'wake-turn-off') { disable('Turned off.').then(() => respond({ ok: true })); return true; }
});
chrome.alarms.create(ALARM, { periodInMinutes: 1 });
chrome.alarms.onAlarm.addListener(async alarm => {
  if (alarm.name !== ALARM) return;
  await limiterReady;
  if (limiter.pending && Date.now() - limiter.lastWakeAt >= 20_000) {
    const next = takePending(limiter, Date.now()); limiter = next.state; await saveLimiter();
    if (next.action === 'wake') await performWake(next.frame);
  }
  if (!socket || socket.readyState > WebSocket.OPEN) connect();
});
chrome.runtime.onStartup.addListener(connect);
chrome.runtime.onInstalled.addListener(connect);
connect();
