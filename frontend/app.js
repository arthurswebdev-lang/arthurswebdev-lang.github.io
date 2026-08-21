/* ---------------------------------------------------------------------------
   Task list, reading from the API.

   Only the GET endpoints are wired. Marking done, deleting and adding act on
   the copy held here so the interaction can be seen, but they do not persist —
   a reload brings back whatever the server has.

   The server decides which tasks are passed / actual / upcoming and which
   category they belong to; this file asks for a slice and draws it.
--------------------------------------------------------------------------- */
import {
  clearTasks, createRepeatedTask, createTask, deleteRepeatedTask, deleteTask, fetchRepeatedTask,
  fetchRepeatedTasks, fetchTasks, forgetCredentials, readCredentials, replaceRepeatedTask,
  replaceTask, saveCredentials, sendTestNotification, setStepStatus, setTaskStatus, signUp,
} from './api.js?v=20';
import {
  enableNotifications, notificationState, refreshRegistration,
} from './notifications.js?v=20';

/**
 * Categories, colours and icons carried over from the previous app. Keys match
 * the API's own values, so nothing has to translate between the two. Each
 * keeps a fixed colour slot; the neon values are only ever shown mixed into
 * the surface (see styles.css), so they read as identity without shouting.
 */
const CATEGORIES = {
  IMPORTANT: { label: 'Important', color: '#db4437', icon: '⭐' },
  WORK: { label: 'Work', color: '#4285f4', icon: '💼' },
  SUPPLEMENTS: { label: 'Supplements', color: '#0f9d58', icon: '💊' },
  FOOD: { label: 'Food', color: '#f4b400', icon: '🍎' },
  EDUCATION: { label: 'Education', color: '#9334e6', icon: '🎓' },
  SELFCARE: { label: 'Selfcare', color: '#12b5cb', icon: '🧘' },
  GYM: { label: 'Gym', color: '#e8710a', icon: '🏋️' },
  READING: { label: 'Reading', color: '#e52592', icon: '📖' },
};

/** The server's bucket for anything created without a category. */
const OTHER_KEY = 'OTHER';
const OTHER_CATEGORY = { label: 'Other', color: '#666666', icon: '🗂️' };

const categoryOf = (key) => CATEGORIES[key] ?? OTHER_CATEGORY;

const DAY = 24 * 60 * 60 * 1000;

/* --- state ---------------------------------------------------------------- */

let tasks = [];
let credentials = null;
let activeFilter = 'actual';
let activeCategory = 'all';

/**
 * Which categories currently hold something, as of the last unnarrowed read.
 *
 * Kept rather than derived on the spot because `tasks` is not always the whole
 * picture: the server narrows the query when a category is picked, so deriving
 * from it then would leave that one pill on screen and no way back to the
 * others. Refreshed only while 'all' is showing, which is the one time the
 * list is known to cover every category.
 */
let categoriesInUse = new Set();
let status = 'loading';

/* --- formatting ----------------------------------------------------------- */

const time = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit' });
const dayAndDate = new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });

const startOfToday = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; };

const startOfDayOf = (date) => { const d = new Date(date); d.setHours(0, 0, 0, 0); return d; };

const hasDate = (task) => typeof task.date === 'string';

/** Default in the API too — a task stored before windows existed has none. */
const DEFAULT_ACTIVE_FOR_MINS = 10;

/** When a task stops being worth acting on: its moment plus its own window. */
const activeUntil = (task) => new Date(
  new Date(task.date).getTime() + (task.activeForMins ?? DEFAULT_ACTIVE_FOR_MINS) * 60000,
);

/**
 * Spent. Mirrors the server's rule, window included — judging by the date alone
 * would put "Missed" on a task the server still calls actual.
 */
const hasPassed = (task) => hasDate(task) && activeUntil(task) <= new Date();

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
      link.textContent = '🔗';
      link.title = step.link;
      link.setAttribute('aria-label', `Open the link for ${step.name}`);
      item.append(link);
    }

    list.append(item);
  }

  section.append(list);

  return section;
}

