/** Posts are listed this many to a page. */
export const PAGE_SIZE = 10;

const MAX_TERMS = 8;
const MAX_TERM_LENGTH = 100;

/**
 * The words of a search box. A post matches when every word appears somewhere in its name or
 * its text (case-insensitive, partial words count), so "raid tonight" finds "Raid tonight!".
 */
export function searchTerms(query: string | undefined): string[] {
  return (query ?? '')
    .split(/\s+/)
    .map((term) => term.trim().slice(0, MAX_TERM_LENGTH))
    .filter((term) => term !== '')
    .slice(0, MAX_TERMS);
}

/** A SQL LIKE pattern matching the term anywhere; `%`, `_` and `\` in the term stay literal. */
export const likePattern = (term: string): string => `%${term.replace(/[\\%_]/g, '\\$&')}%`;

/** A page number from a query string: a whole number from 1, otherwise 1. */
export function clampPage(value: unknown): number {
  const page = typeof value === 'string' ? Number.parseInt(value, 10) : Number(value);
  return Number.isInteger(page) && page >= 1 ? page : 1;
}
