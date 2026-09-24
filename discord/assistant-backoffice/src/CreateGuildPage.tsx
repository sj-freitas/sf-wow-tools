import { Link, useNavigate } from 'react-router-dom';
import { CreateGuildForm } from './CreateGuildForm';
import type { Guild, SetupInfo } from './types';

interface Props {
  setup: SetupInfo;
  onCreated: (guild: Guild) => Promise<void>;
}

/** `/guilds/create`: set up a new guild. */
export function CreateGuildPage({ setup, onCreated }: Props) {
  const navigate = useNavigate();
  return (
    <div className="tasks">
      <Link className="back-link" to="/">
        ← Back
      </Link>
      <CreateGuildForm
        setup={setup}
        onCancel={() => navigate('/')}
        onCreated={(guild) => void onCreated(guild).then(() => navigate('/'))}
      />
    </div>
  );
}
