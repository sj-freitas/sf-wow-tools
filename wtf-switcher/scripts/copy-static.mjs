// The window's page and styles go next to its compiled script (dist/renderer).
import { copyFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
mkdirSync(join(root, 'dist', 'renderer'), { recursive: true });
for (const file of ['index.html', 'styles.css']) {
  copyFileSync(join(root, 'src', 'renderer', file), join(root, 'dist', 'renderer', file));
}
