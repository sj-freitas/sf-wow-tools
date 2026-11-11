// Reads CSV (RFC 4180: fields in double quotes may hold commas, line breaks and "" for a quote), as
// wago.tools exports the game's data tables. Rows come back as objects keyed by the header.

export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c !== '"') field += c;
      else if (text[i + 1] === '"') {
        field += '"';
        i++;
      } else quoted = false;
    } else if (c === '"') quoted = true;
    else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (c !== '\r') field += c;
  }
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  const [header = [], ...data] = rows;
  return data
    .filter((values) => values.length > 1 || values[0] !== '')
    .map((values) => Object.fromEntries(header.map((name, i) => [name, values[i] ?? ''])));
}
