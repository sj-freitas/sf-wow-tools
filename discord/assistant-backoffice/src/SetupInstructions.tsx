import type { SetupInfo } from './types';

/** How to get a Discord server ready for a guild, and who can do what (create guild, overview). */
export function SetupInstructions({ setup }: { setup: SetupInfo }) {
  return (
    <div className="setup">
      <h3>Before you create a guild</h3>
      <ol>
        <li>
          <a href={setup.botInviteUrl} target="_blank" rel="noreferrer">
            Add the Guild Assistant bot
          </a>{' '}
          to your Discord server (you need the Manage Server permission). The bot only reads the
          server&apos;s roles.
        </li>
        <li>
          In Server Settings → Roles, create a role named exactly <code>{setup.adminRoleName}</code>{' '}
          and give it to everyone who should manage the guild.
        </li>
        <li>
          Pick your server below. A guild can have several servers: each needs the role, and one of
          them is the main server.
        </li>
        <li>Once the guild is created, choose its Officer role in the guild&apos;s Settings.</li>
      </ol>
      <h3>Who can do what</h3>
      <ul>
        <li>
          {setup.adminRoleName}, in every server of the guild: sets the guild up (its details,
          servers and Officer role).
        </li>
        <li>
          Officers: manage everyone&apos;s characters and the guild&apos;s settings. They can also
          take over if nobody holds {setup.adminRoleName} any more.
        </li>
        <li>Everyone else in the guild&apos;s servers: add and edit their own characters.</li>
      </ul>
    </div>
  );
}
