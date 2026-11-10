import { watch as watchFolder, promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  nativeImage,
  Notification,
  safeStorage,
  shell,
  Tray,
  type MenuItemConstructorOptions,
} from 'electron';
import { ApiError, GuildAssistantApi, summarize } from './core/api';
import {
  defaultGameFolders,
  detectGameFolder,
  findProfessionFiles,
  gameFolderOf,
  isGameFolder,
} from './core/game-files';
import { SettingsStore } from './core/settings';
import { ProfessionsWatcher, type FileState } from './core/watcher';
import type { AppState } from './shared/types';

/**
 * A test run (`GA_UPLOADER_DATA`): its own settings folder, and the key kept in memory only (never
 * in the system's keychain), so trying it leaves nothing behind.
 */
const TEST_RUN = Boolean(process.env.GA_UPLOADER_DATA);
if (process.env.GA_UPLOADER_DATA) app.setPath('userData', process.env.GA_UPLOADER_DATA);

/** Guild Assistant's address; `GA_UPLOADER_SITE=http://localhost:3000` for a local API. */
const SITE = (process.env.GA_UPLOADER_SITE ?? 'https://guildassistant.app').replace(/\/+$/, '');
/** Started at login on Windows (the login item's argument): straight to the background. */
const STARTED_HIDDEN = process.argv.includes('--hidden');
const ASSETS = path.join(__dirname, '..', 'assets');
const NO_KEY = 'Waiting for an upload key.';
const KEY_PATTERN = /^gak_[A-Za-z0-9_-]{20,}$/;
const MARKED_IN_MEMORY = 'in-memory';
/** Both windows' width; their height is their page's (`window:fit`), so they never scroll. */
const WIDTH = 440;

/**
 * The Guild Assistant Uploader: watches World of Warcraft's folder for the GuildAssistant
 * Professions addon's file and uploads it to Guild Assistant (with the player's upload key)
 * whenever the game saves a changed one. A window to set it up; in the background, an icon in the
 * menu bar (Mac) or notification area (Windows) says it's running.
 */
class UploaderApp {
  private readonly store = new SettingsStore(path.join(app.getPath('userData'), 'settings.json'));
  private readonly settings = this.store.load();
  private readonly api = new GuildAssistantApi(SITE, `GuildAssistantUploader/${app.getVersion()}`);
  private readonly watcher = new ProfessionsWatcher(
    {
      findFiles: (folder) => findProfessionFiles(folder),
      readFile: (file) => fs.readFile(file, 'utf8'),
      watch: (dir, onChange) =>
        watchFolder(dir, (_event, name) => onChange(name ? String(name) : null)),
      upload: (data) => this.upload(data),
      now: () => new Date(),
      setTimer: (run, ms) => setTimeout(run, ms),
      clearTimer: (timer) => clearTimeout(timer as NodeJS.Timeout),
    },
    this.settings.uploads,
    {
      changed: () => this.refresh(),
      uploaded: (file, record) => {
        this.save();
        if (!this.windowVisible())
          this.notify(`Professions uploaded (${file.version})`, record.summary);
      },
      failed: (file, message) => this.notify(`Upload failed (${file.version})`, message),
    },
  );
  private window: BrowserWindow | null = null;
  /** The Change Upload Key… window, while open. */
  private keyWindow: BrowserWindow | null = null;
  /** A test run's key (TEST_RUN). */
  private memoryKey: string | null = null;
  private tray: Tray | null = null;
  private quitting = false;
  private folderProblem: string | null = null;
  private keyError: string | null = null;
  private toldAboutBackground = false;

  async start(): Promise<void> {
    await app.whenReady();
    this.setMenu();
    this.handleWindowCalls();
    app.on('second-instance', () => this.showWindow());
    app.on('activate', () => this.showWindow());
    app.on('before-quit', () => {
      this.quitting = true;
    });
    app.on('window-all-closed', () => {
      if (!this.settings.background) app.quit();
    });

    // Start at login is the system's setting (it can be changed there, and survives updates):
    // what the system says wins over what was last saved.
    if (app.isPackaged && !TEST_RUN) {
      this.settings.openAtLogin = app.getLoginItemSettings().openAtLogin;
    }
    if (!this.settings.gameFolder) {
      const found = await detectGameFolder(
        defaultGameFolders(process.platform, os.homedir(), process.env),
      );
      if (found) {
        this.settings.gameFolder = found;
        this.save();
      }
    }
    this.updateTray();
    await this.restartWatcher();
    void this.refreshAccount();

    const atLogin = STARTED_HIDDEN || app.getLoginItemSettings().wasOpenedAtLogin;
    if (atLogin && this.settings.background && this.watcher.watching) {
      if (process.platform === 'darwin') app.dock?.hide();
    } else {
      this.showWindow();
    }
  }

