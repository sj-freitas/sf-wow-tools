import { useEffect } from 'react';

const SITE = 'https://guildassistant.app';
const DEFAULT_TITLE = 'Guild Assistant — a helper for World of Warcraft guilds on Discord';

/** The `<meta>` or `<link>` element with this attribute, created in `<head>` if it is missing. */
function headElement(tag: 'meta' | 'link', attribute: string, value: string): HTMLElement {
  const existing = document.head.querySelector<HTMLElement>(`${tag}[${attribute}="${value}"]`);
  if (existing) return existing;
  const created = document.createElement(tag);
  created.setAttribute(attribute, value);
  document.head.appendChild(created);
  return created;
}

/**
 * What search engines see for the current page: its title, its canonical address, and whether it
 * may be indexed. Only the public pages (the landing page at `/` and `/privacy`) are; every other
 * address — logged in, or a deep link showing the landing page to a logged-out visitor — is
 * `noindex`, so search results only ever point at the real public pages.
 */
export function usePageMeta({
  title,
  path,
  index,
}: {
  title?: string;
  /** The canonical path of an indexable page, e.g. `/privacy`. */
  path?: string;
  index: boolean;
}): void {
  useEffect(() => {
    document.title = title ? `${title} — Guild Assistant` : DEFAULT_TITLE;
    headElement('meta', 'name', 'robots').setAttribute(
      'content',
      index ? 'index, follow' : 'noindex, nofollow',
    );
    const canonical = headElement('link', 'rel', 'canonical');
    if (index && path) canonical.setAttribute('href', `${SITE}${path}`);
    else canonical.remove();
  }, [title, path, index]);
}
