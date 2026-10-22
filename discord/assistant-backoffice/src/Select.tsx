import {
  Children,
  Fragment,
  isValidElement,
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactElement,
  type ReactNode,
} from 'react';
import { fuzzyWordsScore } from './fuzzy';
import { ChevronIcon } from './Icons';

interface Option {
  value: string;
  label: ReactNode;
  disabled: boolean;
}

/** A node's text: an option's value when it has no `value`, as in a native select. */
function textOf(node: ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textOf).join('');
  if (isValidElement<{ children?: ReactNode }>(node)) return textOf(node.props.children);
  return '';
}

type OptionProps = { value?: string | number; disabled?: boolean; children?: ReactNode };

/** The `<option>`s among the children, through fragments, arrays and conditionals. */
function optionsOf(children: ReactNode): Option[] {
  return Children.toArray(children).flatMap((child): Option[] => {
    if (!isValidElement(child)) return [];
    if (child.type === Fragment) {
      return optionsOf((child as ReactElement<{ children?: ReactNode }>).props.children);
    }
    if (child.type !== 'option') return [];
    const props = (child as ReactElement<OptionProps>).props;
    return [
      {
        value: props.value !== undefined ? String(props.value) : textOf(props.children),
        label: props.children,
        disabled: props.disabled ?? false,
      },
    ];
  });
}

interface Props {
  value: string | number;
  onChange: (value: string) => void;
  /** `<option>`s, as in a native `<select>` (`value`, `disabled`, text). */
  children: ReactNode;
  disabled?: boolean;
  /** Checked by the form like a native select: an empty value doesn't submit. */
  required?: boolean;
  title?: string;
  'aria-label'?: string;
  /** A search box on top of the list, for long ones (timezones): the words typed filter it. */
  searchable?: boolean;
  /** The search box's placeholder. */
  searchPlaceholder?: string;
}

/** What an option is searched by: its text and value, `_` and `/` read as spaces (time zones). */
const searchText = (option: Option) =>
  `${textOf(option.label)} ${option.value}`.replace(/[_/]/g, ' ');

/**
 * The app's dropdown, in place of the browser's `<select>` (which opens the phone's own picker):
 * a button showing the choice, and a list in the app's style. Keyboard: arrows, Home/End,
 * Enter/Space to choose, Escape to close, a letter to jump to an option starting with it; with
 * `searchable`, typing goes to the search box instead.
 */
