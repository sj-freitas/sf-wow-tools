export const FOREVER_CONFIG = {
    gameVersion: 'Forever' as const,
    factions: {
        ["Alliance"]: {
            races: [
                'Dwarf',
                'Gnome',
                'Human',
                'Night Elf',
            ] as const,
        },
        ["Horde"]: {
            races: [
                'Troll',
                'Orc',
                'Tauren',
                'Undead',
            ] as const,
        }, 
    };