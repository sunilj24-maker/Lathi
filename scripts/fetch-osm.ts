import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { CAMPUS_BBOX } from "../data/config.ts";

const USER_AGENT = "Lathi-IITK-Accessible/0.1 (https://github.com/sunilj24-maker/Lathi)";

type OsmElement =
  | { type: "node"; id: number; lat: number; lon: number; tags?: Record<string, string> }
  | { type: "way"; id: number; nodes: number[]; tags?: Record<string, string> };

function attr(block: string, name: string): string | undefined {
  const m = block.match(new RegExp(`\\b${name}="([^"]*)"`));
  return m?.[1];
}

function parseTags(inner: string): Record<string, string> | undefined {
  const tags: Record<string, string> = {};
  const re = /<tag\s+k="([^"]*)"\s+v="([^"]*)"\s*\/>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(inner))) {
    tags[decodeXml(m[1])] = decodeXml(m[2]);
  }
  return Object.keys(tags).length ? tags : undefined;
}

function decodeXml(s: string): string {
  return s
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&amp;", "&");
}

function parseOsmXml(xml: string): OsmElement[] {
  const elements: OsmElement[] = [];

  const nodeRe = /<node\b([^>]*?)\/>|<node\b([^>]*)>([\s\S]*?)<\/node>/g;
  let nm: RegExpExecArray | null;
  while ((nm = nodeRe.exec(xml))) {
    const open = nm[1] ?? nm[2] ?? "";
    const id = Number(attr(open, "id"));
    const lat = Number(attr(open, "lat"));
    const lon = Number(attr(open, "lon"));
    if (!Number.isFinite(id) || !Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    const tags = nm[3] ? parseTags(nm[3]) : undefined;
    elements.push({ type: "node", id, lat, lon, tags });
  }

  const wayRe = /<way\b([^>]*)>([\s\S]*?)<\/way>/g;
  let wm: RegExpExecArray | null;
  while ((wm = wayRe.exec(xml))) {
    const id = Number(attr(wm[1], "id"));
    if (!Number.isFinite(id)) continue;
    const nodes: number[] = [];
    const ndRe = /<nd\s+ref="(-?\d+)"\s*\/>/g;
    let dm: RegExpExecArray | null;
    while ((dm = ndRe.exec(wm[2]))) nodes.push(Number(dm[1]));
    elements.push({ type: "way", id, nodes, tags: parseTags(wm[2]) });
  }

  return elements;
}

async function fetchOsmXml(): Promise<string> {
  const bbox = `${CAMPUS_BBOX.west},${CAMPUS_BBOX.south},${CAMPUS_BBOX.east},${CAMPUS_BBOX.north}`;
  const url = `https://api.openstreetmap.org/api/0.6/map?bbox=${bbox}`;
  console.log(`Fetching OSM map extract ${bbox} …`);
  const res = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
  if (!res.ok) {
    throw new Error(`OSM API returned ${res.status} ${res.statusText}`);
  }
  return res.text();
}

async function main() {
  const xml = await fetchOsmXml();
  const elements = parseOsmXml(xml);
  const data = {
    version: 0.6,
    generator: "scripts/fetch-osm.ts",
    osm3s: { copyright: "OpenStreetMap contributors, ODbL" },
    elements,
  };
  const out = join(process.cwd(), "data/raw/iitk.osm.json");
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(data));
  console.log(`Wrote ${out} (${elements.length} elements, ${(xml.length / 1e6).toFixed(1)} MB XML)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