  // ---- the window ----

  private showWindow(): void {
    if (process.platform === 'darwin') void app.dock?.show();
    if (this.window) {
      this.window.show();
      this.window.focus();
      return;
    }
    const window = this.createWindow('Guild Assistant Uploader');
    window.once('ready-to-show', () => window.show());
    window.on('close', (event) => {
      if (this.quitting || !this.settings.background) return;
      // In the background: the window goes, the uploader stays (in the menu bar or tray).
      event.preventDefault();
      window.hide();
      if (process.platform === 'darwin') app.dock?.hide();
      if (!this.toldAboutBackground) {
        this.toldAboutBackground = true;
        this.notify(
          'Still running in the background',
          `It uploads your professions each time the game saves them. Quit it from its icon in the ${this.trayPlace()}.`,
        );
      }
    });
    window.on('closed', () => {
      this.window = null;
    });
    void window.loadFile(path.join(__dirname, 'renderer', 'index.html'));
    this.window = window;
  }

  /** Change Upload Key…: a small window of its own, over the main one when that's open. */
  private openKeyWindow(): void {
    if (process.platform === 'darwin') void app.dock?.show();
    if (this.keyWindow) {
      this.keyWindow.show();
      this.keyWindow.focus();
      return;
    }
    const parent = this.windowVisible() ? (this.window ?? undefined) : undefined;
    const window = this.createWindow('Change Upload Key', parent);
    window.setMenu(null);
    window.once('ready-to-show', () => {
      window.show();
      if (process.platform === 'darwin') app.focus({ steal: true });
    });
    window.on('closed', () => {
      this.keyWindow = null;
      // Back in the background when the main window isn't open either.
      if (process.platform === 'darwin' && !this.windowVisible() && this.settings.background) {
        app.dock?.hide();
      }
    });
    void window.loadFile(path.join(__dirname, 'renderer', 'index.html'), { hash: 'key' });
    this.keyWindow = window;
  }

  /** A window of the app: its page sizes it (no scrolling), its links open in the browser. */
  private createWindow(title: string, parent?: BrowserWindow): BrowserWindow {
    const window = new BrowserWindow({
      width: WIDTH,
      height: 240,
      useContentSize: true,
      resizable: false,
      maximizable: false,
      fullscreenable: false,
      title,
      parent,
      icon: path.join(ASSETS, 'icon.png'),
      show: false,
      webPreferences: {
        preload: path.join(__dirname, 'preload.js'),
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
      },
    });
    window.webContents.setWindowOpenHandler(({ url }) => {
      if (url.startsWith('https://') || url.startsWith('http://localhost')) {
        void shell.openExternal(url);
      }
      return { action: 'deny' };
    });
    window.webContents.on('will-navigate', (event) => event.preventDefault());
    return window;
  }

  private windowVisible(): boolean {
    return Boolean(this.window?.isVisible());
  }

  /**
   * Mac: the app menu (with Change Upload Key…), Edit (so paste works in the key's field) and
   * Window. Windows: an Options menu on the window, with Change Upload Key… too.
   */
  private setMenu(): void {
    const changeKey: MenuItemConstructorOptions = {
      label: 'Change Upload Key…',
      click: () => this.openKeyWindow(),
    };
    if (process.platform !== 'darwin') {
      Menu.setApplicationMenu(
        Menu.buildFromTemplate([
          {
            label: 'Options',
            submenu: [
              changeKey,
              { label: 'Upload Now', click: () => void this.watcher.checkAll(true) },
              { type: 'separator' },
              { label: 'Quit', click: () => this.quit() },
            ],
          },
        ]),
      );
      return;
    }
    Menu.setApplicationMenu(
      Menu.buildFromTemplate([
        {
          label: app.name,
          submenu: [
            { role: 'about' },
            { type: 'separator' },
            changeKey,
            { type: 'separator' },
            { role: 'hide' },
            { role: 'hideOthers' },
            { role: 'unhide' },
            { type: 'separator' },
            { role: 'quit' },
          ],
        },
        { role: 'editMenu' },
        { role: 'windowMenu' },
      ]),
    );
  }

  private quit(): void {
    this.quitting = true;
    app.quit();
  }

