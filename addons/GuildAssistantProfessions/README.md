# GuildAssistant Professions

Remembers what your characters can craft and which raids they are attuned to, shares it with your
guildmates' addons, and keeps it for Guild Assistant, so your guild can see everyone's professions,
recipes and attunements on the website. One guildmate's upload carries everyone the addon has heard
about.

Made for WoW Forever; works on Classic Era too.

## Quick start

1. Install the addon ([CurseForge](https://www.curseforge.com/wow/addons/guild-assistant-professions))
   and log in (or `/reload`). The chat says "GuildAssistant Professions:
   Loaded." when it's on.
2. **On WoW Forever, log in**: your characters' recipes are recorded, quietly, as you log in and
   as you learn new ones, without opening any window (`/ga-prof status` shows them). **On Classic Era,
   open each profession's window once** (and Enchanting's): the game only shows an addon the
   recipes while that window is open. Do this on every character you want to share. It is recorded
   by itself; there is nothing to export.
3. Type `/ga-prof save` (the chat suggests it after recording): it writes what the addon recorded
   to a file in the game's folder, `WTF/Account/<account>/SavedVariables/GuildAssistantProfessions.lua`
   (e.g. under `_classic_era_`). **It reloads the screen**: addons can't write files themselves, and
   the game writes this one when the interface reloads (or when you log out).
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
- Messages are paced (a few at once, then one a second), so the game doesn't drop them, and a
  character waiting to be sent is sent once, however many guildmates ask for it meanwhile.
- What is kept doesn't grow forever. Your addon restamps your character at login once a month, so
  guildmates keep it while you play it. A guildmate's character not heard of for 90 days (they
  left the guild, or stopped playing it) is forgotten, and so is a profession link not changed for
  60 days. At most the 1,000 most recent characters of each guild are kept. Your own characters
  are always kept, and Guild Assistant keeps what it already imported.

`/ga-prof status` says how many guild characters your addon has and what was sent and received.

## Who can use a recipe you find

Hover any recipe, pattern, plans, formula or schematic that **doesn't bind when picked up** -- in
your bags, on a vendor, in the loot window, in the auction house, a link in the chat -- and its
tooltip says who it would be worth something to:

```
Know this recipe: Felbane Dir, Svajone Something
Can use this recipe: Shivan Darkwhisp
```

The first line, in green, is the characters this addon knows that have the recipe already (so the
plans are no use to them). The second, in light blue, is those who could learn it: they have the
profession at the skill the plans ask for and the specialization they require ("Requires
Armorsmith"), and don't know the recipe yet. Both lines cover your own characters (first) and your
guildmates who use the addon; someone whose profession link you opened isn't listed, as their own
addon tells their guild. At most eight names each, the rest counted ("and 3 more").

When the addon knows which recipe it is but nobody wants it, it says so in grey -- **Nobody in
Dark Horizon can use this recipe.**, your guild by name -- so "nobody" is never mistaken for the
addon not having looked. Out of a guild, or before the game says which you are in, it says "Nobody
you know" instead. One that binds when picked up gets no lines at all: nobody else can have it.

It needs nothing of you: it's what the addon already records and shares. `/ga-prof tooltip off`
stops it (and `/ga-prof tooltip on` brings it back; `/ga-prof tooltip` says which it is now), kept
for the account.

Which recipe a pattern teaches isn't in its tooltip, so the addon works it out from the spell the
game says the item casts, matched against the profession's recipes (`Recipes.lua`), and from the
name when a client gives no spell. Where none of that answers -- a recipe newer than the addon's
tables -- it says nothing at all rather than the wrong names. To see what it makes of one, type
`/ga-prof tooltip` and **shift-click the recipe** after it: it says what the game calls the item,
what its tooltip asks for, which recipe it thinks it teaches and who it would name, step by step. A guildmate on a version before 1.5.0, which
didn't record specializations, isn't listed for plans that need one: it isn't known that they have
it.

## Attunements

Which raids each character may walk into, recorded quietly: at login, on entering the world, as the
quest log reaches the client, a few seconds after login and whenever you hand a quest in, the addon
asks the game whether the raid's attunement quest is complete (Onyxia's Lair: quest 6502 for the
Alliance, 6602 for the Horde) and keeps the answer with the character. It tells "not attuned" from
"not looked at", so a character whose player doesn't have the addon isn't shown as unattuned.

It is read that often because of what the game does at login: the quests a character has completed
are sent to the client a moment **after** it is in the world, and until they arrive the game says
"not complete" about every one of them. So a yes is recorded whenever the game gives one, and a no
only once the game can be believed -- it is asked for the whole list of completed quests
(`C_QuestLog.GetAllCompletedQuestIDs`), and an empty one means it hasn't been sent yet. Until then
the character stays "not looked at" rather than being recorded, and told to the guild, as unattuned.
A client without that function (Classic Era) is taken at its word, and the next read corrects it.

An attunement is for good (a completed quest never uncompletes), so nothing is ever taken back:
what the game says, what a guildmate sent and what was saved before all merge, and `true` wins.
They are shared with the guild like professions: at login your addon offers every character's
attunements, whoever knows more answers once, and a new attunement of yours goes out as you get it.
`/ga-prof status` says how many of the characters looked at are attuned to each raid.

