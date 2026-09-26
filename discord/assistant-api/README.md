# assistant-api

A NestJS app that is **both** the REST API used by [`assistant-backoffice`](../assistant-backoffice)
and the Discord bot — one process, one Nest DI container, organized into modules by concern
(`players/` for data, `bot/` for everything Discord-specific). It's the only service that talks to
Postgres.

## Getting started

```bash
cp .env.example .env   # fill in DATABASE_URL, DISCORD_* (see below)
npm install
npm run prisma:generate
npm run prisma:migrate # applies prisma/migrations against your Supabase database
npm run commands:register
npm run start:dev
```

## Tests

`npm test` runs the specs (`src/**/*.spec.ts`) with Node's built-in test runner through ts-node;
no extra dependencies. They cover the permission rules, the Discord sync (roles, cooldown, expired
authorization), the character and guild rules, token encryption and name parsing.

## Scripts

| Script                            | Purpose                                             |
| --------------------------------- | --------------------------------------------------- |
| `npm run start:dev`               | Run the API with hot reload (`nodemon` + `ts-node`) |
| `npm run start:worker` / `:dev`   | Run the background worker (see below)               |
| `npm run build`                   | Compile TypeScript to `dist/`                       |
| `npm run start`                   | Run the compiled API from `dist/`                   |
| `npm run commands:register`       | Push `src/bot/commands.json` to Discord             |
| `npm run prisma:generate`         | Regenerate the Prisma client                        |
| `npm run prisma:migrate`          | Create/apply a dev migration                        |
| `npm run prisma:deploy`           | Apply pending migrations only (CI/production)       |
| `npm test`                        | Unit tests (Node test runner + ts-node)             |
| `npm run lint` / `lint:fix`       | ESLint (flat config, typescript-eslint)             |
| `npm run format` / `format:check` | Prettier                                            |

## Endpoints

| Method | Path                        | Purpose                                                        |
| ------ | --------------------------- | -------------------------------------------------------------- |
| GET    | `/api/guilds/:id/players`   | The guild's roster: its players only, any member of the guild  |
| GET    | `/api/auth/login`           | Starts "Login with Discord" (OAuth2, scopes `identify guilds`) |
| GET    | `/api/auth/callback`        | OAuth2 redirect target; creates the session cookie             |
| GET    | `/api/auth/me`              | Current user, or 401                                           |
| POST   | `/api/auth/logout`          | Destroys the session                                           |
| POST   | `/api/discord/interactions` | Discord's HTTP Interactions Endpoint — see below               |

Backoffice auth: Discord OAuth2 login using the **same Discord application** as the bot (add the
redirect URI under OAuth2 → Redirects; set `DISCORD_CLIENT_SECRET` and
`DISCORD_OAUTH_REDIRECT_URI`). On login, the user's Discord guilds are intersected with the `guilds`
table and stored in `guild_access`; a 7-day server-side session (`sessions`, httpOnly cookie) is
created. Guild membership is only refreshed at login. `/api/discord/interactions` has its own,
different auth: every request is signature-verified against `DISCORD_PUBLIC_KEY` (see below).

Everything not matching `/api/*` falls through to serving `assistant-backoffice`'s static build
(`public/`, populated by the root `Dockerfile`) — see `ServeStaticModule` in `app.module.ts`.

## The `bot/` module — Discord without a gateway connection

