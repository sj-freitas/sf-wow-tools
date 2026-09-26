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
      },
    },
    Hunter: { specializations: {} },
    Mage: { specializations: {} },
    Paladin: { specializations: {} },
    Priest: { specializations: {} },
    Rogue: { specializations: {} },
    Shaman: { specializations: {} },
    Warlock: { specializations: {} },
    Warrior: { specializations: {} },
  },
});
