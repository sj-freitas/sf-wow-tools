import { defineGame } from '../game-config';

/**
 * Forever. Everything about this version lives in this folder: this file is its config, and more
 * will be added next to it. `defineGame` checks that every class a race lists exists in `classes`.
 */
export default defineGame({
  gameVersion: 'Forever',
  // Characters are written `Name-Lastname`.
  requiresLastName: true,
  // A stand-in: Season of Discovery on Wild Growth (EU), because the Forever armory does not exist
  // yet. When it does, this becomes something like
  // 'https://<armory>/character/{region}/{server}/{name}' and follows the guild.
  armoryLink: 'https://classic-armory.org/character/eu/classic-sod/wild-growth/{name}',
  // The Forever armory doesn't exist yet, so the roster's "Open in armory" says so instead of
  // opening the stand-in above (Botlog GA-4 says what changes when it does).
  armoryPending: true,
  // Recipe and item links (professions): https://www.wowhead.com/forever/spell=20034/…
  wowheadPath: 'forever',
  // Each server's name and the gameplay rules it enforces (several could share one; features
  // gate on the rule set, not the name, e.g. bios need 'RP').
  allowedServers: {
    US: {
      RP: { ruleSet: 'RP' },
      PVP: { ruleSet: 'PVP' },
      'RP-PVP': { ruleSet: 'RP-PVP' },
      PVE: { ruleSet: 'Normal' },
      Hardcore: { ruleSet: 'Hardcore' },
    },
    EU: {
      RP: { ruleSet: 'RP' },
      PVP: { ruleSet: 'PVP' },
      'RP-PVP': { ruleSet: 'RP-PVP' },
      PVE: { ruleSet: 'Normal' },
      Hardcore: { ruleSet: 'Hardcore' },
    },
  },
  factions: {
    Alliance: {
      races: {
        Dwarf: { classes: ['Hunter', 'Paladin', 'Priest', 'Rogue', 'Warrior', 'Shaman'] },
        Gnome: { classes: ['Mage', 'Rogue', 'Warlock', 'Warrior', 'Priest'] },
        Human: { classes: ['Paladin', 'Hunter', 'Priest', 'Rogue', 'Warrior', 'Warlock', 'Mage'] },
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
  // Each class's colour (the usual WoW class colours) is what sign-ups show instead of its name,
  // unless the class has an icon: class-icons/<Class>.png next to this file (see that folder).
  classes: {
    Druid: {
      color: '#FF7C0A',
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
      color: '#AAD372',
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
      color: '#3FC7EB',
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
      color: '#F48CBA',
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
      color: '#FFFFFF',
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
      color: '#FFF468',
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
      color: '#0070DD',
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
      color: '#8788EE',
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
      color: '#C69B6D',
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
