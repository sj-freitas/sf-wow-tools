import { useEffect, useRef, useState } from 'react';
import { AttributeChip } from './AttributeChip';
import { TagIcon } from './Icons';
import type { GuildAttribute } from './types';

/**
 * A character's guild attributes as a small tag icon with their count; clicking it shows them.
 * Keeps the roster calm when characters have many. Nothing when it has none.
 */
export function AttributesBadge({
  attributes,
  onEdit,
}: {
  attributes: GuildAttribute[];
  /** Officers: change them. */
  onEdit?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      if (root.current && !root.current.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  if (attributes.length === 0) return null;
  const names = attributes.map((attribute) => attribute.name).join(', ');
  return (
    <span className="attributes-badge" ref={root}>
      <button
        type="button"
        className="attributes-badge-button"
        aria-expanded={open}
        aria-label={`Attributes: ${names}`}
        title={names}
        onClick={() => setOpen((current) => !current)}
      >
        <TagIcon />
        {attributes.length}
      </button>
      {open && (
        <span className="attributes-popover" role="dialog" aria-label="Attributes">
          <span className="attribute-chips">
            {attributes.map((attribute) => (
              <AttributeChip key={attribute.id} name={attribute.name} color={attribute.color} />
            ))}
          </span>
          {onEdit && (
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => {
                setOpen(false);
                onEdit();
              }}
            >
              Edit
            </button>
          )}
        </span>
      )}
    </span>
  );
}
