import { useEffect, useMemo, useRef, useState, type DragEvent, type ReactNode } from 'react';
import type { Guild } from '../types';
import { useConfirm } from '../useConfirm';
import { InlineSpinner } from '../Loading';
import { ClassMark } from '../ClassMark';
import { MultiSelect } from '../MultiSelect';
import { RoleMark } from '../RoleMark';
import { ROLE_CATEGORIES, STATUS_EMOJI, entryName, errorText, formatEventTime } from './labels';
import { toAddonSetup, type AddonExport } from './addonExport';
import { AddonExportDialog } from './AddonExportDialog';
import {
  postSetup,
  removeSetupPost,
  saveSetup,
  type Entry,
  type Placement,
  type SignupEvent,
} from './signupApi';
import { Select } from '../Select';

/** How long after the last change the setup is saved (a few quick drags make one save). */
const SAVE_DELAY_MS = 700;

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
 * a group is on the bench. On a phone, tap someone and then tap a place. Every change saves by
 * itself a moment later (no Save button), which also updates the posted setup in Discord, and
 * shows on everyone's open event page: the page reloads on any change to the event (EventPage's
 * realtime subscription), and the editor takes the saved setup whenever it has nothing unsaved.
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
  // Changes not saved yet. `version` counts them: a save is done for good only if nothing changed
  // while it was on its way (else the newer state is saved next).
  const [dirty, setDirty] = useState(false);
  const [version, setVersion] = useState(0);
  const latest = useRef(0);
  const [saving, setSaving] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  // Whose raid-roles menu is open (opened by clicking their name).
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const menu = useRef<HTMLDivElement>(null);
  // The menu closes on a click outside it or Escape; who was selected stays, to move them.
  useEffect(() => {
    if (!menuFor) return;
    const close = (event: MouseEvent) => {
      if (!menu.current?.parentElement?.contains(event.target as Node)) setMenuFor(null);
    };
    const escape = (event: KeyboardEvent) => event.key === 'Escape' && setMenuFor(null);
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', escape);
    };
  }, [menuFor]);
  const [mention, setMention] = useState(event.setupMentions);
  // Raid roles, saved with the setup: who leads (its creator unless changed), who is master
  // looter, and who has assist (Officers get it when they sign up).
  const [leader, setLeader] = useState(event.leaderDiscordUserId);
  const [masterLooter, setMasterLooter] = useState(event.masterLooterDiscordUserId);
  const [assists, setAssists] = useState<string[]>(() =>
    event.entries.filter((entry) => entry.assist).map((entry) => entry.id),
  );
  const [busy, setBusy] = useState(false);
  // The setup as the GuildAssistant RaidSort addon reads it, shown in a dialog to copy.
  const [exported, setExported] = useState<AddonExport | null>(null);
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
  // The leader already leads: never also an assist (an Officer who creates the event gets both).
  const assistIds = assists.filter((id) => byId.has(id) && byId.get(id)!.discordUserId !== leader);
  const chooseLeader = (discordUserId: string) => {
    setLeader(discordUserId);
    setAssists((current) => current.filter((id) => byId.get(id)?.discordUserId !== discordUserId));
  };
  const at = (group: number, slot: number) =>
    Object.entries(places).find(([, p]) => p.group === group && p.slot === slot)?.[0] ?? null;
  const bench = people.filter((entry) => !places[entry.id]).sort(benchOrder);

  const edited = () => {
    setDirty(true);
    setVersion((v) => {
      latest.current = v + 1;
      return v + 1;
    });
  };
  const change = (update: (current: Places) => Places) => {
    setPlaces(update);
    edited();
    setSelected(null);
    setMenuFor(null);
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
  // Members events have no raid roles: only the placements go.
  const save = () => {
    const saved = latest.current;
    return saveSetup(
      guild.id,
      event.id,
      placements(),
      !event.layout.hasRaidRoles
        ? undefined
        : {
            leaderDiscordUserId: leader,
            // Someone who left or became absent can't stay master looter.
            masterLooterDiscordUserId:
              masterLooter && people.some((p) => p.discordUserId === masterLooter)
                ? masterLooter
                : null,
            assistEntryIds: assistIds,
          },
    ).then(() => {
      if (latest.current === saved) setDirty(false);
    });
  };
  // Saves a moment after the last change: dragging several people is one save, not one each.
  useEffect(() => {
    if (version === 0) return;
    const timer = setTimeout(() => {
      setSaving(true);
      setError(null);
      save()
        .catch((err: unknown) => setError(errorText(err)))
        .finally(() => setSaving(false));
    }, SAVE_DELAY_MS);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `save` reads this render's state
  }, [version]);
  // What is on screen, saved or not.
  const exportForAddon = () =>
    setExported(
      toAddonSetup({
        title: event.title,
        when: formatEventTime(event.startsAt, event.timezone),
        startsAt: event.startsAt,
        invitesAt: event.invitesAt,
        entries: people,
        places,
        groupCount,
        leaderDiscordUserId: leader,
        masterLooterDiscordUserId: masterLooter,
        assistEntryIds: assistIds,
      }),
    );
  const changeRoles = (update: () => void) => {
    update();
    edited();
  };

  const onDrop = (e: DragEvent, target: { group: number; slot: number } | 'bench') => {
    e.preventDefault();
    const id = e.dataTransfer.getData('text/plain');
    if (!byId.has(id)) return;
    if (target === 'bench') toBench(id);
    else moveTo(id, target.group, target.slot);
  };

  // A role picked from someone's menu: done, so nobody stays selected.
  const pickRole = (update: () => void) => {
    changeRoles(update);
    setMenuFor(null);
    setSelected(null);
  };
  const roleMenu = (entry: Entry) => {
    const isLeader = entry.discordUserId === leader;
    const isAssist = assistIds.includes(entry.id);
    const isLooter = entry.discordUserId === masterLooter;
    const item = (label: ReactNode, onPick: () => void) => (
      <button
        type="button"
        role="menuitem"
        className="dropdown-item dropdown-option"
        onClick={(e) => {
          e.stopPropagation();
          onPick();
        }}
      >
        {label}
      </button>
    );
    return (
      <div
        className="dropdown-menu setup-chip-menu"
        role="menu"
        ref={menu}
        onClick={(e) => e.stopPropagation()}
      >
        {!isLeader &&
          item(
            <>
              <RoleMark gameVersion={guild.gameVersion} role="LEADER" /> Make leader
            </>,
            () => pickRole(() => chooseLeader(entry.discordUserId)),
          )}
        {/* The leader already leads: no assist for them. */}
        {!isLeader &&
          item(
            <>
              <RoleMark gameVersion={guild.gameVersion} role="ASSIST" />{' '}
              {isAssist ? 'Remove assist' : 'Set assist'}
            </>,
            () =>
              pickRole(() =>
                setAssists(
                  isAssist ? assistIds.filter((id) => id !== entry.id) : [...assistIds, entry.id],
                ),
              ),
          )}
        {item(
          <>
            <RoleMark gameVersion={guild.gameVersion} role="MASTER_LOOTER" />{' '}
            {isLooter ? 'Remove master looter' : 'Set master looter'}
          </>,
          () => pickRole(() => setMasterLooter(isLooter ? null : entry.discordUserId)),
        )}
        <small className="muted dropdown-hint">Or tap a place to move them.</small>
      </div>
    );
  };

  const chip = (entry: Entry) => (
    <div key={entry.id} className="setup-chip-wrap">
      {chipButton(entry)}
      {menuFor === entry.id && roleMenu(entry)}
    </div>
  );

  const chipButton = (entry: Entry) => (
    <button
      type="button"
      draggable
      onDragStart={(e) => {
        setMenuFor(null);
        e.dataTransfer.setData('text/plain', entry.id);
      }}
      onClick={(e) => {
        e.stopPropagation();
        const deselect = selected === entry.id;
        setSelected(deselect ? null : entry.id);
        // Raid roles from a menu on the name (members events have none).
        setMenuFor(deselect || !event.layout.hasRaidRoles ? null : entry.id);
      }}
      className={selected === entry.id ? 'setup-chip setup-chip-selected' : 'setup-chip'}
      title={entry.note ?? undefined}
      aria-haspopup={event.layout.hasRaidRoles ? 'menu' : undefined}
      aria-expanded={event.layout.hasRaidRoles ? menuFor === entry.id : undefined}
    >
      {entry.role && <RoleMark gameVersion={guild.gameVersion} role={entry.role} />}
      <ClassMark gameVersion={guild.gameVersion} className={entry.characterClass} />
      <span className="setup-chip-name">{entryName(entry)}</span>
      {!event.layout.hasRaidRoles ? null : entry.discordUserId === leader ? (
        <RoleMark gameVersion={guild.gameVersion} role="LEADER" />
      ) : (
        assistIds.includes(entry.id) && <RoleMark gameVersion={guild.gameVersion} role="ASSIST" />
      )}
      {event.layout.hasRaidRoles && entry.discordUserId === masterLooter && (
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
      {exported && <AddonExportDialog exported={exported} onClose={() => setExported(null)} />}
      <div className="tasks-head">
        <span className="muted">
          Drag people in from the bench, or tap someone and then a place
          {event.layout.hasRaidRoles && '; tapping someone also lets you set their raid roles'}.
          Changes save by themselves and show for everyone with this event open.
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
          {/* The addon sorts raids: only for events with raid groups and roles. */}
          {event.layout.hasRaidRoles && (
            <button
              type="button"
              className="btn btn-sm"
              onClick={exportForAddon}
              title={
                'The setup as the GuildAssistant RaidSort addon reads it, to paste in game.\n' +
                'Get GuildAssistant RaidSort from CurseForge (search "GuildAssistant RaidSort", or use the CurseForge app).'
              }
            >
              Export for addon
            </button>
          )}
          {/* No Save button: what's on screen saves by itself (see `version`). */}
          <span className="muted setup-save-status" role="status">
            {saving ? <InlineSpinner label="Saving…" /> : dirty ? 'Unsaved…' : 'Saved'}
          </span>
        </div>
      </div>
      {error && <p className="status-error">{error}</p>}

      {/* Raid roles: not on members events. */}
      {event.layout.hasRaidRoles && (
        <div className="task-card setup-roles">
          <strong>Lead and loot</strong>
          <div className="form-grid">
            <label className="field">
              <span>
                <RoleMark gameVersion={guild.gameVersion} role="LEADER" /> Leader
              </span>
              <Select value={leader} onChange={(v) => changeRoles(() => chooseLeader(v))}>
                {!people.some((p) => p.discordUserId === leader) && (
                  <option value={leader}>{event.createdByName} (not signed up)</option>
                )}
                {people.map((entry) => (
                  <option key={entry.id} value={entry.discordUserId}>
                    {entryName(entry)}
                  </option>
                ))}
              </Select>
            </label>
            <label className="field">
              <span>
                <RoleMark gameVersion={guild.gameVersion} role="MASTER_LOOTER" /> Master looter
              </span>
              <Select
                value={masterLooter ?? ''}
                onChange={(v) => changeRoles(() => setMasterLooter(v || null))}
              >
                <option value="">None</option>
                {people.map((entry) => (
                  <option key={entry.id} value={entry.discordUserId}>
                    {entryName(entry)}
                  </option>
                ))}
              </Select>
            </label>
            <div className="field">
              <span>
                <RoleMark gameVersion={guild.gameVersion} role="ASSIST" /> Assist
              </span>
              <MultiSelect
                options={people
                  .filter((entry) => entry.discordUserId !== leader)
                  .map((entry) => ({ value: entry.id, label: entryName(entry) }))}
                value={assistIds}
                onChange={(value) => changeRoles(() => setAssists(value))}
                placeholder="Nobody"
              />
            </div>
          </div>
          <small className="muted">
            Shown after their names in the setup. Officers get assist when they sign up; the leader
            never has it, as leading covers it. They save by themselves, like the groups.
          </small>
        </div>
      )}

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
              ? 'Update the post'
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
