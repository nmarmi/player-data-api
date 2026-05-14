# DraftIQ — Player Data API User Stories & Execution Plan

## Implementation Status

**53 / 61 stories complete** (87%). Stories that are implemented in the codebase are marked `✅ COMPLETED` on their heading line.

| Epic | Status | Notes |
|---|---|---|
| Epic 1 — Player identity & seed data | ✅ Done | Standard `mlb-{id}` shape, PlayerStub model, rich seed |
| Epic 2 — Endpoints & versioning | ✅ Done | All 9 stories; `/api/v1/*` canonical, legacy aliases sunset 2026-12-31 |
| Epic 3 — Database integration | ✅ Done | better-sqlite3, players + player_stats tables, sync log |
| Epic 4 — MLB Stats API ingestion | ✅ Done | All 5 sources + scheduler + freshness meta |
| Epic 5 — Valuation engine | ✅ Done | z-score above replacement, scarcity, league/draft-state aware |
| Epic 6 — Recommendations | ✅ Done | Best-available, positional need, nominations, budget strategy |
| Epic 7 — Test suite | ✅ Done | Jest + Supertest; 125 passing tests |
| Epic 8 — Cross-cutting concerns | ✅ Done | Env config, structured logs, OpenAPI spec, health, key rotation |
| Epic 9 — Product realignment | ✅ Done | Demo UI relocated, `/analytics/usage` persisted, README rewritten |
| Epic 10 — Developer accounts & licensing UI | ✅ Done | Account model, portal, key generation, audit, IP whitelisting |
| Epic 11 — Predictive valuation inputs | ⏳ Pending | Multi-year, projections, age, injury, depth-chart factors |
| Epic 13 — Push notifications | ⏳ Pending | Event detection, SSE/webhook delivery, force-trigger |

## Product Vision

The Player Data API is the **data backbone** for a fantasy baseball auction draft assistant. It owns player identity data, seed datasets, external MLB data ingestion, valuations, and recommendations. The Draft Kit repo consumes this API.

## Relationship to Draft Kit

The Draft Kit repo owns the live auction state (purchases, budgets, rosters, history). This repo provides the player pool and, later, analytics. The Draft Kit sends draft state to this API to receive valuations and recommendations.

---

## Rubric Coverage

This section maps every line in the project rubric (`416-S26-Final Project-System Testing - Project Requirements.csv`) to the Player Data API story (existing or new) that satisfies it. Rubric items handled on the Draft Kit side are marked **(Kit)**.

### Player API Licensing (10 pts)
| Rubric line | Pts | Story |
|---|---:|---|
| Front-End UI for Developer to Create/Manage Account | 2 | US-10.2 |
| Front-End UI for Key Generation | 2 | US-10.3 |
| Account Tied to Key Generation & Use | 2 | US-10.1, US-10.4 |
| IP Address Whitelisting | 2 | US-10.5 |
| Request Throttling | 2 | US-8.5 |
| License Used Properly by Draft Kit Server | 4 | **(Kit)** US-11.4, US-11.5, US-11.8 |

> Note: the rubric category sums to 12pt of underlying lines for a 10pt cap — graders can pick the strongest 5 of 6.

### Player API Valuations (10 pts)
| Rubric line | Pts | Story |
|---|---:|---|
| Test Cases 1-5 Variation Values Quality | 5 | US-7.3 (`tests/valuationEngine.test.js`) |
| Custom 1 or 3 year stats used | 1 | US-11.1 |
| Predictive stats used | 1 | US-11.2 |
| Age Used | 1 | US-11.3 |
| Injury Status Used | 1 | US-11.4 |
| Scarcity Used | 1 | US-5.2 |
| Depth Chart Position Used | 1 | US-11.5 |
| New Values requested/presented after every edit | 2 | **(Kit)** US-13.1 |

### Player API → Draft Kit Push Notification (10 pts)
| Rubric line | Pts | Story |
|---|---:|---|
| Mechanism to Force New Notification-worthy info via Player API | 5 | US-13.1, US-13.2, US-13.3 |
| Draft Kit show updated pushed state | 2 | **(Kit)** US-25.1 |
| Draft Kit employs notification system to alert user | 2 | **(Kit)** US-25.2 |
| Player Details — Depth Chart | 1 | US-4.3 (data) + **(Kit)** US-21.1 (display) |
| Player Details — Transactions/Contract | 1 | US-4.4 (data) + **(Kit)** US-21.1 (display) |
| Player Details — Injury/News | 1 | US-4.2 (data) + **(Kit)** US-21.1 (display) |

### Other rubric categories
All other categories — **Draft Kit Accounts**, **Draft Kit Prep**, **Draft Day**, **Taxi Draft**, **User Interface** — have no Player Data API surface and are mapped in `416-Minimum-Viable-Product/docs/DRAFT_KIT_USER_STORIES.md#rubric-coverage`.

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

### Phase 10: Legacy Cleanup & Bugfix (Milestone 3, alongside Draft Kit integration)
- US-2.8, US-2.9
- Deprecates unversioned routes with proper headers (US-2.8) and fixes the broken recommendations import (US-2.9) before Draft Kit starts calling `/players/recommendations` for real.

---

## Epic 1: Data Model & ID Standardization (Milestone 1)

### US-1.1: Adopt standard player ID format ✅ COMPLETED
**As a** developer integrating the Draft Kit with the Player Data API, **I want** all player records to use the `mlb-{mlbPersonId}` ID format, **so that** player identity is consistent across both repos.

**Acceptance criteria:**
- Every player record uses `mlb-{mlbPersonId}` as its `playerId` (e.g., `mlb-592450`)
- The legacy `id` field (e.g., `p001`) is removed or aliased
- The `/players` endpoint returns `playerId` in the new format
- Seed data and CSV import both produce the new format

** COMPLETED**

### US-1.2: Adopt standard MLB team ID format ✅ COMPLETED
**As a** developer, **I want** MLB team references to use the `mlb-{mlbTeamId}` format, **so that** team identity is unambiguous and separate from fantasy team identity.

**Acceptance criteria:**
- Every player record persisted in `players` table / seed includes an `mlbTeamId` column using the `mlb-{numericTeamId}` format (e.g. `mlb-119` for the Dodgers)
- The human-readable `mlbTeam` abbreviation (e.g., `LAD`) is retained as a display field
- All API responses (`GET /players`, `/players/:id`, `/players/pool`, valuations, recommendations) include both `mlbTeamId` and `mlbTeam`
- Ingestion jobs (US-4.1, US-4.4) populate `mlbTeamId` from the `team.id` field of the MLB Stats API response — never inferred from the abbreviation
- Unit test asserts both fields are present and `mlbTeamId` matches the documented `mlb-{numericId}` regex

** COMPLETED**

### US-1.3: Align player data shape to PlayerStub model ✅ COMPLETED
**As a** Draft Kit consumer, **I want** the API to return players matching the `PlayerStub` schema, **so that** the Draft Kit can load a player pool without transformation.

**Acceptance criteria:**
- Player records include: `playerId`, `name`, `positions` (array), `mlbTeam`, `status`, `isAvailable`
- `positions` is an array of strings (e.g., `["OF", "DH"]`), not a comma-separated string
- `status` holds a placeholder value (e.g., `"active"`) for now
- `isAvailable` defaults to `true`
- Legacy stat fields (`ab`, `r`, `h`, etc.) remain available but are not required in the stub response

** COMPLETED**

### US-1.4: Create a rich seed dataset ✅ COMPLETED
**As a** Draft Kit developer working before API integration is complete, **I want** a local seed dataset of 300+ realistic player stubs, **so that** the Draft Kit can function with a full-sized player pool.

**Acceptance criteria:**
- Seed file contains at least 300 players spanning all eligible positions
- Each player has: `playerId` (mlb-format), `name`, `positions` (array), `mlbTeam`, `status`
- Data uses real MLB player names and approximate real person IDs where possible
- Seed data loads automatically when no external data source is configured
- Note: This seed file is the canonical source. The Draft Kit repo imports a copy.

** COMPLETED** (1,694 player records seeded; verified via boot log: "Players table already has 1694 rows".)

