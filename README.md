# Player Data API

Standalone **licensable** backend service for the **DraftIQ** fantasy baseball auction draft assistant. Provides real-time player data, auction-dollar valuations, and draft recommendations via a z-score-above-replacement engine backed by the live MLB Stats API.

The Player Data API is one half of the DraftIQ system. The other half is the **Draft Kit** repo — a React + Express application that hosts the draft room UI, team management, and real-time bidding flow. The Draft Kit calls this API for player data and valuations; this API never calls the Draft Kit.

## Endpoints

All endpoints except `/api/v1/health` require `X-API-Key: <key>` or `Authorization: Bearer <key>`. Admin endpoints additionally require `X-Admin-Key: <key>`.

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/v1/health` | Health check — no auth required |
| GET | `/api/v1/license/check` | Validate a license key |
| GET | `/api/v1/players` | Paginated player list with filters and sorting |
| GET | `/api/v1/players/filters` | Available teams, positions, and sort fields |
| GET | `/api/v1/players/pool` | Player list filtered by one or more positions |
| GET | `/api/v1/players/:playerId` | Single player by ID |
| POST | `/api/v1/players/valuations` | Auction dollar valuations (z-score engine) |
| POST | `/api/v1/players/recommendations` | Top available players by projected value |
| POST | `/api/v1/players/recommendations/nominations` | Nomination targets to drain opponents' budgets |
| POST | `/api/v1/players/recommendations/budget` | Per-position spend allocations |
| GET | `/api/v1/analytics/sync-status` | Data freshness for all ingestion sources |
| POST | `/api/v1/analytics/usage` | Log and persist a client usage event |
| POST | `/api/v1/admin/refresh` | Manually trigger data ingestion (admin key required) |

Player, license, and admin paths are also available without the `/api/v1/` prefix (unversioned aliases kept for backward compatibility). Analytics endpoints are v1-only.

### GET /api/v1/players — query params

- `search` — player name substring
- `team` — MLB team abbreviation (e.g. `LAD`)
- `position` — position code (e.g. `OF`, `SP`)
- Numeric ranges: `minFpts`, `maxFpts`, `minHr`, `maxHr`, `minRbi`, `maxRbi`, `minAvg`, `maxAvg` (and same pattern for `ab r h bb k sb obp slg`)
- `sortBy`, `sortOrder` (`asc`/`desc`), `limit`, `offset`

### POST /api/v1/players/valuations — body

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

`leagueSettings` also accepts `numTeams`/`budget` aliases. `draftState` is optional — omit it to value all players. Returns `503` if season stats are unavailable in the DB.

- **License**: Send `X-API-Key: <key>` or `Authorization: Bearer <key>`.
- **Player identity**: Every player includes `mlbPersonId` and `playerId` in the format `mlb-{mlbPersonId}`.
- **GET /players** query params (optional):
  - Base filters: `search`, `team`, `position`
  - Numeric ranges: `minFpts`, `maxFpts`, `minHr`, `maxHr`, `minRbi`, `maxRbi`, `minAvg`, `maxAvg` (plus same pattern for `ab,r,h,bb,k,sb,obp,slg`)
  - Sorting/paging: `sortBy`, `sortOrder` (`asc`/`desc`), `limit`, `offset`
- **GET /players/filters** returns available `teams`, `positions`, and supported `sortFields`.
- **POST /usage** body: `{ "event": "...", "timestamp": "ISO8601", "metadata": {} }`.

```json
{ "event": "player_drafted", "timestamp": "2025-06-01T18:00:00Z", "metadata": {} }
```

Events are persisted to the `usage_events` table. The stored API key is truncated to the first 8 characters for privacy.

## Setup

```bash
cp .env.example .env
# Edit .env: set API_LICENSE_KEY and optionally ALLOWED_ORIGIN
npm install
npm start
```

Expected CSV columns: `Player,AB,R,H,1B,2B,3B,HR,RBI,BB,K,SB,CS,AVG,OBP,SLG,FPTS` plus optional `mlbPersonId` (`mlb_person_id`/`mlbamid` also accepted). The `Player` column should be like `"Name Position | TEAM"` (e.g. `Juan Soto OF | NYM`). Output is written to **data/players.json**; restart the API to pick it up.

The API uses SQLite (`data/players.db`) as its primary data store, seeded and refreshed from the live MLB Stats API. On first start the DB is seeded from the bundled `data/players.json` if the DB is empty.

```bash
# Full refresh from MLB Stats API (run in any order)
npm run import-mlb-db       # player metadata — 40-man rosters
npm run import-stats        # season hitting and pitching stats
npm run import-depth-charts # depth chart rankings
npm run import-injuries     # IL / injury status
npm run import-transactions # transaction log
```

The background scheduler (enabled by default) re-runs these jobs automatically on the staleness thresholds configured per source (1 h for injuries, 6 h for depth charts and transactions, 24 h for rosters and stats).

Trigger a manual refresh at runtime:

```bash
curl -X POST http://localhost:4001/api/v1/admin/refresh \
  -H "X-Admin-Key: <admin_key>" \
  -H "Content-Type: application/json" \
  -d '{"sources": ["player_metadata", "player_stats"]}'
