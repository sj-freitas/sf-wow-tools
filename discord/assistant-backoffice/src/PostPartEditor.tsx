import { useEffect, useState } from 'react';
import { fetchPostAttachments, postImageUrl, uploadPostImage } from './api';
import { DiscordMarkdown, type MentionNames } from './DiscordMarkdown';
import {
  ATTACHMENT_TYPES,
  MAX_DELAY_SECONDS,
  MAX_IMAGE_MB,
  MAX_IMAGES_PER_PART,
  MAX_PART_LENGTH,
  type PartDraft,
} from './postParts';
import { showToast } from './toast';
import type { PostAttachment } from './types';

interface Props {
  guildId: string;
  index: number;
  count: number;
  draft: PartDraft;
  names: MentionNames;
  /** Loads the names shown for mentions in previews (called when a preview opens). */
  onPreview: () => void;
  onChange: (patch: Partial<PartDraft>) => void;
  onMove: (direction: -1 | 1) => void;
  canMove: (direction: -1 | 1) => boolean;
  onRemove: () => void;
}

/** What the listed uploads are (images or files), as they become known. */
function usePostAttachments(guildId: string, ids: readonly string[]): Map<string, PostAttachment> {
  const [known, setKnown] = useState(new Map<string, PostAttachment>());
  const missing = ids.filter((id) => !known.has(id)).join(',');
  useEffect(() => {
    if (!missing) return;
    let current = true;
    fetchPostAttachments(guildId, missing.split(','))
      .then((found) => {
        if (current) {
          setKnown((old) => new Map([...old, ...found.map((a) => [a.id, a] as const)]));
        }
      })
      .catch(() => undefined);
    return () => {
      current = false;
    };
  }, [guildId, missing]);
  return known;
}

const sizeLabel = (bytes: number): string =>
  bytes < 1024 * 1024
    ? `${Math.max(1, Math.round(bytes / 1024))} KB`
    : `${(bytes / 1024 / 1024).toFixed(1)} MB`;

/** A file of a message: its name and size, which download it. */
function FileChip({ guildId, file }: { guildId: string; file: PostAttachment }) {
  return (
    <a className="part-file" href={postImageUrl(guildId, file.id)} download={file.fileName ?? ''}>
      <span className="part-file-name">{file.fileName}</span>
      <span className="muted">{sizeLabel(file.size)}</span>
    </a>
  );
}

