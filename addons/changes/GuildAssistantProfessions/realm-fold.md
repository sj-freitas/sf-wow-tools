---
bump: patch
---

- **The copies 1.7.1 left behind are folded back in.** 1.7.2 stopped new ones being saved, but a
  client that doesn't name the realm at all couldn't tidy up the ones already there. Now a copy
  saved without a realm goes back into the character's own entry whatever the realm is called,
  keeping every profession, recipe and attunement either of them had.
- **The realm is asked for every way the client has** (`GetRealmName`, `GetNormalizedRealmName`,
  your full name, the realm list), not just the one, and `/ga-prof status` says which realm your
  characters are keyed by and what the client answered.
- **A guildmate's old copy of your character under its first name alone** ("Shivan" where you are
  "Shivan Darkwhisp") is dropped and no longer taken back: it was listed and counted as another
  player.
