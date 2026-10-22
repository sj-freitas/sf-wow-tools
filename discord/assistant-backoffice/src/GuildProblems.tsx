import { useState } from 'react';
import { Link } from 'react-router-dom';
import { resolveProblem, type GuildProblem } from './api';
import { guildPath } from './guildPath';
import { ChevronIcon } from './Icons';
import type { Guild } from './types';
import { useChannels } from './useChannels';
import { problemsChanged, useGuildProblems } from './useGuildProblems';

/** Where to fix each kind of task: its page. */
const PROBLEM_PAGE: Record<GuildProblem['source'], (id: string) => string> = {
  POST: (id) => `posts/edit/${id}`,
  PLUGIN: (id) => `plugins/edit/${id}`,
  EVENT: (id) => `signup/${id}`,
  HONEYPOT: () => 'honeypots',
};

/**
 * What the bot can't do for the guild right now, at the top of Officer requests: folded away under
 * a count, one line each with how to fix it, and Solved. Nothing is shown when there are none; each
 * also clears itself once its task succeeds again.
 */
export function GuildProblems({ guild }: { guild: Guild }) {
  const problems = useGuildProblems(guild);
  const { channels } = useChannels(guild.id);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  if (problems.length === 0) return null;
  // The bot writes channels as Discord mentions (<#id>): here, their names.
  const named = (text: string) =>
    text.replace(/<#(\d+)>/g, (_, id: string) => {
      const name = channels.flatMap((g) => g.channels).find((c) => c.id === id)?.name;
      return name ? `#${name}` : 'its channel';
    });
  const solve = (problem: GuildProblem) => {
    setBusy(problem.id);
    resolveProblem(guild.id, problem.id)
      .catch(() => undefined) // already gone: the refresh shows it
      .finally(() => {
        setBusy(null);
        problemsChanged();
      });
  };
  return (
    <section className="guild-problems">
      <button
        type="button"
        className="guild-problems-head"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="select-chevron guild-problems-chevron" aria-hidden="true">
          <ChevronIcon />
        </span>
        {problems.length} bot problem{problems.length === 1 ? '' : 's'}
      </button>
      {open && (
        <ul>
          {problems.map((problem) => (
            <li key={problem.id}>
              <span>
                <Link to={guildPath(guild, PROBLEM_PAGE[problem.source](problem.sourceId))}>
                  {problem.label}
                </Link>
                : {named(problem.detail)}
              </span>
              <button
                type="button"
                className="btn btn-sm"
                disabled={busy === problem.id}
                title="Hide it. If the task fails again, it comes back."
                onClick={() => solve(problem)}
              >
                Solved
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
