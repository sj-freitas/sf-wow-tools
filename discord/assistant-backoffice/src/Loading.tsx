/** A small spinner for a short wait, in place of the plain "Loading…" text. */
export function Spinner({ label = 'Loading…' }: { label?: string }) {
  return (
    <p className="status">
      <span className="spinner" aria-hidden="true" />
      {label}
    </p>
  );
}

/** Same spinner, but inline (no block padding) for a small widget or a spot inside a line of text. */
export function InlineSpinner({
  label = 'Loading…',
  className,
}: {
  label?: string;
  className?: string;
}) {
  return (
    <span className={className}>
      <span className="spinner" aria-hidden="true" />
      {label}
    </span>
  );
}

/** A few gray bars standing in for rows of text, e.g. inside a `.status` block. */
export function SkeletonLines({ count = 3 }: { count?: number }) {
  return (
    <div className="skeleton-lines" aria-hidden="true">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="skeleton-line" />
      ))}
    </div>
  );
}

/** Placeholder rows for a table that is still loading, matching its column count. */
export function SkeletonRows({ columns, rows = 4 }: { columns: number; rows?: number }) {
  return (
    <>
      {Array.from({ length: rows }, (_, row) => (
        <tr key={row} aria-hidden="true">
          {Array.from({ length: columns }, (_, col) => (
            <td key={col}>
              <div className="skeleton-line" />
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}
