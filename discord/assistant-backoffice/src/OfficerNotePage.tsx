import { useEffect, useState, type DragEvent, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  deleteOfficerNoteImage,
  fetchOfficerNote,
  officerNoteImageUrl,
  saveOfficerNote,
  uploadOfficerNoteImage,
} from './api';
import { ClassMark } from './ClassMark';
import { guildPath } from './guildPath';
import { InlineSpinner, SkeletonLines } from './Loading';
import { MarkdownView } from './MarkdownView';
import { timeAgo } from './time';
import type { Guild, OfficerNote } from './types';
import { useReturnTo } from './useReturnTo';

const MAX_NOTE_LENGTH = 20_000;
const MAX_NOTE_IMAGES = 8;

/**
 * `/roster/notes/:characterId`: the guild's Officers' private note about a character, like a bio
 * but for Officers only — the player never sees it. Markdown, and up to 8 images.
 */
export function OfficerNotePage({ guild }: { guild: Guild }) {
  const { characterId = '' } = useParams();
  const navigate = useNavigate();
  const back = useReturnTo(guildPath(guild, 'roster'));
  const [note, setNote] = useState<OfficerNote | null>(null);
  const [text, setText] = useState('');
  const [images, setImages] = useState<OfficerNote['images']>([]);
  const [tab, setTab] = useState<'write' | 'preview'>('write');
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchOfficerNote(guild.id, characterId)
      .then((value) => {
        setNote(value);
        setText(value.markdown);
        setImages(value.images);
        if (value.markdown) setTab('preview');
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
  }, [guild.id, characterId]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setError(null);
    saveOfficerNote(guild.id, characterId, text)
      .then(() => navigate(back))
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : String(err));
        setSaving(false);
      });
  };

  const addImages = (files: FileList | null) => {
    const chosen = Array.from(files ?? [])
      .filter((file) => file.type.startsWith('image/'))
      .slice(0, Math.max(0, MAX_NOTE_IMAGES - images.length));
    if (chosen.length === 0) return;
    setUploading(true);
    setError(null);
    chosen
      .reduce<Promise<void>>(
        (previous, file) =>
          previous.then(() =>
            uploadOfficerNoteImage(guild.id, characterId, file).then((image) =>
              setImages((current) => [...current, image]),
            ),
          ),
        Promise.resolve(),
      )
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setUploading(false));
  };

  const removeImage = (imageId: string) => {
    setImages((current) => current.filter((image) => image.id !== imageId));
    deleteOfficerNoteImage(guild.id, characterId, imageId).catch((err: unknown) =>
      setError(err instanceof Error ? err.message : String(err)),
    );
  };

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragOver(false);
    addImages(event.dataTransfer.files);
  };

  if (!note) {
    return (
      <div className="card-body">
        {error ? <p className="status-error">{error}</p> : <SkeletonLines count={6} />}
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="card-body officer-note">
      <Link className="back-link" to={back}>
        ← Roster
      </Link>
      <div className="tasks-head">
        <div>
          <h2>
            <ClassMark gameVersion={guild.gameVersion} className={note.characterClass} />
            {note.characterName}
          </h2>
          <span className="muted">
            🔒 Officer note: only the guild’s Officers can see this, never the player.
            {note.updatedAt &&
              ` Last saved ${timeAgo(note.updatedAt)}${note.updatedByName ? ` by ${note.updatedByName}` : ''}.`}
          </span>
        </div>
      </div>

      <div className="field">
        <div className="write-tabs" role="tablist">
          {(['write', 'preview'] as const).map((value) => (
            <button
              key={value}
              type="button"
              role="tab"
              aria-selected={tab === value}
              className={tab === value ? 'write-tab write-tab-active' : 'write-tab'}
              onClick={() => setTab(value)}
            >
              {value === 'write' ? 'Write' : 'Preview'}
            </button>
          ))}
          <span
            className={
              text.length > MAX_NOTE_LENGTH
                ? 'status-error write-tabs-count'
                : 'muted write-tabs-count'
            }
          >
            {text.length.toLocaleString()}/{MAX_NOTE_LENGTH.toLocaleString()}
          </span>
        </div>
        {tab === 'write' ? (
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={14}
            placeholder="What the officers should know about this character… (markdown: **bold**, lists, links)"
            maxLength={MAX_NOTE_LENGTH + 500}
            autoFocus
          />
        ) : (
          <div className="bio-page-card write-preview">
            {text.trim() === '' ? (
              <p className="muted">Nothing written yet.</p>
            ) : (
              <MarkdownView text={text} />
            )}
          </div>
        )}
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
          {images.map((image) => (
            <span key={image.id} className="image-tile">
              <a href={officerNoteImageUrl(guild.id, image.id)} target="_blank" rel="noreferrer">
                <img src={officerNoteImageUrl(guild.id, image.id)} alt="" />
              </a>
              <button
                type="button"
                className="image-tile-remove"
                title="Remove this image"
                aria-label="Remove image"
                onClick={() => removeImage(image.id)}
              >
                ✕
              </button>
            </span>
          ))}
          {images.length < MAX_NOTE_IMAGES && (
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
          Up to {MAX_NOTE_IMAGES} images (screenshots, logs…) — drag and drop, or click to browse.
          Images are kept as soon as they’re added.
        </span>
      </div>

      {error && <p className="status-error">{error}</p>}
      <div className="form-actions">
        <button
          type="submit"
          className="btn btn-primary"
          disabled={saving || text.length > MAX_NOTE_LENGTH}
        >
          {saving ? <InlineSpinner label="Saving…" /> : 'Save note'}
        </button>
        <Link className="btn" to={back}>
          Cancel
        </Link>
      </div>
    </form>
  );
}
