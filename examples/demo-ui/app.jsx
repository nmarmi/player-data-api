const { useEffect, useMemo, useRef, useState } = React;

const DEFAULT_FORM = {
  search: "",
  team: "",
  position: "",
  sortBy: "fpts",
  sortOrder: "desc",
  limit: "25",
  offset: "0",
  minFpts: "",
  maxFpts: "",
  minHr: "",
  maxHr: "",
  minRbi: "",
  maxRbi: "",
  minAvg: "",
  maxAvg: "",
};

const QUERY_FIELDS = [
  "search","team","position","sortBy","sortOrder","limit","offset",
  "minFpts","maxFpts","minHr","maxHr","minRbi","maxRbi","minAvg","maxAvg",
];

function request(path, { method = "GET", apiKey = "", body } = {}) {
  const headers = { "Content-Type": "application/json" };
  if (apiKey) headers["X-API-Key"] = apiKey;
  return fetch(path, { method, headers, ...(body ? { body: JSON.stringify(body) } : {}) });
}

async function readJson(response) {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.error || response.statusText || "Request failed");
    error.data = data;
    throw error;
  }
  return data;
}

function JsonOutput({ value, isError }) {
  if (!value) return null;
  return (
    <pre className={`out ${isError ? "error" : "success"}`} aria-live="polite">
      {JSON.stringify(value, null, 2)}
    </pre>
  );
}

function buildFilterSummary(filters) {
  if (!filters) return "none";
  const parts = [];
  if (filters.search) parts.push(`search=${filters.search}`);
  if (Array.isArray(filters.teams) && filters.teams.length) parts.push(`team=${filters.teams.join(",")}`);
  if (Array.isArray(filters.positions) && filters.positions.length) parts.push(`position=${filters.positions.join(",")}`);
  if (filters.ranges && typeof filters.ranges === "object") {
    Object.entries(filters.ranges).forEach(([field, range]) => parts.push(`${field}:[${range.min ?? "-"}..${range.max ?? "-"}]`));
  }
  return parts.length ? parts.join(" | ") : "none";
}

// ── Valuations helpers ────────────────────────────────────────────────────────

function dollarTier(val) {
  if (val >= 40) return "tier-premium";
  if (val >= 20) return "tier-high";
  if (val >= 10) return "tier-mid";
  return "tier-low";
}

function topCategoryBadges(zScores, statGroup) {
  if (!zScores) return null;
  const entries = Object.entries(zScores).sort((a, b) => b[1] - a[1]);
  const top = entries.slice(0, 3);
  return (
    <span className="cat-badges">
      {top.map(([cat, z]) => (
        <span
          key={cat}
          className={`cat-badge ${z >= 1.5 ? "cat-pos-strong" : z >= 0 ? "cat-pos" : "cat-neg"}`}
        >
          {cat.toUpperCase()} {z > 0 ? "+" : ""}{z.toFixed(1)}
        </span>
      ))}
    </span>
  );
}