export function Select({
  value,
  onChange,
  children,
  disabled,
  required,
  title,
  'aria-label': ariaLabel,
  searchable = false,
  searchPlaceholder = 'Search…',
}: Props) {
  const options = optionsOf(children);
  const selected = options.findIndex((option) => option.value === String(value));
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  // The options shown (all, or those matching the search), by their index in `options`; `active`
  // is a position in this list.
  const shown = [...options.keys()].filter(
    (i) =>
      !searchable || !query.trim() || fuzzyWordsScore(query, [searchText(options[i])]) !== null,
  );
  const [active, setActive] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const listId = useId();

  useEffect(() => {
    if (!open) return;
    const away = (event: MouseEvent) => {
      if (root.current && !root.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', away);
    return () => document.removeEventListener('mousedown', away);
  }, [open]);
  useEffect(() => {
    if (open) {
      list.current
        ?.querySelector<HTMLElement>(`[data-index="${active}"]`)
        ?.scrollIntoView({ block: 'nearest' });
    }
  }, [active, open]);

  const show = () => {
    setQuery('');
    setActive(Math.max(selected, 0));
    setOpen(true);
  };
  const close = () => {
    setOpen(false);
    // From the search box, the focus goes back to the button (it would otherwise be lost).
    if (searchable) button.current?.focus();
  };
  const choose = (at: number) => {
    const option = options[shown[at]];
    if (!option || option.disabled) return;
    close();
    if (option.value !== String(value)) onChange(option.value);
  };
  // The next shown option that can be chosen, from `from` in `step`'s direction (or `from` itself).
  const nextEnabled = (from: number, step: 1 | -1) => {
    for (let i = from; i >= 0 && i < shown.length; i += step) {
      if (!options[shown[i]].disabled) return i;
    }
    return active;
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (!open) {
      if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(event.key)) {
        event.preventDefault();
        show();
      }
      return;
    }
    const inSearch = event.target instanceof HTMLInputElement;
    if (event.key === 'ArrowDown') setActive(nextEnabled(active + 1, 1));
    else if (event.key === 'ArrowUp') setActive(nextEnabled(active - 1, -1));
    else if (event.key === 'Home' && !inSearch) setActive(nextEnabled(0, 1));
    else if (event.key === 'End' && !inSearch) setActive(nextEnabled(shown.length - 1, -1));
    else if (event.key === 'Enter' || (event.key === ' ' && !inSearch)) choose(active);
    else if (event.key === 'Escape') close();
    else if (event.key === 'Tab') {
      setOpen(false);
      return;
    } else if (event.key.length === 1 && !searchable) {
      // Type-ahead: the next option after the active one starting with that letter.
      const letter = event.key.toLowerCase();
      const at = [...shown.keys()]
        .map((i) => (active + 1 + i) % shown.length)
        .find(
          (i) =>
            !options[shown[i]].disabled &&
            textOf(options[shown[i]].label).trim().toLowerCase().startsWith(letter),
        );
      if (at !== undefined) setActive(at);
    } else return;
    event.preventDefault();
  };

  const current = options[selected];
  const items = (
    <>
      {shown.length === 0 && <p className="dropdown-hint muted">Nothing matches.</p>}
      {shown.map((index, at) => {
        const option = options[index];
        return (
          <div
            key={`${option.value}-${index}`}
            id={`${listId}-${at}`}
            data-index={at}
            role="option"
            aria-selected={index === selected}
            aria-disabled={option.disabled || undefined}
            className={[
              'dropdown-item',
              at === active && 'dropdown-item-active',
              index === selected && 'dropdown-item-selected',
              option.disabled && 'dropdown-item-disabled',
            ]
              .filter(Boolean)
              .join(' ')}
            onMouseEnter={() => !option.disabled && setActive(at)}
            // Keep the focus where it is (the button, or the search box).
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => choose(at)}
          >
            {option.label}
          </div>
        );
      })}
    </>
  );
  return (
    <div className="dropdown select" ref={root}>
      <button
        ref={button}
        type="button"
        className="dropdown-button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-activedescendant={open && !searchable ? `${listId}-${active}` : undefined}
        aria-label={ariaLabel}
        title={title}
        disabled={disabled}
        // A pointer's click; Enter and Space are handled in onKeyDown (the click they'd also fire,
        // with no `detail`, would toggle it a second time).
        onClick={(event) => {
          if (event.detail === 0) return;
          if (open) setOpen(false);
          else show();
        }}
        onKeyDown={onKeyDown}
      >
        <span>{current ? current.label : ' '}</span>
        <span className="select-chevron" aria-hidden="true">
          <ChevronIcon />
        </span>
      </button>
      {required && (
        <input
          className="channel-select-required"
          tabIndex={-1}
          aria-hidden="true"
          required
          value={String(value)}
          onChange={() => undefined}
        />
      )}
      {open &&
        (searchable ? (
          // The search box on top, the list scrolling under it (like the channel picker). Most
          // Selects sit in a <label>: preventDefault stops a click in the list from reaching it
          // (the label would click the button again, reopening it).
          <div
            className="dropdown-menu channel-select-menu"
            onClick={(event) => {
              if (!(event.target instanceof HTMLInputElement)) event.preventDefault();
            }}
          >
            <div className="search-field">
              <input
                type="search"
                autoFocus
                value={query}
                placeholder={searchPlaceholder}
                aria-label={searchPlaceholder}
                onChange={(event) => {
                  setQuery(event.target.value);
                  setActive(0);
                }}
                onKeyDown={onKeyDown}
                role="combobox"
                aria-expanded="true"
                aria-controls={listId}
                aria-activedescendant={shown.length > 0 ? `${listId}-${active}` : undefined}
              />
            </div>
            <div className="channel-select-list" role="listbox" id={listId} ref={list}>
              {items}
            </div>
          </div>
        ) : (
          <div
            className="dropdown-menu"
            role="listbox"
            id={listId}
            ref={list}
            onClick={(event) => event.preventDefault()}
          >
            {items}
          </div>
        ))}
    </div>
  );
}
