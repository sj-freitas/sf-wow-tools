export const FOREVER_CONFIG = {
  gameVersion: 'Forever' as const,
  factions: {
    ['Alliance']: {
      races: {
        ['Dwarf']: {
          classes: ['Hunter', 'Paladin', 'Priest', 'Rogue', 'Warrior', 'Shaman'] as const,
        },
        ['Gnome']: {
          classes: ['Mage', 'Rogue', 'Warlock'] as const,
        },
        ['Human']: {
          classes: ['Paladin', 'Priest', 'Rogue', 'Warrior'] as const,
        },
        ['Night Elf']: {
          classes: ['Druid', 'Hunter', 'Priest'] as const,
        },
        ['Skyborn']: {
          classes: ['Druid', 'Mage', 'Paladin', 'Priest', 'Rogue', 'Warrior'] as const,
        },
      },
      ['Horde']: {
        races: {
          ['Troll']: {
            classes: ['Hunter', 'Rogue', 'Shaman', 'Warrior', 'Mage', 'Warlock'] as const,
          },
          ['Orc']: {
            classes: ['Hunter', 'Rogue', 'Warlock', 'Shaman', 'Warrior'] as const,
          },
          ['Tauren']: {
            classes: ['Druid', 'Hunter', 'Priest', 'Shaman'] as const,
          },
          ['Undead']: {
            classes: ['Paladin', 'Warrior', 'Mage', 'Priest', 'Rogue', 'Warlock'] as const,
          },
          ['Skyborn']: {
            classes: ['Druid', 'Priest', 'Rogue', 'Shaman', 'Warrior'] as const,
          },
        },
      },
    },
    classes: {
      ['Druid']: {
        specializations: {
          ['Balance']: {
            roles: ['Ranged DPS'],
            raidBuffs: ['Ranged DPS', 'Healers'],
            groupBuffs: ['Ranged DPS'],
          },
        },
      },
    },
  },
};