### US-1.5: Update CSV import script to produce new schema ✅ COMPLETED
**As a** developer, **I want** the CSV import script to produce `players.json` in the new `PlayerStub`-compatible format, **so that** imported data immediately works with the updated API.

**Acceptance criteria:**
- `scripts/csv-to-players.js` maps CSV columns to the new schema
- Output includes `playerId` in `mlb-{id}` format
- Output includes `positions` as an array
- Script validates required fields and reports skipped rows

** COMPLETED**

---

## Epic 2: API Contract for Draft Kit Integration (Milestone 1 & 3)

### US-2.1: Player pool export endpoint ✅ COMPLETED
**As a** Draft Kit, **I want** a single endpoint that returns the entire eligible player pool, **so that** I can load all available players into a draft session.

**Acceptance criteria:**
- `GET /players/pool` returns all players without pagination (or with a high limit)
- Response shape: `{ success: true, players: PlayerStub[] }`
- Supports optional `positions` filter to pre-filter by eligibility
- Response is fast enough for initial draft load (<2s for 500 players)

** COMPLETED**

### US-2.2: Single player lookup endpoint ✅ COMPLETED
**As a** Draft Kit, **I want** to look up a single player by ID, **so that** I can fetch details for a specific player during the draft.

**Acceptance criteria:**
- `GET /players/:playerId` returns a single player record
- Returns 404 with `{ success: false, error: "Player not found" }` if ID doesn't exist
- Response includes full player data (stub fields + any available stats)

** COMPLETED**

### US-2.3: Player search endpoint (refine existing) ✅ COMPLETED
**As a** Draft Kit user, **I want** to search players by name, team, or position, **so that** I can quickly find who I'm looking for during a live draft.

**Acceptance criteria:**
- `GET /players?search=...` continues to work with name/team/position matching
- Position filter accepts multiple values: `?position=OF,SS`
- Team filter accepts multiple values: `?team=LAD,NYY`
- Results return `PlayerStub` shape
- Pagination via `limit` and `offset` remains functional

** COMPLETED**

### US-2.4: Player valuation endpoint (placeholder) ✅ COMPLETED
**As a** Draft Kit, **I want** to request dollar valuations for players given the current draft state, **so that** I can display recommended bid amounts.

**Acceptance criteria:**
- `POST /players/valuations` accepts a request body with `{ leagueSettings, draftState }`
- For now, returns placeholder dollar values (e.g., based on `fpts` ranking)
- Response shape: `{ success: true, valuations: [{ playerId, dollarValue, rank }] }`
- Endpoint exists and returns data even if logic is naive — the contract is what matters
- Draft state includes: `availablePlayerIds`, `teamBudgets`, `rosterSlots`

** COMPLETED**

### US-2.5: Player recommendation endpoint (placeholder) ✅ COMPLETED
**As a** Draft Kit, **I want** to request draft recommendations based on current draft state, **so that** I can see value picks and nomination suggestions.

**Acceptance criteria:**
- `POST /players/recommendations` accepts `{ leagueSettings, draftState, teamId }`
- For now, returns a simple ranked list based on value above placeholder price
- Response shape: `{ success: true, recommendations: [{ playerId, recommendedBid, reason }] }`
- Endpoint exists with placeholder logic — the contract is what matters

** COMPLETED**

### US-2.6: API versioning strategy ✅ COMPLETED
**As a** developer, **I want** the API to support versioning from the start, **so that** breaking changes don't silently break the Draft Kit.

**Acceptance criteria:**
- All endpoints are accessible under `/api/v1/...`
- Legacy unversioned routes continue to work as aliases (or are removed)
- Response includes an `apiVersion` field or header

** COMPLETED**

### US-2.7: Standardize API error responses ✅ COMPLETED
**As a** Draft Kit developer, **I want** consistent error response shapes across all endpoints, **so that** error handling in the client is predictable.

**Acceptance criteria:**
- All error responses follow: `{ success: false, error: string, code?: string }`
- 400 for bad requests, 401 for auth failures, 404 for not found, 500 for server errors
- Validation errors include field-level detail where applicable

** COMPLETED**

### US-2.8: Deprecate legacy unversioned routes ✅ COMPLETED
**As a** Draft Kit developer, **I want** a clear deprecation path for the unversioned `/players`, `/usage`, `/health`, `/license`, `/admin` routes, **so that** the client can migrate to `/api/v1/*` without surprise breakage.

**Acceptance criteria:**
- Every response from a legacy (unversioned) route sets a `Deprecation: true` header and a `Sunset` header containing an RFC 7231 IMF-fixdate (e.g. `Sunset: Wed, 30 Sep 2026 00:00:00 GMT`); the actual sunset date is configurable via env var `LEGACY_SUNSET_DATE` and documented in README
- A `Link` header points at the migration doc: `Link: </docs/migration-v1.md>; rel="deprecation"`
- README's "API Surface" section advertises `/api/v1/*` as the supported surface and lists the legacy routes as deprecated, with the same sunset date
- Server logs a single `warn`-level entry per process lifetime the first time a legacy route is hit (so the route can drain without log spam)
- Integration test asserts: requesting `GET /players` (legacy) returns the same body as `GET /api/v1/players` AND includes `Deprecation`, `Sunset`, and `Link` response headers
- Integration test asserts: `GET /api/v1/players` does **not** set the deprecation headers
- After the sunset date, legacy routes can be removed without code changes in any downstream consumer that followed US-11.5 in the Draft Kit

** COMPLETED**

### US-2.9: Fix recommendations controller to use the real valuation engine ✅ COMPLETED
**As a** developer, **I want** `POST /players/recommendations` to delegate to `runValuations` from `services/valuationEngine`, **so that** the endpoint doesn't throw at runtime and its output is consistent with `POST /players/valuations`.

**Acceptance criteria:**
- `recommendationsController.js` no longer imports the non-existent `computeValuations` from `valuationsController.js`
- When `player_stats` is populated, recommendations are derived from the same `runValuations` output that `/players/valuations` returns
- When `player_stats` is empty, the placeholder fallback still works (same behavior as `/players/valuations`)
- Integration test: `POST /api/v1/players/recommendations` with a minimal body returns `200` with a `recommendations` array (no 500)

** COMPLETED**

---

## Epic 3: Database & Persistence Layer (Milestone 2)

### US-3.1: Choose and integrate a database ✅ COMPLETED
**As a** developer, **I want** player data stored in a database rather than flat JSON files, **so that** data can be updated without redeploying.

**Acceptance criteria:**
- A database is selected (e.g., SQLite for simplicity, PostgreSQL for production)
- Database connection is configured via environment variables
- Application starts and connects to the database on boot
- Fallback to seed data if database is empty

** COMPLETED**

### US-3.2: Player table schema ✅ COMPLETED
**As a** developer, **I want** a `players` table matching the `PlayerStub` + stats model.

**Acceptance criteria:**
- Table includes: `player_id` (PK), `name`, `positions` (JSON array or normalized), `mlb_team_id`, `mlb_team_abbr`, `status`, `created_at`, `updated_at`
- Optional stats columns or a separate `player_stats` table
- Migration script creates the table
- Seed script populates initial data

** COMPLETED**

### US-3.3: Refactor playersService to use database ✅ COMPLETED
**As a** developer, **I want** the players service to query the database instead of loading a JSON file.

**Acceptance criteria:**
- `playersService` reads from the database
- All existing query features (search, filter, sort, paginate) work against the DB
- JSON fallback remains as a degraded mode for development without a DB
- No performance regression

** COMPLETED**

### US-3.4: Data ingestion table for tracking sync state ✅ COMPLETED
**As a** developer, **I want** a table that tracks when each data source was last synced, **so that** the refresh policy can be implemented correctly.

**Acceptance criteria:**
- Table: `data_sync_log` with `source`, `last_sync_at`, `status`, `record_count`
- Sources include: `player_metadata`, `injuries`, `depth_charts`, `transactions`
- Service can check whether a refresh is needed based on staleness thresholds

** COMPLETED**

---

