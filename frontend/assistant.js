/* ---------------------------------------------------------------------------
   ✨ Ask AI — the fourth way to create a task.

   A chat sheet. The server keeps the conversation and decides what to ask;
   this module only draws what comes back and sends what the person answers.
   Three things come back, in one reply shape:

   - `ask`: one question, with the control to answer it — a time or date
     picker, a link field with Skip, buttons, or text.
   - `plan`: the compact plan, rendered by the server from the validated
     items, with Change and Accept. Only the newest plan has live buttons.
   - `created` / `done`: what was saved, after Accept; the sheet then closes.

   Kept out of app.js like notifications.js and theme.js. It knows nothing
   about the task list: app.js passes in what to do once something is created.
--------------------------------------------------------------------------- */
import {
  acceptAssistantPlan, closeAssistantSession, fetchAssistantTemplates, sendAssistantMessage,
  startAssistantSession,
} from './api.js?v=31';

const dialog = document.getElementById('assistant');
const log = document.getElementById('assistant-log');
const chips = document.getElementById('assistant-chips');
const options = document.getElementById('assistant-options');
const form = document.getElementById('assistant-form');
const textBox = document.getElementById('assistant-text');
const valueBox = document.getElementById('assistant-value');
const skipButton = document.getElementById('assistant-skip');
const sendButton = document.getElementById('assistant-send');

/** null until asked; then the template list, or false when the server has no key. */
let templates = null;
let token = null;
let onCreated = () => {};
let sessionId = null;
let busy = false;

/**
 * Whether the server runs an assistant at all. Asked once: a 503 means no
 * Claude key is configured, and the button stays hidden.
 */
export async function assistantAvailable(authToken) {
  if (templates === null) {
    templates = await fetchAssistantTemplates(authToken).catch(() => false);
  }

  return templates !== false;
}

/* --- drawing -------------------------------------------------------------- */

function bubble(kind, text) {
  const element = document.createElement('div');
  element.className = `bubble bubble--${kind}`;
  element.textContent = text;
  log.append(element);
  element.scrollIntoView({ block: 'end', behavior: 'smooth' });

  return element;
}

/** Older plans can no longer be accepted, so their buttons go. */
function retirePlans() {
  log.querySelectorAll('.bubble--plan:not(.bubble--stale)').forEach((plan) => {
    plan.classList.add('bubble--stale');
    plan.querySelector('.plan__actions')?.remove();
  });
}

function planBubble(text) {
  retirePlans();
  const plan = bubble('plan', text);
  const actions = document.createElement('div');
  actions.className = 'plan__actions';

  const change = document.createElement('button');
  change.type = 'button';
  change.className = 'btn';
  change.textContent = 'Change';
  change.addEventListener('click', () => {
    showControl({ input: 'text' });
    textBox.placeholder = 'What should I change?';
    textBox.focus();
  });

  const accept = document.createElement('button');
  accept.type = 'button';
  accept.className = 'btn btn--primary';
  accept.textContent = 'Accept';
  accept.addEventListener('click', () => { void acceptPlan(accept, change); });

  actions.append(change, accept);
  plan.append(actions);
}

/** The answer control for the current question. */
function showControl(ask) {
  const picker = ['time', 'date', 'url'].includes(ask.input);
  textBox.hidden = picker;
  valueBox.hidden = !picker;
  valueBox.type = picker ? ask.input : 'text';
  valueBox.value = '';
  skipButton.hidden = ask.input !== 'url';
  textBox.placeholder = 'Type your answer';
  showOptions(ask);
}

function optionButton(label, onClick) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'toggle';
  button.textContent = label;
  button.addEventListener('click', () => { onClick(button); });

  return button;
}

/** The options picked so far on a multi-select question. */
const pickedOptions = () => [...options.querySelectorAll('.toggle[aria-pressed="true"]')]
  .map((button) => button.textContent);

/** Send shows how many are picked, so it is clear that Send is the next step. */
function syncSendLabel() {
  const count = pickedOptions().length;
  sendButton.textContent = count === 0 ? 'Send' : `Send (${String(count)})`;
}

function hint(text) {
  const element = document.createElement('p');
  element.className = 'assistant__hint';
  element.textContent = text;

  return element;
}

/**
 * Buttons for a choice (one tap sends it) or a list (taps mark, Send sends).
 *
 * A list used to end in a small "Done ✓" chip, and on a phone a marked
 * button next to it read as "nothing happened". Now the row says what to do,
 * and Send — which is always in the same place — carries the count.
 */
