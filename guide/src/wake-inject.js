export async function wakeChatGPT(selectors, environment = {}) {
  const doc = environment.document || document;
  const sleep = environment.sleep || (ms => new Promise(resolve => setTimeout(resolve, ms)));
  const now = environment.now || Date.now;
  const fixedLine = environment.fixedLine || 'Check the SOMA room and reply to anything addressed to you.';
  const started = now();
  let composer = doc.querySelector(selectors.composer);
  if (!composer) return { outcome: 'not_signed_in' };

  while (doc.querySelector(selectors.stopButton)) {
    if (now() - started >= 30_000) return { outcome: 'busy' };
    await sleep(250);
    composer = doc.querySelector(selectors.composer);
    if (!composer) return { outcome: 'not_signed_in' };
  }
  if ((composer.textContent || '').trim()) return { outcome: 'busy' };

  const turnsBefore = doc.querySelectorAll(selectors.userTurn).length;
  composer.focus();
  let inserted = false;
  try { inserted = doc.execCommand('insertText', false, fixedLine); } catch {}
  if (!inserted) {
    composer.textContent = fixedLine;
    composer.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: fixedLine }));
  }
  // ChatGPT enables Send a moment after the text lands; wait for it, and never leave our line behind.
  let send = null;
  for (let waited = 0; waited <= 2_000; waited += 100) {
    send = doc.querySelector(selectors.sendButton);
    if (send && !send.disabled && send.getAttribute?.('aria-disabled') !== 'true') break;
    send = null;
    await sleep(100);
  }
  if (!send) {
    composer.textContent = '';
    composer.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'deleteContentBackward' }));
    return { outcome: 'busy' };
  }
  const clickedAt = now();
  send.click();
  for (let waited = 0; waited <= 5_000; waited += 100) {
    if (doc.querySelectorAll(selectors.userTurn).length > turnsBefore) return { outcome: 'woke', clickedAt };
    await sleep(100);
  }
  return { outcome: 'busy' };
}
