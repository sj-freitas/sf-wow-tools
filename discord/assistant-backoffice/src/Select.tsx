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
}

/**
 * The app's dropdown, in place of the browser's `<select>` (which opens the phone's own picker):
 * a button showing the choice, and a list in the app's style. Keyboard: arrows, Home/End,
 * Enter/Space to choose, Escape to close, a letter to jump to an option starting with it.
 */
export function Select({
  value,
  onChange,
  children,
  disabled,
  required,
  title,
  'aria-label': ariaLabel,
}: Props) {
  const options = optionsOf(children);
  const selected = options.findIndex((option) => option.value === String(value));
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const root = useRef<HTMLDivElement>(null);
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
    setActive(Math.max(selected, 0));
    setOpen(true);
  };
  const choose = (index: number) => {
    const option = options[index];
    if (!option || option.disabled) return;
    setOpen(false);
    if (option.value !== String(value)) onChange(option.value);
  };
  // The next option that can be chosen, from `from` in `step`'s direction (or `from` itself).
  const nextEnabled = (from: number, step: 1 | -1) => {
    for (let i = from; i >= 0 && i < options.length; i += step) {
      if (!options[i].disabled) return i;
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
    if (event.key === 'ArrowDown') setActive(nextEnabled(active + 1, 1));
    else if (event.key === 'ArrowUp') setActive(nextEnabled(active - 1, -1));
    else if (event.key === 'Home') setActive(nextEnabled(0, 1));
    else if (event.key === 'End') setActive(nextEnabled(options.length - 1, -1));
    else if (event.key === 'Enter' || event.key === ' ') choose(active);
    else if (event.key === 'Escape') setOpen(false);
    else if (event.key === 'Tab') {
      setOpen(false);
      return;
    } else if (event.key.length === 1) {
      // Type-ahead: the next option after the active one starting with that letter.
      const letter = event.key.toLowerCase();
      const at = [...options.keys()]
        .map((i) => (active + 1 + i) % options.length)
        .find(
          (i) =>
            !options[i].disabled &&
            textOf(options[i].label).trim().toLowerCase().startsWith(letter),
        );
      if (at !== undefined) setActive(at);
    } else return;
    event.preventDefault();
  };

  const current = options[selected];
  return (
    <div className="dropdown select" ref={root}>
      <button
        type="button"
        className="dropdown-button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-activedescendant={open ? `${listId}-${active}` : undefined}
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
      {open && (
        // Most Selects sit in a <label>: a click in the list would reach it, and the label would
        // click the button again (reopening it). preventDefault stops the label doing that.
        <div
          className="dropdown-menu"
          role="listbox"
          id={listId}
          ref={list}
          onClick={(event) => event.preventDefault()}
        >
          {options.map((option, index) => (
            <div
              key={`${option.value}-${index}`}
              id={`${listId}-${index}`}
              data-index={index}
              role="option"
              aria-selected={index === selected}
              aria-disabled={option.disabled || undefined}
              className={[
                'dropdown-item',
                index === active && 'dropdown-item-active',
                index === selected && 'dropdown-item-selected',
                option.disabled && 'dropdown-item-disabled',
              ]
                .filter(Boolean)
                .join(' ')}
              onMouseEnter={() => !option.disabled && setActive(index)}
              // Keep the focus on the button (mousedown would take it).
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => choose(index)}
            >
              {option.label}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
