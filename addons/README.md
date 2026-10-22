# WoW addons

An npm project for the addons in this folder: Raidsort and GuildAssistantProfessions. `npm install` once, then:

| Command                                   | What it does                                              |
| ----------------------------------------- | --------------------------------------------------------- |
| `npm test`                                | Runs the Lua tests (`dev/**/*.spec.lua`)                  |
| `npm run package`                         | Zips each addon to `dist/<Name>-<version>.zip`            |
| `npm run publish:curseforge -- Raidsort`  | Packages and uploads to CurseForge (`--beta`, `--alpha`, `--dry-run`) |

## Trying an addon in game

Copy it into the game's AddOns folder and `/reload`. WoW Forever (client 1.60.1, interface 16001)
is installed as `_classic_beta_` for now; Classic Era (`_classic_era_`, 11509) works too:

```sh
cp -R "./Raidsort" "$HOME/Applications/World of Warcraft/_classic_beta_/Interface/AddOns"
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

## Backlog

- Presets: keep several setups by name (`/ga-rs upload cthun`, `/ga-rs sort cthun`).

