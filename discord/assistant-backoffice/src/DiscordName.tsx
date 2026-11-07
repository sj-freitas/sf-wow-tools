import { showToast } from './toast';

/**
 * A Discord user shown by name (a long one cut short): hovering shows the whole name and their
 * Discord ID; clicking (or tapping, on a phone) copies the ID, with a brief note at the bottom of
 * the screen that has the whole name too (nothing in the list itself moves).
 */
export function DiscordName({ label, id }: { label: string; id: string }) {
  return (
    <button
      type="button"
      className="discord-name"
      title={`${label} · Discord ID ${id} — click to copy`}
      onClick={(event) => {
        // A name in a row that opens something on a click: reading it doesn't.
        event.stopPropagation();
        navigator.clipboard
          .writeText(id)
          .then(() => showToast(`${label} · Discord ID copied`, 3000))
          // No clipboard (an old browser, or not allowed): show the ID to copy by hand.
          .catch(() => showToast(`${label} · Discord ID: ${id}`, 6000));
      }}
    >
      <strong className="name-truncate">{label}</strong>
    </button>
  );
}
