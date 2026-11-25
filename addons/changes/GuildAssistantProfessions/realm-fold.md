---
bump: patch
---

- **The copies 1.7.1 left behind are folded back in.** 1.7.2 stopped new ones being saved, but a
  client that doesn't name the realm at all couldn't tidy up the ones already there. A copy saved
  without a realm now goes back into the character's own entry -- the entry of the same name that
  has a realm says which realm that is, so it works whatever the client says -- and keeps every
  profession, recipe and attunement either of them had.
- **A character is still recorded and shared when the client names no realm at all**: the realm it
  is already saved on is the one it keeps. Without that, a client gone quiet would record nothing
  and share nothing with the guild.
- **`/ga-prof status` says which realm your characters are keyed by** and what the client answered
  when asked, so a client that won't say is plain to see rather than something to guess at.
- **A guildmate's old copy of your character under its first name alone** ("Shivan" where you are
  "Shivan Darkwhisp") is dropped and no longer taken back: it was listed and counted as another
  player.
