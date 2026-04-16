# Player Data API

Standalone **licensable** Player Data API for a fantasy baseball draft kit. Supports **pull** (GET players) and **push** (POST usage/events) with license validation.

## Endpoints

| Method | Path            | Purpose                    | License required |
|--------|-----------------|----------------------------|------------------|
| GET    | /health         | Health check               | No               |
| GET    | /license/check  | Validate license           | Yes              |
| GET    | /players        | Pull player data           | Yes              |
| GET    | /players/filters| Get search filter options  | Yes              |
| POST   | /usage          | Push usage/event from app  | Yes              |

- **License**: Send `X-API-Key: <key>` or `Authorization: Bearer <key>`.
- **Player identity**: Every player includes `mlbPersonId` and `playerId` in the format `mlb-{mlbPersonId}`.
- **MLB team identity**: Every player includes `mlbTeamId` in the format `mlb-{mlbTeamId}` and `mlbTeam` as the team abbreviation (e.g., `LAD`).
- **GET /players** query params (optional):
  - Base filters: `search`, `team`, `position`
  - Numeric ranges: `minFpts`, `maxFpts`, `minHr`, `maxHr`, `minRbi`, `maxRbi`, `minAvg`, `maxAvg` (plus same pattern for `ab,r,h,bb,k,sb,obp,slg`)
  - Sorting/paging: `sortBy`, `sortOrder` (`asc`/`desc`), `limit`, `offset`
- **GET /players/filters** returns available `teams`, `positions`, and supported `sortFields`.
- **POST /usage** body: `{ "event": "...", "timestamp": "ISO8601", "metadata": {} }`.

## Player data from CSV

The API uses **data/players.json** as the local player data source by default. To generate/update this dataset from your own NL stats or projections:

```bash
node scripts/csv-to-players.js /path/to/your.csv
```

Expected CSV columns: `Player,AB,R,H,1B,2B,3B,HR,RBI,BB,K,SB,CS,AVG,OBP,SLG,FPTS` plus optional `mlbPersonId` (`mlb_person_id`/`mlbamid`) and optional `mlbTeamId` (`mlb_team_id`/`teamid`). The `Player` column should be like `"Name Position | TEAM"` (e.g. `Juan Soto OF | NYM`). Output is written to **data/players.json**.
The importer now emits PlayerStub-compatible fields (`playerId`, `name`, `positions[]`, `mlbTeam`, `status`, `isAvailable`) and prints skipped-row reasons for invalid records.

### Pull data from balldontlie MLB API

To generate `data/players.json` from [mlb.balldontlie.io](https://mlb.balldontlie.io/), run:

```bash
npm run import-mlb
```

Set your balldontlie API key first:

```bash
export BALLDONTLIE_API_KEY=your_api_key_here
```

Optional flags:

```bash
node scripts/fetch-mlb-data.js --season=2026 --out=data/players.json --per-page=100
node scripts/fetch-mlb-data.js --max-players=300
```

This importer pulls active players, injuries (if your plan includes that endpoint), and season stats (if your plan includes that endpoint), then writes PlayerStub-compatible records with stats included.
For free-tier keys, keep `--max-players` low (e.g. 300-400) to avoid frequent 429 rate-limit errors.

Example with your files:

```bash
npm run import-csv -- ~/Downloads/2025-player-NL-stats.csv
# or 3Year-average-NL-stats.csv / projections-NL.csv
```

## Setup

```bash
cp .env.example .env
# Edit .env: set API_LICENSE_KEY (or VALID_API_KEYS) and optionally ALLOWED_ORIGIN
npm install
npm start
```

- **PORT** (default 4001)
- **API_LICENSE_KEY** – single key, or **VALID_API_KEYS** – comma-separated keys
- **ALLOWED_ORIGIN** – CORS origin (e.g. `http://localhost:3000` for draft kit)
- **PLAYERS_DATA_PATH** – optional override path to player data JSON (default is `data/players.json`).

## Deploy to Vercel
This repo is configured for Vercel using:

- `api/index.js` as the serverless entrypoint
- `vercel.json` rewrite to route all paths to the Express app

Steps:

1. Push this repo to GitHub.
2. In Vercel: **Add New -> Project**, then import this repository.
3. Keep defaults and deploy.
4. In **Project Settings -> Environment Variables**, set:
   - `API_LICENSE_KEY` (required)
   - `ALLOWED_ORIGIN` (for MVP you can use `*`)
5. Redeploy after adding env vars.
6. Verify:
   - `https://<your-vercel-domain>/health`
7. Add custom domain:
   - **Project Settings -> Domains** -> add `api.yourdomain.com`
   - Create the DNS records Vercel shows at your registrar.

## Demo UI

Open `http://localhost:4001` (or `/demo.html`) to use the small front end:

1. **License check** – GET /license/check with your API key
2. **Pull players** – Search + filter + sort from the UI (full stack via GET /players and GET /players/filters)
3. **Push usage** – POST /usage with a sample event

## Project structure

- `src/routes/*` only defines endpoints and middleware.
- `src/controllers/*` contains request handlers.
- `src/services/playersService.js` contains player data loading, filter parsing, sorting, and pagination logic.

## Troubleshooting

**`EADDRINUSE: address already in use :::4001`** – Another process (often a previous run of this API) is using port 4001. Free it with:

```bash
lsof -ti :4001 | xargs kill -9
```

Or set `PORT=4002` (or another port) in `.env` and restart.

## Connecting the draft kit

In the draft kit repo:

- Add env: `PLAYER_API_URL` (e.g. `http://localhost:4001`), `PLAYER_API_KEY` (license key).
- Replace local player fetch with `GET <PLAYER_API_URL>/players` and header `X-API-Key: <PLAYER_API_KEY>`.
- Call `POST <PLAYER_API_URL>/usage` when the user does something (e.g. opens draft room), with the same license header.

