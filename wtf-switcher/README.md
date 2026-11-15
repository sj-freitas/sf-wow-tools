# WTF Switcher

A small Mac app (Electron) that keeps a World of Warcraft UI for each screen setup. The game's UI
lives in its `WTF` folder: where every addon's frames are (Bartender4, PitBull4, Grid2…), the
graphics settings, the UI scale. A layout made for a 4K monitor doesn't fit a laptop's screen. The
app keeps a copy of WTF for each setup, and makes WTF the right one when the screens change.

For personal use: it's built here and run from this folder, not released.

## How it works

- **The UIs** are copies of WTF next to it, in the game version's folder:
  `…/World of Warcraft/_forever_/WTF Profiles/<name>/`. Also kept there:
  - `switcher.json`: which UI WTF is now, and each screen setup's UI;
  - `History/`: the copy each change replaced, the last 5 of each UI.
- **A screen setup** is the screens connected, by name: `Built-in Retina Display`,
  `Built-in Retina Display + LG HDR 4K`. The app knows when they change (Electron's `screen`
  events, and on waking up).
- **Switching**: first WTF is kept as the UI it was, so what changed in the game since isn't lost.
  Then WTF becomes the screens' UI. It's built beside WTF and then moved into place, so a switch
  that fails leaves WTF as it was. A switch that stopped half way (the app quit, the Mac slept) is
  put right the next time the app starts.
- **Only while the game is closed.** The game reads WTF when it opens and saves it when it closes,
  so a switch waits for it to close. The app checks every 5 seconds, from the game's program in
  the process list.
- **When it asks.** Sometimes the UI the game saved could be either UI's:
  - the screens changed while the game was open;
  - the game ran while the app wasn't watching.

  The game may have been played as it opened, or rearranged for the new screens. So the app asks
  whose layout WoW saved: **<the UI it opened with>'s, as it opened**, or **<the screens' UI>'s,
  rearranged for these screens**. The one picked gets what WoW saved (its copy goes to History); the
  other isn't touched.
- **The default.** Screens with no UI of their own use the laptop's: the UI of the built-in screen
  on its own. That covers an iPad by Sidecar next to the laptop, a projector, or another monitor.
  Picking a UI for them gives them their own; **Default** puts them back.
- **Files every UI shares.** Switching leaves these as they are:
  - what Blizzard keeps on its servers too (`*-cache.*` and `*-cache-*`: key bindings, macros,
    chat, Edit Mode, the account's and each character's settings, plus `cache.md5`). The game
    would bring its own back anyway.
  - which addons are on (`AddOns.txt`) and the characters' order;
  - addons' data, which isn't where things are on the screen. An older copy would undo what they've
    learned since: GuildAssistant Professions and Database, Auctionator, BagBrother, Questie,
    Attune, ForeverDungeonJournal, ItemNotes, MacroIcons, !ErrorLog. An older professions file
    would also have the Uploader send Guild Assistant older professions.

  Files a UI has no copy of at all, like a character or an addon new since, stay too. The list is
  `shared` in `switcher.json`: file names, `*` for any part.
- **Edit Mode** layouts are kept on Blizzard's servers, not in WTF, so they don't switch. Edit
  Mode's own layouts do that.

## Using it

1. **The game's UI now:** the first step. Name it (say, `4K monitor`) and **Keep**: WTF is
   copied as that UI.
2. **These screens:** pick their UI, or **New UI…**, a copy of the game's UI now, to rearrange in
   game. The game opens with it from then on.
3. **In the background** (on by default): closing the window keeps the app in the menu bar. Its
   menu shows the UI in use, **Show the UIs in Finder**, and **Try Again** after a failed switch.
   **Start at login** opens it hidden when you log in.

Notifications say when it switched, when a switch waits for the game to close, and when screens
are new to it. They only show when the window is closed.

## Building and running

```bash
npm install
npm test            # the specs (node:test): the screens, the game, the UIs on disk, switching
npm run typecheck
npm run format:check
npm start           # builds and opens it
npm run dist:mac    # release/mac-arm64/WTF Switcher.app (and a .dmg)
```

Install it by copying `release/mac-arm64/WTF Switcher.app` into `/Applications`. It isn't signed
with a certificate, so the first time it opens: System Settings, Privacy & Security, **Open
Anyway**.

**A test run** that leaves the real game alone uses a copy of a game folder:

```bash
WTF_SWITCHER_DATA=/tmp/switcher-data WTF_SWITCHER_GAME=/tmp/game/_forever_ npm start
```

`WTF_SWITCHER_DATA` is the app's own settings folder (the game folder, the background options),
instead of `~/Library/Application Support/WTF Switcher`. A test run never starts at login.

`npm run icons` draws `assets/icon.png` and the menu bar's `trayTemplate*.png`
(`scripts/make-icons.mjs`).

## The code

- `src/core/screens.ts`: a screen setup from Electron's displays.
- `src/core/game.ts`: the game's folder, and whether it's open.
- `src/core/profiles.ts`: the UIs on disk (`ProfileStore`): keep, switch, History, the shared
  files, putting right a change that stopped half way.
- `src/core/switcher.ts`: when to switch, wait or ask (`Switcher`), one change at a time.
- `src/main.ts`: the app (the window, the menu bar, notifications, the question).
- `src/renderer/`: the window. Few words; the details are in tooltips; it takes its content's
  height and never scrolls.
