import { randomBytes } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';

/**
 * The UIs kept, next to the game's WTF folder: `<version folder>/WTF Profiles/<name>/`, each a whole
 * copy of WTF. Also there: `switcher.json` (which one WTF is now, and each screen setup's) and
 * `History/` (each UI's last few copies, the one before each change).
 */
export const STORE_FOLDER = 'WTF Profiles';
const CONFIG_FILE = 'switcher.json';
const HISTORY_FOLDER = 'History';
/** Where copies are made before they take a folder's place (so a failed copy changes nothing). */
const WORK_FOLDER = '.work';
/** How many earlier copies of each UI History keeps. */
export const HISTORY_KEPT = 5;

/**
 * Files that are the same for every UI: switching leaves them as they are. Patterns on a file's
 * name (`*` is any part of it; a `.bak` the game keeps of a file counts as the file).
 */
export const DEFAULT_SHARED = [
  // Blizzard keeps these on its servers too (key bindings, macros, chat, Edit Mode, the account's
  // and each character's settings), and brings its own back when they differ.
  '*-cache.*',
  '*-cache-*',
  'cache.md5',
  'character-list-order.txt',
  // Which addons are on.
  'AddOns.txt',
  // Addons' data, not where things are on the screen: an older copy would undo what they've
  // learned since (and the Uploader would send Guild Assistant older professions).
  'GuildAssistantProfessions.lua',
  'GuildAssistantDatabase.lua',
  'Auctionator.lua',
  'BagBrother.lua',
  'Questie.lua',
  'QuestieTrace.lua',
  'Attune.lua',
  'ForeverDungeonJournal.lua',
  'ItemNotes.lua',
  'MacroIcons.lua',
  '!ErrorLog.lua',
];

/** What a change in `.work` is doing: saving WTF as a UI, or making WTF a UI. */
interface WorkTask {
  kind: 'save' | 'restore';
  name: string;
}

/** What `switcher.json` keeps. */
export interface StoreConfig {
  /** The UI the game's WTF folder is now: the last one switched to (or saved as). */
  active: string | null;
  /** Each screen setup's UI, by the setup ("Built-in Retina Display + LG HDR 4K"). */
  screens: Record<string, string>;
  /**
   * The computer's own screen on its own, as a setup ("Built-in Retina Display"), once seen: its
   * UI is the default, for screens that have none (an iPad by Sidecar, a projector).
   */
  laptop: string | null;
  /** Files left as they are when switching (DEFAULT_SHARED to start with). */
  shared: string[];
  /** When WTF was last known to be the active UI's (ISO): changed since, it may be another's. */
  verifiedAt: string | null;
}

export function parseConfig(text: string): StoreConfig {
  const config: StoreConfig = {
    active: null,
    screens: {},
    laptop: null,
    shared: [...DEFAULT_SHARED],
    verifiedAt: null,
  };
  let saved: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(text);
    if (typeof parsed !== 'object' || parsed === null) return config;
    saved = parsed as Record<string, unknown>;
  } catch {
    return config;
  }
  if (typeof saved.active === 'string') config.active = saved.active;
  if (typeof saved.screens === 'object' && saved.screens !== null) {
    for (const [setup, name] of Object.entries(saved.screens)) {
      if (typeof name === 'string') config.screens[setup] = name;
    }
  }
  if (typeof saved.laptop === 'string') config.laptop = saved.laptop;
  if (Array.isArray(saved.shared) && saved.shared.every((item) => typeof item === 'string')) {
    config.shared = saved.shared as string[];
  }
  if (typeof saved.verifiedAt === 'string') config.verifiedAt = saved.verifiedAt;
  return config;
}

