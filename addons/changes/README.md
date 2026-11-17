# Change notes

What's changed in each addon since its last upload, one file per change, in `changes/<Addon>/`
(for example `changes/GuildAssistantDatabase/guild-sort.md`). A change to an addon adds one here
and doesn't touch the addon's version or its `CHANGELOG.md`. Notes are separate files, so changes
made side by side (several sessions, the weekly Database pull request) don't conflict.

```markdown
---
bump: minor
---

- **Sort the guildmates** by Name, Skill or Profession: click a column's title.
```

- `bump`: `patch` (a fix or polish), `minor` (something new), or `major` (breaks what players or
  Guild Assistant rely on).
- Below it: the CHANGELOG lines, as players will read them.
- Name the file after the change, so two changes never pick the same name (`GA-112-guild-sort.md`).
  More for the same change goes in its own file. Fixing a change that isn't uploaded yet edits its
  note.

`npm run publish:curseforge -- <Addon>` gathers them. The version is the newest one on CurseForge,
bumped by the biggest note, and the notes become its CHANGELOG section and release notes. Once the
upload works, it sets the `.toc`, writes the CHANGELOG, deletes the notes, and commits and pushes
that. `--dry-run` says which version it would be, and packs it. How it works:
`scripts/release.mjs`.
