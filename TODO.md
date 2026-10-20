- Addon
    - Done: Raid Sort (addons/Raidsort) sorts groups and auto-invites (Invite & Sort)
- Bot
    - Prompts user to register their characters
        - Class;Specs;Main Spec;
        - Partly: signing up with no character links to the backoffice's add-character page
    - Character registration via WoW Armory API: see "Armory" below (waits on Forever's armory)
    - Discord Commands
        - Done: /list-players
    - Backoffice
        - Done: Discord login


- Armory (no correct Forever integration yet)
    - "Open in armory" (roster ⋯ menu) is in place but Forever has no armory yet: it says
      "This feature doesn't exist on Forever yet". When the Forever armory exists, set the real
      `armoryLink` in discord/assistant-api/src/game/forever/config.ts and remove `armoryPending`
      there; the menu then opens the character's page, and the `roster[i].armoryLink` post tag
      follows the same link.
    - The lookup that fills race, class and level (character form, Officers, marked TEST in
      discord/assistant-backoffice/src/CharacterForm.tsx) reads a stand-in armory
      (discord/assistant-api/src/armory/armory.config.ts), not Forever's. Point it at the Forever
      armory once there is one, then drop the TEST label and offer it to everyone.
    - /character-add still takes class + role by hand and leaves level at 1: fill them from the
      armory once the Forever lookup works.

- Guild setup
    - Done: realms come from the game config (per version and region; Forever's rulesets), picked in
      the create guild / settings forms and validated by the API
    - Done: old guild addresses (before a rename, or a realm/region/version change) redirect to the
      current one (guild_path_aliases; the server redirects page loads, the backoffice in-app links)
- Infrastructure
    - Replace the in-memory caches with a shared one (looking into Redis)
        - The server-side cache (discord/assistant-api/src/cache) is ready for it: write a Redis
          `CacheStore` and provide it in `CacheModule`
        - Guild ranks cache (discord/assistant-api/src/guilds/ranks.service.ts, `ranksCacheMs`)
        - In-flight Discord syncs per user (`inFlightSyncs` in auth.service.ts)
        - Live updates event bus (realtime.service.ts): also per-process, Redis pub/sub would allow several API instances
        - Until then everything assumes a single API instance

Notes:
    Domain: guildassistant.app

---

# Background worker + scheduled tasks (Guild Assistant)

Status: scheduled post (phase 1 and 2), honeypot (phase 4, test mode by default) and channel cleanup (phase 3, the Channel Clean Up plugin) are built; the raid (phase 5) is not. See discord/assistant-api/README.md.

## Context
- Monorepo: `discord/assistant-api` (NestJS 12, Prisma/Postgres on Supabase, discord bot via HTTP
  Interactions; the worker adds a gateway connection for honeypots), `discord/assistant-backoffice` (React/Vite). Deployed as one web
  service on Render (root Dockerfile).
- Existing concepts to reuse: Guild (name, realm, faction, gameVersion), DiscordServer with a "main"
  server, Guild-Assistant role (creates/configures guilds), Officer role (mapped to a Discord role in
  the main server; manages characters and the guild), members, Raider/Social role mappings,
  live updates over SSE (`GET /api/events`, in-memory bus), an in-memory ranks cache.
- Known debt: in-memory caches/event bus are single-instance. A shared solution (Redis, or Postgres
  LISTEN/NOTIFY) is being evaluated by the owner; do not decide it silently.
- Bot-token Discord calls for the worker live in `DiscordBotService` (uses `@discordjs/rest`, which
  handles rate limits); `DiscordOAuthService` still has its own copies for the login flow.

## Goal
A background worker that runs tasks defined by Officers in the backoffice. It is an internal
mechanism: officers only ever see tasks described in their own terms (what, where, when), never
"jobs", "ticks" or worker state.

## Worker
- Separate entrypoint (`worker.ts`), same codebase and database, deployed as its own always-on
  service (or, on a single instance, `WORKER_IN_PROCESS=true` on the web service). It has two parts:
  a scheduler and a Discord gateway listener (non-privileged intents only: guilds and guild
  messages; no Message Content).
- Schedules live in Postgres, not memory: `scheduled_tasks` (guild, type, enabled, schedule,
  `next_run_at`, last status/error, per-type JSONB config validated in code) and `task_runs` (history).
- Every minute: claim due rows with `FOR UPDATE SKIP LOCKED` + a lease, execute, compute the next
  run. Safe with several workers.
- Each task type is a handler (validate config, execute).
- A unique key on (task, scheduled_for) guarantees one run per occurrence; failures retry with
  backoff and are shown to the officer in plain language.
- Missed runs: no grace window. Whoever is running checks for missed runs and executes them, late
  rather than never. A recurring task catches up with one run (no burst of duplicates); the skipped
  occurrences in between are recorded as missed.
- Discord has no webhooks for reactions/messages; real-time events come from the gateway. Data the
  worker produces reaches browsers by polling until a shared bus exists (see Context).

## Guild options (new)
- `region` (EU | US), defined in a code config (`src/config/regions.ts`): each region has a label and
  a default IANA timezone. EU = `Europe/Paris`, US = `America/Los_Angeles`. All schedules are
  interpreted in the guild's region timezone (DST handled). Editable by Officers.

## Backoffice: one tab per feature ("Posts", "Honeypots", later more)
- Per guild, Officers only (Guild-Assistants who are not Officers cannot create them). Posts are
  listed ten to a page, newest date first, with a search over name and text across all pages.
- Pickers (channels, roles) are fed by the bot's REST access.
- Later: before saving, check the bot has the permissions the task needs in that channel and say
  what is missing.

## Task types
### 1. Post
- Markdown message posted once to a chosen channel at a chosen time. One post = one database row =
  one Discord message; no recurring posts (recurring events are a separate, future flow).
- Actions: Post now, Pause/Resume, Edit (live edit while posted), Delete post (removes the Discord
  message, keeps the post), Untrack (removes it from the database; the message stays in Discord).
- Editor with a Discord-markdown preview (render user/role/channel mentions where known).
- After posting, the bot stores the message id and tracks it:
  - Live edit: saving new text in the backoffice edits the Discord message. If it was deleted in
    Discord, mark it and offer to re-post.
  - Reaction counter per emoji, shown live in the backoffice (usable for polls). Polling
    `GET /channels/{c}/messages/{id}` from the API while the panel is open; gateway events later.
  - Optional seed reactions added by the bot.

### 2. Weekly raid (DEFERRED, TODO)
- Ideally an integration with the Raid-Helper bot. Do not design or build now; keep it on the TODO.
- Any "delete messages every day in the raid channel" need is just a task 3 cleanup.

### 3. Channel cleanup (done: the Channel Clean Up plugin, see the API README's "Plugins")
- Deletes all non-pinned messages in a channel on a schedule (e.g. daily at 02:00 guild time),
  optionally keeping the bot's own messages.
- Bulk delete for messages under 14 days old (batches of up to 100); older ones individually.
  Use a time budget per run and a saved cursor to continue next run.

### 4. Honeypot channel
- The bot uses an existing channel or creates one, with an officer-defined description (topic) and
  initial post (defined in the backoffice). The guild must have an Officer role configured first.
- Anyone who posts there is permanently banned, and their messages from the last hour are deleted
  (ban with `delete_message_seconds = 3600`), unless they hold the guild's Officer role or are the
  bot itself. Extra default exemptions: other bots, the server owner, Administrators.
- Test mode: a flag chosen when creating the honeypot (on by default). In test mode nothing is
  banned or deleted; the bot only writes to the log channel what it would have done.
- A log channel is set per honeypot. In live mode every action is logged there too and stored in an
  audit table.
- Needs the gateway listener (react to a post immediately).

## Safety and Discord constraints
- Destructive tasks (cleanup, honeypot live mode) need an explicit confirmation when created.
- Respect rate limits; never delete pinned messages; bans cannot exceed the bot's role position.
- Bot permissions needed: Send Messages, Manage Messages, Read Message History, Manage Channels,
  Ban Members.

## Suggested phases
1. Scheduler core, region/timezone guild option, scheduled post with preview, run history.
2. Live edit and reaction tracking.
3. Channel cleanup.
4. Gateway listener + honeypot (test mode first).
5. Raid-Helper integration (deferred).

## Still open
- Choice of shared bus (Redis vs Postgres LISTEN/NOTIFY).
