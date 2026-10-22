import { useState, type CSSProperties, type ReactNode, type SyntheticEvent } from 'react';

const WIDTH = 288;
const MARGIN = 8;

/**
 * A field's explanation behind a small (?): shown on hover, or on tap/click (again, or leaving it,
 * hides it), so forms aren't cluttered with hint text. Goes next to a field's label, inside its
 * `field-label` span. A span, not a button: inside a <label> a button would take over the label.
 */
export function Help({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  // Placed under the (?) and kept on the screen, whichever side of it the (?) is.
  const [position, setPosition] = useState<CSSProperties>({});
  const place = (e: SyntheticEvent<HTMLElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const width = Math.min(WIDTH, window.innerWidth - 2 * MARGIN);
    const left = Math.max(MARGIN, Math.min(rect.left - MARGIN, window.innerWidth - width - MARGIN));
    setPosition({ top: rect.bottom + 6, left, width });
  };
  return (
    <span
      className={open ? 'help help-open' : 'help'}
      role="button"
      tabIndex={0}
      aria-label="Help"
      aria-expanded={open}
      onMouseEnter={place}
      onFocus={place}
      onClick={(e) => {
        // Not the label's click: that would focus or open its field.
        e.preventDefault();
        place(e);
        setOpen((value) => !value);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          setOpen((value) => !value);
        } else if (e.key === 'Escape') setOpen(false);
      }}
      onBlur={() => setOpen(false)}
    >
      ?
      <span className="help-text" role="tooltip" style={position}>
        {children}
      </span>
    </span>
  );
}
