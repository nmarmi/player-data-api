# DraftIQ — Player Data API User Stories & Execution Plan

## Product Vision

The Player Data API is the **data backbone** for a fantasy baseball auction draft assistant. It owns player identity data, seed datasets, external MLB data ingestion, valuations, and recommendations. The Draft Kit repo consumes this API.

## Relationship to Draft Kit

The Draft Kit repo owns the live auction state (purchases, budgets, rosters, history). This repo provides the player pool and, later, analytics. The Draft Kit sends draft state to this API to receive valuations and recommendations.

---

## Execution Order

### Phase 1: Data Model & ID Standardization (do first, unblocks Draft Kit)
- US-1.1, US-1.2, US-1.3, US-1.4, US-1.5
- No external dependencies. Aligns data shape so Draft Kit can consume it.

### Phase 2: API Contract & Cleanup (do alongside Phase 1)
- US-2.1, US-2.2, US-2.3, US-2.6, US-2.7, US-9.1, US-9.2, US-9.3
- Establishes the endpoints the Draft Kit will call and cleans up the repo identity.

### Phase 3: Placeholder Valuation & Recommendation Endpoints
- US-2.4, US-2.5
- Contract matters more than logic. Naive implementations are fine. Enables Draft Kit Milestone 3 integration.

### Phase 4: Database & Persistence (Milestone 2)
- US-3.1, US-3.2, US-3.3, US-3.4
- Replaces in-memory JSON with a proper data store.

### Phase 5: Testing & Ops (Milestone 2)
- US-7.1, US-7.2, US-7.4, US-8.1
- Foundation for quality and deployability.

### Phase 6: External MLB Data Ingestion (Milestone 4)
- US-4.1, US-4.2, US-4.3, US-4.4, US-4.5, US-4.6, US-4.7, US-4.8
- Brings in real baseball data to replace seed data.
- Uses the free MLB Stats API (`statsapi.mlb.com`) — no API key required.

### Phase 7: Valuation Engine (Milestone 5)
- US-5.1, US-5.2, US-5.3, US-5.4, US-5.5
- The project's own valuation model. Required by Activity 7.

### Phase 8: Recommendation Engine (Milestone 5)
- US-6.1, US-6.2, US-6.3, US-6.4
- Actionable draft advice built on top of the valuation engine.

### Phase 9: Remaining Testing & Ops
- US-7.3, US-7.5, US-8.2, US-8.3, US-8.4
- Full test coverage and production readiness.

---

## Epic 1: Data Model & ID Standardization (Milestone 1)

### US-1.1: Adopt standard player ID format
**As a** developer integrating the Draft Kit with the Player Data API, **I want** all player records to use the `mlb-{mlbPersonId}` ID format, **so that** player identity is consistent across both repos.

**Acceptance criteria:**
- Every player record uses `mlb-{mlbPersonId}` as its `playerId` (e.g., `mlb-592450`)
- The legacy `id` field (e.g., `p001`) is removed or aliased
- The `/players` endpoint returns `playerId` in the new format
- Seed data and CSV import both produce the new format

### US-1.2: Adopt standard MLB team ID format
**As a** developer, **I want** MLB team references to use the `mlb-{mlbTeamId}` format, **so that** team identity is unambiguous and separate from fantasy team identity.

**Acceptance criteria:**
- Player records include an `mlbTeamId` field using `mlb-{mlbTeamId}` format
- The human-readable `mlbTeam` abbreviation (e.g., `LAD`) is retained as a display field
- API responses include both `mlbTeamId` and `mlbTeam`

### US-1.3: Align player data shape to PlayerStub model
**As a** Draft Kit consumer, **I want** the API to return players matching the `PlayerStub` schema, **so that** the Draft Kit can load a player pool without transformation.

**Acceptance criteria:**
- Player records include: `playerId`, `name`, `positions` (array), `mlbTeam`, `status`, `isAvailable`
- `positions` is an array of strings (e.g., `["OF", "DH"]`), not a comma-separated string
- `status` holds a placeholder value (e.g., `"active"`) for now
- `isAvailable` defaults to `true`
- Legacy stat fields (`ab`, `r`, `h`, etc.) remain available but are not required in the stub response

