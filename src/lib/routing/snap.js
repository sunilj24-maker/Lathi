/**
 * Snap a place or an arbitrary map point onto the routing graph.
 *
 * Preference order for a building:
 *   1. an entrance node that is itself part of the graph
 *   2. the graph node nearest to any of its entrances
 *   3. the graph node nearest to the building centroid
 * For everything else: nearest graph node to the point.
 */
import { SNAP_MAX_METERS } from "../../../data/config.js";
import { haversineMeters } from "../geo/haversine.js";

/**
 * @param {import('./graph.js').Graph} graph
 * @param {{ lon: number, lat: number, nodeId?: string|null, entranceNodeIds?: string[], entrances?: Array<{id:string,lon:number,lat:number}> }} place
 * @param {string} [profileId]
 * @returns {{ nodeId: string, snapDistance: number, via: 'node'|'entrance'|'near-entrance'|'nearest', anchor: [number, number] } | null}
 */
export function snapPlace(graph, place, profileId = "normal") {
  if (place.nodeId && graph.has(place.nodeId)) {
    return { nodeId: place.nodeId, snapDistance: 0, via: "node", anchor: [place.lon, place.lat] };
  }

  const wheelchair = profileId === "wheelchair";
  const usableEntrance = (e) => !(wheelchair && e.wheelchair === "no");

  // 1. Entrance nodes already on the graph.
  const onGraph = (place.entranceNodeIds ?? []).filter((id) => graph.has(id));
  if (onGraph.length) {
    const entrances = place.entrances ?? [];
    const pick =
      onGraph.find((id) => {
        const e = entrances.find((x) => x.id === id);
        return e ? usableEntrance(e) && e.type === "main" : false;
      }) ?? onGraph[0];
    const e = entrances.find((x) => x.id === pick);
    return { nodeId: pick, snapDistance: 0, via: "entrance", anchor: e ? [e.lon, e.lat] : graph.coord(pick) };
  }

  // 2. Nearest graph node to any entrance.
  let best = null;
  for (const e of place.entrances ?? []) {
    if (!usableEntrance(e)) continue;
    const hit = graph.nearestNode(e.lon, e.lat, SNAP_MAX_METERS);
    if (hit && (!best || hit.distance < best.snapDistance)) {
      best = { nodeId: hit.nodeId, snapDistance: hit.distance, via: "near-entrance", anchor: [e.lon, e.lat] };
    }
  }
  if (best) return best;

  // 3. Nearest graph node to the point itself.
  const hit = graph.nearestNode(place.lon, place.lat, SNAP_MAX_METERS);
  if (!hit) return null;
  return { nodeId: hit.nodeId, snapDistance: hit.distance, via: "nearest", anchor: [place.lon, place.lat] };
}

/** Snap a raw map click. */
export function snapPoint(graph, lon, lat) {
  const hit = graph.nearestNode(lon, lat, SNAP_MAX_METERS);
  if (!hit) return null;
  return { nodeId: hit.nodeId, snapDistance: hit.distance, via: "nearest", anchor: [lon, lat] };
}

/** Straight-line distance between two places (for sanity messages). */
export function placeDistance(a, b) {
  return haversineMeters(a.lat, a.lon, b.lat, b.lon);
}
