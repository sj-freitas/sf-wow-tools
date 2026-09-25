import type { Guild } from './types';

export const canConfigure = (guild: Guild): boolean => guild.isAdmin || guild.isOfficer;

/** "Guild-Assistant + Officer", or "Member" when you hold neither. */
export function accessSummary(guild: Guild, adminRoleName: string): string {
  const labels = [
    ...(guild.isAdmin ? [adminRoleName] : []),
    ...(guild.isOfficer ? ['Officer'] : []),
  ];
  return labels.length > 0 ? labels.join(' + ') : 'Member';
}
