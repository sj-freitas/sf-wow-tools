# Guild Assistant Professions

## 0.1.0

- First version (experimental): remembers every character's professions and recipes, and those of
  profession links you open, for Guild Assistant. The export is kept in the saved variables file,
  which is uploaded on the website: `/ga-prof log` writes it, `/ga-prof status` says what is saved,
  when, and where.
- Says "Loaded." at login, and reports its errors in the chat (the game hides them by default).
- Reads WoW Forever's client, which has the modern API (`GetProfessions`, `C_TradeSkillUI`) and
  not Classic Era's; an event the client lacks no longer stops the addon.
