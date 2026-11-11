# GuildAssistant Database

Every profession's recipes, in game: search them by name, stat, slot or reagent, keep them to a
level and skill range, and see what each one makes, what it needs, how to learn it and, with
[GuildAssistant Professions](../GuildAssistantProfessions/README.md), who you know that can craft
it. It also lists your own professions' recipes you don't know yet.

Made for WoW Forever: its data is the game's own, from Forever's data files.

## Using it

Type `/gadb` (or `/ga-db`), or click the clip on the minimap, to open or close the window;
`/gadb mithril` opens it searching for "mithril". Drag the clip to move it around the minimap;
`/gadb minimap` hides it (and brings it back).

- **Search** (top left): words that must all be somewhere in the recipe: its name, the item it
  makes (its slot, type and stats: `plate chest`, `stamina`, `critical strike`, `maces`), its
  reagents (`thorium bar`: what uses them), or the profession. Recipes whose own name matches come
  first. The cross at its end clears it.
- **Level**: the level the item it makes requires (an item that needs none counts as level 1).
  **Skill**: the profession skill it takes to learn. Leave a box empty for no limit.
- **Tab** moves from one box to the next (search, then the level and skill boxes), **Shift-Tab**
  back.
- **Filter**: tick armor types (Cloth, Leather, Mail, Plate) and slots (Head, Chest, One-Hand,
  Ranged…). Any of the armor types ticked, and any of the slots; both when both have some. The
  button says how many are ticked. Under a line, **Show unknown recipes** also lists the recipes
  no source knows (unreleased, removed, or not found yet): unticked at first, and once ticked it
  stays ticked (saved for the account; Clear and Reset leave it).
- While searching (words, limits or a filter), each profession on the left says in gold how many
  of its recipes match, and nothing when none do; without a search, how many it has.
- **Not known yet**: only your professions' recipes this character doesn't know yet. The skill
  shows green when you can learn it now, red when not yet. What you know comes from
  GuildAssistant Professions (open each profession's window once so it records it); without it,
  from what the game says, which can miss some.
- **Reset** clears it all, the Filter too.
- On the left, a profession shows only its recipes (with Not known yet, only yours are listed,
  with your skill).
- Click a recipe for its details: the item (its slot, type and stats), how many it makes, the
  skill-up colours, the reagents, how to learn it and who can craft it.
- Hover a recipe, a reagent or a recipe item for the game's tooltip; **shift-click** to link it in
  the chat (a recipe in the list: the recipe, to craft it; the item at the top of its details: the
  item); **ctrl-click** to try it on in the dressing room (a recipe: the item it makes).

## Who can craft it

With GuildAssistant Professions installed, the details list every character it knows with that
recipe: you, your other characters (alt), your guildmates (received from their addon), and
characters whose profession link you opened (link). Without it, the window says to install it.

## Performance

The data (a few thousand recipes) is kept as text and a profession is only read the first time
it's needed, one profession per frame while the window shows "Reading recipes…", so neither
logging in nor opening the window stalls the game. Only the visible rows of the list exist.

## How to learn it

The game's own data says whether a recipe is learned with the profession or automatically at a
skill, and which plans, pattern or formula teach it (with the skill they need). Where those drop,
who sells them, and which trainer teaches what for how much is known by the game's servers, not its
data files. It comes from **sources**: hover **How to learn it** to see them (the window's last line
names them too):

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

## Where the data comes from

The game's own data files for WoW Forever (its recipes, reagents, items, their level, slot, type
and which stats they have), as [wago.tools](https://wago.tools) exports them for each build of the
game. `npm run database` in `addons/` builds this addon's `Data.lua` from them, and a weekly GitHub
Action does it for each new build; see "GuildAssistant Database's data" in
[addons/README.md](../README.md). Stat values aren't in those files (the game works them out from an
item's level): the tooltip shows them. A few items aren't in them either (the servers send them):
those are named as the game names them in play.

Only the minimap button's place (and whether it's hidden) and **Show unknown recipes** are saved,
per account (`GuildAssistantDatabaseDB`).

## Thanks

Thank you to **Makalak Violeteye** for the idea for this addon.
