/**
 * Build the app's data files from the raw OSM snapshot.
 *
 *   npm run data:build                       # from data/raw/iitk.osm.json
 *   node scripts/build-data.mjs --file x.osm # from a JOSM .osm file (unuploaded edits)
 *
 * Outputs (all under public/data so the browser can fetch them):
 *   graph.json       pedestrian routing graph (nodes, edges, way tags)
 *   buildings.geojson named building footprints
 *   features.geojson accessibility features (ramps, stairs, crossings, entrances, …)
 *   places.json      searchable buildings / entrances / landmarks
 *   meta.json        counts + snapshot timestamp shown in the UI
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { CAMPUS_BBOX, ROUTABLE_HIGHWAYS } from "../data/config.js";
import { haversineMeters } from "../src/lib/geo/haversine.js";
import { pointInGeometry, ringCentroid } from "../src/lib/geo/pointInPolygon.js";
import { bboxContains } from "../src/lib/geo/bbox.js";
import { classifyFeature } from "../src/lib/features.js";
import { parseOsmXml } from "./osm-xml.mjs";

const ROOT = process.cwd();
const OUT_DIR = join(ROOT, "public/data");
const ROUTABLE = new Set(ROUTABLE_HIGHWAYS);

// ---------------------------------------------------------------- input

function loadRaw() {
  const idx = process.argv.indexOf("--file");
  if (idx !== -1 && process.argv[idx + 1]) {
    const file = process.argv[idx + 1];
    console.log(`Reading ${file}`);
    const text = readFileSync(file, "utf8");
    return file.endsWith(".json") ? JSON.parse(text) : parseOsmXml(text);
  }
  const p = join(ROOT, "data/raw/iitk.osm.json");
  if (!existsSync(p)) throw new Error("Missing data/raw/iitk.osm.json — run `npm run data:fetch` first");
  return JSON.parse(readFileSync(p, "utf8"));
}

function loadOverrides() {
  const p = join(ROOT, "data/overrides.json");
  if (!existsSync(p)) return {};
  const raw = JSON.parse(readFileSync(p, "utf8"));
  const out = {};
  for (const [k, v] of Object.entries(raw)) if (!k.startsWith("_")) out[k] = v;
  return out;
}

function loadAcademicArea() {
  const gj = JSON.parse(readFileSync(join(OUT_DIR, "academic-area.geojson"), "utf8"));
  return gj.features[0].geometry;
}

// ---------------------------------------------------------------- helpers

const round = (n) => Math.round(n * 1e6) / 1e6;

/** Pedestrians may use this way? */
function footAllowed(tags) {
  if (tags.foot === "no" || tags.foot === "private") return false;
  if (["no", "private"].includes(tags.access) && !["yes", "designated", "permissive"].includes(tags.foot)) {
    return false;
  }
  if (tags.highway === "construction" || tags.construction) return false;
  return true;
}

function isRoutableWay(tags) {
  return Boolean(tags.highway) && ROUTABLE.has(tags.highway) && footAllowed(tags);
}

/** Tags on a node that matter for routing or display. */
function relevantNodeTags(tags) {
  if (!tags) return null;
  const keep = {};
  for (const k of Object.keys(tags)) {
    if (
      /^(highway|crossing|kerb|tactile_paving|barrier|entrance|wheelchair|door|width|level|access|foot|check_date|name|ramp|automatic_door|step_count|handrail|bicycle|motor_vehicle|locked)$|^crossing:|^ramp:|^kerb:/.test(k)
    ) {
      keep[k] = tags[k];
    }
  }
  return Object.keys(keep).length ? keep : null;
}

function wayCoords(way, nodes) {
  const coords = [];
  for (const id of way.nodes) {
    const n = nodes.get(id);
    if (n) coords.push([n.lon, n.lat]);
  }
  return coords;
}

function isClosed(way) {
  return way.nodes.length > 3 && way.nodes[0] === way.nodes[way.nodes.length - 1];
}

// ---------------------------------------------------------------- main

