import { useState } from 'react';

/** Each role's icon file (`src/game/<version>/role-icons/<name>.png`) and its emoji fallback. */
const ROLE_ICONS: Record<string, { file: string; emoji: string; label: string }> = {
  TANK: { file: 'Tank', emoji: '🛡️', label: 'Tank' },
  HEALER: { file: 'Healer', emoji: '💚', label: 'Healer' },
  MELEE_DPS: { file: 'Melee', emoji: '⚔️', label: 'Melee' },
  RANGED_DPS: { file: 'Ranged', emoji: '🏹', label: 'Ranged' },
  LEADER: { file: 'Leader', emoji: '👑', label: 'Leader' },
};

const iconUrl = (gameVersion: string, file: string): string =>
  `/api/public/games/${encodeURIComponent(gameVersion)}/roles/${file}/icon`;

/**
 * A raid role (or `LEADER`) as its icon from the game config, or its emoji (🛡️ 💚 ⚔️ 🏹 👑) when
 * the version has none — the same as in Discord.
 */
export function RoleMark({ gameVersion, role }: { gameVersion: string; role: string }) {
  const [noIcon, setNoIcon] = useState(false);
  const icon = ROLE_ICONS[role];
  if (!icon) return null;
  if (noIcon) {
    return (
      <span title={icon.label} aria-label={icon.label} role="img">
        {icon.emoji}
      </span>
    );
  }
  return (
    <img
      className="role-icon"
      src={iconUrl(gameVersion, icon.file)}
      alt={icon.label}
      title={icon.label}
      onError={() => setNoIcon(true)}
    />
  );
}
