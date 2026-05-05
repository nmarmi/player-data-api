# Player Data API

Standalone **licensable** Player Data API for a fantasy baseball draft kit. Provides player data, auction-dollar valuations, and draft recommendations via a z-score-above-replacement engine backed by live MLB Stats API data.

## Endpoints

All endpoints except `/health` require `X-API-Key: <key>` or `Authorization: Bearer <key>`. Admin endpoints additionally require `X-Admin-Key: <key>`.

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/health` | Health check (no auth) |
| GET | `/license/check` | Validate license key |
| GET | `/players` | Paginated player list with filters/sorting |
| GET | `/players/filters` | Available teams, positions, and sort fields |
| GET | `/players/pool` | Player list filtered by position(s) |
| GET | `/players/:playerId` | Single player by ID |
| POST | `/players/valuations` | Auction dollar valuations (z-score engine) |
| POST | `/players/recommendations` | Top available players by projected value |
| POST | `/players/recommendations/nominations` | Nomination targets to drain opponents' budgets |
| POST | `/players/recommendations/budget` | Per-position spend allocations |
| GET | `/usage/sync-status` | Data freshness status |
| POST | `/usage` | Log a usage event |
| POST | `/admin/refresh` | Manually trigger data ingestion (admin key required) |

All paths above are also available under the `/api/v1/` prefix (canonical form). The unversioned aliases are kept for backward compatibility.

### GET /players — query params

- `search` — player name substring
- `team` — MLB team abbreviation (e.g. `LAD`)
- `position` — position code (e.g. `OF`, `SP`)
- Numeric ranges: `minFpts`, `maxFpts`, `minHr`, `maxHr`, `minRbi`, `maxRbi`, `minAvg`, `maxAvg` (and same pattern for `ab r h bb k sb obp slg`)
- `sortBy`, `sortOrder` (`asc`/`desc`), `limit`, `offset`

### POST /players/valuations — body

```json
{
  "leagueSettings": { "numberOfTeams": 12, "salaryCap": 260 },
  "draftState": {
    "availablePlayerIds": ["mlb-123456", "mlb-789012"],
    "purchasedPlayers": [],
    "teamBudgets": {}
  }
}
```

`leagueSettings` also accepts `numTeams`/`budget` (internal shape). `draftState` is optional; omit to value all players. Returns 503 if season stats are unavailable in the DB.

## Setup

```bash
cp .env.example .env
# Edit .env: set API_LICENSE_KEY and optionally ALLOWED_ORIGIN
npm install
npm start
```

### Load player data

The API uses SQLite (`data/players.db`) as its primary data store, seeded and refreshed from the live MLB Stats API. On first start the DB is seeded from the bundled `data/players.json`.

```bash
# Full refresh from MLB Stats API
npm run import-mlb-db       # player metadata (40-man rosters)
npm run import-stats        # season hitting/pitching stats
npm run import-depth-charts # depth chart rankings
npm run import-injuries     # IL / injury status
npm run import-transactions # transaction log
```

Or trigger a refresh at runtime:

```bash
curl -X POST http://localhost:4001/api/v1/admin/refresh \
  -H "X-Admin-Key: <admin_key>" \
  -H "Content-Type: application/json" \
  -d '{"sources": ["player_metadata", "player_stats"]}'
```

### Load data from CSV or balldontlie API (legacy)

These scripts write to `data/players.json` (used only as fallback/seed, not the live data source):

```bash
# From a NL stats CSV
npm run import-csv -- ~/Downloads/2025-player-NL-stats.csv

