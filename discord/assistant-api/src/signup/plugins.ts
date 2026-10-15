import type { SignupAssignmentScope } from '@prisma/client';
import type { AssignmentLine } from './assignment-lines';
import type { EntryView } from './signup-messages';

/**
 * Plugins — NOT IMPLEMENTED YET; this is the shape they are meant to take, so the rest of the
 * feature (and the database) already leaves room for them.
 *
 * A plugin creates assignments automatically from an event's sign-ups: a guild-wide one (say a
 * "Forever roster" plugin that builds the setup and the usual assignments) or an instance's (a
 * "Naxxramas" plugin knowing its bosses, posting their tactics' images, ...). Instances and bosses
 * are defined by plugins, which is why `SignupAssignment.scopeLabel` is free text until then.
 *
 * How it is meant to run:
 *   - an event picks a plugin (`SignupEvent.pluginKey`);
 *   - while `SignupEvent.pluginAutoRun` is on, the worker runs it every minute during the hour
 *     before the event starts; it replaces the assignments it made before (`pluginKey` set on
 *     them) and the posted messages are edited like any other assignment edit;
 *   - editing one of its assignments by hand sets `editedManually` and turns `pluginAutoRun` off,
 *     so the edit isn't overwritten. The backoffice shows that, and turning it back on accepts
 *     that the next run overwrites the edits.
 */
export interface SignupPlugin {
  /** Stored in `SignupEvent.pluginKey`; never change it once used. */
  key: string;
  name: string;
  /** Instances it is about, if it is instance-specific (e.g. ['Naxxramas']). */
  instances?: readonly string[];
  /** May also place people in groups (the raid setup). */
  run(context: PluginContext): Promise<PluginResult> | PluginResult;
}

export interface PluginContext {
  gameVersion: string;
  event: { id: string; title: string; startsAt: Date };
  /** Everyone who answered, with the character and role they signed up with. */
  entries: readonly EntryView[];
}

export interface PluginResult {
  assignments: {
    scope: SignupAssignmentScope;
    scopeLabel: string;
    title: string;
    lines: AssignmentLine[];
    mentions: boolean;
  }[];
  /** entry id -> group 1-8 and place 0-4; left out = leave the setup alone. */
  placements?: { entryId: string; group: number | null; slot: number | null }[];
}

/** The plugins guilds can pick from. None yet. */
export const SIGNUP_PLUGINS: readonly SignupPlugin[] = [];
