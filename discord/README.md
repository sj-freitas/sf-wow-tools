# discord

Node.js/TypeScript services for the Discord assistant:

- [`assistant-api/`](assistant-api/) — a NestJS app that is both the REST API (used by the
  backoffice) and the Discord bot (via an HTTP Interactions Endpoint, not a gateway connection —
  see its README for why). Only service with database access.
- [`assistant-backoffice/`](assistant-backoffice/) — React web app for managing the bot, calls
  `assistant-api`.
- [`assistant-uploader/`](assistant-uploader/) — the Guild Assistant Uploader, an Electron app
  for Mac and Windows that uploads the GuildAssistant Professions addon's file to `assistant-api`
  each time the game saves it (with an upload key). Released from GitHub Actions
  (`.github/workflows/uploader.yml`), not deployed with the rest.

For local dev, run `assistant-api` first, then `assistant-backoffice`.