function showOptions(ask) {
  const choices = ask.options ?? [];
  options.replaceChildren();
  options.hidden = choices.length === 0 || !['choice', 'list'].includes(ask.input);
  syncSendLabel();
  if (options.hidden) return;

  if (ask.input === 'choice') {
    options.append(...choices.map((label) => optionButton(label, () => { void say(label); })));

    return;
  }

  options.append(...choices.map((label) => optionButton(label, (button) => {
    button.setAttribute('aria-pressed', String(button.getAttribute('aria-pressed') !== 'true'));
    syncSendLabel();
  })));
  options.append(hint('Tap all that apply, then tap Send. You can also type others.'));
}

function showReply(reply) {
  sessionId = reply.done ? null : reply.sessionId;
  if (reply.text) bubble('ai', reply.text);
  if (reply.ask) {
    bubble('ai', reply.ask.question);
    showControl(reply.ask);
  } else {
    showControl({ input: 'text' });
  }
  if (reply.plan) planBubble(reply.plan);
  if (reply.created?.length) onCreated(reply.created);
  if (reply.done) setTimeout(() => { dialog.close(); }, 1800);
}

/* --- talking -------------------------------------------------------------- */

/**
 * Runs one request with the sheet locked and a "…" bubble showing. A chat the
 * server has already forgotten (404 after the idle timeout) starts over.
 */
async function exchange(request) {
  busy = true;
  sendButton.disabled = true;
  const typing = bubble('ai bubble--typing', '…');
  try {
    showReply(await request());
  } catch (error) {
    if (/ended/i.test(error.message)) sessionId = null;
    bubble('error', error.message === 'UNAUTHORIZED' ? 'Please sign in again.' : error.message);
  } finally {
    typing.remove();
    busy = false;
    sendButton.disabled = false;
  }
}

async function say(message) {
  if (busy || message.trim() === '') return;

  chips.hidden = true;
  bubble('me', message);
  retirePlans();
  await exchange(() => (sessionId === null
    ? startAssistantSession(token, { message })
    : sendAssistantMessage(token, sessionId, message)));
}

async function startWith(template) {
  if (busy) return;

  chips.hidden = true;
  bubble('me', template.title);
  await exchange(() => startAssistantSession(token, { templateId: template.id }));
}

async function acceptPlan(accept, change) {
  if (busy || sessionId === null) return;

  accept.disabled = true;
  change.disabled = true;
  accept.textContent = 'Saving…';
  await exchange(() => acceptAssistantPlan(token, sessionId));
  retirePlans();
}

function chip(template) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'toggle';
  button.textContent = template.title;
  button.addEventListener('click', () => { void startWith(template); });

  return button;
}

function reset() {
  log.replaceChildren();
  chips.replaceChildren(...(templates || []).map(chip));
  chips.hidden = false;
  sessionId = null;
  showControl({ input: 'text' });
  textBox.value = '';
  textBox.placeholder = 'Tell me what you want to set up';
  bubble('ai', 'Hi! What do you want to set up? Pick one below, or just tell me.');
}

/** The chat on the server is deleted when the sheet goes away. */
function endSession() {
  if (sessionId !== null && token !== null) void closeAssistantSession(token, sessionId).catch(() => {});
  sessionId = null;
}

export function openAssistant(options) {
  ({ token } = options);
  onCreated = options.onCreated;
  reset();
  dialog.showModal();
  // No focus on purpose: on iOS that opens the keyboard, and the first tap on
  // a chip or an option then only closes the keyboard and is lost.
}

// Send carries whatever is marked on a multi-select question, plus anything typed.
form.addEventListener('submit', (event) => {
  event.preventDefault();
  const box = textBox.hidden ? valueBox : textBox;
  const message = [...pickedOptions(), box.value.trim()].filter(Boolean).join(', ');
  box.value = '';
  void say(message);
});

// Enter sends on a keyboard; Shift+Enter keeps a new line for a pasted list.
textBox.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
    event.preventDefault();
    form.requestSubmit();
  }
});

skipButton.addEventListener('click', () => { void say('skip'); });
document.getElementById('assistant-close').addEventListener('click', () => { dialog.close(); });
document.getElementById('assistant-new').addEventListener('click', () => {
  endSession();
  reset();
});
dialog.addEventListener('close', endSession);
