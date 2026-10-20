import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { guildPath } from '../guildPath';
import type { Guild } from '../types';
import { useConfirm } from '../useConfirm';
import {
  createPlugin,
  updatePlugin,
  type Plugin,
  type PluginInput,
  type PluginKind,
} from './pluginsApi';

/**
 * Saving a plugin form: edits save at once; a new plugin is confirmed first, as it acts on its own.
 */
export function usePluginSave(guild: Guild, kind: PluginKind, editing: Plugin | undefined) {
  const navigate = useNavigate();
  const { confirm, dialog } = useConfirm();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const back = guildPath(guild, 'plugins');

  const save = (
    input: PluginInput,
    confirmation: { title: string; message: string; danger?: boolean },
  ) => {
    const run = (action: () => Promise<unknown>) => {
      setBusy(true);
      setError(null);
      action()
        .then(() => navigate(back))
        .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))
        .finally(() => setBusy(false));
    };
    if (editing) {
      run(() => updatePlugin(editing.id, input));
      return;
    }
    void confirm({ ...confirmation, confirmLabel: 'Add' }).then(
      (ok) => ok && run(() => createPlugin(guild.id, { ...input, kind, confirm: true })),
    );
  };
  return { save, busy, error, dialog, back };
}
