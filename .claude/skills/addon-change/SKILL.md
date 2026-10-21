---
name: addon-change
description: Use whenever a change touches a WoW addon in addons/ (Raidsort, GuildAssistantProfessions, or a new one) — its Lua, .toc, README or CHANGELOG. Covers bumping the version, tests, the CHANGELOG, and the Botlog task that reminds Sérgio to update the CurseForge description and upload the addon.
---

# Changing an addon

The addons live in `addons/<Name>/` (Lua, `.toc`, `README.md`, `CHANGELOG.md`); their tests in
`addons/dev/<Name>/*.spec.lua`. `addons/README.md` explains the tooling.

| Addon                     | CurseForge page                                                   |
| ------------------------- | ----------------------------------------------------------------- |
| Raidsort                  | https://www.curseforge.com/wow/addons/raid-sort                   |
| GuildAssistantProfessions | https://www.curseforge.com/wow/addons/guild-assistant-professions |

Each addon's CurseForge project id is in its `.toc` (`## X-Curse-Project-ID`). Its description is
edited at `https://authors.curseforge.com/#/projects/<project id>/description` (e.g.
https://authors.curseforge.com/#/projects/1756540/description for GuildAssistantProfessions):
read the id from the `.toc`, don't guess it. A new addon: add its row here once it has a
CurseForge project and its id is in the `.toc`.

## Every change to an addon

1. **Tests first-class.** Add or update specs in `addons/dev/<Name>/` for what changed (Core logic
   directly; game-facing code against the fake game the specs already set up). Run them from
   `addons/`: `npm test` (or `npm test -- <Name>`), and only call the change done when they pass.
   Fixtures shared with the backoffice or API (e.g. `export.fixture.lua`, `export.fixture.json`)
   stay in step with the other side.

2. **Bump the version** in `## Version:` of `addons/<Name>/<Name>.toc`, semver, your call:
   - **major**: breaks what players or Guild Assistant rely on (the setup/export format, commands
     removed or renamed, saved data that no longer loads);
   - **minor**: something new (a feature, a command, a new export field read);
   - **patch**: a fix or polish, nothing new to learn.
   One bump per change (task), even if several files changed; don't bump twice in one task.

3. **CHANGELOG.md**: a section `## <new version>` at the top, a few short bullets in plain
   language (what players notice). The upload sends this section as the release notes.

4. **The `.toc` `## Notes:`** (the one-line description shown in game and shipped with every
   upload): update it if what the addon does changed.

5. **README.md** of the addon: update the commands, windows or formats that changed.

6. **Check the package**: from `addons/`, `npm run publish:curseforge -- <Name> --dry-run`
   (packs `dist/<Name>-<version>.zip`, uploads nothing). Never run it without `--dry-run`:
   uploading is Sérgio's.

7. **Botlog task for the manual steps** (project GA). CurseForge has no API for the project page's
   description, so create one task (`create_task`) **assigned to Sérgio**
   (`assignee: "user:a9f2ac22-c8eb-4216-880d-74e8fc6df1fc"`), status **todo**, type
   **improvement**, epic **Addon Development**, titled
   `Publish <Name> <version> and update its CurseForge description`, with:
   - the CurseForge page link (table above) and the link to edit its description,
     `https://authors.curseforge.com/#/projects/<X-Curse-Project-ID from the .toc>/description`;
   - the upload command, for this addon only, run from `addons/`:
     `npm run publish:curseforge -- <Name>` (`--beta`/`--alpha` if it isn't a release);
   - the **full new project description** to paste on CurseForge (Markdown: what it does, how to
     use it, commands), written from the addon's README. Put it **inside a fenced code block**
     (```` ```markdown ```` … ```` ``` ````; use a four-backtick fence if the description itself has
     a ``` fence) so Botlog shows the raw Markdown, ready to copy and paste, not rendered;
   - what changed in this version (the CHANGELOG section).
   Mention the task's id in the summary comment of the task you worked on.

## Don't

- Don't upload to CurseForge, and don't commit (Sérgio does both).
- Don't copy the addon into the game folder (`~/Applications/World of Warcraft/…`) unless asked;
  give the `cp -R` command instead.