function ValuationsSection({ apiKey }) {
  const [numTeams, setNumTeams] = useState("10");
  const [budget,   setBudget]   = useState("260");
  const [group,    setGroup]    = useState("all");
  const [loading,  setLoading]  = useState(false);
  const [result,   setResult]   = useState(null);
  const [error,    setError]    = useState(null);
  const [showAll,  setShowAll]  = useState(false);

  async function runValuations() {
    if (!apiKey.trim()) {
      setError("Enter your API key first.");
      return;
    }
    setLoading(true);
    setError(null);
    setResult(null);
    setShowAll(false);
    try {
      const data = await readJson(
        await request("/api/v1/players/valuations", {
          method: "POST",
          apiKey: apiKey.trim(),
          body: {
            leagueSettings: {
              numTeams: Number(numTeams) || 10,
              budget:   Number(budget)   || 260,
            },
            draftState: {},
          },
        })
      );
      setResult(data);
    } catch (err) {
      setError(err.message || "Request failed");
    } finally {
      setLoading(false);
    }
  }

  const filtered = useMemo(() => {
    if (!result?.valuations) return [];
    if (group === "all") return result.valuations;
    return result.valuations.filter((v) => v.statGroup === group);
  }, [result, group]);

  const displayed = showAll ? filtered : filtered.slice(0, 50);
  const meta = result?.meta;

  return (
    <section className="card">
      <h2>4) Valuations</h2>

      {/* Settings row */}
      <div className="row val-settings">
        <label className="val-label">
          Teams
          <input
            type="number" min="4" max="30" value={numTeams}
            onChange={(e) => setNumTeams(e.target.value)}
            className="val-input-sm"
          />
        </label>
        <label className="val-label">
          Budget&nbsp;($)
          <input
            type="number" min="50" max="999" value={budget}
            onChange={(e) => setBudget(e.target.value)}
            className="val-input-sm"
          />
        </label>
        <button type="button" onClick={runValuations} disabled={loading}>
          {loading ? "Running…" : "Run Valuations"}
        </button>
      </div>

      {error && <p className="val-error">{error}</p>}

      {meta && (
        <div className="val-meta">
          <span>Season: <strong>{meta.season}</strong></span>
          <span>Total: <strong className="accent">${meta.totalValue?.toLocaleString()}</strong></span>
          <span>Target: <strong>${meta.targetTotalValue?.toLocaleString()}</strong></span>
          <span>Hitters: <strong>{meta.hitterCount}</strong></span>
          <span>Pitchers: <strong>{meta.pitcherCount}</strong></span>
        </div>
      )}

      {result && (
        <>
          {/* Group filter tabs */}
          <div className="val-tabs">
            {["all", "hitting", "pitching"].map((g) => (
              <button
                key={g}
                type="button"
                className={`val-tab ${group === g ? "active" : ""}`}
                onClick={() => { setGroup(g); setShowAll(false); }}
              >
                {g === "all" ? `All (${result.valuations.length})` :
                 g === "hitting" ? `Hitters (${result.valuations.filter(v=>v.statGroup==="hitting").length})` :
                 `Pitchers (${result.valuations.filter(v=>v.statGroup==="pitching").length})`}
              </button>
            ))}
          </div>

          {/* Results table */}
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th style={{width:"2.5rem"}}>#</th>
                  <th style={{width:"3.5rem"}}>$</th>
                  <th>Name</th>
                  <th>Team</th>
                  <th>Pos</th>
                  <th style={{width:"2.5rem"}}>Grp</th>
                  <th style={{width:"4rem"}}>z-score</th>
                  <th>Categories</th>
                </tr>
              </thead>
              <tbody>
                {displayed.map((v) => (
                  <tr key={v.playerId + v.statGroup} className={v.dollarValue >= 20 ? "val-row-highlight" : ""}>
                    <td className="muted">{v.rank}</td>
                    <td>
                      <span className={`dollar-badge ${dollarTier(v.dollarValue)}`}>
                        ${v.dollarValue}
                      </span>
                    </td>
                    <td className="player-name">{v.name}</td>
                    <td><span className="team-badge">{v.mlbTeam}</span></td>
                    <td className="muted">{Array.isArray(v.positions) ? v.positions.join("/") : v.positions}</td>
                    <td>
                      <span className={`group-badge ${v.statGroup === "hitting" ? "group-hit" : "group-pit"}`}>
                        {v.statGroup === "hitting" ? "H" : "P"}
                      </span>
                    </td>
                    <td className="muted">{v.zScore}</td>
                    <td>{topCategoryBadges(v.zScores, v.statGroup)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {filtered.length > 50 && (
            <div className="row" style={{marginTop:"0.6rem"}}>
              <button type="button" className="secondary" onClick={() => setShowAll((s) => !s)}>
                {showAll ? `Show top 50` : `Show all ${filtered.length}`}
              </button>
              <span className="muted" style={{fontSize:"0.75rem"}}>
                Showing {displayed.length} of {filtered.length}
              </span>
            </div>
          )}
        </>
      )}
    </section>
  );
}

// ── Main app ──────────────────────────────────────────────────────────────────

function App() {
  const [apiKey, setApiKey]             = useState("");
  const [form, setForm]                 = useState(DEFAULT_FORM);
  const [filterOptions, setFilterOptions] = useState({ teams: [], positions: [], sortFields: [] });
  const [filterStatus, setFilterStatus] = useState("Enter your API key and load filters.");
  const [licenseOutput, setLicenseOutput] = useState({ value: null, isError: false });
  const [pushOutput, setPushOutput]     = useState({ value: null, isError: false });
  const [pullOutput, setPullOutput]     = useState({ value: null, isError: false });
  const [playersResult, setPlayersResult] = useState(null);
  const filterRequestIdRef = useRef(0);

  const sortFields = useMemo(() => {
    if (!filterOptions.sortFields?.length)
      return ["fpts","playerName","team","position","hr","rbi","avg","sb","obp","slg"];
    return filterOptions.sortFields;
  }, [filterOptions.sortFields]);

  async function loadFilters() {
    const key = apiKey.trim();
    if (!key) {
      setFilterOptions({ teams: [], positions: [], sortFields: [] });
      setFilterStatus("Enter your API key and load filters.");
      return;
    }
    const requestId = ++filterRequestIdRef.current;
    setFilterStatus("Loading filters...");
    try {
      const data = await readJson(await request("/api/v1/players/filters", { apiKey: key }));
      if (requestId !== filterRequestIdRef.current) return;
      const filters = data.filters || {};
      setFilterOptions({
        teams:      filters.teams      || [],
        positions:  filters.positions  || [],
        sortFields: filters.sortFields || [],
      });
      setFilterStatus(`Loaded ${filters.teams?.length || 0} teams and ${filters.positions?.length || 0} positions.`);
    } catch (error) {
      if (requestId !== filterRequestIdRef.current) return;
      setFilterOptions({ teams: [], positions: [], sortFields: [] });
      setFilterStatus(error.message);
    }
  }

  useEffect(() => {
    if (!apiKey.trim()) {
      setFilterOptions({ teams: [], positions: [], sortFields: [] });
      setFilterStatus("Enter your API key and load filters.");
      return;
    }
    loadFilters();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiKey]);

  function updateField(event) {
    const { name, value } = event.target;
    setForm((prev) => ({ ...prev, [name]: value }));
  }

  function resetFilters() {
    setForm(DEFAULT_FORM);
    setPlayersResult(null);
    setPullOutput({ value: null, isError: false });
  }

  async function handleCheckLicense() {
    try {
      const data = await readJson(await request("/api/v1/license/check", { apiKey: apiKey.trim() }));
      setLicenseOutput({ value: data, isError: false });
    } catch (error) {
      setLicenseOutput({ value: error.data || { error: error.message }, isError: true });
    }
  }

  async function handlePushUsage() {
    try {
      const data = await readJson(
        await request("/api/v1/usage", {
          method: "POST",
          apiKey: apiKey.trim(),
          body: { event: "draft_view", timestamp: new Date().toISOString(), metadata: { source: "demo" } },
        })
      );
      setPushOutput({ value: data, isError: false });
    } catch (error) {
      setPushOutput({ value: error.data || { error: error.message }, isError: true });
    }
  }

  async function handleSearchPlayers() {
    const params = new URLSearchParams();
    QUERY_FIELDS.forEach((field) => {
      const value = String(form[field] || "").trim();
      if (value) params.set(field, value);
    });
    try {
      const queryString = params.toString();
      const data = await readJson(
        await request(`/api/v1/players${queryString ? `?${queryString}` : ""}`, { apiKey: apiKey.trim() })
      );
      setPullOutput({ value: null, isError: false });
      setPlayersResult({ ...data, queryString });
    } catch (error) {
      setPlayersResult(null);
      setPullOutput({ value: error.data || { error: error.message }, isError: true });
    }
  }

  return (
    <main className="page">
      <header className="header">
        <h1>Player Data API Demo</h1>
        <p>Single-port frontend on <code>http://localhost:4001</code>.</p>
      </header>

      <section className="card">
        <h2>API Key</h2>
        <div className="row key-row">
          <input
            type="text" value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder="your-secret-key" autoComplete="off"
          />
          <button type="button" className="secondary" onClick={loadFilters}>Load Filters</button>
        </div>
        <p className="status">{filterStatus}</p>
      </section>

      <section className="grid two">
        <article className="card">
          <h2>1) License Check</h2>
          <button type="button" onClick={handleCheckLicense}>Check License</button>
          <JsonOutput value={licenseOutput.value} isError={licenseOutput.isError} />
        </article>
        <article className="card">
          <h2>3) Push Usage</h2>
          <button type="button" onClick={handlePushUsage}>Push Usage</button>
          <JsonOutput value={pushOutput.value} isError={pushOutput.isError} />
        </article>
      </section>

      <section className="card">
        <h2>2) Pull Players</h2>
        <div className="grid fields">
          <label>Search<input name="search" value={form.search} onChange={updateField} placeholder="e.g. soto" /></label>
          <label>Team
            <select name="team" value={form.team} onChange={updateField}>
              <option value="">Any team</option>
              {filterOptions.teams.map((team) => <option key={team} value={team}>{team}</option>)}
            </select>
          </label>
          <label>Position
            <select name="position" value={form.position} onChange={updateField}>
              <option value="">Any position</option>
              {filterOptions.positions.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          </label>
          <label>Sort by
            <select name="sortBy" value={form.sortBy} onChange={updateField}>
              {sortFields.map((f) => <option key={f} value={f}>{f}</option>)}
            </select>
          </label>
          <label>Sort order
            <select name="sortOrder" value={form.sortOrder} onChange={updateField}>
              <option value="desc">desc</option>
              <option value="asc">asc</option>
            </select>
          </label>
          <label>Limit<input name="limit" type="number" min="1" max="200" value={form.limit} onChange={updateField} /></label>
          <label>Offset<input name="offset" type="number" min="0" value={form.offset} onChange={updateField} /></label>
          <label>Min fpts<input name="minFpts" type="number" value={form.minFpts} onChange={updateField} /></label>
          <label>Max fpts<input name="maxFpts" type="number" value={form.maxFpts} onChange={updateField} /></label>
          <label>Min hr<input name="minHr" type="number" value={form.minHr} onChange={updateField} /></label>
          <label>Max hr<input name="maxHr" type="number" value={form.maxHr} onChange={updateField} /></label>
          <label>Min rbi<input name="minRbi" type="number" value={form.minRbi} onChange={updateField} /></label>
          <label>Max rbi<input name="maxRbi" type="number" value={form.maxRbi} onChange={updateField} /></label>
          <label>Min avg<input name="minAvg" type="number" step="0.001" value={form.minAvg} onChange={updateField} /></label>
          <label>Max avg<input name="maxAvg" type="number" step="0.001" value={form.maxAvg} onChange={updateField} /></label>
        </div>
        <div className="row">
          <button type="button" onClick={handleSearchPlayers}>Search Players</button>
          <button type="button" className="secondary" onClick={resetFilters}>Reset</button>
        </div>
        <JsonOutput value={pullOutput.value} isError={pullOutput.isError} />
        {playersResult && (
          <section className="summary">
            <p>Query: <code>{playersResult.queryString || "none"}</code></p>
            <p>Showing {playersResult.players?.length || 0} of {playersResult.total || 0} | sort={playersResult.sort?.by}:{playersResult.sort?.order}</p>
            <p>Filters: {buildFilterSummary(playersResult.filters)}</p>
            {playersResult.players?.length ? (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Name</th>
                      <th>Team</th>
                      <th>Pos</th>
                      <th>Status</th>
                      <th title="Home Runs">HR</th>
                      <th title="Runs Batted In">RBI</th>
                      <th title="Batting Average">AVG</th>
                      <th title="On Base Pct">OBP</th>
                      <th title="Stolen Bases">SB</th>
                      <th title="Innings Pitched">IP</th>
                      <th title="Earned Run Average">ERA</th>
                      <th title="Saves">SV</th>
                      <th title="Fantasy Points">fpts</th>
                    </tr>
                  </thead>
                  <tbody>
                    {playersResult.players.map((p) => (
                      <tr key={p.playerId}>
                        <td className="player-name">{p.playerName}</td>
                        <td><span className="team-badge">{p.mlbTeam}</span></td>
                        <td className="muted">{p.position}</td>
                        <td>
                          <span className={`status-badge status-${(p.status || 'active').replace(/[^a-z]/gi,'')}`}>
                            {p.status || 'active'}
                          </span>
                        </td>
                        <td>{p.hr || "—"}</td>
                        <td>{p.rbi || "—"}</td>
                        <td>{p.avg ? Number(p.avg).toFixed(3) : "—"}</td>
                        <td>{p.obp ? Number(p.obp).toFixed(3) : "—"}</td>
                        <td>{p.sb || "—"}</td>
                        <td>{p.ip ? Number(p.ip).toFixed(1) : "—"}</td>
                        <td>{p.era ? Number(p.era).toFixed(2) : "—"}</td>
                        <td>{p.sv || "—"}</td>
                        <td>{p.fpts ? Math.round(p.fpts) : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : <p>No players matched this query.</p>}
          </section>
        )}
      </section>

      <ValuationsSection apiKey={apiKey} />
    </main>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(<App />);