/** A task's link, as the same 🔗 a step carries — tappable, not just a count. */
function taskLink(task, url) {
  const link = document.createElement('a');
  link.className = 'chip chip--link';
  link.href = url;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  link.textContent = '🔗';
  link.title = url;
  link.setAttribute('aria-label', `Open ${url} for ${task.name}`);

  return link;
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

  for (const url of task.links ?? []) meta.append(taskLink(task, url));

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
  if (activeCategory === 'all') {
    categoriesInUse = new Set(tasks.map((task) => task.category));
  }

  const all = document.createElement('button');
  all.type = 'button';
  all.className = 'category category--all';
  all.dataset.category = 'all';
  all.setAttribute('aria-pressed', String(activeCategory === 'all'));
  all.setAttribute('aria-label', 'All categories');
  all.title = 'All categories';
  all.textContent = 'All';
  all.addEventListener('click', () => { selectCategory('all'); });

  // An empty category is noise: the icons are only useful as a way into
  // something. The selected one stays whatever happens, so clearing the last
  // task in it does not pull the pill out from under its own list.
  const buttons = [...Object.entries(CATEGORIES), [OTHER_KEY, OTHER_CATEGORY]]
    .filter(([key]) => categoriesInUse.has(key) || key === activeCategory)
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

  // Nothing to choose between: a lone "All" is a control that does nothing.
  categoriesEl.hidden = buttons.length === 0;
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
    cleanupButton.hidden = true;
    summaryEl.textContent = '';
    listEl.replaceChildren(message('⏳', 'Loading…'));

    return;
  }

  if (status === 'signed-out') {
    cleanupButton.hidden = true;
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
    cleanupButton.hidden = true;
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

  cleanupButton.hidden = sweepable().length === 0;

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

/* --- asking before destroying ---------------------------------------------- */

const confirmDialog = document.getElementById('confirm');
const confirmTitle = document.getElementById('confirm-title');
const confirmMessage = document.getElementById('confirm-message');
const confirmActions = document.getElementById('confirm-actions');

function confirmButton({ id, label, danger }, choose) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = danger ? 'btn btn--danger' : 'btn';
  button.textContent = label;
  button.addEventListener('click', () => { choose(id); });

  return button;
}

/**
 * The app's own question, in place of `window.confirm`.
 *
 * Resolves with the chosen action's id, or null for cancel — which includes
 * Escape and the backdrop, since `close` fires for those too and nothing has
 * set a choice by then.
 *
 * More than one destructive answer is the point: deleting one occurrence of a
 * repeat and deleting the repeat itself are different things, and a yes/no box
 * can only offer one of them.
 */
function ask({ title, message, actions }) {
  confirmTitle.textContent = title;
  confirmMessage.textContent = message ?? '';
  confirmMessage.hidden = message === undefined;

  return new Promise((resolve) => {
    let chosen = null;
    const choose = (id) => { chosen = id; confirmDialog.close(); };

    confirmActions.replaceChildren(
      ...actions.map((action) => confirmButton(action, choose)),
      confirmButton({ id: null, label: 'Cancel' }, choose),
    );

    confirmDialog.addEventListener('close', () => { resolve(chosen); }, { once: true });
    confirmDialog.showModal();
  });
}

/**
 * A generated event is one occurrence of a rule, so the bin has two meanings
 * and the user picks: drop this occurrence and leave the rule making more, or
 * take the rule and everything it has made. Anything else is a plain delete.
 */
function deleteChoiceFor(task) {
  if (!task.configTaskId) {
    return ask({
      title: `Delete "${task.name}"?`,
      actions: [{ id: 'one', label: 'Delete', danger: true }],
    });
  }

  return ask({
    title: `Delete "${task.name}"?`,
    message: 'This task repeats.',
    actions: [
      { id: 'one', label: 'Only this one', danger: true },
      { id: 'all', label: 'Delete forever', danger: true },
    ],
  });
}

function remove(task) {
  void deleteChoiceFor(task).then((choice) => {
    if (choice === null) return;

    apply(
      () => {
        const index = tasks.indexOf(task);
        if (index !== -1) tasks.splice(index, 1);
      },
      // `clearTasks` takes exactly what it is given; `deleteTask` escalates to
      // the whole rule when handed a generated event.
      () => (choice === 'all'
        ? deleteTask(credentials.token, task.id)
        : clearTasks(credentials.token, [task.id])),
      `${task.name} deleted`,
    );
  });
}

const cleanupButton = document.getElementById('cleanup');

/**
 * The bin at the bottom takes everything currently listed, under any filter.
 * It always clears rather than deletes: a repeat behind one of these events is
 * left alone to carry on, which is what makes sweeping safe to reach for.
 */
