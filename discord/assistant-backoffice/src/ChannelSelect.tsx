import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { ChevronIcon } from './Icons';
import { channelKey } from './channelKey';
import { fuzzyWordsScore } from './fuzzy';
import type { ServerChannels } from './types';

interface Props {
  groups: ServerChannels[];
  /** `serverId:channelId`, or '' when nothing is chosen. */
  value: string;
  onChange: (value: string) => void;
  /** Restrict to one server (by id). */
  onlyServer?: string;
  required?: boolean;
  disabled?: boolean;
}

interface Option {
  key: string;
  name: string;
  serverName: string;
}

/**
 * Channel picker for servers with many channels: a button that opens a search box over the
 * guild's channels (already loaded, searched here), grouped by Discord server. The search is
 * typo tolerant and word by word ("wed raid" finds #wednesday-raid); arrows and Enter pick.
 */
export function ChannelSelect({ groups, value, onChange, onlyServer, required, disabled }: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const listId = useId();

  const shown = useMemo(
    () => groups.filter((group) => !onlyServer || group.serverId === onlyServer),
    [groups, onlyServer],
  );
  const several = shown.length > 1;

  // Matches, best first within each server; servers keep their order.
  const matches = useMemo(() => {
    const result: { serverName: string; options: Option[] }[] = [];
    for (const group of shown) {
      const options = group.channels
        .map((channel) => ({
          option: {
            key: channelKey(group.serverId, channel.id),
            name: channel.name,
            serverName: group.serverName,
          },
          score: fuzzyWordsScore(
            query,
            several ? [channel.name, group.serverName] : [channel.name],
          ),
        }))
        .filter((match): match is { option: Option; score: number } => match.score !== null)
        .sort((a, b) => a.score - b.score)
        .map((match) => match.option);
      if (options.length > 0) result.push({ serverName: group.serverName, options });
    }
    return result;
  }, [shown, query, several]);
  const flat = matches.flatMap((group) => group.options);

  const selected = shown
    .flatMap((group) =>
      group.channels.map((channel) => ({
        key: channelKey(group.serverId, channel.id),
        name: channel.name,
        serverName: group.serverName,
      })),
    )
    .find((option) => option.key === value);

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      if (root.current && !root.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  // Keep the highlighted option in view while moving with the arrows.
  useEffect(() => {
    list.current
      ?.querySelector<HTMLElement>(`[data-index="${active}"]`)
      ?.scrollIntoView({ block: 'nearest' });
  }, [active, open]);

  const openMenu = () => {
    setQuery('');
    setActive(Math.max(0, flatIndexOf(value)));
    setOpen(true);
  };
  const flatIndexOf = (key: string) =>
    shown
      .flatMap((group) => group.channels.map((channel) => channelKey(group.serverId, channel.id)))
      .indexOf(key);

  const choose = (key: string) => {
    onChange(key);
    setOpen(false);
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActive((index) => Math.min(index + 1, flat.length - 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActive((index) => Math.max(index - 1, 0));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      if (flat[active]) choose(flat[active].key);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      setOpen(false);
    }
  };

  let index = -1;
  return (
    <>
      <div className="dropdown channel-select" ref={root}>
        <button
          type="button"
          className="dropdown-button"
          aria-haspopup="listbox"
          aria-expanded={open}
          disabled={disabled}
          onClick={() => (open ? setOpen(false) : openMenu())}
        >
          <span className={selected ? undefined : 'muted'}>
            {selected
              ? `#${selected.name}${several ? ` · ${selected.serverName}` : ''}`
              : value
                ? 'Loading channels…'
                : 'Choose a channel…'}
          </span>
          <span className="select-chevron" aria-hidden="true">
            <ChevronIcon />
          </span>
        </button>
        {/* Lets the form's own "required" check stop a submit with no channel picked. */}
        {required && (
          <input
            className="channel-select-required"
            tabIndex={-1}
            aria-hidden="true"
            required
            value={value}
            onChange={() => undefined}
          />
        )}
        {open && (
          <div className="dropdown-menu channel-select-menu">
            <div className="search-field">
              <span className="search-icon" aria-hidden="true">
                🔍
              </span>
              <input
                type="search"
                autoFocus
                value={query}
                placeholder="Search channels…"
                onChange={(event) => {
                  setQuery(event.target.value);
                  setActive(0);
                }}
                onKeyDown={onKeyDown}
                role="combobox"
                aria-expanded="true"
                aria-controls={listId}
                aria-activedescendant={flat[active] ? `${listId}-${active}` : undefined}
              />
            </div>
            <div ref={list} id={listId} role="listbox" className="channel-select-list">
              {flat.length === 0 && (
                <p className="dropdown-hint muted">
                  {shown.length === 0 ? 'Loading channels…' : 'No channel matches.'}
                </p>
              )}
              {matches.map((group) => (
                <div key={group.serverName} role="group" aria-label={group.serverName}>
                  {several && <div className="dropdown-hint muted">{group.serverName}</div>}
                  {group.options.map((option) => {
                    index++;
                    const at = index;
                    return (
                      <button
                        key={option.key}
                        id={`${listId}-${at}`}
                        data-index={at}
                        type="button"
                        role="option"
                        aria-selected={option.key === value}
                        tabIndex={-1}
                        className={`dropdown-item dropdown-option${at === active ? ' dropdown-item-active' : ''}${option.key === value ? ' dropdown-item-selected' : ''}`}
                        onMouseEnter={() => setActive(at)}
                        onClick={() => choose(option.key)}
                      >
                        #{option.name}
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
      {shown
        .filter((group) => group.error)
        .map((group) => (
          <small key={group.serverId} className="status-error">
            {group.serverName}: {group.error}
          </small>
        ))}
    </>
  );
}
