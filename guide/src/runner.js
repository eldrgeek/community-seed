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
    root.innerHTML = `<style>:host{all:initial}.box{position:fixed;z-index:2147483647;right:20px;bottom:20px;width:min(360px,calc(100vw - 40px));box-sizing:border-box;background:#fff;color:#17211b;border:2px solid #245b3b;border-radius:12px;padding:16px;font:16px/1.4 system-ui;box-shadow:0 8px 35px #0005}.count{font-size:13px;color:#526057}.instruction{white-space:pre-wrap}.copy{white-space:pre-wrap;max-height:280px;overflow:auto;background:#f5f2e9;padding:10px;border-radius:6px}.wait{color:#526057;font-size:14px;margin:8px 0 0}.more{margin-top:10px;font-size:13px;color:#526057}.buttons{display:flex;gap:8px;flex-wrap:wrap;margin-top:12px}button{font:inherit;border:1px solid #245b3b;border-radius:6px;padding:7px 10px;background:white;color:#245b3b}button.primary{background:#245b3b;color:white}</style><div class="box" role="dialog" aria-label="SOMA Guide"><div class="count">Step ${index + 1} of ${guide.steps.length}</div><p class="instruction"></p><div class="copy" hidden></div><p class="wait" hidden>Waiting for you to do this…</p><div class="buttons"><button class="copyButton primary" hidden>Copy</button><button class="next primary">${step.type === 'done' ? 'Finish' : 'Next'}</button><button class="retry primary" hidden>Go back and paste it again</button></div><details class="more"><summary>More</summary><div class="buttons"><button class="back">Back</button><button class="skip">Skip</button></div></details></div>`;
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
