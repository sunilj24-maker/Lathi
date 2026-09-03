import { useEffect, useMemo, useState } from "react";
import { FEATURE_KINDS } from "../data/config.js";
import MapView from "./components/MapView.jsx";
import SearchBox from "./components/SearchBox.jsx";
import ProfilePicker from "./components/ProfilePicker.jsx";
import RouteSummary from "./components/RouteSummary.jsx";
import { loadAcademicArea, loadBuildings, loadFeatures, loadMeta, loadPlaces } from "./lib/data.js";
import { loadGraph } from "./lib/routing/graph.js";
import { computeRoutes, RouteError } from "./lib/routing/route.js";

export default function App() {
  const [data, setData] = useState({ places: null, features: null, buildings: null, academicArea: null, meta: null, graph: null });
  const [loadError, setLoadError] = useState(null);

  const [from, setFrom] = useState(null);
  const [to, setTo] = useState(null);
  const [profile, setProfile] = useState("normal");

  const [result, setResult] = useState(null);
  const [routeError, setRouteError] = useState(null);
  const [hoveredStep, setHoveredStep] = useState(null);
  const [focus, setFocus] = useState(null);

  const [showFeatures, setShowFeatures] = useState(true);
  const [showBuildings, setShowBuildings] = useState(true);
  const [panelOpen, setPanelOpen] = useState(true);

  // ---- load static data + graph -------------------------------------------------------
  useEffect(() => {
    let cancelled = false;
    Promise.all([loadPlaces(), loadFeatures(), loadBuildings(), loadAcademicArea(), loadMeta(), loadGraph()])
      .then(([places, features, buildings, academicArea, meta, graph]) => {
        if (cancelled) return;
        setData({ places, features, buildings, academicArea, meta, graph });
        // Restore a shared link: ?from=<place id or name>&to=…&profile=wheelchair
        const q = new URLSearchParams(window.location.search);
        const find = (v) => (v ? places.find((p) => p.id === v || p.name.toLowerCase() === v.toLowerCase()) ?? null : null);
        if (q.get("from")) setFrom(find(q.get("from")));
        if (q.get("to")) setTo(find(q.get("to")));
        if (q.get("profile") === "wheelchair") setProfile("wheelchair");
      })
      .catch((err) => !cancelled && setLoadError(err.message));
    return () => {
      cancelled = true;
    };
  }, []);

  // ---- keep the URL shareable ---------------------------------------------------------
  useEffect(() => {
    if (!data.places) return;
    const q = new URLSearchParams();
    if (from?.kind !== "point" && from) q.set("from", from.id);
    if (to?.kind !== "point" && to) q.set("to", to.id);
    if (profile !== "normal") q.set("profile", profile);
    const qs = q.toString();
    window.history.replaceState(null, "", qs ? `?${qs}` : window.location.pathname);
  }, [data.places, from, to, profile]);

  // ---- compute the route whenever inputs change ---------------------------------------
  useEffect(() => {
    if (!data.graph || !from || !to) {
      setResult(null);
      setRouteError(null);
      return;
    }
    try {
      const res = computeRoutes(data.graph, from, to, profile, { academicArea: data.academicArea?.features?.[0]?.geometry });
      setResult(res);
      setRouteError(null);
    } catch (err) {
      setResult(null);
      setRouteError(err instanceof RouteError ? err.message : `Routing failed: ${err.message}`);
    }
  }, [data.graph, data.academicArea, from, to, profile]);

  const swap = () => {
    setFrom(to);
    setTo(from);
  };

  const featureCounts = useMemo(() => {
    const counts = {};
    for (const f of data.features?.features ?? []) counts[f.properties.kind] = (counts[f.properties.kind] ?? 0) + 1;
    return counts;
  }, [data.features]);

  const ready = Boolean(data.graph && data.places);

  return (
    <div className="app">
      <MapView
        academicArea={data.academicArea}
        buildings={data.buildings}
        features={data.features}
        places={data.places}
        from={from}
        to={to}
        result={result}
        hoveredStep={hoveredStep}
        focus={focus}
        onSetFrom={(p) => {
          setFrom(p);
          setPanelOpen(true);
        }}
        onSetTo={(p) => {
          setTo(p);
          setPanelOpen(true);
        }}
        showFeatures={showFeatures}
        showBuildings={showBuildings}
      />

      <button type="button" className="panel-toggle" onClick={() => setPanelOpen((o) => !o)} aria-expanded={panelOpen}>
        {panelOpen ? "Hide panel" : "Directions"}
      </button>

      <aside className={`panel ${panelOpen ? "open" : "closed"}`}>
        <header className="panel-head">
          <div className="brand">
            <span className="brand-mark" aria-hidden="true">
              ♿
            </span>
            <div>
              <h1>IITK Accessible</h1>
              <p>Step-free &amp; accessibility-aware routes across IIT Kanpur</p>
            </div>
          </div>
        </header>

        <section className="inputs" aria-label="Route inputs">
          <div className="inputs-rows">
            <SearchBox places={data.places} value={from} onChange={setFrom} placeholder="Choose starting point" marker="from" />
            <SearchBox places={data.places} value={to} onChange={setTo} placeholder="Choose destination" marker="to" />
          </div>
          <button type="button" className="swap" onClick={swap} title="Swap start and destination" aria-label="Swap start and destination">
            ⇅
          </button>
        </section>

        <ProfilePicker value={profile} onChange={setProfile} />

        <section className="results">
          {loadError && <div className="route-error">Could not load map data: {loadError}</div>}
          {!loadError && !ready && <div className="hint">Loading campus data…</div>}

          {ready && !from && !to && (
            <div className="hint">
              <p>Search a building above, or click anywhere on the map and choose <em>Directions from here</em>.</p>
              <p className="hint-small">
                Detailed accessibility coverage is inside the dashed <span className="legend-swatch academic" /> Academic Area. Elsewhere the
                route follows whatever OpenStreetMap already has.
              </p>
            </div>
          )}
          {ready && (from || to) && !(from && to) && (
            <div className="hint">Now choose {from ? "a destination" : "a starting point"}.</div>
          )}

          {routeError && <div className="route-error">{routeError}</div>}

          {result && (
            <RouteSummary
              result={result}
              onHoverStep={setHoveredStep}
              onSelectStep={(step) => setFocus({ coord: step.coord, t: Date.now() })}
            />
          )}
        </section>

        <section className="legend" aria-label="Map layers">
          <div className="legend-toggles">
            <label>
              <input type="checkbox" checked={showBuildings} onChange={(e) => setShowBuildings(e.target.checked)} /> Buildings
            </label>
            <label>
              <input type="checkbox" checked={showFeatures} onChange={(e) => setShowFeatures(e.target.checked)} /> Accessibility features
            </label>
          </div>
          {showFeatures && (
            <ul className="legend-list">
              {Object.entries(FEATURE_KINDS)
                .filter(([k]) => featureCounts[k])
                .map(([k, v]) => (
                  <li key={k}>
                    <span className="legend-swatch" style={{ background: v.color }} /> {v.label}
                    <span className="legend-count">{featureCounts[k]}</span>
                  </li>
                ))}
            </ul>
          )}
        </section>

        <footer className="panel-foot">
          {data.meta && (
            <span>
              {data.meta.graph.nodes.toLocaleString()} path points · {data.meta.namedBuildings} named buildings · OSM snapshot{" "}
              {data.meta.osmFetchedAt ? new Date(data.meta.osmFetchedAt).toLocaleDateString() : "—"}
            </span>
          )}
          <span>
            Data ©{" "}
            <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">
              OpenStreetMap
            </a>{" "}
            contributors ·{" "}
            <a href="https://www.openstreetmap.org/edit#map=17/26.5125/80.2330" target="_blank" rel="noreferrer">
              Improve the map
            </a>
          </span>
        </footer>
      </aside>
    </div>
  );
}
