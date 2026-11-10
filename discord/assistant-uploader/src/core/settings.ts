import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';

/** The last upload of a file: what was sent (its hash), when, and what Guild Assistant did. */
export interface UploadRecord {
  hash: string;
  at: string;
  summary: string;
}

/** What the uploader keeps between runs (`settings.json` in its app data folder). */
export interface Settings {
  /** World of Warcraft's folder (or a version's, like `_forever_`). */
  gameFolder: string | null;
  /** The upload key, encrypted by the system (Electron's safeStorage: Keychain, DPAPI), base64. */
  key: string | null;
  /** Who the key is and where uploads go, as Guild Assistant said when the key was saved. */
  account: { name: string; guilds: string[] } | null;
  /** Keep running (in the menu bar or notification area) when the window is closed. */
  background: boolean;
  /** Start when the user logs in to the computer (hidden, in the background). */
  openAtLogin: boolean;
  /** Each file's last upload, by path: an unchanged file isn't sent again. */
  uploads: Record<string, UploadRecord>;
}

export const defaultSettings = (): Settings => ({
  gameFolder: null,
  key: null,
  account: null,
  background: true,
  openAtLogin: false,
  uploads: {},
});

const isRecord = (value: unknown): value is UploadRecord =>
  typeof value === 'object' &&
  value !== null &&
  typeof (value as UploadRecord).hash === 'string' &&
  typeof (value as UploadRecord).at === 'string' &&
  typeof (value as UploadRecord).summary === 'string';

/** Reads what's valid of a saved settings file; anything missing or odd is the default. */
export function parseSettings(text: string): Settings {
  const settings = defaultSettings();
  let saved: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(text);
    if (typeof parsed !== 'object' || parsed === null) return settings;
    saved = parsed as Record<string, unknown>;
  } catch {
    return settings;
  }
  if (typeof saved.gameFolder === 'string') settings.gameFolder = saved.gameFolder;
  if (typeof saved.key === 'string') settings.key = saved.key;
  const account = saved.account as Settings['account'];
  if (
    account &&
    typeof account.name === 'string' &&
    Array.isArray(account.guilds) &&
    account.guilds.every((guild) => typeof guild === 'string')
  ) {
    settings.account = { name: account.name, guilds: account.guilds };
  }
  if (typeof saved.background === 'boolean') settings.background = saved.background;
  if (typeof saved.openAtLogin === 'boolean') settings.openAtLogin = saved.openAtLogin;
  if (typeof saved.uploads === 'object' && saved.uploads !== null) {
    for (const [file, record] of Object.entries(saved.uploads)) {
      if (isRecord(record)) settings.uploads[file] = record;
    }
  }
  return settings;
}

/** The settings file: read once at start, written whole (to a temporary file, then renamed). */
export class SettingsStore {
  constructor(private readonly file: string) {}

  load(): Settings {
    try {
      return parseSettings(readFileSync(this.file, 'utf8'));
    } catch {
      return defaultSettings();
    }
  }

  save(settings: Settings): void {
    mkdirSync(path.dirname(this.file), { recursive: true });
    const temporary = `${this.file}.tmp`;
    writeFileSync(temporary, JSON.stringify(settings, null, 2));
    renameSync(temporary, this.file);
  }
}
