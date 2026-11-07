import type { MouseEvent } from 'react';
import { showToast } from './toast';

/**
 * A text kept to one line, cut short with … when it doesn't fit: the whole text is its tooltip,
 * and a tap or a click shows it as a note at the bottom of the screen (nothing hover-only, and
 * nothing around it moves). `inline` for a name inside a line of text; otherwise a block as wide
 * as its container. The click stays here: reading it doesn't also open the row it is in.
 */
export function OneLine({
  text,
  className,
  inline = false,
  ms = 8000,
}: {
  text: string;
  className?: string;
  inline?: boolean;
  ms?: number;
}) {
  return (
    <button
      type="button"
      className={['one-line', inline && 'one-line-inline', className].filter(Boolean).join(' ')}
      title={text}
      onClick={(event: MouseEvent) => {
        event.stopPropagation();
        showToast(text, ms);
      }}
    >
      {text}
    </button>
  );
}

/**
 * A form's error after a save: one line kept under its buttons whether or not there is one, so it
 * pushes nothing when it appears. A long one is cut short; a tap shows all of it.
 */
export function FormStatus({ error }: { error: string | null }) {
  return (
    <p className="form-status" role="status">
      {error && <OneLine text={error} className="status-error" />}
    </p>
  );
}
