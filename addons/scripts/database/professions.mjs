// The professions GuildAssistant Database knows: their name, as the game says it, and the game's
// skill line id (what the game's data files each recipe under). The secondary ones too (Cooking,
// First Aid); Herbalism, Skinning and Fishing make nothing.

export const PROFESSIONS = [
  { name: 'Alchemy', skill: 171 },
  { name: 'Blacksmithing', skill: 164 },
  { name: 'Enchanting', skill: 333 },
  { name: 'Engineering', skill: 202 },
  { name: 'Leatherworking', skill: 165 },
  { name: 'Tailoring', skill: 197 },
  { name: 'Mining', skill: 186 },
  { name: 'Cooking', skill: 185 },
  { name: 'First Aid', skill: 129 },
];

/** The game version the data is for (its wago.tools product is in gamedata.mjs, PRODUCTS). */
export const DEFAULT_VERSION = 'forever';
