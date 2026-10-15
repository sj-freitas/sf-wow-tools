import type { SignupEventKind } from '@prisma/client';

/**
 * The kinds of event, and what each has. This is the config: changing a group size or count here
 * is all it takes (the backoffice gets it with each event).
 *
 *   CHARACTERS  people sign up with one of their characters and a role; the setup is groups
 *               (a raid composition) and there are assignments. The default.
 *   MEMBERS     people sign up as themselves (their Discord account, shown by server nickname);
 *               the setup is one list of who is invited, with everyone else on the bench, and it
 *               is posted the same way (optionally mentioning the invited). No assignments.
 */
export interface EventKindConfig {
  /** As people see it: in `/create-event type:` and on the website. */
  label: string;
  /** People sign up with a character and a role (else as themselves). */
  usesCharacters: boolean;
  hasAssignments: boolean;
  /** How many groups the setup has, and how many places each; null = no limit. */
  groupCount: number;
  groupSize: number | null;
  /** "Group" (Group 1, Group 2, …); with a single group, its name alone ("Invited"). */
  groupName: string;
  /** The setup tab and post: "Raid setup", "Invited". */
  setupTitle: string;
}

export const EVENT_KINDS: Record<SignupEventKind, EventKindConfig> = {
  CHARACTERS: {
    label: 'Characters',
    usesCharacters: true,
    hasAssignments: true,
    groupCount: 8,
    groupSize: 5,
    groupName: 'Group',
    setupTitle: 'Raid setup',
  },
  MEMBERS: {
    label: 'Members',
    usesCharacters: false,
    hasAssignments: false,
    groupCount: 1,
    groupSize: null,
    groupName: 'Invited',
    setupTitle: 'Invited',
  },
};

export const EVENT_KIND_IDS = Object.keys(EVENT_KINDS) as SignupEventKind[];

export const isEventKind = (value: unknown): value is SignupEventKind =>
  typeof value === 'string' && Object.hasOwn(EVENT_KINDS, value);

/** "Group 3", or the single group's name ("Invited"). */
export const groupLabel = (kind: EventKindConfig, group: number): string =>
  kind.groupCount === 1 ? kind.groupName : `${kind.groupName} ${group}`;
