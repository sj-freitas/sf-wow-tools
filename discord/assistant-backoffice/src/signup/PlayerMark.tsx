import { ClassMark } from '../ClassMark';
import { RoleMark } from '../RoleMark';
import { entryName } from './labels';
import type { Entry } from './signupApi';

/** A signed-up player as in Discord: their role icon, class icon and name. */
export function PlayerMark({
  gameVersion,
  entry,
  bold = false,
}: {
  gameVersion: string;
  entry: Entry;
  bold?: boolean;
}) {
  return (
    <span className="player-mark">
      {entry.role && <RoleMark gameVersion={gameVersion} role={entry.role} />}
      <ClassMark gameVersion={gameVersion} className={entry.characterClass} />
      {bold ? <strong>{entryName(entry)}</strong> : entryName(entry)}
    </span>
  );
}
