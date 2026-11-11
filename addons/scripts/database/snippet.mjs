// The browser half of the database job. Wowhead turns away scripts (its pages answer 403 to
// anything that isn't a browser), so the pages are read by your own browser: this prints a snippet
// to paste in the browser's console on a www.wowhead.com page. It opens each profession's pages
// one at a time (a pause between them, like browsing), keeps their data scripts and downloads
// them as one file, wowhead-<version>.json; `npm run database` turns that into the addon's data.
//
//   npm run database:snippet | pbcopy      (Mac: straight to the clipboard)
//   npm run database:snippet -- classic    Wowhead's Classic Era data instead of Forever's
import { fileURLToPath } from 'node:url';
import { DEFAULT_VERSION, PROFESSIONS } from './professions.mjs';

/** The code to paste in the console; `download: false` keeps the file on window.guildAssistantDatabase only. */
export function snippet({ version = DEFAULT_VERSION, professions = PROFESSIONS, delayMs = 1500, download = true } = {}) {
  const pages = professions.flatMap((p) =>
    ['spells', 'recipes'].filter((kind) => p[kind]).map((kind) => ({ profession: p.name, kind, path: p[kind] })),
  );
  return `// GuildAssistant Database: reads Wowhead's profession pages (${version}) and saves them as wowhead-${version}.json.
(async () => {
  const VERSION = ${JSON.stringify(version)};
  const PAGES = ${JSON.stringify(pages)};
  if (!/(^|\\.)wowhead\\.com$/.test(location.hostname)) throw new Error('Run this on a www.wowhead.com page.');
  const wanted = /var listview\\w+ = |WH\\.Gatherer\\.addData\\(/;
  const pages = [];
  for (const [n, page] of PAGES.entries()) {
    const url = location.origin + '/' + VERSION + '/' + page.path;
    console.log('GuildAssistant Database: ' + (n + 1) + '/' + PAGES.length + ' ' + page.profession + ' (' + page.kind + ')');
    const response = await fetch(url, { credentials: 'include' });
    if (!response.ok) throw new Error(url + ': HTTP ' + response.status);
    const html = new DOMParser().parseFromString(await response.text(), 'text/html');
    const scripts = [...html.scripts].map((s) => s.textContent).filter((text) => wanted.test(text));
    pages.push({ profession: page.profession, kind: page.kind, url, scripts });
    if (n + 1 < PAGES.length) await new Promise((done) => setTimeout(done, ${delayMs}));
  }
  const data = JSON.stringify({ source: 'wowhead', version: VERSION, fetched: new Date().toISOString(), pages });
  window.guildAssistantDatabase = data;
  if (${download}) {
    const link = document.createElement('a');
    link.href = URL.createObjectURL(new Blob([data], { type: 'application/json' }));
    link.download = 'wowhead-' + VERSION + '.json';
    document.body.appendChild(link);
    link.click();
    link.remove();
  }
  console.log('GuildAssistant Database: done, ' + pages.length + ' pages (' + Math.round(data.length / 1024) + ' KB). Now, in addons/: npm run database');
})();
`;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const version = process.argv[2] ?? DEFAULT_VERSION;
  process.stdout.write(snippet({ version }));
}
