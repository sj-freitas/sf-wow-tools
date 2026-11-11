# GuildAssistant Database (experimental)

Every profession's recipes, in game: search them by name, stat, slot or reagent, keep them to a
level and skill range, and see what each one makes, what it needs, how to learn it and, with
[GuildAssistant Professions](../GuildAssistantProfessions/README.md), who you know that can craft
it. It also lists your own professions' recipes you don't know yet.

Made for WoW Forever: its data is Wowhead's for Forever. Experimental: not on CurseForge yet.

## Using it

Type `/gadb` (or `/ga-db`), or click the clip on the minimap, to open or close the window;
`/gadb mithril` opens it searching for "mithril". Drag the clip to move it around the minimap;
`/gadb minimap` hides it (and brings it back).

- **Search** (top left): words that must all be somewhere in the recipe: its name, the item it
  makes (its slot, type and stats: `plate chest`, `stamina`, `fire resistance`, `maces`), its
  reagents (`thorium bar`: what uses them), or the profession. Recipes whose own name matches come
  first. The cross at its end clears it.
- **Level**: the level the item it makes requires (an item that needs none counts as level 1).
  **Skill**: the profession skill it takes to learn. Leave a box empty for no limit.
- **Filter**: tick armor types (Cloth, Leather, Mail, Plate) and slots (Head, Chest, One-Hand,
  Ranged…). Any of the armor types ticked, and any of the slots; both when both have some. The
  button says how many are ticked.
- While searching (words, limits or a filter), each profession on the left says in gold how many
  of its recipes match, and nothing when none do; without a search, how many it has.
- **Not known yet**: only your professions' recipes this character doesn't know yet. The skill
  shows green when you can learn it now, red when not yet. What you know comes from
  GuildAssistant Professions (open each profession's window once so it records it); without it,
  from what the game says, which can miss some.
- **Reset** clears it all, the Filter too.
- On the left, a profession shows only its recipes (with Not known yet, only yours are listed,
  with your skill).
- Click a recipe for its details: the item (its type, slot and stats), how many it makes, the
  skill-up colours, the reagents, how to learn it (trainer and cost, the plans or pattern and where
  they drop, who sells them, the quest) and who can craft it.
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

## Where the data comes from

Wowhead (https://www.wowhead.com/forever): its profession pages (each recipe's reagents, skill and
sources, and the items' level, slot and stats) and its recipe item pages (where each plan or
pattern drops, who sells it, which quest gives it). `npm run database` in `addons/` builds this
addon's `Data.lua` from them; see "GuildAssistant Database's data" in
[addons/README.md](../README.md). Zone names and item types come from the game itself.

Only the minimap button's place (and whether it's hidden) is saved, per account
(`GuildAssistantDatabaseDB`).
