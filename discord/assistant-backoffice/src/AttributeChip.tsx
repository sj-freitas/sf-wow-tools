import { ATTRIBUTE_COLORS, type AttributeColor } from './types';

/** A guild attribute: its name on its colour. */
export function AttributeChip({ name, color }: { name: string; color: AttributeColor }) {
  return (
    <span className="attribute-chip" style={{ background: ATTRIBUTE_COLORS[color] }}>
      {name}
    </span>
  );
}
