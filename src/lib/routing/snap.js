/**
 * Snap a place or an arbitrary map point onto the (level-aware) routing graph.
 *
 * Preference order for a building / room / entrance:
 *   1. one of its own graph nodes (`snapNodes`: entrance / door nodes that lie on a path)
 *      â€” for the wheelchair profile, entrances tagged wheelchair=no are skipped
 *   2. the graph node nearest to any of its entrances, on the entrance's floor
 *   3. the graph node nearest to the place itself, on the place's floor (rooms)
 *      or on the ground floor (everything else), then on any floor
 */
import { SNAP_MAX_METERS } from "../../../data/config.js";
import { GROUND, splitKey } from "../levels.js";

/** Best single snap for a place (first candidate). */
export function snapPlace(graph, place, profileId = "normal") {
  return snapCandidates(graph, place, profileId, 1)[0] ?? null;
}

/**
 * All reasonable snap candidates for a place, best first. The router tries
 * them in order, so a building whose first entrance only opens onto a
 * staircase still gets a wheelchair route through its other door.
 */
export function snapCandidates(graph, place, profileId = "normal", limit = 6) {
  const wheelchair = profileId === "wheelchair";
  const usable = (e) => !(wheelchair && e.wheelchair === "no");
  const out = [];
  const seen = new Set();
  const push = (c) => {
    if (c && !seen.has(c.nodeId)) {
      seen.add(c.nodeId);
      out.push(c);
    }
  };

  if (place.nodeId && graph.has(place.nodeId)) {
    push({ nodeId: place.nodeId, snapDistance: 0, via: "node", anchor: [place.lon, place.lat], level: graph.levelOf(place.nodeId) });
  }
  const entrances = [...(place.entrances ?? [])].filter(usable).sort((a, b) => (b.type === "main") - (a.type === "main"));
  for (const e of entrances) {
    const keys = (e.keys ?? []).filter((k) => graph.has(k));
    // floor nodes first, connector nodes after
    keys.sort((a, b) => graph.isConnectorNode(a) - graph.isConnectorNode(b));
    const doorLevel = e.level != null && !String(e.level).includes(";") ? String(e.level) : null;
    for (const k of keys) push({ nodeId: k, snapDistance: 0, via: "entrance", anchor: [e.lon, e.lat], level: graph.isConnectorNode(k) && doorLevel ? doorLevel : graph.levelOf(k) });
  }
  const own = (place.snapNodes ?? []).filter((k) => graph.has(k)).sort((a, b) => graph.isConnectorNode(a) - graph.isConnectorNode(b));
  for (const k of own) push({ nodeId: k, snapDistance: 0, via: place.kind === "room" ? "door" : "entrance", anchor: [place.lon, place.lat], level: graph.levelOf(k) });

  for (const e of entrances) {
    const level = e.level != null && !String(e.level).includes(";") ? String(e.level) : GROUND;
    const hit = graph.nearestNode(e.lon, e.lat, { level, maxMeters: SNAP_MAX_METERS });
    if (hit) push({ nodeId: hit.nodeId, snapDistance: hit.distance, via: "near-entrance", anchor: [e.lon, e.lat], level: graph.levelOf(hit.nodeId) });
  }
  const wantLevel = place.level != null && !String(place.level).includes(";") ? String(place.level) : GROUND;
  const hitLevel = graph.nearestNode(place.lon, place.lat, { level: wantLevel, maxMeters: place.kind === "room" ? 60 : SNAP_MAX_METERS });
  if (hitLevel) push({ nodeId: hitLevel.nodeId, snapDistance: hitLevel.distance, via: "nearest", anchor: [place.lon, place.lat], level: graph.levelOf(hitLevel.nodeId) });
  const hitAny = graph.nearestNode(place.lon, place.lat, { maxMeters: SNAP_MAX_METERS, filter: (k) => !graph.isConnectorNode(k) });
  if (hitAny) push({ nodeId: hitAny.nodeId, snapDistance: hitAny.distance, via: "nearest", anchor: [place.lon, place.lat], level: graph.levelOf(hitAny.nodeId) });

  return out.slice(0, limit);
}

/** Snap a raw map click, preferring the floor the user is looking at. */
export function snapPoint(graph, lon, lat, level = GROUND) {
  const hit =
    graph.nearestNode(lon, lat, { level, maxMeters: SNAP_MAX_METERS }) ??
    graph.nearestNode(lon, lat, { maxMeters: SNAP_MAX_METERS, filter: (k) => !graph.isConnectorNode(k) });
  if (!hit) return null;
  return { nodeId: hit.nodeId, snapDistance: hit.distance, via: "nearest", anchor: [lon, lat], level: graph.levelOf(hit.nodeId) };
}

export { splitKey };
