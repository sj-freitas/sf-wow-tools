import { useState } from 'react';

/** A Discord user shown by name only; clicking it copies their Discord user id. */
export function CopyableName({ label, id }: { label: string; id: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="copy-name"
      title="Click to copy this user's Discord ID"
      onClick={() => {
        void navigator.clipboard
          .writeText(id)
          .then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          })
          .catch(() => window.prompt('Copy the Discord user ID:', id));
      }}
    >
      <strong>{label}</strong>
      {copied && <span className="muted"> ✓ ID copied</span>}
    </button>
  );
}
