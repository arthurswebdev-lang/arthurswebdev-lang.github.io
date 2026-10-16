/* ---------------------------------------------------------------------------
   Light or dark, and one of ten colours.

   A preference of this device, not of the account: the same person may want a
   dark phone and a light laptop, and nothing on the server needs to know. So it
   lives in localStorage, and every read and write is guarded — a private
   window or blocked storage just means the default look, never a broken page.

   The look itself is two attributes on <html>, `data-theme` and `data-accent`,
   which theme.css reads. index.html sets them from storage before the first
   paint; this module validates them, keeps the browser's own chrome in step,
   and runs the picker.
--------------------------------------------------------------------------- */

const STORAGE_KEY = 'tasks-theme';

const MODES = ['light', 'dark'];

/** In the order the picker shows them. Keys match the palette blocks in theme.css. */
const ACCENTS = [
  { key: 'midnight', label: 'Midnight' },
  { key: 'ocean', label: 'Ocean' },
  { key: 'graphite', label: 'Graphite' },
  { key: 'coffee', label: 'Coffee' },
  { key: 'forest', label: 'Forest' },
  { key: 'rose', label: 'Rose' },
  { key: 'sunset', label: 'Sunset' },
  { key: 'aurora', label: 'Aurora' },
  { key: 'plum', label: 'Plum' },
  { key: 'gold', label: 'Gold' },
];

const DEFAULT_THEME = { mode: 'dark', accent: 'midnight' };

const root = document.documentElement;

/** What was saved, with anything unrecognised replaced by its default. */
function savedTheme() {
  let saved = null;
  try {
    saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null');
  } catch {
    saved = null;
  }

  return {
    mode: MODES.includes(saved?.mode) ? saved.mode : DEFAULT_THEME.mode,
    accent: ACCENTS.some(({ key }) => key === saved?.accent) ? saved.accent : DEFAULT_THEME.accent,
  };
}

function saveTheme(theme) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(theme));
  } catch {
    // Not saved, still applied: it lasts until the page is reloaded.
  }
}

/**
 * Sets the look, and tells the browser about it.
 *
 * `theme-color` is what tints the status bar and the task switcher, and it
 * cannot read a CSS variable, so it is given the ground's computed value — read
 * after the attributes change, which is what makes it the new one.
 */
function applyTheme({ mode, accent }) {
  root.dataset.theme = mode;
  root.dataset.accent = accent;

  const ground = getComputedStyle(root).getPropertyValue('--ground').trim();
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', ground);
  document.querySelector('meta[name="color-scheme"]')?.setAttribute('content', mode);
}

let current = savedTheme();
applyTheme(current);

/* --- the picker ----------------------------------------------------------- */

const dialog = document.getElementById('theme');
const modeButtons = [...document.querySelectorAll('#theme-modes [data-theme-mode]')];
const accentList = document.getElementById('theme-accents');

/**
 * One tile per colour. theme.css gives `.swatch[data-accent=…]` that colour's
 * own palette, so each tile previews its choice in the current mode.
 */
const swatches = ACCENTS.map(({ key, label }) => {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'swatch';
  button.dataset.accent = key;
  button.setAttribute('aria-label', label);

  const dot = document.createElement('span');
  dot.className = 'swatch__dot';
  dot.setAttribute('aria-hidden', 'true');

  const name = document.createElement('span');
  name.className = 'swatch__name';
  name.textContent = label;

  button.append(dot, name);
  button.addEventListener('click', () => { choose({ accent: key }); });

  return button;
});

accentList.replaceChildren(...swatches);

function showChoice() {
  for (const button of modeButtons) {
    button.setAttribute('aria-pressed', String(button.dataset.themeMode === current.mode));
  }

  for (const swatch of swatches) {
    const chosen = swatch.dataset.accent === current.accent;
    swatch.setAttribute('aria-pressed', String(chosen));
    swatch.querySelector('.swatch__dot').textContent = chosen ? '✓' : '';
  }
}

/** Applied the moment it is tapped: the page behind the sheet is the preview. */
function choose(change) {
  current = { ...current, ...change };
  applyTheme(current);
  saveTheme(current);
  showChoice();
}

for (const button of modeButtons) {
  button.addEventListener('click', () => { choose({ mode: button.dataset.themeMode }); });
}

document.getElementById('theme-close').addEventListener('click', () => { dialog.close(); });

export function openThemePicker() {
  showChoice();
  dialog.showModal();
}
