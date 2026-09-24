import type { SetupInfo } from './types';

export function SetupInstructions({ setup }: { setup: SetupInfo }) {
  return (
    <div className="setup">
      <h3>Before you create a guild</h3>
      <ol>
        <li>
          <a href={setup.botInviteUrl} target="_blank" rel="noreferrer">
            Add the Guild Assistant bot
          </a>{' '}
          to your Discord server. You need the Manage Server permission there. The bot needs no
          other permissions; it is only used to read the server's roles.
        </li>
        <li>
          In Server Settings → Roles, create a role named exactly{' '}
          <strong>{setup.adminRoleName}</strong> (capitalisation matters) and give it to yourself
          and to anyone who should manage the guild.
        </li>
        <li>
          Come back here and pick the server below. A guild with several servers needs the role in
          every one of them to be managed, and one of them is the <strong>main</strong> server.
        </li>
        <li>
          Optional: after creating the guild, open <strong>Manage guild</strong> and choose which
          role in the main server is your guild&apos;s <strong>Officer</strong> role. Officers can
          then manage the guild without holding {setup.adminRoleName}.
        </li>
      </ol>
    </div>
  );
}
