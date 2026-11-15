import { DEFAULT_SHARED, nameProblem, type StoreConfig } from './profiles';

/** What the switcher does to the UIs on disk (ProfileStore; a fake one in tests). */
export interface Store {
  read(): Promise<StoreConfig | null>;
  write(config: StoreConfig): Promise<void>;
  profiles(): Promise<string[]>;
  create(name: string): Promise<void>;
  saveInto(name: string, shared: string[]): Promise<'saved' | 'unchanged'>;
  restore(name: string, shared: string[]): Promise<void>;
  changedSince(iso: string | null): Promise<boolean>;
  cleanUp(): Promise<void>;
}

/** The screens connected now. */
export interface Screens {
  /** All of them, as a setup ("Built-in Retina Display + LG HDR 4K"); null when none is known. */
  setup: string | null;
  /** The computer's own screen, as a setup of its own ("Built-in Retina Display"), when it's on. */
  laptop: string | null;
}

export interface SwitcherDeps {
  store: Store;
  /** Whether the game is open now. */
  gameRunning(): Promise<boolean>;
  /**
   * The screens changed while the game was open, so the UI it saved when it closed could be either
   * one's: which to keep it as (`active`, the one it opened with, or `wanted`, these screens').
   */
  ask(active: string, wanted: string): Promise<string>;
  now(): Date;
}

export interface SwitcherEvents {
  /** Anything shown changed. */
  changed(): void;
  switched(from: string | null, to: string): void;
  /** These screens' UI waits for the game to close. */
  waiting(to: string): void;
  /** Screens that have no UI of their own yet; `byDefault` is the one they use meanwhile. */
  newSetup(setup: string, byDefault: string | null): void;
}

/** What the switcher is doing, for the window and the menu bar. */
export interface SwitcherView {
  /** There are UIs (`switcher.json`): false until the first is kept. */
  ready: boolean;
  /** The screens now ("Built-in Retina Display + LG HDR 4K"); null when none is known yet. */
  setup: string | null;
  /** The UI WTF is now. */
  active: string | null;
  /** These screens' UI (theirs, or the default); null when there's none. */
  wanted: string | null;
  /** These screens have no UI of their own: `wanted` is the default. */
  byDefault: boolean;
  /** The default: the laptop's own screen's UI, for screens that have none. */
  defaultUi: string | null;
  profiles: { name: string; setups: string[] }[];
  gameRunning: boolean;
  /** A switch waits for the game to close. */
  waiting: boolean;
  /** Why the last change failed; null when it didn't. */
  error: string | null;
}

/**
 * Keeps WTF the UI of the screens connected: when they change (and the game is closed), WTF is
 * kept as the UI it was (so what changed in it isn't lost), then made the screens' UI. Screens
 * without one of their own (an iPad by Sidecar next to the laptop) use the laptop's own screen's.
 * The game reads WTF when it opens and writes it when it closes, so nothing is switched while it's
 * open: the switch waits for it to close.
 *
 * One thing at a time: every change goes through a queue, so two copies are never made at once.
 */
export class Switcher {
  private screens: Screens = { setup: null, laptop: null };
  private config: StoreConfig | null = null;
  private names: string[] = [];
  private gameOpen = false;
  /**
   * The game was open while the screens were another UI's: the WTF it leaves could be either's
   * (moved to the laptop and played on as it was, or moved and rearranged), so it's asked.
   */
  private unsure = false;
  private waitingFor: string | null = null;
  private error: string | null = null;
  private queue: Promise<void> = Promise.resolve();

  constructor(
    private readonly deps: SwitcherDeps,
    private readonly events: SwitcherEvents,
  ) {}

  view(): SwitcherView {
    const profiles = this.names.map((name) => ({
      name,
      setups: Object.entries(this.config?.screens ?? {})
        .filter(([, profile]) => profile === name)
        .map(([setup]) => setup)
        .sort(),
    }));
    return {
      ready: this.config !== null,
      setup: this.screens.setup,
      active: this.config?.active ?? null,
      wanted: this.wanted(),
      byDefault: this.own() === null,
      defaultUi: this.defaultUi(),
      profiles,
      gameRunning: this.gameOpen,
      waiting: this.waitingFor !== null,
      error: this.error,
    };
  }

  /** Reads the UIs and makes WTF the screens' when it can. */
  start(screens: Screens): Promise<void> {
    return this.run(async () => {
      this.screens = screens;
      await this.deps.store.cleanUp();
      await this.load();
      await this.noteLaptop();
      this.gameOpen = await this.deps.gameRunning();
      this.tellIfNew();
      await this.settle();
    });
  }

  /** The screens connected now. */
  screensChanged(screens: Screens): Promise<void> {
    return this.run(async () => {
      if (screens.setup === this.screens.setup && screens.laptop === this.screens.laptop) return;
      this.screens = screens;
      await this.load();
      await this.noteLaptop();
      this.tellIfNew();
      await this.settle();
    });
  }

