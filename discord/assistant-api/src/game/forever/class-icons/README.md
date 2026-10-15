# Class icons

Put one image per class here, named after the class exactly as in `../config.ts`:
`Druid.png`, `Hunter.png`, `Mage.png`, `Paladin.png`, `Priest.png`, `Rogue.png`, `Shaman.png`,
`Warlock.png`, `Warrior.png`.

- PNG, JPEG or GIF, at most 256 KB (Discord's emoji limit). Square, around 128×128, looks best.
- Sign-ups show them in place of the class name: the bot uploads each one as a Discord emoji of
  the application (a new image is uploaded as a new emoji), and the website shows the same file.
- A class without an icon keeps its colour dot (`color` in `../config.ts`).
- Start-up stops with a clear error if a file isn't an image, is too big, or isn't named after a
  class.
