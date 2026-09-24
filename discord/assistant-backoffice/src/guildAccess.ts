import type { Guild } from './types';

export const canConfigure = (guild: Guild): boolean => guild.isAdmin || guild.isOfficer;
