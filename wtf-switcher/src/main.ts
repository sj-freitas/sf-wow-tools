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
  powerMonitor,
  screen,
  shell,
  Tray,
  type MenuItemConstructorOptions,
} from 'electron';
import {
  detectVersionFolder,
  gameRunningIn,
  runningCommands,
  versionFolderOf,
  versionLabel,
} from './core/game';
import { DEFAULT_SHARED, ProfileStore } from './core/profiles';
import { screenOf, setupOf } from './core/screens';
import { SettingsStore } from './core/settings';
import { type Screens, Switcher } from './core/switcher';
import type { AppState } from './shared/types';

/**
 * A test run (`WTF_SWITCHER_DATA`): its own settings folder, so trying it leaves the real app's
 * settings alone, and it doesn't start at login. `WTF_SWITCHER_GAME` is the game folder it uses (a
 * copy of one, so the real game's WTF isn't touched).
 */
const TEST_RUN = Boolean(process.env.WTF_SWITCHER_DATA);
if (process.env.WTF_SWITCHER_DATA) app.setPath('userData', process.env.WTF_SWITCHER_DATA);
const TEST_GAME = TEST_RUN ? (process.env.WTF_SWITCHER_GAME ?? null) : null;

const ASSETS = path.join(__dirname, '..', 'assets');
/** The window's width; its height is its page's (`window:fit`), so it never scrolls. */
const WIDTH = 400;
/** How often it looks at whether the game is open. */
const GAME_CHECK_MS = 5000;
/** Screens settle for a moment when one is plugged in or out (several events): then it looks. */
const SCREENS_SETTLE_MS = 1500;

/**
 * WTF Switcher: keeps a World of Warcraft UI (a copy of its WTF folder) for each screen setup, and
 * makes WTF the right one when the screens change (once the game is closed). A window to set it
 * up; in the background, an icon in the menu bar says which UI is in use.
 */
class SwitcherApp {
  private readonly store = new SettingsStore(path.join(app.getPath('userData'), 'settings.json'));
  private readonly settings = this.store.load();
  private switcher: Switcher | null = null;
  private folderProblem: string | null = null;
  private window: BrowserWindow | null = null;
  private tray: Tray | null = null;
  private quitting = false;
  private toldAboutBackground = false;
  private screensTimer: NodeJS.Timeout | null = null;

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

    if (app.isPackaged && !TEST_RUN) {
      this.settings.openAtLogin = app.getLoginItemSettings().openAtLogin;
    }
    if (TEST_GAME) this.settings.gameFolder = TEST_GAME;
    if (!this.settings.gameFolder) {
      this.settings.gameFolder = await detectVersionFolder(os.homedir());
      this.save();
    }
    screen.on('display-added', () => this.screensMayHaveChanged());
    screen.on('display-removed', () => this.screensMayHaveChanged());
    screen.on('display-metrics-changed', () => this.screensMayHaveChanged());
    powerMonitor.on('resume', () => this.screensMayHaveChanged());
    setInterval(() => void this.switcher?.checkGame(), GAME_CHECK_MS);
    await this.useFolder(this.settings.gameFolder);