  /** Looks at whether the game is open (called every few seconds). */
  checkGame(): Promise<void> {
    return this.run(async () => {
      const open = await this.deps.gameRunning();
      if (open === this.gameOpen) return;
      this.gameOpen = open;
      await this.load();
      // Closed, and it was the active UI all along: WTF is that UI's, as the game left it. (Opened
      // on screens that want another UI, one that couldn't be switched to: settle waits.)
      if (!open && this.config && !this.unsure) {
        this.config.verifiedAt = this.deps.now().toISOString();
        await this.deps.store.write(this.config);
      }
      await this.settle();
    });
  }

  /** These screens use the UI `name`; null: the default (they have none of their own). */
  use(name: string | null): Promise<void> {
    return this.run(async () => {
      await this.load();
      const setup = this.screens.setup;
      if (!this.config || !setup || (name !== null && !this.names.includes(name))) return;
      if (name === null) delete this.config.screens[setup];
      else this.config.screens[setup] = name;
      await this.deps.store.write(this.config);
      if (this.gameOpen && this.wanted() !== this.config.active) this.unsure = true;
      await this.settle();
    });
  }

  /**
   * A new UI, a copy of WTF now. The first one is what WTF is (the active UI); a later one is for
   * these screens when `forScreens`.
   */
  create(raw: string, forScreens: boolean): Promise<string | null> {
    let problem: string | null = null;
    return this.run(async () => {
      await this.load();
      const name = raw.trim();
      problem = nameProblem(name, this.names);
      if (problem) return;
      await this.deps.store.create(name);
      const now = this.deps.now().toISOString();
      if (!this.config) {
        this.config = {
          active: name,
          screens: {},
          laptop: this.screens.laptop,
          shared: [...DEFAULT_SHARED],
          verifiedAt: now,
        };
      }
      if (forScreens && this.screens.setup) this.config.screens[this.screens.setup] = name;
      await this.deps.store.write(this.config);
      await this.load();
      if (this.gameOpen && this.wanted() !== this.config.active) this.unsure = true;
      await this.settle();
    }).then(() => problem);
  }

  /** Tries again what failed (the last error). */
  retry(): Promise<void> {
    return this.run(async () => {
      await this.load();
      await this.settle();
    });
  }

  /** These screens' own UI. */
  private own(): string | null {
    const name = this.screens.setup ? this.config?.screens[this.screens.setup] : undefined;
    return name && this.names.includes(name) ? name : null;
  }

  /** The laptop's own screen's UI: the one screens without their own use. */
  private defaultUi(): string | null {
    const laptop = this.config?.laptop;
    const name = laptop ? this.config?.screens[laptop] : undefined;
    return name && this.names.includes(name) ? name : null;
  }

  private wanted(): string | null {
    return this.own() ?? this.defaultUi();
  }

  /** Remembers the laptop's own screen, as a setup, when it's on (its UI is the default). */
  private async noteLaptop(): Promise<void> {
    const laptop = this.screens.laptop;
    if (this.config && laptop && this.config.laptop !== laptop) {
      this.config.laptop = laptop;
      await this.deps.store.write(this.config);
    }
  }

  private tellIfNew(): void {
    if (this.config && this.screens.setup && !this.own()) {
      this.events.newSetup(this.screens.setup, this.defaultUi());
    }
  }

  private async load(): Promise<void> {
    this.config = await this.deps.store.read();
    this.names = this.config ? await this.deps.store.profiles() : [];
  }

  /** Switches to the screens' UI, now if the game is closed, else once it is. */
  private async settle(): Promise<void> {
    const config = this.config;
    const wanted = this.wanted();
    if (!config || !wanted || wanted === config.active) {
      if (config && wanted === config.active) this.unsure = false;
      this.waitingFor = null;
      this.error = null;
      return;
    }
    if (this.gameOpen) {
      this.unsure = true;
      this.error = null;
      if (this.waitingFor !== wanted) {
        this.waitingFor = wanted;
        this.events.waiting(wanted);
      }
      return;
    }
    const from = config.active;
    // Unsure too when WTF changed since it was last known to be the active UI's: the game ran
    // while the switcher wasn't watching (not running, or not set up yet), on screens it can't know.
    const unsure =
      this.unsure || (from !== null && (await this.deps.store.changedSince(config.verifiedAt)));
    const keepAs = from && unsure ? await this.deps.ask(from, wanted) : from;
    // The game may have been opened while it asked.
    if (await this.deps.gameRunning()) {
      this.gameOpen = true;
      this.waitingFor = wanted;
      return;
    }
    if (keepAs) await this.deps.store.saveInto(keepAs, config.shared);
    if (keepAs !== wanted) await this.deps.store.restore(wanted, config.shared);
    config.active = wanted;
    config.verifiedAt = this.deps.now().toISOString();
    await this.deps.store.write(config);
    await this.load();
    this.unsure = false;
    this.waitingFor = null;
    this.error = null;
    this.events.switched(from, wanted);
  }

  private run(task: () => Promise<void>): Promise<void> {
    const next = this.queue
      .then(task)
      .then(
        () => undefined,
        (error: unknown) => {
          this.error = error instanceof Error ? error.message : String(error);
        },
      )
      .finally(() => this.events.changed());
    this.queue = next;
    return next;
  }
}
