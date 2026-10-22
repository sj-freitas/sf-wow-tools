# Guild Assistant Professions

Remembers what your characters can craft, shares it with your guildmates' addons, and keeps it for
Guild Assistant, so your guild can see everyone's professions and recipes on the website. One
guildmate's upload carries everyone the addon has heard about.

Made for WoW Forever; works on Classic Era too.

## Quick start

1. Install the addon ([CurseForge](https://www.curseforge.com/wow/addons/guild-assistant-professions))
   and log in (or `/reload`). The chat says "Guild Assistant Professions:
   Loaded." when it's on.
2. **Open each profession's window once** (and Enchanting's): the game only shows an addon the
   recipes while that window is open. Do this on every character you want to share. It is recorded
   by itself; there is nothing to export.
3. Type `/ga-prof log` (the chat suggests it after recording): it writes what the addon recorded
   to a file in the game's folder, `WTF/Account/<account>/SavedVariables/GuildAssistantProfessions.lua`
   (e.g. under `_classic_era_`). Addons can't write files themselves: the game writes this one when
   the interface reloads, which is what `/ga-prof log` does, or when you log out.
   `/ga-prof status` says where it is and when it was last updated.
4. On Guild Assistant: **Roster**, **Import professions**, and drop that file there (or choose it,
   or paste its contents). Every character of yours in that guild is updated at once, and so are
   your guildmates' that your addon received.

Do it again after learning new recipes.

## Sharing with your guild

The addons of a guild talk to each other over the game's hidden addon channel, quietly (nothing in
the chat):

- When your addon records something new, it sends that character's professions to the guild.
- At login it tells the guild who it knows and how recent; a guildmate with newer (or missing) data
  sends it. So professions spread even when their player is offline, as long as someone online has
  them.
- The most recent copy of a character wins, whoever sent it: it decides which professions the
  character has (a profession unlearned and replaced, say Blacksmithing for Engineering, goes
  everywhere), and an older copy can't bring one back. Within a profession, recipes are only ever
  added. Only characters of the same guild are shared (not your alts in other guilds, nor
  profession links).

`/ga-prof status` says how many guild characters your addon has and what was sent and received.

## Commands

| Command           | What it does                                                               |
| ----------------- | -------------------------------------------------------------------------- |
| `/ga-prof log`    | Writes what is recorded to the file (reloads the interface)                |
| `/ga-prof status` | What is saved (your characters, and how many of the guild's), when, and where the file is |
| `/ga-prof`        | Lists the commands                                                         |

`/gaprof` works too.

## What it saves

Per account (`GuildAssistantProfessionsDB`): each character you log in with, its professions and
skill (read at login), and the recipes seen in its profession windows, as WoW spell ids (the
crafted item's id when the game gives no spell). On WoW Forever a profession's window lists all its
recipes, so what it shows replaces what was saved. On Classic Era a window with a filter on shows
fewer, so recipes are only added there. Each character keeps when something new was last recorded
for it, and each profession when it was learned (first seen; again after unlearning it) and last
changed, by the game server's clock.

**Dropping a profession:** unlearn it in game and the addon drops it, with its recipes, from what
is saved (the chat says so), and the next upload of that newer data drops it on Guild Assistant too
(main professions; Cooking, First Aid and Fishing stay). The character's page (Professions tab) also
has **Drop this profession** for its player or an Officer. An older copy then doesn't bring it
back; one that says it was learned again after the drop does.

Guild Assistant needs 1.0's dates (format 2): a file from an older version isn't imported, and the
website asks you to update the addon.

Opening someone else's profession link (WoW Forever) records their recipes too, under their name,
marked as seen through a link; those aren't shared or imported (their own addon shares them).

If something fails, the addon says so in the chat ("something went wrong: …"); the game also
writes Lua errors to `Logs/General.log` in its folder.

## The export

The saved data holds the export as JSON (`export`), rebuilt whenever something new is recorded, on
`/ga-prof log` and on logout. For example:

```json
{"addon":"GuildAssistantProfessions","format":2,"characters":[{"name":"Luna","realm":"Wild Growth","class":"MAGE","source":"own","updated":1792000000,"professions":[{"name":"Enchanting","skill":300,"max":300,"learned":1791000000,"updated":1792000000,"spells":[13890,20034],"items":[]}]}]}
```

`source` is `own` (one of your account's), `guild` (a guildmate's, received from the guild) or
`link`. Guild Assistant reads it from the uploaded file, matches your characters by name to yours in
the guild and the guild's to its roster, and looks the recipe names up on Wowhead.
