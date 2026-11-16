import { useCallback, useEffect, useMemo, useState } from 'react';
import { fetchLiveTagsData, previewLiveTags } from './api';
import { DiscordMarkdown, type MentionNames } from './DiscordMarkdown';
import { Drawer } from './Drawer';
import { AlertTriangleIcon, TagIcon } from './Icons';
import { InlineSpinner } from './Loading';
import { MAX_PART_LENGTH } from './postParts';
import type { LiveTagsData, LiveTagsPreview as Preview } from './types';

/** What the box starts with when the post has no tag yet. */
const STARTER =
  '{{roster show="roster.filter(c => c.attributes.includes(\'Main\')).map(c => c.name)"}}';

/** A click puts one of these in the box and fills it in. */
const EXAMPLES: { tag: string; what: string }[] = [
  { tag: '{{roster show="roster.length"}}', what: 'How many characters the guild has' },
  {
    tag: '{{roster show="roster.filter(c => c.attributes.includes(\'Main\')).map(c => `${c.classIcon} ${c.name}`)"}}',
    what: 'Every main, with its class icon',
  },
  {
    tag: "{{roster show=\"roster.filter(c => c.discordUser.roles.includes('Officer') && c.attributes.includes('Main')).map(c => ` - ${c.discordUser.tag} — ${c.name}`).join('\\n')\"}}",
    what: 'One line per officer: a mention and their main',
  },
  {
    tag: '{{reactions emoji=👍 show="`${reactions.length} signed up: ${reactions.map(r => r.tag)}`"}}',
    what: 'How many reacted, and who',
  },
];

/**
 * "Try the tags": a drawer that fills a message's tags in as a post would, so an expression can be
 * written and seen before the post goes out. Over the form, like the help, so nothing is pushed
 * down.
 */
export function LiveTagsPreview({
  guildId,
  texts,
  names,
  onOpen,
}: {
  guildId: string;
  /** The messages of the post being edited: the first one with a tag is what the box starts on. */
  texts: string[];
  /** The names the form has loaded, so a mention reads as a name; null when it has none yet. */
  names: MentionNames | null;
  /** Called before it opens, for the form to load the names mentions are shown with. */
  onOpen: () => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        className="syntax-help-button"
        title="Fill the tags in from your own roster, without posting"
        onClick={() => {
          onOpen();
          setOpen(true);
        }}
      >
        <TagIcon /> Try the tags
      </button>
      {open && (
        <Drawer title="Try the tags" onClose={() => setOpen(false)}>
          <TryTags guildId={guildId} texts={texts} names={names} />
        </Drawer>
      )}
    </>
  );
}

