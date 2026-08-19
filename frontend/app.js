/* ---------------------------------------------------------------------------
   Task list, reading from the API.

   Only the GET endpoints are wired. Marking done, deleting and adding act on
   the copy held here so the interaction can be seen, but they do not persist —
   a reload brings back whatever the server has.

   The server decides which tasks are passed / actual / upcoming and which
   category they belong to; this file asks for a slice and draws it.
--------------------------------------------------------------------------- */
import {
  createRepeatedTask, createTask, deleteRepeatedTask, deleteTask, fetchRepeatedTasks,
  fetchTasks, forgetCredentials, readCredentials, replaceTask, saveCredentials,
  setStepStatus, setTaskStatus, signUp,
} from './api.js?v=3';

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

const doneSteps = (task) => task.subtasks.filter((sub) => sub.status === 'DONE').length;

const stepPercent = (task) => (task.subtasks.length === 0
  ? 0
  : Math.round((doneSteps(task) / task.subtasks.length) * 100));

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

/**
 * Steps, always on the card. Each one has a round check on the left, the same
 * affordance the task itself uses, and the line above reports progress.
 */
function stepsSection(task) {
  const section = document.createElement('div');
  section.className = 'steps';

  const head = document.createElement('div');
  head.className = 'steps__head';

  const label = document.createElement('span');
  label.className = 'steps__label';
  const percent = stepPercent(task);
  label.textContent = `${String(doneSteps(task))}/${String(task.subtasks.length)} steps · ${String(percent)}%`;

  const bar = document.createElement('span');
  bar.className = 'steps__bar';
  bar.setAttribute('role', 'progressbar');
  bar.setAttribute('aria-valuenow', String(percent));
  bar.setAttribute('aria-valuemin', '0');
  bar.setAttribute('aria-valuemax', '100');
  bar.setAttribute('aria-label', `${String(percent)}% of steps done`);

  const fill = document.createElement('span');
  fill.className = 'steps__fill';
  fill.style.width = `${String(percent)}%`;
  bar.append(fill);

  head.append(label, bar);
  section.append(head);

  const list = document.createElement('ul');
  list.className = 'steps__list';

  for (const step of task.subtasks) {
    const done = step.status === 'DONE';
    const item = document.createElement('li');
    item.className = done ? 'step step--done' : 'step';

    const check = document.createElement('button');
    check.type = 'button';
    check.className = 'step__check';
    check.textContent = '✓';
    check.setAttribute('aria-pressed', String(done));
    check.setAttribute('aria-label', `Mark step ${step.name} as ${done ? 'not done' : 'done'}`);
    check.addEventListener('click', () => { toggleStep(task, step); });

    const name = document.createElement('span');
    name.className = 'step__name';
    name.textContent = step.name;

    item.append(check, name);

    if (step.link) {
      const link = document.createElement('a');
      link.className = 'step__link';
      link.href = step.link;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.textContent = '↗';
      link.title = step.link;
      link.setAttribute('aria-label', `Open the link for ${step.name}`);
      item.append(link);
    }

    list.append(item);
  }

  section.append(list);

  return section;
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

  // Nothing is said about a basic task having no date: that is what it is.
  body.append(meta);

  if (task.subtasks.length > 0) body.append(stepsSection(task));

  const actions = document.createElement('div');
  actions.className = 'task__actions';
  actions.append(iconButton(`Delete ${task.name}`, '🗑', () => { remove(task); }));

  // Tapping the card edits it. Clicks that land on a control inside it — a
  // step's check, a link, delete — are that control's, not the card's.
  body.addEventListener('click', (event) => {
    if (event.target.closest('button, a')) return;
    openEditor(task);
  });
  body.classList.add('task__body--tappable');

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

/**
 * Done sinks to the bottom; above it, whatever has a time comes in time order,
 * and undated tasks follow. Id last so the order never wobbles between reads.
 */
function inListOrder(left, right) {
  const finished = (task) => (task.status === 'DONE' ? 1 : 0);
  if (finished(left) !== finished(right)) return finished(left) - finished(right);

  const at = (task) => (hasDate(task) ? new Date(task.date).getTime() : Number.POSITIVE_INFINITY);
  if (at(left) !== at(right)) return at(left) - at(right);

  return left.id.localeCompare(right.id);
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

  if (status === 'signed-out') {
    const signInAgain = document.createElement('button');
    signInAgain.type = 'button';
    signInAgain.className = 'btn state__action';
    signInAgain.textContent = 'Sign in';
    signInAgain.addEventListener('click', () => { void askForCredentials(); });
    summaryEl.textContent = '';
    listEl.replaceChildren(message('🔑', 'Sign in to see your tasks.', signInAgain));

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

  const ordered = [...tasks].sort(inListOrder);
  const groups = groupOrder
    .map((key) => [key, ordered.filter((task) => (task.category ?? OTHER_KEY) === key)])
    .filter(([, items]) => items.length > 0)
    .map(([key, items]) => taskGroup(key, items));

  listEl.replaceChildren(...groups);
}

/* --- local-only actions (no write endpoints wired yet) -------------------- */

/**
 * Draw the change straight away, then send it. A failure reloads from the
 * server rather than guessing what the truth is.
 */
function apply(change, send, describe) {
  change();
  render();

  void send().then(
    () => { announcer.textContent = describe; },
    (error) => {
      if (error.message === 'UNAUTHORIZED') return load();
      announcer.textContent = 'That did not save — reloading';

      return load();
    },
  );
}

function toggleDone(task) {
  const status = task.status === 'DONE' ? 'TODO' : 'DONE';

  apply(
    () => { task.status = status; },
    () => setTaskStatus(credentials.token, task.id, status),
    `${task.name} marked ${status === 'DONE' ? 'done' : 'not done'}`,
  );
}

function toggleStep(task, step) {
  const status = step.status === 'DONE' ? 'TODO' : 'DONE';

  apply(
    () => { step.status = status; },
    () => setStepStatus(credentials.token, task.id, step.id, status),
    `${step.name} ${status === 'DONE' ? 'done' : 'not done'} — ${String(stepPercent(task))}% of ${task.name}`,
  );
}

function remove(task) {
  // Deleting is the one action here with nothing behind it — no undo, and the
  // server has no trash.
  if (!confirmDelete(`Delete "${task.name}"?`)) return;

  apply(
    () => {
      const index = tasks.indexOf(task);
      if (index !== -1) tasks.splice(index, 1);
    },
    () => deleteTask(credentials.token, task.id),
    `${task.name} deleted`,
  );
}

/** A plain confirm, deliberately: it is one question and it must block. */
const confirmDelete = (question) => window.confirm(question);

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
      status = 'signed-out';
      render();
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

/* --- repeats, which are otherwise only visible through their events ------- */

const repeatsDialog = document.getElementById('repeats');
const repeatsList = document.getElementById('repeats-list');

const SCHEDULE_LABEL = {
  DAILY: (config) => `every ${String(config.repeatEach.hour)}h${config.repeatEach.minute
    ? String(config.repeatEach.minute) : ''}, ${String(config.startsAt.hour)}:00–${String(config.endsAt.hour)}:00`,
  REPEATED_WEEKLY: (config) => `weekdays ${config.weekdays.join(', ')}`,
  REPEATED_MONTHLY: (config) => `day ${String(config.fromDay)} of months ${config.months.join(', ')}`,
};

function repeatRow(config) {
  const row = document.createElement('div');
  row.className = 'row repeat';

  const text = document.createElement('span');
  text.className = 'repeat__text';
  const describe = SCHEDULE_LABEL[config.type];
  text.textContent = `${categoryOf(config.category).icon} ${config.name} — ${describe(config)}`;

  const remove = document.createElement('button');
  remove.type = 'button';
  remove.className = 'row__remove';
  remove.textContent = '🗑';
  remove.setAttribute('aria-label', `Delete the ${config.name} repeat`);
  remove.addEventListener('click', () => {
    if (!confirmDelete(`Delete the "${config.name}" repeat and the events it made?`)) return;

    void deleteRepeatedTask(credentials.token, config.id).then(() => {
      announcer.textContent = `${config.name} repeat deleted`;

      return Promise.all([openRepeats(), load()]);
    });
  });

  row.append(text, remove);

  return row;
}

async function openRepeats() {
  repeatsList.replaceChildren(message('⏳', 'Loading…'));
  if (!repeatsDialog.open) repeatsDialog.showModal();

  try {
    const configs = await fetchRepeatedTasks(credentials.token);
    repeatsList.replaceChildren(...(configs.length === 0
      ? [message('🔁', 'No repeats yet. Add one with +, choosing "Repeats".')]
      : configs.map(repeatRow)));
  } catch {
    repeatsList.replaceChildren(message('⚠️', 'Could not load them.'));
  }
}

document.getElementById('show-repeats').addEventListener('click', () => {
  closeMenu();
  void openRepeats();
});

document.getElementById('repeats-close').addEventListener('click', () => { repeatsDialog.close(); });

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

document.getElementById('signup').addEventListener('click', () => {
  const data = new FormData(signInForm);
  const username = String(data.get('username')).trim();
  const password = String(data.get('password'));
  if (username === '' || password === '') {
    signInNote.textContent = 'Fill both fields first.';
    signInNote.classList.add('composer__note--error');

    return;
  }

  void signUp(username, password).then(
    () => saveCredentials(username, password).then((saved) => {
      credentials = saved;
      showWho();
      signIn.close();

      return load();
    }),
    (error) => {
      signInNote.textContent = error.message === 'TAKEN'
        ? 'That username is taken. Sign in instead, or pick another.'
        : error.message;
      signInNote.classList.add('composer__note--error');
    },
  );
});

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

const draft = { kind: null, schedule: null, editing: null };

const stepPanel = (name) => document.querySelector(`[data-step="${name}"]`);

const TITLES = {
  kind: 'What are you adding?',
  schedule: 'How often?',
  details: 'Details',
};

const saveButton = document.getElementById('details-save');

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
  // Filtering by a category and then adding almost always means adding to it.
  const preferred = activeCategory === 'all' ? OTHER_KEY : activeCategory;

  const select = document.getElementById('composer-category');
  select.replaceChildren(...[...Object.entries(CATEGORIES), [OTHER_KEY, OTHER_CATEGORY]]
    .map(([key, meta]) => {
      const option = document.createElement('option');
      option.value = key;
      option.textContent = `${meta.icon}  ${meta.label}`;
      if (key === preferred) option.selected = true;

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

  const editing = draft.editing !== null;
  const total = draft.kind === 'REPEATED' ? 3 : 2;
  const current = name === 'kind' ? 1 : (name === 'schedule' ? 2 : total);

  wizardTitle.textContent = editing ? 'Edit task' : TITLES[name];
  // Editing has no earlier step to report or return to: the type is fixed.
  wizardSteps.textContent = editing ? 'Changing the type means deleting and adding again'
    : `Step ${String(current)} of ${String(total)}`;
  backButton.hidden = editing || name === 'kind';
  saveButton.textContent = editing ? 'Save' : 'Add';
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
  draft.editing = null;
  composerForm.reset();
  fillCategories();
  linkRows.replaceChildren();
  subtaskRows.replaceChildren();
  toggleGroup(document.getElementById('weekday-toggles'), WEEKDAYS, [1]);
  toggleGroup(document.getElementById('month-toggles'), MONTHS, [new Date().getMonth() + 1]);
  showStep('kind');
  composer.showModal();
});

/** Fills the final step with a task's own values and opens it there. */
function openEditor(task) {
  if (task.configTaskId) {
    announcer.textContent = `${task.name} comes from a repeat — edit the repeat instead`;
    void openRepeats();

    return;
  }

  draft.kind = task.type;
  draft.schedule = null;
  draft.editing = task;

  composerForm.reset();
  fillCategories();
  linkRows.replaceChildren();
  subtaskRows.replaceChildren();
  toggleGroup(document.getElementById('weekday-toggles'), WEEKDAYS, []);
  toggleGroup(document.getElementById('month-toggles'), MONTHS, []);

  composerForm.elements['name'].value = task.name;
  composerForm.elements['category'].value = task.category;
  if (task.date) {
    // datetime-local wants local wall-clock time, not the stored UTC string.
    const local = new Date(new Date(task.date).getTime() - new Date().getTimezoneOffset() * 60000);
    composerForm.elements['date'].value = local.toISOString().slice(0, 16);
  }

  for (const url of task.links ?? []) addLinkRow().querySelector('input').value = url;
  for (const step of task.subtasks) {
    const [name, link] = addSubtaskRow().querySelectorAll('input');
    name.value = step.name;
    if (step.link) link.value = step.link;
  }

  showStep('details');
  composer.showModal();
}

document.getElementById('details-cancel').addEventListener('click', () => { composer.close(); });

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
  const payload = draftPayload(new FormData(composerForm));
  if (payload.name === '') return;

  // A repeat is a config: the server makes the event, so reload rather than
  // guessing what it produced.
  const editing = draft.editing;
  let send = () => createTask(credentials.token, payload);
  if (editing !== null) send = () => replaceTask(credentials.token, editing.id, payload);
  else if (draft.kind === 'REPEATED') send = () => createRepeatedTask(credentials.token, payload);

  status = 'loading';
  render();

  void send().then(
    () => {
      announcer.textContent = `${payload.name} ${editing === null ? 'added' : 'saved'}`;

      return load();
    },
    (error) => {
      if (error.message === 'UNAUTHORIZED') return load();
      announcer.textContent = `Could not save ${payload.name}: ${error.message}`;

      return load();
    },
  );
});

/* --- start ---------------------------------------------------------------- */

async function start() {
  try {
    credentials = await readCredentials() ?? null;
  } catch {
    // A blocked or broken credentials store must not leave a blank screen.
    credentials = null;
  }

  showWho();

  if (credentials === null) {
    // Draw something behind the dialog, so dismissing it leaves a way back in
    // rather than a spinner that never resolves.
    status = 'signed-out';
    render();
    await askForCredentials();

    return;
  }

  await load();
}

void start();
