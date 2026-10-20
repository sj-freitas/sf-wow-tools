import { useEffect, useRef, type ReactNode } from 'react';
import { showToast } from '../toast';
import type { AddonExport } from './addonExport';

/** Colours the export's Lua a little: comments, strings and keys. */
function highlight(text: string): ReactNode[] {
  const parts: ReactNode[] = [];
  const token = /(--[^\n]*)|("(?:[^"\\]|\\.)*")|\b([A-Za-z_]\w*)(?=\s*=)/g;
  let at = 0;
  for (const match of text.matchAll(token)) {
    if (match.index > at) parts.push(text.slice(at, match.index));
    const [whole, comment, string] = match;
    const kind = comment ? 'lua-comment' : string ? 'lua-string' : 'lua-key';
    parts.push(
      <span key={match.index} className={kind}>
        {whole}
      </span>,
    );
    at = match.index + whole.length;
  }
  parts.push(text.slice(at));
  return parts;
}

/**
 * The setup exported for the Raid Sort addon: a preview of the Lua to paste into the addon's
 * Upload Config window, with a copy button and what was left out.
 */
export function AddonExportDialog({
  exported,
  onClose,
}: {
  exported: AddonExport;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    dialog.current?.showModal();
  }, []);

  const copy = () =>
    navigator.clipboard
      .writeText(exported.text)
      .then(() => showToast('Copied: paste it into Raid Sort in game'))
      .catch(() => showToast('Couldn’t copy: select the text and copy it instead'));

  return (
    <dialog
      ref={dialog}
      className="confirm-dialog addon-export-dialog"
      aria-labelledby="addon-export-title"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (event.target === dialog.current) onClose();
      }}
    >
      <h3 id="addon-export-title">Export for Raid Sort</h3>
      <p>
        In game, type <code>/raidsort</code>, press <strong>Upload Config</strong>, paste this in
        and save; then <strong>Sort</strong> puts everyone in their group and hands out the leader,
        assists and master looter.
      </p>
      <pre className="addon-export-code">{highlight(exported.text)}</pre>
      {exported.notes.length > 0 && (
        <ul className="addon-export-notes muted">
          {exported.notes.map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
      )}
      <div className="form-actions">
        <button type="button" className="btn" onClick={onClose}>
          Close
        </button>
        <button type="button" className="btn btn-primary" onClick={() => void copy()} autoFocus>
          Copy
        </button>
      </div>
    </dialog>
  );
}
