import { useEffect, useState } from 'react';
import { CheckCircleIcon, HelpCircleIcon, XCircleIcon } from '../Icons';
import { SkeletonLines } from '../Loading';
import { timeAgo } from '../time';
import { ADDON_URL } from './ImportProfessionsDrawer';
import {
  fetchCharacterAttunements,
  type CharacterAttunements as Attunements,
} from './professionsApi';
import './professions.css';

/**
 * Whether the character is attuned to the raid: attuned, not attuned, or not known -- no one's
 * GuildAssistant Professions has looked at it, which isn't the same as not being attuned. The icon
 * carries the colour, the word is always there, so the cell is the same height either way.
 */
function State({ attuned }: { attuned: boolean | null }) {
  const [tone, icon, said] =
    attuned === true
      ? (['attunement-yes', <CheckCircleIcon key="yes" />, 'Attuned'] as const)
      : attuned === false
        ? (['attunement-no', <XCircleIcon key="no" />, 'Not attuned'] as const)
        : (['attunement-unknown', <HelpCircleIcon key="unknown" />, 'Not known'] as const);
  return (
    <span className="attunement-state">
      <span className={`attunement-icon ${tone}`} aria-hidden="true">
        {icon}
      </span>
      <span>{said}</span>
    </span>
  );
}

/**
 * Which raids a character is attuned to, on its page: a row per raid, from what GuildAssistant
 * Professions recorded in game and the upload carried. Every raid is listed, so "not attuned" and
 * "no one has looked" are told apart.
 */
export function CharacterAttunements({ characterId }: { characterId: string }) {
  const [attunements, setAttunements] = useState<Attunements | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setAttunements(null);
    setError(null);
    fetchCharacterAttunements(characterId)
      .then(setAttunements)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
  }, [characterId]);

  // A failure here mustn't take the professions with it: the section is simply left out.
  if (error) return null;
  return (
    <section className="attunements">
      <h4 className="profession-section-title">Attunements</h4>
      {!attunements ? (
        <SkeletonLines count={2} />
      ) : (
        <>
          <div className="table-wrap attunements-table">
            <table>
              <thead>
                <tr>
                  <th>Raid</th>
                  <th>Attunement</th>
                </tr>
              </thead>
              <tbody>
                {attunements.raids.map((raid) => (
                  <tr key={raid.key}>
                    <td data-label="Raid">{raid.raid}</td>
                    <td data-label="Attunement">
                      <State attuned={raid.attuned} />
                      {raid.recordedAt && (
                        <span className="attunement-when"> · {timeAgo(raid.recordedAt)}</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="muted">
            {attunements.reported
              ? 'Recorded in game by the '
              : 'Nothing recorded yet: install the '}
            <a href={ADDON_URL} target="_blank" rel="noreferrer">
              GuildAssistant Professions addon
            </a>
            {attunements.reported
              ? ' (1.6.0 or later) and uploaded with the professions.'
              : ' (1.6.0 or later) and upload it: your attunements are read as you log in.'}
          </p>
        </>
      )}
    </section>
  );
}
