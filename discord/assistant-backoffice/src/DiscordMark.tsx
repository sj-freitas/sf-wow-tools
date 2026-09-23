/** Simple Discord-style chat-bubble face (not the official logo). */
export function DiscordMark({ size = 48 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" aria-hidden="true">
      <path
        d="M10 12c4-2.2 8-3.2 14-3.2S34 9.8 38 12c3.2 5.6 4.8 11.4 4.6 18.2-3 2.4-6 3.8-9.2 4.6l-2.2-3.6c1.2-.4 2.4-1 3.4-1.8-6.6 2.8-15.2 2.8-21.6 0 1 .8 2.2 1.4 3.4 1.8l-2.2 3.6c-3.2-.8-6.2-2.2-9.2-4.6C5.2 23.4 6.8 17.6 10 12Z"
        fill="#fff"
      />
      <ellipse cx="17.5" cy="24" rx="3" ry="3.6" fill="#5865f2" />
      <ellipse cx="30.5" cy="24" rx="3" ry="3.6" fill="#5865f2" />
    </svg>
  );
}