```

Check freshness:

```bash
curl http://localhost:4001/api/v1/analytics/sync-status \
  -H "X-API-Key: <key>"
```

### Seeding from CSV (legacy)

These scripts write to `data/players.json`, which is used only as a first-boot seed if the DB is empty:

```bash
# From a NL stats CSV
npm run import-csv -- ~/Downloads/2025-player-NL-stats.csv

# From balldontlie API (requires BALLDONTLIE_API_KEY env var)
npm run import-mlb
```

Expected CSV columns: `Player,AB,R,H,1B,2B,3B,HR,RBI,BB,K,SB,CS,AVG,OBP,SLG,FPTS` plus optional `mlbPersonId` and `mlbTeamId`. The `Player` column should be `"Name Position | TEAM"` (e.g. `Juan Soto OF | NYM`).

## Key env vars

See `.env.example` for the complete list. Highlights:

| Var | Purpose | Default |
|-----|---------|---------|
| `PORT` | Server port | `4001` |
| `API_LICENSE_KEY` | Single valid API key | (required) |
| `VALID_API_KEYS` | Comma-separated keys (preferred for rotation) | — |
| `ADMIN_API_KEY` | Separate admin key; falls back to license keys if unset | — |
| `ALLOWED_ORIGIN` | CORS origin | `*` |
| `DB_PATH` | SQLite file path | `data/players.db` |
| `SCHEDULER_ENABLED` | Enable background ingestion | `true` |
| `RATE_LIMIT_WINDOW_MS` | Per-key rate-limit window | `60000` |
| `RATE_LIMIT_MAX_PER_WINDOW` | Requests per window before 429 | `600` |
| `LOG_LEVEL` | `debug` / `info` / `warn` / `error` | `info` |
| `LOG_PRETTY` | Set `true` for human-readable dev logs | `false` |
| `TRUST_PROXY` | Set `true` to read client IP from `X-Forwarded-For` | `false` |
| `SESSION_SECRET` | HMAC secret for developer portal session cookies | (random per restart) |
| `ADMIN_EMAIL` | Bootstrap admin account email | `admin@localhost` |
| `ADMIN_PASSWORD` | Bootstrap admin account password | `changeme` |

## IP whitelisting

API keys issued through the developer portal can be locked to specific IP addresses or CIDR blocks. When a key has a non-empty whitelist, any request from an IP not on the list returns `401 IP_NOT_ALLOWED`.

**Hosted deploys (Render, Vercel proxy):** set `TRUST_PROXY=true` so the server reads the real client IP from the `X-Forwarded-For` header rather than the proxy's internal IP. Without this, every request appears to come from the proxy and a non-empty whitelist will block everything.

```
TRUST_PROXY=true   # required on Render / behind any reverse proxy
```

**Local dev:** leave `TRUST_PROXY` unset. The IP is read directly from the socket.

## API key rotation

Licensed routes accept a key via `X-API-Key: <key>` or `Authorization: Bearer <key>`. `/api/v1/health` is exempt so uptime checkers can hit it without a key. Per-key rate limits protect valuation and recommendation endpoints from runaway draft loops — exceeding the limit returns `429` with a `Retry-After` header.

**Issue a key (dev):** add it to `.env` as `API_LICENSE_KEY=<key>` (single key) or `VALID_API_KEYS=key1,key2` (multiple consumers).

**Rotate a key (zero-downtime):** set `VALID_API_KEYS=old-key,new-key` and restart. Both work. After consumers cut over, set `VALID_API_KEYS=new-key` and restart — `old-key` is revoked.

**Revoke a key:** remove it from `VALID_API_KEYS` and restart.

**Auth error responses:**

| Condition | Status | Body |
|---|---|---|
| No key configured server-side | `500` | `{ success: false, error: "License not configured", code: "LICENSE_NOT_CONFIGURED" }` |
| Missing or invalid key | `401` | `{ success: false, error: "Invalid or missing license", code: "UNAUTHORIZED" }` |
| Rate limit exceeded | `429` + `Retry-After` | `{ success: false, error: "Rate limit exceeded — …", code: "RATE_LIMITED", retryAfterSec: <n> }` |

## Demo UI

The demo lives at **https://player-data-api.vercel.app** and the source is in [`examples/demo-ui/`](./examples/demo-ui/). The production Express server is JSON-only; the demo is a separate static site hosted on Vercel.

1. **License check** — validates your API key
2. **Pull players** — search, filter, and sort the full player list
3. **Push usage** — logs a sample analytics event
4. **Valuations** — runs the z-score auction engine for your league settings

To run locally, see [`examples/demo-ui/README.md`](./examples/demo-ui/README.md).

## Deployment

The API runs as two separate services:

| Layer | Platform | Purpose |
|---|---|---|
| Backend (Express + SQLite + scheduler) | [Render](https://render.com) | Always-on, persistent disk for `players.db` |
| Demo frontend (`examples/demo-ui/`) | [Vercel](https://vercel.com) | Static site; proxies `/api/*` to the Render backend |

**Render** is configured via `render.yaml`. On first deploy the DB is created at `/data/players.db`, seeded from `data/players.json`, and the scheduler immediately ingests fresh data from the MLB Stats API. The `/data` disk persists across redeploys.

**Vercel** serves `examples/demo-ui/` as a static site and transparently proxies all `/api/*` requests to the Render service (configured in `vercel.json`).

To deploy:
1. Connect the repo to Render — it auto-detects `render.yaml`. Set `API_LICENSE_KEY` and `ADMIN_API_KEY` in the Render dashboard.
2. Connect the repo to Vercel — it auto-detects `outputDirectory: "examples/demo-ui"` in `vercel.json`. No env vars needed on Vercel.

**External apps** (non-browser) should call the Render service URL directly: `https://player-data-api.onrender.com`.

## Project structure

```
src/
  app.js                    Express app (middleware + route registration)
  index.js                  Server entry point
  routes/                   Route definitions (health, license, players, analytics, admin)
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
    rateLimit.js            Per-key sliding-window rate limiter
examples/
  demo-ui/                  Static demo UI (Vercel-hosted)
    index.html              Demo UI shell
    app.jsx                 React demo app (no build step; Babel CDN)
    styles.css              Demo UI styles
data/
  players.db                SQLite database (primary store)
  players.json              Seed/fallback player list
docs/
  openapi.yaml              OpenAPI v3 spec (contract for all consumers)
tests/
  *.test.js                 Jest test suites
  fixtures/                 Draft-state snapshots for integration tests
render.yaml                 Render service definition
vercel.json                 Vercel static site + /api/* proxy config
```

## Connecting the Draft Kit

The Draft Kit calls this API directly (not through Vercel). In the Draft Kit repo set:

- `PLAYER_API_URL` — `https://player-data-api.onrender.com` (or `http://localhost:4001` for local dev)
- `PLAYER_API_KEY` — your license key

Then:
- Fetch players: `GET <PLAYER_API_URL>/api/v1/players` with header `X-API-Key: <PLAYER_API_KEY>`
- Get auction values: `POST <PLAYER_API_URL>/api/v1/players/valuations` with the current `draftState`
- Get recommendations: `POST <PLAYER_API_URL>/api/v1/players/recommendations` with the current `draftState`
- Log events: `POST <PLAYER_API_URL>/api/v1/analytics/usage` with `{ event, metadata }`