# From balldontlie API (requires BALLDONTLIE_API_KEY env var)
npm run import-mlb
```

Expected CSV columns: `Player,AB,R,H,1B,2B,3B,HR,RBI,BB,K,SB,CS,AVG,OBP,SLG,FPTS` plus optional `mlbPersonId` and `mlbTeamId`. The `Player` column should be `"Name Position | TEAM"` (e.g. `Juan Soto OF | NYM`).

## Key env vars

See `.env.example` for the complete list with inline docs. Highlights:

| Var | Purpose | Default |
|-----|---------|---------|
| `PORT` | Server port | 4001 |
| `API_LICENSE_KEY` | Single valid API key | (required) |
| `VALID_API_KEYS` | Comma-separated API keys (preferred for rotation) | — |
| `ADMIN_API_KEY` | Optional separate admin key; falls back to license keys | — |
| `ALLOWED_ORIGIN` | CORS origin | `*` |
| `DB_PATH` | SQLite file path | `data/players.db` |
| `SCHEDULER_ENABLED` | Enable background ingestion | `true` |
| `RATE_LIMIT_WINDOW_MS` | Per-key rate-limit window | `60000` |
| `RATE_LIMIT_MAX_PER_WINDOW` | Requests per window before 429 | `600` |
| `LOG_LEVEL` | `debug` / `info` / `warn` / `error` | `info` |
| `LOG_PRETTY` | Set `true` for human-readable dev logs | `false` |

## API key rotation (US-8.5)

The licensed `/api/v1/*` routes accept a key via `X-API-Key: <key>` or `Authorization: Bearer <key>`. `/health` is exempt so external uptime checkers can hit it without a key. Per-key rate limits (`RATE_LIMIT_*`) protect the valuation/recommendation endpoints from accidental DoS during a buggy draft loop — exceeding the limit returns `429` with a `Retry-After` header.

**Issuing a key (dev):** add it to `.env`. Either set `API_LICENSE_KEY=<key>` for a single deployment-wide key, or `VALID_API_KEYS=key1,key2,key3` to support multiple consumers.

**Rotating a key (zero-downtime):** in production, set `VALID_API_KEYS=old-key,new-key` and restart. Both keys work. After every consumer has cut over to `new-key`, set `VALID_API_KEYS=new-key` and restart again — `old-key` is now revoked.

**Revoking a key:** remove it from `VALID_API_KEYS` (or delete `API_LICENSE_KEY` if that's the configured single key) and restart. Cached tokens are evicted on the next request.

**Auth error responses:**

| Condition | Status | Body |
|---|---|---|
| No key configured server-side | `500` | `{ success: false, error: "License not configured", code: "LICENSE_NOT_CONFIGURED" }` |
| Missing/invalid key | `401` | `{ success: false, error: "Invalid or missing license", code: "UNAUTHORIZED" }` |
| Rate limit exceeded | `429` + `Retry-After` | `{ success: false, error: "Rate limit exceeded — …", code: "RATE_LIMITED", retryAfterSec: <n> }` |

## Demo UI

The demo lives at **https://player-data-api.vercel.app** and the source is in
[`examples/demo-ui/`](./examples/demo-ui/) (relocated per US-9.1 — the
production Express server is now JSON-only and does not serve HTML).

1. **License check** — validates your API key
2. **Pull players** — search, filter, and sort the full player list
3. **Push usage** — logs a sample event
4. **Valuations** — runs the z-score auction engine for your league settings

To run the demo locally, see [`examples/demo-ui/README.md`](./examples/demo-ui/README.md).

## Deployment

The API runs as two separate services:

| Layer | Platform | Purpose |
|---|---|---|
| Backend (Express + SQLite + scheduler) | [Render](https://render.com) | Always-on, persistent disk for `players.db` |
| Demo frontend (`examples/demo-ui/`) | [Vercel](https://vercel.com) | Static site; proxies `/api/*` to Render |

**Vercel** serves `examples/demo-ui/` as a static site and transparently proxies all `/api/*` requests to the Render service (configured in `vercel.json`). The browser only ever talks to the Vercel domain — no CORS config needed for the demo UI, and cookie-based auth (planned) works without cross-origin issues.

**Render** is configured via `render.yaml`. On first deploy, the DB is created at `/data/players.db`, seeded from `data/players.json`, and the scheduler immediately ingests fresh data from the MLB Stats API. The disk at `/data` persists across redeploys.

To deploy:
1. Connect the repo to Render — it auto-detects `render.yaml`. Set `API_LICENSE_KEY` and `ADMIN_KEY` in the Render dashboard.
2. Connect the repo to Vercel — it auto-detects `outputDirectory: "examples/demo-ui"` in `vercel.json`. No env vars needed.

**External apps** (non-browser) should call the Render service URL directly: `https://player-data-api.onrender.com`.

## Project structure

```
src/
  app.js                    Express app (middleware + route registration)
  index.js                  Server entry point
  routes/                   Route definitions (health, license, players, usage, admin)
  controllers/              Request handlers (one file per route group)
  services/
    playersService.js       Player loading, filtering, sorting, pagination
    valuationEngine.js      Z-score above replacement auction valuation
  jobs/                     Ingestion jobs (MLB Stats API → SQLite)
  db/
    connection.js           SQLite singleton (better-sqlite3)
    migrate.js              Idempotent schema migration
    seed.js                 Seed DB from players.json on first start
    syncLog.js              data_sync_log table helpers
  middleware/
    license.js              requireLicense / requireAdmin middleware
examples/
  demo-ui/                  Static demo UI (relocated per US-9.1)
    index.html              Demo UI shell
    app.jsx                 React demo app (no build step; Babel CDN)
    styles.css              Demo UI styles
data/
  players.db                SQLite database (primary store)
  players.json              Seed/fallback player list
tests/
  *.test.js                 Jest test suites
  fixtures/                 Draft-state snapshots for integration tests
render.yaml                 Render service definition
vercel.json                 Vercel static site + /api/* proxy config
```

## Connecting the draft kit

External apps call the Render service directly (bypasses Vercel):

In the draft kit repo, set:
- `PLAYER_API_URL` — `https://player-data-api.onrender.com` (or `http://localhost:4001` for local dev)
- `PLAYER_API_KEY` — your license key

Then:
- Replace local player fetch with `GET <PLAYER_API_URL>/api/v1/players` + header `X-API-Key: <PLAYER_API_KEY>`
- Call `POST <PLAYER_API_URL>/api/v1/players/valuations` with current `draftState` to get live auction values
- Call `POST <PLAYER_API_URL>/api/v1/usage` to log events