const sweepable = () => tasks;

cleanupButton.addEventListener('click', () => {
  const spent = sweepable();
  if (spent.length === 0) return;

  const count = String(spent.length);
  const ids = spent.map((task) => task.id);

  void ask({
    title: `Clear ${count} task${spent.length === 1 ? '' : 's'}?`,
    message: 'Repeats are kept.',
    actions: [{ id: 'clear', label: `Clear ${count}`, danger: true }],
  }).then((choice) => {
    if (choice === null) return;

    apply(
      () => { tasks = tasks.filter((task) => !ids.includes(task.id)); },
      () => clearTasks(credentials.token, ids),
      `${count} cleared`,
    );
  });
});

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
    // Fire and forget: a rotated token is worth fixing, but never worth
    // holding the list up for.
    void refreshRegistration(credentials.token);
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
  showNotificationsItem();
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

/* --- notifications -------------------------------------------------------- */
/* One menu item that says what the situation is and, when there is something
   to do about it, does it. The click is the user gesture iOS requires. */

const notificationsItem = document.getElementById('notifications');
const testItem = document.getElementById('test-notification');

const NOTIFICATION_LABEL = {
  granted: 'Notifications on',
  default: 'Turn on notifications',
  denied: 'Notifications blocked',
  'needs-install': 'Add to Home Screen first',
};

function showNotificationsItem() {
  const state = notificationState();
  const label = NOTIFICATION_LABEL[state];

  // No label means unsupported: a desktop browser without the SDK, say. An
  // item that cannot lead anywhere is worse than no item.
  notificationsItem.hidden = label === undefined || credentials === null;
  notificationsItem.textContent = label ?? '';
  notificationsItem.disabled = state !== 'default';

  // Only worth offering once there is something to test.
  testItem.hidden = notificationsItem.hidden || state !== 'granted';
  testItem.disabled = false;
  testItem.textContent = 'Send a test';
}

notificationsItem.addEventListener('click', () => {
  closeMenu();
  notificationsItem.textContent = 'Asking…';

  void enableNotifications(credentials.token).then(
    (state) => {
      showNotificationsItem();
      announcer.textContent = state === 'granted'
        ? 'Notifications are on for this device'
        : 'Notifications were not enabled';
    },
    (error) => {
      showNotificationsItem();
      announcer.textContent = `Could not turn notifications on: ${error.message}`;
    },
  );
});

/* The round trip is the point: it proves registration, the server, FCM and the
   phone's own settings all still work, without waiting for something to fall
   due. Sent from the server, not shown locally, so it exercises the real path. */
testItem.addEventListener('click', () => {
  closeMenu();
  testItem.disabled = true;
  testItem.textContent = 'Sending…';

  void sendTestNotification(credentials.token).then(
    ({ delivered }) => {
      showNotificationsItem();
      announcer.textContent = delivered === 0
        ? 'No device is registered for notifications'
        : `Test sent to ${String(delivered)} device${delivered === 1 ? '' : 's'}`;
    },
    (error) => {
      showNotificationsItem();
      announcer.textContent = `Could not send the test: ${error.message}`;
    },
  );
});

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
    // The repeats dialog is modal, and a second modal on top of it is refused,
    // so it steps aside for the question and comes back after.
    repeatsDialog.close();

    void ask({
      title: `Delete "${config.name}"?`,
      message: 'This task repeats.',
      actions: [{ id: 'delete', label: 'Delete forever', danger: true }],
    }).then((choice) => {
      if (choice === null) return openRepeats();

      return deleteRepeatedTask(credentials.token, config.id).then(() => {
        announcer.textContent = `${config.name} repeat deleted`;

        return Promise.all([openRepeats(), load()]);
      });
    });
  });

  text.addEventListener('click', () => {
    repeatsDialog.close();
    openConfigEditor(config);
  });
  text.classList.add('repeat__text--tappable');

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

const draft = { kind: null, schedule: null, editing: null, editingConfig: null };

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
function addRow(container, cells, onRemove = () => {}) {
  const row = document.createElement('div');
  row.className = 'row';

  const remove = document.createElement('button');
  remove.type = 'button';
  remove.className = 'row__remove';
  remove.textContent = '✕';
  remove.setAttribute('aria-label', 'Remove');
  remove.addEventListener('click', () => {
    row.remove();
    onRemove();
  });

  row.append(...cells, remove);
  container.append(row);

  return row;
}