[GuildAssistant Database](../GuildAssistantDatabase/README.md) shows them in game (its
**Attunements** tab, and on each guildmate's page), and the export carries them to Guild Assistant,
which shows them on the character's page.

The next raid with an attunement is one line in `Core.lua` (`Core.ATTUNEMENTS`: the raid's name, its
quest per faction and the game's icon for it, which GuildAssistant Database and the website show). A guildmate on a newer version can share a raid this one doesn't know yet:
it's kept and passed on as it came.

## For GuildAssistant Database

With [GuildAssistant Database](../GuildAssistantDatabase/README.md) installed too, it shows who you
know that can craft each recipe (from what this addon saved). This addon also records, quietly, how
recipes are obtained, which GuildAssistant Database shows with each recipe: the recipes a vendor
sells (when you open its window), what a profession trainer teaches, for how much and what else
each recipe requires (a specialization: "Goblin Engineer", as the window says under "Requires"),
plans and patterns you loot (from a creature, an object, or fishing), and those a quest gives.
It's kept in the saved data (`sources`), and `/ga-prof status` says how many it has.

What you find reaches everyone:

- **Your guild**, quietly, over the same hidden channel as professions: each new finding is sent as
  it's made, and at login the addons compare what they have and send each other what's missing
  (findings are only ever added, never replaced). A guildmate's GuildAssistant Database shows it
  after a `/reload`.
- **Every GuildAssistant Database player**, through Guild Assistant: the export carries the
  findings, Guild Assistant gathers them from every upload, and the next GuildAssistant Database
  release includes them (reviewed by a person first).

## Commands

| Command           | What it does                                                               |
| ----------------- | -------------------------------------------------------------------------- |
| `/ga-prof save`   | Writes what is recorded to the file (**reloads the screen**)               |
| `/ga-prof status` | What is saved (your characters, and how many of the guild's), when, and where the file is |
| `/ga-prof tooltip on\|off` | Whether a recipe's tooltip says who knows it and who could learn it (on by default) |
| `/ga-prof tooltip` + a recipe | Shift-click one after the command: what the addon makes of it, step by step |
| `/ga-prof`        | Lists the commands                                                         |

`/gaprof` works too.

## What it saves

Per account (`GuildAssistantProfessionsDB`): each character you log in with, its professions and
skill (read at login), which raids it is attuned to (`attunements`), and its recipes, as WoW spell ids (the crafted item's id when the game gives
no spell). On WoW Forever they're recorded at login and whenever a recipe is learned, no window
needed: each recipe the game's tables have of the character's professions (`Recipes.lua`, built
with GuildAssistant Database's data, `npm run database`) is asked of the game (`IsPlayerSpell`,
which answers with the window closed), and the known ones are added. A profession's window there
lists all its recipes, so what it shows replaces what was saved (and catches one the tables lack).
Its specialization (Weaponsmith, Goblin Engineer, Tribal Leatherworking…; 1.5.0) is a spell the
character knows too: `Recipes.lua` lists each profession's, they're asked of the game the same way,
and kept with the recipes (`spell:9787`), so guild sharing carries them like one and versions before
1.5.0 pass them on. The window doesn't list them, so they stay when it replaces the rest. The
export gives them apart: `"specializations":[9787]` on the profession, left out of `spells`.
On Classic Era recipes come from the windows only, and a window with a filter on shows fewer, so
they're only added there. Each character keeps when something new was last recorded
for it, and each profession when it was learned (first seen; again after unlearning it) and last
changed, by the game server's clock.

**Dropping a profession:** unlearn it in game and the addon drops it, with its recipes, from what
is saved (the chat says so), and the next upload of that newer data drops it on Guild Assistant too
(main professions; Cooking, First Aid and Fishing stay). The character's page (Professions tab) also
has **Drop this profession** for its player or an Officer. An older copy then doesn't bring it
back; one that says it was learned again after the drop does.

On WoW Forever a character is saved under its full name ("Shivan Darkwhisp") and the realm's rule
set ("RP", "PvP"; the game's realm name also says which of its servers you're on, "CAMWOW EU4 Realm
10 RP", and that part is left out). Data from 1.0.2 and earlier, saved under the first name and the
whole realm name, is renamed at login.

Guild Assistant needs 1.0's dates (format 2): a file from an older version isn't imported, and the
website asks you to update the addon.

Only whether the recipe tooltips are off is saved besides (`tooltip`); it isn't exported.

Opening someone else's profession link (WoW Forever) records their recipes too, under their name,
marked as seen through a link; those aren't shared or imported (their own addon shares them).

If something fails, the addon says so in the chat ("something went wrong: …"); the game also
writes Lua errors to `Logs/General.log` in its folder.

## The export

The saved data holds the export as JSON (`export`), rebuilt whenever something new is recorded (a
few seconds later for what arrives from the guild, once for a whole batch), on `/ga-prof save` and
on logout. For example:

```json
{"addon":"GuildAssistantProfessions","format":2,"characters":[{"name":"Luna","realm":"Test Realm","class":"MAGE","source":"own","updated":1792000000,"professions":[{"name":"Enchanting","skill":300,"max":300,"learned":1791000000,"updated":1792000000,"spells":[13890,20034],"items":[]}]}]}
```

`source` is `own` (one of your account's), `guild` (a guildmate's, received from the guild) or
`link`. A character whose attunements have been looked at also has
`"attunements":[{"key":"ony","attuned":true}]` (1.6.0; the key is the raid's, `ony` for Onyxia's
Lair, and `attuned` false means looked at and not attuned). Once it has recorded how recipes are obtained, the export also has `sources`:
`{"items":[{"id":6047,"entries":["V:Tanaris=Krinkle Goodsteel"]}],"trainers":[{"recipe":"item:10577","cost":2800,"entries":["Tanaris=Nixx Sprocketspring"],"requires":["Goblin Engineer"]}]}`
(an entry is the kind, V vendor, D drop, O object, F fishing or Q quest, then the zone and who; a
trainer's is the zone and the trainer; `requires`, only when the trainer's window says some, is
what else the recipe requires, 1.5.0 and later). Guild Assistant reads it from the uploaded file, matches your characters by name to yours in
the guild and the guild's to its roster, and looks the recipe names up on Wowhead.
