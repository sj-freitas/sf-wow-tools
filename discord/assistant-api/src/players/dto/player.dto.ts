export type Role = 'HEALER' | 'TANK' | 'MELEE_DPS' | 'RANGED_DPS';

export class CharacterDto {
  id!: string;
  class!: string;
  /** Empty when unknown (a character added before this was collected, or from Discord). */
  race!: string;
  roles!: Role[];
  firstName!: string;
  lastName!: string;
  isMain!: boolean;
  level!: number;
}

export class PlayerDto {
  id!: string;
  discordUserId!: string;
  discordUsername!: string | null;
  discordDisplayName!: string | null;
  characters!: CharacterDto[];
}
