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
    width: '16',
    height: '16',
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

/** An element's content: an icon in its tone's colour, then the text (never HTML). */
function setLine(element: HTMLElement, tone: Tone, text: string): void {
  element.className = element.className.replace(/\s*tone-\w+/g, '') + ` tone-${tone}`;
  const span = document.createElement('span');
  span.textContent = text;
  element.replaceChildren(icon(tone), span);
}

const when = (iso: string): string =>
  new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });

/** What the uploader is doing, in a line, for the top of the window. */
function status(state: AppState): { tone: Tone; text: string } {
  if (!state.key.saved) return { tone: 'warn', text: 'Paste an upload key to start (step 1).' };
  if (state.key.error)
    return { tone: 'bad', text: 'The upload key doesn’t work any more (step 1).' };
  if (!state.gameFolder || state.folderProblem) {
    return { tone: 'warn', text: 'Choose World of Warcraft’s folder (step 2).' };
  }
  if (state.files.some((file) => file.status === 'failed')) {
    return { tone: 'bad', text: 'The last upload failed: see step 2.' };
  }
  if (state.files.some((file) => file.status === 'uploading')) {
    return { tone: 'busy', text: 'Uploading…' };
  }
  const place = state.platform === 'mac' ? 'menu bar' : 'notification area';
  return state.background
    ? {
        tone: 'ok',
        text: `Running in the background: it keeps watching from the ${place} when you close this window.`,
      }
    : { tone: 'ok', text: 'Watching while this window is open.' };
}

function fileItem(file: FileView): HTMLLIElement {
  const item = document.createElement('li');
  item.className = 'file';
  const name = document.createElement('div');
  name.className = 'file-name';
  name.textContent = `${file.version} · ${file.account}`;
  name.title = file.path;
  const line = document.createElement('p');
  line.className = 'file-status muted';
  const tone: Tone =
    file.status === 'uploaded'
      ? 'ok'
      : file.status === 'failed'
        ? 'bad'
        : file.status === 'uploading'
          ? 'busy'
          : 'warn';
  const at = file.at ? ` (${when(file.at)})` : '';
  const text =
    file.status === 'uploaded'
      ? `Uploaded${at}. ${file.message}`
      : file.status === 'failed'
        ? `Failed${at}: ${file.message}`
        : file.message;
  setLine(line, tone, text);
  item.append(name, line);
  return item;
}

function render(state: AppState): void {
  const top = status(state);
  setLine($('status'), top.tone, top.text);

  // 1. The key.
  $('key-missing').hidden = state.key.saved;
  $('key-saved').hidden = !state.key.saved;
  if (state.key.saved) {
    const account = state.key.account;
    const text = !account
      ? 'A key is saved.'
      : account.guilds.length === 0
        ? `Uploading as ${account.name}, who isn’t in a guild on Guild Assistant yet.`
        : `Uploading as ${account.name} to ${account.guilds.join(', ')}.`;
    setLine(
      $('key-account'),
      state.key.error ? 'bad' : account?.guilds.length ? 'ok' : 'warn',
      text,
    );
  }
  if (!pendingKeyError) $('key-error').textContent = state.key.error ?? '';

  // 2. The folder and its files.
  $('folder').textContent = state.gameFolder ?? 'Not chosen yet.';
  $('folder-error').textContent = state.folderProblem ?? '';
  const files = state.folderProblem ? [] : state.files;
  $('files').replaceChildren(...files.map(fileItem));
  $('no-files').hidden = !state.gameFolder || state.folderProblem !== null || files.length > 0;
  $<HTMLButtonElement>('upload-now').disabled = !state.watching || files.length === 0;

  // 3. In the background.
  $<HTMLInputElement>('background').checked = state.background;
  $<HTMLInputElement>('login').checked = state.openAtLogin;
  const place =
    state.platform === 'mac'
      ? 'the menu bar (top right of the screen)'
      : 'the notification area (bottom right, by the clock)';
  $('background-note').textContent = state.background
    ? `On: closing this window keeps it running, with its icon in ${place}. Quit it from there.`
    : 'Off: closing this window quits it, and nothing is uploaded until you open it again.';

  $('version').textContent = `Version ${state.version}`;
  $<HTMLAnchorElement>('site').href = state.site;
}

/** An error from saving a key: shown until the next try, whatever state comes meanwhile. */
let pendingKeyError = false;

function wire(): void {
  const bridge = window.uploader;
  $('get-key').addEventListener('click', () => void bridge.openKeyPage());
  $('key-form').addEventListener('submit', (event) => {
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
        } else {
          pendingKeyError = true;
          $('key-error').textContent = answer.error;
        }
      })
      .finally(() => {
        button.disabled = false;
      });
  });
  $('forget-key').addEventListener('click', () => void bridge.forgetKey());
  $('choose-folder').addEventListener('click', () => void bridge.chooseFolder());
  $('upload-now').addEventListener('click', () => void bridge.uploadNow());
  $<HTMLInputElement>('background').addEventListener('change', (event) => {
    void bridge.setBackground((event.target as HTMLInputElement).checked);
  });
  $<HTMLInputElement>('login').addEventListener('change', (event) => {
    void bridge.setOpenAtLogin((event.target as HTMLInputElement).checked);
  });
  bridge.onState(render);
  void bridge.getState().then(render);
}

wire();
