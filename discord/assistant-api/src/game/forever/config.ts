import { defineGame } from '../game-config';

/**
 * Forever. Everything about this version lives in this folder: this file is its config, and more
 * will be added next to it. `defineGame` checks that every class a race lists exists in `classes`.
 */
export default defineGame({
  gameVersion: 'Forever',
  rules: {
    // Characters are written `Name-Lastname`.
    lastNameRequired: true,
  },
  allowedServers: {
    US: ['RP', 'PVP', 'PVE', 'Hardcore'],
    EU: ['RP', 'PVP', 'PVE', 'Hardcore'],
  },
  factions: {
    Alliance: {
      races: {
        Dwarf: { classes: ['Hunter', 'Paladin', 'Priest', 'Rogue', 'Warrior', 'Shaman'] },
        Gnome: { classes: ['Mage', 'Rogue', 'Warlock', 'Warrior', 'Priest'] },
        Human: { classes: ['Paladin', 'Hunter', 'Priest', 'Rogue', 'Warrior'] },
        'Night Elf': { classes: ['Druid', 'Hunter', 'Priest', 'Warrior', 'Rogue'] },
        Skyborne: { classes: ['Druid', 'Hunter', 'Mage', 'Rogue', 'Warrior'] },
      },
    },
    Horde: {
      races: {
        Troll: { classes: ['Hunter', 'Rogue', 'Shaman', 'Warrior', 'Mage', 'Warlock'] },
        Orc: { classes: ['Hunter', 'Rogue', 'Warlock', 'Shaman', 'Warrior'] },
        Tauren: { classes: ['Druid', 'Hunter', 'Priest', 'Shaman'] },
        Undead: { classes: ['Paladin', 'Warrior', 'Mage', 'Priest', 'Rogue', 'Warlock'] },
        Skyborne: { classes: ['Druid', 'Hunter', 'Rogue', 'Shaman', 'Warrior'] },
      },
    },
  },
  classes: {
    Druid: {
      specializations: {
        Balance: {
          roles: ['Ranged DPS'],
          raidBuffs: ['Ranged DPS', 'Healers'],
          groupBuffs: ['Ranged DPS'],
        },
        Feral: {
          roles: ['Melee DPS', 'Tank'],
        },
        Restoration: {
          roles: ['Healer'],
        },
      },
    },
    Hunter: {
      specializations: {
        Survival: {
          roles: ['Ranged DPS'],
        },
        Marksmanship: {
          roles: ['Ranged DPS'],
        },
        BeastMastery: {
          roles: ['Ranged DPS'],
        },
      },
    },
    Mage: {
      specializations: {
        Arcane: {
          roles: ['Ranged DPS'],
        },
        Fire: {
          roles: ['Ranged DPS'],
        },
        Frost: {
          roles: ['Ranged DPS'],
        },
      },
    },
    Paladin: {
      specializations: {
        Protection: {
          roles: ['Tank'],
        },
        Holy: {
          roles: ['Healer'],
        },
        Retribution: {
          roles: ['Melee DPS'],
        },
      },
    },
    Priest: {
      specializations: {
        Shadow: {
          roles: ['Ranged DPS'],
        },
        Holy: {
          roles: ['Healer'],
        },
        Discipline: {
          roles: ['Healer'],
        },
      },
    },
    Rogue: {
      specializations: {
        Assassination: {
          roles: ['Melee DPS'],
        },
        Combat: {
          roles: ['Melee DPS'],
        },
        Subtlety: {
          roles: ['Melee DPS'],
        },
      },
    },
    Shaman: {
      specializations: {
        Elemental: {
          roles: ['Ranged DPS'],
        },
        Enhancement: {
          roles: ['Melee DPS'],
        },
        Restoration: {
          roles: ['Healer'],
        },
      },
    },
    Warlock: {
      specializations: {
        Affliction: {
          roles: ['Ranged DPS'],
        },
        Demonology: {
          roles: ['Ranged DPS'],
        },
        Destruction: {
          roles: ['Ranged DPS'],
        },
      },
    },
    Warrior: {
      specializations: {
        Arms: {
          roles: ['Melee DPS'],
        },
        Fury: {
          roles: ['Melee DPS'],
        },
        Protection: {
          roles: ['Tank'],
        },
      },
    },
  },
});
