export type Faction = 'ALLIANCE' | 'HORDE';

export class PlayerDto {
  id!: string;
  name!: string;
  realm!: string;
  class!: string;
  level!: number;
  faction!: Faction;
  guildId!: string | null;
}
