import { useEffect, useState, type FormEvent } from 'react';
import { request } from './api';
import { Drawer } from './Drawer';
import { SkeletonLines } from './Loading';
import { FormStatus } from './OneLine';
import { timeAgo } from './time';
import { showToast } from './toast';
import { useConfirm } from './useConfirm';
import { usePageMeta } from './usePageMeta';

/** Where to get the Guild Assistant Uploader (discord/assistant-uploader): its GitHub releases. */
export const UPLOADER_URL = 'https://github.com/sj-freitas/sf-wow-tools/releases/latest';

/** One of the player's keys (the API's UploadKeyDto): never the key itself, which isn't kept. */
interface UploadKey {
  id: string;
  name: string;
  /** Its first characters ("gak_Ab12Cd"). */
  prefix: string;
  createdAt: string;
  lastUsedAt: string | null;
}

const MAX_NAME = 40;

/** The uploader's "Get an upload key" opens this page with `?name=` its computer ("Mac"). */
const suggestedName = (): string =>
  (new URLSearchParams(window.location.search).get('name') ?? '').trim().slice(0, MAX_NAME);

/**
 * `/upload-keys`: the player's keys for the Guild Assistant Uploader, which uploads their
 * professions file by itself whenever the game saves it. A new key is shown once, in a drawer;
 * the list has each key's name, its first characters and when it was last used.
 */
export function UploadKeysPage() {
  usePageMeta({ title: 'Upload keys', index: false });
  const [keys, setKeys] = useState<UploadKey[] | null>(null);
  const [name, setName] = useState(suggestedName);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<(UploadKey & { key: string }) | null>(null);
  const { confirm, dialog } = useConfirm();

  useEffect(() => {
    request<UploadKey[]>('GET', '/api/upload-keys')
      .then(setKeys)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
  }, []);

  const create = (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    request<UploadKey & { key: string }>('POST', '/api/upload-keys', { name })
      .then((key) => {
        setCreated(key);
        setKeys((current) => [key, ...(current ?? [])]);
        setName('');
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setBusy(false));
  };

  const remove = async (key: UploadKey) => {
    const ok = await confirm({
      title: `Delete “${key.name}”?`,
      message:
        'The uploader that has this key stops uploading at once. You can make a new key for it any time.',
      confirmLabel: 'Delete key',
      danger: true,
    });
    if (!ok) return;
    request<void>('DELETE', `/api/upload-keys/${encodeURIComponent(key.id)}`)
      .then(() => {
        setKeys((current) => (current ?? []).filter((k) => k.id !== key.id));
        showToast(`“${key.name}” deleted`, 3000);
      })
      .catch((err: unknown) => showToast(err instanceof Error ? err.message : String(err), 6000));
  };

  const copy = (key: string) => {
    navigator.clipboard
      .writeText(key)
      .then(() => showToast('Key copied: paste it into the uploader', 3000))
      .catch(() => window.prompt('Copy the key:', key));
  };

  return (
    <div className="tasks">
      <div className="tasks-head">
        <div>
          <h2>Upload keys</h2>
          <p className="muted">
            The Guild Assistant Uploader, on your computer, sends your professions to all your
            guilds by itself whenever the game saves them. It needs a key to upload as you. A key
            can only upload professions, nothing else on your account.
          </p>
        </div>
      </div>

      <ol className="import-steps upload-key-steps">
        <li>
          Get the{' '}
          <a href={UPLOADER_URL} target="_blank" rel="noreferrer">
            Guild Assistant Uploader
          </a>{' '}
          for Mac or Windows, and open it.
        </li>
        <li>Make a key here and paste it into the uploader.</li>
        <li>
          Choose your game’s folder in the uploader. From then on, each time the game saves the
          addon’s file (<code>/ga-prof save</code>, or logging out), it’s uploaded.
        </li>
      </ol>

      <form className="inline-form upload-key-form" onSubmit={create}>
        <label className="field">
          Name
          <input
            type="text"
            value={name}
            maxLength={MAX_NAME}
            placeholder="My computer"
            required
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        <button type="submit" className="btn btn-primary" disabled={busy || !name.trim()}>
          Make a key
        </button>
      </form>
      <FormStatus error={error} />

      {keys === null ? (
        <SkeletonLines count={2} />
      ) : keys.length === 0 ? (
        <p className="muted">No keys yet.</p>
      ) : (
        <ul className="own-characters">
          {keys.map((key) => (
            <li key={key.id} className="own-character">
              <div className="own-character-main">
                <strong className="name-truncate">{key.name}</strong>
                <span className="muted">
                  {key.prefix}… · made {timeAgo(key.createdAt)} ·{' '}
                  {key.lastUsedAt ? `last used ${timeAgo(key.lastUsedAt)}` : 'never used'}
                </span>
              </div>
              <button type="button" className="btn btn-sm btn-danger" onClick={() => remove(key)}>
                Delete
              </button>
            </li>
          ))}
        </ul>
      )}

      {created && (
        <Drawer title="Your new upload key" onClose={() => setCreated(null)}>
          <p>
            Paste it into the Guild Assistant Uploader now:{' '}
            <strong>this is the only time it’s shown</strong>. Keep it to yourself, like a password:
            it uploads professions as you.
          </p>
          <code className="upload-key-reveal">{created.key}</code>
          <div className="form-actions">
            <button type="button" className="btn btn-primary" onClick={() => copy(created.key)}>
              Copy key
            </button>
            <button type="button" className="btn" onClick={() => setCreated(null)}>
              Done
            </button>
          </div>
        </Drawer>
      )}
      {dialog}
    </div>
  );
}
