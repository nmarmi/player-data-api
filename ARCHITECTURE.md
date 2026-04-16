# Player Data API Architecture

```mermaid
flowchart TB
  subgraph Clients
    DK["Draft Kit Client"]
    DEMO["Browser Demo UI<br/>(/public)"]
  end

  subgraph Deployment["Runtime (Node.js / Express)"]
    ENTRY["Entry Point<br/>src/index.js<br/>api/index.js (Vercel)"]
    APP["Express App<br/>src/app.js"]
    ROUTES["Routes<br/>src/routes/*"]
    LIC["License Middleware<br/>src/middleware/license.js"]
    CTRL["Controllers<br/>src/controllers/*"]
    SVC["Player Service<br/>src/services/playersService.js"]
  end

  subgraph Data["Data Layer"]
    JSON["data/players.json<br/>(preferred)"]
    FALLBACK["data/players.js<br/>(fallback)"]
    ENV["Environment Variables<br/>API_LICENSE_KEY / VALID_API_KEYS<br/>ALLOWED_ORIGIN / PORT"]
  end

  DK -->|"GET /players, /players/filters<br/>POST /usage<br/>GET /license/check"| ENTRY
  DEMO -->|"same API calls (single port)"| ENTRY

  ENTRY --> APP --> ROUTES
  ROUTES -->|"licensed endpoints"| LIC --> CTRL
  ROUTES -->|"GET /health"| CTRL

  CTRL -->|"list/filter/sort/paginate players"| SVC
  SVC --> JSON
  SVC -.->|"if JSON missing or invalid"| FALLBACK

  LIC --> ENV
  APP --> ENV
```

## Request path summary

- `/health`: Route -> Controller -> response
- `/license/check`: Route -> License Middleware -> Controller -> response
- `/players`, `/players/filters`: Route -> License Middleware -> Controller -> Player Service -> JSON/fallback data -> response
- `/usage`: Route -> License Middleware -> Controller -> log usage payload -> response
