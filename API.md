# Player Data API — Request Reference

## Authentication

All endpoints except `/health` require an API key passed in one of two ways:

```
X-API-Key: your-key-here
```
or
```
Authorization: Bearer your-key-here
```

Admin endpoints additionally accept `X-Admin-Key: your-admin-key`.

All responses include `"apiVersion": "v1"` in the body.

---

## Auth — TODO

> These endpoints are not yet implemented. They support user account creation, login, and API key self-management.

### `POST /api/v1/auth/register` — TODO
Create a new user account.

```json
// Request body
{ "email": "user@example.com", "password": "..." }
```

```json
// Response
{ "success": true, "message": "Account created" }
```

---

### `POST /api/v1/auth/login` — TODO
Authenticate and set a signed JWT in an `HttpOnly` cookie.

```json
// Request body
{ "email": "user@example.com", "password": "..." }
```

```json
// Response — sets cookie: auth_token=<jwt>; HttpOnly; SameSite=Strict
{ "success": true }
```

---

### `POST /api/v1/auth/logout` — TODO
Clears the JWT cookie.

```json
// Response — clears cookie: auth_token
{ "success": true, "message": "Logged out" }
```

---

## API Keys — TODO

> These endpoints are not yet implemented. They allow authenticated users to generate and manage their API keys. All require a valid `auth_token` JWT cookie.

### `POST /api/v1/keys` — TODO
Generate a new API key.

```json
// Response
{ "success": true, "key": { "keyId": "key_abc123", "name": "My Draft App", "secret": "sk_...", "createdAt": "2026-04-24T00:00:00Z" } }
```

> The `secret` is only returned once at creation time. Store it immediately.

---

### `GET /api/v1/keys` — TODO
List all API keys for the authenticated user. Secret values are not returned.

```json
// Response
{
  "success": true,
  "keys": [
    { "keyId": "key_abc123", "name": "My Draft App", "createdAt": "2026-04-24T00:00:00Z" }
  ]
}
```

---

### `DELETE /api/v1/keys/:keyId` — TODO
Revoke an API key. Any application using this key will immediately lose access.

```json
// Response
{ "success": true, "message": "Key revoked" }
```

---

## Health

### `GET /api/v1/health`
No auth required. Use this to confirm the service is running.

```json
// Response
{ "success": true, "status": "ok", "service": "player-data-api" }
```

---

## License

### `GET /api/v1/license/check`
Validates that your API key is accepted.

```json
// Response
{ "success": true, "message": "License valid" }
```

---

## Players

### `GET /api/v1/players`
List players with optional filtering, sorting, and pagination.

| Query Param | Type | Default | Description |
|---|---|---|---|
| `search` | string | — | Filter by name, team, position, or player ID |
| `position` | string | — | e.g. `OF`, `SP`, `1B` — comma-separated for multiple |
| `team` | string | — | e.g. `NYY`, `LAD` |
| `sortBy` | string | `fpts` | Any stat field or `name`, `playerName`, `mlbTeam` |
| `sortOrder` | string | `desc` | `asc` or `desc` |
| `limit` | number | `50` | Max `200` |
| `offset` | number | `0` | For pagination |
| `minHr`, `maxHr`, etc. | number | — | Range filters for any numeric stat field |

```json
// Response
{
  "success": true,
  "players": [
    {
      "playerId": "mlb-123",
      "name": "Mike Trout",
      "positions": ["OF"],
      "mlbTeam": "LAA",
      "fpts": 42.5,
      "hr": 30,
      "avg": 0.285
    }
  ],
  "total": 450,
  "limit": 50,
  "offset": 0,
  "sort": { "by": "fpts", "order": "desc" },
  "filters": { "search": null, "teams": [], "positions": [], "ranges": {} }
}
```

---

### `GET /api/v1/players/filters`
Returns all valid values for filter dropdowns.

```json
// Response
{
  "success": true,
  "filters": {
    "teams": ["ARI", "ATL", "BAL", "BOS", "..."],
    "positions": ["1B", "2B", "C", "OF", "P", "SP", "SS", "..."],
    "sortFields": ["name", "hr", "avg", "era", "fpts", "..."]
  }
}
```

---

### `GET /api/v1/players/pool`
Returns the full player pool in one shot. Used by the draft kit to seed the draft session.

| Query Param | Type | Description |
|---|---|---|
| `position` | string | Filter by position — comma-separated for multiple |

```json
// Response
{
  "success": true,
  "players": [
    { "playerId": "mlb-123", "name": "Mike Trout", "positions": ["OF"], "mlbTeam": "LAA" }
  ]
}
```

---

### `GET /api/v1/players/:playerId`
Returns a single player by their player ID.

