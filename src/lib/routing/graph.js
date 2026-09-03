/**
 * In-memory routing graph built from public/data/graph.json.
 *
 * graph.json shape (produced by scripts/build-data.mjs):
 *   nodes:    { [nodeId]: [lon, lat] }
 *   nodeTags: { [nodeId]: { ...tags } }      only nodes with routing-relevant tags
 *   ways:     { [wayId]: { ...tags } }
 *   edges:    [ [fromId, toId, lengthM, wayId], ... ]   undirected
 */
import { haversineMeters } from "../geo/haversine.js";

export class Graph {
  constructor(json) {
    this.nodes = json.nodes;
    this.nodeTags = json.nodeTags ?? {};
    this.ways = json.ways;
    /** @type {Map<string, Array<{to: string, length: number, wayId: string}>>} */
    this.adjacency = new Map();
    this.edgeCount = 0;
    for (const [a, b, length, wayId] of json.edges) {
      this.#link(String(a), String(b), length, String(wayId));
      this.#link(String(b), String(a), length, String(wayId));
      this.edgeCount += 1;
    }
    this.nodeIds = Object.keys(this.nodes);
  }

  #link(from, to, length, wayId) {
    let list = this.adjacency.get(from);
    if (!list) {
      list = [];
      this.adjacency.set(from, list);
    }
    list.push({ to, length, wayId });
  }

  has(nodeId) {
    return nodeId in this.nodes;
  }

  /** [lon, lat] of a node. */
  coord(nodeId) {
    return this.nodes[nodeId];
  }

  neighbours(nodeId) {
    return this.adjacency.get(nodeId) ?? [];
  }

  wayTags(wayId) {
    return this.ways[wayId] ?? {};
  }

  tagsOfNode(nodeId) {
    return this.nodeTags[nodeId] ?? null;
  }

  distanceBetween(aId, bId) {
    const a = this.nodes[aId];
    const b = this.nodes[bId];
    return haversineMeters(a[1], a[0], b[1], b[0]);
  }

  /**
   * Nearest graph node to a lon/lat. Linear scan: the graph is a few thousand
   * nodes, so this takes well under a millisecond.
   * @param {(nodeId: string) => boolean} [filter]
   */
  nearestNode(lon, lat, maxMeters = Infinity, filter) {
    let best = null;
    let bestD = maxMeters;
    for (const id of this.nodeIds) {
      if (filter && !filter(id)) continue;
      const [nlon, nlat] = this.nodes[id];
      // Cheap pre-filter on a degree box before the trig call.
      if (Math.abs(nlat - lat) > 0.01 || Math.abs(nlon - lon) > 0.01) continue;
      const d = haversineMeters(lat, lon, nlat, nlon);
      if (d < bestD) {
        bestD = d;
        best = id;
      }
    }
    return best ? { nodeId: best, distance: bestD } : null;
  }
}

let cached = null;

/** Fetch + build the graph once per page load. */
export async function loadGraph(url = "/data/graph.json") {
  if (cached) return cached;
  cached = fetch(url)
    .then((r) => {
      if (!r.ok) throw new Error(`Failed to load graph (${r.status})`);
      return r.json();
    })
    .then((json) => new Graph(json));
  return cached;
}
