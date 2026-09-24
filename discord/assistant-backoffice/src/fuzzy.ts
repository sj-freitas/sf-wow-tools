const normalize = (text: string): string => text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

function distance(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let previous = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const current = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, previous + (a[i - 1] === b[j - 1] ? 0 : 1));
      previous = current;
    }
  }
  return row[b.length];
}

const allowedTypos = (length: number): number => (length <= 3 ? 0 : length <= 6 ? 1 : 2);

/**
 * Match quality of `query` against the candidate strings, lower is better, or
 * null for no match. Substring matches beat typo matches, so "Teryn" still
 * finds "Tearyn" (one edit) but ranks it below a real "Teryn".
 */
export function fuzzyScore(query: string, candidates: string[]): number | null {
  const q = normalize(query).trim();
  if (q.length === 0) {
    return 0;
  }
  let best: number | null = null;
  const consider = (score: number) => {
    best = best === null ? score : Math.min(best, score);
  };

  for (const candidate of candidates) {
    const text = normalize(candidate);
    if (text === q) consider(0);
    else if (text.startsWith(q)) consider(1);
    else if (text.includes(q)) consider(2);
    else {
      for (const token of text.split(/[^a-z0-9]+/).filter(Boolean)) {
        const typos = Math.min(distance(q, token), distance(q, token.slice(0, q.length)));
        if (typos <= allowedTypos(q.length)) consider(3 + typos);
      }
    }
  }
  return best;
}
