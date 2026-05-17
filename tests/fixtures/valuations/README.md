# Valuation Test Fixtures

These fixtures are for common grading checkpoints:

1. `pre_draft.json` - before draft starts
2. `after_10.json` - after first 10 drafted players
3. `after_50.json` - after first 50 drafted players
4. `after_100.json` - after first 100 drafted players
5. `after_130.json` - after first 130 drafted players

## How to build from your spreadsheet

- Use the `Draft` worksheet as your ordered source of drafted players.
- Convert each drafted row into:

```json
{ "playerId": "mlb-<id>", "price": <number>, "teamId": "fantasy-team-<n>" }
```

- In each file:
  - `pre_draft.json`: `purchasedPlayers` must be `[]`
  - `after_10.json`: include first 10 entries from Draft sheet
  - `after_50.json`: include first 50 entries
  - `after_100.json`: include first 100 entries
  - `after_130.json`: include first 130 entries

## Team budgets

If your Draft Kit computes budgets itself, `teamBudgets` may be omitted or left empty.
If your integration requires it, set each team budget to:

`salaryCap - sum(prices of players purchased by that team so far)`

## Validation command examples

```bash
curl -sS -H "X-API-Key: obsidianDraftIQ-416" \
  -H "Content-Type: application/json" \
  -X POST "http://localhost:4001/api/v1/players/valuations" \
  -d @tests/fixtures/valuations/pre_draft.json \
  | jq '{success, count:(.valuations|length), meta}'
```

```bash
curl -sS -H "X-API-Key: obsidianDraftIQ-416" \
  -H "Content-Type: application/json" \
  -X POST "http://localhost:4001/api/v1/players/valuations" \
  -d @tests/fixtures/valuations/after_130.json \
  | jq '{success, count:(.valuations|length), meta}'
```
