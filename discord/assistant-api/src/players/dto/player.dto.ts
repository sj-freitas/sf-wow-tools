export type Role = 'HEALER' | 'TANK' | 'MELEE_DPS' | 'RANGED_DPS';

export class CharacterDto {
  id!: string;
  class!: string;
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
  guildId!: string;
  characters!: CharacterDto[];
}