const addLinkRow = (url = '') => {
  const input = inputCell('https://…', 'url');
  input.value = url;
  addRow(linkRows, [input]);

  return input;
};

/** The small control that trades itself for the input it opens. */
function linkToggle(onOpen) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'btn btn--small row-stack__add-link';
  button.textContent = '+ 🔗';
  // The icon carries no name of its own, so give it one.
  button.setAttribute('aria-label', 'Add link');
  button.addEventListener('click', () => { onOpen(); });

  return button;
}

/**
 * A step is a column, not a row: its name keeps the full width, and a link —
 * which most steps do not have — only appears once asked for, on a line of its
 * own where a url is actually readable. Side by side, neither fitted a phone.
 */
function addSubtaskRow({ name = '', link = '' } = {}) {
  const step = document.createElement('div');
  step.className = 'row-stack';

  const nameInput = inputCell('Step name');
  nameInput.dataset.field = 'name';
  nameInput.value = name;

  const openLink = (url = '') => {
    const input = inputCell('https://…', 'url');
    input.dataset.field = 'link';
    input.value = url;
    // Removing the link puts the control back, so the step returns to the
    // state it started in rather than keeping an empty field forever.
    const row = addRow(step, [input], () => { toggle.hidden = false; });
    toggle.hidden = true;
    step.append(toggle);

    return { input, row };
  };

  const toggle = linkToggle(() => { openLink().input.focus(); });

  // The ✕ on the name line belongs to the whole step, not just that line —
  // otherwise removing it strands an empty .step behind the link underneath.
  addRow(step, [nameInput, toggle], () => { step.remove(); });
  if (link !== '') openLink(link);

  subtaskRows.append(step);

  return step;
}

/** Every non-empty task link, in the order they were entered. */
const linkValues = () => [...linkRows.querySelectorAll('input')]
  .map((input) => input.value.trim())
  .filter(Boolean);

/** Steps that were actually named; an empty row is an abandoned one. */
const subtaskValues = () => [...subtaskRows.querySelectorAll('.row-stack')]
  .map((step) => ({
    name: step.querySelector('[data-field="name"]').value.trim(),
    link: step.querySelector('[data-field="link"]')?.value.trim() ?? '',
  }))
  .filter((step) => step.name !== '');

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

  const editing = draft.editing !== null || draft.editingConfig !== null;
  const total = draft.kind === 'REPEATED' ? 3 : 2;
  const current = name === 'kind' ? 1 : (name === 'schedule' ? 2 : total);

  wizardTitle.textContent = draft.editingConfig !== null
    ? 'Edit repeat'
    : (editing ? 'Edit task' : TITLES[name]);
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
  draft.editingConfig = null;
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
  // A generated event is a projection: the thing worth editing is the config
  // behind it. The list brings it along, so there is nothing to fetch.
  if (task.configTaskId) {
    if (task.config) {
      openConfigEditor(task.config);

      return;
    }

    void fetchRepeatedTask(credentials.token, task.configTaskId).then(
      (config) => { openConfigEditor(config); },
      () => { announcer.textContent = `Could not open the repeat behind ${task.name}`; },
    );

    return;
  }

  draft.kind = task.type;
  draft.schedule = null;
  draft.editing = task;
  draft.editingConfig = null;

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

  fillActiveFor(task.activeForMins);
  for (const url of task.links ?? []) addLinkRow(url);
  for (const step of task.subtasks) addSubtaskRow(step);

  showStep('details');
  composer.showModal();
}

/** Opens a repeat's own form, prefilled — the schedule included. */
function openConfigEditor(config) {
  draft.kind = 'REPEATED';
  draft.schedule = config.type;
  draft.editing = null;
  draft.editingConfig = config;

  composerForm.reset();
  fillCategories();
  linkRows.replaceChildren();
  subtaskRows.replaceChildren();
  toggleGroup(document.getElementById('weekday-toggles'), WEEKDAYS, config.weekdays ?? []);
  toggleGroup(document.getElementById('month-toggles'), MONTHS, config.months ?? []);

  composerForm.elements['name'].value = config.name;
  composerForm.elements['category'].value = config.category;
  fillActiveFor(config.activeForMins);
  for (const url of config.links ?? []) addLinkRow(url);

  if (config.type === 'DAILY') {
    composerForm.elements['startsAt'].value = clockFromUtc(config.startsAt);
    composerForm.elements['endsAt'].value = clockFromUtc(config.endsAt);
    composerForm.elements['repeatEach'].value = clockOf(config.repeatEach);
  }

  if (config.type === 'REPEATED_MONTHLY') {
    composerForm.elements['fromDay'].value = String(config.fromDay);
  }

  showStep('details');
  if (!composer.open) composer.showModal();
}

