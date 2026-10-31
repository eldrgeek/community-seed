export const MAX_COPY_LENGTH = 4000;

const STEP_KEYS = new Set(['type', 'instruction', 'target', 'url', 'copy', 'doneWhen']);
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
  for (const site of guide.allowedSites) if (!siteOrigin(site) || siteOrigin(site) !== site) throw new Error(`Invalid allowed site: ${site}`);
  if (guide.parameters !== undefined && (!guide.parameters || typeof guide.parameters !== 'object' || Array.isArray(guide.parameters))) throw new Error('Guide parameters are invalid.');
  if (!Array.isArray(guide.steps) || !guide.steps.length) throw new Error('The guide has no steps.');
  for (const [index, step] of guide.steps.entries()) {
    if (!step || typeof step !== 'object' || Array.isArray(step)) throw new Error(`Step ${index + 1} is invalid.`);
    for (const key of Object.keys(step)) if (!STEP_KEYS.has(key)) throw new Error(`Unsupported step field: ${key}`);
    if (!TYPES.has(step.type)) throw new Error(`Unsupported step type: ${step.type}`);
    if (typeof step.instruction !== 'string' || !step.instruction.trim()) throw new Error(`Step ${index + 1} has no instruction.`);
    if (step.target !== undefined && typeof step.target !== 'string') throw new Error(`Step ${index + 1} has an invalid target.`);
    if (step.url !== undefined && !siteOrigin(step.url)) throw new Error(`Step ${index + 1} has an invalid URL.`);
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
  }
  return guide;
}

export function substitute(value, params) {
  if (typeof value === 'string') return value.replace(/\{\{([a-zA-Z][\w-]*)\}\}/g, (_, key) => {
    if (!(key in params)) throw new Error(`Missing guide parameter: ${key}`);
    return String(params[key]);
  });
  if (Array.isArray(value)) return value.map(item => substitute(item, params));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, substitute(item, params)]));
  return value;
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
