const FEEDBACK_PAYLOAD_KEY = 'guide-feedback-payload';
const form = document.querySelector('form');
const note = document.querySelector('#note');
const preview = document.querySelector('#preview');
const status = document.querySelector('#status');
const send = form.querySelector('[type="submit"]');
let payload = null;

const updatePreview = () => {
  preview.textContent = payload ? JSON.stringify({ ...payload, note: note.value }, null, 2) : '';
};

(async () => {
  const stored = await chrome.storage.session.get(FEEDBACK_PAYLOAD_KEY);
  payload = stored[FEEDBACK_PAYLOAD_KEY] || null;
  if (!payload) {
    status.textContent = 'There is no feedback payload to send.';
    note.disabled = true;
    send.disabled = true;
    return;
  }
  updatePreview();
  note.focus();
})().catch(error => { status.textContent = error.message; send.disabled = true; });

note.addEventListener('input', updatePreview);
form.addEventListener('submit', async event => {
  event.preventDefault();
  if (!payload || !note.reportValidity()) return;
  send.disabled = true;
  status.classList.remove('success');
  status.textContent = 'Sending…';
  let result;
  try { result = await chrome.runtime.sendMessage({ type: 'guide-feedback-send', note: note.value }); }
  catch (error) { result = { error: error.message }; }
  if (result?.ok) {
    status.classList.add('success');
    status.textContent = 'Sent, thank you';
    setTimeout(() => window.close(), 1500);
    return;
  }
  send.disabled = false;
  status.textContent = `${result?.error || 'Feedback was not sent.'}\n\nThe JSON above is still available to copy.`;
});

document.querySelector('#cancel').addEventListener('click', async () => {
  await chrome.storage.session.remove(FEEDBACK_PAYLOAD_KEY);
  window.close();
});
