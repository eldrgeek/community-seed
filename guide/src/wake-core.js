export const WAKE_HOSTS = Object.freeze(['vps.mike-wolf.com']);
export const WAKE_PATH_PREFIXES = Object.freeze(['/soma-rooms/wake/', '/soma-rooms-staging/wake/']);
export const CHATGPT_ORIGIN = 'https://chatgpt.com/*';
export const FIXED_WAKE_LINE = 'Check the SOMA room and reply to anything addressed to you.';
export const WAKE_COALESCE_MS = 20_000;
export const WAKE_DAILY_CAP = 300;

export const WAKE_SELECTORS = Object.freeze({
  stopButton: '[data-testid="stop-button"]',
  composer: '#prompt-textarea',
  sendButton: '[data-testid="send-button"]',
  userTurn: '[data-message-author-role="user"]',
});

export function validateWakeLink(value) {
  let url;
  try { url = new URL(value); } catch { throw new Error('Enter a valid wake link.'); }
  if (url.protocol !== 'wss:') throw new Error('Wake links must use wss://.');
  if (!WAKE_HOSTS.includes(url.hostname) || url.port || url.username || url.password) throw new Error('That wake-link host is not allowed.');
  const prefix = WAKE_PATH_PREFIXES.find(item => url.pathname.startsWith(item));
  const token = prefix && url.pathname.slice(prefix.length);
  if (!prefix || !/^[A-Za-z0-9_-]{40}$/.test(token) || url.search || url.hash) throw new Error('The wake link has an invalid path or token.');
  return url.href;
}

export function validateChatUrl(value) {
  if (!/^https:\/\/chatgpt\.com\/(?:c|g\/[^/]+\/c)\/[A-Za-z0-9-]+$/.test(value)) throw new Error('Enter a specific ChatGPT chat URL.');
  return value;
}

export function validateServerFrame(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || typeof value.type !== 'string') return null;
  if (value.type === 'ping') return Object.keys(value).length === 1 ? { type: 'ping' } : null;
  if (value.type === 'ready') {
    if (typeof value.room !== 'string' || typeof value.roomName !== 'string' || typeof value.ai !== 'string' || !Number.isFinite(value.now)) return null;
    return { type: 'ready', room: value.room, roomName: value.roomName, ai: value.ai, now: value.now };
  }
  if (value.type === 'addressed') {
    if (typeof value.room !== 'string' || (!Number.isInteger(value.seq) && typeof value.seq !== 'string') || !Number.isFinite(value.at)) return null;
    if (typeof value.seq === 'string' && !/^\d+$/.test(value.seq)) return null;
    return { type: 'addressed', room: value.room, seq: value.seq, at: value.at };
  }
  return null;
}

export function dayKey(time) {
  const date = new Date(time);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function receiveAddressed(state, frame, now) {
  const today = dayKey(now);
  const current = state.day === today ? state : { day: today, count: 0, lastWakeAt: state.lastWakeAt || 0, pending: null };
  if (current.count >= WAKE_DAILY_CAP) return { state: current, action: 'cap' };
  const pending = { seq: frame.seq, at: frame.at };
  const elapsed = now - (current.lastWakeAt || 0);
  if (!current.lastWakeAt || elapsed >= WAKE_COALESCE_MS) {
    return { state: { ...current, count: current.count + 1, lastWakeAt: now, pending: null }, action: 'wake', frame: pending, delay: 0 };
  }
  return { state: { ...current, pending }, action: 'wait', delay: WAKE_COALESCE_MS - elapsed };
}

export function takePending(state, now) {
  if (!state.pending) return { state, action: 'none' };
  if (state.count >= WAKE_DAILY_CAP) return { state: { ...state, pending: null }, action: 'cap' };
  const frame = state.pending;
  return { state: { ...state, count: state.count + 1, lastWakeAt: now, pending: null }, action: 'wake', frame };
}
