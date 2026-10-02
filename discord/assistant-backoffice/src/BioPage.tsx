import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  bioImageUrl,
  deleteBioImage,
  fetchCharacterBio,
  updateCharacterBio,
  uploadBioImage,
} from './api';
import { guildPath } from './guildPath';
import { Spinner } from './Loading';
import { MarkdownView } from './MarkdownView';
import type { CharacterBio, Guild } from './types';

const MAX_BIO_LENGTH = 4000;
const MAX_BIO_IMAGES = 4;

interface Props {
  guild: Guild;
}

/**
 * `/roster/:characterPath/bio`: a character's bio, written in markdown with a few images — read
 * almost as its own little page. Only its own player (Discord account matching the character) can
 * write it; everyone in the guild can read it once they mark it visible.
 */
export function BioPage({ guild }: Props) {
  const { characterPath } = useParams();
  const [bio, setBio] = useState<CharacterBio | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    if (!characterPath) return;
    setError(null);
    fetchCharacterBio(guild.id, characterPath)
      .then(setBio)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
  }, [guild.id, characterPath]);

  useEffect(load, [load]);

  const back = guildPath(guild, 'roster');

  return (
    <div className="tasks">
      <Link className="back-link" to={back}>
        ← Roster
      </Link>
      {error ? (
        <p className="status-error">{error}</p>
      ) : !bio ? (
        <Spinner />
      ) : (
        <BioBody bio={bio} onSaved={load} />
      )}
    </div>
  );
}

function BioBody({ bio, onSaved }: { bio: CharacterBio; onSaved: () => void }) {
  const [text, setText] = useState(bio.bio ?? '');
  const [visible, setVisible] = useState(bio.bioVisible);
  const [preview, setPreview] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [imageError, setImageError] = useState<string | null>(null);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setSaving(true);
    updateCharacterBio(bio.characterId, { bio: text, bioVisible: visible })
      .then(onSaved)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setSaving(false));
  };

  const addImages = (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setImageError(null);
    const room = MAX_BIO_IMAGES - bio.images.length;
    const chosen = Array.from(files).slice(0, Math.max(0, room));
    setUploading(true);
    Promise.all(chosen.map((file) => uploadBioImage(bio.characterId, file)))
      .then(onSaved)
      .catch((err: unknown) => setImageError(err instanceof Error ? err.message : String(err)))
      .finally(() => setUploading(false));
  };

  const removeImage = (imageId: string) => {
    setImageError(null);
    deleteBioImage(bio.characterId, imageId)
      .then(onSaved)
      .catch((err: unknown) => setImageError(err instanceof Error ? err.message : String(err)));
  };

  return (
    <>
      <div className="tasks-head">
        <div>
          <h2>{bio.name}</h2>
          <div className="card-meta">Character bio</div>
        </div>
      </div>
      {bio.isOwner ? (
        <form onSubmit={submit} className="card-body">
          <div className="field task-text">
            <span className="task-text-head">
              Bio (markdown: headings, **bold**, lists, links, images and more)
              <span className={text.length > MAX_BIO_LENGTH ? 'status-error' : 'muted'}>
                {text.length}/{MAX_BIO_LENGTH}
              </span>
            </span>
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={10}
              placeholder="A bit of background for your character…"
              maxLength={MAX_BIO_LENGTH + 500}
            />
            <div className="task-text-actions">
              <button type="button" className="btn btn-sm" onClick={() => setPreview((p) => !p)}>
                {preview ? 'Hide preview' : 'Preview'}
              </button>
            </div>
            {preview &&
              (text.trim() === '' ? (
                <p className="muted">Nothing to preview yet.</p>
              ) : (
                <div className="bio-page-card">
                  <MarkdownView text={text} />
                </div>
              ))}
          </div>

          <div className="part-images">
            {bio.images.map((image) => (
              <span key={image.id} className="part-image">
                <img src={bioImageUrl(image.id)} alt="" />
                <button
                  type="button"
                  className="part-image-remove"
                  title="Remove this image"
                  aria-label="Remove image"
                  onClick={() => removeImage(image.id)}
                >
                  ✕
                </button>
              </span>
            ))}
            {bio.images.length < MAX_BIO_IMAGES && (
              <label className={uploading ? 'btn btn-sm disabled' : 'btn btn-sm'}>
                {uploading ? 'Uploading…' : bio.images.length === 0 ? 'Add images' : 'Add another'}
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
            <span className="muted">
              Up to {MAX_BIO_IMAGES} images, shown at the top of the page.
            </span>
          </div>
          {imageError && <p className="status-error">{imageError}</p>}

          <label className="field-toggle">
            <input
              type="checkbox"
              checked={visible}
              onChange={(e) => setVisible(e.target.checked)}
            />
            Visible to everyone in the guild
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
      ) : bio.bio ? (
        <div className="bio-page-card">
          {bio.images.length > 0 && (
            <div className="bio-gallery">
              {bio.images.map((image) => (
                <img key={image.id} src={bioImageUrl(image.id)} alt="" />
              ))}
            </div>
          )}
          <MarkdownView text={bio.bio} />
        </div>
      ) : (
        <p className="empty">
          {bio.bioVisible ? 'No bio written yet.' : "This character's bio is private."}
        </p>
      )}
    </>
  );
}
