(() => {
  if (globalThis.__somaGuideInstalled) return;
  globalThis.__somaGuideInstalled = true;
  let cleanup = () => {};

  function matchesDone(doneWhen, seen) {
    if (!doneWhen) return false;
    if (doneWhen.urlIncludes && location.href.includes(doneWhen.urlIncludes)) return true;
    if (doneWhen.selectorAppears && document.querySelector(doneWhen.selectorAppears)) return true;
    if (doneWhen.textAppears && document.body.innerText.toLowerCase().includes(doneWhen.textAppears.toLowerCase())) return true;
    if (doneWhen.selectorGone) {
      const present = !!document.querySelector(doneWhen.selectorGone);
      if (present) seen.present = true;
      if (!present && seen.present) return true;
    }
    return false;
  }

  chrome.runtime.onMessage.addListener(message => {
    if (message.type !== 'show-guide') return;
    cleanup();
    const { guide, index } = message.session;
    const step = guide.steps[index];
    try { SOMAGuideCore.assertStepSite(step, guide.allowedSites, location.href); }
    catch (error) { showError(error.message); return; }
    if (step.type === 'open' && location.href !== step.url) { chrome.runtime.sendMessage({ type: 'guide-navigate', url: step.url }); return; }

    const host = document.createElement('div'); host.id = 'soma-guide-host'; document.documentElement.append(host);
    const root = host.attachShadow({ mode: 'open' });
    root.innerHTML = `<style>:host{all:initial}.box{position:fixed;z-index:2147483647;right:20px;bottom:20px;width:min(360px,calc(100vw - 40px));box-sizing:border-box;background:#fff;color:#17211b;border:2px solid #245b3b;border-radius:12px;padding:16px;font:16px/1.4 system-ui;box-shadow:0 8px 35px #0005}.count{font-size:13px;color:#526057}.instruction{white-space:pre-wrap}.copy,.preview{white-space:pre-wrap;max-height:280px;overflow:auto;background:#f5f2e9;padding:10px;border-radius:6px}.wait{color:#526057;font-size:14px;margin:8px 0 0}.feedbackLink{display:inline-block;margin-top:12px;color:#245b3b}.feedback{position:fixed;inset:0;background:#0007;display:grid;place-items:center;padding:20px}.feedback[hidden]{display:none}.feedbackForm{width:min(520px,calc(100vw - 40px));max-height:calc(100vh - 40px);overflow:auto;background:white;border-radius:12px;padding:16px;box-sizing:border-box}.feedbackForm textarea{box-sizing:border-box;width:100%;min-height:100px;font:inherit}.feedbackForm label{display:block}.feedbackStatus{white-space:pre-wrap;color:#7b241c}.more{margin-top:10px;font-size:13px;color:#526057}.buttons{display:flex;gap:8px;flex-wrap:wrap;margin-top:12px}button{font:inherit;border:1px solid #245b3b;border-radius:6px;padding:7px 10px;background:white;color:#245b3b}button.primary{background:#245b3b;color:white}</style><div class="box" role="dialog" aria-label="SOMA Guide"><div class="count">Step ${index + 1} of ${guide.steps.length}</div><p class="instruction"></p><div class="copy" hidden></div><p class="wait" hidden>Waiting for you to do this…</p><div class="buttons"><button class="copyButton primary" hidden>Copy</button><button class="next primary">${step.type === 'done' ? 'Finish' : 'Next'}</button><button class="retry primary" hidden>Go back and paste it again</button></div><a class="feedbackLink" href="#">Something's wrong</a><details class="more"><summary>More</summary><div class="buttons"><button class="back">Back</button><button class="skip">Skip</button></div></details></div><div class="feedback" hidden><form class="feedbackForm"><h2>Something's wrong</h2><label>What happened?<textarea class="feedbackNote" required maxlength="2000"></textarea></label><p>Exactly this JSON will be sent:</p><pre class="preview"></pre><p class="feedbackStatus" role="status"></p><div class="buttons"><button class="send primary" type="submit">Send</button><button class="cancel" type="button">Cancel</button></div></form></div>`;
    root.querySelector('.instruction').textContent = step.instruction;
    let target = null;
    const mark = () => {
      if (target || !step.target) return;
      target = SOMAGuideCore.pickTarget(document.querySelectorAll(step.target), step.targetText);
      if (!target) return;
      target.style.setProperty('outline', '4px solid #e59b24', 'important');
      target.style.setProperty('outline-offset', '3px', 'important');
      target.scrollIntoView({ block: 'center', behavior: 'smooth' });
    };
    mark();
    const feedback = root.querySelector('.feedback');
    const note = root.querySelector('.feedbackNote');
    const preview = root.querySelector('.preview');
    const status = root.querySelector('.feedbackStatus');
    const openRole = role => Array.from(document.querySelectorAll(`[role="${role}"]`)).find(element => !element.hidden && element.getAttribute('aria-hidden') !== 'true');
    const feedbackRoot = () => openRole('dialog') || openRole('menu') || target?.closest?.('section') || target?.parentElement || null;
    const payload = () => SOMAGuideCore.buildFeedback({ guide, step, stepIndex: index, url: location.href, userAgent: navigator.userAgent,
      extensionVersion: chrome.runtime.getManifest().version, targetMatched: !!target, note: note.value,
      snapshot: SOMAGuideCore.structureSnapshot(feedbackRoot()) });
    const updatePreview = () => { preview.textContent = JSON.stringify(payload(), null, 2); };
    root.querySelector('.feedbackLink').onclick = event => { event.preventDefault(); status.textContent = ''; feedback.hidden = false; updatePreview(); note.focus(); };
    root.querySelector('.cancel').onclick = () => { feedback.hidden = true; };
    note.oninput = updatePreview;
    root.querySelector('.feedbackForm').onsubmit = async event => {
      event.preventDefault();
      if (!note.reportValidity()) return;
      const send = root.querySelector('.send'); send.disabled = true; status.textContent = 'Sending…';
      const outgoing = payload(); preview.textContent = JSON.stringify(outgoing, null, 2);
      let result;
      try { result = await chrome.runtime.sendMessage({ type: 'guide-feedback', payload: outgoing }); }
      catch (error) { result = { error: error.message }; }
      send.disabled = false;
      status.textContent = result?.ok ? 'Sent, thank you' : `${result?.error || 'Feedback was not sent.'}\n\nCopy this JSON if you want to send it another way:\n${JSON.stringify(outgoing, null, 2)}`;
    };
    const finish = (next, skipped = false) => chrome.runtime.sendMessage({ type: 'guide-index', index: next, skipped, ...(skipped ? { skippedIndex: index } : {}) });
    root.querySelector('.back').disabled = index === 0;
    root.querySelector('.back').onclick = () => finish(index - 1);
    root.querySelector('.next').onclick = () => finish(index + 1);
    root.querySelector('.skip').onclick = () => finish(index + 1, true);
    const next = root.querySelector('.next');
    const waiting = !!(step.doneWhen || step.verify);
    next.hidden = waiting || step.type === 'copy';
    root.querySelector('.wait').hidden = !waiting;
    if (step.type === 'copy') {
      const copy = root.querySelector('.copy'); copy.hidden = false; copy.textContent = step.copy;
      const button = root.querySelector('.copyButton'); button.hidden = false;
      button.onclick = async () => { await navigator.clipboard.writeText(step.copy); button.hidden = true; next.hidden = false; };
    }
    const seen = {};
    const timer = setInterval(() => {
      mark();
      if (matchesDone(step.doneWhen, seen)) { clearInterval(timer); finish(index + 1); return; }
      if (!step.verify) return;
      const field = document.querySelector(step.verify.selector);
      const state = SOMAGuideCore.checkSaved(field ? field.value : null, step.verify.equals);
      if (state === 'match') { clearInterval(timer); finish(index + 1); }
      if (state === 'different') {
        clearInterval(timer);
        root.querySelector('.instruction').textContent = step.verify.failMessage;
        root.querySelector('.wait').hidden = true;
        const retry = root.querySelector('.retry'); retry.hidden = false;
        retry.onclick = () => finish(step.verify.retryStep);
      }
    }, 400);
    cleanup = () => { clearInterval(timer); target?.style.removeProperty('outline'); target?.style.removeProperty('outline-offset'); host.remove(); };
  });

  function showError(message) {
    const old = document.querySelector('#soma-guide-error'); old?.remove();
    const error = document.createElement('div'); error.id = 'soma-guide-error'; error.textContent = message;
    Object.assign(error.style, { position:'fixed', zIndex:2147483647, right:'20px', bottom:'20px', background:'#fff', color:'#7b241c', border:'2px solid #7b241c', padding:'16px', maxWidth:'360px', font:'16px system-ui' });
    document.documentElement.append(error);
  }
})();
