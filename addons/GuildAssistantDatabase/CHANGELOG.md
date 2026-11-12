# GuildAssistant Database

## 1.5.2

- Shift-click to search works on WoW Forever: 1.5.1 listened where older clients put a shift-click,
  not where this one does. Shift-clicking a stack in your bags no longer opens the split box while
  the window takes it.
- Shift-click links in the chat the same way the game does on this client.

## 1.5.1

- **Shift-click an item** anywhere while the window is open (your bags, a link in the chat, a
  reagent in the details) with the chat box closed: it's searched for. With the chat box open, it's
  linked in the chat as before.
- The search also finds a recipe by its plans or pattern (`plans: runed copper breastplate`).

## 1.5.0

- **Only guild**, in the Filter while you're in a guild: only the recipes someone in your guild can
  craft (your characters there, and guildmates who use GuildAssistant Professions). It works with
  the rest: a search, Not known yet (what you don't know but a guildmate does), armor and slots.

## 1.4.10

- **`/gadb *`** opens the window with the search cleared (`/gadb` keeps your last search, as before).

## 1.4.9

- **Craft**: a button above the item of a recipe this character knows crafts one, as the profession
  window's Create button does. It's enabled when your bags hold the reagents; hovering it says for
  how many, or which reagents are missing.

## 1.4.8

- **Click the item** at the top of a recipe's details to open your profession window at that
  recipe, when this character knows it (hovering it says so). Where the game only lets an addon
  open the profession, it opens that; where it allows neither, the chat says so.

## 1.4.7

- The window's bottom line is shorter: where the recipes come from (the game's data, its build and
  the sources) is now a tooltip on the recipe count, and the addon's version shows in grey on the
  right.

## 1.4.6

- **Found by players**, the first ones: what players' GuildAssistant Professions saw, gathered by
  Guild Assistant from their uploads. Trainers' names and costs for 48 recipes (Alphonse Dumas,
  Nissa Firestone, Tally Berryfizz, Vosur Brakthel) and where 14 recipe items come from (vendors in
  Ironforge, Hillsbrad Foothills, Loch Modan, Tanaris and Riverglades, and Mangeclaw's drop in
  Dun Morogh).

## 1.4.5

- **Click a name** under Who can craft it to whisper them: the chat box opens as the game's own
  Whisper does, with the whole name ("Shivan Nightpath" too).

## 1.4.4

- **Shift-click** a recipe in the list to link the recipe in the chat (to craft it), as the game's
  profession window does; shift-click the item at the top of its details to link the item.
  Reagents and plans link themselves, as before.

## 1.4.3

- **Ctrl-click** a recipe, a reagent or plans to try the item on in the dressing room (a recipe:
  the item it makes), as in the game's own windows. What can't be worn does nothing.

## 1.4.2

- **Tab** moves from the search box to the level and skill boxes and round again; **Shift-Tab**
  goes back. The box's text is selected, so typing replaces it.

## 1.4.1

- A recipe's details no longer end with a grey "Sources: …" line: hover **How to learn it** to see
  where it comes from.

## 1.4.0

- **Show unknown recipes** has its own section in the Filter: recipes no one knows how to get
  (unreleased, removed, or not found yet). Unticked at first; once ticked it stays ticked, also
  after Clear, Reset or logging out.
- A recipe whose plans (pattern, formula…) someone found is known now, even if it wasn't before:
  it shows without ticking anything, and no longer says "No known source".

## 1.3.0

- What players found of how recipes are obtained, gathered by Guild Assistant from their
  GuildAssistant Professions, is included with each release ("found by players" under a recipe's
  sources). What your guild finds shows after a /reload, through GuildAssistant Professions 1.3.0.

## 1.2.0

- How to learn a recipe is back: trainers and their costs, where plans and patterns drop, who sells
  them, which quests give them, from what is known as of November 2026. Items show their stat values
  again, and recipes no one knows how to get (unreleased, removed) are hidden unless you tick
  **Recipes with no known source** in the Filter.
- What is found from now on comes from GuildAssistant Professions 1.2.0, which records it as you
  play: the recipes vendors sell, what trainers teach and for how much, plans you loot or fish, and
  plans quests give. It shows here after a /reload.
- A recipe someone you know has learned (through GuildAssistant Professions) is shown even if it
  wasn't known before.

## 1.1.0

- The recipes now come from the game's own data files for WoW Forever, and are
  updated with each new build of the game. Every recipe the game has is listed, with its reagents,
  skill and skill-up colours, the item it makes (slot, type and stats) and the plans, pattern or
  formula that teach it.
- How to learn a recipe says what the game knows: learned with the profession, automatically at a
  skill, or from the item listed below it. Where plans drop, who sells them and trainer costs aren't
  in the game's files, so they're no longer shown; an addon that knows them can add them (a
  "sources companion").
- With a sources companion installed, recipes it doesn't know are hidden unless you tick **Recipes
  with no known source** in the Filter.
- Items the game's data lacks are named as the game names them in play.

## 1.0.0

- The first full release: no longer experimental. Everything from 0.1.0 to 0.3.1: every
  profession's recipes (WoW Forever), searchable by name, stat, slot or reagent, with
  level and skill limits and a Filter for armor types and slots; how many match in each
  profession; each recipe's item, reagents, how to learn it and who can craft it (with
  GuildAssistant Professions); your recipes not known yet; and the minimap button.

## 0.3.1

- Thanks to Makalak Violeteye, whose idea this addon was, in its description.

## 0.3.0

- A minimap button, GuildAssistant's clip: click it to open or close the window, drag it around
  the minimap. `/gadb minimap` hides it (or brings it back). Where it sits is remembered.
- The clip is the addon's icon in the game's addon list too.

## 0.2.0

- While you search, each profession on the left says how many of its recipes match (in gold), so
  you see where to look; with no search, it shows how many it has.
- A profession picked with no matches says how many the others have.
- A cross in the search box clears it.
- Filter (next to Skill): tick armor types (Cloth, Leather, Mail, Plate) and slots (Head, Chest,
  One-Hand, Ranged…).

## 0.1.0

- First, experimental version: every profession's recipes (WoW Forever), searchable
  by name, stat, slot or reagent, within a level and skill range (`/gadb`).
- A recipe's details: the item it makes, its reagents, how to learn it (trainer, drop, vendor,
  quest) and, with GuildAssistant Professions, who you know that can craft it.
- Not known yet: your professions' recipes you don't know yet, and whether you can learn them now.
