/** Must match the `class` choices in src/bot/commands.json. */
export const WOW_CLASSES = [
  'Druid',
  'Hunter',
  'Mage',
  'Paladin',
  'Priest',
  'Rogue',
  'Shaman',
  'Warlock',
  'Warrior',
] as const;

export type WowClass = (typeof WOW_CLASSES)[number];

export const isWowClass = (value: string): value is WowClass =>
  (WOW_CLASSES as readonly string[]).includes(value);
