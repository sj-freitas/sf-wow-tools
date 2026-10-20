import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';

export interface RowMenuItem {
  label: ReactNode;
  /** A link (with router state), or an action. */
  to?: string;
  state?: unknown;
  onSelect?: () => void;
  danger?: boolean;
  disabled?: boolean;
}

/**
 * A row's actions behind one "⋯" button, so a table row stays calm on desktop and on a phone.
 * Closes on a pick, a click outside, or Esc.
 */
export function RowMenu({
  label,
  items,
  busy,
}: {
  /** For screen readers: "Actions for Darkshivan". */
  label: string;
  items: RowMenuItem[];
  /** Shown instead of the dots while something runs (e.g. a removal). */
  busy?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);

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

  if (items.length === 0) return null;
  return (
    <div className="row-menu" ref={root}>
      <button
        type="button"
        className="btn btn-sm btn-icon row-menu-button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={label}
        title="Actions"
        disabled={busy !== undefined}
        onClick={() => setOpen((current) => !current)}
      >
        {busy ?? (
          <span aria-hidden="true" className="row-menu-dots">
            ⋯
          </span>
        )}
      </button>
      {open && (
        <div className="dropdown-menu row-menu-list" role="menu">
          {items.map((item, index) => {
            const className = item.danger
              ? 'dropdown-item dropdown-option row-menu-danger'
              : 'dropdown-item dropdown-option';
            return item.to ? (
              <Link
                key={index}
                role="menuitem"
                className={className}
                to={item.to}
                state={item.state}
                onClick={() => setOpen(false)}
              >
                {item.label}
              </Link>
            ) : (
              <button
                key={index}
                type="button"
                role="menuitem"
                className={className}
                disabled={item.disabled}
                onClick={() => {
                  setOpen(false);
                  item.onSelect?.();
                }}
              >
                {item.label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
