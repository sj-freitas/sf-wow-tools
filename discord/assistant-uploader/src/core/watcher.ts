import { createHash } from 'node:crypto';
import { FILE_NAME, type ProfessionsFile } from './game-files';
import type { UploadRecord } from './settings';

/**
 * A file's state, as the window and the tray show it:
 * - waiting: not uploaded yet, or waiting for a key;
 * - uploading;
 * - uploaded: Guild Assistant has this version of it (just sent, or unchanged since);
 * - failed: the last try didn't work (tried again at the next change, sweep or "Upload now").
 */
export type FileStatus = 'waiting' | 'uploading' | 'uploaded' | 'failed';

export interface FileState {
  file: ProfessionsFile;
  status: FileStatus;
  /** What happened, in a sentence (Guild Assistant's summary, or what went wrong). */
  message: string;
  /** When it was last uploaded, or last failed; null: never tried. */
  at: string | null;
}

/** What the watcher needs from the outside world: the disk, the clock, timers and the upload. */
export interface WatcherDeps {
  findFiles(folder: string): Promise<ProfessionsFile[]>;
  readFile(file: string): Promise<string>;
  /** Calls `onChange` when something in `dir` changes (with the file's name, when known). */
  watch(dir: string, onChange: (fileName: string | null) => void): { close(): void };
  /** Sends the file; its summary ("Updated 3 characters in Alpha."), or it throws. */
  upload(data: string): Promise<string>;
  now(): Date;
  setTimer(run: () => void, ms: number): unknown;
  clearTimer(timer: unknown): void;
}

export interface WatcherEvents {
  /** Something shown changed (a file's state, the files found). */
  changed(): void;
  /** A file was uploaded: its record, to keep, so an unchanged file isn't sent again. */
  uploaded(file: ProfessionsFile, record: UploadRecord): void;
  /** A file's upload failed, after working (or never tried) before: once, not at every retry. */
  failed(file: ProfessionsFile, message: string): void;
}

export interface WatcherOptions {
  /** How long a file must stay unchanged before it's read: the game writes it in bursts. */
  debounceMs: number;
  /** How often the folder is looked at again anyway: new files, missed changes, failed uploads. */
  sweepMs: number;
}

export const DEFAULT_OPTIONS: WatcherOptions = { debounceMs: 2000, sweepMs: 5 * 60 * 1000 };

export const hashOf = (text: string): string => createHash('sha256').update(text).digest('hex');

/**
 * Watches the game's folder for the addon's file (every version and account) and uploads a file
 * when its contents change. The game rewrites the file at every reload and logout, so what was
 * last sent is remembered by its hash (`records`): the same contents aren't sent twice. Changes
 * are seen as they happen (the system's file events); a sweep every few minutes catches what
 * those miss, new files, and retries failed uploads.
 */
export class ProfessionsWatcher {
  private states = new Map<string, FileState>();
  private watchers: { close(): void }[] = [];
  private timers = new Map<string, unknown>();
  private sweep: unknown = null;
  private running = new Map<string, Promise<void>>();
  /** Files that changed while being uploaded: looked at again once that's done. */
  private again = new Set<string>();
  private folder: string | null = null;
  /** Why nothing is uploaded for now (no key yet); null: uploads go. */
  private pausedBecause: string | null = null;

  constructor(
    private readonly deps: WatcherDeps,
    private readonly records: Record<string, UploadRecord>,
    private readonly events: WatcherEvents,
    private readonly options: WatcherOptions = DEFAULT_OPTIONS,
  ) {}

  get watching(): boolean {
    return this.folder !== null && this.pausedBecause === null;
  }

  files(): FileState[] {
    return [...this.states.values()];
  }

  /** Watches `folder` (finding its files, and uploading the changed ones). */
  async start(folder: string): Promise<void> {
    this.stop();
    this.folder = folder;
    await this.rescan();
    this.scheduleSweep();
  }

  stop(): void {
    for (const watcher of this.watchers) watcher.close();
    this.watchers = [];
    for (const timer of this.timers.values()) this.deps.clearTimer(timer);
    this.timers.clear();
    if (this.sweep !== null) this.deps.clearTimer(this.sweep);
    this.sweep = null;
    this.folder = null;
    this.states.clear();
  }

