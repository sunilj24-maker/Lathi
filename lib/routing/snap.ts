import { haversineMeters } from "@/lib/geo/haversine";
import type { Place, RoutingGraph } from "@/lib/types";

export type SnapQuery =
  | { kind: "place"; place: Place }
  | { kind: "lonlat"; lon: number; lat: number };

export function snapToGraph(
  graph: RoutingGraph,
  query: SnapQuery,
): string | null {
  if (query.kind === "place" && query.place.nodeId && graph.nodes[query.place.nodeId]) {
    return query.place.nodeId;
  }

  const lat = query.kind === "place" ? query.place.lat : query.lat;
  const lon = query.kind === "place" ? query.place.lon : query.lon;

  let bestId: string | null = null;
  let bestDist = Infinity;
  let bestEntranceId: string | null = null;
  let bestEntranceDist = Infinity;

  for (const [id, node] of Object.entries(graph.nodes)) {
    const d = haversineMeters(lat, lon, node.lat, node.lon);
    if (d < bestDist) {
      bestDist = d;
      bestId = id;
    }
    if (node.isEntrance && d < bestEntranceDist) {
      bestEntranceDist = d;
      bestEntranceId = id;
    }
  }

  // Prefer an entrance if it is reasonably close (within 40 m or 1.5× nearest node).
  if (bestEntranceId != null && bestEntranceDist <= Math.max(40, bestDist * 1.5)) {
    return bestEntranceId;
  }
  return bestId;
}
