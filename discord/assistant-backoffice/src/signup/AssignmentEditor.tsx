import { useState, type DragEvent, type FormEvent } from 'react';
import { InlineSpinner } from '../Loading';
import { MultiSelect } from '../MultiSelect';
import type { Guild } from '../types';
import { AssignmentLineView } from './AssignmentLineView';
import { lineText } from './assignmentText';
import { ClassMark } from '../ClassMark';
import { RoleMark } from '../RoleMark';
import { SCOPE_LABELS, entryName, errorText } from './labels';
import { TargetPicker } from './TargetPicker';
import {
  assignmentImageUrl,
  createAssignment,
  updateAssignment,
  uploadAssignmentImage,
  type Assignment,
  type AssignmentLine,
  type AssignmentScope,
  type SignupEvent,
} from './signupApi';

const MAX_IMAGES = 4;
const SCOPES: AssignmentScope[] = ['GLOBAL', 'RAID', 'BOSS'];
const emptyLine = (): AssignmentLine => ({ entryIds: [], task: '', target: null });

/**
 * Writing an assignment: who it is for (everyone, a raid or a boss), a title, and lines that give
 * players a task, each optionally aimed at a raid marker or another player. "Darkshivan · heals ·
 * Tearyn", "Darkshivan · tanks · Cross", or just "Darkshivan · moves to the end of the room".
 */