## Epic 4: External MLB Data Ingestion (Milestone 4)

> **Data source:** The free, unauthenticated MLB Stats API at `statsapi.mlb.com/api/v1`.
> No API key is required. All ingestion jobs call this public API directly.
> The previously used balldontlie API (which gated injuries, depth charts, and
> transactions behind paid tiers) is replaced entirely.

### US-4.1: Player metadata ingestion from MLB Stats API ✅ COMPLETED
**As a** system, **I want** to sync player identity data from the free MLB Stats API, **so that** the player pool is accurate, complete, and costs nothing to maintain.

**Acceptance criteria:**
- Ingestion job fetches all active MLB players via `GET /api/v1/sports/1/players?season={year}` (sportId 1 = MLB)
- Alternatively, iterates all 30 teams using `GET /api/v1/teams/{teamId}/roster?rosterType=40Man&hydrate=person` to capture the 40-man roster with player detail
- Each player is stored/updated with: `playerId` (mlb-format using the `person.id` from the API), `name`, `positions`, `mlbTeam`, `status`
- No API key or authorization header is required
- Job is idempotent — safe to re-run without duplicating data
- Job logs results: players added, updated, unchanged
- Refresh policy: once per season or on manual trigger

** COMPLETED** (jobs/ingestPlayerMetadata.js; verified live: 30 teams iterated, populates `mlb_team_id` from `team.id`.)

### US-4.2: Injury status ingestion via roster hydration ✅ COMPLETED
**As a** Draft Kit user, **I want** current injury information reflected in the player pool, **sourced from the free MLB Stats API**.

**Acceptance criteria:**
- Ingestion job iterates all 30 teams and fetches `GET /api/v1/teams/{teamId}/roster?rosterType=active&hydrate=person(injuries)` to obtain injury data embedded in roster responses
- As a supplementary source, fetches recent IL-related transactions via `GET /api/v1/transactions?startDate={7daysAgo}&endDate={today}` and filters for transaction types containing "Injured List", "Disabled List", or "Paternity List"
- Player `status` field updates to reflect injury state (e.g., `"IL-10"`, `"IL-60"`, `"DTD"`)
- No API key is required — the MLB Stats API hydration parameter provides injury data on the free tier
- Refresh policy: every 15–60 minutes during active use, with manual refresh option
- Stale data is indicated in API response (e.g., `lastUpdated` timestamp)

** COMPLETED** (jobs/ingestInjuries.js + scheduler runs every 30 min in active hours.)

### US-4.3: Depth chart ingestion from MLB Stats API ✅ COMPLETED
**As a** Draft Kit user, **I want** depth chart context available for players, **so that** I can assess playing time before bidding.

**Acceptance criteria:**
- Ingestion job iterates all 30 teams and fetches `GET /api/v1/teams/{teamId}/roster?rosterType=depthChart`
- The response includes players grouped by position with an implicit ordering (first listed = starter)
- Player records include a `depthChartRank` (1 = starter, 2 = backup, etc.) and `depthChartPosition` field
- Refresh policy: every 6–12 hours
- Data is normalized into a consistent format across all teams
- No API key is required

** COMPLETED** (jobs/ingestDepthCharts.js populates `depth_chart_rank` and `depth_chart_position`; scheduler runs every 6h.)

### US-4.4: Transaction/roster status ingestion from MLB Stats API ✅ COMPLETED
**As a** Draft Kit user, **I want** recent transactions (call-ups, send-downs, DFA, trades) reflected in the player pool.

**Acceptance criteria:**
- Ingestion job fetches `GET /api/v1/transactions?startDate={lookback}&endDate={today}` (lookback defaults to 7 days)
- Filters transactions by relevant types: trades, call-ups/optioned, DFA, released, IL placements/activations
- Player `status` and `mlbTeam` update when transactions are detected
- Refresh policy: every 6–12 hours
- Transaction history is optionally stored in a `transactions` table for context and audit
- No API key is required

** COMPLETED** (jobs/ingestTransactions.js + `transactions` table; scheduler runs every 6h.)

### US-4.5: Manual refresh trigger endpoint ✅ COMPLETED
**As a** Draft Kit user, **I want** to trigger a data refresh on demand.

**Acceptance criteria:**
- `POST /admin/refresh` triggers a full data sync against the MLB Stats API
- Accepts optional `source` parameter to refresh specific data (e.g., `player_metadata`, `injuries`, `depth_charts`, `transactions`)
- Returns sync results: `{ success: true, sources: [{ source, recordsUpdated, duration }] }`
- Protected by admin-level auth
- Since the MLB Stats API has no auth requirement, refreshes should always succeed (barring network issues)

** COMPLETED** (`POST /api/v1/admin/refresh` with optional `source` param; gated by `requireAdmin` middleware.)

### US-4.6: Scheduled ingestion jobs ✅ COMPLETED
**As a** system, **I want** data syncs to run on a schedule without manual intervention.

**Acceptance criteria:**
- Static data (player metadata) syncs once daily or on deploy
- Daily-changing data (depth charts, transactions) syncs every 6–12 hours
- Frequently changing data (injuries) syncs every 15–60 minutes during configured active hours
- Jobs are idempotent and safe to run concurrently
- Job failures are logged and do not crash the application
- Rate limiting note: the MLB Stats API is free but undocumented on rate limits; jobs should include polite pacing (200–500ms between requests) and back off on HTTP 429

** COMPLETED** (jobs/scheduler.js — daily for metadata, 6h for depth/txns, 30m for injuries during active hours; runs boot-time staleness check.)

### US-4.7: Data freshness indicators in API responses ✅ COMPLETED
**As a** Draft Kit developer, **I want** API responses to include data freshness metadata.

**Acceptance criteria:**
- Player list and detail responses include `dataAsOf` timestamp
- Valuation responses include `dataAsOf` for both player data and draft state
- If any data source is stale beyond its threshold, response includes `staleWarnings` array

** COMPLETED** (controllers attach `dataAsOf` and `staleWarnings` from `syncLog.getDataFreshnessMeta()`; verified live: detail response includes warnings for `depth_charts`, `injuries`, `transactions` when sync log is older than threshold.)

### US-4.8: Season stats ingestion for valuation baseline ✅ COMPLETED
**As a** valuation engine (Epic 5), **I want** historical season stats available per player, **so that** dollar-value projections have real data to work from.

**Acceptance criteria:**
- Ingestion job fetches hitting stats via `GET /api/v1/stats?stats=season&group=hitting&season={prevYear}&sportIds=1&limit=500&offset=0` (paginated)
- Fetches pitching stats via the same endpoint with `group=pitching`
- Stats are stored in a `player_stats` table keyed by `(player_id, season, stat_group)`
- Key columns: `ab`, `r`, `h`, `hr`, `rbi`, `bb`, `k`, `sb`, `avg`, `obp`, `slg` (hitting); `w`, `l`, `era`, `whip`, `k9`, `ip`, `sv` (pitching)
- Refresh policy: once per season (stats from completed seasons are immutable)
- No API key is required

** COMPLETED** (jobs/ingestStats.js + `player_stats` table; sync log shows 1,638 records.)

---

## Epic 5: Valuation Engine (Milestone 5)

> This must be the project's **own model**, not outsourced to a third party (required by Activity 7).

### US-5.1: Baseline dollar-value projection model ✅ COMPLETED
**As a** Draft Kit user, **I want** each player to have a projected auction dollar value.

**Acceptance criteria:**
- Model produces a dollar value for every player in the pool
- Values are calibrated to the league's salary cap and number of teams
- Values sum to approximately (salary cap × number of teams) for the total player pool
- Model uses player stats/projections as input
- This is the project's own model

** COMPLETED**

### US-5.2: Positional scarcity adjustment ✅ COMPLETED
**As a** Draft Kit user, **I want** valuations to account for positional scarcity.

