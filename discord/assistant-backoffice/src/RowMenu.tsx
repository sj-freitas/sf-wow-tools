import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';
import { Link } from 'react-router-dom';

export interface RowMenuItem {
  label: ReactNode;
  /** A link (with router state), a page on another site (`href`, new tab), or an action. */
  to?: string;
  href?: string;
  state?: unknown;
  onSelect?: () => void;
  danger?: boolean;
  disabled?: boolean;
}

/** Room the menu needs below its button before it opens upwards instead. */
const MENU_ROOM = 280;

/**
 * A row's actions behind one "⋯" button, so a table row stays calm on desktop and on a phone.
 * Closes on a pick, a click outside, Esc, or scrolling. Placed against the window (fixed), not
 * the row: a table that scrolls sideways (`.table-wrap`) would otherwise cut it off at its bottom.
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
  const [place, setPlace] = useState<CSSProperties>({});
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);

  // Under the button, right edges lined up; above it when the window has no room below.
  useLayoutEffect(() => {
    if (!open || !button.current) return;
    const rect = button.current.getBoundingClientRect();
    const right = window.innerWidth - rect.right;
    setPlace(
      window.innerHeight - rect.bottom < MENU_ROOM && rect.top > MENU_ROOM
        ? { position: 'fixed', top: 'auto', bottom: window.innerHeight - rect.top + 4, right }
        : { position: 'fixed', top: rect.bottom + 4, right },
    );
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      if (root.current && !root.current.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && setOpen(false);
    // Fixed in the window, it would stay put while the page moves: close instead.
    const onMove = (event: Event) => {
      if (root.current && event.target instanceof Node && root.current.contains(event.target))
        return;
      setOpen(false);
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', onKey);
    window.addEventListener('scroll', onMove, true);
    window.addEventListener('resize', onMove);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', onMove, true);
      window.removeEventListener('resize', onMove);
    };
  }, [open]);

  if (items.length === 0) return null;
  return (
    <div className="row-menu" ref={root}>
      <button
        ref={button}
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
        <div className="dropdown-menu row-menu-list" role="menu" style={place}>
          {items.map((item, index) => {
            const className = item.danger
              ? 'dropdown-item dropdown-option row-menu-danger'
              : 'dropdown-item dropdown-option';
            if (item.href) {
              return (
                <a
                  key={index}
                  role="menuitem"
                  className={className}
                  href={item.href}
                  target="_blank"
                  rel="noreferrer"
                  onClick={() => setOpen(false)}
                >
                  {item.label}
                </a>
              );
            }
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