export function AssignmentEditor({
  guild,
  event,
  assignment,
  onDone,
}: {
  guild: Guild;
  event: SignupEvent;
  assignment: Assignment | null;
  onDone: (saved: boolean) => void;
}) {
  const [scope, setScope] = useState<AssignmentScope>(assignment?.scope ?? 'GLOBAL');
  const [scopeLabel, setScopeLabel] = useState(assignment?.scopeLabel ?? '');
  const [title, setTitle] = useState(assignment?.title ?? '');
  const [lines, setLines] = useState<AssignmentLine[]>(
    assignment && assignment.lines.length > 0 ? assignment.lines : [emptyLine()],
  );
  const [mentions, setMentions] = useState(assignment?.mentions ?? false);
  const [imageIds, setImageIds] = useState<string[]>(assignment?.imageIds ?? []);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const players = event.entries.filter((entry) => entry.status !== 'ABSENT');
  const sortedPlayers = [...players].sort((a, b) => entryName(a).localeCompare(entryName(b)));
  // Each player with their role and class icons in the list, as in Discord.
  const playerOptions = sortedPlayers.map((entry) => ({
    value: entry.id,
    label: entryName(entry),
    icon: (
      <span className="player-mark">
        {entry.role && <RoleMark gameVersion={guild.gameVersion} role={entry.role} />}
        <ClassMark gameVersion={guild.gameVersion} className={entry.characterClass} />
      </span>
    ),
  }));
  const knownLabels = [
    ...new Set(
      event.assignments.filter((a) => a.scope === scope && a.scopeLabel).map((a) => a.scopeLabel),
    ),
  ];

  const setLine = (index: number, patch: Partial<AssignmentLine>) =>
    setLines((current) => current.map((line, i) => (i === index ? { ...line, ...patch } : line)));

  const addImages = (files: FileList | null) => {
    const chosen = [...(files ?? [])].slice(0, MAX_IMAGES - imageIds.length);
    if (chosen.length === 0) return;
    setUploading(true);
    setError(null);
    chosen
      .reduce<Promise<void>>(
        (previous, file) =>
          previous.then(() =>
            uploadAssignmentImage(guild.id, event.id, file).then((image) =>
              setImageIds((current) => [...current, image.id]),
            ),
          ),
        Promise.resolve(),
      )
      .catch((err: unknown) => setError(errorText(err)))
      .finally(() => setUploading(false));
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    addImages(e.dataTransfer.files);
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    const input = { scope, scopeLabel, title, lines, mentions, imageIds };
    (assignment
      ? updateAssignment(guild.id, event.id, assignment.id, input)
      : createAssignment(guild.id, event.id, input)
    )
      .then(() => onDone(true))
      .catch((err: unknown) => {
        setError(errorText(err));
        setSaving(false);
      });
  };

  // Lines with something to show (lineText is '' for an empty one).
  const preview = lines.filter((line) => lineText(line, event.entries) !== '');

  return (
    <form className="task-card assignment-editor" onSubmit={submit}>
      <strong>{assignment ? 'Edit assignment' : 'New assignment'}</strong>
      <div className="form-grid">
        <label className="field">
          For
          <select value={scope} onChange={(e) => setScope(e.target.value as AssignmentScope)}>
            {SCOPES.map((value) => (
              <option key={value} value={value}>
                {SCOPE_LABELS[value]}
              </option>
            ))}
          </select>
        </label>
        {scope !== 'GLOBAL' && (
          <label className="field">
            {scope === 'RAID' ? 'Raid' : 'Boss'}
            <input
              value={scopeLabel}
              onChange={(e) => setScopeLabel(e.target.value)}
              maxLength={60}
              list="assignment-scope-labels"
              placeholder={scope === 'RAID' ? 'e.g. Naxxramas' : 'e.g. Patchwerk'}
            />
            <datalist id="assignment-scope-labels">
              {knownLabels.map((label) => (
                <option key={label} value={label} />
              ))}
            </datalist>
          </label>
        )}
        <label className="field field-wide">
          Title
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={100}
            placeholder="e.g. Healing assignments"
            required
          />
        </label>
      </div>

      <div className="assignment-line-list">
        {lines.map((line, index) => (
          <div key={index} className="assignment-line">
            <div className="field">
              <span>Players</span>
              <MultiSelect
                options={playerOptions}
                value={line.entryIds}
                onChange={(entryIds) => setLine(index, { entryIds })}
                placeholder="Who…"
              />
            </div>
            <label className="field">
              Task
              <input
                value={line.task}
                onChange={(e) => setLine(index, { task: e.target.value })}
                maxLength={200}
                placeholder="heals / tanks / moves to the end of the room"
              />
            </label>
            <div className="field">
              <span>Target</span>
              <TargetPicker
                gameVersion={guild.gameVersion}
                players={sortedPlayers}
                value={line.target}
                onChange={(target) => setLine(index, { target })}
              />
            </div>
            <button
              type="button"
              className="btn btn-sm assignment-line-remove"
              title="Remove this line"
              aria-label="Remove this line"
              onClick={() =>
                setLines((current) =>
                  current.length === 1 ? [emptyLine()] : current.filter((_, i) => i !== index),
                )
              }
            >
              ✕
            </button>
          </div>
        ))}
        <button
          type="button"
          className="btn btn-sm"
          onClick={() => setLines((current) => [...current, emptyLine()])}
        >
          + Line
        </button>
      </div>

      <div className="field">
        Images
        <div
          className={dragOver ? 'image-dropzone image-dropzone-active' : 'image-dropzone'}
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onDrop}
        >
          {imageIds.map((id) => (
            <span key={id} className="image-tile">
              <img src={assignmentImageUrl(guild.id, event.id, id)} alt="" />
              <button
                type="button"
                className="image-tile-remove"
                title="Remove this image"
                aria-label="Remove image"
                onClick={() => setImageIds((current) => current.filter((i) => i !== id))}
              >
                ✕
              </button>
            </span>
          ))}
          {imageIds.length < MAX_IMAGES && (
            <label className="image-tile image-tile-add">
              {uploading ? (
                <InlineSpinner label="Uploading…" />
              ) : (
                <>
                  <span className="image-tile-add-icon">+</span>
                  <span>Add image</span>
                </>
              )}
              <input
                type="file"
                hidden
                multiple
                accept="image/png,image/jpeg,image/gif,image/webp"
                disabled={uploading}
                onChange={(e) => {
                  addImages(e.target.files);
                  e.target.value = '';
                }}
              />
            </label>
          )}
        </div>
        <span className="muted">
          Up to {MAX_IMAGES} images, shown under the message — drag and drop, or click to browse.
        </span>
      </div>

      <label className="field-toggle">
        <input type="checkbox" checked={mentions} onChange={(e) => setMentions(e.target.checked)} />
        Mention (ping) the assigned players
      </label>

      <div className="assignment-preview">
        <span className="muted">
          {scopeLabel && scope !== 'GLOBAL'
            ? `${SCOPE_LABELS[scope]} · ${scopeLabel}`
            : SCOPE_LABELS[scope]}
        </span>
        <strong>{title || 'Title'}</strong>
        {preview.length === 0 ? (
          <span className="muted">No lines yet.</span>
        ) : (
          <ul className="assignment-lines">
            {preview.map((line, i) => (
              <li key={i}>
                <AssignmentLineView
                  line={line}
                  entries={event.entries}
                  gameVersion={guild.gameVersion}
                />
              </li>
            ))}
          </ul>
        )}
      </div>

      {error && <p className="status-error">{error}</p>}
      <div className="form-actions">
        <button type="submit" className="btn btn-primary" disabled={saving || uploading}>
          {saving ? (
            <InlineSpinner label="Saving…" />
          ) : assignment?.postUrl ? (
            'Save and update the post'
          ) : (
            'Save'
          )}
        </button>
        <button type="button" className="btn" onClick={() => onDone(false)} disabled={saving}>
          Cancel
        </button>
      </div>
    </form>
  );
}
