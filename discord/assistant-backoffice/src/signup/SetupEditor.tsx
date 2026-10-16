import { useEffect, useMemo, useState, type DragEvent } from 'react';
import type { Guild } from '../types';
import { useConfirm } from '../useConfirm';
import { InlineSpinner } from '../Loading';
import { ClassMark } from '../ClassMark';
import { MultiSelect } from '../MultiSelect';
import { RoleMark } from '../RoleMark';
import { ROLE_CATEGORIES, STATUS_EMOJI, entryName, errorText } from './labels';
import {
  postSetup,
  removeSetupPost,
  saveSetup,
  type Entry,
  type Placement,
  type SignupEvent,
} from './signupApi';

/** entry id -> its place; people not in it are on the bench. */
type Places = Record<string, { group: number; slot: number }>;

const placesOf = (entries: Entry[]): Places =>
  Object.fromEntries(
    entries
      .filter((entry) => entry.groupNumber !== null && entry.groupSlot !== null)
      .map((entry) => [entry.id, { group: entry.groupNumber!, slot: entry.groupSlot! }]),
  );

const ROLE_ORDER = ROLE_CATEGORIES.map((category) => category.role);
const benchOrder = (a: Entry, b: Entry) =>
  (a.role ? ROLE_ORDER.indexOf(a.role) : 9) - (b.role ? ROLE_ORDER.indexOf(b.role) : 9) ||
  entryName(a).localeCompare(entryName(b));

/**
 * The raid setup: drag signed-up characters into groups 1-8 (five places each); whoever isn't in
 * a group is on the bench. On a phone, tap someone and then tap a place. Saving updates the posted
 * setup in Discord too.
 */