function main() {
  const raw = loadRaw();
  const overrides = loadOverrides();
  const academic = loadAcademicArea();
  const inArea = (lon, lat) => pointInGeometry(lon, lat, academic);

  const nodes = new Map();
  const ways = [];
  const relations = [];
  const seenWay = new Set();
  for (const el of raw.elements) {
    if (el.type === "node") {
      // Older snapshots may contain a node twice (tagged + skeleton); keep the tags.
      const prev = nodes.get(el.id);
      if (!prev || (!prev.tags && el.tags)) nodes.set(el.id, el);
    } else if (el.type === "way") {
      if (seenWay.has(el.id)) continue;
      seenWay.add(el.id);
      ways.push(el);
    } else if (el.type === "relation") relations.push(el);
  }

  // ---- 1. Routing graph -------------------------------------------------
  const graphNodes = {};
  const graphWays = {};
  const edges = [];
  const seenEdge = new Set();
  const degree = new Map();

  for (const way of ways) {
    const tags = way.tags ?? {};
    if (!isRoutableWay(tags)) continue;
    let used = false;
    for (let i = 0; i < way.nodes.length - 1; i++) {
      const a = nodes.get(way.nodes[i]);
      const b = nodes.get(way.nodes[i + 1]);
      if (!a || !b) continue;
      if (!bboxContains(CAMPUS_BBOX, a.lon, a.lat) && !bboxContains(CAMPUS_BBOX, b.lon, b.lat)) continue;
      const key = a.id < b.id ? `${a.id}|${b.id}` : `${b.id}|${a.id}`;
      if (seenEdge.has(key)) continue;
      seenEdge.add(key);
      graphNodes[a.id] ??= [round(a.lon), round(a.lat)];
      graphNodes[b.id] ??= [round(b.lon), round(b.lat)];
      degree.set(a.id, (degree.get(a.id) ?? 0) + 1);
      degree.set(b.id, (degree.get(b.id) ?? 0) + 1);
      const len = Math.max(0.5, haversineMeters(a.lat, a.lon, b.lat, b.lon));
      edges.push([a.id, b.id, Math.round(len * 10) / 10, way.id]);
      used = true;
    }
    if (used) graphWays[way.id] = tags;
  }

  // Node tags for graph nodes that carry routing-relevant info (crossings, kerbs, barriers, entrances).
  const graphNodeTags = {};
  for (const idStr of Object.keys(graphNodes)) {
    const n = nodes.get(Number(idStr));
    const t = relevantNodeTags(n?.tags);
    if (t) graphNodeTags[idStr] = t;
  }

  const graph = {
    generatedAt: new Date().toISOString(),
    nodes: graphNodes,
    nodeTags: graphNodeTags,
    ways: graphWays,
    edges,
  };

  // ---- 2. Buildings ---------------------------------------------------------
  const buildings = [];
  const buildingByWayId = new Map();
  for (const way of ways) {
    const tags = way.tags ?? {};
    if (!tags.building || !isClosed(way)) continue;
    const coords = wayCoords(way, nodes);
    if (coords.length < 4) continue;
    const c = ringCentroid(coords);
    if (!c || !bboxContains(CAMPUS_BBOX, c.lon, c.lat)) continue;
    const entranceNodeIds = way.nodes.filter((id) => nodes.get(id)?.tags?.entrance);
    const feature = {
      type: "Feature",
      id: way.id,
      properties: {
        osmId: `way/${way.id}`,
        name: tags.name ?? null,
        building: tags.building,
        levels: tags["building:levels"] ?? null,
        wheelchair: tags.wheelchair ?? null,
        inAcademicArea: inArea(c.lon, c.lat),
        entrances: entranceNodeIds.length,
      },
      geometry: { type: "Polygon", coordinates: [coords] },
    };
    buildings.push(feature);
    buildingByWayId.set(way.id, { way, centroid: c, entranceNodeIds, tags });
  }

  // ---- 3. Accessibility features -----------------------------------------------
  const features = [];
  const featureOf = (osmId, kind, tags, geometry, lon, lat) => {
    const extra = overrides[osmId] ?? {};
    return {
      type: "Feature",
      properties: {
        osmId,
        kind,
        name: tags.name ?? null,
        check_date: extra.check_date ?? tags.check_date ?? null,
        wheelchair: tags.wheelchair ?? null,
        inAcademicArea: inArea(lon, lat),
        tags: JSON.stringify(tags),
        notes: extra.notes ?? null,
        photo: extra.photo ?? null,
      },
      geometry,
    };
  };

  for (const n of nodes.values()) {
    if (!n.tags || !bboxContains(CAMPUS_BBOX, n.lon, n.lat)) continue;
    const kind = classifyFeature(n.tags);
    if (!kind) continue;
    features.push(
      featureOf(`node/${n.id}`, kind, n.tags, { type: "Point", coordinates: [round(n.lon), round(n.lat)] }, n.lon, n.lat),
    );
  }
  for (const way of ways) {
    if (!way.tags || way.tags.building) continue;
    const kind = classifyFeature(way.tags);
    if (!kind) continue;
    const coords = wayCoords(way, nodes).map(([lo, la]) => [round(lo), round(la)]);
    if (coords.length < 2) continue;
    const mid = coords[Math.floor(coords.length / 2)];
    if (!bboxContains(CAMPUS_BBOX, mid[0], mid[1])) continue;
    features.push(featureOf(`way/${way.id}`, kind, way.tags, { type: "LineString", coordinates: coords }, mid[0], mid[1]));
  }

  // ---- 4. Places (search index) ------------------------------------------------
  const places = [];
  const seenName = new Set();

  const buildingNameFor = (lon, lat, maxM = 60) => {
    let best = null;
    let bestD = maxM;
    for (const b of buildingByWayId.values()) {
      if (!b.tags.name) continue;
      const d = haversineMeters(lat, lon, b.centroid.lat, b.centroid.lon);
      if (d < bestD) {
        bestD = d;
        best = b.tags.name;
      }
    }
    return best;
  };

  for (const [wayId, b] of buildingByWayId) {
    if (!b.tags.name) continue;
    const key = b.tags.name.toLowerCase();
    if (seenName.has(key)) continue;
    seenName.add(key);
    places.push({
      id: `way/${wayId}`,
      name: b.tags.name,
      kind: "building",
      category: b.tags.amenity ?? b.tags.building ?? null,
      lon: round(b.centroid.lon),
      lat: round(b.centroid.lat),
      inAcademicArea: inArea(b.centroid.lon, b.centroid.lat),
      // Entrance nodes that are already part of the routing graph snap perfectly.
      entranceNodeIds: b.entranceNodeIds.filter((id) => graphNodes[id]).map(String),
      // All entrance positions so the client can snap from the nearest one.
      entrances: b.entranceNodeIds.map((id) => {
        const n = nodes.get(id);
        return { id: String(id), lon: round(n.lon), lat: round(n.lat), type: n.tags.entrance, wheelchair: n.tags.wheelchair ?? null };
      }),
    });
  }

  for (const n of nodes.values()) {
    const t = n.tags;
    if (!t || !bboxContains(CAMPUS_BBOX, n.lon, n.lat)) continue;
    if (t.entrance) {
      const host = buildingNameFor(n.lon, n.lat);
      const label = t.name || (host ? `${host} — ${t.entrance === "main" ? "main entrance" : "entrance"}` : null);
      if (!label) continue;
      places.push({
        id: `node/${n.id}`,
        name: label,
        kind: "entrance",
        category: t.entrance,
        lon: round(n.lon),
        lat: round(n.lat),
        wheelchair: t.wheelchair ?? null,
        inAcademicArea: inArea(n.lon, n.lat),
        nodeId: graphNodes[n.id] ? String(n.id) : null,
      });
    } else if (t.name && (t.amenity || t.shop || t.leisure || t.tourism || t.office || t.healthcare)) {
      const key = t.name.toLowerCase();
      if (seenName.has(key)) continue;
      seenName.add(key);
      places.push({
        id: `node/${n.id}`,
        name: t.name,
        kind: "landmark",
        category: t.amenity ?? t.shop ?? t.leisure ?? t.tourism ?? t.office ?? t.healthcare,
        lon: round(n.lon),
        lat: round(n.lat),
        inAcademicArea: inArea(n.lon, n.lat),
        nodeId: graphNodes[n.id] ? String(n.id) : null,
      });
    }
  }
  // Named non-building areas (sports grounds, parks, hostels mapped as areas, …)
  for (const way of ways) {
    const t = way.tags;
    if (!t?.name || t.building || t.highway || !isClosed(way)) continue;
    if (!(t.amenity || t.leisure || t.landuse === "education" || t.tourism || t.office)) continue;
    const key = t.name.toLowerCase();
    if (seenName.has(key)) continue;
    const c = ringCentroid(wayCoords(way, nodes));
    if (!c || !bboxContains(CAMPUS_BBOX, c.lon, c.lat)) continue;
    seenName.add(key);
    places.push({
      id: `way/${way.id}`,
      name: t.name,
      kind: "landmark",
      category: t.amenity ?? t.leisure ?? t.tourism ?? t.office ?? "area",
      lon: round(c.lon),
      lat: round(c.lat),
      inAcademicArea: inArea(c.lon, c.lat),
    });
  }

  places.sort((a, b) => a.name.localeCompare(b.name));

  // ---- 5. Write -----------------------------------------------------------------
  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(join(OUT_DIR, "graph.json"), JSON.stringify(graph));
  writeFileSync(join(OUT_DIR, "buildings.geojson"), JSON.stringify({ type: "FeatureCollection", features: buildings }));
  writeFileSync(join(OUT_DIR, "features.geojson"), JSON.stringify({ type: "FeatureCollection", features }));
  writeFileSync(join(OUT_DIR, "places.json"), JSON.stringify(places));

  const kinds = {};
  for (const f of features) kinds[f.properties.kind] = (kinds[f.properties.kind] ?? 0) + 1;
  const meta = {
    builtAt: graph.generatedAt,
    osmFetchedAt: raw.fetchedAt ?? null,
    graph: { nodes: Object.keys(graphNodes).length, edges: edges.length, ways: Object.keys(graphWays).length },
    buildings: buildings.length,
    namedBuildings: buildings.filter((b) => b.properties.name).length,
    features: features.length,
    featureKinds: kinds,
    places: places.length,
  };
  writeFileSync(join(OUT_DIR, "meta.json"), JSON.stringify(meta, null, 2));

  console.log(`Graph:     ${meta.graph.nodes} nodes, ${meta.graph.edges} edges, ${meta.graph.ways} ways`);
  console.log(`Buildings: ${meta.buildings} (${meta.namedBuildings} named)`);
  console.log(`Features:  ${meta.features} ${JSON.stringify(kinds)}`);
  console.log(`Places:    ${meta.places}`);
}

main();
