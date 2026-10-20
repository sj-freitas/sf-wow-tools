import { showToast } from './toast';

/**
 * A Discord user shown by name: hovering shows their Discord ID, clicking copies it, with a brief
 * note at the bottom of the screen (nothing in the list itself moves).
 */
export function DiscordName({ label, id }: { label: string; id: string }) {
  return (
    <button
      type="button"
      className="discord-name"
      title={`Discord ID ${id} — click to copy`}
      onClick={() => {
        navigator.clipboard
          .writeText(id)
          .then(() => showToast('Discord ID copied'))
          // No clipboard (an old browser, or not allowed): show the ID to copy by hand.
          .catch(() => showToast(`Discord ID: ${id}`, 6000));
      }}
    >
      <strong>{label}</strong>
    </button>
  );
}
