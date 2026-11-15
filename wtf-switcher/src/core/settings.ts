import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';

/**
 * What the app keeps between runs (`settings.json` in its app data folder). The UIs, and which
 * screens use which, are kept with the game (`WTF Profiles/switcher.json`), not here.
 */
export interface Settings {
  /** The game version's folder, the one with WTF in it (`…/World of Warcraft/_forever_`). */
  gameFolder: string | null;
  /** Keep running (in the menu bar) when the window is closed. */
  background: boolean;
  /** Start when the user logs in to the computer (hidden, in the background). */
  openAtLogin: boolean;
}

export const defaultSettings = (): Settings => ({
  gameFolder: null,
  background: true,
  openAtLogin: false,
});

/** Reads what's valid of a saved settings file; anything missing or odd is the default. */
export function parseSettings(text: string): Settings {
  const settings = defaultSettings();
  try {
    const saved: unknown = JSON.parse(text);
    if (typeof saved !== 'object' || saved === null) return settings;
    const { gameFolder, background, openAtLogin } = saved as Record<string, unknown>;
    if (typeof gameFolder === 'string') settings.gameFolder = gameFolder;
    if (typeof background === 'boolean') settings.background = background;
    if (typeof openAtLogin === 'boolean') settings.openAtLogin = openAtLogin;
  } catch {
    // Not JSON: the defaults.
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
