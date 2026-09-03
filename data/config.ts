/** IIT Kanpur campus box and Academic Area defaults. */

export type BBox = {
  south: number;
  west: number;
  north: number;
  east: number;
};

/** Approximate campus box from the project plan. Verify in overpass-turbo. */
export const CAMPUS_BBOX: BBox = {
  south: 26.495,
  west: 80.215,
  north: 26.53,
  east: 80.25,
};

/** Opening view — Academic Area, not the whole campus. */
export const ACADEMIC_AREA_CENTER = {
  lat: 26.5119,
  lon: 80.2324,
};

export const INITIAL_ZOOM = 16.5;
export const MIN_ZOOM = 14;
export const MAX_ZOOM = 20;

export const OPENFREEMAP_STYLE =
  "https://tiles.openfreemap.org/styles/liberty";

/** Raster fallback — no vector-tile/WebGL extras, OSM attribution required. */
export const OSM_RASTER_STYLE = {
  version: 8 as const,
  sources: {
    osm: {
      type: "raster" as const,
      tiles: [
        "https://a.tile.openstreetmap.org/{z}/{x}/{y}.png",
        "https://b.tile.openstreetmap.org/{z}/{x}/{y}.png",
        "https://c.tile.openstreetmap.org/{z}/{x}/{y}.png",
      ],
      tileSize: 256,
      attribution: "© OpenStreetMap contributors",
      maxzoom: 19,
    },
  },
  layers: [{ id: "osm-raster", type: "raster" as const, source: "osm" }],
};

export const ROUTABLE_HIGHWAYS = [
  "footway",
  "path",
  "pedestrian",
  "steps",
  "corridor",
  "living_street",
  "residential",
  "service",
  "unclassified",
  "tertiary",
  "elevator",
] as const;

export type ProfileId = "normal" | "wheelchair";

export const PROFILES: { id: ProfileId; label: string; hint: string }[] = [
  { id: "normal", label: "Normal", hint: "Shortest reasonable walk" },
  {
    id: "wheelchair",
    label: "Wheelchair",
    hint: "Avoids stairs and steep or narrow bits",
  },
];
