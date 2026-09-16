export type Faction = 'ALLIANCE' | 'HORDE';

export interface Player {
  id: string;
  name: string;
  realm: string;
  class: string;
  level: number;
  faction: Faction;
  guildId: string | null;
}
