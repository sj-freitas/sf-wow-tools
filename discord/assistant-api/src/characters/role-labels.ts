import type { Role } from '@prisma/client';
import type { GameRole } from '../game/game-config';

/** How a character role is written for people (the roster shows the same names). */
export const ROLE_LABELS: Record<Role, GameRole> = {
  TANK: 'Tank',
  HEALER: 'Healer',
  MELEE_DPS: 'Melee DPS',
  RANGED_DPS: 'Ranged DPS',
};
