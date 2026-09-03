/**
 * High-level routing: place → snapped node → path → GeoJSON + summary + directions.
 */
import { PROFILES, RESTRICT_ROUTING_TO_ACADEMIC_AREA, ROAD_HIGHWAYS } from "../../../data/config.js";
import { pointInGeometry } from "../geo/pointInPolygon.js";
import { shortestPath } from "./dijkstra.js";
import { snapPlace } from "./snap.js";
import { buildDirections } from "./directions.js";
import { classifyFeature } from "../features.js";

export class RouteError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

/** Count notable way kinds along a path. */
function summarise(graph, nodeIds, wayIds) {
  const seen = new Set();
  const counts = { stairs: 0, ramp: 0, skywalk: 0, elevator: 0, crossing: 0 };
  const surfaces = {};
  let roadM = 0;
  let footM = 0;
  wayIds.forEach((wayId, i) => {
    const tags = graph.wayTags(wayId);
    const len = graph.distanceBetween(nodeIds[i], nodeIds[i + 1]);
    if (ROAD_HIGHWAYS.has(tags.highway)) roadM += len;
    else footM += len;
    if (!seen.has(wayId)) {
      seen.add(wayId);
      const kind = classifyFeature(tags);
      if (kind && kind in counts) counts[kind] += 1;
    }
    surfaces[tags.surface ?? "unknown"] = (surfaces[tags.surface ?? "unknown"] ?? 0) + len;
  });
  // Crossings are usually nodes, not ways.
  for (let i = 1; i < nodeIds.length - 1; i++) {
    const t = graph.tagsOfNode(nodeIds[i]);
    if (t?.highway === "crossing") counts.crossing += 1;
    if (t?.highway === "elevator") counts.elevator += 1;
  }
  return { counts, surfaces, roadM, footM };
}

/**
 * @param {import('./graph.js').Graph} graph
 * @param {object} from  place object (see places.json) or {lon, lat, name}
 * @param {object} to
 * @param {string} profileId
 * @param {{ academicArea?: object }} [ctx]  academicArea = GeoJSON geometry
 */
export function computeRoute(graph, from, to, profileId, ctx = {}) {
  const profile = PROFILES.find((p) => p.id === profileId) ?? PROFILES[0];

  const warnings = [];
  if (ctx.academicArea) {
    const fromIn = pointInGeometry(from.lon, from.lat, ctx.academicArea);
    const toIn = pointInGeometry(to.lon, to.lat, ctx.academicArea);
    if (!fromIn || !toIn) {
      if (RESTRICT_ROUTING_TO_ACADEMIC_AREA) {
        throw new RouteError(
          "outside-area",
          "Detailed accessible routing is currently available inside the IITK Academic Area only.",
        );
      }
      warnings.push(
        "Part of this route is outside the Academic Area, where accessibility details have not been surveyed yet.",
      );
    }
  }

  const s = snapPlace(graph, from, profile.id);
  const t = snapPlace(graph, to, profile.id);
  if (!s) throw new RouteError("no-snap-from", `Could not find a path near "${from.name ?? "the start"}".`);
  if (!t) throw new RouteError("no-snap-to", `Could not find a path near "${to.name ?? "the destination"}".`);

  const path = shortestPath(graph, s.nodeId, t.nodeId, profile.id);
  if (!path) {
    if (profile.id === "wheelchair") {
      throw new RouteError("no-route", "No step-free route known yet between these points.");
    }
    throw new RouteError("no-route", "No walking route found between these points.");
  }

  const coords = path.nodeIds.map((id) => graph.coord(id));
  const line = { type: "Feature", properties: { profile: profile.id }, geometry: { type: "LineString", coordinates: coords } };

  // Dotted connectors from the actual place to where it meets the network.
  const connectors = [];
  if (s.snapDistance > 3) connectors.push({ type: "Feature", properties: { end: "from" }, geometry: { type: "LineString", coordinates: [s.anchor, coords[0]] } });
  if (t.snapDistance > 3) connectors.push({ type: "Feature", properties: { end: "to" }, geometry: { type: "LineString", coordinates: [coords[coords.length - 1], t.anchor] } });

  const summary = summarise(graph, path.nodeIds, path.wayIds);
  const totalM = path.lengthM + s.snapDistance + t.snapDistance;
  const seconds = totalM / profile.walkingSpeedMps + summary.counts.stairs * 20 + summary.counts.crossing * 10;

  if (s.snapDistance > 60) warnings.push(`"${from.name ?? "Start"}" is ${Math.round(s.snapDistance)} m from the nearest mapped path.`);
  if (t.snapDistance > 60) warnings.push(`"${to.name ?? "Destination"}" is ${Math.round(t.snapDistance)} m from the nearest mapped path.`);

  return {
    profile: profile.id,
    from,
    to,
    snap: { from: s, to: t },
    nodeIds: path.nodeIds,
    wayIds: path.wayIds,
    distanceM: totalM,
    durationS: seconds,
    cost: path.cost,
    visited: path.visited,
    counts: summary.counts,
    surfaces: summary.surfaces,
    roadM: summary.roadM,
    footM: summary.footM,
    line,
    connectors: { type: "FeatureCollection", features: connectors },
    directions: buildDirections(graph, path.nodeIds, path.wayIds, { from: from.name, to: to.name }),
    warnings,
  };
}

/**
 * Compute the selected profile's route plus, for comparison, the Normal route.
 * Lets the UI say "the shortest route uses 2 staircases; this one avoids them".
 */
export function computeRoutes(graph, from, to, profileId, ctx = {}) {
  const main = computeRoute(graph, from, to, profileId, ctx);
  let comparison = null;
  if (profileId !== "normal") {
    try {
      const normal = computeRoute(graph, from, to, "normal", ctx);
      const same = normal.nodeIds.length === main.nodeIds.length && normal.nodeIds.every((id, i) => id === main.nodeIds[i]);
      comparison = { ...normal, sameAsMain: same };
    } catch {
      comparison = null;
    }
  }
  return { main, comparison };
}