/** Why a UI can't have this name; null when it can. */
export function nameProblem(name: string, existing: string[]): string | null {
  if (!name) return 'Give it a name.';
  if (name.length > 40) return 'A shorter name.';
  if (/[\\/:*?"<>|]/.test(name) || name.startsWith('.'))
    return 'A name without / \\ : * ? " < > |.';
  if (name.toLowerCase() === HISTORY_FOLDER.toLowerCase()) return 'Another name: History is taken.';
  if (existing.some((other) => other.toLowerCase() === name.toLowerCase())) {
    return 'There’s a UI with that name.';
  }
  return null;
}

const escape = (text: string) => text.replace(/[.+?^${}()|[\]\\]/g, '\\$&');

/** Whether a file (its path in WTF, any separator) is one of `shared`. */
export function isShared(file: string, shared: string[]): boolean {
  const name = path.basename(file.replace(/\\/g, '/')).replace(/\.bak$/, '');
  return shared.some((pattern) =>
    new RegExp(`^${pattern.split('*').map(escape).join('.*')}$`, 'i').test(name),
  );
}

/** A folder's files (paths in it, `/`-separated), with each one's size and time. */
async function filesOf(dir: string): Promise<Map<string, { size: number; mtimeMs: number }>> {
  const files = new Map<string, { size: number; mtimeMs: number }>();
  const walk = async (relative: string) => {
    const entries = await fs.readdir(path.join(dir, relative), { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name === '.DS_Store') continue;
      const file = relative ? `${relative}/${entry.name}` : entry.name;
      if (entry.isDirectory()) await walk(file);
      else if (entry.isFile()) {
        const stats = await fs.stat(path.join(dir, file));
        files.set(file, { size: stats.size, mtimeMs: stats.mtimeMs });
      }
    }
  };
  await walk('');
  return files;
}

/**
 * What a folder holds, to compare two without reading them: its files, sizes and times (to the
 * second: copies keep the times). `layout` leaves out the shared files.
 */
export async function fingerprint(
  dir: string,
  shared: string[],
): Promise<{ all: string; layout: string }> {
  const lines = [...(await filesOf(dir)).entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([file, { size, mtimeMs }]) => ({
      file,
      line: `${file}\t${size}\t${Math.floor(mtimeMs / 1000)}`,
    }));
  return {
    all: lines.map(({ line }) => line).join('\n'),
    layout: lines
      .filter(({ file }) => !isShared(file, shared))
      .map(({ line }) => line)
      .join('\n'),
  };
}

const exists = (target: string): Promise<boolean> =>
  fs.stat(target).then(
    () => true,
    () => false,
  );

/** "2026-11-15 0821": a copy's time, in its folder's name. */
export function stamp(date: Date): string {
  const two = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())} ${two(date.getHours())}${two(date.getMinutes())}`;
}

/** The UIs of one game version folder, on disk. */
export class ProfileStore {
  readonly dir: string;
  readonly wtf: string;

  constructor(
    readonly versionFolder: string,
    private readonly now: () => Date = () => new Date(),
  ) {
    this.dir = path.join(versionFolder, STORE_FOLDER);
    this.wtf = path.join(versionFolder, 'WTF');
  }

  /** What `switcher.json` says; null before there's any UI. */
  async read(): Promise<StoreConfig | null> {
    try {
      return parseConfig(await fs.readFile(path.join(this.dir, CONFIG_FILE), 'utf8'));
    } catch {
      return null;
    }
  }

  async write(config: StoreConfig): Promise<void> {
    await fs.mkdir(this.dir, { recursive: true });
    const file = path.join(this.dir, CONFIG_FILE);
    await fs.writeFile(`${file}.tmp`, `${JSON.stringify(config, null, 2)}\n`);
    await fs.rename(`${file}.tmp`, file);
  }

  /** The UIs kept: the store's folders (other than History). */
  async profiles(): Promise<string[]> {
    const entries = await fs.readdir(this.dir, { withFileTypes: true }).catch(() => []);
    return entries
      .filter(
        (entry) =>
          entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== HISTORY_FOLDER,
      )
      .map((entry) => entry.name)
      .sort((a, b) => a.localeCompare(b));
  }

  profileDir(name: string): string {
    return path.join(this.dir, name);
  }

  /** Whether any of WTF's files changed after `iso` (the game saved it since). */
  async changedSince(iso: string | null): Promise<boolean> {
    if (!iso) return true;
    const since = Date.parse(iso);
    for (const { mtimeMs } of (await filesOf(this.wtf)).values()) {
      if (mtimeMs > since) return true;
    }
    return false;
  }

  /** A new UI: a copy of WTF as it is now. */
  async create(name: string): Promise<void> {
    if (await exists(this.profileDir(name))) throw new Error(`There’s a UI called ${name}.`);
    await this.saveInto(name, []);
  }

  /**
   * Keeps WTF as it is now as the UI `name`. The copy it replaces goes to History when its layout
   * (the files that aren't shared) is different. Nothing is done when the two are the same.
   */
  async saveInto(name: string, shared: string[]): Promise<'saved' | 'unchanged'> {
    const target = this.profileDir(name);
    const had = await exists(target);
    const now = had ? await fingerprint(this.wtf, shared) : null;
    const before = had ? await fingerprint(target, shared) : null;
    if (now && before && now.all === before.all) return 'unchanged';
    await this.inWork({ kind: 'save', name }, async (work) => {
      const copy = path.join(work, 'copy');
      await fs.cp(this.wtf, copy, { recursive: true, preserveTimestamps: true });
      if (had && now && before && now.layout !== before.layout) {
        await this.toHistory(name);
      } else if (had) {
        await fs.rename(target, path.join(work, 'old'));
      }
      await fs.rename(copy, target);
    });
    return 'saved';
  }

  /**
   * Makes WTF the UI `name`: its files, except the shared ones, which stay as WTF has them (and so
   * does what the UI has no copy of at all: a character or addon new since it was kept). Built
   * beside WTF first, then put in its place.
   */
  async restore(name: string, shared: string[]): Promise<void> {
    const source = this.profileDir(name);
    if (!(await exists(source))) throw new Error(`There’s no UI called ${name}.`);
    const hadWtf = await exists(this.wtf);
    await this.inWork({ kind: 'restore', name }, async (work) => {
      const next = path.join(work, 'WTF');
      const isFile = async (file: string) => (await fs.stat(file)).isFile();
      const relative = (from: string, file: string) => path.relative(from, file);
      await fs.cp(source, next, {
        recursive: true,
        preserveTimestamps: true,
        filter: async (file) => !(await isFile(file)) || !isShared(relative(source, file), shared),
      });
      if (!hadWtf) {
        await fs.rename(next, this.wtf);
        return;
      }
      await fs.cp(this.wtf, next, {
        recursive: true,
        preserveTimestamps: true,
        force: true,
        filter: async (file) => {
          if (!(await isFile(file))) return true;
          const inWtf = relative(this.wtf, file);
          return isShared(inWtf, shared) || !(await exists(path.join(source, inWtf)));
        },
      });
      const old = path.join(work, 'old');
      await fs.rename(this.wtf, old);
      try {
        await fs.rename(next, this.wtf);
      } catch (error) {
        await fs.rename(old, this.wtf);
        throw error;
      }
    });
  }

  /** History's copies of a UI, oldest first. */
  async history(name: string): Promise<string[]> {
    const pattern = new RegExp(`^${escape(name)} \\d{4}-\\d{2}-\\d{2} \\d{4}(-\\d+)?$`);
    const names = await fs.readdir(path.join(this.dir, HISTORY_FOLDER)).catch(() => [] as string[]);
    return names.filter((entry) => pattern.test(entry)).sort();
  }

  /** Moves the UI's copy to History ("<name> <time>") and keeps only the last few there. */
  private async toHistory(name: string): Promise<void> {
    const history = path.join(this.dir, HISTORY_FOLDER);
    await fs.mkdir(history, { recursive: true });
    let entry = `${name} ${stamp(this.now())}`;
    for (let n = 2; await exists(path.join(history, entry)); n++) {
      entry = `${name} ${stamp(this.now())}-${n}`;
    }
    await fs.rename(this.profileDir(name), path.join(history, entry));
    const kept = await this.history(name);
    for (const old of kept.slice(0, Math.max(0, kept.length - HISTORY_KEPT))) {
      await fs.rm(path.join(history, old), { recursive: true, force: true });
    }
  }

  /**
   * A folder of its own in `.work` for one change, removed once it's done (or has failed). It says
   * what the change is (`task.json`), so one that stopped half way can be put right (cleanUp).
   */
  private async inWork(task: WorkTask, run: (work: string) => Promise<void>): Promise<void> {
    const work = path.join(this.dir, WORK_FOLDER, randomBytes(6).toString('hex'));
    await fs.mkdir(work, { recursive: true });
    await fs.writeFile(path.join(work, 'task.json'), JSON.stringify(task));
    try {
      await run(work);
    } finally {
      await fs.rm(work, { recursive: true, force: true });
      // `.work` itself too, when it's empty.
      await fs.rmdir(path.dirname(work)).catch(() => undefined);
    }
  }

  /**
   * What a change that stopped half way (the app quit, the computer slept or shut down) left in
   * `.work`: a folder it had moved away and not yet replaced goes back (WTF, or the UI's copy), and
   * the rest is removed.
   */
  async cleanUp(): Promise<void> {
    const root = path.join(this.dir, WORK_FOLDER);
    const works = await fs.readdir(root).catch(() => [] as string[]);
    for (const id of works) {
      const work = path.join(root, id);
      let task: WorkTask | null = null;
      try {
        task = JSON.parse(await fs.readFile(path.join(work, 'task.json'), 'utf8')) as WorkTask;
      } catch {
        task = null;
      }
      const old = path.join(work, 'old');
      if (task?.kind === 'restore' && !(await exists(this.wtf)) && (await exists(old))) {
        await fs.rename(old, this.wtf);
      }
      if (task?.kind === 'save' && typeof task.name === 'string') {
        // Moved away (to `old`, or to History with the new copy finished): the copy it had.
        const target = this.profileDir(task.name);
        const copy = path.join(work, 'copy');
        if (!(await exists(target))) {
          if (await exists(old)) await fs.rename(old, target);
          else if (await exists(copy)) await fs.rename(copy, target);
        }
      }
      await fs.rm(work, { recursive: true, force: true });
    }
    await fs.rm(root, { recursive: true, force: true });
  }
}