    const atLogin = app.getLoginItemSettings().wasOpenedAtLogin;
    if (atLogin && this.settings.background && this.switcher?.view().ready) {
      app.dock?.hide();
    } else {
      this.showWindow();
    }
  }

  /** The screens connected now: all of them, and the laptop's own on its own. */
  private screens(): Screens {
    const screens = screen.getAllDisplays().map(screenOf);
    return { setup: setupOf(screens), laptop: setupOf(screens.filter((one) => one.internal)) };
  }

  private screensMayHaveChanged(): void {
    if (this.screensTimer) clearTimeout(this.screensTimer);
    this.screensTimer = setTimeout(() => {
      this.screensTimer = null;
      void this.switcher?.screensChanged(this.screens());
    }, SCREENS_SETTLE_MS);
  }

  /** Switches the UIs of this game version folder (null: none chosen yet). */
  private async useFolder(folder: string | null): Promise<void> {
    this.switcher = null;
    this.folderProblem = null;
    const versionFolder = folder ? await versionFolderOf(folder) : null;
    if (folder && !versionFolder) {
      this.folderProblem = 'That isn’t the game’s folder';
    }
    if (versionFolder) {
      const switcher = new Switcher(
        {
          store: new ProfileStore(versionFolder),
          gameRunning: async () => gameRunningIn(await runningCommands(), versionFolder),
          ask: (active, wanted) => this.ask(active, wanted),
          now: () => new Date(),
        },
        {
          changed: () => this.refresh(),
          // Said by the window when it's open, else by a notification.
          switched: (_from, to) => this.tell(`${to}’s UI`, 'The game opens with it now.'),
          waiting: (to) => this.tell(`${to}’s UI next`, 'Once the game closes.'),
          newSetup: (setup, byDefault) =>
            this.tell(
              'New screens',
              byDefault
                ? `${setup} uses ${byDefault}’s UI, the laptop’s. Another? Pick it here.`
                : `Pick a UI for ${setup}.`,
            ),
        },
      );
      this.switcher = switcher;
      await switcher.start(this.screens());
    }
    this.refresh();
  }

  /** Which UI to keep what the game saved as, when it could be either's. */
  private async ask(active: string, wanted: string): Promise<string> {
    app.focus({ steal: true });
    const options: Electron.MessageBoxOptions = {
      type: 'question',
      message: 'Keep the UI the game left as…',
      detail: `It opened with ${active}’s UI, but these screens use ${wanted}’s.`,
      buttons: [active, wanted],
      defaultId: 0,
      cancelId: 0,
      noLink: true,
    };
    const { response } = this.windowVisible()
      ? await dialog.showMessageBox(this.window!, options)
      : await dialog.showMessageBox(options);
    return response === 1 ? wanted : active;
  }

  // ---- the window ----

  private showWindow(): void {
    void app.dock?.show();
    if (this.window) {
      this.window.show();
      this.window.focus();
      return;
    }
    const window = new BrowserWindow({
      width: WIDTH,
      height: 240,
      useContentSize: true,
      resizable: false,
      maximizable: false,
      fullscreenable: false,
      title: 'WTF Switcher',
      icon: path.join(ASSETS, 'icon.png'),
      show: false,
      webPreferences: {
        preload: path.join(__dirname, 'preload.js'),
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
      },
    });
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    window.webContents.on('will-navigate', (event) => event.preventDefault());
    window.once('ready-to-show', () => window.show());
    window.on('close', (event) => {
      if (this.quitting || !this.settings.background) return;
      // In the background: the window goes, the switcher stays (in the menu bar).
      event.preventDefault();
      window.hide();
      app.dock?.hide();
      if (!this.toldAboutBackground) {
        this.toldAboutBackground = true;
        this.notify('Still switching', 'Quit it from its icon in the menu bar.');
      }
    });
    window.on('closed', () => {
      this.window = null;
    });
    void window.loadFile(path.join(__dirname, 'renderer', 'index.html'));
    this.window = window;
  }

  private windowVisible(): boolean {
    return Boolean(this.window?.isVisible());
  }

  private setMenu(): void {
    Menu.setApplicationMenu(
      Menu.buildFromTemplate([
        {
          label: app.name,
          submenu: [
            { role: 'about' },
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

  private handleWindowCalls(): void {
    ipcMain.handle('state:get', () => this.state());
    ipcMain.handle('folder:choose', () => this.chooseFolder());
    ipcMain.handle('profile:create', (_event, name: unknown, forScreens: unknown) =>
      this.switcher
        ? this.switcher.create(String(name ?? ''), forScreens === true)
        : 'Choose the game’s folder first.',
    );
    ipcMain.handle('profile:use', (_event, name: unknown) =>
      this.switcher?.use(typeof name === 'string' && name ? name : null),
    );
    ipcMain.handle('profiles:open', () => this.openProfiles());
    ipcMain.handle('switch:retry', () => this.switcher?.retry());
    ipcMain.handle('window:fit', (event, height: unknown) => {
      const window = BrowserWindow.fromWebContents(event.sender);
      if (!window || typeof height !== 'number' || !Number.isFinite(height)) return;
      // A window that can't be resized won't get smaller either: allowed for this moment only.
      window.setResizable(true);
      window.setContentSize(WIDTH, Math.round(Math.min(Math.max(height, 120), 900)));
      window.setResizable(false);
    });
    ipcMain.handle('background:set', (_event, on: unknown) => {
      this.settings.background = on === true;
      this.save();
      this.refresh();
    });
    ipcMain.handle('login:set', (_event, on: unknown) => {
      this.settings.openAtLogin = on === true;
      // A test run only notes it: the development build mustn't open at login.
      if (!TEST_RUN) app.setLoginItemSettings({ openAtLogin: this.settings.openAtLogin });
      this.save();
      this.refresh();
    });
  }

  private async chooseFolder(): Promise<void> {
    const options: Electron.OpenDialogOptions = {
      title: 'Choose World of Warcraft’s folder',
      buttonLabel: 'Choose',
      properties: ['openDirectory'],
      defaultPath: this.settings.gameFolder ?? undefined,
    };
    const picked = this.window
      ? await dialog.showOpenDialog(this.window, options)
      : await dialog.showOpenDialog(options);
    if (picked.canceled || picked.filePaths.length === 0) return;
    const folder = picked.filePaths[0];
    this.settings.gameFolder = (await versionFolderOf(folder)) ?? folder;
    this.save();
    await this.useFolder(this.settings.gameFolder);
  }

  private async openProfiles(): Promise<void> {
    const folder = this.settings.gameFolder;
    if (!folder) return;
    const store = new ProfileStore(folder);
    await shell.openPath(this.switcher?.view().ready ? store.dir : folder);
  }

  private state(): AppState {
    const view = this.switcher?.view();
    return {
      version: app.getVersion(),
      gameFolder: this.settings.gameFolder,
      gameVersion: this.settings.gameFolder ? versionLabel(this.settings.gameFolder) : null,
      switching: this.switcher !== null,
      ready: view?.ready ?? false,
      status: this.statusLine(),
      problem: Boolean(this.folderProblem || !this.switcher || view?.error),
      setup: view?.setup ?? this.screens().setup,
      laptopOnly: this.screens().setup !== null && this.screens().setup === this.screens().laptop,
      active: view?.active ?? null,
      wanted: view?.wanted ?? null,
      byDefault: view?.byDefault ?? true,
      defaultUi: view?.defaultUi ?? null,
      profiles: view?.profiles ?? [],
      shared: DEFAULT_SHARED,
      gameRunning: view?.gameRunning ?? false,
      background: this.settings.background,
      openAtLogin: this.settings.openAtLogin,
    };
  }

  /** One line: what it's doing (the window's status, the menu bar's first line). */
  private statusLine(): string {
    if (this.folderProblem) return this.folderProblem;
    const view = this.switcher?.view();
    if (!view) return 'Choose the game’s folder';
    if (view.error) return `Couldn’t switch: ${view.error}`;
    if (!view.ready) return 'Keep the game’s UI to start';
    if (view.waiting && view.wanted) return `${view.wanted}’s UI once the game closes`;
    if (!view.wanted) return 'Pick a UI for these screens';
    return `Using ${view.active}’s UI${view.byDefault ? ' (the default)' : ''}`;
  }

  /** Tells the window and the menu bar what changed. */
  private refresh(): void {
    this.window?.webContents.send('state', this.state());
    this.updateTray();
  }

  // ---- in the background ----

  /** The menu bar icon: there while running in the background, with which UI is in use. */
  private updateTray(): void {
    if (!this.settings.background) {
      this.tray?.destroy();
      this.tray = null;
      return;
    }
    if (!this.tray) {
      this.tray = new Tray(nativeImage.createFromPath(path.join(ASSETS, 'trayTemplate.png')));
    }
    const status = this.statusLine();
    this.tray.setToolTip(`WTF Switcher: ${status}`);
    const view = this.switcher?.view();
    const menu: MenuItemConstructorOptions[] = [
      { label: status, enabled: false },
      { type: 'separator' },
      { label: 'Open WTF Switcher', click: () => this.showWindow() },
      {
        label: 'Show the UIs in Finder',
        enabled: Boolean(this.settings.gameFolder),
        click: () => void this.openProfiles(),
      },
      ...(view?.error ? [{ label: 'Try Again', click: () => void this.switcher?.retry() }] : []),
      { type: 'separator' },
      { label: 'Quit', click: () => this.quit() },
    ];
    this.tray.setContextMenu(Menu.buildFromTemplate(menu));
  }

  private quit(): void {
    this.quitting = true;
    app.quit();
  }

  /** A notification, when the window isn't there to show it. */
  private tell(title: string, body: string): void {
    if (!this.windowVisible()) this.notify(title, body);
  }

  private notify(title: string, body: string): void {
    if (!Notification.isSupported()) return;
    const notification = new Notification({ title, body, silent: true });
    notification.on('click', () => this.showWindow());
    notification.show();
  }

  private save(): void {
    this.store.save(this.settings);
  }
}

// One switcher at a time: opening it again shows the running one's window.
if (app.requestSingleInstanceLock()) {
  new SwitcherApp().start().catch((error: unknown) => {
    dialog.showErrorBox(
      'WTF Switcher',
      `It couldn’t start: ${error instanceof Error ? error.message : String(error)}`,
    );
    app.quit();
  });
} else {
  app.quit();
}
