import { useEffect, useMemo, useState } from "react";
import { AMENITY_FINDERS, MAP_MODES } from "../data/config.js";
import MapView from "./components/MapView.jsx";
import TopBar from "./components/TopBar.jsx";
import AmenityList from "./components/AmenityList.jsx";
import SearchBox from "./components/SearchBox.jsx";
import ProfilePicker from "./components/ProfilePicker.jsx";
import RouteSummary from "./components/RouteSummary.jsx";
import FloorSwitcher from "./components/FloorSwitcher.jsx";
import { loadAcademicArea, loadAmenities, loadBuildings, loadFeatures, loadIndoor, loadMeta, loadPaths, loadPlaces, loadQa } from "./lib/data.js";
import { loadGraph } from "./lib/routing/graph.js";
import { computeRoutes, rankByWalking, RouteError } from "./lib/routing/route.js";
import { GROUND } from "./lib/levels.js";

/** Determine whether current local time is night (between 18:30 and 06:00). */
export function isNightTime(date = new Date()) {
  const hours = date.getHours();
  const minutes = date.getMinutes();
  return hours >= 19 || hours < 6 || (hours === 18 && minutes >= 30);
}

export default function App() {
  const [data, setData] = useState({ places: null, features: null, buildings: null, indoor: null, paths: null, academicArea: null, meta: null, qa: null, amenities: null, graph: null });
  const [loadError, setLoadError] = useState(null);

  const [from, setFrom] = useState(null);
  const [to, setTo] = useState(null);
  const [profile, setProfile] = useState("normal");
  const [level, setLevel] = useState(GROUND);
  const [mode, setMode] = useState("buildings");

  const [result, setResult] = useState(null);
  const [routeError, setRouteError] = useState(null);
  const [hoveredStep, setHoveredStep] = useState(null);
  const [focus, setFocus] = useState(null);

  const [panelOpen, setPanelOpen] = useState(true);
  const [finder, setFinder] = useState(null);
  const [night, setNight] = useState(() => {
    const q = new URLSearchParams(window.location.search);
    if (q.has("night")) return q.get("night") === "1";
    try {
      const saved = localStorage.getItem("lathi-night-choice");
      if (saved === "day") return false;
      if (saved === "night") return true;
    } catch {}
    return isNightTime();
  });
  const [lang, setLang] = useState(() => {
    const q = new URLSearchParams(window.location.search);
    if (q.get("lang") === "hi" || q.get("lang") === "en") return q.get("lang");
    try {
      return localStorage.getItem("lathi-lang") || "en";
    } catch {}
    return "en";
  });
  const [nearestBusy, setNearestBusy] = useState(false);
  const [nearestError, setNearestError] = useState(null);

  const handleNight = (val) => {
    setNight(val);
    try {
      localStorage.setItem("lathi-night-choice", val ? "night" : "day");
    } catch {}
  };

  const handleLang = (val) => {
    setLang(val);
    try {
      localStorage.setItem("lathi-lang", val);
    } catch {}
  };

  // ---- load static data + graph -------------------------------------------------------
  useEffect(() => {
    let cancelled = false;
    Promise.all([loadPlaces(), loadFeatures(), loadBuildings(), loadIndoor(), loadPaths(), loadAcademicArea(), loadMeta(), loadQa(), loadAmenities(), loadGraph()])
      .then(([places, features, buildings, indoor, paths, academicArea, meta, qa, amenities, graph]) => {
        if (cancelled) return;
        setData({ places, features, buildings, indoor, paths, academicArea, meta, qa, amenities, graph });
        const q = new URLSearchParams(window.location.search);
        const norm = (s) => s.toLowerCase().replace(/[\s-]/g, "");
        const find = (v) =>
          v ? places.find((p) => p.id === v || norm(p.name) === norm(v) || p.aliases?.some((a) => norm(a) === norm(v))) ?? amenities.find((a) => a.id === v) ?? null : null;
        if (q.get("from")) setFrom(find(q.get("from")));
        if (q.get("to")) setTo(find(q.get("to")));
        if (q.get("profile") === "wheelchair") setProfile("wheelchair");
        if (q.get("level") && graph.levels.includes(q.get("level"))) setLevel(q.get("level"));
        if (MAP_MODES.some((m) => m.id === q.get("mode"))) setMode(q.get("mode"));
        if (q.get("qa") === "1") setShowQa(true);
        if (AMENITY_FINDERS.some((f) => f.id === q.get("find"))) setFinder(q.get("find"));
        if (q.has("night")) setNight(q.get("night") === "1");
        if (q.get("lang") === "hi" || q.get("lang") === "en") setLang(q.get("lang"));
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
    if (from && from.kind !== "point") q.set("from", from.id);
    if (to && to.kind !== "point") q.set("to", to.id);
    if (profile !== "normal") q.set("profile", profile);
    if (level !== GROUND) q.set("level", level);
    if (mode !== "buildings") q.set("mode", mode);
    if (night) q.set("night", "1");
    if (lang === "hi") q.set("lang", "hi");
    const qs = q.toString();
    window.history.replaceState(null, "", qs ? `?${qs}` : window.location.pathname);
  }, [data.places, from, to, profile, level, mode, finder, night, lang]);

  // ---- compute the route whenever inputs change ---------------------------------------
  useEffect(() => {
    if (!data.graph || !from || !to) {
      setResult(null);
      setRouteError(null);
      return;
    }
    try {
      const res = computeRoutes(data.graph, from, to, profile, { academicArea: data.academicArea?.features?.[0]?.geometry, night, places: data.places });
      setResult(res);
      setRouteError(null);
      // Show the floor the route starts on.
      const startLevel = res.main.directions[0]?.level;
      if (startLevel != null && data.graph.levels.includes(startLevel)) setLevel(startLevel);
    } catch (err) {
      setResult(null);
      setRouteError(err instanceof RouteError ? err.message : `Routing failed: ${err.message}`);
    }
  }, [data.graph, data.academicArea, data.places, from, to, profile, night]);

  const swap = () => {
    setFrom(to);
    setTo(from);
  };

  const featureCounts = useMemo(() => {
    const counts = {};
    for (const f of data.features?.features ?? []) counts[f.properties.kind] = (counts[f.properties.kind] ?? 0) + 1;
    return counts;
  }, [data.features]);

  const amenityCounts = useMemo(() => {
    const counts = {};
    for (const a of data.amenities ?? []) counts[a.group] = (counts[a.group] ?? 0) + 1;
    return counts;
  }, [data.amenities]);
  const activeFinder = AMENITY_FINDERS.find((f) => f.id === finder) ?? null;
  const finderItems = useMemo(() => (activeFinder ? (data.amenities ?? []).filter((a) => activeFinder.groups.includes(a.group)) : null), [activeFinder, data.amenities]);

  const ready = Boolean(data.graph && data.places);
  const pick = (setter) => (p) => {
    setter(p);
    setPanelOpen(true);
    if (p?.level != null && !String(p.level).includes(";") && data.graph?.levels.includes(String(p.level))) setLevel(String(p.level));
  };

  const goToNearest = (items) => {
    setNearestBusy(true);
    setNearestError(null);
    // Let the button repaint before the synchronous routing work.
    setTimeout(() => {
      const ranked = rankByWalking(data.graph, from, items, profile, { academicArea: data.academicArea?.features?.[0]?.geometry, night });
      setNearestBusy(false);
      if (ranked.length) pick(setTo)(ranked[0].item);
      else setNearestError("None of these can be reached from your starting point with the current profile.");
    }, 0);
  };

  return (
    <div className="app">
      <MapView
        academicArea={data.academicArea}
        buildings={data.buildings}
        indoor={data.indoor}
        paths={data.paths}
        features={data.features}
        places={data.places}
        qa={data.qa}
        amenities={finderItems}
        from={from}
        to={to}
        result={result}
        hoveredStep={hoveredStep}
        focus={focus}
        level={level}
        mode={mode}
        night={night}
        onSetFrom={pick(setFrom)}
        onSetTo={pick(setTo)}
        showFeatures={false}
        showBuildings={true}
        showIndoor={true}
        showQa={false}
        showSnap={false}
      />

      <TopBar
        finder={finder}
        counts={amenityCounts}
        night={night}
        onNight={handleNight}
        lang={lang}
        onLang={handleLang}
        onFinder={(id) => {
          setFinder(id);
          setNearestError(null);
          if (id) setPanelOpen(true);
        }}
      />

      {/* Floating button to reopen panel when it's closed */}
      {!panelOpen && (
        <button
          type="button"
          className="panel-open-fab"
          onClick={() => setPanelOpen(true)}
          aria-label="Open directions panel"
        >
          ☰ Directions
        </button>
      )}

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
            {/* Close button inside panel header */}
            <button
              type="button"
              className="panel-close-btn"
              onClick={() => setPanelOpen(false)}
              aria-label="Close panel"
              title="Close panel"
            >
              ✕
            </button>
          </div>
        </header>

        <section className="inputs" aria-label="Route inputs">
          <div className="inputs-rows">
            <SearchBox places={data.places} value={from} onChange={pick(setFrom)} placeholder="Choose starting point" marker="from" />
            <SearchBox places={data.places} value={to} onChange={pick(setTo)} placeholder="Choose destination" marker="to" />
          </div>
          <button type="button" className="swap" onClick={swap} title="Swap start and destination" aria-label="Swap start and destination">
            ⇅
          </button>
        </section>

        <ProfilePicker value={profile} onChange={setProfile} />

        <section className="results">
          {loadError && <div className="route-error">Could not load map data: {loadError}</div>}
          {!loadError && !ready && <div className="hint">Loading campus data…</div>}

          {ready && activeFinder && (
            <AmenityList
              key={activeFinder.id}
              finder={activeFinder}
              items={finderItems}
              from={from}
              selectedId={to?.id}
              onPick={pick(setTo)}
              onNearest={goToNearest}
              nearestBusy={nearestBusy}
              onClose={() => setFinder(null)}
            />
          )}
          {nearestError && <div className="route-error">{nearestError}</div>}

          {ready && !from && !to && (
            <div className="hint">
              <p>
                Search a building, room or entrance above, or click anywhere on the map and choose <em>Directions from here</em>.
              </p>
              <p className="hint-small">
                Detailed accessibility coverage is inside the dashed <span className="legend-swatch academic" /> Academic Area. Routes end at the building's door and change floor
                only via stairs, ramps or lifts.
              </p>
            </div>
          )}
          {ready && (from || to) && !(from && to) && <div className="hint">Now choose {from ? "a destination" : "a starting point"}.</div>}

          {routeError && <div className="route-error">{routeError}</div>}

          {result && (
            <RouteSummary
              result={result}
              lang={lang}
              onLang={handleLang}
              onHoverStep={setHoveredStep}
              onSelectStep={(step) => {
                if (step.level != null && data.graph.levels.includes(step.level)) setLevel(step.level);
                setFocus({ coord: step.coord, t: Date.now() });
              }}
            />
          )}
        </section>

        <footer className="panel-foot">
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

      <FloorSwitcher levels={data.graph?.levels} value={level} onChange={setLevel} highlight={result?.main.levels ?? []} />
    </div>
  );
}
