# WoW addons

An npm project for the addons in this folder: Raidsort, GuildAssistantProfessions and
GuildAssistantDatabase. `npm install` once, then:

| Command                                   | What it does                                              |
| ----------------------------------------- | --------------------------------------------------------- |
| `npm test`                                | Runs the Lua tests (`dev/**/*.spec.lua`) and the scripts' (`scripts/**/*.test.mjs`) |
| `npm run package`                         | Zips each addon to `dist/<Name>-<version>.zip`            |
| `npm run publish:curseforge -- Raidsort`  | Packages and uploads to CurseForge (`--beta`, `--alpha`, `--dry-run`) |
| `npm run database`                        | Builds GuildAssistantDatabase's `Data.lua` (and GuildAssistantProfessions' `Recipes.lua`) from the game's data tables (`--bump`, `--build`) |

## Trying an addon in game

Copy it into the game's AddOns folder and `/reload`. WoW Forever (client 1.60.1, interface 16001)
is installed as `_forever_`; Classic Era (`_classic_era_`, 11509) works too, except for
GuildAssistantDatabase, whose data is Forever's:

```sh
cp -R "./Raidsort" "$HOME/Applications/World of Warcraft/_forever_/Interface/AddOns"
```

Turn on Lua errors while testing: `/console scriptErrors 1`. The game also writes them to
`Logs/General.log` in its folder (`[E][Lua]` lines).

WoW Forever's client has the modern API, not Classic Era's: no `GetNumSkillLines`, no
`TRADE_SKILL_UPDATE` (registering an event the client doesn't have is an error).

## Tests

Plain Lua files in `dev/<Addon>/`, run in fengari (Lua written in JavaScript), so no Lua needs
installing: `npm test`, or `npm test -- raid` for the ones whose path has "raid". They're outside the
addon folders, so they're never packaged. Each spec loads the addon's files with fake game
functions where it needs them (see `raid.spec.lua`). They also run with a real Lua from `addons/`
(`lua dev/Raidsort/core.spec.lua`). `dev/Raidsort/export.fixture.lua` is what the backoffice's
"Export for addon" writes (`addonExport.ts`): the test that reads it keeps the two in step.

## Publishing

CurseForge takes uploads through its API with a token; that's what `publish:curseforge` does:

1. Create the project once on CurseForge (https://authors.curseforge.com), by hand; put its id in
   the addon's .toc: `## X-Curse-Project-ID: 123456`.
2. Create an API token (https://authors.curseforge.com/#/settings/api-tokens) and put it in
   `addons/.env` as `CURSEFORGE_API_TOKEN` (see `.env.example`; `.env` is never committed).
3. Bump `## Version:` in the .toc, add a section for it to the addon's `CHANGELOG.md`, then
   `npm run publish:curseforge -- Raidsort --dry-run`, and without `--dry-run` to upload.

The game versions come from the .toc's `## Interface:` (16001 = 1.60.1). A version CurseForge doesn't
list yet is left out with a warning; if none is listed, nothing is uploaded.

## Raidsort

Sorts a raid into groups from a pasted setup and hands out the raid roles. How to use it, every
command and the setup format: [Raidsort/README.md](Raidsort/README.md) (shipped with the addon).

## GuildAssistantProfessions

Remembers every character's professions and recipes (and profession links you open) and keeps them
as JSON in its saved variables file, which is uploaded on Guild Assistant (Roster, Import
professions). How to use it: [GuildAssistantProfessions/README.md](GuildAssistantProfessions/README.md).
`dev/GuildAssistantProfessions/export.fixture.json` is what it exports for the spec's sample
characters; the API's import test reads the same file, so the two stay in step.

## GuildAssistantDatabase

Every profession's recipes, searchable in game, with reagents, how to learn them and who can craft
them (from GuildAssistantProfessions' saved data). Its CurseForge project is
1798408 (not public until CurseForge approves it). How to use it:
[GuildAssistantDatabase/README.md](GuildAssistantDatabase/README.md).

### GuildAssistant Database's data

`GuildAssistantDatabase/Data.lua` is built from the game's own data tables (its DB2 files) for WoW
Forever, as [wago.tools](https://wago.tools) exports them as CSV for each build (`wowf`), never
edited by hand. So is `GuildAssistantProfessions/Recipes.lua`, every recipe's spell id per
profession, which that addon asks the game about to record what a character knows without its
window:

```sh
npm run database                         # the latest build; tables kept in addons/.cache
npm run database -- --build 1.60.1.70888 # a given build
npm run database -- --bump               # and, for each addon whose files changed, a patch version and CHANGELOG line
```

It says what it built per profession, leaves `Data.lua` alone when nothing changed but the date,
and counts the items the tables lack (named in game). **Every Monday a GitHub Action** (`Database`,
`.github/workflows/database.yml`) runs it with `--bump`, runs the tests, and opens a pull request
when the data changed (a new build of the game). Merge it, then publish the new version.

The game's data doesn't say where recipes drop, who sells them or what trainers charge (the
servers know that). Two sources add it (the format is in `GuildAssistantDatabase/Core.lua`,
"Sources companions"):

- `GuildAssistantDatabase/Seed.lua`: what was known as of November 2026, compiled once and not
  regenerated (no script for it in the repo). Edit it only to fix a mistake.
- GuildAssistantProfessions (1.2.0 and later): what players see from then on (vendors, trainers,
  loot, quest rewards; `Sources.lua` there), read from its saved data, and shared with the guild
  (1.3.0, `Sync.lua`).
- `GuildAssistantDatabase/Found.lua`: every player's findings, which their uploads carry to Guild
  Assistant (`recipe_sources`, published at `GET /api/recipe-sources`). `npm run database` writes it
  (`found.mjs`; `GUILD_ASSISTANT_URL` for another site), so the Monday pull request carries new
  findings: review them before merging, they come from players' files.

The professions are in `scripts/database/professions.mjs`. How the data is read (`gamedata.mjs`,
`csv.mjs`), written (`lua.mjs`, one text line per recipe and item, read by the addon's `Core.lua` the
first time a profession is needed) and tested (`database.test.mjs`, on a slice of the tables,
`dev/GuildAssistantDatabase/gamedata.fixture.mjs`, which builds `Data.fixture.lua`, what the addon's
specs load: `UPDATE_FIXTURES=1 npm test -- database` rewrites it after a format change;
`Sources.fixture.lua` is a sources companion written by hand for the specs).

## Backlog

- Presets: keep several setups by name (`/ga-rs upload cthun`, `/ga-rs sort cthun`).

