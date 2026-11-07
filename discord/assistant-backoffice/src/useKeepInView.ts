import { useLayoutEffect, type RefObject } from 'react';

const MARGIN = 8;

/**
 * Moves an overlay (a popover or menu placed against its button, `position: absolute` with
 * `left`) sideways just enough to keep it inside the window: near the screen's edge, on a phone,
 * it would otherwise be cut off. It moves its `left` (a `transform` would leave its first place
 * in the page's width). `open` is what is shown (placed again whenever it changes); a falsy one is
 * closed.
 */
export function useKeepInView(ref: RefObject<HTMLElement | null>, open: unknown) {
  useLayoutEffect(() => {
    const element = ref.current;
    if (!open || !element) return;
    element.style.left = '';
    element.style.right = '';
    const rect = element.getBoundingClientRect();
    const width = document.documentElement.clientWidth;
    let shift = 0;
    if (rect.right > width - MARGIN) shift = width - MARGIN - rect.right;
    // Never past the left edge either (wider than the window: its left edge wins).
    if (rect.left + shift < MARGIN) shift = MARGIN - rect.left;
    if (shift !== 0) {
      element.style.left = `${element.offsetLeft + shift}px`;
      element.style.right = 'auto';
    }
  }, [ref, open]);
}
