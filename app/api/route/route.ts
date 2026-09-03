import { readFileSync } from "node:fs";
import { join } from "node:path";
import { NextResponse } from "next/server";
import { PROFILES, type ProfileId } from "@/data/config";
import { pointInPolygon, type LonLat } from "@/lib/geo/point-in-polygon";
import { dijkstra } from "@/lib/routing/dijkstra";
import { loadGraph } from "@/lib/routing/graph";
import { snapToGraph } from "@/lib/routing/snap";
import type { Place } from "@/lib/types";

type Body = {
  profile?: ProfileId;
  fromPlaceId?: string;
  toPlaceId?: string;
  from?: { lat: number; lon: number };
  to?: { lat: number; lon: number };
};

let placesCache: Place[] | null = null;
let ringCache: LonLat[] | null = null;

function loadPlaces(): Place[] {
  if (!placesCache) {
    placesCache = JSON.parse(
      readFileSync(join(process.cwd(), "public/data/places.json"), "utf8"),
    ) as Place[];
  }
  return placesCache;
}

function loadRing(): LonLat[] {
  if (!ringCache) {
    const gj = JSON.parse(
      readFileSync(join(process.cwd(), "public/data/academic-area.geojson"), "utf8"),
    ) as { features: { geometry: { coordinates: LonLat[][] } }[] };
    ringCache = gj.features[0].geometry.coordinates[0];
  }
  return ringCache;
}

function resolveEndpoint(
  places: Place[],
  placeId: string | undefined,
  coord: { lat: number; lon: number } | undefined,
): { lat: number; lon: number; place?: Place } | null {
  if (placeId) {
    const place = places.find((p) => p.id === placeId);
    if (!place) return null;
    return { lat: place.lat, lon: place.lon, place };
  }
  if (coord && Number.isFinite(coord.lat) && Number.isFinite(coord.lon)) {
    return coord;
  }
  return null;
}

export async function POST(request: Request) {
  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ type: "error", message: "Invalid JSON" }, { status: 400 });
  }

  const profile: ProfileId = body.profile === "wheelchair" ? "wheelchair" : "normal";
  if (!PROFILES.some((p) => p.id === profile)) {
    return NextResponse.json({ type: "error", message: "Unknown profile" }, { status: 400 });
  }

  const places = loadPlaces();
  const from = resolveEndpoint(places, body.fromPlaceId, body.from);
  const to = resolveEndpoint(places, body.toPlaceId, body.to);
  if (!from || !to) {
    return NextResponse.json(
      { type: "error", message: "From and To are required" },
      { status: 400 },
    );
  }

  const ring = loadRing();
  const fromIn = pointInPolygon(from.lon, from.lat, [ring]);
  const toIn = pointInPolygon(to.lon, to.lat, [ring]);
  if (!fromIn || !toIn) {
    return NextResponse.json({
      type: "outside",
      message:
        "Detailed accessible routing is currently available inside the IITK Academic Area only.",
    });
  }

  const graph = loadGraph();
  const start = snapToGraph(
    graph,
    from.place ? { kind: "place", place: from.place } : { kind: "lonlat", ...from },
  );
  const goal = snapToGraph(
    graph,
    to.place ? { kind: "place", place: to.place } : { kind: "lonlat", ...to },
  );
  if (!start || !goal) {
    return NextResponse.json({
      type: "no-route",
      message: "Could not snap those points onto the walking network yet.",
    });
  }

  const routed = dijkstra(graph, start, goal, profile);
  if (!routed.ok) {
    const message =
      profile === "wheelchair"
        ? "No step-free route known yet between these points."
        : "No walking route known yet between these points.";
    return NextResponse.json({ type: "no-route", message });
  }

  const coordinates = routed.nodeIds.map((id) => {
    const n = graph.nodes[id];
    return [n.lon, n.lat];
  });

  return NextResponse.json({
    type: "ok",
    profile,
    geometry: { type: "LineString", coordinates },
    summary: {
      distanceM: Math.round(routed.lengthM),
      rampsUsed: routed.rampsUsed,
      stairsUsed: routed.stairsUsed,
      stairsAvoided: profile === "wheelchair" ? true : routed.stairsUsed === 0,
    },
  });
}
