import type { AppState, FileView, UploaderBridge } from '../shared/types';

declare global {
  interface Window {
    uploader: UploaderBridge;
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

/** "14:02" today, else "10 Nov, 14:02". */
function when(iso: string): string {
  const date = new Date(iso);
  const today = date.toDateString() === new Date().toDateString();
  return date.toLocaleString(
    undefined,
    today
      ? { timeStyle: 'short' }
      : { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' },
  );
}

/** What the uploader is doing, in a few words, and its details for the tooltip. */
function status(state: AppState): { tone: Tone; text: string; tooltip: string } {
  const folderHint = 'World of Warcraft’s folder: the one with _forever_ in it.';
  if (!state.gameFolder)
    return { tone: 'warn', text: 'Choose the game’s folder', tooltip: folderHint };
  if (state.folderProblem) {
    return { tone: 'warn', text: 'That isn’t the game’s folder', tooltip: state.folderProblem };
  }
  if (state.files.length === 0) {
    return {
      tone: 'warn',
      text: 'No professions file yet',
      tooltip: 'In game, open each profession’s window once, then type /ga-prof save.',
    };
  }
  const failed = state.files.find((file) => file.status === 'failed');
  if (failed) return { tone: 'bad', text: 'The last upload failed', tooltip: failed.message };
  if (state.files.some((file) => file.status === 'uploading')) {
    return { tone: 'busy', text: 'Uploading…', tooltip: '' };
  }
  const account = state.key.account;
  const who = account
    ? account.guilds.length > 0
      ? `Uploading as ${account.name} to ${account.guilds.join(', ')}.`
      : `${account.name} isn’t in a guild on Guild Assistant yet.`
    : '';
  return {
    tone: account && account.guilds.length === 0 ? 'warn' : 'ok',
    text: 'Watching for changes',
    tooltip: `${who} It uploads each time the game saves a changed file.`.trim(),
  };
}

function fileItem(file: FileView): HTMLLIElement {
  const item = document.createElement('li');
  item.className = 'file';
  const name = document.createElement('span');
  name.className = 'file-name';
  name.textContent = `${file.version} · ${file.account}`;
  const state = document.createElement('span');
  state.className = 'file-state';
  const [tone, text]: [Tone, string] =
    file.status === 'uploaded'
      ? ['ok', file.at ? when(file.at) : 'Uploaded']
      : file.status === 'failed'
        ? ['bad', 'Failed']
        : file.status === 'uploading'
          ? ['busy', 'Uploading…']
          : ['warn', 'Waiting'];
  setLine(state, tone, text);
  item.append(name, state);
  item.title = `${file.message}\n${file.path}`;
  return item;
}

/** This window is the Change Upload Key… one (not the main window). */
const KEY_WINDOW = location.hash === '#key';

function render(state: AppState): void {
  // The key comes first: until one works, it's all the main window shows.
  const keyView = KEY_WINDOW || !state.key.saved || state.key.error !== null;
  $('key-view').hidden = !keyView;
  $('main-view').hidden = keyView;
  $('cancel-key').hidden = !KEY_WINDOW;
  if (keyView) {
    if (!pendingKeyError) $('key-error').textContent = KEY_WINDOW ? '' : (state.key.error ?? '');
    return;
  }

  const top = status(state);
  setLine($('status'), top.tone, top.text, top.tooltip);

  // Its end is what tells folders apart: cut short at the start (the marks keep "/" in place).
  $('folder').textContent = state.gameFolder ? `‎${state.gameFolder}‎` : 'Not chosen';
  $('folder').title = state.gameFolder ?? '';
  const files = state.folderProblem ? [] : state.files;
  $('files').replaceChildren(...files.map(fileItem));
  $<HTMLButtonElement>('upload-now').disabled = !state.watching || files.length === 0;

  $<HTMLInputElement>('background').checked = state.background;
  $<HTMLInputElement>('login').checked = state.openAtLogin;
  $('background-label').title =
    state.platform === 'mac'
      ? 'Closing the window keeps it running in the menu bar. Quit it from there.'
      : 'Closing the window keeps it running in the notification area, by the clock. Quit it from there.';
}

/** An error from saving a key: shown until the next try, whatever state comes meanwhile. */
let pendingKeyError = false;

function wire(): void {
  const bridge = window.uploader;
  $('get-key').addEventListener('click', () => void bridge.openKeyPage());
  $('cancel-key').addEventListener('click', () => void bridge.closeWindow());
  $('key-view').addEventListener('submit', (event) => {
    event.preventDefault();
    const input = $<HTMLInputElement>('key-input');
    const button = $<HTMLButtonElement>('save-key');
    button.disabled = true;
    pendingKeyError = false;
    $('key-error').textContent = '';
    void bridge
      .saveKey(input.value)
      .then((answer) => {
        if (answer.ok) {
          input.value = '';
          if (KEY_WINDOW) void bridge.closeWindow();
        } else {
          pendingKeyError = true;
          $('key-error').textContent = answer.error;
        }
      })
      .finally(() => {
        button.disabled = false;
      });
  });
  $('choose-folder').addEventListener('click', () => void bridge.chooseFolder());
  $('upload-now').addEventListener('click', () => void bridge.uploadNow());
  $<HTMLInputElement>('background').addEventListener('change', (event) => {
    void bridge.setBackground((event.target as HTMLInputElement).checked);
  });
  $<HTMLInputElement>('login').addEventListener('change', (event) => {
    void bridge.setOpenAtLogin((event.target as HTMLInputElement).checked);
  });
  // The window takes the page's height, whenever it changes: it never scrolls.
  new ResizeObserver(() => void bridge.fit(document.body.offsetHeight)).observe(document.body);
  bridge.onState(render);
  void bridge.getState().then(render);
  if (KEY_WINDOW) $('key-input').focus();
}

wire();
