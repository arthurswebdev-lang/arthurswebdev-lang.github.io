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
  acceptAssistantPlan, closeAssistantSession, fetchAssistantHealth, fetchAssistantTemplates,
  sendAssistantMessage, startAssistantSession,
} from './api.js?v=33';

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

/* --- the keyboard --------------------------------------------------------- */

/**
 * iOS does not make the page smaller when the keyboard comes up. The layout
 * viewport — and so `100dvh` — stays the whole screen, and the keys are simply
 * drawn on top of it. The chat is a fixed-height sheet with its answer bar
 * pinned to the bottom, so the bar ended up under the keyboard: you could type
 * but not see what you typed.
 *
 * Only the *visual* viewport knows about the keyboard, so the sheet is told how
 * much of the screen is covered and takes that off its own height. The
 * subtraction is against `documentElement.clientHeight`, the layout viewport,
 * because that is the one number the keyboard does not move; `offsetTop` is in
 * it because iOS may also scroll the page up to reveal the focused field.
 *
 * A browser that resizes the page for its keyboard (and a desktop, which has no
 * keyboard to resize for) reports 0 here, which is the same as not doing this.
 */
const viewport = window.visualViewport ?? null;

/** The last value written, so a plain scroll does not re-scroll the log. */
let covered = 0;

function trackKeyboard() {
  if (viewport === null) return;

  const hidden = document.documentElement.clientHeight - viewport.height - viewport.offsetTop;
  const next = Math.max(0, Math.round(hidden));
  if (next === covered) return;

  covered = next;
  dialog.style.setProperty('--kb', `${String(next)}px`);
  // The message list just got shorter: keep the newest message in view rather
  // than leaving the conversation where it was before the keys came up.
  log.scrollTo({ top: log.scrollHeight });
}

/** Watched only while the chat is open; closing puts the sheet back to full height. */
function watchKeyboard(on) {
  if (viewport === null) return;

  const listen = on ? 'addEventListener' : 'removeEventListener';
  viewport[listen]('resize', trackKeyboard);
  viewport[listen]('scroll', trackKeyboard);
  if (on) return;

  covered = 0;
  dialog.style.removeProperty('--kb');
}

/* --- drawing -------------------------------------------------------------- */

function bubble(kind, text) {
  const element = document.createElement('div');
  element.className = `bubble bubble--${kind}`;
  element.textContent = text;
  log.append(element);
  // Only the message list scrolls; scrollIntoView would move the sheet too.
  log.scrollTo({ top: log.scrollHeight, behavior: 'smooth' });

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

    return true;
  } catch (error) {
    if (/ended/i.test(error.message)) sessionId = null;
    bubble('error', error.message === 'UNAUTHORIZED' ? 'Please sign in again.' : error.message);

    return false;
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

/**
 * A failed Accept leaves the plan acceptable: the server puts it back to
 * waiting when nothing was saved, so the buttons come back too. Anything that
 * was saved before the failure stays saved and is never saved twice.
 */
async function acceptPlan(accept, change) {
  if (busy || sessionId === null) return;

  accept.disabled = true;
  change.disabled = true;
  accept.textContent = 'Saving…';
  const ok = await exchange(() => acceptAssistantPlan(token, sessionId));
  if (ok) {
    retirePlans();

    return;
  }
  accept.disabled = false;
  change.disabled = false;
  accept.textContent = 'Accept';
}

function chip(template) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'toggle';
  button.textContent = template.title;
  button.addEventListener('click', () => { void startWith(template); });

  return button;
}

/**
 * The templates people reach for most. Fifteen chips filled half the screen,
 * so the chat shows only a few, picked at random from these on each open —
 * with a small chance that one of the others takes the last slot, so they
 * still get seen. Any template is still one typed sentence away.
 */
const EVERYDAY = ['birthday', 'bills', 'water', 'medicine', 'gym', 'interview', 'list', 'routine'];

const shuffled = (items) => items
  .map((item) => ({ item, key: Math.random() }))
  .sort((left, right) => left.key - right.key)
  .map(({ item }) => item);

/** 3 or 4 suggestions, mostly everyday ones, in a new order each time. */
function suggestions(all) {
  const count = 3 + Math.floor(Math.random() * 2);
  const everyday = shuffled(all.filter((template) => EVERYDAY.includes(template.id)));
  const others = shuffled(all.filter((template) => !EVERYDAY.includes(template.id)));
  const picked = everyday.slice(0, count);
  const other = others[0];
  if (other !== undefined && Math.random() < 0.3) picked[picked.length - 1] = other;

  return picked;
}

/** Locks the answer bar: nothing can be sent while the AI is not reachable. */
function lockInput(locked) {
  form.inert = locked;
}

/** Bumped on every open, so a slow health answer from an earlier open is ignored. */
let openNumber = 0;

/**
 * Opens on a quick check that the AI answers at all — the server pings a small
 * model, and any failure (expired key, no credit, an outage) comes back as
 * "not available". The person is told that and nothing more, before typing
 * anything that could not be answered.
 */
async function reset() {
  const number = ++openNumber;
  log.replaceChildren();
  chips.hidden = true;
  sessionId = null;
  showControl({ input: 'text' });
  textBox.value = '';
  textBox.placeholder = 'Tell me what you want to set up';
  lockInput(true);

  const checking = bubble('ai bubble--typing', 'Checking that the AI is available…');
  const available = await fetchAssistantHealth(token)
    .then((health) => health.available === true)
    .catch(() => false);
  if (number !== openNumber) return;

  checking.remove();
  if (!available) {
    bubble('error', 'The AI assistant is not available right now. Please try again later, or add the task by hand.');

    return;
  }

  chips.replaceChildren(...suggestions(templates || []).map(chip));
  chips.hidden = false;
  lockInput(false);
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
  dialog.showModal();
  watchKeyboard(true);
  trackKeyboard();
  void reset();
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
  void reset();
});
dialog.addEventListener('close', () => {
  watchKeyboard(false);
  endSession();
});
