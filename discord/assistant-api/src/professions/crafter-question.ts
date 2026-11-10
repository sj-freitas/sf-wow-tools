// Guild Chat Profession Listener (crafter-listener.service.ts): telling a question about a crafter
// ("who can craft flask of titans?", "LF crafter [Flask of the Titans]") from chat, and which of
// the guild's recipes it is about. Pure functions, so they are tested on their own.

/** What a listener listens for when an Officer doesn't say otherwise. */
export const DEFAULT_PHRASES: readonly string[] = [
  'who can craft',
  'who can make',
  'who crafts',
  'who makes',
  'can anyone craft',
  'can anyone make',
  'can someone craft',
  'can someone make',
  'anyone can craft',
  'anyone can make',
  'lf crafter',
  'lf craft',
  'looking for crafter',
  'looking for a crafter',
  'need a crafter',
  'need crafter',
  // The recipe between the words: "looking for flask of titans crafter", never "looking for group".
  'looking for * crafter',
  'lf * crafter',
  'need * crafter',
];

export const MAX_PHRASES = 40;
const MAX_PHRASE_LENGTH = 60;

/** Words a question is made of that name no recipe. "of" and "the" too: names have them on both sides. */
const STOP_WORDS = new Set([
  'a',
  'an',
  'and',
  'any',
  'anybody',
  'anyone',
  'are',
  'can',
  'could',
  'craft',
  'crafter',
  'for',
  'have',
  'here',
  'i',
  'in',
  'is',
  'it',
  'lf',
  'lfm',
  'make',
  'me',
  'my',
  'need',
  'of',
  'on',
  'one',
  'or',
  'pls',
  'plz',
  'please',
  'some',
  'somebody',
  'someone',
  'thanks',
  'that',
  'the',
  'there',
  'this',
  'thx',
  'to',
  'ty',
  'u',
  'who',
  'with',
  'wtb',
  'you',
]);

/** Words after (or before) the phrase that are looked at. */
const MAX_WORDS = 14;
/** Words a gap phrase's gap may hold ("looking for * crafter"): a recipe's name, give or take. */
const MAX_GAP = 8;
/** Where the recipe goes in a phrase: "looking for * crafter" (or "…", "..."). */
const GAP = /\*|…|\.{3}/;