### US-1.4: Create a rich seed dataset
**As a** Draft Kit developer working before API integration is complete, **I want** a local seed dataset of 300+ realistic player stubs, **so that** the Draft Kit can function with a full-sized player pool.

**Acceptance criteria:**
- Seed file contains at least 300 players spanning all eligible positions
- Each player has: `playerId` (mlb-format), `name`, `positions` (array), `mlbTeam`, `status`
- Data uses real MLB player names and approximate real person IDs where possible
- Seed data loads automatically when no external data source is configured
- Note: This seed file is the canonical source. The Draft Kit repo imports a copy.

### US-1.5: Update CSV import script to produce new schema
**As a** developer, **I want** the CSV import script to produce `players.json` in the new `PlayerStub`-compatible format, **so that** imported data immediately works with the updated API.

**Acceptance criteria:**
- `scripts/csv-to-players.js` maps CSV columns to the new schema
- Output includes `playerId` in `mlb-{id}` format
- Output includes `positions` as an array
- Script validates required fields and reports skipped rows

---

## Epic 2: API Contract for Draft Kit Integration (Milestone 1 & 3)

### US-2.1: Player pool export endpoint
**As a** Draft Kit, **I want** a single endpoint that returns the entire eligible player pool, **so that** I can load all available players into a draft session.

**Acceptance criteria:**
- `GET /players/pool` returns all players without pagination (or with a high limit)
- Response shape: `{ success: true, players: PlayerStub[] }`
- Supports optional `positions` filter to pre-filter by eligibility
- Response is fast enough for initial draft load (<2s for 500 players)

### US-2.2: Single player lookup endpoint
**As a** Draft Kit, **I want** to look up a single player by ID, **so that** I can fetch details for a specific player during the draft.

**Acceptance criteria:**
- `GET /players/:playerId` returns a single player record
- Returns 404 with `{ success: false, error: "Player not found" }` if ID doesn't exist
- Response includes full player data (stub fields + any available stats)

### US-2.3: Player search endpoint (refine existing)
**As a** Draft Kit user, **I want** to search players by name, team, or position, **so that** I can quickly find who I'm looking for during a live draft.

**Acceptance criteria:**
- `GET /players?search=...` continues to work with name/team/position matching
- Position filter accepts multiple values: `?position=OF,SS`
- Team filter accepts multiple values: `?team=LAD,NYY`
- Results return `PlayerStub` shape
- Pagination via `limit` and `offset` remains functional

### US-2.4: Player valuation endpoint (placeholder)
**As a** Draft Kit, **I want** to request dollar valuations for players given the current draft state, **so that** I can display recommended bid amounts.

**Acceptance criteria:**
- `POST /players/valuations` accepts a request body with `{ leagueSettings, draftState }`
- For now, returns placeholder dollar values (e.g., based on `fpts` ranking)
- Response shape: `{ success: true, valuations: [{ playerId, dollarValue, rank }] }`
- Endpoint exists and returns data even if logic is naive — the contract is what matters
- Draft state includes: `availablePlayerIds`, `teamBudgets`, `rosterSlots`

### US-2.5: Player recommendation endpoint (placeholder)
**As a** Draft Kit, **I want** to request draft recommendations based on current draft state, **so that** I can see value picks and nomination suggestions.

**Acceptance criteria:**
- `POST /players/recommendations` accepts `{ leagueSettings, draftState, teamId }`
- For now, returns a simple ranked list based on value above placeholder price
- Response shape: `{ success: true, recommendations: [{ playerId, recommendedBid, reason }] }`
- Endpoint exists with placeholder logic — the contract is what matters

### US-2.6: API versioning strategy
**As a** developer, **I want** the API to support versioning from the start, **so that** breaking changes don't silently break the Draft Kit.

**Acceptance criteria:**
- All endpoints are accessible under `/api/v1/...`
- Legacy unversioned routes continue to work as aliases (or are removed)
- Response includes an `apiVersion` field or header

### US-2.7: Standardize API error responses
**As a** Draft Kit developer, **I want** consistent error response shapes across all endpoints, **so that** error handling in the client is predictable.