export function SetupEditor({
  guild,
  event,
  onChanged,
}: {
  guild: Guild;
  event: SignupEvent;
  onChanged: () => Promise<unknown>;
}) {
  // Absent people can't be placed; everyone else who answered can.
  const people = useMemo(
    () => event.entries.filter((entry) => entry.status !== 'ABSENT'),
    [event.entries],
  );
  const [places, setPlaces] = useState<Places>(() => placesOf(people));
  const [dirty, setDirty] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [mention, setMention] = useState(event.setupMentions);
  // Raid roles, saved with the setup: who leads (its creator unless changed), who is master
  // looter, and who has assist (Officers get it when they sign up).
  const [leader, setLeader] = useState(event.leaderDiscordUserId);
  const [masterLooter, setMasterLooter] = useState(event.masterLooterDiscordUserId);
  const [assists, setAssists] = useState<string[]>(() =>
    event.entries.filter((entry) => entry.assist).map((entry) => entry.id),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { confirm, dialog } = useConfirm();
  // How many groups and places, from the event's kind: 8 groups of 5 for a raid, one unlimited
  // "Invited" list for a members event.
  const { groupCount, groupSize, groupName } = event.layout;
  const groupTitle = (group: number) => (groupCount === 1 ? groupName : `${groupName} ${group}`);
  const groups = Array.from({ length: groupCount }, (_, i) => i + 1);

  // Someone signed up or changed meanwhile: take the saved setup, or (with unsaved changes) keep
  // ours, dropping anyone who left or became absent.
  useEffect(() => {
    if (!dirty) {
      setPlaces(placesOf(people));
      setLeader(event.leaderDiscordUserId);
      setMasterLooter(event.masterLooterDiscordUserId);
      setAssists(event.entries.filter((entry) => entry.assist).map((entry) => entry.id));
      return;
    }
    const ids = new Set(people.map((entry) => entry.id));
    setPlaces((current) =>
      Object.fromEntries(Object.entries(current).filter(([id]) => ids.has(id))),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [people]);

  const byId = new Map(people.map((entry) => [entry.id, entry]));
  const at = (group: number, slot: number) =>
    Object.entries(places).find(([, p]) => p.group === group && p.slot === slot)?.[0] ?? null;
  const bench = people.filter((entry) => !places[entry.id]).sort(benchOrder);

  const change = (update: (current: Places) => Places) => {
    setPlaces(update);
    setDirty(true);
    setSelected(null);
  };

  /** Puts someone in a place; whoever was there takes their old place (or the bench). */
  const moveTo = (entryId: string, group: number, slot: number) =>
    change((current) => {
      const next = { ...current };
      const from = next[entryId];
      const occupant = Object.entries(next).find(
        ([id, p]) => id !== entryId && p.group === group && p.slot === slot,
      )?.[0];
      next[entryId] = { group, slot };
      if (occupant) {
        if (from) next[occupant] = from;
        else delete next[occupant];
      }
      return next;
    });

  const toBench = (entryId: string) =>
    change((current) => {
      const next = { ...current };
      delete next[entryId];
      return next;
    });

  /** Fills the empty places, in group order, from the bench (tanks and healers first). */
  const fill = () =>
    change((current) => {
      const next = { ...current };
      const waiting = [...bench];
      for (let group = 1; group <= groupCount; group++) {
        // An unlimited group takes everyone left (the loop ends when the bench is empty).
        for (let slot = 0; slot < (groupSize ?? Infinity); slot++) {
          const taken = Object.values(next).some((p) => p.group === group && p.slot === slot);
          const person = waiting.shift();
          if (!person) return next;
          if (taken) waiting.unshift(person);
          else next[person.id] = { group, slot };
        }
      }
      return next;
    });

  const run = (action: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    action()
      .then(onChanged)
      .catch((err: unknown) => setError(errorText(err)))
      .finally(() => setBusy(false));
  };

  const placements = (): Placement[] =>
    people.map((entry) => ({
      entryId: entry.id,
      group: places[entry.id]?.group ?? null,
      slot: places[entry.id]?.slot ?? null,
    }));
  const save = () =>
    saveSetup(guild.id, event.id, placements(), {
      leaderDiscordUserId: leader,
      // Someone who left or became absent can't stay master looter.
      masterLooterDiscordUserId:
        masterLooter && people.some((p) => p.discordUserId === masterLooter) ? masterLooter : null,
      assistEntryIds: assists.filter((id) => byId.has(id)),
    }).then(() => setDirty(false));
  const changeRoles = (update: () => void) => {
    update();
    setDirty(true);
  };

  const onDrop = (e: DragEvent, target: { group: number; slot: number } | 'bench') => {
    e.preventDefault();
    const id = e.dataTransfer.getData('text/plain');
    if (!byId.has(id)) return;
    if (target === 'bench') toBench(id);
    else moveTo(id, target.group, target.slot);
  };

  const chip = (entry: Entry) => (
    <button
      key={entry.id}
      type="button"
      draggable
      onDragStart={(e) => e.dataTransfer.setData('text/plain', entry.id)}
      onClick={(e) => {
        e.stopPropagation();
        setSelected((current) => (current === entry.id ? null : entry.id));
      }}
      className={selected === entry.id ? 'setup-chip setup-chip-selected' : 'setup-chip'}
      title={entry.note ?? undefined}
    >
      {entry.role && <RoleMark gameVersion={guild.gameVersion} role={entry.role} />}
      <ClassMark gameVersion={guild.gameVersion} className={entry.characterClass} />
      <span className="setup-chip-name">{entryName(entry)}</span>
      {entry.discordUserId === leader ? (
        <RoleMark gameVersion={guild.gameVersion} role="LEADER" />
      ) : (
        assists.includes(entry.id) && <RoleMark gameVersion={guild.gameVersion} role="ASSIST" />
      )}
      {entry.discordUserId === masterLooter && (
        <RoleMark gameVersion={guild.gameVersion} role="MASTER_LOOTER" />
      )}
      {entry.status !== 'AVAILABLE' && (
        <span title={entry.status.toLowerCase()}>{STATUS_EMOJI[entry.status]}</span>
      )}
    </button>
  );

  return (
    <div className="tasks">
      {dialog}
      <div className="tasks-head">
        <span className="muted">
          Drag people in from the bench, or tap someone and then a place. Saving also updates the{' '}
          {event.layout.setupTitle.toLowerCase()} posted in Discord.
        </span>
        <div className="settings-actions">
          <button type="button" className="btn btn-sm" onClick={fill} disabled={bench.length === 0}>
            Fill from the bench
          </button>
          <button
            type="button"
            className="btn btn-sm"
            onClick={() => change(() => ({}))}
            disabled={Object.keys(places).length === 0}
          >
            {groupCount === 1 ? 'Clear' : 'Clear groups'}
          </button>
          <button
            type="button"
            className="btn btn-sm btn-primary"
            disabled={!dirty || busy}
            onClick={() => run(save)}
          >
            {busy ? <InlineSpinner label="Saving…" /> : dirty ? 'Save setup' : 'Saved'}
          </button>
        </div>
      </div>
      {error && <p className="status-error">{error}</p>}

      <div className="task-card setup-roles">
        <strong>Lead and loot</strong>
        <div className="form-grid">
          <label className="field">
            <span>
              <RoleMark gameVersion={guild.gameVersion} role="LEADER" /> Leader
            </span>
            <select value={leader} onChange={(e) => changeRoles(() => setLeader(e.target.value))}>
              {!people.some((p) => p.discordUserId === leader) && (
                <option value={leader}>{event.createdByName} (not signed up)</option>
              )}
              {people.map((entry) => (
                <option key={entry.id} value={entry.discordUserId}>
                  {entryName(entry)}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>
              <RoleMark gameVersion={guild.gameVersion} role="MASTER_LOOTER" /> Master looter
            </span>
            <select
              value={masterLooter ?? ''}
              onChange={(e) => changeRoles(() => setMasterLooter(e.target.value || null))}
            >
              <option value="">None</option>
              {people.map((entry) => (
                <option key={entry.id} value={entry.discordUserId}>
                  {entryName(entry)}
                </option>
              ))}
            </select>
          </label>
          <div className="field">
            <span>
              <RoleMark gameVersion={guild.gameVersion} role="ASSIST" /> Assist
            </span>
            <MultiSelect
              options={people.map((entry) => ({ value: entry.id, label: entryName(entry) }))}
              value={assists.filter((id) => byId.has(id))}
              onChange={(value) => changeRoles(() => setAssists(value))}
              placeholder="Nobody"
            />
          </div>
        </div>
        <small className="muted">
          Shown after their names in the setup. Officers get assist when they sign up; saving the
          setup saves these too.
        </small>
      </div>

      <div className="setup-groups">
        {groups.map((group) => {
          // An unlimited group shows who is in it plus one empty place to drop the next person.
          const used = Object.values(places).filter((p) => p.group === group);
          const slots =
            groupSize ?? (used.length === 0 ? 0 : Math.max(...used.map((p) => p.slot)) + 1) + 1;
          return (
            <section
              key={group}
              className={groupSize === null ? 'setup-group setup-group-open' : 'setup-group'}
            >
              {/* "Group 1:", as in the post ("Invited (7):" for one unlimited group). */}
              <h4>
                {groupTitle(group)}
                {groupSize === null && <span className="muted"> ({used.length})</span>}:
              </h4>
              {Array.from({ length: slots }, (_, slot) => {
                const id = at(group, slot);
                const entry = id ? byId.get(id) : undefined;
                return (
                  <div
                    key={slot}
                    className={selected && !entry ? 'setup-slot setup-slot-target' : 'setup-slot'}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => onDrop(e, { group, slot })}
                    onClick={() => selected && moveTo(selected, group, slot)}
                  >
                    {entry ? (
                      chip(entry)
                    ) : (
                      <span className="setup-empty">
                        {groupSize === null ? 'Drop here' : 'Empty'}
                      </span>
                    )}
                  </div>
                );
              })}
            </section>
          );
        })}
      </div>

      <section
        className={selected && places[selected] ? 'setup-bench setup-slot-target' : 'setup-bench'}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => onDrop(e, 'bench')}
        onClick={() => selected && places[selected] && toBench(selected)}
      >
        <h4>
          Bench <span className="muted">({bench.length})</span>
        </h4>
        {bench.length === 0 ? (
          <p className="muted">
            {groupCount === 1
              ? `Everyone who signed up is in ${groupName}.`
              : 'Everyone who signed up is in a group.'}
          </p>
        ) : (
          <div className="setup-bench-list">{bench.map(chip)}</div>
        )}
      </section>

      <div className="task-card">
        <strong>In Discord</strong>
        <p className="muted">
          The {event.layout.setupTitle.toLowerCase()} list is posted as its own message, replying to
          the event’s post.
          {event.setupPostUrl && (
            <>
              {' '}
              <a href={event.setupPostUrl} target="_blank" rel="noreferrer">
                Open the posted setup
              </a>
            </>
          )}
        </p>
        <label className="field-toggle">
          <input type="checkbox" checked={mention} onChange={(e) => setMention(e.target.checked)} />
          {groupCount === 1
            ? `Mention (ping) everyone in ${groupName}`
            : 'Mention (ping) the players in groups'}
        </label>
        <div className="settings-actions">
          <button
            type="button"
            className="btn btn-primary"
            disabled={busy || event.publishAt !== null}
            title={event.publishAt ? 'The event isn’t posted yet: post it first.' : undefined}
            onClick={() =>
              run(async () => {
                if (dirty) await save();
                await postSetup(guild.id, event.id, mention);
              })
            }
          >
            {event.setupPostUrl
              ? 'Save and update the post'
              : `Post the ${event.layout.setupTitle.toLowerCase()} list`}
          </button>
          {event.setupPostUrl && (
            <button
              type="button"
              className="btn btn-danger"
              disabled={busy}
              onClick={() =>
                void confirm({
                  title: `Remove the ${event.layout.setupTitle.toLowerCase()} list from Discord?`,
                  message: 'The message is deleted. It stays here and can be posted again.',
                  confirmLabel: 'Remove',
                  danger: true,
                }).then((ok) => ok && run(() => removeSetupPost(guild.id, event.id)))
              }
            >
              Remove from Discord
            </button>
          )}
        </div>
        {event.setupPostUrl && event.setupMentions !== mention && (
          <p className="muted">
            Mentions only ping when a message is first posted; to ping now, remove the setup and
            post it again.
          </p>
        )}
      </div>
    </div>
  );
}
