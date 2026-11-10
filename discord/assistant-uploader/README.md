# Guild Assistant Uploader

A small desktop app for Mac and Windows (Electron) that uploads the **GuildAssistant Professions**
addon's file to Guild Assistant each time World of Warcraft saves it. Nobody has to drop
`GuildAssistantProfessions.lua` into **Import professions** by hand after playing.

## Using it

1. Install it from the [latest release](https://github.com/sj-freitas/sf-wow-tools/releases/latest)
   (the `.dmg` on a Mac, the `.exe` on Windows). It isn't signed with a certificate yet:
   - Mac: the first time, System Settings, Privacy & Security, **Open Anyway**.
   - Windows: **More info**, **Run anyway**.
2. **Upload key:** **Get an upload key** opens Guild Assistant's **Upload keys** page
   (`/upload-keys`, also in the user menu). Make a key there, copy it, paste it into the app and
   click **Save**. The app checks it with Guild Assistant and then shows who it uploads as and to
   which guilds. The key is kept encrypted by the system (Keychain on a Mac, DPAPI on Windows,
   through Electron's `safeStorage`). It can only upload professions.
3. **Game folder:** found by itself when the game is where Battle.net puts it:
   - Mac: `/Applications/World of Warcraft` or `~/Applications/World of Warcraft`;
   - Windows: `C:\Program Files (x86)\World of Warcraft`.

   Otherwise, **Choose…** it. It takes the folder with `_forever_` (or `_classic_era_`) in it, a
   version's folder, or any folder inside one. The app lists every copy of the file it finds, one
   per game version and WoW account:
   `<version>/WTF/Account/<account>/SavedVariables/GuildAssistantProfessions.lua`.
4. **In the background** (on by default): closing the window keeps the app running. Its icon
   shows it's there: the paperclip in the menu bar on a Mac, or the notification area by the
   clock on Windows. That icon's menu has **Open**, **Upload now** and **Quit**.
   **Start when I log in** opens it hidden at login.

## What it does

- It watches each file's folder (the system's file events) and waits 2 seconds after a change,
  since the game writes the file in bursts.
- It reads the file and sends it to `POST /api/upload/professions` with the key. Guild Assistant
  imports it into each of the player's guilds, as **Import professions** does (see
  `discord/assistant-api/README.md`, Professions).
- **Only changed files are sent.** The game rewrites the file at every `/reload` and logout, so
  the app remembers the SHA-256 of what it last sent of each file (in its settings) and skips the
  same contents, even after a restart. **Upload now** sends them anyway.
- Every 5 minutes it looks at the folder again. That catches a file that appeared (the addon's
  first `/ga-prof save`) or a change the file events missed, and retries a failed upload.
- While the window is closed, it posts a notification for each upload. If uploads fail, it
  notifies once, not at every retry.
- A key deleted on Guild Assistant shows as "doesn't work any more" in step 1.

Settings (folder, encrypted key, the last upload of each file) are in `settings.json` in the
app's data folder:
- Mac: `~/Library/Application Support/Guild Assistant Uploader`;
- Windows: `%APPDATA%\Guild Assistant Uploader`.

## Code

- `src/main.ts`: the main process (the window, the tray icon, the key, the settings and the
  watcher).
- `src/preload.ts`: the window's only way to the main process (`window.uploader`).
- `src/renderer/`: the window (plain HTML, CSS and TypeScript, the website's colours; no Node in
  it).
- `src/core/`: the logic, which needs no Electron and has the tests:
  - `game-files.ts`: finding the game's folder and the files;
  - `watcher.ts`: when to upload what;
  - `api.ts`: Guild Assistant's endpoints;
  - `settings.ts`.

```bash
npm install
npm test             # the logic's tests
npm run typecheck
npm start            # builds and opens it
GA_UPLOADER_SITE=http://localhost:3000 npm start   # against a local assistant-api
GA_UPLOADER_DATA=/tmp/uploader npm start           # with its own settings folder
npm run dist:mac     # an installer in release/ (dist:win on Windows)
```

## Releasing

The installers are built by GitHub Actions (`.github/workflows/uploader.yml`) on a Mac and a
Windows runner. To release:
1. Bump `version` in `package.json` and commit it.
2. Push a tag `uploader-v<version>`. The workflow builds both installers and publishes them as a
   GitHub release.
3. The Upload keys page links to `releases/latest`, so the newest release is the one people get.

**Run workflow** in GitHub Actions builds the installers (as artifacts) without releasing them.