document.getElementById('details-cancel').addEventListener('click', () => { composer.close(); });

/* ---------------------------------------------------------------------------
   The server keeps a daily window in UTC, and you type it in your own time, so
   the two have to be converted at this boundary. `repeatEach` is a length, not
   a time of day, and is never converted.
--------------------------------------------------------------------------- */

const MINUTES_PER_DAY = 24 * 60;

/** Minutes to add to local time to get UTC (−240 in Yerevan). */
const utcOffset = () => new Date().getTimezoneOffset();

const wrapDay = (minutes) => ((minutes % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;

const pad = (value) => String(value).padStart(2, '0');

const timeParts = (value) => {
  const [hour, minute] = String(value).split(':').map(Number);

  return { hour: hour || 0, minute: minute || 0 };
};

/** "21:00" typed here becomes {hour: 17, minute: 0} for the server. */
function toUtcParts(value) {
  const { hour, minute } = timeParts(value);
  const minutes = wrapDay(hour * 60 + minute + utcOffset());

  return { hour: Math.floor(minutes / 60), minute: minutes % 60 };
}

/** The reverse, for filling the form back in. */
function clockFromUtc({ hour, minute }) {
  const minutes = wrapDay(hour * 60 + minute - utcOffset());

  return `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;
}

/** A plain length, shown as typed. */
const clockOf = ({ hour, minute }) => `${pad(hour)}:${pad(minute)}`;

/** What would be sent to the API, shaped exactly as the endpoints expect. */
/**
 * Puts a stored minute count back into the two controls, choosing the largest
 * unit it divides cleanly by — 1440 comes back as "1 days", not "1440 minutes".
 */
function fillActiveFor(mins) {
  const minutes = mins ?? DEFAULT_ACTIVE_FOR_MINS;
  const unit = [1440, 60, 1].find((size) => minutes % size === 0) ?? 1;

  composerForm.elements['activeFor'].value = String(minutes / unit);
  composerForm.elements['activeForUnit'].value = String(unit);
}

function draftPayload(data) {
  const name = String(data.get('name')).trim();
  const category = String(data.get('category'));
  const links = linkValues();
  const subtasks = subtaskValues()
    .map(({ name: stepName, link }) => (link ? { name: stepName, link } : { name: stepName }));

  // One number and the unit it is counted in, stored as plain minutes.
  const activeForMins = Number(data.get('activeFor')) * Number(data.get('activeForUnit'));
  const shared = {
    name,
    category,
    ...(links.length ? { links } : {}),
    ...(activeForMins > 0 ? { activeForMins } : {}),
  };

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
      startsAt: toUtcParts(data.get('startsAt')),
      endsAt: toUtcParts(data.get('endsAt')),
      // A gap, not a clock time: two hours is two hours in any zone.
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
    months: chosenValues(document.getElementById('month-toggles')),
  };
}

composerForm.addEventListener('submit', () => {
  const payload = draftPayload(new FormData(composerForm));
  if (payload.name === '') return;

  if (payload.type === 'DAILY') {
    const asMinutes = ({ hour, minute }) => hour * 60 + minute;
    if (asMinutes(payload.startsAt) > asMinutes(payload.endsAt)) {
      wizardSteps.textContent = 'That window crosses midnight UTC, which the server cannot store yet.'
        + ' Try a range that stays inside one UTC day.';

      return;
    }
  }

  // A repeat is a config: the server makes the event, so reload rather than
  // guessing what it produced.
  const { editing, editingConfig } = draft;
  let send = () => createTask(credentials.token, payload);
  if (editingConfig !== null) send = () => replaceRepeatedTask(credentials.token, editingConfig.id, payload);
  else if (editing !== null) send = () => replaceTask(credentials.token, editing.id, payload);
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
