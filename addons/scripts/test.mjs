// Runs the addons' Lua tests (dev/**/*.spec.lua) in fengari, Lua written in JavaScript, so no Lua
// needs installing. The specs are plain Lua and also run with a real one (lua dev/…spec.lua, from
// addons/). Tests live in dev/, outside the addon folders, so they are never packaged.
//
//   npm test                 every spec
//   npm test -- raid         only specs whose path contains "raid"
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import fengari from 'fengari';

const { lua, lauxlib, lualib, to_luastring, to_jsstring } = fengari;
const root = fileURLToPath(new URL('..', import.meta.url));
process.chdir(root); // specs load the addon by paths relative to addons/

const specs = readdirSync(join(root, 'dev'), { recursive: true })
  .filter((path) => path.endsWith('.spec.lua'))
  .map((path) => join('dev', path))
  .filter((path) => process.argv.slice(2).every((filter) => path.includes(filter)))
  .sort();

let failed = 0;
for (const spec of specs) {
  console.log(`\n${relative(root, spec)}`);
  const L = lauxlib.luaL_newstate();
  lualib.luaL_openlibs(L);
  // fengari has no io.open: specs read files with readfile(path) when it is there.
  lua.lua_pushjsfunction(L, (state) => {
    const path = to_jsstring(lauxlib.luaL_checkstring(state, 1));
    lua.lua_pushstring(state, to_luastring(readFileSync(path, 'utf8')));
    return 1;
  });
  lua.lua_setglobal(L, to_luastring('readfile'));
  // A spec fails by raising an error (or os.exit(1), which ends the run there).
  if (
    lauxlib.luaL_loadfile(L, to_luastring(spec)) !== lua.LUA_OK ||
    lua.lua_pcall(L, 0, 0, 0) !== lua.LUA_OK
  ) {
    failed++;
    console.log(`  error: ${to_jsstring(lua.lua_tostring(L, -1))}`);
  }
}
if (specs.length === 0) console.log('No specs found.');
process.exitCode = failed > 0 ? 1 : 0;
