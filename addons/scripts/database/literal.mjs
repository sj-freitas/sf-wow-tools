// Reads a JavaScript value written as a literal in a page's script, without running it: Wowhead's
// pages hold their data as `var listviewspells = [{…}];`, mostly JSON but with some keys unquoted
// (`quality:2,popularity:94`), so JSON.parse alone can't. Objects, arrays, strings (" or '),
// numbers, true, false, null and undefined; anything else is an error.

const WHITESPACE = /\s/;
const IDENTIFIER_START = /[A-Za-z_$]/;
const IDENTIFIER = /[\w$]/;
const ESCAPES = { n: '\n', r: '\r', t: '\t', b: '\b', f: '\f', v: '\v', 0: '\0' };

/**
 * The value written at `text[start]` (leading whitespace skipped), and the index just after it.
 * Throws when the text there isn't a literal.
 */
export function parseLiteral(text, start = 0) {
  let i = start;

  const fail = (what) => {
    throw new Error(`${what} at ${i}: ${JSON.stringify(text.slice(i, i + 40))}`);
  };
  const skip = () => {
    while (i < text.length && WHITESPACE.test(text[i])) i++;
  };

  function string() {
    const quote = text[i++];
    let out = '';
    while (i < text.length && text[i] !== quote) {
      const c = text[i++];
      if (c !== '\\') {
        out += c;
        continue;
      }
      const e = text[i++];
      if (e === 'u') {
        out += String.fromCharCode(parseInt(text.slice(i, i + 4), 16));
        i += 4;
      } else if (e === 'x') {
        out += String.fromCharCode(parseInt(text.slice(i, i + 2), 16));
        i += 2;
      } else {
        out += ESCAPES[e] ?? e;
      }
    }
    if (text[i] !== quote) fail('Unterminated string');
    i++;
    return out;
  }

  function identifier() {
    const from = i;
    while (i < text.length && IDENTIFIER.test(text[i])) i++;
    return text.slice(from, i);
  }

  function number() {
    const match = /^-?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/.exec(text.slice(i, i + 40));
    if (!match) fail('Bad number');
    i += match[0].length;
    return Number(match[0]);
  }

  function value() {
    skip();
    const c = text[i];
    if (c === '{') return object();
    if (c === '[') return array();
    if (c === '"' || c === "'") return string();
    if (c === '-' || c === '.' || (c >= '0' && c <= '9')) return number();
    if (c && IDENTIFIER_START.test(c)) {
      const word = identifier();
      if (word === 'true') return true;
      if (word === 'false') return false;
      if (word === 'null') return null;
      if (word === 'undefined') return undefined;
      i -= word.length;
      fail(`Not a literal (${word})`);
    }
    fail('Unexpected character');
  }

  function object() {
    i++; // {
    const out = {};
    for (;;) {
      skip();
      if (text[i] === '}') {
        i++;
        return out;
      }
      let key;
      if (text[i] === '"' || text[i] === "'") key = string();
      else if (IDENTIFIER.test(text[i] ?? '')) key = identifier();
      else fail('Bad key');
      skip();
      if (text[i] !== ':') fail('Expected ":"');
      i++;
      out[key] = value();
      skip();
      if (text[i] === ',') i++;
      else if (text[i] !== '}') fail('Expected "," or "}"');
    }
  }

  function array() {
    i++; // [
    const out = [];
    for (;;) {
      skip();
      if (text[i] === ']') {
        i++;
        return out;
      }
      out.push(value());
      skip();
      if (text[i] === ',') i++;
      else if (text[i] !== ']') fail('Expected "," or "]"');
    }
  }

  const result = value();
  return { value: result, end: i };
}
