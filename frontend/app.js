/* ---------------------------------------------------------------------------
   Task list, reading from the API.

   Only the GET endpoints are wired. Marking done, deleting and adding act on
   the copy held here so the interaction can be seen, but they do not persist —
   a reload brings back whatever the server has.

   The server decides which tasks are passed / actual / upcoming and which
   category they belong to; this file asks for a slice and draws it.
--------------------------------------------------------------------------- */
import {
  fetchTasks, forgetCredentials, readCredentials, saveCredentials,
} from './api.js';

/**
 * Categories, colours and icons carried over from the previous app. Keys match
 * the API's own values, so nothing has to translate between the two. Each
 * keeps a fixed colour slot; the neon values are only ever shown mixed into
 * the surface (see styles.css), so they read as identity without shouting.
 */
const CATEGORIES = {
  IMPORTANT: { label: 'Important', color: '#fb1919', icon: '⭐' },
  WORK: { label: 'Work', color: '#13c2f9', icon: '💼' },
  SUPPLEMENTS: { label: 'Supplements', color: '#27b621', icon: '💊' },
  FOOD: { label: 'Food', color: '#ffed02', icon: '🍎' },
  EDUCATION: { label: 'Education', color: '#bce211', icon: '🎓' },
  SELFCARE: { label: 'Selfcare', color: '#13d4c7', icon: '🧘' },
  GYM: { label: 'Gym', color: '#ff8000', icon: '🏋️' },
  READING: { label: 'Reading', color: '#f5228e', icon: '📖' },
};

/** The server's bucket for anything created without a category. */
const OTHER_KEY = 'OTHER';
const OTHER_CATEGORY = { label: 'Other', color: '#9ca3af', icon: '🗂️' };

const categoryOf = (key) => CATEGORIES[key] ?? OTHER_CATEGORY;

const DAY = 24 * 60 * 60 * 1000;

/* --- state ---------------------------------------------------------------- */

let tasks = [];
let credentials = null;
let activeFilter = 'actual';
let activeCategory = 'all';
let status = 'loading';

/* --- formatting ----------------------------------------------------------- */

const time = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit' });
const dayAndDate = new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });

const startOfToday = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; };

const startOfDayOf = (date) => { const d = new Date(date); d.setHours(0, 0, 0, 0); return d; };

const hasDate = (task) => typeof task.date === 'string';

const hasPassed = (task) => hasDate(task) && new Date(task.date) <= new Date();

function whenLabel(task) {
  const date = new Date(task.date);
  // Calendar days apart, not hours apart: 22:00 today is still today.
  const days = Math.round((startOfDayOf(date) - startOfToday()) / DAY);
  if (days === 0) return `Today ${time.format(date)}`;
  if (days === 1) return `Tomorrow ${time.format(date)}`;
  if (days === -1) return `Yesterday ${time.format(date)}`;

  return `${dayAndDate.format(date)} ${time.format(date)}`;
}

const subtaskLabel = (task) => {
  const done = task.subtasks.filter((sub) => sub.status === 'DONE').length;

  return `${done}/${task.subtasks.length} steps`;
};

/* --- rendering ------------------------------------------------------------ */

const listEl = document.getElementById('list');
const summaryEl = document.getElementById('summary');
const categoriesEl = document.getElementById('categories');
const announcer = document.getElementById('announcer');
const whoEl = document.getElementById('who');

function chip(text, modifier) {
  const el = document.createElement('span');
  el.className = modifier ? `chip chip--${modifier}` : 'chip';
  el.textContent = text;

  return el;
}

function iconButton(label, glyph, onClick) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'icon-btn';
  button.setAttribute('aria-label', label);
  button.textContent = glyph;
  button.addEventListener('click', onClick);

  return button;
}

function whenChip(task) {
  const done = task.status === 'DONE';
  const overdue = hasPassed(task) && !done;
  let modifier = 'when';
  if (overdue) modifier = 'overdue';
  else if (done) modifier = 'done';
  else if (new Date(task.date) > new Date()) modifier = 'when';

  return chip(overdue ? `Missed · ${whenLabel(task)}` : whenLabel(task), modifier);
}

