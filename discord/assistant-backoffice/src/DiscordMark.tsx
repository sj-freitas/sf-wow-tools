/** Simple Discord-style chat-bubble face (not the official logo). */
export function DiscordMark({ size = 48 }: { size?: number }) {
  return (
    <img
      src="https://cdn.prod.website-files.com/6257adef93867e50d84d30e2/66e3d80db9971f10a9757c99_Symbol.svg"
      alt="Discord"
      width={size}
      height={size}
    />
  );
}