/** One message of a post: its text, reactions, link previews, wait, images and files. */
export function PostPartEditor({
  guildId,
  index,
  count,
  draft,
  names,
  onPreview,
  onChange,
  onMove,
  canMove,
  onRemove,
}: Props) {
  // Text and Preview take turns in the same place: a preview opening under the message would push
  // the rest of the form down.
  const [tab, setTab] = useState<'write' | 'preview'>('write');
  const [uploading, setUploading] = useState(false);
  // A file that couldn't be added: a note over the page, not a line pushing the form down.
  const uploadFailed = (message: string) => showToast(message, 8000);
  const rows = index === 0 ? 6 : 4;
  const attachments = usePostAttachments(guildId, draft.imageIds);

  const addImages = (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const room = MAX_IMAGES_PER_PART - draft.imageIds.length;
    const chosen = Array.from(files).slice(0, Math.max(0, room));
    const tooBig = chosen.find((file) => file.size > MAX_IMAGE_MB * 1024 * 1024);
    if (tooBig) {
      uploadFailed(`${tooBig.name} is bigger than ${MAX_IMAGE_MB} MB.`);
      return;
    }
    setUploading(true);
    void Promise.all(chosen.map((file) => uploadPostImage(guildId, file)))
      .then((uploaded) => onChange({ imageIds: [...draft.imageIds, ...uploaded.map((u) => u.id)] }))
      .catch((err: unknown) => uploadFailed(err instanceof Error ? err.message : String(err)))
      .finally(() => setUploading(false));
  };

  return (
    <div className={draft.posted ? 'part-card part-card-posted' : 'part-card'}>
      <div className="part-head">
        <strong>Message {index + 1}</strong>
        {draft.posted && <span className="badge badge-main">In Discord</span>}
        {draft.messageId && <CopyIdButton id={draft.messageId} />}
        <span className="part-tools">
          <button
            type="button"
            className="btn btn-sm"
            title={
              canMove(-1)
                ? 'Move up'
                : draft.posted
                  ? 'Messages already in Discord keep their order'
                  : 'Cannot move above a message that is in Discord'
            }
            disabled={!canMove(-1)}
            onClick={() => onMove(-1)}
            aria-label={`Move message ${index + 1} up`}
          >
            ↑
          </button>
          <button
            type="button"
            className="btn btn-sm"
            title={canMove(1) ? 'Move down' : 'Messages already in Discord keep their order'}
            disabled={!canMove(1)}
            onClick={() => onMove(1)}
            aria-label={`Move message ${index + 1} down`}
          >
            ↓
          </button>
          <button
            type="button"
            className="btn btn-sm btn-danger"
            disabled={count <= 1}
            title={
              count <= 1
                ? 'A post needs at least one message'
                : draft.posted
                  ? 'Removes this message from Discord too'
                  : 'Remove this message'
            }
            onClick={onRemove}
          >
            Remove
          </button>
        </span>
      </div>

      <div className="field task-text">
        <div className="write-tabs" role="tablist">
          {(['write', 'preview'] as const).map((value) => (
            <button
              key={value}
              type="button"
              role="tab"
              aria-selected={tab === value}
              className={tab === value ? 'write-tab write-tab-active' : 'write-tab'}
              onClick={() => {
                if (value === 'preview') onPreview();
                setTab(value);
              }}
            >
              {value === 'write' ? 'Text (Discord markdown)' : 'Preview'}
            </button>
          ))}
          <span
            className={
              draft.content.length > MAX_PART_LENGTH
                ? 'status-error write-tabs-count'
                : 'muted write-tabs-count'
            }
          >
            {draft.content.length}/{MAX_PART_LENGTH}
          </span>
        </div>
        {/* The textarea stays in the form (hidden) while previewing, so "required" still checks it. */}
        <textarea
          value={draft.content}
          onChange={(e) => onChange({ content: e.target.value })}
          rows={rows}
          required
          hidden={tab !== 'write'}
          // Saved while previewing an empty message: back to the text, to see why.
          onInvalid={() => setTab('write')}
          maxLength={MAX_PART_LENGTH + 500}
          aria-label={`Text of message ${index + 1}`}
        />
        {tab === 'preview' && (
          <div className="part-preview" style={{ minHeight: `${rows * 1.1 + 1.4}rem` }}>
            <MessagePreview guildId={guildId} draft={draft} names={names} />
          </div>
        )}
      </div>

      <div className="part-images">
        {draft.imageIds.map((id) => (
          <span
            key={id}
            className={attachments.get(id)?.fileName ? 'part-attachment' : 'part-image'}
          >
            {attachments.get(id)?.fileName ? (
              <FileChip guildId={guildId} file={attachments.get(id)!} />
            ) : (
              attachments.has(id) && <img src={postImageUrl(guildId, id)} alt="" />
            )}
            <button
              type="button"
              className="part-image-remove"
              title="Remove this attachment"
              aria-label="Remove attachment"
              onClick={() => onChange({ imageIds: draft.imageIds.filter((other) => other !== id) })}
            >
              ✕
            </button>
          </span>
        ))}
        {draft.imageIds.length < MAX_IMAGES_PER_PART && (
          <label className={uploading ? 'btn btn-sm disabled' : 'btn btn-sm'}>
            {uploading ? 'Uploading…' : draft.imageIds.length === 0 ? 'Add files' : 'Add another'}
            <input
              type="file"
              hidden
              multiple
              accept={ATTACHMENT_TYPES}
              disabled={uploading}
              onChange={(e) => {
                addImages(e.target.files);
                e.target.value = '';
              }}
            />
          </label>
        )}
        <span className="muted">
          Up to {MAX_IMAGES_PER_PART} images or files (PDF, TXT, CSV, ZIP, audio), {MAX_IMAGE_MB} MB
          each, shown under the text.
        </span>
      </div>

      <div className="form-grid part-options">
        <label className="field field-span-2">
          Reactions to add (optional)
          <input
            value={draft.reactions}
            placeholder="👍 👎"
            onChange={(e) => onChange({ reactions: e.target.value })}
          />
        </label>
        <div className="field">
          Embedded links
          <label className="field-toggle">
            <input
              type="checkbox"
              checked={draft.embedLinks}
              onChange={(e) => onChange({ embedLinks: e.target.checked })}
            />
            Show embedded links
          </label>
        </div>
        {index > 0 && !draft.posted && (
          <label className="field">
            Wait before sending (seconds)
            <input
              type="number"
              min={0}
              max={MAX_DELAY_SECONDS}
              step={1}
              value={draft.delaySeconds}
              onChange={(e) =>
                onChange({
                  delaySeconds: Math.max(
                    0,
                    Math.min(MAX_DELAY_SECONDS, Number(e.target.value) || 0),
                  ),
                })
              }
              title="How long after the previous message this one is sent (0 to 60)"
            />
          </label>
        )}
      </div>
    </div>
  );
}

/** How a message looks: its text, then its images and files. */
export function MessagePreview({
  guildId,
  draft,
  names,
}: {
  guildId: string;
  draft: PartDraft;
  names: MentionNames;
}) {
  const attachments = usePostAttachments(guildId, draft.imageIds);
  return (
    <div className="message-preview">
      <DiscordMarkdown text={draft.content} names={names} />
      {draft.imageIds.length > 0 && (
        <div className="message-preview-images">
          {draft.imageIds.map((id) => {
            const attachment = attachments.get(id);
            if (!attachment) return null;
            return attachment.fileName ? (
              <FileChip key={id} guildId={guildId} file={attachment} />
            ) : (
              <img key={id} src={postImageUrl(guildId, id)} alt="" />
            );
          })}
        </div>
      )}
      {/https?:\/\//.test(draft.content) && (
        <p className="muted">
          {draft.embedLinks
            ? 'Discord will also show a preview card under the links (not shown here).'
            : 'Link previews are off: Discord will show the links as plain text only.'}
        </p>
      )}
    </div>
  );
}

/** Copies the message's Discord id, for `sourcePost=…` in a `{{reactions …}}` tag. */
function CopyIdButton({ id }: { id: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="btn btn-sm"
      title={`Copy this message's Discord id (${id}), to show who reacted to it inside a message's text`}
      onClick={() => {
        void navigator.clipboard
          .writeText(id)
          .then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          })
          .catch(() => window.prompt('Copy the message id:', id));
      }}
    >
      {copied ? '✓ Copied' : 'Copy ID'}
    </button>
  );
}
