/**
 * Minimal OSM XML (.osm) parser — enough to read JOSM session files and the
 * OSM API /map response. Produces Overpass-JSON-shaped elements so the rest of
 * the pipeline does not care where the data came from.
 */

function decodeXml(s) {
  return s
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&#39;", "'")
    .replaceAll("&amp;", "&");
}

function attr(block, name) {
  const m = block.match(new RegExp(`\\b${name}="([^"]*)"`));
  return m ? decodeXml(m[1]) : undefined;
}

function parseTags(inner) {
  const tags = {};
  const re = /<tag\s+k="([^"]*)"\s+v="([^"]*)"\s*\/>/g;
  let m;
  while ((m = re.exec(inner))) tags[decodeXml(m[1])] = decodeXml(m[2]);
  return Object.keys(tags).length ? tags : undefined;
}

/** @returns {{ elements: Array<object> }} */
export function parseOsmXml(xml) {
  const elements = [];

  const nodeRe = /<node\b([^>]*?)\/>|<node\b([^>]*)>([\s\S]*?)<\/node>/g;
  let nm;
  while ((nm = nodeRe.exec(xml))) {
    const open = nm[1] ?? nm[2] ?? "";
    const id = Number(attr(open, "id"));
    const lat = Number(attr(open, "lat"));
    const lon = Number(attr(open, "lon"));
    if (!Number.isFinite(id) || !Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    if (attr(open, "action") === "delete") continue;
    const el = { type: "node", id, lat, lon };
    const tags = nm[3] ? parseTags(nm[3]) : undefined;
    if (tags) el.tags = tags;
    elements.push(el);
  }

  const wayRe = /<way\b([^>]*)>([\s\S]*?)<\/way>/g;
  let wm;
  while ((wm = wayRe.exec(xml))) {
    const id = Number(attr(wm[1], "id"));
    if (!Number.isFinite(id)) continue;
    if (attr(wm[1], "action") === "delete") continue;
    const nodes = [];
    const ndRe = /<nd\s+ref="(-?\d+)"\s*\/>/g;
    let dm;
    while ((dm = ndRe.exec(wm[2]))) nodes.push(Number(dm[1]));
    const el = { type: "way", id, nodes };
    const tags = parseTags(wm[2]);
    if (tags) el.tags = tags;
    elements.push(el);
  }

  const relRe = /<relation\b([^>]*)>([\s\S]*?)<\/relation>/g;
  let rm;
  while ((rm = relRe.exec(xml))) {
    const id = Number(attr(rm[1], "id"));
    if (!Number.isFinite(id)) continue;
    if (attr(rm[1], "action") === "delete") continue;
    const members = [];
    const memRe = /<member\s+([^>]*)\/>/g;
    let mm;
    while ((mm = memRe.exec(rm[2]))) {
      members.push({
        type: attr(mm[1], "type"),
        ref: Number(attr(mm[1], "ref")),
        role: attr(mm[1], "role") ?? "",
      });
    }
    const el = { type: "relation", id, members };
    const tags = parseTags(rm[2]);
    if (tags) el.tags = tags;
    elements.push(el);
  }

  return { elements };
}
