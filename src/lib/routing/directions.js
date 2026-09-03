/**
 * Turn the node/way sequence of a route into Google-Maps-style steps:
 * "Head north on Hall 3 Road", "Turn left onto footpath", "Take the stairs", "Arrive".
 */
import { bearingDegrees } from "../geo/haversine.js";

const COMPASS = ["north", "north-east", "east", "south-east", "south", "south-west", "west", "north-west"];

export function compassName(bearing) {
  return COMPASS[Math.round(((bearing % 360) + 360) % 360 / 45) % 8];
}

/** Display name for a way: name, else a description of the way type. */
export function wayLabel(tags = {}) {
  if (tags.name) return tags.name;
  const hw = tags.highway;
  if (hw === "steps") return "stairs";
  if (hw === "elevator") return "elevator";
  if (hw === "corridor") return "indoor corridor";
  if (hw === "footway" && tags.bridge) return "skywalk";
  if (hw === "footway" && tags.footway === "sidewalk") return "footpath";
  if (hw === "footway" && tags.footway === "crossing") return "crossing";
  if (hw === "footway" || hw === "path" || hw === "pedestrian") return "footpath";
  if (hw === "cycleway") return "cycle track";
  if (hw === "service") return tags.service === "parking_aisle" ? "parking area" : "service lane";
  if (hw === "living_street") return "lane";
  if (hw === "track") return "track";
  if (hw) return "road";
  return "path";
}

/** Icon key + special verb for notable way kinds. */
function wayKind(tags = {}) {
  if (tags.highway === "steps") return "stairs";
  if (tags.highway === "elevator") return "elevator";
  if (tags.bridge === "yes" && (tags.highway === "footway" || tags.highway === "path")) return "skywalk";
  if (tags.ramp === "yes" || tags["ramp:wheelchair"] === "yes" || (tags.incline && tags.highway === "footway")) return "ramp";
  if (tags.footway === "crossing") return "crossing";
  if (tags.highway === "corridor") return "indoor";
  return "walk";
}

function turnWord(delta) {
  // delta in (-180, 180]: positive = clockwise = right
  const a = Math.abs(delta);
  if (a < 25) return "straight";
  if (a > 150) return "uturn";
  const side = delta > 0 ? "right" : "left";
  if (a < 60) return `slight-${side}`;
  if (a > 120) return `sharp-${side}`;
  return side;
}

function verbFor(turn, kind, label) {
  if (kind === "stairs") return turn === "straight" ? `Take the ${label}` : `Turn ${turn.replace("-", " ")} and take the ${label}`;
  if (kind === "elevator") return `Take the ${label}`;
  if (kind === "ramp") return turn === "straight" ? `Continue up the ramp${label !== "footpath" ? ` (${label})` : ""}` : `Turn ${turn.replace("-", " ")} onto the ramp`;
  if (kind === "skywalk") return turn === "straight" ? `Continue onto the ${label}` : `Turn ${turn.replace("-", " ")} onto the ${label}`;
  if (turn === "straight") return `Continue onto ${label}`;
  if (turn === "uturn") return `Make a U-turn onto ${label}`;
  return `Turn ${turn.replace("-", " ")} onto ${label}`;
}

/**
 * @param {import('./graph.js').Graph} graph
 * @param {string[]} nodeIds
 * @param {string[]} wayIds   wayIds[i] joins nodeIds[i] and nodeIds[i+1]
 * @param {{ from?: string, to?: string }} [names]  human names of the endpoints
 */
export function buildDirections(graph, nodeIds, wayIds, names = {}) {
  if (nodeIds.length < 2) {
    return [{ type: "arrive", text: `You are already at ${names.to ?? "your destination"}`, distance: 0, coord: graph.coord(nodeIds[0]) }];
  }

  // 1. Per-edge records.
  const edges = wayIds.map((wayId, i) => {
    const a = graph.coord(nodeIds[i]);
    const b = graph.coord(nodeIds[i + 1]);
    const tags = graph.wayTags(wayId);
    return {
      from: nodeIds[i],
      to: nodeIds[i + 1],
      a,
      b,
      length: graph.distanceBetween(nodeIds[i], nodeIds[i + 1]),
      bearing: bearingDegrees(a[1], a[0], b[1], b[0]),
      label: wayLabel(tags),
      kind: wayKind(tags),
      tags,
    };
  });

  // 2. Merge consecutive edges with the same label + kind into legs.
  const legs = [];
  for (const e of edges) {
    const last = legs[legs.length - 1];
    if (last && last.label === e.label && last.kind === e.kind) {
      last.length += e.length;
      last.edges.push(e);
    } else {
      legs.push({ label: e.label, kind: e.kind, length: e.length, edges: [e], tags: e.tags });
    }
  }

  // 3. Emit steps.
  const steps = [];
  const first = legs[0];
  steps.push({
    type: "depart",
    kind: first.kind,
    text: `Head ${compassName(first.edges[0].bearing)} on ${first.label}`,
    distance: first.length,
    coord: first.edges[0].a,
    tags: first.tags,
  });

  for (let i = 1; i < legs.length; i++) {
    const prevLeg = legs[i - 1];
    const leg = legs[i];
    const inB = prevLeg.edges[prevLeg.edges.length - 1].bearing;
    const outB = leg.edges[0].bearing;
    let delta = ((outB - inB + 540) % 360) - 180;
    const turn = turnWord(delta);
    steps.push({
      type: turn === "straight" ? "continue" : "turn",
      turn,
      kind: leg.kind,
      text: verbFor(turn, leg.kind, leg.label),
      distance: leg.length,
      coord: leg.edges[0].a,
      tags: leg.tags,
    });
  }

  const last = legs[legs.length - 1];
  steps.push({
    type: "arrive",
    kind: "arrive",
    text: `Arrive at ${names.to ?? "your destination"}`,
    distance: 0,
    coord: last.edges[last.edges.length - 1].b,
  });
  return steps;
}
