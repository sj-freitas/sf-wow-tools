import { useEffect, useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import { request } from './api';
import { AlertTriangleIcon, CheckCircleIcon, XCircleIcon } from './Icons';
import { Spinner } from './Loading';

/** What "Verify with Battle.net" found (the API's BattleNetResultDto). */
interface BattleNetResult {
  character: { name: string; pagePath: string };
  /** The character's server ("EU · Forever · RP"). */
  server: string;
  /** Where the account's characters were read ("EU · Forever"). */
  account: string;
  battleTag: string | null;
  characters: {
    /** In full, with its last name. */
    name: string;
    level: number | null;
    class: string | null;
    race: string | null;
    faction: string | null;
    /** Its server's rule set, when Battle.net says ("Roleplay"). */
    server: string | null;
  }[];
  /** The character is on the account. */
  found: boolean;
  /** Its server's rule set in the armory; null when the armory doesn't have it. */
  armoryServer: string | null;
  /** That rule set is its server's here. */
  sameServer: boolean;
  /** Both passed: the character is now verified (only its player edits or moves it). */
  verified: boolean;
  /** It was someone else's (or no one's) and is now the viewer's. */
  moved: boolean;
  error: string | null;
}

type Tone = 'verified' | 'unconfirmed' | 'not-theirs';

/** Each verdict's icon; its colour is the verdict's (`.battlenet-verdict-<tone>`). */
const TONE_ICONS: Record<Tone, ReactNode> = {
  verified: <CheckCircleIcon />,
  unconfirmed: <AlertTriangleIcon />,
  'not-theirs': <XCircleIcon />,
};

/** Whether the character is theirs, on the server it says, and so verified, in a sentence. */
function verdict(result: BattleNetResult): { tone: Tone; text: string } {
  const { name } = result.character;
  if (!result.found) {
    return { tone: 'not-theirs', text: `${name} isn’t one of them, so it wasn’t verified.` };
  }
  if (result.armoryServer === null) {
    return {
      tone: 'unconfirmed',
      text: `${name} is one of them, but the armory doesn’t have it yet, so its server can’t be confirmed and it wasn’t verified. Try again once the armory has it.`,
    };
  }
  if (!result.verified) {
    return {
      tone: 'unconfirmed',
      text: `${name} is one of them, but the armory has it on ${result.armoryServer}, not ${result.server}, so it wasn’t verified.`,
    };
  }
  return {
    tone: 'verified',
    text:
      `${name} is yours, on ${result.server} (${result.armoryServer} in the armory): it’s now ` +
      `Battle.net verified, so only you can edit or move it.` +
      (result.moved ? ' It’s now one of your characters here, too.' : ''),
  };
}

/** The verdict, after its icon in its colour. */
function Verdict({ result }: { result: BattleNetResult }) {
  const { tone, text } = verdict(result);
  return (
    <p className={`battlenet-verdict battlenet-verdict-${tone}`}>
      {TONE_ICONS[tone]}
      <span>{text}</span>
    </p>
  );
}

/**
 * `/battlenet/:id`: where Battle.net's login comes back to. Shows the account's characters in the
 * character's version and region ("EU · Forever"), whether the character is one of them, and
 * whether the armory has it on its server ("EU · Forever · RP"). When both, the API has marked it
 * verified (and moved it to the viewer, if it wasn't theirs).
 */
export function BattleNetResultPage() {
  const { id = '' } = useParams();
  const [result, setResult] = useState<BattleNetResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    request<BattleNetResult>('GET', `/api/battlenet/results/${encodeURIComponent(id)}`)
      .then(setResult)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
  }, [id]);

  if (error) return <p className="status-error card-body">{error}</p>;
  if (!result) return <Spinner />;
  return (
    <div className="tasks">
      <Link className="back-link" to={result.character.pagePath}>
        ← {result.character.name}
      </Link>
      <h2>Battle.net check: {result.character.name}</h2>
      {result.error ? (
        <p className="status-error">{result.error}</p>
      ) : (
        <>
          <p className="muted">
            {result.battleTag
              ? `Battle.net account ${result.battleTag}`
              : 'Your Battle.net account'}{' '}
            has {result.characters.length} character{result.characters.length === 1 ? '' : 's'} on{' '}
            {result.account}.
          </p>
          <Verdict result={result} />
          {result.characters.length > 0 && (
            <ul className="own-characters">
              {result.characters.map((character) => (
                <li key={character.name} className="own-character">
                  <div className="own-character-main">
                    <strong>{character.name}</strong>
                    <div className="muted">
                      {[
                        character.level !== null ? `Level ${character.level}` : null,
                        character.race,
                        character.class,
                        character.faction,
                        character.server,
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
      {!result.verified && <p className="muted">Nothing was changed.</p>}
    </div>
  );
}
