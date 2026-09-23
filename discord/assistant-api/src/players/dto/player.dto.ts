export type Faction = 'ALLIANCE' | 'HORDE';
export type Role = 'HEALER' | 'TANK' | 'MELEE_DPS' | 'RANGED_DPS';

export class CharacterDto {
  id!: string;
  class!: string;
  roles!: Role[];
  firstName!: string;
  lastName!: string;
  isMain!: boolean;
  level!: number;
  faction!: Faction;
  realm!: string;
}

export class PlayerDto {
  id!: string;
  discordUserId!: string;
  guildId!: string;
  characters!: CharacterDto[];
}