**Acceptance criteria:**
- All error responses follow: `{ success: false, error: string, code?: string }`
- 400 for bad requests, 401 for auth failures, 404 for not found, 500 for server errors
- Validation errors include field-level detail where applicable

---

## Epic 3: Database & Persistence Layer (Milestone 2)

### US-3.1: Choose and integrate a database
**As a** developer, **I want** player data stored in a database rather than flat JSON files, **so that** data can be updated without redeploying.

**Acceptance criteria:**
- A database is selected (e.g., SQLite for simplicity, PostgreSQL for production)
- Database connection is configured via environment variables
- Application starts and connects to the database on boot
- Fallback to seed data if database is empty

### US-3.2: Player table schema
**As a** developer, **I want** a `players` table matching the `PlayerStub` + stats model.

**Acceptance criteria:**
- Table includes: `player_id` (PK), `name`, `positions` (JSON array or normalized), `mlb_team_id`, `mlb_team_abbr`, `status`, `created_at`, `updated_at`
- Optional stats columns or a separate `player_stats` table
- Migration script creates the table
- Seed script populates initial data

### US-3.3: Refactor playersService to use database
**As a** developer, **I want** the players service to query the database instead of loading a JSON file.

**Acceptance criteria:**
- `playersService` reads from the database
- All existing query features (search, filter, sort, paginate) work against the DB
- JSON fallback remains as a degraded mode for development without a DB
- No performance regression

### US-3.4: Data ingestion table for tracking sync state
**As a** developer, **I want** a table that tracks when each data source was last synced, **so that** the refresh policy can be implemented correctly.

**Acceptance criteria:**
- Table: `data_sync_log` with `source`, `last_sync_at`, `status`, `record_count`
- Sources include: `player_metadata`, `injuries`, `depth_charts`, `transactions`
- Service can check whether a refresh is needed based on staleness thresholds

---

## Epic 4: External MLB Data Ingestion (Milestone 4)

> **Data source:** The free, unauthenticated MLB Stats API at `statsapi.mlb.com/api/v1`.
> No API key is required. All ingestion jobs call this public API directly.
> The previously used balldontlie API (which gated injuries, depth charts, and
> transactions behind paid tiers) is replaced entirely.

### US-4.1: Player metadata ingestion from MLB Stats API
**As a** system, **I want** to sync player identity data from the free MLB Stats API, **so that** the player pool is accurate, complete, and costs nothing to maintain.

**Acceptance criteria:**
- Ingestion job fetches all active MLB players via `GET /api/v1/sports/1/players?season={year}` (sportId 1 = MLB)
- Alternatively, iterates all 30 teams using `GET /api/v1/teams/{teamId}/roster?rosterType=40Man&hydrate=person` to capture the 40-man roster with player detail
- Each player is stored/updated with: `playerId` (mlb-format using the `person.id` from the API), `name`, `positions`, `mlbTeam`, `status`
- No API key or authorization header is required
- Job is idempotent — safe to re-run without duplicating data
- Job logs results: players added, updated, unchanged
- Refresh policy: once per season or on manual trigger

### US-4.2: Injury status ingestion via roster hydration
**As a** Draft Kit user, **I want** current injury information reflected in the player pool, **sourced from the free MLB Stats API**.

**Acceptance criteria:**
- Ingestion job iterates all 30 teams and fetches `GET /api/v1/teams/{teamId}/roster?rosterType=active&hydrate=person(injuries)` to obtain injury data embedded in roster responses
- As a supplementary source, fetches recent IL-related transactions via `GET /api/v1/transactions?startDate={7daysAgo}&endDate={today}` and filters for transaction types containing "Injured List", "Disabled List", or "Paternity List"
- Player `status` field updates to reflect injury state (e.g., `"IL-10"`, `"IL-60"`, `"DTD"`)
- No API key is required — the MLB Stats API hydration parameter provides injury data on the free tier
- Refresh policy: every 15–60 minutes during active use, with manual refresh option
- Stale data is indicated in API response (e.g., `lastUpdated` timestamp)

