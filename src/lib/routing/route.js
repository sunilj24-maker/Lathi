/**
 * High-level routing: place → snapped node → path → GeoJSON + summary + directions.
 */
import { PROFILES, RESTRICT_ROUTING_TO_ACADEMIC_AREA, ROAD_HIGHWAYS } from "../../../data/config.js";
import { pointInGeometry } from "../geo/pointInPolygon.js";
import { haversineMeters } from "../geo/haversine.js";
import { shortestPath } from "./dijkstra.js";
import { lightingOf } from "./profiles.js";
import { snapTiers } from "./snap.js";
import { buildDirections, wayKind, wayLabel } from "./directions.js";
import { levelLabel } from "../levels.js";

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
      const kind = wayKind(tags);
      if (kind in counts) counts[kind] += 1;
    }
    if (len > 0) surfaces[tags.surface ?? "unknown"] = (surfaces[tags.surface ?? "unknown"] ?? 0) + len;
  });
  // Crossings are usually nodes, not ways. (Lifts are counted via their synthetic ways above.)
  for (let i = 1; i < nodeIds.length - 1; i++) {
    const t = graph.tagsOfNode(nodeIds[i]);
    if (t?.highway === "crossing") counts.crossing += 1;
  }
  return { counts, surfaces, roadM, footM };
}

/**
 * Consecutive dim / dark stretches along a path, each with a length, a label
 * and the nearest named building, plus their geometry for the map.
 */
function unlitSections(graph, nodeIds, wayIds, places) {
  const sections = [];
  let cur = null;
  wayIds.forEach((wayId, i) => {
    const tags = graph.wayTags(wayId);
    const lighting = lightingOf(tags);
    const len = graph.distanceBetween(nodeIds[i], nodeIds[i + 1]);
    if (lighting === "lit") {
      cur = null;
      return;
    }
    if (!cur || cur.lighting !== lighting) {
      cur = { lighting, lengthM: 0, label: wayLabel(tags), coords: [graph.coord(nodeIds[i])], level: graph.levelOf(nodeIds[i]) };
      sections.push(cur);
    }
    cur.lengthM += len;
    cur.coords.push(graph.coord(nodeIds[i + 1]));
  });
  const buildings = (places ?? []).filter((p) => p.kind === "building");
  for (const s of sections) {
    s.coord = s.coords[Math.floor(s.coords.length / 2)];
    let best = null;
    let bestD = 120;
    for (const b of buildings) {
      const d = haversineMeters(s.coord[1], s.coord[0], b.lat, b.lon);
      if (d < bestD) {
        bestD = d;
        best = b.name;
      }
    }
    s.near = best;
  }
  const geojson = {
    type: "FeatureCollection",
    features: sections.map((s) => ({ type: "Feature", properties: { lighting: s.lighting }, geometry: { type: "LineString", coordinates: s.coords } })),
  };
  return { sections: sections.map(({ coords, ...rest }) => rest), geojson };
}

/**
 * @param {import('./graph.js').Graph} graph
 * @param {object} from  place object (see places.json) or {lon, lat, name}
 * @param {object} to
 * @param {string} profileId
 * @param {{ academicArea?: object, night?: boolean, places?: object[] }} [ctx]
 *   academicArea = GeoJSON geometry; night = avoid dim/dark ways; places = for naming dark stretches
 */
