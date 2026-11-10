/** What the window shows: sent by the main process whenever something changes. */
export interface AppState {
  /** Guild Assistant's address ("https://guildassistant.app"). */
  site: string;
  platform: 'mac' | 'windows' | 'other';
  version: string;
  gameFolder: string | null;
  /** What's wrong with the chosen folder (not the game's); null when nothing is. */
  folderProblem: string | null;
  /** Every copy of the addon's file found in it (one per game version and account). */
  files: FileView[];
  key: {
    /** A key is saved (encrypted by the system). */
    saved: boolean;
    /** Who it is and where uploads go; null until Guild Assistant has said. */
    account: { name: string; guilds: string[] } | null;
    /** Why it stopped working (deleted on Guild Assistant); null when it works. */
    error: string | null;
  };
  /** Keeps running in the menu bar or notification area when the window is closed. */
  background: boolean;
  openAtLogin: boolean;
  /** Uploading on changes: a folder and a key are set. */
  watching: boolean;
}

export interface FileView {
  path: string;
  /** "Forever", "Classic Era". */
  version: string;
  /** The WoW account folder. */
  account: string;
  status: 'waiting' | 'uploading' | 'uploaded' | 'failed';
  message: string;
  /** ISO time of the last upload (or failure); null: never. */
  at: string | null;
}

/** What the window can ask of the main process (`window.uploader`, from the preload script). */
export interface UploaderBridge {
  getState(): Promise<AppState>;
  chooseFolder(): Promise<void>;
  /** Checks the key with Guild Assistant and keeps it; the error to show when it doesn't work. */
  saveKey(key: string): Promise<{ ok: true } | { ok: false; error: string }>;
  /** Opens Guild Assistant's Upload keys page in the browser. */
  openKeyPage(): Promise<void>;
  uploadNow(): Promise<void>;
  setBackground(on: boolean): Promise<void>;
  setOpenAtLogin(on: boolean): Promise<void>;
  /** Closes this window (the Change Upload Key… one). */
  closeWindow(): Promise<void>;
  /** Makes this window as tall as its page (`height`, CSS pixels): it never scrolls. */
  fit(height: number): Promise<void>;
  onState(listener: (state: AppState) => void): void;
}