### US-4.3: Depth chart ingestion from MLB Stats API
**As a** Draft Kit user, **I want** depth chart context available for players, **so that** I can assess playing time before bidding.

**Acceptance criteria:**
- Ingestion job iterates all 30 teams and fetches `GET /api/v1/teams/{teamId}/roster?rosterType=depthChart`
- The response includes players grouped by position with an implicit ordering (first listed = starter)
- Player records include a `depthChartRank` (1 = starter, 2 = backup, etc.) and `depthChartPosition` field
- Refresh policy: every 6–12 hours
- Data is normalized into a consistent format across all teams
- No API key is required

### US-4.4: Transaction/roster status ingestion from MLB Stats API
**As a** Draft Kit user, **I want** recent transactions (call-ups, send-downs, DFA, trades) reflected in the player pool.

**Acceptance criteria:**
- Ingestion job fetches `GET /api/v1/transactions?startDate={lookback}&endDate={today}` (lookback defaults to 7 days)
- Filters transactions by relevant types: trades, call-ups/optioned, DFA, released, IL placements/activations
- Player `status` and `mlbTeam` update when transactions are detected
- Refresh policy: every 6–12 hours
- Transaction history is optionally stored in a `transactions` table for context and audit
- No API key is required

### US-4.5: Manual refresh trigger endpoint
**As a** Draft Kit user, **I want** to trigger a data refresh on demand.

**Acceptance criteria:**
- `POST /admin/refresh` triggers a full data sync against the MLB Stats API
- Accepts optional `source` parameter to refresh specific data (e.g., `player_metadata`, `injuries`, `depth_charts`, `transactions`)
- Returns sync results: `{ success: true, sources: [{ source, recordsUpdated, duration }] }`
- Protected by admin-level auth
- Since the MLB Stats API has no auth requirement, refreshes should always succeed (barring network issues)

### US-4.6: Scheduled ingestion jobs
**As a** system, **I want** data syncs to run on a schedule without manual intervention.

**Acceptance criteria:**
- Static data (player metadata) syncs once daily or on deploy
- Daily-changing data (depth charts, transactions) syncs every 6–12 hours
- Frequently changing data (injuries) syncs every 15–60 minutes during configured active hours
- Jobs are idempotent and safe to run concurrently
- Job failures are logged and do not crash the application
- Rate limiting note: the MLB Stats API is free but undocumented on rate limits; jobs should include polite pacing (200–500ms between requests) and back off on HTTP 429

### US-4.7: Data freshness indicators in API responses
**As a** Draft Kit developer, **I want** API responses to include data freshness metadata.

**Acceptance criteria:**
- Player list and detail responses include `dataAsOf` timestamp
- Valuation responses include `dataAsOf` for both player data and draft state
- If any data source is stale beyond its threshold, response includes `staleWarnings` array

### US-4.8: Season stats ingestion for valuation baseline
**As a** valuation engine (Epic 5), **I want** historical season stats available per player, **so that** dollar-value projections have real data to work from.

**Acceptance criteria:**
- Ingestion job fetches hitting stats via `GET /api/v1/stats?stats=season&group=hitting&season={prevYear}&sportIds=1&limit=500&offset=0` (paginated)
- Fetches pitching stats via the same endpoint with `group=pitching`
- Stats are stored in a `player_stats` table keyed by `(player_id, season, stat_group)`
- Key columns: `ab`, `r`, `h`, `hr`, `rbi`, `bb`, `k`, `sb`, `avg`, `obp`, `slg` (hitting); `w`, `l`, `era`, `whip`, `k9`, `ip`, `sv` (pitching)
- Refresh policy: once per season (stats from completed seasons are immutable)
- No API key is required

---

## Epic 5: Valuation Engine (Milestone 5)

> This must be the project's **own model**, not outsourced to a third party (required by Activity 7).

### US-5.1: Baseline dollar-value projection model
**As a** Draft Kit user, **I want** each player to have a projected auction dollar value.

**Acceptance criteria:**
- Model produces a dollar value for every player in the pool
- Values are calibrated to the league's salary cap and number of teams
- Values sum to approximately (salary cap × number of teams) for the total player pool
- Model uses player stats/projections as input
- This is the project's own model

