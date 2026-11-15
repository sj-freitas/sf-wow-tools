import type { AppState, SwitcherBridge } from '../shared/types';

declare global {
  interface Window {
    switcher: SwitcherBridge;
  }
}

type Tone = 'ok' | 'warn' | 'bad' | 'busy';

/** The website's line icons (Icons.tsx): 24×24, a 2px stroke in the text's colour. */
const ICON_PATHS: Record<Tone, string[]> = {
  ok: ['M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Z', 'm8 12 3 3 5-6'],
  warn: [
    'M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z',
    'M12 9v4M12 17h.01',
  ],
  bad: ['M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Z', 'm15 9-6 6M9 9l6 6'],
  busy: ['M21 12a9 9 0 1 1-6.2-8.6', 'M21 3v6h-6'],
};

const SVG = 'http://www.w3.org/2000/svg';
/** The screens' choice that opens the New UI form. */
const NEW = '\u0000new';

function icon(tone: Tone): SVGSVGElement {
  const svg = document.createElementNS(SVG, 'svg');
  for (const [name, value] of Object.entries({
    width: '15',
    height: '15',
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    'stroke-width': '2',
    'stroke-linecap': 'round',
    'stroke-linejoin': 'round',
    'aria-hidden': 'true',
  })) {
    svg.setAttribute(name, value);
  }
  for (const d of ICON_PATHS[tone]) {
    const path = document.createElementNS(SVG, 'path');
    path.setAttribute('d', d);
    svg.append(path);
  }
  return svg;
}

const $ = <T extends HTMLElement = HTMLElement>(id: string): T => {
  const element = document.getElementById(id);
  if (!element) throw new Error(`#${id} is missing`);
  return element as T;
};

/** An icon in its tone's colour, then a short text (never HTML); the details are its tooltip. */
function setLine(element: HTMLElement, tone: Tone, text: string, tooltip = ''): void {
  element.className = element.className.replace(/\s*tone-\w+/g, '') + ` tone-${tone}`;
  const span = document.createElement('span');
  span.textContent = text;
  element.replaceChildren(icon(tone), span);
  element.title = tooltip;
}

function tone(state: AppState): Tone {
  if (state.problem) return 'bad';
  if (!state.ready || !state.wanted) return 'warn';
  return state.wanted === state.active ? 'ok' : 'busy';
}

function statusTooltip(state: AppState): string {
  if (state.problem) {
    return state.ready
      ? `${state.status}\nTry Again is in the menu bar icon’s menu.`
      : state.status;
  }
  if (state.wanted && state.wanted !== state.active) {
    return 'The game reads its UI when it opens and saves it when it closes: switching waits for it to close.';
  }
  if (state.byDefault && state.defaultUi) {
    return 'Screens without a UI of their own use the laptop’s.';
  }
  return '';
}

function option(value: string, text: string): HTMLOptionElement {
  const element = document.createElement('option');
  element.value = value;
  element.textContent = text;
  return element;
}

/** The screens' UI: theirs, the default (the laptop's), or a new one. */
function renderChoice(state: AppState): void {
  const select = $<HTMLSelectElement>('use');
  const options: HTMLOptionElement[] = [];
  if (!state.laptopOnly && state.defaultUi) {
    options.push(option('', `Default (${state.defaultUi})`));
  } else if (state.byDefault) {
    const pick = option('', 'Pick…');
    pick.disabled = true;
    options.push(pick);
  }
  for (const { name } of state.profiles) options.push(option(name, name));
  options.push(option(NEW, 'New UI…'));
  select.replaceChildren(...options);
  select.value = $('new').hidden ? (state.byDefault ? '' : (state.wanted ?? '')) : NEW;
}

