import { useState, type DragEvent, type FormEvent } from 'react';
import { Drawer } from '../Drawer';
import { importProfessions, type ImportResult } from './professionsApi';
import './professions.css';

/** Where to get the addon. */
export const ADDON_URL = 'https://www.curseforge.com/wow/addons/guild-assistant-professions';

/** Where the game writes the addon's data, the file uploaded here (from the game's folder). */
const FILE = 'WTF/Account/<account>/SavedVariables/GuildAssistantProfessions.lua';

/**
 * Importing the Guild Assistant Professions addon's saved variables file, which holds its export:
 * every character of the player's account; the API keeps the ones that are theirs in this guild.
 * The file can be dropped, chosen or its contents pasted: all end up as the text that is sent.
 */
export function ImportProfessionsDrawer({
  guildId,
  onClose,
}: {
  guildId: string;
  onClose: () => void;
}) {
  const [data, setData] = useState('');
  const [fileName, setFileName] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);

  const readFile = (file: File | undefined) => {
    if (!file) return;
    setError(null);
    file
      .text()
      .then((text) => {
        setData(text);
        setFileName(file.name);
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
  };

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragOver(false);
    readFile(event.dataTransfer.files[0]);
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    importProfessions(guildId, data)
      .then(setResult)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setBusy(false));
  };

  return (
    <Drawer title="Import professions" onClose={onClose}>
      {result ? (
        <div className="professions">
          {result.imported.length === 0 ? (
            <p className="status-error">
              None of the export’s characters are yours in this guild, so nothing was imported.
            </p>
          ) : (
            <>
              <p>Imported:</p>
              <ul className="import-result">
                {result.imported.map((character) => (
                  <li key={character.characterId}>
                    <strong>{character.name}</strong>:{' '}
                    {character.professions.length === 0
                      ? 'no professions'
                      : character.professions
                          .map((p) => `${p.name} (${p.recipes} recipes)`)
                          .join(', ')}
                  </li>
                ))}
              </ul>
            </>
          )}
          {result.skipped.length > 0 && (
            <p className="muted">
              Not in this guild’s roster as yours, so skipped:{' '}
              {result.skipped.map((c) => `${c.name} (${c.realm})`).join(', ')}. Add them to the
              roster first to import them too.
            </p>
          )}
          {result.linked.length > 0 && (
            <p className="muted">
              Seen through profession links, not imported: other players’ professions can’t be
              imported yet ({result.linked.map((c) => c.name).join(', ')}).
            </p>
          )}
          <div className="form-actions">
            <button type="button" className="btn btn-primary" onClick={onClose}>
              Done
            </button>
          </div>
        </div>
      ) : (
        <form className="professions" onSubmit={submit}>
          <ol className="import-steps">
            <li>
              Install the{' '}
              <a href={ADDON_URL} target="_blank" rel="noreferrer">
                Guild Assistant Professions
              </a>{' '}
              addon (CurseForge).
            </li>
            <li>
              Log in with each character and open each of its professions’ windows once, so the
              addon sees the recipes.
            </li>
            <li>
              Type <code>/ga-prof log</code> (or log out): the game writes what the addon recorded
              to a file.
            </li>
            <li>
              Drop <code>{FILE}</code> below, from the game’s folder (<code>/ga-prof status</code>{' '}
              says where), or paste its contents. All your characters in this guild are updated at
              once.
            </li>
          </ol>
          <div
            className={dragOver ? 'import-drop import-drop-active' : 'import-drop'}
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={onDrop}
          >
            <div className="import-drop-head">
              <span className="muted">
                {fileName ? (
                  <>
                    Read <strong>{fileName}</strong>
                  </>
                ) : (
                  'Drop the file here, or'
                )}
              </span>
              <label className="btn btn-sm">
                Choose file
                <input
                  type="file"
                  hidden
                  accept=".lua,.json,.txt"
                  onChange={(e) => {
                    readFile(e.target.files?.[0]);
                    e.target.value = '';
                  }}
                />
              </label>
            </div>
            <textarea
              aria-label="The file's contents"
              value={data}
              onChange={(e) => {
                setData(e.target.value);
                setFileName(null);
              }}
              rows={8}
              placeholder="…or paste its contents: GuildAssistantProfessionsDB = { …"
              spellCheck={false}
            />
          </div>
          {error && <p className="status-error">{error}</p>}
          <div className="form-actions">
            <button type="submit" className="btn btn-primary" disabled={busy || !data.trim()}>
              {busy ? 'Importing…' : 'Import'}
            </button>
            <button type="button" className="btn" onClick={onClose}>
              Cancel
            </button>
          </div>
        </form>
      )}
    </Drawer>
  );
}