function taskItem(task) {
  const done = task.status === 'DONE';
  const item = document.createElement('li');
  item.className = done ? 'task task--done' : 'task';

  const check = document.createElement('button');
  check.type = 'button';
  check.className = 'task__check';
  check.textContent = '✓';
  check.setAttribute('aria-pressed', String(done));
  check.setAttribute('aria-label', `Mark ${task.name} as ${done ? 'not done' : 'done'}`);
  check.addEventListener('click', () => { toggleDone(task); });

  const body = document.createElement('div');
  body.className = 'task__body';

  const name = document.createElement('p');
  name.className = 'task__name';
  name.textContent = task.name;
  body.append(name);

  const meta = document.createElement('div');
  meta.className = 'task__meta';
  if (hasDate(task)) meta.append(whenChip(task));

  if (task.configTaskId) {
    const repeat = chip('🔁', 'repeat');
    repeat.title = 'Generated by a repeated task';
    repeat.setAttribute('aria-label', 'Generated by a repeated task');
    meta.append(repeat);
  }

  if (task.links?.length) {
    const links = chip(`🔗 ${String(task.links.length)}`);
    links.title = task.links.join('\n');
    meta.append(links);
  }

  if (task.subtasks.length > 0) meta.append(chip(subtaskLabel(task)));
  if (!hasDate(task)) meta.append(chip('No date'));
  body.append(meta);

  const actions = document.createElement('div');
  actions.className = 'task__actions';
  actions.append(iconButton(`Delete ${task.name}`, '🗑', () => { remove(task); }));

  item.append(check, body, actions);

  return item;
}

const groupOrder = [...Object.keys(CATEGORIES), OTHER_KEY];

function taskGroup(key, items) {
  const { label, icon, color } = categoryOf(key);

  const section = document.createElement('section');
  section.className = 'group';
  section.style.setProperty('--cat', color);

  const heading = document.createElement('h3');
  heading.className = 'group__title';

  const mark = document.createElement('span');
  mark.className = 'group__icon';
  mark.setAttribute('aria-hidden', 'true');
  mark.textContent = icon;

  const name = document.createElement('span');
  name.textContent = label;

  const count = document.createElement('span');
  count.className = 'group__count';
  count.textContent = String(items.length);

  heading.append(mark, name, count);

  const list = document.createElement('ul');
  list.className = 'group__items';
  list.append(...items.map(taskItem));

  section.append(heading, list);

  return section;
}

function message(icon, text, action) {
  const wrap = document.createElement('div');
  wrap.className = 'state';

  const mark = document.createElement('div');
  mark.className = 'state__icon';
  mark.setAttribute('aria-hidden', 'true');
  mark.textContent = icon;

  const line = document.createElement('p');
  line.className = 'state__text';
  line.textContent = text;

  wrap.append(mark, line);
  if (action) wrap.append(action);

  return wrap;
}

function emptyState() {
  const messages = {
    passed: ['🕓', 'Nothing has gone by yet.'],
    actual: ['🎯', 'Nothing needs doing right now.'],
    upcoming: ['🌱', 'Nothing further out.'],
  };
  const [icon, text] = messages[activeFilter];

  return message(icon, text);
}

function renderCategories() {
  const all = document.createElement('button');
  all.type = 'button';
  all.className = 'category category--all';
  all.dataset.category = 'all';
  all.setAttribute('aria-pressed', String(activeCategory === 'all'));
  all.setAttribute('aria-label', 'All categories');
  all.title = 'All categories';
  all.textContent = 'All';
  all.addEventListener('click', () => { selectCategory('all'); });

  const buttons = [...Object.entries(CATEGORIES), [OTHER_KEY, OTHER_CATEGORY]]
    .map(([key, meta]) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'category';
      button.dataset.category = key;
      button.style.setProperty('--cat', meta.color);
      button.setAttribute('aria-pressed', String(activeCategory === key));
      button.setAttribute('aria-label', meta.label);
      button.title = meta.label;
      const icon = document.createElement('span');
      icon.className = 'category__icon';
      icon.setAttribute('aria-hidden', 'true');
      icon.textContent = meta.icon;
      button.append(icon);
      button.addEventListener('click', () => { selectCategory(key); });

      return button;
    });

  categoriesEl.replaceChildren(all, ...buttons);
}

