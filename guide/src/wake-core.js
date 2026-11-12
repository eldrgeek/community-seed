export const WAKE_HOSTS = Object.freeze(['vps.mike-wolf.com']);
export const WAKE_PATH_PREFIXES = Object.freeze(['/soma-rooms/wake/', '/soma-rooms-staging/wake/']);
export const CHATGPT_ORIGIN = 'https://chatgpt.com/*';
export const FIXED_WAKE_LINE = 'Check the SOMA room and reply to anything addressed to you.';
export const LISTEN_WAKE_LINE = 'Listen to the SOMA room: read its brief. If you have something useful to add, call raise_hand with a short reason and your comment; otherwise do nothing.';
export const PREPARE_WAKE_LINE = 'Someone in the SOMA room is writing to you now: call wait_for_mention and answer it when it arrives. If nothing comes, do nothing.';
export const RECHECK_WAKE_LINE = 'Your held comment in the SOMA room may be out of date: read the room, then keep it, call update_hand with a new comment, or call lower_hand.';
export const WAKE_COALESCE_MS = 20_000;
export const WAKE_DAILY_CAP = 100;
export const PREPARE_DAILY_CAP = 20; // get-ready wakes have their own small allowance, so they can never use up mentions
export const QUIET_DAILY_CAP = 30; // listen and recheck wakes have their own allowance, so mentions are never starved

// ChatGPT changes its markup; each entry lists the old form and the new one (seen 2026-11-11).
export const WAKE_SELECTORS = Object.freeze({
  stopButton: '[data-testid="stop-button"], button[aria-label="Stop"], button[aria-label="Stop streaming"]',
  composer: '#prompt-textarea, [contenteditable="true"][aria-label="Ask ChatGPT"]',
  sendButton: '[data-testid="send-button"], button[aria-label="Send"], button[aria-label="Send prompt"]',
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

export function chatPageUrl(value) {
  try { const url = new URL(value); return `${url.origin}${url.pathname}`; } catch { return null; }
}

export function mayOpenWakeTab(lastOpenedAt, now) {
  return !Number.isFinite(lastOpenedAt) || now - lastOpenedAt >= 10 * 60_000;
}

export function wokeFrame(seq) { return { type: 'woke', seq }; }
export function awayFrame(seq, why) { return { type: 'away', seq, why }; }

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
  if (value.type === 'listen' || value.type === 'recheck' || value.type === 'prepare') {
    if (typeof value.room !== 'string' || !Number.isFinite(value.at) || Object.keys(value).length !== 3) return null;
    return { type: value.type, room: value.room, at: value.at };
  }
  return null;
}

export function dayKey(time) {
  const date = new Date(time);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

const bump = (s, kind) => kind === 'quiet' ? { ...s, quietCount: (s.quietCount || 0) + 1 } : kind === 'prepare' ? { ...s, prepareCount: (s.prepareCount || 0) + 1 } : { ...s, count: s.count + 1 };
const kindOf = type => type === 'listen' || type === 'recheck' ? 'quiet' : type === 'prepare' ? 'prepare' : 'addressed';
const overCap = (s, kind) => kind === 'quiet' ? (s.quietCount || 0) >= QUIET_DAILY_CAP : kind === 'prepare' ? (s.prepareCount || 0) >= PREPARE_DAILY_CAP : s.count >= WAKE_DAILY_CAP;

export function receiveAddressed(state, frame, now) {
  const today = dayKey(now);
  const current = state.day === today ? state : { day: today, count: 0, quietCount: 0, prepareCount: 0, lastWakeAt: state.lastWakeAt || 0, lastPrepareAt: state.lastPrepareAt || 0, pending: null };
  const kind = kindOf(frame.type), quiet = kind === 'quiet';
  if (overCap(current, kind)) return { state: current, action: 'cap' };
  // Nothing displaces a waiting mention.
  if (kind !== 'addressed' && current.pending && current.pending.type === 'addressed') return { state: current, action: 'drop' };
  // A get-ready (prepare) wake keeps its own clock: it never waits behind, or delays, a mention.
  if (kind === 'prepare') {
    if (now - (current.lastPrepareAt || 0) < WAKE_COALESCE_MS) return { state: current, action: 'drop' };
    return { state: { ...bump(current, kind), lastPrepareAt: now }, action: 'wake', frame: { type: 'prepare', at: frame.at }, delay: 0 };
  }
  const pending = { type: quiet ? frame.type : 'addressed', seq: frame.seq, at: frame.at };
  const elapsed = now - (current.lastWakeAt || 0);
  if (!current.lastWakeAt || elapsed >= WAKE_COALESCE_MS) {
    return { state: { ...bump(current, kind), lastWakeAt: now, pending: null }, action: 'wake', frame: pending, delay: 0 };
  }
  return { state: { ...current, pending }, action: 'wait', delay: WAKE_COALESCE_MS - elapsed };
}

export function takePending(state, now) {
  if (!state.pending) return { state, action: 'none' };
  const kind = kindOf(state.pending.type);
  if (overCap(state, kind)) return { state: { ...state, pending: null }, action: 'cap' };
  const frame = state.pending;
  return { state: { ...bump(state, kind), lastWakeAt: now, pending: null }, action: 'wake', frame };
}
