import { useState, type FormEvent } from 'react';
import { createAttribute, deleteAttribute, setCharacterAttributes, updateAttribute } from './api';
import { AttributeChip } from './AttributeChip';
import { Drawer } from './Drawer';
import { InlineSpinner } from './Loading';
import { ATTRIBUTE_COLORS, type AttributeColor, type Guild, type GuildAttribute } from './types';
import { useConfirm } from './useConfirm';

const COLORS = Object.keys(ATTRIBUTE_COLORS) as AttributeColor[];
const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** The twelve colours as round buttons; one is picked. */
function ColorPicker({
  value,
  onChange,
}: {
  value: AttributeColor;
  onChange: (color: AttributeColor) => void;
}) {
  return (
    <div className="color-picker" role="radiogroup" aria-label="Colour">
      {COLORS.map((color) => (
        <button
          key={color}
          type="button"
          role="radio"
          aria-checked={value === color}
          aria-label={color}
          title={color}
          className={value === color ? 'color-swatch color-swatch-active' : 'color-swatch'}
          style={{ background: ATTRIBUTE_COLORS[color] }}
          onClick={() => onChange(color)}
        />
      ))}
    </div>
  );
}

/**
 * Officers: the guild's attributes — add one (name and colour), rename or recolour one, delete one
 * (it comes off every character).
 */
export function ManageAttributesDrawer({
  guild,
  attributes,
  onClose,
  onChanged,
}: {
  guild: Guild;
  attributes: GuildAttribute[];
  onClose: () => void;
  onChanged: () => void;
}) {
  const [name, setName] = useState('');
  const [color, setColor] = useState<AttributeColor>('blue');
  const [editing, setEditing] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editColor, setEditColor] = useState<AttributeColor>('blue');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { confirm, dialog } = useConfirm();

  const run = (action: () => Promise<void>, after?: () => void) => {
    setBusy(true);
    setError(null);
    action()
      .then(() => {
        after?.();
        onChanged();
      })
      .catch((err: unknown) => setError(errorText(err)))
      .finally(() => setBusy(false));
  };

  const add = (event: FormEvent) => {
    event.preventDefault();
    run(
      () => createAttribute(guild.id, { name, color }),
      () => setName(''),
    );
  };

  return (
    <Drawer title="Attributes" onClose={onClose}>
      {dialog}
      <div className="attribute-manager">
        <p className="muted">
          Labels you give characters on the roster, like “Switcher”. Everyone in the guild sees
          them; posts can use them (<code>roster[i].attributes</code>).
        </p>
        <form className="attribute-form" onSubmit={add}>
          <label className="field">
            New attribute
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={32}
              placeholder="e.g. Switcher"
              required
            />
          </label>
          <ColorPicker value={color} onChange={setColor} />
          <div className="attribute-form-row">
            {name.trim() && <AttributeChip name={name.trim()} color={color} />}
            <button type="submit" className="btn btn-primary btn-sm" disabled={busy}>
              Add
            </button>
          </div>
        </form>

        {error && <p className="status-error">{error}</p>}

        {attributes.length === 0 ? (
          <p className="muted">No attributes yet.</p>
        ) : (
          <ul className="attribute-list">
            {attributes.map((attribute) =>
              editing === attribute.id ? (
                <li key={attribute.id} className="attribute-form">
                  <input
                    className="attribute-input"
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    maxLength={32}
                    aria-label="Name"
                  />
                  <ColorPicker value={editColor} onChange={setEditColor} />
                  <div className="attribute-form-row">
                    <button
                      type="button"
                      className="btn btn-primary btn-sm"
                      disabled={busy}
                      onClick={() =>
                        run(
                          () =>
                            updateAttribute(guild.id, attribute.id, {
                              name: editName,
                              color: editColor,
                            }),
                          () => setEditing(null),
                        )
                      }
                    >
                      Save
                    </button>
                    <button type="button" className="btn btn-sm" onClick={() => setEditing(null)}>
                      Cancel
                    </button>
                  </div>
                </li>
              ) : (
                <li key={attribute.id} className="attribute-row">
                  <AttributeChip name={attribute.name} color={attribute.color} />
                  <span className="muted">
                    {attribute.characterIds.length} character
                    {attribute.characterIds.length === 1 ? '' : 's'}
                  </span>
                  <span className="attribute-row-actions">
                    <button
                      type="button"
                      className="btn btn-sm"
                      onClick={() => {
                        setEditing(attribute.id);
                        setEditName(attribute.name);
                        setEditColor(attribute.color);
                      }}
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      className="btn btn-sm btn-danger"
                      disabled={busy}
                      onClick={() =>
                        void confirm({
                          title: `Delete “${attribute.name}”?`,
                          message:
                            'It comes off every character that has it, and posts that use it stop finding them.',
                          confirmLabel: 'Delete',
                          danger: true,
                        }).then((ok) => ok && run(() => deleteAttribute(guild.id, attribute.id)))
                      }
                    >
                      Delete
                    </button>
                  </span>
                </li>
              ),
            )}
          </ul>
        )}
      </div>
    </Drawer>
  );
}

/** Officers: tick which of the guild's attributes one character has. */
export function CharacterAttributesDrawer({
  guild,
  character,
  attributes,
  onClose,
  onChanged,
  onManage,
}: {
  guild: Guild;
  character: { id: string; name: string };
  attributes: GuildAttribute[];
  onClose: () => void;
  onChanged: () => void;
  onManage: () => void;
}) {
  const [picked, setPicked] = useState<Set<string>>(
    () => new Set(attributes.filter((a) => a.characterIds.includes(character.id)).map((a) => a.id)),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggle = (id: string) =>
    setPicked((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const save = () => {
    setBusy(true);
    setError(null);
    setCharacterAttributes(guild.id, character.id, [...picked])
      .then(() => {
        onChanged();
        onClose();
      })
      .catch((err: unknown) => {
        setError(errorText(err));
        setBusy(false);
      });
  };

  return (
    <Drawer title={`Attributes of ${character.name}`} onClose={onClose}>
      <div className="attribute-manager">
        {attributes.length === 0 ? (
          <p className="muted">The guild has no attributes yet.</p>
        ) : (
          <ul className="attribute-list">
            {attributes.map((attribute) => (
              <li key={attribute.id}>
                <label className="attribute-check">
                  <input
                    type="checkbox"
                    checked={picked.has(attribute.id)}
                    onChange={() => toggle(attribute.id)}
                  />
                  <AttributeChip name={attribute.name} color={attribute.color} />
                </label>
              </li>
            ))}
          </ul>
        )}
        {error && <p className="status-error">{error}</p>}
        <div className="form-actions">
          {attributes.length > 0 && (
            <button type="button" className="btn btn-primary" disabled={busy} onClick={save}>
              {busy ? <InlineSpinner label="Saving…" /> : 'Save'}
            </button>
          )}
          <button type="button" className="btn" onClick={onManage}>
            {attributes.length === 0 ? 'Create attributes' : 'Manage attributes'}
          </button>
        </div>
      </div>
    </Drawer>
  );
}