function TryTags({
  guildId,
  texts,
  names,
}: {
  guildId: string;
  texts: string[];
  names: MentionNames | null;
}) {
  const initial = useMemo(() => texts.find((text) => text.includes('{{')) ?? STARTER, [texts]);
  const [text, setText] = useState(initial);
  const [data, setData] = useState<LiveTagsData | null>(null);
  const [dataError, setDataError] = useState<string | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const run = useCallback(
    async (what: string) => {
      setBusy(true);
      setFailed(null);
      try {
        setPreview(await previewLiveTags(guildId, what));
      } catch (error) {
        setFailed(error instanceof Error ? error.message : 'Could not fill the tags in.');
      } finally {
        setBusy(false);
      }
    },
    [guildId],
  );

  useEffect(() => {
    let alive = true;
    void fetchLiveTagsData(guildId)
      .then((loaded) => alive && setData(loaded))
      .catch((error: unknown) => {
        if (alive) {
          setDataError(error instanceof Error ? error.message : 'Could not read the roster.');
        }
      });
    return () => {
      alive = false;
    };
  }, [guildId]);

  // Opened on a text that already has a tag: show what it writes without being asked.
  useEffect(() => {
    if (initial.includes('{{')) void run(initial);
  }, [initial, run]);

  /** The sample people are not in the guild, so their mentions need their names here. */
  const mentions: MentionNames = useMemo(() => {
    const users = new Map(names?.users ?? []);
    for (const person of data?.sampleReactions ?? []) users.set(person.id, person.displayName);
    return { users, roles: new Map(names?.roles ?? []), channels: new Map(names?.channels ?? []) };
  }, [names, data]);

  const problem = failed ?? preview?.error ?? null;
  const rendered = preview?.text ?? null;

  return (
    <div className="syntax-help live-tags-try">
      <p>
        The text is filled in the way the post would be: <code>{'{{roster …}}'}</code> from your
        guild's own roster, <code>{'{{reactions …}}'}</code> from made-up people. Nothing is saved
        or posted.
      </p>
      <textarea
        className="live-tags-text"
        value={text}
        onChange={(event) => setText(event.target.value)}
        rows={5}
        spellCheck={false}
        maxLength={MAX_PART_LENGTH + 500}
        aria-label="Text with tags to try"
      />
      <div className="live-tags-actions">
        <button
          type="button"
          className="btn btn-sm live-tags-run"
          onClick={() => void run(text)}
          disabled={busy}
        >
          {busy ? <InlineSpinner label="Show what it writes" /> : 'Show what it writes'}
        </button>
      </div>

      {/* The result keeps its place while a new one is being filled in, so nothing jumps. */}
      <div className="live-tags-result" aria-live="polite">
        {problem !== null ? (
          <p className="live-tags-error">
            <AlertTriangleIcon />
            <span>{problem}</span>
          </p>
        ) : rendered !== null ? (
          <DiscordMarkdown text={rendered} names={mentions} />
        ) : (
          <p className="muted">Nothing to show yet.</p>
        )}
      </div>

      {/* Both lines are always here, whatever the text uses: the one in use is the brighter one. */}
      <div className="live-tags-notes">
        <p className={preview?.usedRoster ? undefined : 'muted'}>
          <strong>Roster:</strong> your guild's own
          {data ? `, ${data.rosterCount} characters` : ''}.
        </p>
        <p className={preview?.usedSampleReactions ? undefined : 'muted'}>
          <strong>Reactions:</strong> {data ? `${data.sampleReactions.length} ` : ''}made-up people.
          Real reactions are never read: the post they belong to usually has not been sent yet.
        </p>
      </div>

      <h5>Examples</h5>
      <ul className="live-tags-examples">
        {EXAMPLES.map((example) => (
          <li key={example.tag}>
            <button
              type="button"
              className="live-tags-example"
              onClick={() => {
                setText(example.tag);
                void run(example.tag);
              }}
            >
              <code>{example.tag}</code>
              <span className="muted">{example.what}</span>
            </button>
          </li>
        ))}
      </ul>

      <div className="live-tags-data">
        {dataError !== null ? (
          <p className="live-tags-error">
            <AlertTriangleIcon />
            <span>{dataError}</span>
          </p>
        ) : data === null ? (
          <p className="muted">
            <InlineSpinner label="Reading your roster…" />
          </p>
        ) : (
          <RosterData data={data} />
        )}
      </div>
    </div>
  );
}

function RosterData({ data }: { data: LiveTagsData }) {
  return (
    <>
      <h5>What your tags can match</h5>
      <div className="live-tags-vocab">
        <span className="field-label">Labels on the roster</span>
        <Chips names={data.attributes} empty="No labels have been given out yet." />
      </div>
      <div className="live-tags-vocab">
        <span className="field-label">Discord roles of the players</span>
        <Chips names={data.discordRoles} empty="Nobody on the roster holds a Discord role." />
      </div>
      <p className="muted">
        Spelled exactly as above: <code>attributes.includes('…')</code> and{' '}
        <code>discordUser.roles.includes('…')</code> match nothing otherwise, and saving the post
        still accepts it.
      </p>

      {data.roster.length > 0 && (
        <>
          <h5>One character, as an expression sees it</h5>
          <pre className="md-code">{JSON.stringify(data.roster[0], null, 2)}</pre>
        </>
      )}

      <h5>The made-up people a reactions tag sees</h5>
      <pre className="md-code">
        {JSON.stringify(
          data.sampleReactions.map((person) => ({
            name: person.name,
            characters: person.characters.map((character) => character.name),
          })),
          null,
          2,
        )}
      </pre>
    </>
  );
}

function Chips({ names, empty }: { names: string[]; empty: string }) {
  if (names.length === 0) return <span className="muted">{empty}</span>;
  return (
    <span className="live-tags-chips">
      {names.map((name) => (
        <code key={name} className="live-tags-chip">
          {name}
        </code>
      ))}
    </span>
  );
}