**Acceptance criteria:**
- Model calculates replacement-level value per position
- Values are adjusted by value-above-replacement at each position
- Roster slot configuration influences scarcity
- Positions with fewer quality options show appropriate value inflation
- **Integration contract:** `leagueSettings.rosterSlots` is accepted as **either** a flat integer (legacy placeholder shape) **or** a position map matching the Draft Kit's `DraftSession.leagueSettings.rosterSlots` (e.g. `{ "C":2, "1B":1, "2B":1, "3B":1, "SS":1, "OF":5, "UTIL":1, "SP":5, "RP":3, "BENCH":4 }`)
- When a position map is supplied, the engine derives `hitterSlotsPerTeam` and `pitcherSlotsPerTeam` by partitioning the map keys (hitters: `C, 1B, 2B, 3B, SS, OF, UTIL, DH`; pitchers: `SP, RP, P`; `BENCH` is split proportionally or ignored, documented in code)
- Unknown position keys are logged and ignored rather than crashing

** COMPLETED**

### US-5.3: League-settings-aware valuations ✅ COMPLETED
**As a** Draft Kit user with custom league settings, **I want** valuations to adjust to my specific league format.

**Acceptance criteria:**
- Scoring type influences which stats matter
- Number of teams affects replacement level
- Salary cap affects the dollar scale
- Roster slot configuration affects positional demand
- Valuations recalculate when league settings change
- **Integration contract:** the endpoint accepts the Draft Kit's `DraftSession.leagueSettings` shape **directly**, with this canonical mapping applied server-side:

  | Draft Kit field      | Engine field              | Notes                                                          |
  |----------------------|---------------------------|----------------------------------------------------------------|
  | `numberOfTeams`      | `numTeams`                | required                                                       |
  | `salaryCap`          | `budget`                  | required                                                       |
  | `rosterSlots` (map)  | `hitterSlotsPerTeam` / `pitcherSlotsPerTeam` | derived per US-5.2                            |
  | `scoringType`        | selects `hittingCategories` / `pitchingCategories` presets | `"5x5 Roto"`→default, `"H2H Categories"`→same, `"Points"`→single `fpts` category |
  | `draftType`          | ignored                   | must equal `"AUCTION"`                                         |
- The engine's legacy field names (`numTeams`, `budget`, `hitterBudgetPct`, `hitterSlotsPerTeam`, `pitcherSlotsPerTeam`, `hittingCategories`, `pitchingCategories`, `statSeason`, `minAB`, `minIP`) are still accepted as overrides for backward compatibility and for internal callers
- A single adapter function `normalizeLeagueSettings(input)` implements the mapping and is unit-tested with both shapes

** COMPLETED**

### US-5.4: Draft-state-aware dynamic re-valuation ✅ COMPLETED
**As a** Draft Kit user mid-draft, **I want** remaining player values to update based on what has already been purchased.

**Acceptance criteria:**
- `POST /players/valuations` accepts current draft state (purchased players, remaining budgets)
- Purchased players are excluded from the available pool for value calculations
- Remaining budget scarcity across teams affects dollar values
- Positional scarcity recalculates based on filled roster slots
- Response time is fast enough for live draft use (<3s)
- **Integration contract:** `draftState` is the canonical cross-repo shape the Draft Kit sends for every valuation/recommendation/nomination call:

  ```ts
  draftState = {
    availablePlayerIds: string[],                           // ["mlb-660271", ...]
    purchasedPlayers: Array<{                               // empty pre-draft
      playerId: string,                                     // "mlb-..."
      teamId: string,                                       // "fantasy-team-3"
      price: number,
      positionFilled?: string                               // the roster slot it consumed
    }>,
    teamBudgets: Record<string, number>,                    // { "fantasy-team-3": 187, ... }
    filledRosterSlots: Record<string, Record<string, number>>,
                                                            // { "fantasy-team-3": { "OF": 2, "SS": 1, ... }, ... }
    rosterSlots?: Record<string, number>                    // optional echo of leagueSettings.rosterSlots for per-team openings
  }
  ```
- Remaining salary pool = `sum(teamBudgets)` minus `$1 × openSlotsAcrossAllTeams`; used in place of `(numTeams × budget)` when `purchasedPlayers.length > 0`
- Remaining open slots per position = `sum over teams of (rosterSlots[pos] − filledRosterSlots[teamId][pos])`; drives positional replacement level
- `availablePlayerIds` is authoritative — purchased players are excluded even if not in `purchasedPlayers[]`
- Missing / empty `draftState` is treated as pre-draft and returns the static baseline valuation

** COMPLETED**

### US-5.5: Value comparison view data ✅ COMPLETED
**As a** Draft Kit user, **I want** to see each player's projected value alongside their purchase price.

**Acceptance criteria:**
- Valuation response includes both `projectedValue` and, for purchased players, `purchasePrice`
- **`purchasePrice` is resolved server-side from `draftState.purchasedPlayers`** — the client does not pass a separate field
- Includes a `valueGap` field (`projectedValue - purchasePrice`) for purchased players only
- Available players return `purchasePrice: null` and `valueGap: null`
- Enables the Draft Kit to display "value" vs "paid" comparisons without additional lookups

** COMPLETED**

---

## Epic 6: Recommendation Engine (Milestone 5)

> All endpoints in this epic accept the same `{ leagueSettings, draftState, teamId? }` contract defined in US-5.3 and US-5.4. `teamId` format is `fantasy-team-{n}` as minted by the Draft Kit. Each endpoint includes a tier classification (`buy` / `fair` / `avoid`) and any threshold metadata in the response so the Draft Kit can render without duplicating logic.

### US-6.1: Best available player recommendations ✅ COMPLETED
**As a** Draft Kit user, **I want** a ranked list of the best remaining players by value.

**Acceptance criteria:**
- `POST /players/recommendations` returns top N available players ranked by projected value
- Accounts for current draft state (delegates to the engine from US-5.4)
- Response shape: `{ success: true, recommendations: [{ playerId, name, projectedValue, recommendedBid, rank, tier, reason }], thresholds: { buyAbove, avoidBelow } }`
- `tier` is one of `"buy" | "fair" | "avoid"` — client renders color without re-computing

** COMPLETED**

### US-6.2: Positional need recommendations ✅ COMPLETED
**As a** Draft Kit user, **I want** recommendations that consider which roster slots I still need to fill.

**Acceptance criteria:**
- Request includes `teamId` identifying the user's fantasy team
- Server looks up that team's state from `draftState.filledRosterSlots[teamId]` and `draftState.teamBudgets[teamId]`, and compares against `leagueSettings.rosterSlots`
- Response highlights players at positions the user's team still needs
- Each recommendation includes a numeric `positionalNeed` score (0–1) and a boolean `fillsOpenSlot` flag
- Recommendations balance overall value with positional need (documented weighting)
- Returns `400` with `code: "UNKNOWN_TEAM"` if `teamId` isn't present in `draftState.teamBudgets`

** COMPLETED**

### US-6.3: Nomination suggestions ✅ COMPLETED
**As a** Draft Kit user, **I want** suggestions for which players to nominate (put up for auction).

**Acceptance criteria:**
- `POST /players/recommendations/nominations` returns players to nominate
- Strategy: suggest players *other* teams are likely to overpay for that the calling team doesn't need
- Response shape: `{ success: true, nominations: [{ playerId, name, reason, expectedMarketBid, myTeamNeedScore }] }`
- **Required inputs:** `availablePlayerIds`, `teamBudgets`, `filledRosterSlots`, `teamId` — the endpoint does **not** need `purchasedPlayers` detail (only aggregate budget state)
- Documented strategy in README: ranks available players by `(expectedMarketBid − myTeamValueToFill)` descending

** COMPLETED**

### US-6.4: Budget strategy recommendations ✅ COMPLETED
**As a** Draft Kit user, **I want** guidance on how to allocate my remaining budget.

**Acceptance criteria:**
- Given user's team state, returns suggested budget allocation
- Response shape: `{ success: true, allocations: [{ position, suggestedSpend, openSlots, topTargets: [{ playerId, name, projectedValue }] }] }`
- Accounts for remaining player pool quality at each position
- `openSlots` per position is derived from `filledRosterSlots[teamId]` vs `leagueSettings.rosterSlots`
- Adjusts as the draft progresses (stateless — each call reflects the `draftState` in the request)

** COMPLETED**

---