This bot **does not** open a WebSocket to Discord's gateway. Instead it uses Discord's
[HTTP Interactions Endpoint](https://discord.com/developers/docs/interactions/overview): Discord
POSTs every slash command invocation straight to `/api/discord/interactions`, signed with
Ed25519, and we're expected to answer within 3 seconds. That fits how this bot actually works —
it only handles slash commands (no message content, presence, or voice), so there's no need for a
persistent connection — and it means the bot needs no separate process, port, or container: it's
just another controller.

- `src/bot/commands.json` is the **source of truth** for command definitions (name, description,
  options). `npm run commands:register` (`src/bot/register-commands.ts`) pushes it to Discord's
  REST API — a one-off CLI script, not part of the running server, run manually whenever
  `commands.json` changes.
- `src/bot/decorators/command.decorator.ts` exposes `@Command('name')`, a method decorator
  (analogous to `@Get()`/`@Post()` on a controller) marking a provider method as the handler for
  that command name. See `src/players/players.command.ts` for the `list-players` example — it
  injects the same `PlayersService` the REST controller uses, no HTTP round-trip needed since
  everything's in one process.
- `src/bot/command-explorer.service.ts` uses Nest's `DiscoveryService` to scan every provider in
  the DI container on startup and register `@Command()`-decorated methods into
  `CommandRegistryService` — so adding a command elsewhere in the app (e.g. inside `PlayersModule`)
  needs no registration wiring here.
- `src/bot/discord-interactions.controller.ts` verifies the request signature (`discord-interactions`
  package, using Nest's `rawBody: true` option — see `main.ts` — so the exact raw bytes are
  available for verification alongside the normally-parsed JSON body), handles Discord's `PING`
  verification handshake, and dispatches `APPLICATION_COMMAND` interactions to
  `CommandRegistryService`, turning the returned string into a `CHANNEL_MESSAGE_WITH_SOURCE`
  response.

### Setting up the Discord application

1. In the [Developer Portal](https://discord.com/developers/applications), copy **Application ID**
   → `DISCORD_APPLICATION_ID`, **Public Key** → `DISCORD_PUBLIC_KEY`, and create/copy a **Bot
   Token** → `DISCORD_TOKEN`.
2. Run `npm run commands:register` (set `DISCORD_GUILD_ID` first for instant guild-scoped
   registration while developing; omit it for global registration, which can take up to an hour).
3. Set **Interactions Endpoint URL** (General Information tab) to
   `https://<your-deployment>/api/discord/interactions`. Discord will immediately send a test
   `PING` to verify it — the app must already be deployed and reachable for this to succeed.

### Guilds and access levels

The admin role name is a single setting, `adminRoleName` in `src/config/app.config.ts`
(`Guild-Assistant`). Access to a guild has three levels, combinable per user:

| Level                                         | How you get it                                                                            | What you can do                                                                                                                                                                                       |
| --------------------------------------------- | ----------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Guild-Assistant** (`guild_access.is_admin`) | Hold the role in **every** Discord server of the guild                                    | Create guilds; configure them: details, delete, add/remove servers, main server, Officer role. **Not** other people's characters                                                                      |
| **Officer** (`guild_access.is_officer`)       | Hold the guild's Officer role in its **main** server (the Guild-Assistant picks the role) | Add, edit and remove **every** player's characters, **and** configure the guild like a Guild-Assistant (except that adding a server still requires holding the Guild-Assistant role in _that_ server) |
| **Member** (any `guild_access` row)           | Be in any Discord server attached to the guild; no role needed                            | Add, edit and remove **your own** characters                                                                                                                                                          |

Officers being able to configure the guild is also the recovery path: because a Guild-Assistant needs
the role in _every_ server, a guild whose servers lose their role holders would otherwise be stuck.

The rules live in `src/auth/access-rules.ts` (pure functions, unit tested).

**Guild role mappings (optional):** besides the Officer role, an Officer can map two more guild roles,
**Raider** and **Social**, each to a role of the guild's main server
(`PUT /api/guilds/:id/role-mappings/RAIDER|SOCIAL`, `roleId: null` clears; role choices come from
`GET /api/guilds/:id/role-options`). They are stored in `guild_role_mappings` and shown in "Manage
guild" but don't grant anything or affect the roster yet; they're groundwork for roster setup. Like
the Officer role they belong to the main server, so changing the main server clears them.

**Rank column:** the character list shows a "Rank" per player: the guild roles they hold, as
Officer, Raider and/or Social, comma separated. It is worked out live from the player's Discord
roles in the main server (`GET /api/guilds/:id/ranks`, any guild member) and never stored. Discord's
member list is read once per request when the Server Members intent allows it, otherwise players are
looked up one by one (up to 100). Results are kept in memory for 60 seconds (`ranksCacheMs`) and
dropped whenever the guild's settings change.

Everyone with a `guild_access` row can see the guild's players. Changing the main server clears the
Officer role, since roles belong to a server. A guild always keeps at least one server and its main
server can't be removed directly.

- **Expired login:** if the session or the stored Discord token expires or Discord rejects it, the API
  ends the session and answers 401, and the backoffice sends the user through Discord login again
  (no consent screen if already approved). Transient Discord errors don't log anyone out.
- **Creating a guild:** any logged-in user (`POST /api/guilds`) picks name, realm, faction, game
  version and the Discord servers to attach, and which one is main. Only servers where the user holds
  the admin role, the bot is installed, and that don't belong to a guild yet are offered
  (`GET /api/guilds/eligible-servers`, after `POST /api/guilds/sync`). The creator becomes a Guild-Assistant of the new guild.
- **Player search:** `GET /api/guilds/:id/people` lists every human member of the guild's Discord
  servers (Discord's list-members endpoint, up to 10,000 per server) with their names and the names
  of their characters; the backoffice searches it, typo tolerant, when adding a character. This
  needs the **Server Members Intent** enabled for the application (Developer Portal → Bot →
  Privileged Gateway Intents; no gateway connection is used). Without it the search falls back to
  players we already know and says so. Adding by Discord ID only works for members of at least one of
  the guild's servers (checked with the bot token, which also gives the username). Discord usernames
  are stored on `players` when the bot sees the user, when a character is added, and lazily when
  players are listed.
- **How roles are read:** at login the API lists the bot's servers (bot token), and for each of the
  user's servers that the bot is in, reads the user's role ids (their token, scope
  `guilds.members.read`) and the server's roles (bot token). Officer status only needs the user's
  role ids in the main server. Results are stored in `guild_access` and `user_admin_servers`.

### Backoffice pages and routes

The backoffice is a single-page app with real addresses (the API serves `index.html` for any path
outside `/api`, so deep links and reloads work). `/` goes to the guild you last opened (remembered in
a cookie holding the guild id, so renaming a guild doesn't matter); with none, or one you have left,
it shows the **Overview** (`/overview`): your guilds, to pick one or add one. The **user menu** (top
right, your Discord username) links to the Overview, lists your guilds to switch between, adds a
guild, and logs out.

Every guild page lives under the guild's own address, built by the API (`path` on each guild):
`/<version>/<region>/<server>/<guild-name>`, all lower case with hyphens, for example
`/forever/eu/firemaw/relic-hunters`. "Server" is the WoW realm. Two guilds can't share an address:
the database keeps name, realm, game version and region unique and the API also compares names
ignoring case and punctuation, and renaming a guild moves its address (the
settings page follows it).

| Path                                 | Page                                          | Who                               |
| ------------------------------------ | --------------------------------------------- | --------------------------------- |
| `/`                                  | Your last guild, else `/overview`             | anyone logged in                  |
| `/overview`                          | Overview: your guilds                         | anyone logged in                  |
| `/guilds/create`                     | Set up a new guild                            | anyone logged in                  |
| `<guild>/`                           | Welcome: the guild's welcome post             | everyone in the guild             |
| `<guild>/edit`                       | Write the welcome post                        | Officers                          |
| `<guild>/roster`                     | Roster                                        | everyone in the guild             |
| `<guild>/roster/create`, `/edit/:id` | Add / edit a character                        | members: their own; Officers: any |
| `<guild>/posts?q=&page=`             | Posts (search and page in the address)        | Officers                          |
| `<guild>/posts/create`, `/edit/:id`  | New / edit post                               | Officers                          |
| `<guild>/honeypots`, `/create`       | Honeypots (`/honeypot` redirects)             | Officers                          |
| `<guild>/officer-requests`, `/:id`   | Members' messages to officers; officers reply | Officers                          |
| `<guild>/settings`                   | Guild settings, incl. the welcome post        | Guild-Assistants and Officers     |

Members only see Welcome and Roster in the navigation; opening any other page sends them to the guild's
welcome page. An address that isn't one of your guilds says so and links back to the Overview. Save and
Cancel on a create/edit page return to the list you came from, search included. After logging in
you land back on the page you were on.

**Welcome post.** Optional markdown text on the guild (`guilds.home_markdown`, null until an Officer
writes one), shown on the Welcome page to everyone in the guild (`GET /api/guilds/:id/home`) and written by
Officers only (`PUT /api/guilds/:id/home`, up to 10,000 characters; an empty text removes it), on the home page's edit link or in guild Settings, with a Preview toggle. It is
rendered with `react-markdown` (GitHub flavour) which only builds elements and never raw HTML, so
what an Officer writes can't inject scripts into what members see.

### Guild picture and banner

- The guild header shows the **picture of the guild's main Discord server** on the left, with the name
  above and "Realm · Faction · Version · Region" below. The icon hash is stored on each server
  (`discord_servers.icon`) and refreshed whenever a member's Discord sync runs (login, or a stale
  re-sync), so a newly added server shows its picture after the next sync. Servers without an icon
  show the guild's first letter.
- An optional **banner** goes above the guild name (Settings → Banner; Guild-Assistants and Officers).
  PNG, JPEG, GIF or WebP up to 2 MB; the type is checked from the file's bytes (SVG is refused as it
  can carry scripts). It is stored in the database (`guild_banners`) and served, to members of the guild
  only, by `GET /api/guilds/:guildId/banner?v=<version>`; `PUT` (raw image body) and `DELETE` on the same
  path set and remove it. Guild DTOs carry `bannerVersion` so a new banner is a new, cacheable URL.

### Buttons and forms (Discord components)

Clicks on message buttons and submitted pop-up forms (modals) arrive at the same interactions endpoint
as slash commands, so nothing extra is configured in the Developer Portal. Handlers are methods marked
`@Button('prefix')` or `@Modal('prefix')` (`src/bot/decorators/interaction-handler.decorator.ts`); the
button's `custom_id` is `<prefix>:<state>`. A button handler answers with a private message or opens a
modal; a modal handler answers with a private message. Unknown or failing buttons get a private
"no longer available" / "something went wrong".

- **Reply button** (`contact-reply:<guildId>:<conversationId>`) under an officer's answer in the
  member's DM: opens a "Your message" form and, on submit, runs the same code as `/contact-officer`
  with that conversation id (so the cooldown, length limit and lock apply). It first checks that the
  clicker started the conversation, so a forwarded DM can't be used by someone else.
- `npm run commands:register` also prints every command's id (the number in `</name:id>` mentions).

### Images in officer requests

- `/contact-officer` and `/contact-officer-reply` take an optional **`image`** (PNG, JPEG, GIF or WebP, up
  to 5 MB, one per message); the backoffice reply box has an **Attach image** button.
- The bot downloads the file (only from Discord's own CDN), checks its bytes, and re-uploads it under a
  neutral name (`image.png`) in the request channel and in the member's DM, so the member's file name
  never shows. **Metadata inside the picture (EXIF, what the picture shows) is not removed**, so an
  anonymous sender can still be identified by the picture itself.
- Discord's file links expire, so a copy is also kept in `officer_attachments` (one per message, deleted
  with the message and the conversation). The backoffice shows it from
  `GET /api/guilds/:guildId/officer-requests/:id/messages/:messageId/image` (Officers only).
- Because the image is downloaded and posted before the command answers, a slow Discord can make the
  3-second limit tight for big files.

### Live reactions in a post's text

A post's text can show who reacted to a message:
`{{reactions sourcePost="Raid signup" emoji=👍 show="reactions.map((r) => r.displayName)"}}`.

- **`sourcePost`** says which message to read: its Discord **message id** (Copy Message ID, or **Copy ID** on
  a live post) for any message in one of the guild's servers, a **link** (Copy Message Link; the way to
  reach a message in a thread), or the **name** of a scheduled post of the guild (case does not matter;
  it must be unique). Leave it out for the post the text is in. A bare id says which message but not
  which channel, so on save it is looked for: first among the bot's own posts, then in every text channel
  of the guild's servers that the bot can see (8 channels at a time, stopping when found), and remembered
  as channel + message so the search happens once. A link is refused unless its server belongs to the
  guild, its channel really is in that server and the bot can read the message (View Channel + Read
  Message History, which the invite link grants). So a post can show the reactions of messages nobody
  scheduled here, e.g. a Raid-Helper signup or an officer's own message.
- **`emoji`** is 👍 or a server emoji `<:name:id>` (or `<a:name:id>`; type `\:emoji:` in Discord to get
  it). Custom emoji are stored as `name:id`, and the reactions of any emoji on the message can be read,
  whichever server it comes from.
- **`show`** is a **JavaScript expression** (there are no keywords), evaluated with `reactions`: an array
  with one object per person who reacted:
  `{ id, tag, name, displayName, characters }`. `tag` is `<@id>`; `name` the Discord name (global display
  name, else username; never the id, which is `id`); `displayName` the nickname they have in the
  message's server, else `name`; `characters` their characters in the guild (an empty array if none),
  main first, each `{ name, firstName, lastName, isMain, class, roles, level }` (`name` is
  "Merric Stone", `roles` a list of "Tank", "Healer", "Melee DPS", "Ranged DPS"). Left out, `show` is
  `reactions.map((r) => r.name)`. An array result is joined with ", ". Examples: `reactions.length`,
  `reactions.map(r => r.tag)`, `reactions.map(r => (r.characters.find(c => c.isMain) || r).name)` (the
  main, else the Discord name), `reactions.flatMap(r => r.characters).filter(c => c.roles.includes('Tank')).map(c => c.name)`.
  Options may come in any order; a value with spaces goes in quotes, inside which `}}` and `${…}` are
  just text (use `\"` for a double quote, or single quotes). Up to 5 tags per post; a wrong tag, an
  unknown source or an ambiguous name is refused on save.
- **Sandbox:** expressions run in QuickJS (a JavaScript engine compiled to WebAssembly, via
  `quickjs-emscripten`), not in Node: no files, network, `process` or `require`, a fresh engine for every
  evaluation, stopped after 100 ms and 16 MB. Each expression is run once on sample data when the post is
  saved, so a syntax error or an unknown name is refused with its reason; a failure that only happens with
  real data shows in the post as `⚠️ (TypeError: …)` instead of breaking it. It only runs when the people
  changed (the hash), so the cost is small.
- **Tracking:** saving a post keeps one `post_tracking` row per source and emoji in line with its text
  (rows appear, stay or go with the tags; deleting a post removes them). A row remembers how the text
  pointed at the message (`post_ref`) and which one that was when saved (a scheduled post, or the channel
  and message ids), so renaming the other post does not break a post that is already up; saving the text
  again looks the name up afresh. The post's text is the _template_; what is in Discord is kept in the
  task state (`renderedContent`).
- **Refreshing:** every scheduler tick (a minute) the worker reads, for each tracked post that is in
  Discord, who reacted (the bot's own reaction left out), looks up their characters in the database
  (no Discord calls) and hashes the list. Only when the hash changed (someone reacted, un-reacted,
  renamed, or a character of theirs changed) is the message edited, and only if the rendered text really changed. Edits
  that show people never ping them. A scheduled post is rendered right before it goes out. A message
  longer than 2000 characters is cut. Names come free with Discord's reaction list (no server nicknames,
  which would need a lookup per person).
- **Backoffice:** clicking a reaction on a post shows who reacted. The post form has a collapsible
  "Live tags" help with this syntax, and the preview marks the tag (it cannot show real names).
  Tracking has no end date: remove the tag (or the post) to stop it.

### The guild roster in a post (`{{roster …}}`)

`{{roster show="roster.map((c) => c.name)"}}` in a message's text is replaced by whatever the
`show` expression makes of the guild's characters. It works like the reactions tags (same options
syntax, same QuickJS sandbox, checked on save with sample data, `⚠️ (…)` if it fails with real data).
Its only option is `show` (left out: every character's name); the list is called `roster`.

- **`roster`** is an array with one entry per character of the guild, sorted by name:
  `{ name, firstName, lastName, isMain, class, roles, level, discordUser }` (the same character fields as
  `characters` in a reactions tag). A character belongs to a player (`players.discord_user_id`), so
  `discordUser` is the Discord user who plays it: `{ id, tag, name, displayName, roles }` where `tag` is
  `<@id>`, `name` the Discord name we know (else the id), `displayName` their nickname in the guild's main
  server (else `name`) and `roles` the **names of their Discord roles** in that server (`@everyone` left
  out). Examples: `roster.length`, `roster.filter(c => c.isMain).map(c => c.name)`,
  `roster.filter(c => c.discordUser.roles.includes('Raider')).map(c => c.name)`.
- **Nicknames and roles come from Discord**, so they are read with one member listing and one role listing
  of the main server (the bot's Server Members Intent), or one lookup per player (at most 100) when that
  intent is off, and kept for 5 minutes. They are part of the roster hash, so a role change shows in a post
  within a few minutes. If Discord cannot be reached, users show their Discord name and no roles until the
  next attempt.
- **Updating:** each pass of the worker (a minute) looks at the posts in Discord whose config has a
  roster tag, loads the guild's roster once per guild and compares its **hash** with the one the post was
  last written from (`state.rosterHash`). Only when it differs are the post's messages written again, and
  a message is edited only if its text really changed. So an unchanged roster costs one query per guild;
  no change tracking on characters is needed. Edits that show people never ping them.
- The roster is also filled in when a message is first sent, and when a live message is saved. It is not
  limited to Officers' view: it lists every character of the guild.

### Clearing a channel (`/clear-channel`)

- **`/clear-channel [channel]`.** Deletes every unpinned message of the channel (default: the one you
  are in). Only for holders of the guild's Officer role in its main server; anyone else gets a private
  "you don't have permission" answer. The channel must be a text channel of the same server.
- The answer is private. Deleting takes longer than Discord's 3 seconds, so the command answers
  "Clearing…" at once and edits that message with the total (or the error) when it is done.
  Messages younger than 14 days go 100 at a time; older ones one by one, so a big old channel takes a
  while. One clear per channel at a time. There is no confirmation step.
- The bot needs View Channel, Read Message History and Manage Messages in that channel (the invite
  link's permissions include them). Run `npm run commands:register` after deploying.

### Contacting the officers (`/contact-officer`)

Members write to the officers privately with the bot; officers answer from Discord and read the
history in the backoffice. Every answer the bot gives is ephemeral (only the person who used the
command sees it).

- **Channel.** A Guild-Assistant or Officer picks the **Officer Request Channel** in guild Settings
  (`PUT /api/guilds/:id/officer-request-channel`; the bot posts a short note there to prove it can
  write). Until it is set, `/contact-officer` answers "The Officer Request Channel is not setup for
  your guild, please contact an officer to set it up."
- **`/contact-officer message [anonymous] [conversation-id]`.** Posts an embed in the request
  channel. The first message creates a conversation with a random **8-digit id, unique within the
  guild**, and decides for good whether the member is anonymous (default: yes); later messages
  ignore `anonymous`. An anonymous member is shown as "Anonymous member"; otherwise as a profile
  link (no ping). The member is told the id and how to continue. Continuing needs `conversation-id`
  and only works for the member who started it (anyone else is told it doesn't exist). A member can
  send one message every 30 seconds.
- **`/contact-officer-reply conversation-id message`.** Only for holders of the guild's Officer role
  (checked in the main server); everyone else is told they don't have permission. The reply is
  posted in the channel as a reply to the request, showing the officer, saved, and sent to the
  member by **DM**: it names the guild, the officer, quotes the original request, and explains how to
  answer (`/contact-officer` with the conversation id). If the DM can't be delivered (DMs closed) the
  reply is still saved and posted, and the officer is told.
- **Privacy.** The member's Discord id is stored (the bot needs it to DM and to check who may
  continue a conversation) but is never returned by the API for an anonymous conversation: the
  conversation is fetched by its id, and the DTO leaves out the member entirely (unit tested). Officers
  are never anonymous.
- **Locking and deleting (backoffice, Officers).** _Lock_ (and _Unlock_) on the conversation page stops
  anyone writing to it: `/contact-officer` with that id and `/contact-officer-reply` (and the reply
  box) answer that the conversation is locked and that a new one can be started. _Delete_ removes the
  conversation from the database and deletes every message the bot posted for it in the Officer
  Request Channel (each message's Discord id is stored). DMs already sent to the member stay. Routes:
  `PUT /api/guilds/:guildId/officer-requests/:id/lock` (`{ locked }`) and `DELETE …/officer-requests/:id`.
- **Backoffice** (Officers only): **Officer requests** lists conversations, most recently active
  first, ten to a page, with a search by id or text (`/officer-requests?q=&page=`) and an "Awaiting
  reply" badge. `/officer-requests/:conversationId` shows the whole conversation and a reply box (same delivery as the command: a DM plus a post in the request channel), each
  message labelled as the member (anonymous or by name) or as an officer, by name.

Not built yet: deleting old conversations after a while, and blocking a sender.

### Background worker, posts and honeypots

Officers manage these in the backoffice under the **Posts** and **Honeypots** tabs of a guild
(Officers only); more features will get tabs of their own. The worker that runs them is internal:
officers never see it.

**Running the worker.** `src/worker.ts` is a second entrypoint of the same codebase: a Nest
application context (no HTTP, no login) that needs only `DATABASE_URL` and `DISCORD_TOKEN`.

- `npm run start:worker` (`node dist/worker.js`); `npm run start:worker:dev` locally.
- On Render: a Background Worker (or any always-on service) built from the same Dockerfile with the
  start command `node dist/worker.js`.
- On a single instance you can instead set `WORKER_IN_PROCESS=true` on the web service and it runs
  inside the API process. Do not do both: two gateway connections would double-handle honeypots.

**Scheduler.** The worker checks for due work right at start-up and then every 60 seconds (a post
due at 20:00 goes out between 20:00 and 20:01). Due rows of `scheduled_tasks` are claimed in the
database (`FOR UPDATE SKIP LOCKED` plus a 5-minute lease), so several workers can run safely.
Times are entered and shown in the guild's region timezone (`src/config/regions.ts`, DST-aware).
Nothing is dropped: whatever is overdue runs, late rather than never. A failed run is retried after
5 minutes, up to 3 attempts, and the error is shown to the officer. Runs are at-least-once: if the
worker dies between posting and saving, one post can be repeated after the lease expires. The
schedule engine (`src/tasks/schedule.ts`, the catch-up of recurring tasks) also supports daily and
weekly schedules, unused by posts, for the planned channel cleanup.

**Posts.** A post is sent **once**, as **one or more messages** ("parts"), and one database row tracks
it (recurring events will be a separate flow). Markdown text goes to a channel of one of the guild's
servers at a chosen date and time, with optional reactions added by the bot (polls); the backoffice
previews the markdown with mentions shown by name. A post moves through these states:

- _Scheduled_: not sent yet. The date can be changed, "Post now" sends it right away, "Pause" holds it
  (resuming one whose time has passed sends it immediately).
- _Posted_: every message is in Discord. Saving edits those messages; the live reaction counts of each
  (`GET /api/tasks/:id/reactions?part=n`, without the bot's own vote) show right on the post and
  refresh every 10 s while the page is visible. While it is live it cannot be sent again or moved to
  a new date or channel.
- _Partly posted_: a run stopped halfway (Discord refused the third message, say). What was sent is
  kept, and the retry (or "Post now") sends only the missing messages, so nothing is sent twice.
- _Deleted from Discord_ (**Delete post**, `POST /api/tasks/:id/delete-post`): every message is removed
  but the post stays, so it can be sent again with "Post now" or a new date.
- _Untracked_ (**Untrack**, `DELETE /api/tasks/:id`): the row and its history are removed from the
  backoffice and the database. Whatever it posted stays in Discord and can no longer be deleted from
  the backoffice (the UI warns about this; delete the post first if it should go too).

**Several messages.** `config.parts` is the list (1 to 10) of `{ id, content, seedReactions,
embedLinks, delaySeconds, imageIds }`; `state.messages` records, per part id, the Discord message
(`messageId`, channel, the text as posted, its images and link-preview setting, and `deleted` when it
was removed in Discord). Both are JSON, so there is no table for parts. At the scheduled time the worker
sends the parts **one after the other, in order**, waiting `delaySeconds` (0 to 60, at most 240 in
total, so a sequence stays inside the worker's 5 minute lease) before each except the first. Progress
is saved after every message. Each part has its own text, reactions, link-preview setting and images.

- **Order is fixed once posted, and nothing can be added.** Messages already in Discord keep their order
  (Discord cannot move a message): they can be edited or removed, but no message can be added to a post
  that is in Discord (delete the post first). Messages that are not in Discord yet, including the
  rest of a post that stopped halfway, can be reordered and removed freely. **Removing** a posted
  message from the post deletes it from Discord.
- **Saving a live post edits only what changed**: the messages whose text, images or link previews
  differ (an image change replaces that message's attachments).
- The form has one card per message (move up/down, remove, text, images, reactions, links, wait), a
  preview of each message with its images, and a **preview of the whole sequence**.
- A `{{reactions …}}` tag can say which message it reads: `part=2` (default: its own message for a tag
  reading its own post, the first message of another post). **Copy ID** (a message's Discord id) is on the message's card in the edit form, and on the Posts
  list only for a post with a single message; **View in Discord** always opens the first message.

**Images.** Each message can have up to 4 images (PNG, JPEG, GIF or WebP, 5 MB each, checked by
content), shown under its text. They are uploaded from the form
(`POST /api/guilds/:guildId/post-images`, Officers; preview at `GET …/post-images/:id`) and kept in
the `post_images` table, because a post goes out later. An image belongs to no post until the post
that lists it is saved; uploads never used are removed by the worker after a day, and images a post
stops listing are removed when it is saved. Deleting a post deletes its images. Files are sent as
`image-1.png`, … (original names are not kept).

The list (`GET /api/guilds/:id/tasks?query=&page=`) shows ten posts to a page, newest date first.
The search covers every page: each word must appear in the name or the text of a message (case-insensitive,
partial words count). Pagination is by offset, so a post added while you browse can shift a page.

Posts never ping `@everyone`/`@here` (only user and role mentions are allowed).

**Honeypot.** A channel where anyone who posts is permanently banned, with their messages from the
last hour deleted (`delete_message_seconds = 3600`). Created from the backoffice: use an existing
channel or have the bot create one (with a description/topic and a first post), and pick a log
channel. It needs the guild's Officer role to be set (Officers are never banned). Also exempt: the
bot, other bots, the server owner and Administrators.

- **Test mode** (the default): nothing is banned; the bot only writes to the log channel what it
  would have done. Going live needs an explicit confirmation. Every action is stored in
  `honeypot_events` and the last ones show under the honeypot. Someone who is exempt (an Officer, the
  server owner, an Administrator) is also logged in test mode, as "would **not** be banned: they are
  an Officer", so the honeypot can be tried out with your own account (once per 5 minutes per person;
  bots stay silent). Nothing is stored for them, and once the honeypot is live exempt people are not
  logged to the channel, only in the server logs.
- Enforcement uses the bot's gateway connection in the worker, with the non-privileged `Guilds` and
  `GuildMessages` intents only (message text is not read; no portal setting needed).
- Honeypots are reloaded from the database every 30 seconds, so changes apply without a restart.
- Bot permissions used: View Channel, Send Messages, Manage Channels (to create the channel), Ban
  Members. The bot's role must be above the people it bans.

**Not built yet:** channel cleanup and the raid task (see `TODO.md`). Live updates between the worker
and the browser use polling until a shared bus (Redis or Postgres `LISTEN/NOTIFY`) exists.

### Fresh Discord data and live updates

- **Stored token:** at login the user's Discord access token is stored, AES-256-GCM encrypted with
  `SESSION_ENCRYPTION_KEY`, on their session (valid about 7 days, like the session). It is used to
  re-read their servers and roles later.
- **Refresh:** opening "Create guild" (or the guild settings) first calls `POST /api/guilds/sync`,
  which re-reads the user's servers and roles, then reads `GET /api/guilds/eligible-servers` (a pure
  read). A user-triggered sync is skipped if the last one was under 30 seconds ago
  (`discordForceSyncMinIntervalMs`), so it can't be used to hammer Discord's rate limits. Any
  authenticated request also re-syncs servers, roles and `guild_access` if the last sync is older
  than a minute (`discordSyncMaxAgeMs` in `app.config.ts`); the backoffice asks again every minute while open, so role changes show up without a reload. A sync that fails because Discord is unreachable never wipes the roles already known: the old access is kept until the next attempt.
- **Usernames:** listing players never calls Discord. Names come from the bot's commands, from
  adding a character, from the user's own login, and from the Officers' "Refresh names" button
  (`POST /api/guilds/:id/players/refresh-names`, up to 100 lookups).
- **Bot requirement:** the bot must be in a server for its roles to be read. The backoffice shows
  the setup steps and the invite link (`GET /api/guilds/setup-info`, built from
  `DISCORD_APPLICATION_ID` and `botInvitePermissions`).
- **Live updates:** `GET /api/events` is a Server-Sent Events stream. Character changes (from the
  bot or the backoffice) and server removals are published on an in-memory bus
  (`realtime.service.ts`) and forwarded to users with access to that guild; the backoffice reloads
  on each event. The bus is per-process, so running several API instances would need a shared one
  (Redis or Postgres `LISTEN/NOTIFY`).

### Character commands

Run inside a Discord server linked to a guild (a `DiscordServer` row). The first `/character-add`
registers you as a player of that guild. A character's realm and faction are its guild's. All replies are
ephemeral (only you see them).

| Command             | Options                                                                      | Purpose                          |
| ------------------- | ---------------------------------------------------------------------------- | -------------------------------- |
| `/character-add`    | `name`, `class`, `role`, optional `level` (1-100), optional `main` (boolean) | Registers one of your characters |
| `/character-list`   | —                                                                            | Lists your characters            |
| `/character-remove` | `name`                                                                       | Removes one of your characters   |

**Name format:** `Name` or `Name-Lastname`, a dash separating first and last name.

- Each part is 2-12 **letters of any alphabet** (accents and other combining marks are fine); no
  digits, spaces or punctuation. If a last name is given it must be valid too, so `Arthas-M` and
  `Arthas-` are rejected.
- Casing is normalized: first letter upper case, the rest lower case (`aRTHAS-menethil` →
  `Arthas Menethil`), and text is stored NFC-normalized.
- The last name is optional in general but **required for game versions that say so**: Forever
  requires it (`rules.lastNameRequired` in `src/game/forever/config.ts`). This is enforced by the API
  for the bot and the backoffice, on create and on rename. The database itself only guarantees the
  minimum lengths (CHECK constraints on `characters.first_name`/`last_name`), since a CHECK can't
  read the guild's game version from another table.

You can mark several characters as `main`.

After changing `src/bot/commands.json`, run `npm run commands:register`. The class choices of
`/character-add` are a fixed list in `commands.json` (Discord needs them at registration); a test checks
that it matches the classes of the game versions in `src/game/*/config.ts`.

## Game versions

Each version of the game is a directory, `src/game/<version>/`, with a `config.ts` that default-exports
a config built with `defineGame` (`src/game/game-config.ts` has the interface). The versions are **found
by scanning those directories** at start-up (`src/game/games.ts`), so adding a version is adding a
directory; a directory without a config is ignored, and an invalid config stops the app with what is
wrong. The shape (volatile: expect it to grow):

- `gameVersion`: the name guilds store (`Forever`), unique.
- `rules`: `{ lastNameRequired }`.
- `allowedServers`: the servers a guild can be on, **per region** (`EU`, `US`, the regions of
  `config/regions.ts`); a region that is missing is not available for that version.
- `classes`: every class, by name, each with its `specializations` (`{}` until defined; a specialization
  has `roles` and optional `raidBuffs`/`groupBuffs`).
- `factions`: by name (`Alliance`, `Horde`), each with its `races`, and each race with the `classes` it
  can be. **A race can only list classes that are keys of `classes`**: `defineGame` makes that a compile
  error, and the loader checks it again for the config it finds.

What uses it: the guild's game version (the API refuses an unknown version, a faction the version does
not have, a region it is not in, or a server it does not list for that region), the character class (a
class the guild's version does not have is refused, from the bot and the backoffice), the last-name
rule, and the backoffice: `GET /api/guilds/setup-info` includes `games` (every config as JSON), and the
guild forms (version, region, **server** from `allowedServers`, faction) and the character form render
from it: **race → class → roles**, each locked until the one before it is chosen, and each narrowed by it
(the roles of a class are those of its specializations; changing the race or class keeps what still
fits and clears the rest). The API also refuses roles a class cannot play in that version, from the bot and
the backoffice (a class whose specializations are not defined yet allows every role). Race is not stored on
characters yet.

## Load from armory (TEST)

Officers get a **Load from armory** button, tagged TEST, in the character form: type the character's
name, press it, and race, class and level are filled in from Blizzard's armory. Everything stays
editable, and if the lookup fails (not found, Blizzard down, not set up) the form shows why and the
character is added by hand as before.

- **Where from:** one fixed server, **EU · Classic Season of Discovery · Wild Growth**
  (`src/armory/armory.config.ts`: region `eu`, realm `wild-growth`, namespace `profile-classic1x-eu`;
  Season of Discovery shares Blizzard's Classic Era API). The Forever armory does not exist yet. Later the
  region, version and server should come from the guild, so it is all in that one file.
- **How:** `GET /api/guilds/:guildId/armory/character?name=` (Officers only) asks
  `https://eu.api.blizzard.com/profile/wow/character/wild-growth/<name>` with a token the server gets for
  itself (OAuth **client credentials**), so no player logs in and nothing is stored. The token is kept in
  memory until a minute before it expires, and renewed once if Blizzard refuses it. Requests time out after
  8 seconds. Only public data is read: name, class, race, level and faction.
- **Set up:** create a client at [develop.battle.net/access/clients](https://develop.battle.net/access/clients)
  and set `BLIZZARD_CLIENT_ID` and `BLIZZARD_CLIENT_SECRET` (on Render too). Without both the button is
  hidden (`setup-info` has `armoryTest: null`).
- **What the form does with the answer:** it picks the race if it is one of the guild's faction, then the
  class if that race can be it (the class stays empty otherwise), and the level; anything that does not fit
  is listed ("Orc is not a race of this guild's faction"). Roles are not on the armory, and the name is
  left as typed. Blizzard's data for Classic can be slow or missing (new characters often 404).

## Database

Postgres, hosted on [Supabase](https://supabase.com/), accessed through [Prisma](https://www.prisma.io/)
via the `@prisma/adapter-pg` driver adapter (required since Prisma 7 — see `prisma.config.ts`,
which is where `DATABASE_URL` is read from instead of `schema.prisma`).

`prisma/schema.prisma` currently has placeholder `Player`/`Guild` models to support the
`list-players` command/endpoint — expect this to change as the domain model is defined.

`DATABASE_URL` must be Supabase's **direct connection** string (port `5432`), not the pooled
"Transaction" one (port `6543`) — the pooler doesn't support the session features Prisma Migrate
needs.

### Migrations

Schema changes are tracked with [Prisma Migrate](https://www.prisma.io/docs/orm/prisma-migrate) —
versioned SQL files under `prisma/migrations/`, checked into git. An initial migration
(`prisma/migrations/<timestamp>_init/`) already creates the `players`/`guilds` tables; running it
against a fresh Supabase database is what "creates the database" schema-wise.

- `npm run prisma:migrate` — for local development. Diffs `schema.prisma` against the migrations
  history, writes a new migration if the schema changed, and applies any pending migrations
  (including the initial one, on a fresh database).
- `npm run prisma:deploy` — applies pending migrations only, no diffing/shadow database. Use this
  in CI/production, or if you'd rather not grant the Supabase user shadow-database permissions.

To change the schema: edit `prisma/schema.prisma`, then run `npm run prisma:migrate` against a
reachable database — it'll prompt for a migration name and generate the SQL for you.