  private handleWindowCalls(): void {
    ipcMain.handle('state:get', () => this.state());
    ipcMain.handle('folder:choose', () => this.chooseFolder());
    ipcMain.handle('key:save', (_event, key: unknown) => this.saveKey(String(key ?? '')));
    ipcMain.handle('window:close', (event) => BrowserWindow.fromWebContents(event.sender)?.close());
    ipcMain.handle('window:fit', (event, height: unknown) => {
      const window = BrowserWindow.fromWebContents(event.sender);
      if (!window || typeof height !== 'number' || !Number.isFinite(height)) return;
      // A window that can't be resized won't get smaller either: allowed for this moment only.
      window.setResizable(true);
      window.setContentSize(WIDTH, Math.round(Math.min(Math.max(height, 120), 900)));
      window.setResizable(false);
    });
    ipcMain.handle('key:open-page', () => {
      const computer = process.platform === 'darwin' ? 'Mac' : 'Windows PC';
      return shell.openExternal(`${SITE}/upload-keys?name=${encodeURIComponent(computer)}`);
    });
    ipcMain.handle('upload:now', () => this.watcher.checkAll(true));
    ipcMain.handle('background:set', (_event, on: unknown) => {
      this.settings.background = on === true;
      this.save();
      this.updateTray();
      this.refresh();
    });
    ipcMain.handle('login:set', (_event, on: unknown) => {
      this.settings.openAtLogin = on === true;
      // A test run only notes it: the development build mustn't open at login.
      if (!TEST_RUN) {
        app.setLoginItemSettings({ openAtLogin: this.settings.openAtLogin, args: ['--hidden'] });
      }
      this.save();
      this.refresh();
    });
  }

  private state(): AppState {
    return {
      site: SITE,
      platform:
        process.platform === 'darwin' ? 'mac' : process.platform === 'win32' ? 'windows' : 'other',
      version: app.getVersion(),
      gameFolder: this.settings.gameFolder,
      folderProblem: this.folderProblem,
      files: this.watcher.files().map(({ file, status, message, at }: FileState) => ({
        path: file.path,
        version: file.version,
        account: file.account,
        status,
        message,
        at,
      })),
      key: {
        saved: this.key() !== null,
        account: this.settings.account,
        error: this.keyError,
      },
      background: this.settings.background,
      openAtLogin: this.settings.openAtLogin,
      watching: this.watcher.watching,
    };
  }

  /** Tells the windows and the tray what changed. */
  private refresh(): void {
    const state = this.state();
    for (const window of [this.window, this.keyWindow]) window?.webContents.send('state', state);
    this.updateTray();
  }

  // ---- the game's folder ----

  private async chooseFolder(): Promise<void> {
    const options: Electron.OpenDialogOptions = {
      title: 'Choose World of Warcraft’s folder',
      buttonLabel: 'Choose',
      properties: ['openDirectory'],
      defaultPath:
        this.settings.gameFolder ??
        defaultGameFolders(process.platform, os.homedir(), process.env)[0],
    };
    const picked = this.window
      ? await dialog.showOpenDialog(this.window, options)
      : await dialog.showOpenDialog(options);
    if (picked.canceled || picked.filePaths.length === 0) return;
    this.settings.gameFolder = gameFolderOf(picked.filePaths[0]);
    this.save();
    await this.restartWatcher();
  }

  /** Watches the chosen folder: uploading when there's a key, only listing its files until then. */
  private async restartWatcher(): Promise<void> {
    this.watcher.stop();
    this.folderProblem = null;
    const folder = this.settings.gameFolder;
    if (folder && !(await isGameFolder(folder))) {
      this.folderProblem =
        'That isn’t World of Warcraft’s folder: choose the one with _forever_ (or _classic_era_) in it.';
    } else if (folder) {
      await this.watcher.pause(this.key() ? null : NO_KEY);
      await this.watcher.start(folder);
    }
    this.refresh();
  }

  // ---- the upload key ----

  /** The key, decrypted by the system; null when there's none (or it can't be read any more). */
  private key(): string | null {
    if (TEST_RUN) return this.memoryKey;
    if (!this.settings.key) return null;
    try {
      return safeStorage.decryptString(Buffer.from(this.settings.key, 'base64'));
    } catch {
      return null;
    }
  }

