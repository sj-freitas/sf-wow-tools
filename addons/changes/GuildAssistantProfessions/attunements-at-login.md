---
bump: patch
---

- **Attunements are read as soon as the game can answer**: the quests a character has completed
  reach the client a moment after login, so they are read again when the quest log arrives and a
  few seconds later. No more logging in, or `/reload`ing, to be recorded as attuned.
- A raid is only recorded as **not** attuned once the game has sent the character's quests: until
  then it stays "nobody has looked", so nobody is shown -- or shared with the guild -- as unattuned
  when they simply hadn't been asked yet.
