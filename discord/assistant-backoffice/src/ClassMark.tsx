import { useState } from 'react';
import { useClassColor } from './classColor';

/** Served by the API from `src/game/<version>/class-icons/<Class>.png`. */
const iconUrl = (gameVersion: string, className: string): string =>
  `/api/public/games/${encodeURIComponent(gameVersion)}/classes/${encodeURIComponent(className)}/icon`;

/**
 * A class, shown as its icon (roster, character page, sign-ups) — or, for a class without one, a dot in its colour (both from the
 * game config, the same as in Discord). Its name is the tooltip.
 */
export function ClassMark({
  gameVersion,
  className,
}: {
  gameVersion: string;
  className: string | null;
}) {
  const colorOf = useClassColor(gameVersion);
  const [noIcon, setNoIcon] = useState(false);
  if (!className) return null;
  if (!noIcon) {
    return (
      <img
        className="class-icon"
        src={iconUrl(gameVersion, className)}
        alt={className}
        title={className}
        onError={() => setNoIcon(true)}
      />
    );
  }
  return (
    <span
      className="class-dot"
      style={{ background: colorOf(className) }}
      title={className}
      aria-label={className}
      role="img"
    />
  );
}
