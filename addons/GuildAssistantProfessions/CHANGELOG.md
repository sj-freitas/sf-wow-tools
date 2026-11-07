# GuildAssistant Professions

## 1.1.0

- What is saved no longer grows forever. A guildmate's character not heard of for 90 days is
  forgotten, and so is a profession link not changed for 60 days. At most the 1,000 most recent
  characters of each guild are kept. Your own characters are always kept, and Guild Assistant
  keeps what it already imported.
- Your character is restamped at login once a month, so guildmates keep it while you play it.
- Logging in to a big guild is smoother: the export is rebuilt once for a batch of characters
  received, not once for each.
- Guild messages are paced properly (a few at once, then one a second), and a character is sent
  once, not again for each guildmate who asks while it waits.
- A guildmate's message that stops halfway (they logged out, a piece was lost) is given up after a
  minute, instead of being held until the next reload.

## 1.0.3

- WoW Forever: your characters are saved under their full name ("Shivan Darkwhisp"), not just the
  first name, and under the realm's rule set ("RP") instead of the server's full name ("CAMWOW EU4
  Realm 10 RP"), which could change. What was already saved is renamed when you log in.
- Copies of your characters that guildmates on older versions still have under the old name
  aren't taken back.

## 1.0.2

- Renamed GuildAssistant Professions (it was Guild Assistant Professions), like Guild Assistant's
  other addons. Same addon, same commands and saved data.

## 1.0.1

- `/ga-prof save` writes what is recorded to the file (it reloads the screen); it's the new name
  of `/ga-prof log`, which still works.

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