/** Lower case, no accents, apostrophes dropped, anything else that isn't a letter or digit a space. */
export function normalize(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/['’`]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

const wordsOf = (text: string): string[] => normalize(text).split(' ').filter(Boolean);

/** A word that can name a recipe: three letters or more, not a filler word, not "2x". */
const significant = (word: string): boolean =>
  word.length >= 3 && !STOP_WORDS.has(word) && !/^\d+x?$/.test(word);

/**
 * A phrase's words: `start`, and for a gap phrase ("looking for * crafter") `end`, the words after
 * the gap; null for a phrase with none. Split before the words are taken: they'd lose the "*".
 */
function phraseParts(phrase: string): { start: string[]; end: string[] | null } {
  const parts = phrase.split(GAP);
  return parts.length === 1
    ? { start: wordsOf(phrase), end: null }
    : { start: wordsOf(parts[0]), end: wordsOf(parts.slice(1).join(' ')) };
}

/**
 * The phrases an Officer typed (a list, or one per line), checked: two words or more each (one word,
 * like "craft", would answer half the chat, and the bot's own answers say "can craft"), at most
 * `MAX_PHRASES`. A phrase may have one gap, a "*" between words where the recipe goes ("looking for
 * * crafter"); its words on both sides count towards the two. Returns the phrases, or what is wrong.
 */
export function parsePhrases(input: unknown): { phrases: string[] } | { error: string } {
  const raw = Array.isArray(input)
    ? input
    : typeof input === 'string'
      ? input.split('\n')
      : input === undefined || input === null
        ? [...DEFAULT_PHRASES]
        : null;
  if (!raw) return { error: 'The phrases must be a list.' };
  const phrases: string[] = [];
  /** The phrases so far as their words, a gap as "*": "Who  can craft" repeats "who can craft". */
  const seen = new Set<string>();
  for (const item of raw) {
    if (typeof item !== 'string') return { error: 'Each phrase must be text.' };
    const phrase = item.trim().replace(/\s+/g, ' ');
    if (!phrase) continue;
    if (phrase.length > MAX_PHRASE_LENGTH) {
      return {
        error: `“${phrase.slice(0, 20)}…” is too long: at most ${MAX_PHRASE_LENGTH} characters.`,
      };
    }
    if (phrase.split(GAP).length > 2) {
      return {
        error: `“${phrase}” has more than one “*”: use one, where the recipe is, like “looking for * crafter”.`,
      };
    }
    const { start, end } = phraseParts(phrase);
    if (end && (start.length === 0 || end.length === 0)) {
      return {
        error: `In “${phrase}”, the “*” goes between words, where the recipe is: “looking for * crafter”.`,
      };
    }
    const words = [...start, ...(end ?? [])];
    if (words.length < 2) {
      return { error: `“${phrase}” is too short: use two words or more, like “who can craft”.` };
    }
    if (!end && words.join(' ') === 'can craft') {
      return { error: '“can craft” is what the bot’s own answers say: use “who can craft”.' };
    }
    const key = end ? `${start.join(' ')} * ${end.join(' ')}` : words.join(' ');
    if (!seen.has(key)) {
      seen.add(key);
      phrases.push(phrase);
    }
  }
  if (phrases.length === 0) return { error: 'Add at least one phrase to listen for.' };
  if (phrases.length > MAX_PHRASES) return { error: `At most ${MAX_PHRASES} phrases.` };
  return { phrases };
}

/** A recipe as GuildRecipesService gives it (only what matching needs). */
export interface RecipeRef {
  kind: 'spell' | 'item';
  id: number;
  name: string | null;
}

/** A question about who can craft something. */
export interface CrafterQuestion {
  /** The phrase that made it a question ("who can craft"). */
  phrase: string;
  /** Spells and items it links to (Wowhead links, the game's own item links). */
  links: { kind: 'spell' | 'item'; id: number }[];
  /** Names it gives in full: `[Flask of the Titans]`, a Wowhead link's name. */
  names: string[];
  /** Runs of words that may name the recipe, the likeliest first (after the phrase, then before). */
  words: string[][];
}

/** A phrase's word in a message: the same, or with an "s" more or less ("lf crafters"). */
const sameWord = (word: string, phraseWord: string): boolean =>
  word === phraseWord ||
  (phraseWord.length >= 3 && word === `${phraseWord}s`) ||
  (word.length >= 3 && phraseWord === `${word}s`);

/** Where `phrase` is in `words`, from `from` on; -1 when it isn't. */
const indexOf = (words: readonly string[], phrase: readonly string[], from = 0): number => {
  for (let i = from; i + phrase.length <= words.length; i++) {
    if (phrase.every((word, j) => sameWord(words[i + j], word))) return i;
  }
  return -1;
};

/**
 * The words between a gap phrase's `start` and `end` in a clause ("looking for" flask of titans
 * "crafter"), each time the start is followed by the end, `MAX_GAP` words apart at most.
 */
function* gapsIn(
  words: readonly string[],
  start: readonly string[],
  end: readonly string[],
): Generator<string[]> {
  for (let i = indexOf(words, start); i >= 0; i = indexOf(words, start, i + 1)) {
    const from = i + start.length;
    const to = indexOf(words.slice(0, from + MAX_GAP + end.length), end, from);
    if (to >= 0) yield words.slice(from, to);
  }
}

/**
 * The question in a chat message, or null when it asks no question (none of `phrases` is in it, or
 * it says nothing about what). A phrase must be there even when the message links an item: a
 * message showing off a crafted item isn't a question. A gap phrase ("looking for * crafter") must
 * be there whole, its gap holding the recipe: "looking for group" asks nothing.
 */
export function findQuestion(text: string, phrases: readonly string[]): CrafterQuestion | null {
  const links: CrafterQuestion['links'] = [];
  const names: string[] = [];
  // Wowhead links, plain or as [text](link): the id, and the name in the address.
  for (const match of text.matchAll(
    /wowhead\.com\/[^\s)>\]]*?\b(spell|item)=(\d+)(?:\/([a-z0-9-]+))?/gi,
  )) {
    links.push({ kind: match[1].toLowerCase() as 'spell' | 'item', id: Number(match[2]) });
    if (match[3]) names.push(match[3].replace(/-/g, ' '));
  }
  // The game's own links, as a relay of guild chat may pass them on: |Hitem:13510:…|h[Name]|h.
  for (const match of text.matchAll(/\|H(item|spell|enchant):(\d+)/g)) {
    links.push({ kind: match[1] === 'item' ? 'item' : 'spell', id: Number(match[2]) });
  }
  // [Flask of the Titans]: how an item looks in game chat (not the text of a [text](link)).
  for (const match of text.matchAll(/\[([^[\]\n]{2,80})\](?!\()/g)) names.push(match[1]);
  const noLinks = text
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/\|H[^|]*\|h/g, ' ')
    .replace(/\|[cr][0-9a-fA-F]{0,8}/g, ' ');

  // Clauses: "who can craft flask of titans? I have mats" asks about the flask, not the mats.
  const clauses = noLinks
    .split(/[?!,;\n]+|\.(?=\s|$)/)
    .map(wordsOf)
    .filter((words) => words.length > 0);
  for (const phrase of phrases) {
    const { start: phraseWords, end } = phraseParts(phrase);
    if (phraseWords.length === 0) continue;
    for (let c = 0; c < clauses.length; c++) {
      if (end) {
        // "looking for flask of titans crafter": the recipe is the gap, nothing else. A gap that
        // names nothing ("looking for a crafter") leaves the message to the other phrases; an empty
        // one is fine when the message links the item (a link is blanked out of the words).
        for (const gap of gapsIn(clauses[c], phraseWords, end)) {
          if (gap.some(significant)) return { phrase, links, names, words: [gap] };
          if (links.length > 0 || names.length > 0) return { phrase, links, names, words: [] };
        }
        continue;
      }
      const at = indexOf(clauses[c], phraseWords);
      if (at < 0) continue;
      const after = clauses[c].slice(at + phraseWords.length, at + phraseWords.length + MAX_WORDS);
      const before = clauses[c].slice(Math.max(0, at - MAX_WORDS), at);
      const candidates = [after, before, clauses[c + 1] ?? [], clauses[c - 1] ?? []]
        .map((words) => words.slice(0, MAX_WORDS))
        .filter((words) => words.some(significant));
      if (candidates.length === 0 && links.length === 0 && names.length === 0) return null;
      return { phrase, links, names, words: candidates };
    }
  }
  return null;
}

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
 * How well a word of the question matches a word of a name, lower is better; null for not at all:
 * the same word, or with an "s" more or less (0); the start of it ("titan" for "titans", 1); or a
 * typo or two, by its length ("flsk" for "flask", 2).
 */
