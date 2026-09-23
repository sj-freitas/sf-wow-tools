# sf-wow-tools

Tools for World of Warcraft: a Discord bot and a collection of in-game addons.

## Layout

- [`addons/`](addons/) — WoW addons, written in Lua.
- [`discord/`](discord/) — Discord bot/API and backoffice, written in Node.js/TypeScript. See
  [`discord/README.md`](discord/README.md) for how the two services fit together.

## Deployment

The root [`Dockerfile`](Dockerfile) builds both `discord/` services into a single image with a
single Node process, meant to run as **one** Render Web Service:

- `assistant-api` binds the one port Render forwards traffic to. It serves the REST API
  (`/api/players`), Discord's HTTP Interactions Endpoint (`/api/discord/interactions` — Discord
  POSTs slash command invocations here directly; there's no gateway WebSocket, so no separate
  always-on bot process is needed), and `assistant-backoffice`'s static build (everything else,
  same origin, different path).

### Setting this up on Render, step by step

**0. Prerequisites** — before touching Render, have these three things ready:

- This repo pushed to GitHub (Render deploys from a git repo, not a local folder).
- A Supabase project, so you have a Postgres connection string.
- A Discord application, so you have an Application ID, Public Key, and Bot Token — create one at
  the [Developer Portal](https://discord.com/developers/applications) → **New Application** if you
  haven't already. Under **Bot**, click **Reset Token** to get a token (copy it now, Discord won't
  show it again).

**1. Get the Supabase connection string**

- In your Supabase project: **Project Settings → Database → Connection string → URI**.
- Copy the **direct connection** string (port `5432`) — not the "Transaction pooler" one (port
  `6543`); Prisma Migrate needs the direct connection (see
  [`discord/assistant-api/README.md`](discord/assistant-api/README.md#database) for why).

**2. Create the Render Web Service**

- Render dashboard → **New +** → **Web Service**.
- Connect the GitHub repo.
- **Runtime**: `Docker`. Leave **Dockerfile Path** (`./Dockerfile`) and **Docker Build Context
  Directory** (`.`) at their defaults — both already match this repo's layout.
- **Instance Type**: pick a plan that doesn't spin down when idle (i.e. not the free tier — see
  the warning below). This is the one paid service the whole `discord/` setup is designed around.
- Don't click "Deploy" yet if the dashboard lets you fill in the rest first — env vars need to be
  set before the first successful boot anyway, so add them now (next step) then deploy.

**3. Set environment variables** (Web Service → **Environment**)

| Key                    | Value                                                              |
| ----------------------- | ------------------------------------------------------------------- |
| `DATABASE_URL`          | The Supabase direct connection string from step 1                 |
| `DISCORD_TOKEN`         | Bot token from the Developer Portal (only used by `commands:register`, never read at runtime) |
| `DISCORD_APPLICATION_ID`| Application ID from the Developer Portal (General Information tab) — also only used by `commands:register` |
| `DISCORD_PUBLIC_KEY`    | Public Key from the Developer Portal (General Information tab) — this one **is** read at runtime, to verify Discord's request signature on every interaction |
| `DISCORD_GUILD_ID`      | Optional — only if you want guild-scoped (near-instant) command registration instead of global (up to an hour to propagate) |

Do **not** set `PORT` — Render injects it, and the app already reads whatever value Render gives it.

**4. Add the Pre-Deploy Command** (Web Service → **Settings → Build & Deploy → Pre-Deploy Command**)

```
npx prisma migrate deploy
```

This runs pending migrations against Supabase before each new version starts serving traffic —
including creating the tables for the very first time on this first deploy.

**5. Deploy**

- Trigger the first deploy (Render does this automatically once you finish creating the service).
- Watch the build logs. A successful boot ends with `assistant-api listening on port <PORT>` in
  the logs.
- Once live, sanity-check it: `curl https://<your-render-url>/api/players` should return `[]` (or
  your seeded players) as JSON, not an error.

**6. Register the bot's slash commands**

Run this from your machine (or as a one-off Render job), pointed at the **production** Discord
credentials — it only needs to be redone when `discord/assistant-api/src/bot/commands.json`
changes, not on every deploy:

```bash
cd discord/assistant-api
DISCORD_TOKEN=... DISCORD_APPLICATION_ID=... npm run commands:register
```

**7. Point Discord at your Render URL**

- Developer Portal → your application → **General Information → Interactions Endpoint URL**:
  `https://<your-render-url>/api/discord/interactions`
- Save. Discord immediately sends a test `PING` to verify the endpoint — this only succeeds if the
  service from step 5 is already deployed and reachable, so do this step last.

**8. Verify end to end**

- Open `https://<your-render-url>/` — should load the backoffice, showing the players table.
- In a server your bot is in, run `/list-players` — should reply with the same data as a string.

From here, every `git push` to the connected branch triggers a new deploy automatically (rerunning
the Pre-Deploy migration command each time); re-run step 6 only when `commands.json` changes.

### Things that trip people up here

- **Free-tier instances spin down when idle.** Discord requires an interaction response within 3
  seconds — a cold start from a spun-down free instance will blow that budget and the interaction
  will show as failed in Discord. Use a plan that stays warm.
- **The Interactions Endpoint URL check happens immediately and needs a live server.** If step 7
  fails to save, double-check the service is actually up and `DISCORD_PUBLIC_KEY` matches the
  application you're configuring.
- Render's default health check (`GET /`) hits the backoffice's `index.html`, which is enough to
  confirm the process is up; there's no separate `/health` endpoint (yet).


Bot invite link: https://discord.com/oauth2/authorize?client_id=1549424151243137145&scope=bot%20applications.commands&permissions=3960426119822455