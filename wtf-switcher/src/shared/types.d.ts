/** What the window shows: sent by the main process whenever something changes. */
export interface AppState {
  version: string;
  /** The game version's folder (`…/_forever_`); null until it's found or chosen. */
  gameFolder: string | null;
  /** "Forever". */
  gameVersion: string | null;
  /** The game's folder is found (it has WTF): its UIs are switched. */
  switching: boolean;
  /** There are UIs: false until the first is kept. */
  ready: boolean;
  /** What it's doing, in a line (as the menu bar says it). */
  status: string;
  /** The status line is a problem (a failed switch, no folder). */
  problem: boolean;
  /** The screens now ("Built-in Retina Display + LG HDR 4K"). */
  setup: string | null;
  /** The UI the game's WTF folder is now. */
  active: string | null;
  /** These screens' UI (theirs, or the default); null when there's none. */
  wanted: string | null;
  /** These screens are the laptop's own, on its own (their UI is the default). */
  laptopOnly: boolean;
  /** These screens have no UI of their own: they use the default. */
  byDefault: boolean;
  /** The laptop's own screen's UI: the one screens without their own use. */
  defaultUi: string | null;
  profiles: { name: string; setups: string[] }[];
  /** Files every UI shares (left as they are when switching), for the tooltip. */
  shared: string[];
  gameRunning: boolean;
  background: boolean;
  openAtLogin: boolean;
}

/** What the window can ask of the main process (`window.switcher`, from the preload script). */
export interface SwitcherBridge {
  getState(): Promise<AppState>;
  chooseFolder(): Promise<void>;
  /** A new UI, a copy of WTF now (for these screens, when `forScreens`); the problem, if any. */
  create(name: string, forScreens: boolean): Promise<string | null>;
  /** These screens use the UI `name`; null: the default. */
  use(name: string | null): Promise<void>;
  /** Shows the UIs' folder (WTF Profiles) in Finder. */
  openProfiles(): Promise<void>;
  retry(): Promise<void>;
  setBackground(on: boolean): Promise<void>;
  setOpenAtLogin(on: boolean): Promise<void>;
  /** Makes this window as tall as its page (`height`, CSS pixels): it never scrolls. */
  fit(height: number): Promise<void>;
  onState(listener: (state: AppState) => void): void;
}
