import { useCallback, useEffect, useState, type DragEvent, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  bioImageUrl,
  deleteBioImage,
  fetchCharacterProfile,
  updateCharacterBio,
  uploadBioImage,
} from './api';
import { characterPagePath } from './guildPath';
import { InlineSpinner, Spinner } from './Loading';
import { MarkdownView } from './MarkdownView';
import type { CharacterProfile } from './types';
import { useReturnTo } from './useReturnTo';

const MAX_BIO_LENGTH = 20_000;
const MAX_BIO_IMAGES = 4;

interface Props {
  /** `/bio`: the editor, for the character's own player only. Otherwise the read-only page. */
  editMode: boolean;
}

/**
 * A character's own page, guild-agnostic: `/<version>/<region>/<server>/characters/<name>`, the
 * same address regardless of which guild it is in (or none), with `/bio` appended for its editor.
 */
export function CharacterPage({ editMode }: Props) {
  const { version = '', region = '', realm = '', namePath = '' } = useParams();
  const navigate = useNavigate();
  const back = useReturnTo('/overview');
  const [profile, setProfile] = useState<CharacterProfile | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setError(null);
    fetchCharacterProfile(version, region, realm, namePath)
      .then(setProfile)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
  }, [version, region, realm, namePath]);

  useEffect(load, [load]);

  const server = { gameVersion: version, region, realm };
  const viewUrl = characterPagePath(server, namePath);
  const editUrl = characterPagePath(server, namePath, 'bio');

  return (
    <div className="tasks">
      <Link className="back-link" to={back}>
        ← Back
      </Link>
      {error ? (
        <p className="status-error">{error}</p>
      ) : !profile ? (
        <Spinner />
      ) : editMode ? (
        profile.isOwner ? (
          <BioEditor profile={profile} onSaved={() => navigate(viewUrl)} />
        ) : (
          <p className="empty">
            You can only write your own character's bio.{' '}
            <Link to={viewUrl}>View {profile.name}</Link>
          </p>
        )
      ) : (
        <CharacterView profile={profile} editUrl={editUrl} />
      )}
    </div>
  );
}

function CharacterView({ profile, editUrl }: { profile: CharacterProfile; editUrl: string }) {
  return (
    <>
      <div className="tasks-head">
        <div>
          <h2>{profile.name}</h2>
          <div className="card-meta">
            {profile.class} · {profile.race} · Level {profile.level} · {profile.roles.join(', ')}
            {profile.isMain && <span className="badge badge-main main-pill">Main</span>}
          </div>
        </div>
        {profile.isOwner && profile.bioSupported && (
          <Link className="btn btn-sm" to={editUrl}>
            {profile.bio === null && !profile.bioVisible ? 'Write a bio' : 'Edit bio'}
          </Link>
        )}
      </div>

      <div className="character-links">
        <span className="btn btn-sm disabled" title="Coming soon">
          Armory
        </span>
        <span className="btn btn-sm disabled" title="Coming soon">
          Logs
        </span>
      </div>

      {profile.bioSupported && (
        <div className="bio-page-card">
          {profile.images.length > 0 && (
            <div className="bio-gallery">
              {profile.images.map((image) => (
                <img key={image.id} src={bioImageUrl(image.id)} alt="" />
              ))}
            </div>
          )}
          {profile.bio ? (
            <MarkdownView text={profile.bio} />
          ) : (
            <p className="empty">
              {profile.isOwner
                ? 'You haven’t written a bio yet.'
                : profile.bioVisible
                  ? 'No bio written yet.'
                  : "This character's bio is private."}
            </p>
          )}
        </div>
      )}
    </>
  );
}

function BioEditor({ profile, onSaved }: { profile: CharacterProfile; onSaved: () => void }) {
  const [text, setText] = useState(profile.bio ?? '');
  const [visible, setVisible] = useState(profile.bioVisible);
  const [tab, setTab] = useState<'write' | 'preview'>('write');
  const [images, setImages] = useState(profile.images);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [imageError, setImageError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setSaving(true);
    updateCharacterBio(profile.characterId, { bio: text, bioVisible: visible })
      .then(onSaved)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setSaving(false));
  };

  const addImages = (files: FileList | File[] | null) => {
    if (!files || files.length === 0) return;
    setImageError(null);
    const room = MAX_BIO_IMAGES - images.length;
    const chosen = Array.from(files)
      .filter((file) => file.type.startsWith('image/'))
      .slice(0, Math.max(0, room));
    if (chosen.length === 0) return;
    setUploading(true);
    Promise.all(chosen.map((file) => uploadBioImage(profile.characterId, file)))
      .then((added) => setImages((current) => [...current, ...added]))
      .catch((err: unknown) => setImageError(err instanceof Error ? err.message : String(err)))
      .finally(() => setUploading(false));
  };

  const removeImage = (imageId: string) => {
    setImageError(null);
    setImages((current) => current.filter((image) => image.id !== imageId));
    deleteBioImage(profile.characterId, imageId).catch((err: unknown) => {
      setImageError(err instanceof Error ? err.message : String(err));
      setImages((current) => [...current, ...profile.images.filter((i) => i.id === imageId)]);
    });
  };

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragOver(false);
    addImages(event.dataTransfer.files);
  };

  return (
    <form onSubmit={submit} className="card-body">
      <div className="tasks-head">
        <h2>{profile.name}</h2>
      </div>

      <div className="field">
        <div className="write-tabs" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'write'}
            className={tab === 'write' ? 'write-tab write-tab-active' : 'write-tab'}
            onClick={() => setTab('write')}
          >
            Write
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'preview'}
            className={tab === 'preview' ? 'write-tab write-tab-active' : 'write-tab'}
            onClick={() => setTab('preview')}
          >
            Preview
          </button>
          <span
            className={
              text.length > MAX_BIO_LENGTH
                ? 'status-error write-tabs-count'
                : 'muted write-tabs-count'
            }
          >
            {text.length.toLocaleString()}/{MAX_BIO_LENGTH.toLocaleString()}
          </span>
        </div>
        {tab === 'write' ? (
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={16}
            placeholder="A bit of background for your character… (markdown: headings, **bold**, lists, links, images and more)"
            maxLength={MAX_BIO_LENGTH + 500}
            autoFocus
          />
        ) : (
          <div className="bio-page-card write-preview">
            {text.trim() === '' ? (
              <p className="muted">Nothing to preview yet.</p>
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
              <img src={bioImageUrl(image.id)} alt="" />
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
          {images.length < MAX_BIO_IMAGES && (
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
          Up to {MAX_BIO_IMAGES} images — drag and drop, or click to browse.
        </span>
        {imageError && <p className="status-error">{imageError}</p>}
      </div>

      <label className="field-toggle">
        <input type="checkbox" checked={visible} onChange={(e) => setVisible(e.target.checked)} />
        Visible to everyone
      </label>
      {error && <p className="status-error">{error}</p>}
      <div className="form-actions">
        <button
          type="submit"
          className="btn btn-primary"
          disabled={saving || text.length > MAX_BIO_LENGTH}
        >
          {saving ? 'Saving…' : 'Save bio'}
        </button>
      </div>
    </form>
  );
}
