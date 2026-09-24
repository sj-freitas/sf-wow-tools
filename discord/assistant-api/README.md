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

## Scripts

| Script                            | Purpose                                             |
| --------------------------------- | --------------------------------------------------- |
| `npm run start:dev`               | Run the API with hot reload (`nodemon` + `ts-node`) |
| `npm run build`                   | Compile TypeScript to `dist/`                       |
| `npm run start`                   | Run the compiled API from `dist/`                   |
| `npm run commands:register`       | Push `src/bot/commands.json` to Discord             |
| `npm run prisma:generate`         | Regenerate the Prisma client                        |
| `npm run prisma:migrate`          | Create/apply a dev migration                        |
| `npm run prisma:deploy`           | Apply pending migrations only (CI/production)       |
| `npm run lint` / `lint:fix`       | ESLint (flat config, typescript-eslint)             |
| `npm run format` / `format:check` | Prettier                                            |

## Endpoints

| Method | Path                        | Purpose                                                                |
| ------ | --------------------------- | ---------------------------------------------------------------------- |
| GET    | `/api/players`              | Players in the guilds the logged-in user belongs to (session required) |
| GET    | `/api/auth/login`           | Starts "Login with Discord" (OAuth2, scopes `identify guilds`)         |
| GET    | `/api/auth/callback`        | OAuth2 redirect target; creates the session cookie                     |
| GET    | `/api/auth/me`              | Current user, or 401                                                   |
| POST   | `/api/auth/logout`          | Destroys the session                                                   |
| POST   | `/api/discord/interactions` | Discord's HTTP Interactions Endpoint — see below                       |

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

| Level                                         | How you get it                                                                            | What you can do                                                                                                                  |
| --------------------------------------------- | ----------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| **Guild-Assistant** (`guild_access.is_admin`) | Hold the role in **every** Discord server of the guild                                    | Create guilds; configure them: details, delete, add/remove servers, main server, Officer role. **Not** other people's characters |
| **Officer** (`guild_access.is_officer`)       | Hold the guild's Officer role in its **main** server (the Guild-Assistant picks the role) | Add, edit and remove **every** player's characters                                                                               |
| **Member** (any `guild_access` row)           | Be in any Discord server attached to the guild; no role needed                            | Add, edit and remove **your own** characters                                                                                     |

Everyone with a `guild_access` row can see the guild's players. Changing the main server clears the
Officer role, since roles belong to a server. A guild always keeps at least one server and its main
server can't be removed directly.

- **Expired login:** if the session or the stored Discord token expires or Discord rejects it, the API
  ends the session and answers 401, and the backoffice sends the user through Discord login again
  (no consent screen if already approved). Transient Discord errors don't log anyone out.
- **Creating a guild:** any logged-in user (`POST /api/guilds`) picks name, realm, faction, game
  version and the Discord servers to attach, and which one is main. Only servers where the user holds
  the admin role, the bot is installed, and that don't belong to a guild yet are offered
  (`GET /api/guilds/eligible-servers`). The creator becomes a Guild-Assistant of the new guild.
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

### Fresh Discord data and live updates

- **Stored token:** at login the user's Discord access token is stored, AES-256-GCM encrypted with
  `SESSION_ENCRYPTION_KEY`, on their session (valid about 7 days, like the session). It is used to
  re-read their servers and roles later.
- **Refresh:** opening "Create guild" always re-reads the user's servers first
  (`GET /api/guilds/eligible-servers`). Any authenticated request also re-syncs servers, roles and
  `guild_access` if the last sync is older than 5 minutes (`discordSyncMaxAgeMs` in
  `app.config.ts`), so a lost role stops working within minutes. If the token is missing or
  rejected the user is asked to log in again.
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

**Name format:** `Name` or `Name-Lastname` — a dash separates first and last name, and the last
name is optional. Letters only, 2-12 per part; casing is normalized (`arthas-menethil` →
`Arthas Menethil`). You can mark several characters as `main`.

After changing `src/bot/commands.json`, run `npm run commands:register`. Class choices live in both
`commands.json` and `src/game/wow-class.ts` — keep them in sync.

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
