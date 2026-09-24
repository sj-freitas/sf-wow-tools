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
          every one of them to be configured, and one of them is the <strong>main</strong> server.
        </li>
        <li>
          After creating the guild, open <strong>Manage guild</strong> and choose which role in the
          main server is your guild&apos;s <strong>Officer</strong> role.
        </li>
      </ol>
      <h3>Who can do what</h3>
      <ul>
        <li>
          <strong>{setup.adminRoleName}</strong> (in every server of the guild): create guilds and
          configure them: details, servers, main server and Officer role. Not other people&apos;s
          characters.
        </li>
        <li>
          <strong>Officer</strong> (the role you pick for the guild): add, edit and remove every
          player&apos;s characters, and configure the guild too. This is also the way out if a
          server ever loses its {setup.adminRoleName} holders.
        </li>
        <li>
          <strong>Everyone else</strong> in one of the guild&apos;s Discord servers: add and edit
          their own characters. No role needed.
        </li>
      </ul>
    </div>
  );
}
