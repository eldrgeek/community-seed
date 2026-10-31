export const MAX_COPY_LENGTH = 4000;
export const MAX_FEEDBACK_NOTE_LENGTH = 2000;
export const PARAMETER_VALUE_RE = /^[A-Za-z0-9 '\-.]{1,60}$/;

const STEP_KEYS = new Set(['type', 'instruction', 'target', 'url', 'copy', 'doneWhen', 'verify', 'targetText']);
const DONE_KEYS = new Set(['selectorAppears', 'selectorGone', 'textAppears', 'urlIncludes']);
const TYPES = new Set(['open', 'point', 'copy', 'wait', 'done']);

export function siteOrigin(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' ? url.origin : null;
  } catch { return null; }
}

export function validateGuide(guide) {
  if (!guide || typeof guide !== 'object' || Array.isArray(guide)) throw new Error('The guide is not an object.');
  const top = new Set(['id', 'title', 'allowedSites', 'parameters', 'steps']);
  for (const key of Object.keys(guide)) if (!top.has(key)) throw new Error(`Unsupported guide field: ${key}`);
  if (typeof guide.id !== 'string' || !/^[a-z0-9-]+$/.test(guide.id)) throw new Error('The guide id is invalid.');
  if (typeof guide.title !== 'string' || !guide.title.trim()) throw new Error('The guide title is missing.');
  if (!Array.isArray(guide.allowedSites) || !guide.allowedSites.length) throw new Error('The guide has no allowed sites.');
  for (const site of guide.allowedSites) if (typeof site !== 'string' || site.includes('{{') || site.includes('}}') || !siteOrigin(site) || siteOrigin(site) !== site) throw new Error(`Invalid allowed site: ${site}`);
  if (guide.parameters !== undefined && (!guide.parameters || typeof guide.parameters !== 'object' || Array.isArray(guide.parameters))) throw new Error('Guide parameters are invalid.');
  for (const [name, definition] of Object.entries(guide.parameters || {})) {
    if (!/^[a-zA-Z][\w-]*$/.test(name) || !definition || typeof definition !== 'object' || Array.isArray(definition)
      || Object.keys(definition).some(key => key !== 'default')) throw new Error(`Guide parameter ${name} is invalid.`);
    if (definition.default !== undefined && (typeof definition.default !== 'string' || !PARAMETER_VALUE_RE.test(definition.default))) throw new Error(`Guide parameter ${name} has an invalid default.`);
  }
  if (!Array.isArray(guide.steps) || !guide.steps.length) throw new Error('The guide has no steps.');
  for (const [index, step] of guide.steps.entries()) {
    if (!step || typeof step !== 'object' || Array.isArray(step)) throw new Error(`Step ${index + 1} is invalid.`);
    for (const key of Object.keys(step)) if (!STEP_KEYS.has(key)) throw new Error(`Unsupported step field: ${key}`);
    if (!TYPES.has(step.type)) throw new Error(`Unsupported step type: ${step.type}`);
    if (typeof step.instruction !== 'string' || !step.instruction.trim()) throw new Error(`Step ${index + 1} has no instruction.`);
    if (step.target !== undefined && typeof step.target !== 'string') throw new Error(`Step ${index + 1} has an invalid target.`);
    if (step.targetText !== undefined && (typeof step.targetText !== 'string' || !step.target)) throw new Error(`Step ${index + 1} has invalid target text.`);
    if (step.url !== undefined && (typeof step.url !== 'string' || step.url.includes('{{') || step.url.includes('}}') || !siteOrigin(step.url))) throw new Error(`Step ${index + 1} has an invalid URL.`);
    if (step.type === 'open' && !guide.allowedSites.includes(siteOrigin(step.url))) throw new Error(`Step ${index + 1} opens a site that is not allowed.`);
    if (step.copy !== undefined && typeof step.copy !== 'string') throw new Error(`Step ${index + 1} has invalid copy text.`);
    if (step.copy?.length > MAX_COPY_LENGTH) throw new Error(`Step ${index + 1} copy text is over 4000 characters.`);
    if (step.type === 'copy' && typeof step.copy !== 'string') throw new Error(`Step ${index + 1} has no copy text.`);
    if (step.doneWhen !== undefined) {
      if (!step.doneWhen || typeof step.doneWhen !== 'object' || Array.isArray(step.doneWhen)) throw new Error(`Step ${index + 1} has an invalid done condition.`);
      for (const [key, value] of Object.entries(step.doneWhen)) {
        if (!DONE_KEYS.has(key) || typeof value !== 'string' || !value) throw new Error(`Step ${index + 1} has an invalid done condition.`);
      }
    }
    if (step.verify !== undefined) {
      const { selector, equals, retryStep, failMessage } = step.verify || {};
      if (typeof selector !== 'string' || !selector || typeof equals !== 'string' || !equals || typeof failMessage !== 'string' || !failMessage
        || !Number.isInteger(retryStep) || retryStep < 0 || retryStep >= index) throw new Error(`Step ${index + 1} has an invalid check.`);
      if (equals.length > MAX_COPY_LENGTH) throw new Error(`Step ${index + 1} check text is over 4000 characters.`);
    }
  }
  return guide;
}

