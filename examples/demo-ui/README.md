# Demo UI (relocated for US-9.1)

This is the static, browser-side playground for the Player Data API. It was
previously served from `public/` by the Express server itself; per US-9.1 the
production API server is now JSON-only, and this demo is decoupled.

## What it is

A single-page React-from-CDN app (`index.html` + `app.jsx` + `styles.css`)
that exercises:

- License key validation (`/api/v1/license/check`)
- Player search (`/api/v1/players`)
- Usage event posting (`/api/v1/usage`)
- Valuation requests (`/api/v1/players/valuations`)

It's a manual smoke-test surface, not a product feature. The real consumer of
the API is the Draft Kit repo.

## How it's hosted

Vercel uses this directory as `outputDirectory` (see `../../vercel.json`) and
rewrites every other path to the Render-hosted API. The browser only ever
talks to the Vercel domain — no CORS dance for the demo.

## Running locally

The simplest path is any static-file server from this directory:

    cd examples/demo-ui && npx serve .

Then point the demo at a local API by editing the `API_BASE` constant near
the top of `app.jsx` (or just hit `http://localhost:4001` directly through the
license-key form).
