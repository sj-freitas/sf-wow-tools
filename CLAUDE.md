# Working on this repo

Guild Assistant (a Discord bot, its API and backoffice in `discord/`) and WoW addons (`addons/`).
Each part's README explains it; tasks are on the Botlog board (project GA), not in TODO.md.

## Always

- **Never commit or push.** Sérgio commits: one task = one commit, so keep each change to its task.
- **Botlog:** never move a task past **Development Completed**; Deployed / Testing and Done are
  Sérgio's. Never archive.
- **Manual steps** (anything beyond running a migration or a command: a URL to register, a page to
  edit, a setting to change) become a **To do** task on Botlog assigned to Sérgio
  (`user:a9f2ac22-c8eb-4216-880d-74e8fc6df1fc`), saying exactly what to do and where.
  Migrations (`npm run prisma:deploy`) and commands (`npm run commands:register`) just go in the
  summary.
- **Don't upload** an addon to CurseForge (`--dry-run` only) and don't write into the WoW install
  (`~/Applications/World of Warcraft/…`) unless asked: give the command instead.
- Run the checks of what changed before calling it done (tests, lint, build), and say what wasn't
  checked (a browser, the game, Discord).

## Skills

- Changing an addon (`addons/`): follow the **addon-change** skill (tests, version bump, CHANGELOG,
  the publish task for Sérgio).
- Working the board ("check the board", "do GA-<n>"): follow the **board-task** skill (refined To do
  tasks only, one at a time).
