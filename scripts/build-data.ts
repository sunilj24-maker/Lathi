import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { haversineMeters } from "../lib/geo/haversine.ts";
import { pointInPolygon, type LonLat } from "../lib/geo/point-in-polygon.ts";
import { ROUTABLE_HIGHWAYS } from "../data/config.ts";
import type { FeatureProps, GraphEdge, GraphNode, Place, RoutingGraph } from "../lib/types.ts";

type OsmNode = {
  type: "node";
  id: number;
  lat: number;
  lon: number;
  tags?: Record<string, string>;
};

type OsmWay = {
  type: "way";
  id: number;
  nodes: number[];
  tags?: Record<string, string>;
};

type OsmJson = { elements: Array<OsmNode | OsmWay | { type: string }> };

type Overlay = Record<string, { photo?: string; notes?: string; check_date?: string }>;

const ROUTABLE = new Set<string>(ROUTABLE_HIGHWAYS);

function loadAcademicRing(): LonLat[] {
  const raw = JSON.parse(
    readFileSync(join(process.cwd(), "public/data/academic-area.geojson"), "utf8"),
  ) as {
    features: { geometry: { coordinates: LonLat[][] } }[];
  };
  return raw.features[0].geometry.coordinates[0];
}

function inArea(lon: number, lat: number, ring: LonLat[]): boolean {
  return pointInPolygon(lon, lat, [ring]);
}

function classify(tags: Record<string, string>): FeatureProps["kind"] {
  if (tags.highway === "steps") return "stairs";
  if (tags.highway === "elevator") return "elevator";
  if (tags.highway === "crossing") return "crossing";
  if (tags.entrance) return "entrance";
  if (tags.amenity === "bench") return "bench";
  if (tags.leisure === "picnic_table" || tags.amenity === "shelter") return "rest_area";
  if (tags.bridge === "yes" && (tags.highway === "footway" || tags.highway === "path")) {
    return "skywalk";
  }
  if (tags.ramp === "yes" || tags["ramp:wheelchair"] === "yes") return "ramp";
  if (tags.highway === "footway" && tags.incline) return "ramp";
  return "other";
}

function keepFeature(kind: FeatureProps["kind"], tags: Record<string, string>): boolean {
  if (kind !== "other") return true;
  return Boolean(
    tags.wheelchair || tags.handrail || tags.tactile_paving || tags.kerb || tags.check_date,
  );
}

function centroid(ids: number[], nodes: Map<number, OsmNode>): { lat: number; lon: number } | null {
  let lat = 0;
  let lon = 0;
  let n = 0;
  for (const id of ids) {
    const node = nodes.get(id);
    if (!node) continue;
    lat += node.lat;
    lon += node.lon;
    n += 1;
  }
  if (!n) return null;
  return { lat: lat / n, lon: lon / n };
}

function featureProps(
  osmId: string,
  kind: FeatureProps["kind"],
  tags: Record<string, string>,
  extra: { photo?: string; notes?: string; check_date?: string },
): Record<string, string> {
  // MapLibre only accepts primitive property values.
  return {
    osmId,
    kind,
    name: tags.name ?? "",
    check_date: extra.check_date ?? tags.check_date ?? "",
    notes: extra.notes ?? "",
    photo: extra.photo ?? "",
    tags: JSON.stringify(tags),
  };
}

function nearestNamed(
  lat: number,
  lon: number,
  places: Place[],
  maxM = 80,
): string | null {
  let best: string | null = null;
  let bestD = maxM;
  for (const p of places) {
    if (p.kind !== "building") continue;
    const d = haversineMeters(lat, lon, p.lat, p.lon);
    if (d < bestD) {
      bestD = d;
      best = p.name;
    }
  }
  return best;
}

function lineCoords(ids: number[], nodes: Map<number, OsmNode>): LonLat[] {
  const coords: LonLat[] = [];
  for (const id of ids) {
    const node = nodes.get(id);
    if (node) coords.push([node.lon, node.lat]);
  }
  return coords;
}

