import { Link } from 'react-router-dom';
import { accessSummary } from './guildAccess';
import { guildPath } from './guildPath';
import { SetupInstructions } from './SetupInstructions';
import type { Guild, SetupInfo } from './types';

/** Where you land after logging in: pick the guild to manage, or add one. */
export function LandingPage({ guilds, setup }: { guilds: Guild[]; setup: SetupInfo }) {
  return (
    <div className="landing">
      <div className="tasks-head">
        <div>
          <h2>Your guilds</h2>
          <span className="muted">
            {guilds.length > 0
              ? 'Pick a guild to manage, or add another one.'
              : 'Add your first guild to get started.'}
          </span>
        </div>
        <Link className="btn btn-primary" to="/guilds/create">
          + Add a guild
        </Link>
      </div>

      {guilds.length === 0 ? (
        <div className="card empty">
          <p>
            None of your Discord servers belong to a guild that uses Guild Assistant yet. Add one to
            get started.
          </p>
          <SetupInstructions setup={setup} />
        </div>
      ) : (
        <div className="guild-grid">
          {guilds.map((guild) => (
            <Link key={guild.id} className="guild-card" to={guildPath(guild)}>
              <strong>{guild.name}</strong>
              <span className="muted">
                {guild.faction === 'ALLIANCE' ? 'Alliance' : 'Horde'} · {guild.realm} ·{' '}
                {guild.gameVersion} ·{' '}
                {setup.regions.find((r) => r.id === guild.region)?.label ?? guild.region}
              </span>
              <span className="muted">
                Your access: {accessSummary(guild, setup.adminRoleName)}
              </span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
