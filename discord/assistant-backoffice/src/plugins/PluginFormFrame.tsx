import type { FormEvent, ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { Guild } from '../types';
import type { Plugin, PluginKind } from './pluginsApi';

/** What each kind's form gets: `editing` is the plugin when editing one. */
export interface PluginFormProps<K extends PluginKind = PluginKind> {
  guild: Guild;
  timezone: string;
  editing?: Extract<Plugin, { kind: K }>;
}

/** The frame around a plugin's form: back link, title, intro, error and buttons. */
export function PluginFormFrame({
  title,
  intro,
  back,
  busy,
  error,
  editing,
  onSubmit,
  children,
}: {
  title: string;
  intro: ReactNode;
  back: string;
  busy: boolean;
  error: string | null;
  editing: boolean;
  onSubmit: (event: FormEvent) => void;
  children: ReactNode;
}) {
  return (
    <div className="tasks">
      <Link className="back-link" to={back}>
        ← Plugins
      </Link>
      <form className="card-body task-form" onSubmit={onSubmit}>
        <h3>{title}</h3>
        <p className="muted">{intro}</p>
        {children}
        {error && <p className="status-error">{error}</p>}
        <div className="form-actions">
          <Link className="btn" to={back}>
            Cancel
          </Link>
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {editing ? 'Save' : 'Add'}
          </button>
        </div>
      </form>
    </div>
  );
}