function main() {
  const osmPath = join(process.cwd(), "data/raw/iitk.osm.json");
  if (!existsSync(osmPath)) {
    throw new Error("Missing data/raw/iitk.osm.json — run npm run data:fetch first");
  }
  const osm = JSON.parse(readFileSync(osmPath, "utf8")) as OsmJson;
  const overrides: Overlay = existsSync(join(process.cwd(), "data/overrides.json"))
    ? JSON.parse(readFileSync(join(process.cwd(), "data/overrides.json"), "utf8"))
    : {};
  const ring = loadAcademicRing();

  const nodes = new Map<number, OsmNode>();
  const ways: OsmWay[] = [];
  for (const el of osm.elements) {
    if (el.type === "node") nodes.set(el.id, el as OsmNode);
    if (el.type === "way") ways.push(el as OsmWay);
  }

  const graphNodes: Record<string, GraphNode> = {};
  const graphEdges: GraphEdge[] = [];
  const seenEdge = new Set<string>();

  for (const way of ways) {
    const highway = way.tags?.highway;
    if (!highway || !ROUTABLE.has(highway)) continue;
    const ids = way.nodes;
    for (let i = 0; i < ids.length - 1; i++) {
      const a = nodes.get(ids[i]);
      const b = nodes.get(ids[i + 1]);
      if (!a || !b) continue;
      const aIn = inArea(a.lon, a.lat, ring);
      const bIn = inArea(b.lon, b.lat, ring);
      if (!aIn && !bIn) continue;
      const from = String(a.id);
      const to = String(b.id);
      const key = from < to ? `${from}|${to}` : `${to}|${from}`;
      if (seenEdge.has(key)) continue;
      seenEdge.add(key);
      graphNodes[from] ??= { lat: a.lat, lon: a.lon, tags: a.tags };
      graphNodes[to] ??= { lat: b.lat, lon: b.lon, tags: b.tags };
      graphEdges.push({
        from,
        to,
        lengthM: Math.max(0.5, haversineMeters(a.lat, a.lon, b.lat, b.lon)),
        tags: way.tags ?? {},
      });
    }
  }

  // Standalone elevator / crossing / entrance nodes that sit on the graph.
  for (const node of nodes.values()) {
    const tags = node.tags ?? {};
    if (tags.entrance || tags.highway === "elevator" || tags.highway === "crossing") {
      if (!inArea(node.lon, node.lat, ring)) continue;
      const id = String(node.id);
      if (graphNodes[id]) {
        graphNodes[id].tags = { ...graphNodes[id].tags, ...tags };
        if (tags.entrance) graphNodes[id].isEntrance = true;
      }
    }
  }

  const graph: RoutingGraph = { nodes: graphNodes, edges: graphEdges };

  type GjFeature = {
    type: "Feature";
    properties: Record<string, string>;
    geometry: { type: "Point" | "LineString"; coordinates: number[] | number[][] };
  };
  const features: GjFeature[] = [];

  for (const node of nodes.values()) {
    const tags = node.tags ?? {};
    if (!inArea(node.lon, node.lat, ring)) continue;
    const kind = classify(tags);
    if (!keepFeature(kind, tags)) continue;
    const osmId = `node/${node.id}`;
    const extra = overrides[osmId] ?? {};
    features.push({
      type: "Feature",
      properties: featureProps(osmId, kind, tags, extra),
      geometry: { type: "Point", coordinates: [node.lon, node.lat] },
    });
  }

  for (const way of ways) {
    const tags = way.tags ?? {};
    const coords = lineCoords(way.nodes, nodes);
    if (coords.length < 2) continue;
    const mid = coords[Math.floor(coords.length / 2)];
    if (!inArea(mid[0], mid[1], ring)) continue;
    const kind = classify(tags);
    if (!keepFeature(kind, tags) && kind === "other") continue;
    if (kind === "other") continue;
    const osmId = `way/${way.id}`;
    const extra = overrides[osmId] ?? {};
    features.push({
      type: "Feature",
      properties: featureProps(osmId, kind, tags, extra),
      geometry: { type: "LineString", coordinates: coords },
    });
  }

  const places: Place[] = [];
  const usedNames = new Set<string>();

  for (const way of ways) {
    const tags = way.tags ?? {};
    const name = tags.name;
    if (!name || !tags.building) continue;
    if (/^Hall\s*\d/i.test(name) || /^Hall\d/i.test(name)) continue;
    const c = centroid(way.nodes, nodes);
    if (!c || !inArea(c.lon, c.lat, ring)) continue;
    const key = name.toLowerCase();
    if (usedNames.has(key)) continue;
    usedNames.add(key);
    places.push({
      id: `way/${way.id}`,
      name,
      lat: c.lat,
      lon: c.lon,
      kind: "building",
      osmId: `way/${way.id}`,
    });
  }

  for (const node of nodes.values()) {
    const tags = node.tags ?? {};
    if (!inArea(node.lon, node.lat, ring)) continue;
    if (tags.entrance) {
      const nearest = nearestNamed(node.lat, node.lon, places);
      const name =
        tags.name ||
        (nearest
          ? `${nearest} ${tags.entrance === "main" ? "main entrance" : "entrance"}`
          : tags.entrance === "main"
            ? "Main entrance"
            : "Entrance");
      const id = `node/${node.id}`;
      places.push({
        id,
        name,
        lat: node.lat,
        lon: node.lon,
        kind: "entrance",
        osmId: id,
        nodeId: String(node.id),
      });
    } else if (tags.name && tags.amenity) {
      const key = tags.name.toLowerCase();
      if (usedNames.has(key)) continue;
      usedNames.add(key);
      const id = `node/${node.id}`;
      places.push({
        id,
        name: tags.name,
        lat: node.lat,
        lon: node.lon,
        kind: "landmark",
        osmId: id,
        nodeId: graphNodes[String(node.id)] ? String(node.id) : undefined,
      });
    }
  }

  places.sort((a, b) => a.name.localeCompare(b.name));

  mkdirSync(join(process.cwd(), "public/data"), { recursive: true });
  writeFileSync(join(process.cwd(), "data/graph.json"), JSON.stringify(graph));
  writeFileSync(
    join(process.cwd(), "public/data/features.geojson"),
    JSON.stringify({ type: "FeatureCollection", features }),
  );
  writeFileSync(join(process.cwd(), "public/data/places.json"), JSON.stringify(places, null, 2));

  console.log(
    `Graph: ${Object.keys(graph.nodes).length} nodes, ${graph.edges.length} edges`,
  );
  console.log(`Features: ${features.length}`);
  console.log(`Places: ${places.length}`);
}

main();
