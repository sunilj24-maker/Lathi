/**
 * Integration tests against the real built data in public/data.
 * They check that the campus graph is connected enough to route between the
 * showcase buildings and that the profile rules behave on real OSM tags.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Graph } from "../src/lib/routing/graph.js";
import { computeRoutes } from "../src/lib/routing/route.js";

const graph = new Graph(JSON.parse(readFileSync("public/data/graph.json", "utf8")));
const places = JSON.parse(readFileSync("public/data/places.json", "utf8"));
const academic = JSON.parse(readFileSync("public/data/academic-area.geojson", "utf8")).features[0].geometry;

const place = (name) => {
  const p = places.find((x) => x.name === name);
  assert.ok(p, `place "${name}" missing from places.json`);
  return p;
};

const SHOWCASE = [
  ["Lecture Hall 1", "Rajeev Motwani Building"],
  ["New Lecture Hall Complex", "Computer Centre"],
  ["Faculty Building", "Main Auditorium"],
  ["Hall 3 Mess", "Lecture Hall 7"],
  ["Health Centre", "Faculty Building"],
];

test("graph is non-trivial", () => {
  assert.ok(graph.nodeIds.length > 3000, `only ${graph.nodeIds.length} nodes`);
  assert.ok(graph.edgeCount > 3000);
});

for (const [a, b] of SHOWCASE) {
  test(`route ${a} → ${b} exists for both profiles and is plausible`, () => {
    const from = place(a);
    const to = place(b);
    for (const profile of ["normal", "wheelchair"]) {
      const { main } = computeRoutes(graph, from, to, profile, { academicArea: academic });
      assert.ok(main.nodeIds.length >= 2);
      assert.ok(main.distanceM > 50 && main.distanceM < 5000, `${profile}: ${main.distanceM} m`);
      assert.equal(main.directions.at(-1).type, "arrive");
      if (profile === "wheelchair") assert.equal(main.counts.stairs, 0, "wheelchair route used stairs");
    }
  });
}

test("largest connected component covers most of the graph", () => {
  const seen = new Set();
  let largest = 0;
  for (const start of graph.nodeIds) {
    if (seen.has(start)) continue;
    const stack = [start];
    seen.add(start);
    let size = 0;
    while (stack.length) {
      const n = stack.pop();
      size += 1;
      for (const e of graph.neighbours(n)) {
        if (!seen.has(e.to)) {
          seen.add(e.to);
          stack.push(e.to);
        }
      }
    }
    largest = Math.max(largest, size);
  }
  const share = largest / graph.nodeIds.length;
  assert.ok(share > 0.85, `largest component only ${(share * 100).toFixed(1)} % of nodes`);
});

test("Lecture Hall 16-20 and NLHC are present with correct levels", () => {
  const p16 = places.find((p) => p.name.includes("Lecture Hall 16"));
  const p17 = places.find((p) => p.name.includes("Lecture Hall 17"));
  const p18 = places.find((p) => p.name.includes("Lecture Hall 18"));
  const p19 = places.find((p) => p.name.includes("Lecture Hall 19"));
  const p20 = places.find((p) => p.name.includes("Lecture Hall 20"));
  const nlhc = places.find((p) => p.name === "New Lecture Hall Complex");

  assert.ok(p16, "Lecture Hall 16 missing from places.json");
  assert.ok(p17, "Lecture Hall 17 missing from places.json");
  assert.ok(p18, "Lecture Hall 18 missing from places.json");
  assert.ok(p19, "Lecture Hall 19 missing from places.json");
  assert.ok(p20, "Lecture Hall 20 missing from places.json");
  assert.ok(nlhc, "New Lecture Hall Complex missing from places.json");

  assert.equal(p18.level, "0", "LH 18 must be level 0 (ground floor)");
  assert.equal(p19.level, "0", "LH 19 must be level 0 (ground floor)");
  assert.equal(p20.level, "1", "LH 20 must be level 1 (first floor)");
  assert.ok(nlhc.aliases.includes("NLHC"), "NLHC must have alias NLHC");
  assert.ok(p20.aliases.includes("L 20"), "LH 20 must have alias 'L 20'");
  assert.ok(p20.snapNodes.some((k) => k.startsWith("14152648919")), "LH 20 snapNodes must point to the lift");

  // Route to LH 20 ends at the lift close to it
  const from = place("Lecture Hall 1");
  const { main: normalRoute } = computeRoutes(graph, from, p20, "normal", { academicArea: academic });
  const { main: wcRoute } = computeRoutes(graph, from, p20, "wheelchair", { academicArea: academic });
  assert.ok(normalRoute.nodeIds.at(-1).startsWith("14152648919"), "Normal route to LH 20 must end at the lift");
  assert.ok(wcRoute.nodeIds.at(-1).startsWith("14152648919"), "Wheelchair route to LH 20 must end at the lift");
});