function wordScore(query: string, word: string): number | null {
  if (query === word || query === `${word}s` || word === `${query}s`) return 0;
  if (query.length >= 4 && word.startsWith(query)) return 1;
  const typos = distance(query, word);
  return typos <= allowedTypos(Math.min(query.length, word.length)) ? 1 + typos : null;
}

/** A recipe the question is about, and how well it matches (lower is better). */
export interface RecipeMatch<R extends RecipeRef> {
  recipe: R;
  score: number;
  /** Every word of its name is in the question: "flask of the titans" for Flask of the Titans. */
  complete: boolean;
}

interface Named<R> {
  recipe: R;
  words: string[];
}

/** Chat around an item's name that names no recipe: dropped from the question's words. */
const FILLER = new Set([
  'around',
  'asap',
  'buy',
  'buying',
  'crafters',
  'got',
  'guys',
  'help',
  'looking',
  'made',
  'mat',
  'mats',
  'now',
  'online',
  'pay',
  'pst',
  'tip',
  'tips',
  'today',
  'tonight',
  'want',
  'whisper',
  'will',
  'would',
]);

/** How each recipe's name and the question's words line up. */
interface Fit<R> {
  recipe: R;
  words: string[];
  /** Every word of the name is in the question. */
  complete: boolean;
  /** Every word of the question is in the name. */
  covers: boolean;
  /** Typos and partial words, summed. */
  typos: number;
}

function fits<R extends RecipeRef>(asked: readonly string[], named: readonly Named<R>[]): Fit<R>[] {
  const result: Fit<R>[] = [];
  for (const { recipe, words } of named) {
    const bestOf = (
      word: string,
      among: readonly string[],
      scoreOf: (a: string, b: string) => number | null,
    ) => {
      let best: number | null = null;
      for (const other of among) {
        const score = scoreOf(word, other);
        if (score !== null && (best === null || score < best)) best = score;
      }
      return best;
    };
    const forName = words.map((word) => bestOf(word, asked, (n, q) => wordScore(q, n)));
    const forAsked = asked.map((word) => bestOf(word, words, (q, n) => wordScore(q, n)));
    const complete = forName.every((score) => score !== null);
    const covers = forAsked.every((score) => score !== null);
    if (!complete && !covers) continue;
    const typos = (complete ? forName : forAsked).reduce<number>(
      (sum, score) => sum + (score ?? 0),
      0,
    );
    result.push({ recipe, words, complete, covers, typos });
  }
  return result;
}

const byFit = <R extends RecipeRef>(a: Fit<R>, b: Fit<R>): number =>
  a.typos - b.typos ||
  (a.recipe.name ?? '').localeCompare(b.recipe.name ?? '') ||
  a.recipe.id - b.recipe.id;