```json
// Response
{
  "success": true,
  "player": { "playerId": "mlb-123", "name": "Mike Trout", "positions": ["OF"], "mlbTeam": "LAA", "..." }
}
```

---

### `POST /api/v1/players/valuations`
Runs the z-score above replacement algorithm and returns auction dollar values for all players. All body fields are optional — omit to use defaults.

```json
// Request body
{
  "leagueSettings": {
    "numTeams": 10,
    "budget": 260,
    "hitterBudgetPct": 0.675,
    "hitterSlotsPerTeam": 9,
    "pitcherSlotsPerTeam": 5,
    "minAB": 100,
    "minIP": 40,
    "statSeason": 2024
  },
  "draftState": {
    "availablePlayerIds": ["mlb-123", "mlb-456"]
  }
}
```

> Omit `draftState.availablePlayerIds` to value the full player pool. Pass it during a live draft to re-value only the players still available.

```json
// Response
{
  "success": true,
  "valuations": [
    {
      "playerId": "mlb-123",
      "name": "Mike Trout",
      "dollarValue": 42,
      "projectedValue": 42,
      "rank": 1,
      "zScore": 3.12,
      "zScores": { "hr": 1.2, "r": 0.9, "rbi": 0.8, "sb": 0.4, "avg": 0.7 },
      "statGroup": "hitting"
    }
  ],
  "meta": {
    "season": 2024,
    "numTeams": 10,
    "budget": 260,
    "hitterSlots": 90,
    "pitcherSlots": 50,
    "hitterCount": 90,
    "pitcherCount": 50,
    "totalValue": 2600,
    "targetTotalValue": 2600
  }
}
```

---

### `POST /api/v1/players/recommendations`
Compares projected dollar values against current market prices at auction and returns players worth bidding on — sorted by value surplus.

```json
// Request body
{
  "leagueSettings": {
    "budget": 260,
    "rosterSlots": 23
  },
  "draftState": {
    "availablePlayerIds": ["mlb-123", "mlb-456"],
    "marketPrices": {
      "mlb-123": 30,
      "mlb-456": 5
    }
  },
  "teamId": "fantasy-team-1"
}
```

> `marketPrices` maps a `playerId` to what that player is currently going for at auction. Players with no entry default to `$1`.

```json
// Response
{
  "success": true,
  "teamId": "fantasy-team-1",
  "recommendations": [
    {
      "playerId": "mlb-456",
      "recommendedBid": 18,
      "reason": "Valued at $18 vs market $5 (+$13 surplus)"
    }
  ]
}
```

---

## Usage

### `POST /api/v1/usage`
Log a usage event for tracking purposes.

```json
// Request body
{
  "event": "draft_started",
  "timestamp": "2026-04-17T00:00:00Z",
  "metadata": {}
}
```

```json
// Response
{ "success": true, "message": "Recorded" }
```

---

### `GET /api/v1/usage/sync-status`
Returns the last time each data source was synced from the MLB Stats API.

```json
// Response
{
  "success": true,
  "syncStatus": {
    "player_metadata": "2026-04-16T08:00:00Z",
    "injuries": "2026-04-16T08:05:00Z",
    "depth_charts": "2026-04-16T08:10:00Z",
    "transactions": "2026-04-16T08:15:00Z",
    "player_stats": "2026-04-16T08:20:00Z"
  }
}
```

---

## Admin

### `POST /admin/refresh`
Manually triggers a data re-ingestion from the MLB Stats API. Requires `X-Admin-Key` header.

Omit `source` to run all ingestion jobs. Pass a single string or an array to run specific jobs.

| Valid `source` values |
|---|
| `player_metadata` |
| `injuries` |
| `depth_charts` |
| `transactions` |
| `player_stats` |

```json
// Request body — run a single source
{ "source": "injuries" }

// Request body — run multiple sources
{ "source": ["injuries", "transactions", "player_stats"] }

// Request body — run all sources (omit source field)
{}
```

```json
// Response (200 all succeeded, 207 partial failure)
{
  "success": true,
  "sources": [
    { "source": "injuries", "success": true, "recordsUpdated": 47, "durationMs": 820 },
    { "source": "player_stats", "success": true, "recordsUpdated": 1200, "durationMs": 3100 }
  ]
}
```

---

## Error Responses

All error responses follow this shape:

```json
{ "success": false, "error": "Human-readable message", "code": "MACHINE_READABLE_CODE" }
```

| HTTP Status | Code | Meaning |
|---|---|---|
| `400` | `BAD_REQUEST` | Invalid request body or query params |
| `401` | `UNAUTHORIZED` | Missing or invalid API key |
| `404` | `NOT_FOUND` | Resource does not exist |
| `500` | `INTERNAL_ERROR` | Unhandled server error |
| `503` | `SERVICE_UNAVAILABLE` | Sync log or upstream dependency unavailable |
