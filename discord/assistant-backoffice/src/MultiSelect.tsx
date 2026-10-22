import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ChevronIcon } from './Icons';

interface Props<T extends string> {
  /** `icon`: shown before the label in the list (the button shows labels only). */
  options: { value: T; label: string; icon?: ReactNode }[];
  value: T[];
  onChange: (value: T[]) => void;
  placeholder?: string;
  /** The button is locked (with `placeholder` as its text). */
  disabled?: boolean;
}

/** Dropdown with a checkbox per option; the button shows the current selection. */
export function MultiSelect<T extends string>({
  options,
  value,
  onChange,
  placeholder,
  disabled,
}: Props<T>) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const close = (event: MouseEvent) => {
      if (root.current && !root.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);

  const toggle = (option: T) =>
    onChange(value.includes(option) ? value.filter((v) => v !== option) : [...value, option]);

  const summary =
    value.length === 0
      ? (placeholder ?? 'Select…')
      : options
          .filter((option) => value.includes(option.value))
          .map((option) => option.label)
          .join(', ');

  return (
    <div className="dropdown" ref={root}>
      <button
        type="button"
        className="dropdown-button"
        aria-haspopup="listbox"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => setOpen((current) => !current)}
      >
        <span className={value.length === 0 ? 'muted' : undefined}>{summary}</span>
        <span className="select-chevron" aria-hidden="true">
          <ChevronIcon />
        </span>
      </button>
      {open && (
        <div className="dropdown-menu" role="listbox" aria-multiselectable="true">
          {options.map((option) => (
            <label key={option.value} className="dropdown-item">
              <input
                type="checkbox"
                checked={value.includes(option.value)}
                onChange={() => toggle(option.value)}
              />
              {option.icon}
              {option.label}
            </label>
          ))}
        </div>
      )}
    </div>
  );
}
