# GuildAssistant Database

Every profession's recipes, in game: search them by name, stat, slot or reagent, keep them to a
level and skill range, and see what each one makes, what it needs, how to learn it and, with
[GuildAssistant Professions](../GuildAssistantProfessions/README.md), who you know that can craft
it. It also lists your own professions' recipes you don't know yet, and which raids your guildmates
are attuned to.

Made for WoW Forever: its data is the game's own, from Forever's data files.

## Using it

Type `/gadb` (or `/ga-db`), or click the clip on the minimap, to open or close the window (it keeps
your last search); `/gadb mithril` opens it searching for "mithril", and `/gadb *` opens it with the
search cleared. With GuildAssistant Professions, three tabs under the window: **Recipes** (all of
what follows), **Guild** and **Attunements** (see "Your guild" and "Attunements" below); a search
from `/gadb` or a shift-click goes to Recipes. Drag the clip to move it around the minimap;
`/gadb minimap` hides it (and brings it back).

- **Search** (top left): words that must all be somewhere in the recipe: its name, the item it
  makes (its slot, type and stats: `plate chest`, `stamina`, `critical strike`, `maces`), its
  reagents (`thorium bar`: what uses them), its plans or pattern, the specialization it needs
  (`armorsmith`, `weaponsmith`, `tribal`: see below), or the profession. Recipes whose
  own name matches come first. The cross at its end clears it.
- **Shift-click an item** anywhere while the window is open (your bags, the character window, a
  link in the chat, a reagent here) with the chat box closed: its name is searched (what uses it,
  what makes it, or the recipe its plans teach), and a stack's split box doesn't open. With the
  chat box open, it's linked there as usual.
- **Level**: the level the item it makes requires (an item that needs none counts as level 1).
  **Skill**: the profession skill it takes to learn. Leave a box empty for no limit.
- **Tab** moves from one box to the next (search, then the level and skill boxes), **Shift-Tab**
  back.
