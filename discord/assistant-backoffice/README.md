# assistant-backoffice

Web backoffice for managing the WoW guild assistant bot. React + TypeScript, built with Vite.
Calls the same [`assistant-api`](../assistant-api) the Discord bot uses — the API returns plain
JSON, and each client renders it its own way (the bot joins names into a string, this app renders
a table).

Currently just a read-only players table. Discord login (to gate write access to bot
configuration) is planned but not implemented yet.

## API calls

This app always calls `/api/...` as a relative path — it assumes it's served from the same origin
as `assistant-api`, which is true both in production (see the repo-root `Dockerfile`, where
`assistant-api` serves this app's build as static files) and in local dev, where `vite.config.ts`
proxies `/api` to `http://localhost:3000`.

## Getting started

```bash
npm install
npm run dev   # requires assistant-api running on :3000 (see ../assistant-api)
```

## Scripts

| Script                            | Purpose                                               |
| --------------------------------- | ----------------------------------------------------- |
| `npm run dev`                     | Start the Vite dev server                             |
| `npm run build`                   | Type-check and build for production                   |
| `npm run preview`                 | Preview the production build locally                  |
| `npm run lint` / `lint:fix`       | ESLint (flat config, typescript-eslint + react-hooks) |
| `npm run format` / `format:check` | Prettier                                              |

## Logo

The source artwork is `../static/logo.png`. `public/logo.png` (256px, used in the header and login
card on a white tile) and `public/favicon.png` (64px, transparent) are resized copies, regenerated
with:

```bash
sips -Z 256 ../static/logo.png --out public/logo.png
sips -Z 64 ../static/logo.png --out public/favicon.png
```