/**
 * The best match of `asked` (the question's words) among the guild's recipes, by how they line up:
 * 1. named exactly (every word of the name and nothing else: "bronze mace" is Bronze Mace, not
 *    Heavy Bronze Mace); 2. named in full among other words ("bronze mace tonight", "bronze mace
 *    and bronze axe"), dropping one whose words are all in another's (Bronze Mace in Heavy Bronze
 *    Mace); 3. every word asked is in the name ("flask": every flask). Else nothing: "bronze tube"
 *    is no recipe of the guild's, so it isn't every bronze one either.
 */
function bestFits<R extends RecipeRef>(
  words: readonly string[],
  named: readonly Named<R>[],
  only: 'exact' | 'any' = 'any',
): RecipeMatch<R>[] {
  const asked = words.filter((word) => significant(word) && !FILLER.has(word));
  if (asked.length === 0) return [];
  const all = fits(asked, named);
  const exact = all.filter((fit) => fit.complete && fit.covers).sort(byFit);
  if (exact.length > 0) {
    const least = exact[0].typos;
    return exact
      .filter((fit) => fit.typos === least)
      .map((fit) => ({ recipe: fit.recipe, score: fit.typos, complete: true }));
  }
  if (only === 'exact') return [];
  const inFull = all.filter((fit) => fit.complete);
  if (inFull.length > 0) {
    const kept = inFull.filter(
      (fit) =>
        !inFull.some(
          (other) =>
            other !== fit &&
            other.words.length > fit.words.length &&
            fit.words.every((word) => other.words.includes(word)),
        ),
    );
    return kept
      .sort((a, b) => b.words.length - a.words.length || byFit(a, b))
      .map((fit) => ({ recipe: fit.recipe, score: fit.typos, complete: true }));
  }
  return all
    .filter((fit) => fit.covers)
    .sort((a, b) => a.words.length - b.words.length || byFit(a, b))
    .map((fit) => ({ recipe: fit.recipe, score: fit.typos, complete: false }));
}

/**
 * The recipes `question` is about, the best first: those it links to; else a name it gives in full
 * (`[Flask of the Titans]`, typos allowed; nothing when the guild can't craft it); else the best
 * match of its words (see `bestFits`), after the phrase, else before it, else in the next or the
 * previous sentence.
 */
export function matchRecipes<R extends RecipeRef>(
  question: CrafterQuestion,
  recipes: readonly R[],
): RecipeMatch<R>[] {
  const linked = recipes.filter((recipe) =>
    question.links.some((link) => link.kind === recipe.kind && link.id === recipe.id),
  );
  if (linked.length > 0) return linked.map((recipe) => ({ recipe, score: 0, complete: true }));

  const named: Named<R>[] = recipes
    .filter((recipe) => recipe.name)
    .map((recipe) => ({ recipe, words: wordsOf(recipe.name!).filter(significant) }))
    .filter(({ words }) => words.length > 0);

  for (const name of question.names) {
    const exact = wordsOf(name).join(' ');
    const same = named.filter(({ recipe }) => wordsOf(recipe.name!).join(' ') === exact);
    if (same.length > 0) return same.map(({ recipe }) => ({ recipe, score: 0, complete: true }));
    const found = bestFits(wordsOf(name), named, 'exact');
    if (found.length > 0) return found;
  }
  // An item it links or names in full ([Ez-Thro Dynamite]) that the guild can't craft: no answer,
  // rather than other recipes sharing one of its words (Coarse Dynamite).
  if (question.links.length > 0 || question.names.length > 0) return [];

  for (const words of question.words) {
    const found = bestFits(words, named);
    if (found.length > 0) return found;
  }
  return [];
}

/**
 * Who wrote a message relayed from the game by a bot or a webhook: the webhook's name, else the
 * name it starts with ("Svajone: …", "[Svajone]: …", "**Svajone**: …", "[G] Svajone: …"). The
 * realm after a dash is dropped. Returns the names to look for, and the text without its name.
 */
export function relayedAuthor(
  text: string,
  webhookName: string | null,
): { names: string[]; text: string } {
  const names: string[] = [];
  let rest = text;
  const prefixed =
    /^\s*(?:\[[^\]]{1,12}\]\s*)?(?:\*\*|__)?\[?([\p{L}][\p{L}'-]{1,23}(?: [\p{L}][\p{L}'-]{1,23})?)\]?(?:\*\*|__)?\s*:\s+([\s\S]*)$/u.exec(
      text,
    );
  if (prefixed) {
    names.push(prefixed[1]);
    rest = prefixed[2];
  }
  if (webhookName) names.unshift(webhookName);
  const cleaned = names
    .map((name) => name.split('-')[0].trim())
    .filter((name, i, all) => name.length >= 2 && all.indexOf(name) === i);
  return { names: cleaned, text: rest };
}