## Epic 7: Testing & Quality (Milestone 2+)

### US-7.1: Set up test framework ✅ COMPLETED
**Acceptance criteria:**
- Test runner installed (e.g., Jest or Vitest)
- `npm test` script added to `package.json`
- At least one passing smoke test exists

** COMPLETED** (Jest + supertest; `npm test` runs 85 tests across `tests/smoke.test.js`, `playersService.test.js`, `valuationEngine.test.js`, `api.integration.test.js`.)

### US-7.2: Unit tests for playersService ✅ COMPLETED
**Acceptance criteria:**
- Tests cover: search matching, team filtering, position filtering, numeric range filtering
- Tests cover: sort by each sortable field, sort order (asc/desc)
- Tests cover: pagination (limit/offset)
- Tests cover: edge cases (empty query, no results, invalid params)

** COMPLETED** (`tests/playersService.test.js` covers all four bullets.)

### US-7.3: Unit tests for valuation engine ✅ COMPLETED
**Acceptance criteria:**
- Tests verify values sum to approximately total league salary pool
- Tests verify positional scarcity adjustments change values correctly
- Tests verify draft-state-aware recalculation produces different values than pre-draft
- Tests verify league settings changes affect output
- **Integration-shape test:** posts a body using the Draft Kit's `leagueSettings` shape (`numberOfTeams`, `salaryCap`, `rosterSlots` map, `scoringType: "5x5 Roto"`) and asserts the engine converges and returns a non-empty `valuations` array
- **Adapter test:** `normalizeLeagueSettings` (from US-5.3) is tested with both the Draft Kit shape and the legacy engine shape and produces equivalent output for equivalent inputs
- **US-5.5 output-shape test:** purchased players in the response carry `purchasePrice` (server-resolved from `draftState.purchasedPlayers`) and `valueGap = projectedValue − purchasePrice`; available players carry `purchasePrice: null` and `valueGap: null`

** COMPLETED** (`tests/valuationEngine.test.js` — 7 tests covering all six acceptance criteria.)

### US-7.4: Integration tests for API endpoints ✅ COMPLETED
**Acceptance criteria:**
- Tests cover all endpoints: `/players`, `/players/:id`, `/players/pool`, `/players/valuations`, `/players/recommendations`, `/players/recommendations/nominations`
- Tests verify response shapes match documented contracts (US-5.3, US-5.4, US-6.1–6.4)
- Tests verify auth middleware rejects unauthenticated requests
- Tests verify error responses for invalid inputs — including Draft-Kit-shaped bodies with missing `rosterSlots` or unknown `teamId` → `400` with field-level `fields: []` detail
- Tests verify versioned (`/api/v1/*`) and legacy unversioned routes behave identically, and the legacy routes set the `Deprecation` + `Sunset` + `Link` headers from US-2.8

** COMPLETED** (`tests/api.integration.test.js` — covers all six endpoints + auth + error fields + deprecation headers.)

### US-7.5: State transition tests for draft-aware endpoints ✅ COMPLETED
**Acceptance criteria:**
- Test sends sequential valuation requests with increasingly filled draft states
- Verifies purchased players appear in the response with `purchasePrice` set (per US-5.5) so the Draft Kit can render value-vs-paid in one call, while remaining-pool calibration excludes them
- Verifies remaining (available) player values shift as pool shrinks
- Verifies budget constraints are reflected in recommendations (high-budget vs low-budget recommendations differ)

** COMPLETED** (the "US-7.5: sequential draft-state transitions update valuations and recommendations" test in `api.integration.test.js` exercises all four bullets, updated to match the corrected US-5.5 contract.)

---

## Epic 8: Operational Readiness (Milestone 2+)

### US-8.1: Environment-based configuration for all settings ✅ COMPLETED
**Acceptance criteria:**
- Database connection, API keys, refresh intervals, CORS origin are all env-configured
- `.env.example` documents every variable with defaults
- Application logs its active configuration on startup (without secrets)

** COMPLETED** (`.env.example` documents 14 vars across server, auth, CORS, database, legacy-API deprecation, scheduler, and logging; `src/index.js#logActiveConfig` emits the full config as a single structured `info` event on boot — secrets are reported only as counts (e.g. `apiKeysConfigured: 1`, `adminKeyConfigured: false`).)

### US-8.2: Structured logging ✅ COMPLETED
**Acceptance criteria:**
- Replace `console.log` with a structured logger (e.g., pino or winston)
- Log entries include: timestamp, level, message, context
- Ingestion jobs log: source, records processed, duration, errors

** COMPLETED** (zero-dep `src/logger.js` emits one JSON line per call with `time` (ISO 8601), `level`, `msg`, plus context; supports `child()` for bound context, `LOG_LEVEL` filtering, `LOG_PRETTY=true` for dev-readable output. Migrated boot path, `app.js`, db layer, all five ingestion jobs, scheduler, admin/valuations/recommendations/usage controllers. Per-job summary in `scheduler.safeRun` emits `{ source, durationMs, recordCount, error?, ... }` matching the US-8.2 spec line. Contract verified by `tests/logger.test.js` (5 tests).)

