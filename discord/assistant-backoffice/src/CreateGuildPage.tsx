import { Link, useNavigate } from 'react-router-dom';
import { CreateGuildForm } from './CreateGuildForm';
import { guildPath } from './guildPath';
import type { Guild, SetupInfo } from './types';

interface Props {
  setup: SetupInfo;
  /** Reloads the user's guilds so the new one is known before we go to it. */
  onCreated: () => Promise<unknown>;
}

/** `/guilds/create`: set up a new guild, then go to it. */
export function CreateGuildPage({ setup, onCreated }: Props) {
  const navigate = useNavigate();
  return (
    <div className="tasks">
      <Link className="back-link" to="/overview">
        ← Overview
      </Link>
      <CreateGuildForm
        setup={setup}
        onCancel={() => navigate('/overview')}
        onCreated={(guild: Guild) => void onCreated().then(() => navigate(guildPath(guild)))}
      />
    </div>
  );
}
