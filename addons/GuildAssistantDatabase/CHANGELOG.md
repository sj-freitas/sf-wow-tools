# GuildAssistant Database

## 1.1.0

- The recipes now come from the game's own data files for WoW Forever, not from Wowhead, and are
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
  profession's recipes from Wowhead (WoW Forever), searchable by name, stat, slot or reagent, with
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

- First, experimental version: every profession's recipes from Wowhead (WoW Forever), searchable
  by name, stat, slot or reagent, within a level and skill range (`/gadb`).
- A recipe's details: the item it makes, its reagents, how to learn it (trainer, drop, vendor,
  quest) and, with GuildAssistant Professions, who you know that can craft it.
- Not known yet: your professions' recipes you don't know yet, and whether you can learn them now.
