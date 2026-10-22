import type { Entry } from './signupApi';
import { entryName } from './labels';

/**
 * The raid setup as the GuildAssistant RaidSort addon reads it (addons/Raidsort, see its README): a Lua table
 * of the groups, each a list of character names, plus the raid roles:
 *
 *   -- Molten Core, Tue 20 Oct 2026, 20:00 (Guild Assistant)
 *   {
 *     event = "Molten Core",
 *     startsAt = 1792519200,  -- the event's start (Unix time)
 *     invitesAt = 1792518300, -- when invites start (only when the event has an invite time)
 *     { "Dark Shivan", "Wwolf Test" }, -- Group 1
 *     { "Some Name" },                 -- Group 2
 *     leader = "Dark Shivan",
 *     masterLooter = "Some Name",
 *     assists = { "Wwolf Test" },
 *   }
 *
 * The times are Unix seconds, the same moment in any timezone: GuildAssistant RaidSort's Auto-Invite invites
 * from `invitesAt` until `startsAt`. Only people in a group are in it (not the bench). The addon
 * also takes `mainTanks`,
 * `mainAssists` and per-player marks, which the setup doesn't have.
 */
export interface AddonExport {
  text: string;
  /** Things the export left out, to tell the organiser. */
  notes: string[];
}

export interface AddonExportInput {
  title: string;
  /** "Tue 20 Oct 2026, 20:00", for the comment at the top. */
  when: string;
  /** The event's start, and when invites start (null for none), as ISO times. */
  startsAt: string;
  invitesAt: string | null;
  entries: readonly Entry[];
  /** entry id -> its place (group from 1, slot from 0). */
  places: Readonly<Record<string, { group: number; slot: number }>>;
  groupCount: number;
  leaderDiscordUserId: string;
  masterLooterDiscordUserId: string | null;
  assistEntryIds: readonly string[];
}

/** A Lua string literal. */
export const luaString = (text: string): string =>
  `"${text.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n')}"`;

export function toAddonSetup(input: AddonExportInput): AddonExport {
  const notes: string[] = [];
  const placed = input.entries.filter((entry) => input.places[entry.id]);
  const groups = Array.from({ length: input.groupCount }, (_, i) =>
    placed
      .filter((entry) => input.places[entry.id].group === i + 1)
      .sort((a, b) => input.places[a.id].slot - input.places[b.id].slot),
  );
  const last = groups.reduce((end, group, i) => (group.length > 0 ? i + 1 : end), 0);

  const lines = [`-- ${input.title}, ${input.when} (Guild Assistant)`, '{'];
  lines.push(`  event = ${luaString(input.title)},`);
  const unix = (iso: string) => Math.floor(new Date(iso).getTime() / 1000);
  lines.push(`  startsAt = ${unix(input.startsAt)}, -- the event's start (Unix time)`);
  if (input.invitesAt) {
    lines.push(`  invitesAt = ${unix(input.invitesAt)}, -- when invites start`);
  }
  const rows = groups
    .slice(0, last)
    .map((group) =>
      group.length === 0
        ? '{},'
        : `{ ${group.map((entry) => luaString(entryName(entry))).join(', ')} },`,
    );
  // Line the group comments up.
  const width = Math.max(0, ...rows.map((row) => row.length));
  rows.forEach((row, i) => lines.push(`  ${row.padEnd(width)} -- Group ${i + 1}`));

  // Roles go to people in a group: the addon only knows them.
  const inGroup = (discordUserId: string) =>
    placed.find((entry) => entry.discordUserId === discordUserId);
  const someone = (discordUserId: string) =>
    input.entries.find((entry) => entry.discordUserId === discordUserId);

  const leader = inGroup(input.leaderDiscordUserId);
  if (leader) lines.push(`  leader = ${luaString(entryName(leader))},`);
  else {
    const who = someone(input.leaderDiscordUserId);
    notes.push(
      who
        ? `The leader (${entryName(who)}) isn't in a group, so no leader is set.`
        : 'The leader isn’t signed up, so no leader is set.',
    );
  }

  if (input.masterLooterDiscordUserId) {
    const looter = inGroup(input.masterLooterDiscordUserId);
    if (looter) lines.push(`  masterLooter = ${luaString(entryName(looter))},`);
    else notes.push('The master looter isn’t in a group, so no master looter is set.');
  }

  const assists = placed.filter((entry) => input.assistEntryIds.includes(entry.id));
  if (assists.length > 0) {
    lines.push(
      `  assists = { ${assists.map((entry) => luaString(entryName(entry))).join(', ')} },`,
    );
  }
  const benchedAssists = input.assistEntryIds.length - assists.length;
  if (benchedAssists > 0) {
    notes.push(
      `${benchedAssists} ${benchedAssists === 1 ? 'person' : 'people'} with assist ${benchedAssists === 1 ? 'isn’t' : 'aren’t'} in a group, so ${benchedAssists === 1 ? 'isn’t' : 'aren’t'} in it.`,
    );
  }
  lines.push('}');

  const bench = input.entries.length - placed.length;
  if (placed.length === 0) notes.unshift('Nobody is in a group yet: put people in groups first.');
  else if (bench > 0) notes.push(`The bench (${bench}) isn’t in it: only people in groups are.`);
  return { text: lines.join('\n'), notes };
}
