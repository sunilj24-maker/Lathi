import { test } from "node:test";
import assert from "node:assert/strict";
import { Graph } from "../src/lib/routing/graph.js";
import { shortestPath } from "../src/lib/routing/dijkstra.js";
import { computeRoutes } from "../src/lib/routing/route.js";
import { lightingOf } from "../src/lib/routing/profiles.js";

test("lighting: untagged is lit, lit:perceived=poor is dim, lit=no is dark", () => {
  assert.equal(lightingOf({ highway: "footway" }), "lit");
  assert.equal(lightingOf({ lit: "yes" }), "lit");
  assert.equal(lightingOf({ lit: "yes", "lit:perceived": "poor" }), "dim");
  assert.equal(lightingOf({ lit: "no" }), "dark");
  assert.equal(lightingOf({ lit: "yes", "lit:perceived": "dark" }), "dark");
});

/**
 *   A ── dim shortcut (100 m) ── B
 *   └──── lit detour (300 m) ────┘
 */
function litGraph({ detour = true } = {}) {
  return new Graph({
    nodes: { A: [80.23, 26.51], B: [80.231, 26.51], C: [80.2305, 26.509] },
    nodeTags: {},
    ways: {
      dim: { highway: "footway", name: "Dim Lane", lit: "yes", "lit:perceived": "poor" },
      lit: { highway: "footway", name: "Bright Walk" },
    },
    edges: [["A", "B", 100, "dim"], ...(detour ? [["A", "C", 150, "lit"], ["C", "B", 150, "lit"]] : [])],
  });
}

test("day takes the dim shortcut; night takes the lit detour", () => {
  const g = litGraph();
  assert.deepEqual(shortestPath(g, "A", "B", "normal").nodeIds, ["A", "B"]);
  assert.deepEqual(shortestPath(g, "A", "B", "normal", { night: true }).nodeIds, ["A", "C", "B"]);
});

test("night with no lit alternative still routes and reports the dim stretch", () => {
  const g = litGraph({ detour: false });
  const from = { name: "A", nodeId: "A", lon: 80.23, lat: 26.51 };
  const to = { name: "B", nodeId: "B", lon: 80.231, lat: 26.51 };
  const { main, nightComparison } = computeRoutes(g, from, to, "normal", { night: true });
  assert.deepEqual(main.nodeIds, ["A", "B"]);
  assert.equal(main.lighting.sections.length, 1);
  assert.equal(main.lighting.sections[0].lighting, "dim");
  assert.equal(main.lighting.sections[0].label, "Dim Lane");
  assert.equal(nightComparison.avoidedM, 0);
});
