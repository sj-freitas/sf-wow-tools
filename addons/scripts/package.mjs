// Zips each addon for release: dist/<Name>-<version>.zip, with the addon's folder inside (what goes
// into Interface/AddOns). Only the addon's own folder is packaged; tests and scripts stay out.
//
//   npm run package              every addon
//   npm run package -- Raidsort  just that one
import { findAddons, packageAddon } from './addons.mjs';

for (const addon of findAddons(process.argv.slice(2))) {
  const { relativePath, files } = packageAddon(addon);
  console.log(`${relativePath}  (${files.length} files)`);
  for (const file of files) console.log(`  ${file}`);
}