export function substitute(value, params, context = null) {
  if (context === null && value && typeof value === 'object' && !Array.isArray(value)) {
    const declared = new Set(Object.keys(value.parameters || {}));
    for (const [name, supplied] of Object.entries(params || {})) {
      if (!declared.has(name)) throw new Error(`The link has an undeclared guide parameter: ${name}`);
      if (typeof supplied !== 'string' || !PARAMETER_VALUE_RE.test(supplied)) throw new Error(`The ${name} parameter must be 1 to 60 characters using only letters, digits, spaces, hyphens, apostrophes, and periods.`);
    }
  }
  if (typeof value === 'string') return value.replace(/\{\{([a-zA-Z][\w-]*)\}\}/g, (_, key) => {
    if (!(key in params)) throw new Error(`Missing guide parameter: ${key}`);
    const supplied = String(params[key]);
    return context === 'target' ? supplied.replaceAll("'", '\\27 ') : supplied;
  });
  if (Array.isArray(value)) return value.map(item => substitute(item, params, context));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, substitute(item, params, key)]));
  return value;
}

export function pickTarget(elements, text) {
  const list = Array.from(elements);
  if (!text) return list[0] || null;
  return list.find(element => (element.innerText || element.textContent || '').trim() === text) || null;
}

export function checkSaved(value, equals) {
  if (value === null || value === undefined) return 'waiting';
  return value.trim() === equals.trim() ? 'match' : 'different';
}

export function isAllowedStepTransition(guide, currentIndex, nextIndex) {
  const retryStep = guide.steps[currentIndex]?.verify?.retryStep;
  return Number.isInteger(nextIndex) && nextIndex >= 0 && nextIndex <= guide.steps.length
    && [currentIndex - 1, currentIndex + 1, retryStep].filter(Number.isInteger).includes(nextIndex);
}

export function buildFeedback({ guide, signedTitle, step, stepIndex, url, userAgent, extensionVersion, targetMatched, note, snapshot }) {
  const page = new URL(url);
  return {
    guideId: guide.id,
    ...(guide.title === signedTitle ? { guideTitle: guide.title } : {}),
    stepIndex,
    url: page.origin,
    userAgent,
    extensionVersion,
    targetMatched: !!targetMatched,
    note,
    snapshot,
  };
}

export function structureSnapshot(rootElement) {
  if (!rootElement) return null;
  const rootRole = rootElement.getAttribute?.('role');
  if (!['dialog', 'menu'].includes(rootRole) || rootElement.hidden || rootElement.getAttribute?.('aria-hidden') === 'true') return null;
  let count = 0;
  const skipped = element => element.isContentEditable || element.matches?.('nav, aside, a[href], [contenteditable], [data-message-id], [data-testid^="conversation"], article, [role="log"]');
  const visit = (element, depth) => {
    if (!element || depth > 8 || count >= 300 || skipped(element)) return null;
    count += 1;
    const tag = String(element.tagName || element.nodeName || '').toLowerCase();
    if (!tag) return null;
    const node = { tag };
    for (const name of ['role', 'aria-label', 'data-testid', 'type']) {
      const value = element.getAttribute?.(name);
      if (value) node[name] = String(value).slice(0, name === 'aria-label' ? 40 : 500);
    }
    if (tag === 'button' || tag === 'a' || tag === 'label' || ['menuitem', 'button'].includes(node.role)) {
      const label = String(element.innerText || element.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 40);
      if (label) node.label = label;
    }
    const children = [];
    for (const child of Array.from(element.children || [])) {
      const saved = visit(child, depth + 1);
      if (saved) children.push(saved);
      if (count >= 300) break;
    }
    if (children.length) node.children = children;
    return node;
  };
  return visit(rootElement, 0);
}

export function assertStepSite(step, allowedSites, currentUrl) {
  const candidate = step.type === 'open' ? step.url : currentUrl;
  const origin = siteOrigin(candidate);
  if (!origin || !allowedSites.includes(origin)) throw new Error(`This guide is not allowed to run on ${origin || 'this page'}.`);
  return true;
}

export async function verifyGuideBytes(bytes, signatureBase64, publicKeyBase64, cryptoImpl = globalThis.crypto) {
  if (!signatureBase64) throw new Error('This guide is unsigned.');
  if (!publicKeyBase64) throw new Error('This build has no guide verification key.');
  try {
    const decode = value => Uint8Array.from(atob(value.replace(/\s/g, '')), char => char.charCodeAt(0));
    const key = await cryptoImpl.subtle.importKey('spki', decode(publicKeyBase64), { name: 'Ed25519' }, false, ['verify']);
    const ok = await cryptoImpl.subtle.verify({ name: 'Ed25519' }, key, decode(signatureBase64), bytes);
    if (!ok) throw new Error('bad signature');
    return true;
  } catch {
    throw new Error('The guide signature is not valid.');
  }
}