export function computeRoute(graph, from, to, profileId, ctx = {}) {
  const profile = PROFILES.find((p) => p.id === profileId) ?? PROFILES[0];
  const night = Boolean(ctx.night);

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

  const fromTiers = snapTiers(graph, from, profile.id);
  const toTiers = snapTiers(graph, to, profile.id);
  if (!fromTiers.length) throw new RouteError("no-snap-from", `Could not find a path near "${from.name ?? "the start"}".`);
  if (!toTiers.length) throw new RouteError("no-snap-to", `Could not find a path near "${to.name ?? "the destination"}".`);

  // Tier by tier: a route must end at a real door whenever any door is
  // reachable for this profile; only if no door works do we fall back to the
  // nearest path. Within a tier pair, the cheapest legal path wins.
  let s = fromTiers[0][0];
  let t = toTiers[0][0];
  let path = null;
  search: for (const tt of toTiers) {
    for (const ft of fromTiers) {
      let best = null;
      for (const fc of ft) {
        for (const tc of tt) {
          const p = shortestPath(graph, fc.nodeId, tc.nodeId, profile.id, { night });
          if (!p) continue;
          const total = p.cost + fc.snapDistance + tc.snapDistance;
          if (!best || total < best.total) best = { p, fc, tc, total };
        }
      }
      if (best) {
        path = best.p;
        s = best.fc;
        t = best.tc;
        break search;
      }
    }
  }
  if (!path) {
    if (profile.id === "wheelchair") {
      const walk = shortestPath(graph, s.nodeId, t.nodeId, "normal");
      if (walk) {
        const usesStairs = walk.wayIds.some((w) => graph.wayTags(w).highway === "steps");
        throw new RouteError(
          "no-route",
          usesStairs
            ? "No step-free route known yet between these points: every mapped connection uses stairs, and no ramp or lift is mapped."
            : "No wheelchair-accessible route known yet between these points.",
        );
      }
      throw new RouteError("no-route", "No step-free route known yet between these points.");
    }
    throw new RouteError(
      "no-route",
      s.level !== t.level
        ? `No walking route found: the start (${levelLabel(s.level)}) and destination (${levelLabel(t.level)}) are on different floors and no stairs, ramp or lift connects them in the map yet.`
        : "No walking route found between these points — the paths may not be connected in OpenStreetMap yet.",
    );
  }

  const coords = path.nodeIds.map((id) => graph.coord(id));
  const line = { type: "Feature", properties: { profile: profile.id }, geometry: { type: "LineString", coordinates: coords } };

  // Per-floor segments so the map can dim the parts on other floors.
  const segments = [];
  let seg = null;
  for (let i = 0; i < path.nodeIds.length - 1; i++) {
    const a = path.nodeIds[i];
    const b = path.nodeIds[i + 1];
    const la = graph.levelOf(a);
    const lb = graph.levelOf(b);
    const tags = graph.wayTags(path.wayIds[i]);
    const kind = wayKind(tags);
    const level = la.includes(";") ? la : lb.includes(";") ? lb : la === lb ? la : `${la};${lb}`;
    const isConnector = level.includes(";") || kind === "elevator";
    if (!seg || seg.properties.level !== level || seg.properties.connector !== isConnector) {
      seg = { type: "Feature", properties: { profile: profile.id, level, connector: isConnector, kind }, geometry: { type: "LineString", coordinates: [graph.coord(a)] } };
      segments.push(seg);
    }
    seg.geometry.coordinates.push(graph.coord(b));
  }
  const levelsUsed = [...new Set(path.nodeIds.map((k) => graph.levelOf(k)).filter((l) => !l.includes(";")))];

  // Dotted connectors from the actual place to where it meets the network.
  const connectors = [];
  if (s.snapDistance > 3) connectors.push({ type: "Feature", properties: { end: "from" }, geometry: { type: "LineString", coordinates: [s.anchor, coords[0]] } });
  if (t.snapDistance > 3) connectors.push({ type: "Feature", properties: { end: "to" }, geometry: { type: "LineString", coordinates: [coords[coords.length - 1], t.anchor] } });

  const summary = summarise(graph, path.nodeIds, path.wayIds);
  const totalM = path.lengthM + s.snapDistance + t.snapDistance;
  const seconds = totalM / profile.walkingSpeedMps + summary.counts.stairs * 20 + summary.counts.crossing * 10;

  if (s.snapDistance > 60) warnings.push(`"${from.name ?? "Start"}" is ${Math.round(s.snapDistance)} m from the nearest mapped path.`);
  if (t.snapDistance > 60) warnings.push(`"${to.name ?? "Destination"}" is ${Math.round(t.snapDistance)} m from the nearest mapped path.`);

  const unlit = unlitSections(graph, path.nodeIds, path.wayIds, ctx.places);
  const lighting = {
    sections: unlit.sections,
    dimM: unlit.sections.filter((s) => s.lighting === "dim").reduce((a, s) => a + s.lengthM, 0),
    darkM: unlit.sections.filter((s) => s.lighting === "dark").reduce((a, s) => a + s.lengthM, 0),
  };

  const directions = buildDirections(graph, path.nodeIds, path.wayIds, { from: from.name, to: to.name, startLevel: s.level, endLevel: t.level });
  const levelChanges = directions.filter((d) => d.level != null && d.levelAfter != null && d.level !== d.levelAfter).length;

  // Where the endpoints actually joined the network (debug overlay for mappers).
  const snapPoints = {
    type: "FeatureCollection",
    features: [
      { type: "Feature", properties: { end: "from", via: s.via, level: s.level }, geometry: { type: "Point", coordinates: coords[0] } },
      { type: "Feature", properties: { end: "to", via: t.via, level: t.level }, geometry: { type: "Point", coordinates: coords[coords.length - 1] } },
    ],
  };

  return {
    profile: profile.id,
    night,
    lighting,
    unlit: unlit.geojson,
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
    levels: levelsUsed,
    levelChanges,
    line,
    segments: { type: "FeatureCollection", features: segments },
    connectors: { type: "FeatureCollection", features: connectors },
    snapPoints,
    directions,
    warnings,
  };
}

/**
 * Rank candidate destinations by real walking distance from `from`.
 * Only the `limit` closest as the crow flies are routed, to keep it fast.
 * @returns {Array<{ item: object, distanceM: number }>} reachable items, nearest first
 */
export function rankByWalking(graph, from, items, profileId, ctx = {}, limit = 6) {
  const crow = (p) => haversineMeters(from.lat, from.lon, p.lat, p.lon);
  const candidates = [...items].sort((a, b) => crow(a) - crow(b)).slice(0, limit);
  const ranked = [];
  for (const item of candidates) {
    try {
      ranked.push({ item, distanceM: computeRoute(graph, from, item, profileId, ctx).distanceM });
    } catch {
      // unreachable for this profile: leave it out
    }
  }
  return ranked.sort((a, b) => a.distanceM - b.distanceM);
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
  // Night: how much dim/dark walking the night route saves over the daytime one.
  let nightComparison = null;
  if (main.night) {
    try {
      const day = computeRoute(graph, from, to, profileId, { ...ctx, night: false });
      nightComparison = {
        avoidedM: Math.max(0, day.lighting.dimM + day.lighting.darkM - (main.lighting.dimM + main.lighting.darkM)),
        extraM: Math.max(0, main.distanceM - day.distanceM),
      };
    } catch {
      nightComparison = null;
    }
  }
  return { main, comparison, nightComparison };
}