function profileItem(state: AppState, name: string, setups: string[]): HTMLLIElement {
  const item = document.createElement('li');
  item.className = 'profile';
  const label = document.createElement('span');
  label.className = 'profile-name';
  label.textContent = name;
  const where = document.createElement('span');
  where.className = 'profile-state';
  const isDefault = name === state.defaultUi;
  const text = name === state.active ? 'In use' : isDefault ? 'Default' : '';
  if (text) setLine(where, name === state.active ? 'ok' : 'warn', text);
  if (!text) where.replaceChildren();
  item.append(label, where);
  const lines = [...setups];
  if (isDefault) lines.push('Screens without a UI of their own');
  item.title = lines.length > 0 ? lines.join('\n') : 'No screens use it yet';
  return item;
}

function render(state: AppState): void {
  setLine($('status'), tone(state), state.status, statusTooltip(state));

  $('first').hidden = state.ready || !state.switching;
  $('screens').hidden = !state.ready;
  $('uis').hidden = !state.ready;

  if (state.ready) {
    $('setup').textContent = state.setup ?? 'No screens';
    $('setup').title = state.setup ?? '';
    renderChoice(state);
    $('profiles').replaceChildren(
      ...state.profiles.map(({ name, setups }) => profileItem(state, name, setups)),
    );
    $('uis-head').title =
      `Each a copy of the game’s WTF folder, in WTF Profiles next to it.\nThe same on all of them: ${state.shared.join(', ')}.`;
  }

  // Its end is what tells folders apart: cut short at the start (the marks keep "/" in place).
  $('folder').textContent = state.gameFolder ? `‎${state.gameFolder}‎` : 'Not chosen';
  $('folder').title = state.gameFolder ?? '';
  $<HTMLInputElement>('background').checked = state.background;
  $<HTMLInputElement>('login').checked = state.openAtLogin;
}

let last: AppState | null = null;

/** A name form: its name to `create`, its problem shown under it until the next try. */
function nameForm(prefix: 'first' | 'new', forScreens: boolean, done: () => void): void {
  const bridge = window.switcher;
  $(prefix).addEventListener('submit', (event) => {
    event.preventDefault();
    const input = $<HTMLInputElement>(`${prefix}-name`);
    const button = $<HTMLButtonElement>(`${prefix}-keep`);
    button.disabled = true;
    $(`${prefix}-error`).textContent = '';
    void bridge
      .create(input.value || input.placeholder, forScreens)
      .then((problem) => {
        if (problem) {
          $(`${prefix}-error`).textContent = problem;
        } else {
          input.value = '';
          done();
        }
      })
      .finally(() => {
        button.disabled = false;
      });
  });
}

function closeNew(): void {
  $('new').hidden = true;
  $('new-error').textContent = '';
  if (last) render(last);
}

function wire(): void {
  const bridge = window.switcher;
  nameForm('first', false, () => undefined);
  nameForm('new', true, closeNew);
  $('new-cancel').addEventListener('click', closeNew);
  $<HTMLSelectElement>('use').addEventListener('change', (event) => {
    const value = (event.target as HTMLSelectElement).value;
    if (value === NEW) {
      $('new').hidden = false;
      $('new-name').focus();
      return;
    }
    $('new').hidden = true;
    void bridge.use(value || null);
  });
  $('show-uis').addEventListener('click', () => void bridge.openProfiles());
  $('choose-folder').addEventListener('click', () => void bridge.chooseFolder());
  $<HTMLInputElement>('background').addEventListener('change', (event) => {
    void bridge.setBackground((event.target as HTMLInputElement).checked);
  });
  $<HTMLInputElement>('login').addEventListener('change', (event) => {
    void bridge.setOpenAtLogin((event.target as HTMLInputElement).checked);
  });
  // The window takes the page's height, whenever it changes: it never scrolls.
  new ResizeObserver(() => void bridge.fit(document.body.offsetHeight)).observe(document.body);
  const show = (state: AppState) => {
    last = state;
    render(state);
  };
  bridge.onState(show);
  void bridge.getState().then(show);
}

wire();
