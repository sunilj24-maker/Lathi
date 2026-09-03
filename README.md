# Lathi — IITK Accessible

Accessibility-aware pedestrian navigation for IIT Kanpur, built on OpenStreetMap data.
Pick **From**, **To** and a profile (**Normal** / **Wheelchair**) and get the most
*suitable* route, not just the shortest one, drawn Google-Maps-style with turn-by-turn steps.

The full product plan is in [`Plan.md`](Plan.md). This README covers what is built and how to run it.

## Stack

| Concern | Choice |
|---|---|
| UI | React 19 + JSX, Vite 7 (no TypeScript) |
| Map | MapLibre GL JS, OpenFreeMap vector tiles (free, no key) |
| Routing | Profile-weighted A*/Dijkstra written in plain JS, runs **in the browser** over `public/data/graph.json` (no server) |
| Search | Fuse.js over `public/data/places.json` |
| Data | OpenStreetMap via Overpass → committed snapshot → build script → static JSON/GeoJSON |
| Tests | Node's built-in test runner (`node --test`) |
| Hosting | Any static host (Vercel / Netlify / GitHub Pages) |

## Run it

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # routing unit tests + campus integration tests
npm run build      # production build into dist/
```

## Data pipeline (how the map gets updated)

```
OpenStreetMap  ──npm run data:fetch──▶  data/raw/iitk.osm.json  ──npm run data:build──▶  public/data/*
  (edit in JOSM)                          (committed snapshot)                            (what the site loads)
```

1. Survey, then edit the map in **JOSM** (or the OSM web editor) using standard tags — see the cheat-sheet in `Plan.md` §3. Upload with the changeset hashtag `#IITKAccessible`.
2. Refresh the site's data:
   ```bash
   npm run data:refresh      # = data:fetch + data:build
   ```
   Commit the regenerated `data/raw/iitk.osm.json` and `public/data/*`, push, and the deployed site updates.
3. To preview **unuploaded** JOSM edits first, save the session as `.osm` and build straight from it:
   ```bash
   node scripts/build-data.mjs --file data/josm-sessions/2026-09-10.osm
   ```
4. App-only extras that OSM tags cannot hold (photos, survey notes) go in `data/overrides.json`, keyed by OSM id.

`npm run data:fetch` tries three Overpass mirrors and falls back to the OSM API. The snapshot is committed so builds are reproducible and the site never depends on Overpass being up.

### Generated files (`public/data/`)

| File | Contents |
|---|---|
| `graph.json` | Routing graph: `nodes` (`id → [lon, lat]`), `edges` (`[from, to, metres, wayId]`), `ways` (tags per way), `nodeTags` (crossings, kerbs, barriers, entrances) |
| `buildings.geojson` | Building footprints with name, levels, entrance count, `inAcademicArea` |
| `features.geojson` | Accessibility features: ramps, stairs, skywalks, crossings, elevators, entrances, benches, rest areas, toilets, drinking water |
| `places.json` | Search index: named buildings (with entrance nodes), entrances, landmarks |
| `academic-area.geojson` | Hand-drawn detailed-coverage polygon (edit by hand) |
| `meta.json` | Counts and snapshot timestamp shown in the UI footer |

## Routing rules

Cost per edge = `length × factor + penalties`. Forbidden edges are simply never used.

| Rule | Normal | Wheelchair |
|---|---|---|
| `highway=steps` | ×1.2 | forbidden unless `ramp:wheelchair=yes` |
| `wheelchair=no` | ×1 | forbidden |
| `incline` > 8 % or `steep` | ×1 | ×6 |
| `incline` 5–8 % | ×1 | ×2.5 |
| `width` < 0.9 m | ×1 | ×4 |
| loose surface (gravel/sand/ground/unpaved…) | ×1.1 | ×3 |
| `smoothness` bad/very_bad | ×1.1 | ×4 |
| crossing with `kerb=raised` | +5 m | +200 m |
| confirmed ramp (`wheelchair=yes`) / `highway=elevator` | ×1 | ×0.8 |
| roads without a sidewalk (both profiles prefer footways) | ×1.1–1.35 | ×1.1–1.35 |

If the Wheelchair profile finds no path the UI says *"No step-free route known yet between these points"* rather than silently falling back. When Wheelchair is selected the shortest Normal route is also computed and drawn dashed grey for comparison ("Avoids 2 staircases on the shortest route (+120 m)").

Routing currently works across the whole campus using whatever OSM already has; endpoints outside the Academic Area produce a warning, not a refusal. Flip `RESTRICT_ROUTING_TO_ACADEMIC_AREA` in `data/config.js` to enforce the strict behaviour from the plan.

## Using the site

- Search a building/entrance/landmark in **A** and **B**, or click anywhere on the map → *Directions from here / to here*. Clicking a building or feature shows its accessibility attributes and last-checked date.
- Hover a direction step to highlight it on the map; click it to zoom there.
- Links are shareable: `/?from=way/123&to=Rajeev%20Motwani%20Building&profile=wheelchair` (ids or names both work).
- Layer toggles for buildings and accessibility features are at the bottom of the panel.

## Repository layout

```
.
├── index.html, vite.config.js
├── src/
│   ├── main.jsx, App.jsx, styles.css
│   ├── components/      MapView, SearchBox, ProfilePicker, FeaturePopup, RouteSummary
│   └── lib/
│       ├── routing/     graph, profiles, dijkstra (A*), snap, directions, route
│       ├── geo/         haversine, pointInPolygon, bbox
│       ├── features.js  OSM tags → feature kind
│       └── data.js      loaders
├── scripts/
│   ├── fetch-osm.mjs    Overpass / OSM API → data/raw/iitk.osm.json
│   ├── build-data.mjs   raw OSM → public/data/*
│   └── osm-xml.mjs      .osm (JOSM) parser
├── data/
│   ├── config.js        campus bbox, zoom, profiles, feature kinds, routable highways
│   ├── raw/             committed OSM snapshot
│   ├── overrides.json   app-only extras keyed by OSM id
│   └── josm-sessions/   optional .osm backups (git-ignored)
├── public/data/         generated GeoJSON/JSON + hand-drawn academic-area.geojson
├── tests/               profiles, dijkstra, campus integration
└── Plan.md
```

## Current OSM coverage (snapshot in repo)

167 named buildings, 79 entrances, 6,443 routable path points — but only 5 staircases, 4 crossings and **no** ramps, benches, elevators or kerb/incline/width tags yet. Until the survey adds them, Normal and Wheelchair routes will mostly coincide; the engine already applies every rule as soon as the tags appear in OSM.

Data © [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors, ODbL.
