# TODO

The task board is [Botlog](https://bot-log-six.vercel.app/projects/GA) (project **GA**). This file is
a short overview of what is open; details live in the tasks.

## Open

**Discord Bot**

- [GA-12](https://bot-log-six.vercel.app/projects/GA/tasks/GA-12) Prompt members to register their
  characters (class, specs, main spec). Partly done: signing up without a character links to the
  backoffice's add-character page.
- [GA-14](https://bot-log-six.vercel.app/projects/GA/tasks/GA-14) Weekly raids through the
  Raid-Helper bot. Not designed yet.

**Armory** (see "Armory" below)

- [GA-4](https://bot-log-six.vercel.app/projects/GA/tasks/GA-4) Switch to the Forever armory once it
  exists.
- [GA-5](https://bot-log-six.vercel.app/projects/GA/tasks/GA-5) Profession integration.
- [GA-13](https://bot-log-six.vercel.app/projects/GA/tasks/GA-13) Fill `/character-add` and character
  registration from the armory.
- [GA-17](https://bot-log-six.vercel.app/projects/GA/tasks/GA-17) Remove the hardcoded Wild Growth
  (SoD) armory stand-in. Its links leak into Discord posts through `roster[i].armoryLink`.

**Raids**

- [GA-8](https://bot-log-six.vercel.app/projects/GA/tasks/GA-8) Post assignments automatically an hour
  before a raid.
- [GA-9](https://bot-log-six.vercel.app/projects/GA/tasks/GA-9) Plugins for raids.
- [GA-10](https://bot-log-six.vercel.app/projects/GA/tasks/GA-10) Buff tracking in the roster (missing
  buffs, buff assignments).

**Backoffice**

- [GA-3](https://bot-log-six.vercel.app/projects/GA/tasks/GA-3) Recurring events.
- [GA-18](https://bot-log-six.vercel.app/projects/GA/tasks/GA-18) Sign-up events in the MCP
  integration (list, read and create events from an AI app).
- [GA-15](https://bot-log-six.vercel.app/projects/GA/tasks/GA-15) Before saving a post, honeypot or
  plugin, check the bot has the permissions it needs in that channel.

**Addon**

- [GA-6](https://bot-log-six.vercel.app/projects/GA/tasks/GA-6) Rewrite the addon docs.

**Infrastructure and other**

- [GA-1](https://bot-log-six.vercel.app/projects/GA/tasks/GA-1) Google Search Console flags the site
  as unsafe (in progress).
- [GA-16](https://bot-log-six.vercel.app/projects/GA/tasks/GA-16) Run the API on more than one
  instance. The server-side cache uses Redis (Render Key Value) when `REDIS_URL` is set; the ranks
  cache, in-flight Discord syncs and the live updates bus are still per process.

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
