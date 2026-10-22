# Guild Assistant Professions

## 1.0.0

- Shares professions with your guild: the addons of a guild send each other what they know,
  quietly, so one guildmate's upload to Guild Assistant carries everyone's. Missing or newer data
  is caught up at login from whoever is online.
- The most recent copy of a character wins on which professions it has: one unlearned and
  replaced (Blacksmithing for Engineering) goes everywhere, and an older copy can't bring it back.
  Recipes within a profession are only ever added.
- Remembers when each profession was learned and last changed, so Guild Assistant can tell a
  profession learned again from an old copy of a dropped one.
- `/ga-prof status` lists your characters and counts the guild's, with what was shared and
  received.
- The export is format 2 (dated by the game server): Guild Assistant no longer imports files from
  older versions, and asks to update the addon.

## 0.9.1

- Unlearning a profession drops it (and its recipes) from what is saved, and the chat says so:
  `/ga-prof log` writes it to the file for Guild Assistant.
- Logging in no longer risks dropping every profession when the game hasn't listed them yet.

## 0.9.0

- First version (experimental): remembers every character's professions and recipes, and those of
  profession links you open, for Guild Assistant. The export is kept in the saved variables file,
  which is uploaded on the website: `/ga-prof log` writes it, `/ga-prof status` says what is saved,
  when, and where.
- Says "Loaded." at login, and reports its errors in the chat (the game hides them by default).
- Reads WoW Forever's client, which has the modern API (`GetProfessions`, `C_TradeSkillUI`) and
  not Classic Era's; an event the client lacks no longer stops the addon.