  /** Stops uploading (`reason`, shown on each file), or (null) starts again and catches up. */
  async pause(reason: string | null): Promise<void> {
    this.pausedBecause = reason;
    if (reason === null) await this.checkAll();
    else {
      for (const state of this.states.values()) {
        if (state.status !== 'uploaded')
          this.set(state.file.path, { status: 'waiting', message: reason });
      }
    }
  }

  /** Looks at every file, uploading the changed ones; `force` uploads them all ("Upload now"). */
  async checkAll(force = false): Promise<void> {
    await Promise.all(this.files().map((state) => this.check(state.file.path, force)));
  }

  /** Finds the files again (watching their folders) and looks at them. */
  private async rescan(): Promise<void> {
    if (this.folder === null) return;
    const files = await this.deps.findFiles(this.folder);
    for (const watcher of this.watchers) watcher.close();
    this.watchers = [];
    const next = new Map<string, FileState>();
    for (const file of files)
      next.set(file.path, this.states.get(file.path) ?? this.firstState(file));
    this.states = next;
    for (const dir of new Set(files.map((file) => file.dir))) {
      try {
        this.watchers.push(
          this.deps.watch(dir, (fileName) => {
            if (fileName !== null && fileName !== FILE_NAME) return;
            for (const file of files) if (file.dir === dir) this.schedule(file.path);
          }),
        );
      } catch {
        // Not watchable (gone meanwhile): the sweep still looks at it.
      }
    }
    this.events.changed();
    await this.checkAll();
  }

  private firstState(file: ProfessionsFile): FileState {
    const record = this.records[file.path];
    return record
      ? { file, status: 'uploaded', message: record.summary, at: record.at }
      : { file, status: 'waiting', message: 'Not uploaded yet.', at: null };
  }

  /** Looks at `file` once it has stopped changing for a moment. */
  private schedule(file: string): void {
    const pending = this.timers.get(file);
    if (pending !== undefined) this.deps.clearTimer(pending);
    this.timers.set(
      file,
      this.deps.setTimer(() => {
        this.timers.delete(file);
        void this.check(file);
      }, this.options.debounceMs),
    );
  }

  private scheduleSweep(): void {
    this.sweep = this.deps.setTimer(() => {
      void this.rescan()
        .catch(() => undefined)
        .finally(() => {
          if (this.folder !== null) this.scheduleSweep();
        });
    }, this.options.sweepMs);
  }

  /** One file at a time: a change during its upload is looked at right after it. */
  private check(file: string, force = false): Promise<void> {
    const running = this.running.get(file);
    if (running) {
      this.again.add(file);
      return running;
    }
    const run = this.upload(file, force).finally(() => {
      this.running.delete(file);
      if (this.again.delete(file)) void this.check(file);
    });
    this.running.set(file, run);
    return run;
  }

  private async upload(file: string, force: boolean): Promise<void> {
    const state = this.states.get(file);
    if (!state) return;
    if (this.pausedBecause !== null) {
      if (state.status !== 'uploaded')
        this.set(file, { status: 'waiting', message: this.pausedBecause });
      return;
    }
    let text: string;
    try {
      text = await this.deps.readFile(file);
    } catch (error) {
      this.fail(state, `Couldn’t read the file: ${messageOf(error)}`);
      return;
    }
    const hash = hashOf(text);
    const record = this.records[file];
    if (!force && record?.hash === hash) {
      // The same as the last upload (the game rewrites it at every reload): nothing to send.
      this.set(file, { status: 'uploaded', message: record.summary, at: record.at });
      return;
    }
    this.set(file, { status: 'uploading', message: 'Uploading…' });
    try {
      const summary = await this.deps.upload(text);
      const uploaded = { hash, at: this.deps.now().toISOString(), summary };
      this.records[file] = uploaded;
      this.set(file, { status: 'uploaded', message: summary, at: uploaded.at });
      this.events.uploaded(state.file, uploaded);
    } catch (error) {
      this.fail(state, messageOf(error));
    }
  }

  /** `state`: the file's state before this try (it was `uploading` meanwhile). */
  private fail(state: FileState, message: string): void {
    this.set(state.file.path, { status: 'failed', message, at: this.deps.now().toISOString() });
    if (state.status !== 'failed') this.events.failed(state.file, message);
  }

  private set(file: string, change: Partial<Omit<FileState, 'file'>>): void {
    const state = this.states.get(file);
    if (!state) return;
    this.states.set(file, { ...state, ...change });
    this.events.changed();
  }
}

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);
