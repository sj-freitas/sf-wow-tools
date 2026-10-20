# Guild Assistant Professions

Remembers what your characters can craft, and what others can craft when you open their profession
links, for Guild Assistant, so your guild can see your professions and recipes on the website.

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
   or paste its contents). Every character of yours in that guild is updated at once.

Do it again after learning new recipes.

## Commands

| Command           | What it does                                                               |
| ----------------- | -------------------------------------------------------------------------- |
| `/ga-prof log`    | Writes what is recorded to the file (reloads the interface)                |
| `/ga-prof status` | What is saved (characters, professions, recipes), when, and where the file is |
| `/ga-prof`        | Lists the commands                                                         |

`/gaprof` works too.

## What it saves

Per account (`GuildAssistantProfessionsDB`): each character you log in with, its professions and
skill (read at login), and the recipes seen in its profession windows, as WoW spell ids (the
crafted item's id when the game gives no spell). On WoW Forever a profession's window lists all its
recipes, so what it shows replaces what was saved. On Classic Era a window with a filter on shows
fewer, so recipes are only added there, and only unlearning the profession removes them.
Each character keeps when something new was last recorded for it.

Opening someone else's profession link (WoW Forever) records their recipes too, under their name,
marked as seen through a link. Guild Assistant doesn't import other players' characters yet.

If something fails, the addon says so in the chat ("something went wrong: …"); the game also
writes Lua errors to `Logs/General.log` in its folder.

## The export

The saved data holds the export as JSON (`export`), rebuilt whenever something new is recorded, on
`/ga-prof log` and on logout. For example:

```json
{"addon":"GuildAssistantProfessions","format":1,"characters":[{"name":"Luna","realm":"Wild Growth","class":"MAGE","source":"own","updated":1792000000,"professions":[{"name":"Enchanting","skill":300,"max":300,"spells":[13890,20034],"items":[]}]}]}
```

Guild Assistant reads it from the uploaded file, matches the characters by name to yours in the
guild and looks the recipe names up on Wowhead.
