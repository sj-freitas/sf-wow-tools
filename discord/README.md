# discord

Node.js/TypeScript services for the Discord assistant:

- [`assistant-api/`](assistant-api/) — a NestJS app that is both the REST API (used by the
  backoffice) and the Discord bot (via an HTTP Interactions Endpoint, not a gateway connection —
  see its README for why). Only service with database access.
- [`assistant-backoffice/`](assistant-backoffice/) — React web app for managing the bot, calls
  `assistant-api`.

For local dev, run `assistant-api` first, then `assistant-backoffice`.
