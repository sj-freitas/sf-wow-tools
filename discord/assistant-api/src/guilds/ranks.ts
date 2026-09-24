export type Rank = 'Officer' | 'Raider' | 'Social';

export interface RankRoleIds {
  officer: string | null;
  raider: string | null;
  social: string | null;
}

/**
 * The ranks a member holds: which of the guild's mapped Discord roles they have
 * in the main server. Always in the order Officer, Raider, Social.
 */
export function ranksFor(memberRoleIds: readonly string[], roleIds: RankRoleIds): Rank[] {
  const held = new Set(memberRoleIds);
  const ranks: Rank[] = [];
  if (roleIds.officer && held.has(roleIds.officer)) ranks.push('Officer');
  if (roleIds.raider && held.has(roleIds.raider)) ranks.push('Raider');
  if (roleIds.social && held.has(roleIds.social)) ranks.push('Social');
  return ranks;
}
