// The professions GuildAssistant Database knows, and where Wowhead lists them. `skill` is the
// game's skill line id: Wowhead's data says it for each recipe, so a page that isn't the
// profession's (Wowhead shows a default list for a profession the game version doesn't have, e.g.
// Jewelcrafting on Forever) is told apart. `recipes` is Wowhead's list of the profession's recipe
// items (plans, patterns, formulas…): where each is dropped, sold or rewarded. Mining has none.

export const PROFESSIONS = [
  { name: 'Alchemy', skill: 171, spells: 'spells/professions/alchemy', recipes: 'items/recipes/alchemy' },
  { name: 'Blacksmithing', skill: 164, spells: 'spells/professions/blacksmithing', recipes: 'items/recipes/blacksmithing' },
  { name: 'Enchanting', skill: 333, spells: 'spells/professions/enchanting', recipes: 'items/recipes/enchanting' },
  { name: 'Engineering', skill: 202, spells: 'spells/professions/engineering', recipes: 'items/recipes/engineering' },
  { name: 'Leatherworking', skill: 165, spells: 'spells/professions/leatherworking', recipes: 'items/recipes/leatherworking' },
  { name: 'Tailoring', skill: 197, spells: 'spells/professions/tailoring', recipes: 'items/recipes/tailoring' },
  { name: 'Mining', skill: 186, spells: 'spells/professions/mining' },
  { name: 'Cooking', skill: 185, spells: 'spells/secondary-skills/cooking', recipes: 'items/recipes/cooking' },
  { name: 'First Aid', skill: 129, spells: 'spells/secondary-skills/first-aid', recipes: 'items/recipes/first-aid' },
];

/** Wowhead's path for the game version the data is for (https://www.wowhead.com/forever/…). */
export const DEFAULT_VERSION = 'forever';