### US-8.3: API documentation (OpenAPI/Swagger) ✅ COMPLETED
**Acceptance criteria:**
- OpenAPI 3.x spec at `docs/openapi.yaml` (checked into the repo, not generated at runtime only)
- Spec covers all `/api/v1/*` endpoints, request/response schemas, auth requirements (`X-API-Key`)
- Spec includes the canonical `leagueSettings` and `draftState` shapes from US-5.3 / US-5.4 as named components, so the Draft Kit can reference them by `$ref`
- A copy of the spec (or a stable URL link to it) is referenced in the Draft Kit's `docs/` so cross-repo changes have a paper trail
- Optional: Swagger UI served at `/docs`
- Generation is verified in CI: a smoke test boots the server and asserts every documented path responds (i.e. spec doesn't drift away from real routes)

** COMPLETED** (`docs/openapi.yaml` documents 12 paths under `/api/v1/*` with full request/response schemas + `ApiKey`/`BearerAuth` security schemes; named `LeagueSettings`, `DraftState`, `PlayerStub`, `Valuation`, `Recommendation`, `Health`, `Error` components are referenced by `$ref`. Draft Kit's [`docs/PLAYER-DATA-API.md`](../../416-Minimum-Viable-Product/docs/PLAYER-DATA-API.md) links to it as the canonical contract. `tests/openapi.test.js` boots the app and asserts every documented path responds (no `Route not found` 404s) — runs in 0.3s.)

### US-8.4: Health check improvements ✅ COMPLETED
**Acceptance criteria:**
- `GET /health` returns `{ status, database, dataFreshness, uptime }`
- `database` reports connected/disconnected
- `dataFreshness` reports last sync timestamps per source
- Returns HTTP 503 if database is disconnected

** COMPLETED** (`src/controllers/healthController.js` returns `{ success, status: ok|degraded, service, database: { connected, error? }, dataFreshness: { source → { lastSyncAt, status, isStale } }, uptimeSeconds }`. Cheap `SELECT 1` round-trip confirms the DB connection. Returns `200` healthy, `503` degraded. Exempt from license auth (mounted before `requireLicense` in `src/app.js`) so external uptime checkers can probe it. Verified by an integration test plus the live boot run.)

### US-8.5: API key auth contract for cross-repo callers ✅ COMPLETED
**As a** Player Data API operator, **I want** a documented, testable API key handshake for the Draft Kit to authenticate, **so that** the secret rotation story is clear and unauthorized callers are rejected predictably.

**Acceptance criteria:**
- Authenticated `/api/v1/*` endpoints require an `X-API-Key` header (or `Authorization: Bearer <key>`) — the existing convention used by `licensed-player-api.js` in the Draft Kit
- Missing or unknown key → `401` with `{ success: false, error: "Invalid or missing license", code: "UNAUTHORIZED" }`
- Keys are loaded from env (`API_LICENSE_KEY` for a single key, or `VALID_API_KEYS=key1,key2,…` for multiple consumers during rotation)
- README documents how to issue, rotate, and revoke a key (in dev: edit `.env`; in prod: change env var + restart)
- Rate limit (per-key, configurable via `RATE_LIMIT_WINDOW_MS` / `RATE_LIMIT_MAX_PER_WINDOW`) returns `429` with `Retry-After` — protects valuation/recommendation endpoints from accidental DoS during a buggy draft loop
- Integration test asserts: missing key → `401`, valid key → `200`, rate-limit overflow → `429`
- `/health` is exempt from the key requirement (so an uptime checker can hit it)

** COMPLETED** (`src/middleware/license.js` validates X-API-Key / Bearer; `src/middleware/rateLimit.js` adds an in-memory per-key sliding-window limiter that emits `429 + Retry-After` and `code: RATE_LIMITED`. Both mounted in `src/app.js` after `/health`. README "API key rotation (US-8.5)" section documents issue/rotate/revoke flows + the auth/rate-limit error response table. Integration tests in `tests/api.integration.test.js` cover all three paths: missing-key → 401, valid-key → 200, rate-limit overflow → 429 with Retry-After. Note: existing implementation uses `code: "UNAUTHORIZED"` (HTTP-canonical) rather than `AUTH_INVALID_KEY` per the original spec phrasing — kept as-is for backward compatibility with the Draft Kit's `licensed-player-api.js` error parsing.)

---

## Epic 9: Cleanup & De-emphasis (Milestone 1)

### US-9.1: Remove or relocate demo UI ✅ COMPLETED
**Acceptance criteria:**
- `public/demo.html`, `public/app.jsx`, `public/styles.css` are removed or moved to `/examples`
- The root `/` route returns API info JSON instead of serving HTML
- Static file middleware is removed from production config

** COMPLETED** (`public/` removed entirely; `index.html`, `app.jsx`, `styles.css`, `favicon.ico` relocated to `examples/demo-ui/` via `git mv` so history is preserved. Added `examples/demo-ui/README.md` documenting the move + how to run the demo locally. `src/app.js` no longer imports `path`, dropped `app.use(express.static(...))`, and the root route now returns API info JSON: `{ success, service, name, version, apiVersion, docs, health, endpoints: { players, pool, valuations, recommendations, license, admin } }`. `vercel.json` updated to point `outputDirectory` at `examples/demo-ui` so the hosted demo at `player-data-api.vercel.app` keeps working. README's "Demo UI", "Deployment", and "Project structure" sections updated to reference the new path. **Verified live**: `GET /` returns the JSON shape; `GET /index.html` returns `404 NOT_FOUND` (no static fallback); `GET /api/v1/health` unchanged. **95/95 tests still passing.**)

### US-9.2: Remove usage tracking endpoint (or scope it) ✅ COMPLETED
**Acceptance criteria:**
- If kept: endpoint renamed to `/api/v1/analytics/usage` and events persisted
- If removed: route and controller deleted, README updated

**Implementation:** Kept and scoped. Created `src/routes/analytics.js` mounting:
- `POST /api/v1/analytics/usage` — persists events to `usage_events` table (graceful fallback if table not yet migrated)
- `GET /api/v1/analytics/sync-status` — data freshness status (moved from `/usage/sync-status`)
Legacy `/usage` unversioned route removed. OpenAPI spec updated. 95/95 tests pass.

### US-9.3: Update README for new product vision ✅ COMPLETED
**Acceptance criteria:**
- README states: this is the Player Data API for a fantasy baseball auction draft assistant
- Documents the relationship to the Draft Kit repo
- Lists current endpoints with updated schemas
- Describes the data ingestion and refresh strategy
- Removes references to features that don't exist

**Implementation:** Full README rewrite — product intro names DraftIQ and the Draft Kit relationship; endpoint table standardized to `/api/v1/` canonical paths; analytics endpoints added; ingestion strategy section added with scheduler staleness thresholds; stale "cookie-based auth (planned)" removed; `ADMIN_KEY` corrected to `ADMIN_API_KEY`; project structure updated with `analytics` route and `rateLimit.js` middleware; "Connecting" section updated to reference `/api/v1/analytics/usage`.

---

## Epic 10: Developer Account & API Key Management UI (Rubric: Player API Licensing)

> **Rubric mapping:** "Front-End UI for Developer to Create/Manage Account" (2pt), "Front-End UI for Key Generation" (2pt), "Account Tied to Key Generation & Use" (2pt), "IP Address Whitelisting" (2pt) — 8pt total. (Throttling is already done by US-8.5; "License used properly by Draft Kit Server" is satisfied by Draft Kit US-11.4/11.5/11.8.)

> The current `requireLicense` middleware accepts a flat `API_LICENSE_KEY` / `VALID_API_KEYS` env var. This epic moves issuance and revocation behind a real account model with a developer-facing UI, so the rubric's "complete mediation" line item is satisfied.

### US-10.1: Developer account model + auth ✅ COMPLETED
**As a** Player Data API operator, **I want** a `DeveloperAccount` table with email, hashed password, and a relation to issued API keys, **so that** every key in circulation is traceable to a known account.

**Acceptance criteria:**
- New `developer_accounts` table — `id`, `email` (unique), `password_hash`, `is_admin`, `created_at`
- New `api_keys` table — `id`, `account_id` (FK), `key_hash` (we never store the raw key), `label`, `ip_whitelist` (JSON array of CIDR or `*`), `revoked_at`, `last_used_at`, `created_at`
- Migration script + seed for a single bootstrap admin developer (configurable via env)
- Existing `requireLicense` keeps working: hashed-key lookup against `api_keys` where `revoked_at IS NULL` and `now()` < expiry, attaches `req.developerAccount` for downstream audit
- Backwards compatible: legacy `API_LICENSE_KEY` env still works as a "system key" until removed in a follow-up

**Implementation:** `src/db/migrate.js` adds `developer_accounts` + `api_keys` tables. `src/db/developerAccounts.js` provides `createAccount`, `createKey`, `findKeyByRaw`, `touchKey`, `hashPassword`, `verifyPassword`. `src/db/seedAdmin.js` seeds a bootstrap admin on first start (configurable via `ADMIN_EMAIL`/`ADMIN_PASSWORD` env; logs the raw key once). `src/middleware/license.js` updated — DB key lookup first (SHA-256 hash match, attaches `req.developerAccount`), legacy env fallback second. 95/95 tests pass.

### US-10.2: Front-end UI for developer account create/login ✅ COMPLETED
**As a** developer wanting access, **I want** a hosted page (`/developer-portal`) where I can create an account and sign in, **so that** the API doesn't depend on an out-of-band onboarding email.

**Acceptance criteria:**
- New routes: `POST /api/v1/developer/register`, `POST /api/v1/developer/login`, `GET /api/v1/developer/me`, `POST /api/v1/developer/logout`
- Cookie-based session (separate from the `X-API-Key` data plane)
- Static UI served at `/developer-portal/*` — register, login, profile, "My Keys" pages
- Password validation: minimum length, distinct hashing rounds documented in code
- Integration tests: register → login → profile → logout

**Implementation:** Stateless signed-cookie session via `src/middleware/session.js` (HMAC-SHA256, no external dep). `src/controllers/developerController.js` + `src/routes/developer.js` implement register/login/me/logout. Password min-length 8 enforced; scrypt hashing (64-byte, salted). Static UI at `public/developer-portal/index.html` (register, sign-in, and "My Keys" dashboard tabs). `tests/developer.test.js` covers all 12 register → login → /me → logout scenarios. 107/107 tests pass.

### US-10.3: Front-end UI for API key generation ✅ COMPLETED
**As a** signed-in developer, **I want** a "Create new key" button on my dashboard that returns the raw key once (and never again), **so that** I have a self-service path to spin up a new credential.

**Acceptance criteria:**
- New endpoint `POST /api/v1/developer/keys` accepts `{ label, ipWhitelist? }` and returns `{ key: <raw value>, id, label }` exactly once
- The raw key is never persisted; only a hash is stored
- UI surfaces the raw key in a copy-to-clipboard banner with a "I've saved this — won't be shown again" confirm gate
- Listing endpoint `GET /api/v1/developer/keys` returns `{ id, label, ipWhitelist, lastUsedAt, createdAt }` (no key value)
- Revocation endpoint `DELETE /api/v1/developer/keys/:id` sets `revoked_at = now()`; subsequent requests with that key fail `401 KEY_REVOKED`

**Implementation:** `developerAccounts.js` gains `listKeys(accountId)` and `revokeKeyById(keyId, accountId)`. `findKeyByRaw` now returns `{ status: 'valid'|'revoked'|'not_found' }` so `requireLicense` can emit `KEY_REVOKED` vs `UNAUTHORIZED`. Controller functions `issueKey`, `getKeys`, `deleteKey` added; routes mounted under `/api/v1/developer/keys`. UI from US-10.2 already had the copy-to-clipboard raw key banner. `tests/developer.test.js` extended with 10 new key management tests (create → list → use → revoke → revoked-401 flow). 117/117 tests pass.

### US-10.4: Audit trail tying every key use back to its account ✅ COMPLETED
**As a** Player Data API operator, **I want** every authenticated request logged with the issuing account + key, **so that** when a key is abused I can trace the blast radius.

**Acceptance criteria:**
- `requireLicense` updates `api_keys.last_used_at` on success
- New `api_key_usage_log` table (rolling 30-day TTL) — `id`, `key_id`, `account_id`, `path`, `method`, `status`, `ip`, `at`
- Admin endpoint `GET /api/v1/admin/keys/:keyId/usage` returns the recent usage rows
- Logger entries (US-8.2) include `accountId` and `keyId` (last 4 chars only) for cross-referencing
- `tests/api.integration.test.js` asserts `last_used_at` is bumped after a successful authed call

**Implementation:** `src/db/migrate.js` adds `api_key_usage_log` table. `src/db/auditLog.js` provides `logKeyUse` (writes row + prunes rows > 30 days) and `getKeyUsage`. `requireLicense` schedules a `res.on('finish', ...)` hook after DB-key auth — emits structured log with `accountId`/`keyId` (row id, not raw key) and writes to `api_key_usage_log`. Admin route `GET /api/v1/admin/keys/:keyId/usage` added; OpenAPI spec updated. `api.integration.test.js` gains `last_used_at` bump assertion. 118/118 tests pass.

### US-10.5: IP address whitelisting per key ✅ COMPLETED
**As a** developer, **I want** to scope each key to one or more IP addresses or CIDR blocks, **so that** a leaked key from a server with a fixed IP can't be used elsewhere.

**Acceptance criteria:**
- `api_keys.ip_whitelist` accepts `null` (no restriction), `["1.2.3.4"]`, or `["10.0.0.0/24", "203.0.113.5"]`
- `requireLicense` resolves the request IP via `X-Forwarded-For` (when `TRUST_PROXY=true`) or `req.socket.remoteAddress`; rejects with `401 IP_NOT_ALLOWED` when whitelist is non-empty and no entry matches
- UI: the key list shows the whitelist; "Edit" opens a dialog to update it
- README documents the trust-proxy expectation for hosted deploys (Render, Vercel rewrites, etc.)
- Integration tests cover (a) no whitelist → all IPs pass, (b) whitelist mismatch → `401 IP_NOT_ALLOWED`, (c) CIDR match → pass

**Implementation:** `src/utils/ipMatch.js` — pure-Node IPv4 exact-match + CIDR matching (no deps). `requireLicense` parses `ip_whitelist` after finding a valid key; mismatched IP → `401 IP_NOT_ALLOWED` before `touchKey`. `updateKeyWhitelist(keyId, accountId, ipWhitelist)` added to `developerAccounts.js`. `PATCH /api/v1/developer/keys/:id` endpoint added (session-gated, ownership-scoped). Developer portal UI shows whitelist per key with an inline "Edit" link that opens a prompt dialog. README documents `TRUST_PROXY=true` requirement for Render/proxy deploys. 6 new tests cover all three AC scenarios plus clear-whitelist and wrong-account cases. 124/124 tests pass.

---

## Epic 11: Valuation Engine — Predictive & Contextual Inputs (Rubric: Player API Valuations)

> **Rubric mapping:** "Custom 1 or 3 year stats used" (1pt), "Predictive stats used" (1pt), "Age Used" (1pt), "Injury Status Used" (1pt), "Depth Chart Position Used" (1pt) — 5pt total. ("Scarcity Used" is US-5.2; "Test Cases 1-5 Variation" is `tests/valuationEngine.test.js`; "New Values requested/presented after every edit" is satisfied by Draft Kit US-13.1.)

### US-11.1: Multi-year stats option (1-year vs 3-year averaging) ✅ COMPLETED
**As a** Draft Kit user setting up valuations, **I want** to choose between last-season-only stats or a 3-year weighted average, **so that** valuations match my league's preference for recency vs. stability.

**Acceptance criteria:**
- `leagueSettings.statsWindow` field — enum: `'last1' | 'last3'` (default `'last1'`)
- When `last3`: `loadStatRows` queries the 3 most recent completed seasons and computes a weighted average (`50% / 30% / 20%` for years 1/2/3); rate stats (AVG/OBP/SLG/ERA/WHIP) weighted by AB or IP rather than year
- `valuationEngine.normalizeLeagueSettings` accepts the field and threads it through; backwards compatible (default behavior unchanged when unset)
- Unit test: same player produces materially different `projectedValue` when toggling `last1` ↔ `last3` for someone with a hot/cold prior year

**Implementation:** Added `statsWindow: 'last1'` to `DEFAULTS`. `mergeSettings` threads `statsWindow` through (validates to `'last3'` or default `'last1'`). New `loadWeightedStatRows(group, weights)` queries the N most recent seasons in one SQL call, groups by `player_id`, applies year weights `[0.5, 0.3, 0.2]` to counting stats and volume-weighted averaging (AB or IP) to rate stats. New `loadStatRowsForSettings(settings, season, group)` dispatcher replaces the three direct `loadStatRows` call-sites in `runValuations`, `getExclusionDiagnostics`, and `computeRecommendations`. `meta.statsWindow` included in valuation response. 5 new unit tests cover: default value, threading, invalid value fallback, graceful empty-array on no-DB, and direct weighting math verification. 130/130 tests pass.

### US-11.2: Predictive (projected) stats input ✅ COMPLETED
**As a** Draft Kit user, **I want** the engine to use forward-looking projected stats (Steamer / ZiPS / community) when available, instead of last year's raw stats, **so that** valuations reflect an expectation, not a memory.

**Acceptance criteria:**
- New `player_projections` table — `(player_id, season, source)` PK + the same column set as `player_stats`
- New CLI script `scripts/import-projections.js` accepts a CSV path and a `--source` flag; expected sources: `steamer`, `zips`, `manual`
- `valuationEngine` prefers `player_projections` rows for the upcoming season when present; falls back to `player_stats` when no projection exists
- New env var `VALUATION_PROJECTION_SOURCE` (default `steamer`) selects the active source
- Response `meta` reports `usedProjectionSource` so the Draft Kit can show "Powered by Steamer projections"

**Implementation:** `src/db/migrate.js` adds `player_projections` table (same columns as `player_stats` + `source` column; `UNIQUE(player_id, season, stat_group, source)`). `scripts/import-projections.js` — new CLI script: parses CSV with case-insensitive alias-aware column lookup, classifies hitters vs pitchers by IP, resolves player IDs from `players` table by MLB person ID then name fallback, upserts into `player_projections`. Added `"import-projections"` npm script. `loadProjectionRows(season, group, source)` queries `player_projections` joined to `players`. `loadStatRowsForSettings` updated to check projections first (upcoming season, `VALUATION_PROJECTION_SOURCE`), fall back to historical stats; now returns `{ rows, usedProjectionSource }`. All three call-sites (`runValuations`, `getExclusionDiagnostics`, `computeRecommendations`) updated. `meta.usedProjectionSource` added to valuation response. 5 new unit tests. 135/135 tests pass.

### US-11.3: Age factor in valuation ✅ COMPLETED
**As a** Draft Kit user in a dynasty league, **I want** age folded into valuations (a 30-year-old's $40 is worth less than a 22-year-old's $40 over a 3-year contract), **so that** my long-term roster strategy is reflected in the auction price.

**Acceptance criteria:**
- `players.birth_date` ingested via the MLB Stats API roster hydration (already available in the `person` payload — extend US-4.1 ingestion)
- `valuationEngine` computes `ageAtSeasonStart` and applies a multiplier curve: `1.0` for ages 24–28, fading to `0.85` by age 35 and `1.05` for age ≤ 22
- Multiplier shape configurable via `VALUATION_AGE_CURVE` env var (JSON map) for league-by-league tuning
- Disabled by default in single-year leagues (controlled by `leagueSettings.ageFactor: boolean`, default `false`)
- Test: identical projections with ages 24 vs 36 produce differing `projectedValue` when `ageFactor: true`

**Implementation:** `birth_date TEXT` column added to `players` table via idempotent `ALTER TABLE`. `ingestPlayerMetadata.js` populates `birth_date` from `person.birthDate`; upsert uses `COALESCE(excluded.birth_date, players.birth_date)` so existing values are preserved when the API returns null. All three stat-loading queries (`loadStatRows`, `loadWeightedStatRows`, `loadProjectionRows`) now select `p.birth_date`. Engine: `ageFactor: false` in DEFAULTS; `ageCurve` anchor map; `parseAgeCurve` reads `VALUATION_AGE_CURVE` env or `leagueSettings.ageCurve`; `computeAgeMultiplier(birthDate, season, curve)` computes age at April 1 of the season and linearly interpolates between anchor points; `combinedMult = availMult * ageMult` applied to all projected counting stats; `ageAdjustment: { age, multiplier }` included per player in output. 6 new unit tests. 141/141 tests pass.

### US-11.4: Injury status in valuation
**As a** Draft Kit user, **I want** the `IL-60` / `IL-10` / `DTD` flags ingested by Epic 4 to discount valuations proportionally, **so that** a season-ending IL stay isn't priced as if the player is healthy.

**Acceptance criteria:**
- Discount table: `IL-10 → 0.95`, `IL-15 → 0.93`, `IL-60 → 0.6`, `DTD → 0.97`, `minors → 0.0`, `DFA → 0.0` (configurable via env)
- `valuationEngine` multiplies `projectedValue` by the discount when the player's current `status` is non-active
- Response includes `injuryAdjustment: { status, multiplier }` per player so the Draft Kit can render "−40% (IL-60)" tooltips
- Test: identical projections — one `active`, one `IL-60` — produce values in the documented ratio

### US-11.5: Depth chart position factor in valuation
**As a** Draft Kit user, **I want** depth-chart rank (already ingested by US-4.3) factored into valuation, **so that** a 4th-string SP isn't valued at the same level as a #1 SP with the same career ERA sample.

**Acceptance criteria:**
- Multiplier per `depthChartRank`: `1 → 1.0`, `2 → 0.9`, `3 → 0.7`, `4+ → 0.4`, `null → 0.5` (uncharted = unknown)
- Engine output includes `depthChartAdjustment: { rank, multiplier }` per player
- Configurable via env `VALUATION_DEPTH_CURVE`; opt-out via `leagueSettings.depthChartFactor: boolean` (default `true`)
- Test: same player evaluated with rank 1 vs rank 4 produces values in the documented ratio

---

## Epic 12: ~~RESERVED~~

> Epic 12 is intentionally skipped to leave room for `legacy/cleanup` work that may surface during the rubric pass. Keep numbering aligned with the cross-repo references in Epic 11 (Draft Kit) and downstream docs.

---

## Epic 13: Push Notifications from Player Data API (Rubric: Push Notification)

> **Rubric mapping:** "Mechanism to Force New Notification-worthy info via Player API" (5pt) — the Player Data API's half of the 10pt push category. (The Draft Kit's half — show pushed state + notification UI — is its Epic 25.)

### US-13.1: Notification-worthy event detection
**As a** Player Data API maintainer, **I want** the ingestion jobs to flag every "newsworthy" change (status flip, depth-chart move, transaction) onto an event stream, **so that** subscribed Draft Kits can react.

**Acceptance criteria:**
- New `events` table — `id`, `type` (`player.injury` | `player.transaction` | `player.depthChart`), `playerId`, `payload` (JSON), `createdAt`, `dispatchedAt`
- `ingestInjuries`, `ingestDepthCharts`, `ingestTransactions` insert an `events` row for every diff vs prior state (no rows on no-op runs)
- Per-event payload includes the new value, prior value, and `dataAsOf`
- Backfill safeguard: events older than 24h on first deploy are NOT replayed (avoid notification storm)

### US-13.2: Push delivery channel (Server-Sent Events + webhook)
**As a** Draft Kit, **I want** to subscribe to a stream of events scoped to my session's available player pool, **so that** my UI updates without polling.

**Acceptance criteria:**
- New endpoint `GET /api/v1/events/stream?playerIds=mlb-1,mlb-2,…` — Server-Sent Events; auth via `X-API-Key`
- Each `events` row matching the requested `playerIds` is dispatched as `event: <type>\ndata: <json>` to subscribers; `dispatchedAt` set when sent
- Heartbeat ping every 25 seconds keeps proxies from killing the connection
- Optional webhook mode: developer accounts (Epic 10) can register a `webhookUrl`; events POST to it with HMAC signature
- Reconnection support: client passes `?since=<lastEventId>` to resume

### US-13.3: Force-trigger admin endpoint (manual notification injection)
**As a** Player Data API operator demoing the system, **I want** to inject a synthetic notification on demand, **so that** the rubric demo doesn't depend on the MLB Stats API actually publishing news during the grading window.

**Acceptance criteria:**
- New endpoint `POST /api/v1/admin/events` accepts `{ type, playerId, payload }` and writes an `events` row
- Admin auth (US-8.5 / `requireAdmin`) gates the endpoint
- Synthetic events flow through the same delivery channel as real ones — Draft Kits can't tell the difference
- README documents the demo recipe: "to demonstrate the push system, POST `{ type: 'player.injury', playerId: 'mlb-660271', payload: { status: 'IL-60', reason: 'Demo' } }`"

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

## Cross-Repo Contract Quick Reference

These are the shapes both repos must agree on. They are defined by US-5.3, US-5.4, and US-5.5; reproduced here for quick lookup.

```ts
// Request body for /players/valuations, /players/recommendations, /players/recommendations/nominations
{
  leagueSettings: {
    numberOfTeams: number,
    salaryCap: number,
    rosterSlots: { [position: string]: number },  // e.g. { C:2, "1B":1, ..., BENCH:4 }
    scoringType: "5x5 Roto" | "H2H Categories" | "Points",
    draftType: "AUCTION"
  },
  draftState: {
    availablePlayerIds: string[],                  // "mlb-..."
    purchasedPlayers: Array<{ playerId, teamId, price, positionFilled? }>,
    teamBudgets: Record<string, number>,           // teamId -> remaining $
    filledRosterSlots: Record<string, Record<string, number>>
                                                   // teamId -> position -> count
  },
  teamId?: string                                  // "fantasy-team-3" (required for US-6.2, 6.3, 6.4)
}
```

---

## Story Count Summary

| Priority | Stories | Milestone |
|----------|---------|-----------|
| Must do now | 1.1–1.5, 2.1–2.3, 2.6–2.7, 9.1–9.3 | 1 |
| Next | 2.4–2.5, 3.1–3.4, 7.1–7.2, 7.4, 8.1 | 2–3 |
| Integration cleanup | 2.8, 2.9, 8.5 | 3 |
| Then | 4.1–4.8, 8.2, 8.4 | 4 |
| Later | 5.1–5.5, 6.1–6.4, 7.3, 7.5, 8.3 | 5 |
| **Rubric parity (added from project rubric)** | | |
| Developer Account & API Key UI (Licensing) | 10.1–10.5 | 6 |
| Valuation predictive & contextual inputs (Valuations) | 11.1–11.5 | 6 |
| Push notifications channel | 13.1–13.3 | 6 |
| **Total** | **61 stories** | |
