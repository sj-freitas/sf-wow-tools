---
bump: patch
---

- **A character is no longer saved twice.** On WoW Forever the client doesn't always say which
  realm you're on by the time you log in, and 1.7.1 then saved the character a second time under a
  name with no realm after it -- listed apart from itself, shared with the guild and uploaded as if
  it were somebody else. The realm the game last named is remembered and used, and the stray copies
  already saved are folded back into the character they belong to.
