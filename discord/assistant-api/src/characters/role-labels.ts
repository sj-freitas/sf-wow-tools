import type { Role } from '@prisma/client';

/** How a character role is written for people (the roster shows the same names). */
export const ROLE_LABELS: Record<Role, string> = {
  TANK: 'Tank',
  HEALER: 'Healer',
  MELEE_DPS: 'Melee DPS',
  RANGED_DPS: 'Ranged DPS',
};
