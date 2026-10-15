// Copies what isn't TypeScript from src/game/ to dist/game/ after `tsc` (which only emits .js):
// the class icons in each version's class-icons/ folder. Run by `npm run build`.
const { cpSync, existsSync } = require('node:fs');
const { extname, join } = require('node:path');

const from = join(__dirname, '..', 'src', 'game');
const to = join(__dirname, '..', 'dist', 'game');
if (existsSync(from)) {
  cpSync(from, to, {
    recursive: true,
    filter: (source) => !['.ts', '.md'].includes(extname(source)),
  });
}