### US-5.2: Positional scarcity adjustment
**As a** Draft Kit user, **I want** valuations to account for positional scarcity.

**Acceptance criteria:**
- Model calculates replacement-level value per position
- Values are adjusted by value-above-replacement at each position
- Roster slot configuration influences scarcity
- Positions with fewer quality options show appropriate value inflation

### US-5.3: League-settings-aware valuations
**As a** Draft Kit user with custom league settings, **I want** valuations to adjust to my specific league format.

**Acceptance criteria:**
- Scoring type influences which stats matter
- Number of teams affects replacement level
- Salary cap affects the dollar scale
- Roster slot configuration affects positional demand
- Valuations recalculate when league settings change

### US-5.4: Draft-state-aware dynamic re-valuation
**As a** Draft Kit user mid-draft, **I want** remaining player values to update based on what has already been purchased.

**Acceptance criteria:**
- `POST /players/valuations` accepts current draft state (purchased players, remaining budgets)
- Purchased players are excluded from the available pool for value calculations
- Remaining budget scarcity across teams affects dollar values
- Positional scarcity recalculates based on filled roster slots
- Response time is fast enough for live draft use (<3s)

### US-5.5: Value comparison view data
**As a** Draft Kit user, **I want** to see each player's projected value alongside their purchase price.

**Acceptance criteria:**
- Valuation response includes both `projectedValue` and optional `purchasePrice` if provided
- Includes a `valueGap` field (`projectedValue - purchasePrice`) for purchased players
- Enables the Draft Kit to display "value" vs "paid" comparisons

---

## Epic 6: Recommendation Engine (Milestone 5)

### US-6.1: Best available player recommendations
**As a** Draft Kit user, **I want** a ranked list of the best remaining players by value.

**Acceptance criteria:**
- `POST /players/recommendations` returns top N available players ranked by projected value
- Accounts for current draft state
- Response includes `playerId`, `name`, `projectedValue`, `rank`

### US-6.2: Positional need recommendations
**As a** Draft Kit user, **I want** recommendations that consider which roster slots I still need to fill.

**Acceptance criteria:**
- Request includes `teamId` identifying the user's fantasy team
- Response highlights players at positions the user's team still needs
- Includes a `positionalNeed` score or flag
- Recommendations balance overall value with positional need

### US-6.3: Nomination suggestions
**As a** Draft Kit user, **I want** suggestions for which players to nominate (put up for auction).

**Acceptance criteria:**
- `POST /players/recommendations/nominations` returns players to nominate
- Strategy: suggest players other teams likely overpay for that the user doesn't need
- Response includes `playerId`, `name`, `reason`
- Considers remaining team budgets and roster needs across all teams

### US-6.4: Budget strategy recommendations
**As a** Draft Kit user, **I want** guidance on how to allocate my remaining budget.

**Acceptance criteria:**
- Given user's team state, returns suggested budget allocation
- Response shape: `{ allocations: [{ position, suggestedSpend, topTargets: [] }] }`
- Accounts for remaining player pool quality at each position
- Adjusts as the draft progresses

---

## Epic 7: Testing & Quality (Milestone 2+)

### US-7.1: Set up test framework
**Acceptance criteria:**
- Test runner installed (e.g., Jest or Vitest)
- `npm test` script added to `package.json`
- At least one passing smoke test exists

### US-7.2: Unit tests for playersService
**Acceptance criteria:**
- Tests cover: search matching, team filtering, position filtering, numeric range filtering
- Tests cover: sort by each sortable field, sort order (asc/desc)
- Tests cover: pagination (limit/offset)
- Tests cover: edge cases (empty query, no results, invalid params)

### US-7.3: Unit tests for valuation engine
**Acceptance criteria:**
- Tests verify values sum to approximately total league salary pool
- Tests verify positional scarcity adjustments change values correctly
- Tests verify draft-state-aware recalculation produces different values than pre-draft
- Tests verify league settings changes affect output