function render() {
  renderCategories();

  document.querySelectorAll('.filter').forEach((button) => {
    button.setAttribute('aria-pressed', String(button.dataset.state === activeFilter));
  });

  if (status === 'loading') {
    summaryEl.textContent = '';
    listEl.replaceChildren(message('⏳', 'Loading…'));

    return;
  }

  if (status === 'error') {
    const retry = document.createElement('button');
    retry.type = 'button';
    retry.className = 'btn state__action';
    retry.textContent = 'Try again';
    retry.addEventListener('click', () => { void load(); });
    summaryEl.textContent = '';
    listEl.replaceChildren(message('⚠️', 'Could not reach the server.', retry));

    return;
  }

  const left = tasks.filter((task) => task.status !== 'DONE').length;
  summaryEl.textContent = tasks.length === 0 ? '' : `${String(left)} of ${String(tasks.length)} left`;

  if (tasks.length === 0) {
    listEl.replaceChildren(emptyState());

    return;
  }

  const groups = groupOrder
    .map((key) => [key, tasks.filter((task) => (task.category ?? OTHER_KEY) === key)])
    .filter(([, items]) => items.length > 0)
    .map(([key, items]) => taskGroup(key, items));

  listEl.replaceChildren(...groups);
}

/* --- local-only actions (no write endpoints wired yet) -------------------- */

function toggleDone(task) {
  task.status = task.status === 'DONE' ? 'TODO' : 'DONE';
  announcer.textContent = `${task.name} marked ${task.status === 'DONE' ? 'done' : 'not done'} (not saved yet)`;
  render();
}

function remove(task) {
  const index = tasks.indexOf(task);
  if (index !== -1) tasks.splice(index, 1);
  announcer.textContent = `${task.name} removed from the list (not saved yet)`;
  render();
}

/* --- loading -------------------------------------------------------------- */

async function load() {
  if (credentials === null) return;

  status = 'loading';
  render();

  try {
    tasks = await fetchTasks(credentials.token, {
      filter: activeFilter,
      category: activeCategory,
    });
    status = 'ready';
  } catch (error) {
    if (error.message === 'UNAUTHORIZED') {
      await forgetCredentials();
      credentials = null;
      showWho();
      await askForCredentials('Those credentials were not accepted. Try again.');

      return;
    }

    status = 'error';
  }

  render();
}

function selectCategory(key) {
  activeCategory = key;
  void load();
}

document.querySelectorAll('.filter').forEach((button) => {
  button.addEventListener('click', () => {
    activeFilter = button.dataset.state;
    void load();
  });
});

/* --- who is signed in, and signing out ------------------------------------ */

function showWho() {
  whoEl.textContent = credentials === null ? '' : credentials.username;
}

const optionsButton = document.getElementById('options');
const menuPanel = document.getElementById('menu-panel');

function closeMenu() {
  menuPanel.hidden = true;
  optionsButton.setAttribute('aria-expanded', 'false');
}

optionsButton.addEventListener('click', (event) => {
  event.stopPropagation();
  const open = menuPanel.hidden;
  menuPanel.hidden = !open;
  optionsButton.setAttribute('aria-expanded', String(open));
});

// Anywhere else, or Escape, puts it away again.
document.addEventListener('click', closeMenu);
document.addEventListener('keydown', (event) => { if (event.key === 'Escape') closeMenu(); });
menuPanel.addEventListener('click', (event) => { event.stopPropagation(); });

document.getElementById('signout').addEventListener('click', () => {
  closeMenu();
  void signOut();
});

async function signOut() {
  await forgetCredentials();
  credentials = null;
  tasks = [];
  showWho();
  render();
  await askForCredentials();
}

/* --- credentials ---------------------------------------------------------- */

const signIn = document.getElementById('signin');
const signInForm = document.getElementById('signin-form');
const signInNote = document.getElementById('signin-note');
const DEFAULT_NOTE = signInNote.textContent;

function askForCredentials(note) {
  signInNote.textContent = note ?? DEFAULT_NOTE;
  signInNote.classList.toggle('composer__note--error', Boolean(note));
  signInForm.reset();
  signIn.showModal();

  return new Promise((resolve) => { signIn.addEventListener('close', resolve, { once: true }); });
}

signInForm.addEventListener('submit', () => {
  const data = new FormData(signInForm);
  const username = String(data.get('username')).trim();
  const password = String(data.get('password'));

  void saveCredentials(username, password).then((saved) => {
    credentials = saved;
    showWho();

    return load();
  });
});

