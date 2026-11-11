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
- **Filter**: tick armor types (Cloth, Leather, Mail, Plate) and slots (Head, Chest, One-Hand,
  Ranged…). Any of the armor types ticked, and any of the slots; both when both have some. The
  button says how many are ticked. With a sources companion installed (below), **Recipes with no
  known source** shows the recipes it doesn't vouch for too.
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
  the chat.

## Who can craft it

With GuildAssistant Professions installed, the details list every character it knows with that
recipe: you, your other characters (alt), your guildmates (received from their addon), and
characters whose profession link you opened (link). Without it, the window says to install it.

## Performance

The data (a few thousand recipes) is kept as text and a profession is only read the first time
it's needed, one profession per frame while the window shows "Reading recipes…", so neither
logging in nor opening the window stalls the game. Only the visible rows of the list exist.

## How to learn it

What the game's own data says: a recipe learned with the profession, or automatically at a skill,
and the plans, pattern or formula that teach it (with the skill they need). Where those drop, who
sells them, which trainer teaches what and for how much: the game's servers know that, not its
data files, so the window says what it can ("From the item below", "A trainer or a quest").

### Sources companions

Another addon can add that knowledge: a **sources companion** puts what it knows in
`GuildAssistantDatabaseSources` (the format is in `Core.lua`, "Sources companions"): which recipes
can be learned, how (trainer and cost, drops, vendors, quests), items' stat values, and the names of
items the game's data lacks. With one installed, the details list its sources (and say whose), and
recipes it doesn't vouch for (unreleased, removed, or not recorded yet) are hidden unless ticked in
the Filter. None is published yet; one built from what players see in game could be.

## Where the data comes from

The game's own data files for WoW Forever (its recipes, reagents, items, their level, slot, type
and which stats they have), as [wago.tools](https://wago.tools) exports them for each build of the
game. `npm run database` in `addons/` builds this addon's `Data.lua` from them, and a weekly GitHub
Action does it for each new build; see "GuildAssistant Database's data" in
[addons/README.md](../README.md). Stat values aren't in those files (the game works them out from an
item's level): the tooltip shows them. A few items aren't in them either (the servers send them):
those are named as the game names them in play.

Only the minimap button's place (and whether it's hidden) is saved, per account
(`GuildAssistantDatabaseDB`).

## Thanks

Thank you to **Makalak Violeteye** for the idea for this addon.
