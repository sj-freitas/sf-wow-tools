import { useState } from 'react';

/** Served by the API from `src/game/<version>/raid-markers/<Marker>.png`. */
const markerUrl = (gameVersion: string, marker: string): string =>
  `/api/public/games/${encodeURIComponent(gameVersion)}/markers/${encodeURIComponent(marker)}/icon`;

/** A raid marker (`Skull`, …) as its icon, or "[Skull]" when it has none (as in Discord). */
export function MarkerMark({ gameVersion, label }: { gameVersion: string; label: string }) {
  const [noIcon, setNoIcon] = useState(false);
  if (noIcon) return <>[{label}]</>;
  return (
    <img
      className="marker-icon"
      src={markerUrl(gameVersion, label)}
      alt={label}
      title={label}
      onError={() => setNoIcon(true)}
    />
  );
}
