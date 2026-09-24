import { useEffect, useRef, useState } from 'react';

interface Props<T extends string> {
  options: { value: T; label: string }[];
  value: T[];
  onChange: (value: T[]) => void;
  placeholder?: string;
}

/** Dropdown with a checkbox per option; the button shows the current selection. */
export function MultiSelect<T extends string>({ options, value, onChange, placeholder }: Props<T>) {
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
        onClick={() => setOpen((current) => !current)}
      >
        <span className={value.length === 0 ? 'muted' : undefined}>{summary}</span>
        <span aria-hidden="true">▾</span>
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
              {option.label}
            </label>
          ))}
        </div>
      )}
    </div>
  );
}