  private async saveKey(raw: string): Promise<{ ok: true } | { ok: false; error: string }> {
    const key = raw.trim();
    if (!KEY_PATTERN.test(key)) {
      return {
        ok: false,
        error: 'That isn’t an upload key: it starts with gak_. Copy it again from Guild Assistant.',
      };
    }
    if (!TEST_RUN && !safeStorage.isEncryptionAvailable()) {
      return {
        ok: false,
        error: 'This computer has no safe place for the key (no keychain), so it wasn’t saved.',
      };
    }
    try {
      const account = await this.api.me(key);
      if (TEST_RUN) this.memoryKey = key;
      this.settings.key = TEST_RUN
        ? MARKED_IN_MEMORY
        : safeStorage.encryptString(key).toString('base64');
      this.settings.account = {
        name: account.user.name,
        guilds: account.guilds.map((guild) => guild.name),
      };
      this.keyError = null;
      this.save();
      await this.watcher.pause(null);
      this.refresh();
      return { ok: true };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  /** Who the key is and where uploads go, again (guilds change); a deleted key says so. */
  private async refreshAccount(): Promise<void> {
    const key = this.key();
    if (!key) return;
    try {
      const account = await this.api.me(key);
      this.settings.account = {
        name: account.user.name,
        guilds: account.guilds.map((guild) => guild.name),
      };
      this.keyError = null;
      this.save();
    } catch (error) {
      // Offline: the last known account stays. A key that no longer works: say so.
      if (error instanceof ApiError && error.status === 401) this.keyError = error.message;
    }
    this.refresh();
  }

  private async upload(data: string): Promise<string> {
    const key = this.key();
    if (!key) throw new Error('No upload key: paste one in the uploader.');
    try {
      const summary = summarize(await this.api.uploadProfessions(key, data));
      if (this.keyError) this.keyError = null;
      return summary;
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        this.keyError = error.message;
        this.refresh();
      }
      throw error;
    }
  }

  // ---- in the background ----

  private trayPlace(): string {
    return process.platform === 'darwin' ? 'menu bar' : 'notification area, by the clock';
  }

  /** One line for the tray: what it's doing. */
  private statusLine(): string {
    if (!this.settings.gameFolder || this.folderProblem) return 'Choose the game’s folder';
    if (!this.key()) return 'Waiting for an upload key';
    if (this.keyError) return 'The upload key doesn’t work any more';
    const files = this.watcher.files();
    if (files.some((file) => file.status === 'failed')) return 'The last upload failed';
    if (files.some((file) => file.status === 'uploading')) return 'Uploading…';
    const last = files
      .map((file) => file.at)
      .filter((at): at is string => at !== null)
      .sort()
      .at(-1);
    return last
      ? `Watching. Last upload ${new Date(last).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}`
      : 'Watching for the game to save your professions';
  }

  /** The tray icon: there while running in the background, with what it's doing. */
  private updateTray(): void {
    if (!this.settings.background) {
      this.tray?.destroy();
      this.tray = null;
      return;
    }
    if (!this.tray) {
      const icon = nativeImage.createFromPath(
        path.join(ASSETS, process.platform === 'darwin' ? 'trayTemplate.png' : 'tray.png'),
      );
      this.tray = new Tray(icon);
      this.tray.on('click', () => {
        if (process.platform !== 'darwin') this.showWindow();
      });
    }
    const status = this.statusLine();
    this.tray.setToolTip(`Guild Assistant Uploader: ${status}`);
    const menu: MenuItemConstructorOptions[] = [
      { label: status, enabled: false },
      { type: 'separator' },
      { label: 'Open Guild Assistant Uploader', click: () => this.showWindow() },
      {
        label: 'Upload Now',
        enabled: this.watcher.watching,
        click: () => void this.watcher.checkAll(true),
      },
      { label: 'Change Upload Key…', click: () => this.openKeyWindow() },
      { type: 'separator' },
      { label: 'Quit', click: () => this.quit() },
    ];
    this.tray.setContextMenu(Menu.buildFromTemplate(menu));
  }

  private notify(title: string, body: string): void {
    if (Notification.isSupported()) new Notification({ title, body, silent: true }).show();
  }

  private save(): void {
    this.store.save(this.settings);
  }
}

// One uploader at a time: opening it again shows the running one's window.
if (app.requestSingleInstanceLock()) {
  app.setAppUserModelId('app.guildassistant.uploader');
  new UploaderApp().start().catch((error: unknown) => {
    dialog.showErrorBox(
      'Guild Assistant Uploader',
      `It couldn’t start: ${error instanceof Error ? error.message : String(error)}`,
    );
    app.quit();
  });
} else {
  app.quit();
}
