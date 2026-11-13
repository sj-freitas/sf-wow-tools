# Maintaining sf-wow-tools

How this repository is worked on: each kind of change, start to finish. What each part is and how
it works is in its own README; this is the map.

## What's here, and where it runs

| Part | What it is | How it goes live |
| --- | --- | --- |
| [`discord/assistant-api`](discord/assistant-api/README.md) | Guild Assistant's API and Discord bot (NestJS), the only part with the database | Push to `main`: Render deploys it |
| [`discord/assistant-backoffice`](discord/assistant-backoffice/README.md) | The website (React), served by the API | With the API, same deploy |
| [`discord/assistant-uploader`](discord/assistant-uploader/README.md) | The Uploader app (Electron, Mac and Windows) | A `uploader-v<version>` tag: GitHub release |
| [`addons/`](addons/README.md) | The WoW addons: Raidsort, GuildAssistant Professions, GuildAssistant Database | Uploaded to CurseForge, by hand |

Tasks are on the [Botlog board](https://bot-log-six.vercel.app/projects/GA), project **GA** (not in
`TODO.md`). Addons for local use only, never published, are in another repository,
[self-addons](https://github.com/sj-freitas/self-addons) (private), with its own MAINTAINING.md.

## Setting up

Node 22 or later. `npm install` in each package you work on (`discord/assistant-api`,
`discord/assistant-backoffice`, `discord/assistant-uploader`, `addons`). Running the API locally
needs its `.env` (the database, Discord's keys): [its README](discord/assistant-api/README.md).
Deploying from scratch (Render, Supabase, Discord) is in the [root README](README.md).

## A change to the API, the bot or the website

1. Change it. Website pages follow the UI rules (`.claude/skills/ui-rules`): responsive, never a
   horizontal scroll, nothing that appears moves the layout, no emojis.
2. Check what changed: in `assistant-api`, `npm run lint`, `npm test`, `npm run build`; in
   `assistant-backoffice`, `npx tsc -b`, `npm run lint`, `npm run build`.
3. Commit to `main` (one task, one commit) and push. **Pushing to `main` deploys**: Render
   (service "Website, API and Bot") builds the image, and the container applies the database
   migrations as it starts (`prisma migrate deploy`). Check the deploy goes **live** (about two
   minutes); if it fails, its logs say why, and the previous version keeps running.
4. The bot's slash commands changed (`src/bot/commands.json`): `npm run commands:register` in
   `assistant-api`, with production's Discord keys.
5. Anything else by hand (a setting, a page to edit, a URL to register): a **To do** task on Botlog
   saying exactly what and where.
6. A change you asked for that someone should try on the site: a `Test: …` task on Botlog
   (`.claude/skills/ui-test-ticket`).

## A change to an addon

The full steps are in `.claude/skills/addon-change`; in short:

1. Change it, with specs in `addons/dev/<Addon>/` (against a fake game). `npm test` in `addons/`.
2. **Version** in its `.toc`: bump it once, past the version on CurseForge. While a version isn't
   uploaded yet, more changes go into that same version (and its CHANGELOG section).
3. CHANGELOG, the addon's README, and the `.toc`'s Notes when what it does changed.
4. `npm run publish:curseforge -- <Addon> --dry-run` packs `addons/dist/<Addon>-<version>.zip`.
5. Into the game to try it: unzip it into
   `~/Applications/World of Warcraft/_forever_/Interface/AddOns` (`unzip -oq` the zip there).
   `/reload` when only files changed; restart the game when one was added.
6. Commit and push (an addon isn't deployed by the push).
7. **Publishing**, once it works in game: `npm run publish:curseforge -- <Addon>` uploads it
   (CurseForge reviews it before it's public). Its page's description can't be set by the API:
   the Botlog task "Publish <Addon> <version> and update its CurseForge description" has the text
   to paste.

## GuildAssistant Database's data

`npm run database` in `addons/` rebuilds `GuildAssistantDatabase/Data.lua` and
`GuildAssistantProfessions/Recipes.lua` from the game's data tables, and `Found.lua` from what
players found (gathered by Guild Assistant). The weekly GitHub Action (`Database`) does the same and
opens a pull request when something changed: review `Found.lua`, merge, publish. Details:
[addons/README.md](addons/README.md).

## The Uploader app

Bump its `package.json` version, push a tag `uploader-v<version>`: the `Guild Assistant Uploader`
Action builds the Mac and Windows installers and publishes them as a GitHub release, which the
website's Upload keys page links to. Details: [its README](discord/assistant-uploader/README.md).

## The board

- Work from **refined To do** tasks, one at a time (`.claude/skills/board-task`).
- A finished task goes to **Development Completed**. **Deployed / Testing** and **Done** are
  Sérgio's; tasks are never archived.
- Manual steps and tests for Sérgio are tasks assigned to him.

## Rules for Claude

[CLAUDE.md](CLAUDE.md), and the skills in `.claude/skills/` (addon-change, board-task, ui-rules,
ui-test-ticket).