/* --- the create wizard ---------------------------------------------------- */
/* Three steps, and the middle one only exists for repeating tasks:
     1. what kind of thing is this
     2. repeats -> which schedule; anything else -> straight to the details
     3. the details for whatever was chosen
   No write endpoint is wired yet, so finishing adds to the local list and says
   so rather than pretending it was saved. */

const WEEKDAYS = [
  { value: 1, label: 'Mo' }, { value: 2, label: 'Tu' }, { value: 3, label: 'We' },
  { value: 4, label: 'Th' }, { value: 5, label: 'Fr' }, { value: 6, label: 'Sa' },
  { value: 0, label: 'Su' },
];

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  .map((label, index) => ({ value: index + 1, label }));

const composer = document.getElementById('composer');
const composerForm = document.getElementById('composer-form');
const wizardTitle = document.getElementById('wizard-title');
const wizardSteps = document.getElementById('wizard-steps');
const backButton = document.getElementById('wizard-back');

const draft = { kind: null, schedule: null };

const stepPanel = (name) => document.querySelector(`[data-step="${name}"]`);

const TITLES = {
  kind: 'What are you adding?',
  schedule: 'How often?',
  details: 'Details',
};

function toggleGroup(container, options, selected) {
  container.replaceChildren(...options.map(({ value, label }) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'toggle';
    button.textContent = label;
    button.dataset.value = String(value);
    button.setAttribute('aria-pressed', String(selected.includes(value)));
    button.addEventListener('click', () => {
      const on = button.getAttribute('aria-pressed') === 'true';
      button.setAttribute('aria-pressed', String(!on));
    });

    return button;
  }));
}

const linkRows = document.getElementById('link-rows');
const subtaskRows = document.getElementById('subtask-rows');

function inputCell(placeholder, type = 'text') {
  const input = document.createElement('input');
  input.className = 'field__input';
  input.type = type;
  input.placeholder = placeholder;
  input.autocomplete = 'off';

  return input;
}

/** One removable row; `cells` are the inputs it holds. */
function addRow(container, cells) {
  const row = document.createElement('div');
  row.className = 'row';

  const remove = document.createElement('button');
  remove.type = 'button';
  remove.className = 'row__remove';
  remove.textContent = '✕';
  remove.setAttribute('aria-label', 'Remove');
  remove.addEventListener('click', () => { row.remove(); });

  row.append(...cells, remove);
  container.append(row);

  return row;
}

const addLinkRow = () => addRow(linkRows, [inputCell('https://…', 'url')]);

const addSubtaskRow = () => addRow(subtaskRows, [
  inputCell('Step name'),
  inputCell('https://… (optional)', 'url'),
]);

/** Non-empty values from a row container, column by column. */
function rowValues(container) {
  return [...container.querySelectorAll('.row')].map((row) => {
    const inputs = [...row.querySelectorAll('.field__input')];

    return inputs.map((input) => input.value.trim());
  });
}

const chosenValues = (container) => [...container.querySelectorAll('[aria-pressed="true"]')]
  .map((button) => Number(button.dataset.value));

function fillCategories() {
  const select = document.getElementById('composer-category');
  select.replaceChildren(...[...Object.entries(CATEGORIES), [OTHER_KEY, OTHER_CATEGORY]]
    .map(([key, meta]) => {
      const option = document.createElement('option');
      option.value = key;
      option.textContent = `${meta.icon}  ${meta.label}`;
      if (key === OTHER_KEY) option.selected = true;

      return option;
    }));
}

/** Shows one panel, and within the details panel only the relevant fields. */
function showStep(name) {
  for (const panel of document.querySelectorAll('.wizard__step')) {
    panel.hidden = panel.dataset.step !== name;
  }

  if (name === 'details') {
    // A field lists every type it belongs to, so links can be shared by all of
    // them while the schedule fields stay with their own schedule.
    const shownFor = draft.schedule ?? draft.kind;
    for (const field of document.querySelectorAll('[data-for]')) {
      field.hidden = !field.dataset.for.split(' ').includes(shownFor);
    }
  }

  const total = draft.kind === 'REPEATED' ? 3 : 2;
  const current = name === 'kind' ? 1 : (name === 'schedule' ? 2 : total);
  wizardTitle.textContent = TITLES[name];
  wizardSteps.textContent = `Step ${String(current)} of ${String(total)}`;
  backButton.hidden = name === 'kind';
  composer.dataset.step = name;
}

