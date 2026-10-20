# TODO

The task board is Botlog (project **GA**). This file is a short overview; details live in the tasks.

## Open

- **Bot:** prompt members to register their characters (class, specs, main spec). Partly done: signing
  up without a character links to the backoffice's add-character page. (GA-12)
- **Armory:** switch to the Forever armory once it exists (see "Armory" below). (GA-4, GA-13)
- **Raids:** weekly raid integration with the Raid-Helper bot. Not designed yet. (GA-14)
- **Backoffice:** before saving a post, honeypot or plugin, check the bot has the permissions it
  needs in that channel. (GA-15)
- **Infrastructure:** shared cache and event bus so the API can run on more than one instance.
  Undecided: Redis (Render Key Value) or Postgres `LISTEN/NOTIFY`. (GA-16)

## Armory

Forever has no armory yet, so the app uses a stand-in. When the Forever armory exists:

1. In `discord/assistant-api/src/game/forever/config.ts`, set the real `armoryLink` and remove
   `armoryPending`. The roster's "Open in armory" and the `roster[i].armoryLink` post tag then use it.
2. Point the character lookup (`discord/assistant-api/src/armory/armory.config.ts`) at it, then drop
   the TEST label in `discord/assistant-backoffice/src/CharacterForm.tsx` and offer it to everyone.
3. Fill class, role and level in `/character-add` from the armory instead of asking for them.

## Notes

- Domain: guildassistant.app
- How the background worker, posts, honeypots and plugins work: `discord/assistant-api/README.md`.
