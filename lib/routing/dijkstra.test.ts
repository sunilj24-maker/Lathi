import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { dijkstra } from "./dijkstra";
import type { RoutingGraph } from "@/lib/types";

const graph: RoutingGraph = {
  nodes: {
    a: { lat: 0, lon: 0 },
    b: { lat: 0, lon: 0.0001 },
    c: { lat: 0, lon: 0.0002 },
  },
  edges: [
    { from: "a", to: "b", lengthM: 10, tags: { highway: "footway" } },
    { from: "b", to: "c", lengthM: 10, tags: { highway: "steps" } },
  ],
};

describe("dijkstra", () => {
  it("finds the normal route over stairs", () => {
    const r = dijkstra(graph, "a", "c", "normal");
    assert.equal(r.ok, true);
    if (r.ok) assert.deepEqual(r.nodeIds, ["a", "b", "c"]);
  });

  it("returns no-route when wheelchair cannot use stairs", () => {
    const r = dijkstra(graph, "a", "c", "wheelchair");
    assert.equal(r.ok, false);
  });
});