document.querySelectorAll('[data-kind]').forEach((button) => {
  button.addEventListener('click', () => {
    draft.kind = button.dataset.kind;
    draft.schedule = null;
    showStep(draft.kind === 'REPEATED' ? 'schedule' : 'details');
  });
});

document.querySelectorAll('[data-schedule]').forEach((button) => {
  button.addEventListener('click', () => {
    draft.schedule = button.dataset.schedule;
    showStep('details');
  });
});

backButton.addEventListener('click', () => {
  const step = composer.dataset.step;
  if (step === 'details' && draft.kind === 'REPEATED') showStep('schedule');
  else showStep('kind');
});

document.getElementById('wizard-close').addEventListener('click', () => { composer.close(); });
document.getElementById('add-link').addEventListener('click', () => { addLinkRow(); });
document.getElementById('add-subtask').addEventListener('click', () => { addSubtaskRow(); });

document.getElementById('add').addEventListener('click', () => {
  draft.kind = null;
  draft.schedule = null;
  composerForm.reset();
  fillCategories();
  linkRows.replaceChildren();
  subtaskRows.replaceChildren();
  toggleGroup(document.getElementById('weekday-toggles'), WEEKDAYS, [1]);
  toggleGroup(document.getElementById('month-toggles'), MONTHS, [new Date().getMonth() + 1]);
  showStep('kind');
  composer.showModal();
});

const timeParts = (value) => {
  const [hour, minute] = String(value).split(':').map(Number);

  return { hour: hour || 0, minute: minute || 0 };
};

/** What would be sent to the API, shaped exactly as the endpoints expect. */
function draftPayload(data) {
  const name = String(data.get('name')).trim();
  const category = String(data.get('category'));
  const links = rowValues(linkRows).map(([url]) => url).filter(Boolean);
  const subtasks = rowValues(subtaskRows)
    .filter(([stepName]) => stepName !== '')
    .map(([stepName, link]) => (link ? { name: stepName, link } : { name: stepName }));

  const shared = { name, category, ...(links.length ? { links } : {}) };

  if (draft.kind === 'BASIC') return { type: 'BASIC', ...shared, subtasks };
  if (draft.kind === 'EVENT') {
    return {
      type: 'EVENT',
      ...shared,
      subtasks,
      date: new Date(String(data.get('date'))).toISOString(),
    };
  }

  if (draft.schedule === 'DAILY') {
    return {
      type: 'DAILY',
      ...shared,
      startsAt: timeParts(data.get('startsAt')),
      endsAt: timeParts(data.get('endsAt')),
      repeatEach: timeParts(data.get('repeatEach')),
    };
  }

  if (draft.schedule === 'REPEATED_WEEKLY') {
    return {
      type: 'REPEATED_WEEKLY',
      ...shared,
      weekdays: chosenValues(document.getElementById('weekday-toggles')),
    };
  }

  return {
    type: 'REPEATED_MONTHLY',
    ...shared,
    fromDay: Number(data.get('fromDay')),
    toDay: Number(data.get('toDay')),
    months: chosenValues(document.getElementById('month-toggles')),
  };
}

composerForm.addEventListener('submit', () => {
  const data = new FormData(composerForm);
  const payload = draftPayload(data);
  if (payload.name === '') return;

  if (draft.kind === 'REPEATED') {
    // A config produces events on the server; there is nothing sensible to
    // show locally until the write endpoint is wired.
    announcer.textContent = `${payload.name} repeat ready to send (not saved yet)`;
    render();

    return;
  }

  tasks.unshift({
    id: `local-${String(Date.now())}`,
    links: [],
    subtasks: [],
    ...payload,
    status: 'TODO',
    configTaskId: null,
  });

  announcer.textContent = `${payload.name} added to the list (not saved yet)`;
  render();
});

/* --- start ---------------------------------------------------------------- */

async function start() {
  credentials = await readCredentials() ?? null;
  showWho();
  if (credentials === null) {
    await askForCredentials();

    return;
  }

  await load();
}

void start();
