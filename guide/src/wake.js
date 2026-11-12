import { CHATGPT_ORIGIN, validateChatUrl, validateWakeLink } from './wake-core.js';

const SETTINGS_KEY = 'wake-settings';
const STATUS_KEY = 'wake-status';
const LOG_KEY = 'wake-log';
const WAKE_PERMISSION_KEY = 'wake-chatgpt-permission';
const form = document.querySelector('#form');
const wakeLink = document.querySelector('#wake-link');
const chatUrl = document.querySelector('#chat-url');
const status = document.querySelector('#status');

async function render() {
  const stored = await chrome.storage.local.get([SETTINGS_KEY, STATUS_KEY, LOG_KEY]);
  const config = stored[SETTINGS_KEY] || {};
  if (document.activeElement !== wakeLink) wakeLink.value = config.wakeLink || '';
  if (document.activeElement !== chatUrl) chatUrl.value = config.chatUrl || '';
  const current = stored[STATUS_KEY] || { state: config.enabled ? 'reconnecting' : 'off' };
  status.textContent = `${current.state === 'off' ? 'Off' : current.state[0].toUpperCase() + current.state.slice(1)}${current.detail ? ` — ${current.detail}` : ''}`;
  document.querySelector('#last-wake').textContent = current.lastWakeTime ? new Date(current.lastWakeTime).toLocaleString() : 'Never';
  document.querySelector('#wakes-today').textContent = String(current.wakesToday || 0);
  document.querySelector('#log').replaceChildren(...(stored[LOG_KEY] || []).slice().reverse().map(entry => {
    const item = document.createElement('li');
    item.textContent = `${new Date(entry.time).toLocaleString()}${entry.seq == null ? '' : ` · seq ${entry.seq}`} · ${entry.outcome}${Number.isFinite(entry.latencyMs) ? ` · ${entry.latencyMs} ms` : ''}`;
    return item;
  }));
}

form.addEventListener('submit', async event => {
  event.preventDefault();
  try {
    const saved = { enabled: true, wakeLink: validateWakeLink(wakeLink.value.trim()), chatUrl: validateChatUrl(chatUrl.value.trim()) };
    const granted = await chrome.permissions.request({ origins: [CHATGPT_ORIGIN] });
    if (!granted) throw new Error('ChatGPT access was not granted, so Wake my AI stayed off.');
    await chrome.storage.local.set({ [SETTINGS_KEY]: saved, [WAKE_PERMISSION_KEY]: true, [STATUS_KEY]: { state: 'reconnecting', updatedAt: Date.now(), wakesToday: 0 } });
    await chrome.runtime.sendMessage({ type: 'wake-settings-changed' });
    await render();
  } catch (error) { status.textContent = error.message; }
});

document.querySelector('#turn-off').addEventListener('click', async () => {
  await chrome.runtime.sendMessage({ type: 'wake-turn-off' });
  await render();
});

document.querySelector('#use-tab').addEventListener('click', async () => {
  const granted = await chrome.permissions.request({ origins: [CHATGPT_ORIGIN] });
  if (!granted) { status.textContent = 'ChatGPT access was not granted.'; return; }
  // This page may itself be the active tab, so take the ChatGPT chat tab used most recently.
  const tabs = await chrome.tabs.query({ url: CHATGPT_ORIGIN });
  const chats = tabs.filter(t => { try { validateChatUrl(t.url || ''); return true; } catch { return false; } });
  const tab = chats.sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0))[0];
  try { chatUrl.value = validateChatUrl(tab?.url || ''); status.textContent = 'Chat URL filled in. Wake my AI is still off.'; }
  catch { status.textContent = 'The active tab is not a specific ChatGPT chat.'; }
});

chrome.storage.onChanged.addListener((_changes, area) => { if (area === 'local') render(); });
render().then(() => {
  // A chat address (not a secret) may arrive in the hash: wake.html#chat=<url>. The wake link never does.
  const hashed = new URLSearchParams(location.hash.slice(1)).get('chat');
  if (hashed && !chatUrl.value) { try { chatUrl.value = validateChatUrl(hashed); } catch {} }
});