### US-7.4: Integration tests for API endpoints
**Acceptance criteria:**
- Tests cover all endpoints: `/players`, `/players/:id`, `/players/pool`, `/players/valuations`, `/players/recommendations`
- Tests verify response shapes match documented contracts
- Tests verify auth middleware rejects unauthenticated requests
- Tests verify error responses for invalid inputs

### US-7.5: State transition tests for draft-aware endpoints
**Acceptance criteria:**
- Test sends sequential valuation requests with increasingly filled draft states
- Verifies purchased players are excluded from results
- Verifies remaining player values shift as pool shrinks
- Verifies budget constraints are reflected in recommendations

---

## Epic 8: Operational Readiness (Milestone 2+)

### US-8.1: Environment-based configuration for all settings
**Acceptance criteria:**
- Database connection, API keys, refresh intervals, CORS origin are all env-configured
- `.env.example` documents every variable with defaults
- Application logs its active configuration on startup (without secrets)

### US-8.2: Structured logging
**Acceptance criteria:**
- Replace `console.log` with a structured logger (e.g., pino or winston)
- Log entries include: timestamp, level, message, context
- Ingestion jobs log: source, records processed, duration, errors

### US-8.3: API documentation (OpenAPI/Swagger)
**Acceptance criteria:**
- OpenAPI 3.x spec file exists
- Spec covers all endpoints, request/response schemas, auth requirements
- Optional: Swagger UI served at `/docs`

### US-8.4: Health check improvements
**Acceptance criteria:**
- `GET /health` returns `{ status, database, dataFreshness, uptime }`
- `database` reports connected/disconnected
- `dataFreshness` reports last sync timestamps per source
- Returns HTTP 503 if database is disconnected

---

## Epic 9: Cleanup & De-emphasis (Milestone 1)

### US-9.1: Remove or relocate demo UI
**Acceptance criteria:**
- `public/demo.html`, `public/app.jsx`, `public/styles.css` are removed or moved to `/examples`
- The root `/` route returns API info JSON instead of serving HTML
- Static file middleware is removed from production config

### US-9.2: Remove usage tracking endpoint (or scope it)
**Acceptance criteria:**
- If kept: endpoint renamed to `/api/v1/analytics/usage` and events persisted
- If removed: route and controller deleted, README updated

### US-9.3: Update README for new product vision
**Acceptance criteria:**
- README states: this is the Player Data API for a fantasy baseball auction draft assistant
- Documents the relationship to the Draft Kit repo
- Lists current endpoints with updated schemas
- Describes the data ingestion and refresh strategy
- Removes references to features that don't exist

---

## Data Refresh Policy Reference

| Data Type | Refresh Frequency | MLB Stats API Source | Examples |
|-----------|-------------------|---------------------|----------|
| Static | Once per season / manual | `/sports/1/players`, `/teams/{id}/roster`, `/stats` | Player identity, season stats, team identity |
| Daily-changing | Every 6–12 hours | `/teams/{id}/roster?rosterType=depthChart`, `/transactions` | Depth charts, transactions, roster status |
| Frequently changing | Every 15–60 min (active use) | `/teams/{id}/roster?hydrate=person(injuries)`, `/transactions` | Injuries, IL moves, role changes |
| Draft state | Not polled — owned by Draft Kit | N/A | Purchases, budgets, availability |

---

## ID Convention Reference

| Entity | Format | Example |
|--------|--------|---------|
| Player | `mlb-{mlbPersonId}` | `mlb-592450` |
| MLB Team | `mlb-{mlbTeamId}` | `mlb-119` |
| Fantasy Team | `fantasy-team-{n}` | `fantasy-team-3` |

---

## Story Count Summary

| Priority | Stories | Milestone |
|----------|---------|-----------|
| Must do now | 1.1–1.5, 2.1–2.3, 2.6–2.7, 9.1–9.3 | 1 |
| Next | 2.4–2.5, 3.1–3.4, 7.1–7.2, 7.4, 8.1 | 2–3 |
| Then | 4.1–4.8, 8.2, 8.4 | 4 |
| Later | 5.1–5.5, 6.1–6.4, 7.3, 7.5, 8.3 | 5 |
| **Total** | **40 stories** | |