- **Filter**: tick armor types (Cloth, Leather, Mail, Plate) and slots (Head, Chest, One-Hand,
  Ranged…). Any of the armor types ticked, and any of the slots; both when both have some. Under
  the armor types, **Binding: On pickup** lists only the recipes whose item binds when picked up
  (to whoever makes it, as the game's data says). The button says how many are ticked. While
  you're in a guild, **Only guild** (under Binding) lists only the recipes someone in your guild can craft: your characters there, and the
  guildmates who use GuildAssistant Professions (it shares what they know). Under a line, **Show
  unknown recipes** also lists the recipes no source knows (unreleased, removed, or not found
  yet): unticked at first, and once ticked it stays ticked (saved for the account; Clear and Reset
  leave it).
- While searching (words, limits or a filter), each profession on the left says in gold how many
  of its recipes match, and nothing when none do; without a search, how many it has.
- **Not known yet**: only your professions' recipes this character doesn't know yet. The skill
  shows green when you can learn it now, red when not yet. What you know comes from
  GuildAssistant Professions (open each profession's window once so it records it); without it,
  from what the game says, which can miss some.
- **Reset** clears it all, the Filter too (Binding and Only guild as well), and puts the order of
  the list back.
- On the left, a profession shows only its recipes (with Not known yet, only yours are listed,
  with your skill).
- **Skill** and **Level**, above the list, sort it: click one and the list comes in that column's
  order, click the one it's sorted by to turn it around. The chevron beside each says how: pointing
  up for the lowest first, down for the highest, gold on the column the list is sorted by and grey
  on the one that breaks its ties (so Skill up with Level down lists by skill, and recipes of the
  same skill by the highest level). Hovering a title says what its number is and how the list is
  sorted now. Without a click, a search, a limit or a filter lists what matched by the level the
  item needs (recipes of the same level by skill), and a profession you're only looking at by the
  skill it takes, as its recipes ladder up.
- Click a recipe for its details: the item (its slot, type and stats), the specialization it
  needs ("Requires Armorsmith"), "Binds when picked up" when its item does, how many it makes, the skill-up colours, the reagents, how to
  learn it and who can craft it.
- Hover a recipe, a reagent or a recipe item for the game's tooltip; **shift-click** with the chat
  box open to link it in the chat (a recipe in the list: the recipe, to craft it; the item at the top of its details: the
  item); **ctrl-click** to try it on in the dressing room (a recipe: the item it makes).
- **Click the item** at the top of the details to open your profession window at that recipe, when
  this character knows it (its tooltip says so). It takes what the game allows an addon:
  `C_TradeSkillUI.OpenRecipe`, else just the profession's window (`OpenTradeSkill`); with
  neither, the chat says so.
- **Craft**, above the item, for a recipe this character knows: crafts one (the profession window
  opens at it, then `C_TradeSkillUI.CraftRecipe`). Enabled when your bags hold the reagents;
  hovering it says for how many, or what's missing. Not shown where the game doesn't let addons
  craft.
- At the bottom, how many recipes match: hover it for where they come from (the game's data, its
  build, and the sources). The addon's version is in grey on the right.

## Who can craft it

With GuildAssistant Professions installed, the details list every character it knows with that
recipe: you, your other characters (alt), your guildmates (received from their addon), and
characters whose profession link you opened (link). Without it, the window says to install it.

**Click a name** to whisper them: the chat box opens as the game's own "Whisper" does, with the
whole name (WoW Forever's "Shivan Nightpath" too) and, for another realm's, the realm. Hovering a
name says so; your own does nothing.

## Your guild

With GuildAssistant Professions installed, the **Guild** tab (under the window) lists your
guildmates who use it (and your characters in the guild), each profession they have with its skill
and specialization: "Shivan Darkwhisp  190  Blacksmithing - Weaponsmith". The professions are on
the left, with how many guildmates have each (Herbalism, Skinning and the like too); the search
finds guildmates by name, profession or specialization (`weaponsmith` finds Master Swordsmiths
too). Click a guildmate for what they can make in that profession (the search then searches those
recipes), a recipe for its details as in Recipes, and **Back** to return to the guildmates as you
left them. What a guildmate can make is sorted by Skill and Level as Recipes' list is. Each tab
keeps its own search.

**Name**, **Skill** and **Profession**, above the guildmates, sort them as Skill and Level sort the
recipes: click one for its order, click the one it's sorted by to turn it around, and the chevron
beside each says how (gold on the column the list is sorted by, grey on the ones breaking its ties;
names and professions A to Z, skill lowest or highest first). Hovering a title says what it is and
what a click does. Without a click they come by profession, each profession's highest skill first,
and **Reset** puts that order back.

A specialization comes from GuildAssistant Professions 1.5.0, which records it as a spell the
character knows; for what older versions recorded, from the recipes they know that need one. The
level and skill limits, the Filter and Not known yet are Recipes' only.

## Attunements

The **Attunements** tab lists the same guildmates with a **tick** for each raid they are attuned to,
a **dash** where they aren't, and a **question mark** where nobody's addon has looked yet — being
unattuned and not being known are not the same thing. The raids are on the left with how many
guildmates are attuned to each: click one for just those, and the search finds a guildmate by name.
Click a guildmate for their raids one by one, which also show on their page in the Guild tab.

Each raid is its **own icon from the game** (Onyxia's Lair's dragon head): the icon heads the raid's
column, and hovering it says which raid it is. Everywhere a name is read rather than a column — on
the left, on a guildmate's page, in a row's tooltip — the icon comes before the name.

**Name**, above the guildmates, and each **raid's icon**, above its column, sort the list, with the
same chevrons as the other tabs: Name lists them A to Z, clicked again Z to A, and a raid's icon
lists the **attuned first**, clicked again the attuned last. The **question marks stay at the
bottom** either way — nobody having looked says nothing about the raid — and guildmates a raid reads
the same way fall back to their names. Only one of the two sorts the list at a time, so clicking a
raid's icon takes the chevron off Name and the other way around; hovering either says how the list
reads now and what a click would do. **Reset** puts it back the way the tab opens.

Each raid gets a column of its own, up to five, at the **right-hand end of the row**: the name has
every pixel they leave, so even a long one is read whole. With more raids than that, picking one on
the left brings it into view, and a guildmate's page always has them all.

**Your own characters come first** until a title is clicked, their names in bold (the game has no
bold face, so it's the outline its own UI uses), and nothing is written after a name to say it's
yours. That is the order the tab opens in: your characters, this one at their head, then the guild
by name.

It comes from GuildAssistant Professions 1.6.0, which asks the game whether each raid's attunement
quest is complete (Onyxia's Lair so far) and shares it with the guild. A guildmate on an older
version shows a question mark. A raid that a newer GuildAssistant Professions knows and this addon
doesn't is still listed, under its key and without an icon. One more raid is one line in `Core.lua`
(`Core.ATTUNEMENTS`: the key, the name, the short name and the icon's file id).

## Performance

The data (a few thousand recipes) is kept as text and a profession is only read the first time
it's needed, one profession per frame while the window shows "Reading recipes…", so neither
logging in nor opening the window stalls the game. Only the visible rows of the list exist.

## How to learn it

The game's own data says whether a recipe is learned with the profession or automatically at a
skill, and which plans, pattern or formula teach it (with the skill they need). Where those drop,
who sells them, and which trainer teaches what for how much is known by the game's servers, not its
data files. It comes from **sources**: hover **How to learn it** to see them (hovering the recipe count
at the bottom left lists them too):

- **What is known as of November 2026** (`Seed.lua`): trainers and costs, drops, vendors, quests,
  items' stat values, and which recipes can be learned at all. Compiled once, not updated.
- **What GuildAssistant Professions saw** (1.2.0 and later): it records, as you play, the recipes
  vendors sell, what profession trainers teach and for how much, plans looted from creatures,
  objects or fishing, and plans quests give, and shares them with your guild (1.3.0). And every
  recipe a character it knows has learned can be learned. What it records shows after a `/reload`.
- **What players found** (`Found.lua`): every player's findings, gathered by Guild Assistant from
  their uploads and included with each release.
- Any other addon that adds itself to `GuildAssistantDatabaseSources` (the format is in `Core.lua`,
  "Sources companions").

Recipes no source vouches for (unreleased, removed, or not found yet) are hidden unless you tick
**Show unknown recipes** in the Filter. One a guildmate has learned shows, and so does one whose
plans someone found (a source says where they drop or who sells them). When nothing
says how, the window says what it can ("From the item below", "A trainer or a quest").

## Specializations

A recipe whose plans or pattern require a specialization says so under its profession, as their
tooltip does ("Requires Armorsmith"), and searching for the specialization lists its recipes:
Armorsmith, Weaponsmith (with Master Axesmith, Master Hammersmith and Master Swordsmith, whose
recipes a search for `weaponsmith` finds too), Dragonscale, Elemental and Tribal Leatherworking,
and Gnomish and Goblin Engineer. It's what the game's data says of the plans and patterns. Recipes
a specialization's trainer teaches (Goblin and Gnomish Engineering's, mostly) aren't in the game's
files: the servers know them. GuildAssistant Professions (1.5.0) records them from the trainer's
window ("Requires Goblin Engineer"), so they're marked once someone opens it: at once for them and
their guild, and for everyone with what players found (`Found.lua`) in a later release.

## Where the data comes from

The game's own data files for WoW Forever (its recipes, reagents, items, their level, slot, type
and which stats they have, and the specialization plans and patterns require), as [wago.tools](https://wago.tools) exports them for each build of the
game. `npm run database` in `addons/` builds this addon's `Data.lua` from them, and a weekly GitHub
Action does it for each new build; see "GuildAssistant Database's data" in
[addons/README.md](../README.md). Stat values aren't in those files (the game works them out from an
item's level): the tooltip shows them. A few items aren't in them either (the servers send them):
those are named as the game names them in play.

Only the minimap button's place (and whether it's hidden) and **Show unknown recipes** are saved,
per account (`GuildAssistantDatabaseDB`).

## Thanks

Thank you to **Makalak Violeteye** (WoW Forever EU / RP) for the idea for this addon.
