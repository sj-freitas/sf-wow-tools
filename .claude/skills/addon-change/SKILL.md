---
name: addon-change
description: Use whenever a change touches a WoW addon in addons/ (Raidsort, GuildAssistantProfessions, GuildAssistantDatabase, or a new one) — its Lua, .toc, README or CHANGELOG. Covers tests, the change note (never the version or the CHANGELOG by hand), and the one Botlog task per addon that reminds Sérgio to upload it and update its CurseForge description.
---

# Changing an addon

The addons live in `addons/<Name>/` (Lua, `.toc`, `README.md`, `CHANGELOG.md`); their tests in
`addons/dev/<Name>/*.spec.lua`. `addons/README.md` explains the tooling.

| Addon                     | CurseForge page                                                   |
| ------------------------- | ----------------------------------------------------------------- |
| Raidsort                  | https://www.curseforge.com/wow/addons/raid-sort                   |
| GuildAssistantProfessions | https://www.curseforge.com/wow/addons/guild-assistant-professions |
| GuildAssistantDatabase    | not public yet (project 1798408): https://authors.curseforge.com/#/projects/1798408 |

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

2. **A change note, not a version.** Don't touch `## Version:` in the `.toc` or `CHANGELOG.md`.
   Several sessions change the addons at once, and those two lines are where they'd collide. Add one
   file, `addons/changes/<Name>/<task id or topic>.md` (`addons/changes/README.md`):

   ```markdown
   ---
   bump: minor
   ---

   - **Sort the guildmates** by Name, Skill or Profession: click a column's title.
   ```

   - `bump`, your call: **major** breaks what players or Guild Assistant rely on (the setup/export
     format, commands removed or renamed, saved data that no longer loads); **minor** is something
     new (a feature, a command, a new export field read); **patch** is a fix or polish, nothing new
     to learn.
   - The lines are the CHANGELOG's: a few short bullets in plain language (what players notice).
     The upload makes them the version's section and its release notes.
   - One note per change (task). More for the same change, or a fix to it before it's uploaded,
     edits its note. A fix to something players never got isn't a change for them.

   The upload works out the version: the newest one on CurseForge, bumped by the biggest note. So
   "is this version released yet?" is never a question to answer from memory or a task's text.

3. **The `.toc` `## Notes:`** (the one-line description shown in game and shipped with every
   upload): update it if what the addon does changed.

4. **README.md** of the addon: update the commands, windows or formats that changed.

5. **Check the package**: from `addons/`, `npm run publish:curseforge -- <Name> --dry-run`. It asks
   CurseForge what it has and says which version the notes make
   (`GuildAssistantDatabase: 1.9.0 on CurseForge, 1 change note(s) (minor) -> 1.10.0`). It packs
   `dist/<Name>-<that version>.zip`, with the `.toc` and CHANGELOG as they'll be, and writes and
   uploads nothing. That zip is the one to unzip into the game for trying it. Never run it without
   `--dry-run`: uploading is Sérgio's, unless he asks in chat.

6. **Commit and push** as any change (CLAUDE.md): `git pull --rebase` first, since other sessions
   push too. The note goes in the same commit as the change.

7. **One Botlog publish task per addon** (project GA). CurseForge has no API for the project page's
   description, so Sérgio pastes it by hand. Look for an open (To do) task titled
   `Publish <Name> and update its CurseForge description` (or an older `Publish <Name> <version> …`
   one for the same addon):
   - **There is one**: update it (`update_task`) rather than adding another. Add this change's
     lines to "What's in it", and bring the description up to date if this change alters it.
   - **There isn't**: create it (`create_task`), **assigned to Sérgio**
     (`assignee: "user:a9f2ac22-c8eb-4216-880d-74e8fc6df1fc"`), status **todo**, type
     **improvement**, epic **Addon Development**.

   Either way it has:
   - the CurseForge page link (table above), and the link to edit its description,
     `https://authors.curseforge.com/#/projects/<X-Curse-Project-ID from the .toc>/description`;
   - the upload command, for this addon only, run from `addons/` on an up-to-date main:
     `npm run publish:curseforge -- <Name>` (`--beta`/`--alpha` if it isn't a release). It makes
     the version, uploads, then commits and pushes the version and CHANGELOG. A beta or alpha
     first gets its own later step too: the same command without `--beta`, to release that same
     version, checked on the project's Files tab;
   - the **full new project description** to paste on CurseForge (Markdown: what it does, how to
     use it, commands), written from the addon's README. Put it **inside a fenced code block**
     (```` ```markdown ```` … ```` ``` ````; use a four-backtick fence if the description itself has
     a ``` fence) so Botlog shows the raw Markdown, ready to copy and paste, not rendered;
   - what's in it: the notes' lines, and the version the dry run says they make (CurseForge may
     have moved by upload time).
   Mention the task's id in the summary comment of the task you worked on.

## Don't

- Don't upload to CurseForge (Sérgio does, or asks in chat). Commit and push as any change (see
  CLAUDE.md): an addon isn't deployed by the push, only by the upload.
- Don't set a version or write a CHANGELOG section by hand: the upload does both from the notes.
- Don't copy the addon into the game folder (`~/Applications/World of Warcraft/…`) unless asked;
  give the `cp -R` command instead.
