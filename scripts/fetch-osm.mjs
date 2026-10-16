/**
 * Fetch the raw OpenStreetMap data for the IIT Kanpur campus box and save it
 * as data/raw/iitk.osm.json (Overpass JSON shape).
 *
 *   npm run data:fetch                     # OSM API 0.6 (instant) -> Overpass mirrors
 *   node scripts/fetch-osm.mjs --overpass  # try Overpass mirrors first
 *   node scripts/fetch-osm.mjs --osm-api   # force api.openstreetmap.org /map
 *
 * The snapshot is committed to the repo: a build is always reproducible from
 * it, and the site does not depend on Overpass being up.
 */
import { writeFileSync, mkdirSync, existsSync } from "node:fs";
import dns from "node:dns";
import https from "node:https";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createGunzip, createInflate } from "node:zlib";
import { CAMPUS_BBOX } from "../data/config.js";
import { bboxToOverpass } from "../src/lib/geo/bbox.js";
import { parseOsmXml } from "./osm-xml.mjs";

// Prefer IPv4 on Windows networks where IPv6 AAAA records exist in DNS but IPv6
// routing is unavailable, which otherwise causes Node's fetch/undici to fail
// with ConnectTimeoutError ("fetch failed").
dns.setDefaultResultOrder("ipv4first");

const USER_AGENT = "Lathi-IITK-Accessible/0.1 (https://github.com/sunilj24-maker/Lathi)";
const OUT = join(process.cwd(), "data/raw/iitk.osm.json");

const OVERPASS_ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://lz4.overpass-api.de/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
];

function overpassQuery(bbox) {
  const b = bboxToOverpass(bbox);
  // Fetch nodes, ways (+ their nodes), and multipolygon relations (+ their
  // member ways and nodes) inside the campus box. Do NOT recurse arbitrary
  // route/network relations touching the box (e.g. NH34 / UP State Highways),
  // which would pull in thousands of ways across India and 504 Overpass.
  return `[out:json][timeout:60];
(
  node(${b});
  way(${b});
  >;
  relation[type=multipolygon](${b});
  >;
);
out body qt;`;
}

/** Keep one copy of each element, preferring the copy that carries tags. */
function dedupe(elements) {
  const byKey = new Map();
  for (const el of elements) {
    const key = `${el.type}/${el.id}`;
    const prev = byKey.get(key);
    if (!prev || (!prev.tags && el.tags)) byKey.set(key, el);
  }
  return [...byKey.values()];
}

function formatError(err) {
  if (!err) return "Unknown error";
  const cause = err.cause ? ` (${err.cause.code || err.cause.message || err.cause})` : "";
  const code = err.code && !String(err.message).includes(err.code) ? ` [${err.code}]` : "";
  return `${err.message || String(err)}${code}${cause}`;
}

function writeFileSafe(filePath, content) {
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      writeFileSync(filePath, content);
      return;
    } catch (err) {
      if (attempt < 4 && ["EBUSY", "EPERM", "EACCES"].includes(err.code)) {
        const end = Date.now() + 100 * (attempt + 1);
        while (Date.now() < end) {
          // brief sync wait for OneDrive / Windows indexer lock release
        }
        continue;
      }
      throw err;
    }
  }
}

/**
 * Perform an HTTPS request over IPv4 with end-to-end timeout (connect + body),
 * gzip/deflate decompression, redirect following, and transient retry.
 */
function requestText(url, { method = "GET", headers = {}, body = null, timeoutMs = 45000, redirects = 3 } = {}) {
  return new Promise((resolvePromise, rejectPromise) => {
    const parsed = new URL(url);
    const reqHeaders = {
      "User-Agent": USER_AGENT,
      "Accept-Encoding": "gzip, deflate",
      Connection: "close",
      ...headers,
    };
    if (body != null && reqHeaders["Content-Length"] == null) {
      reqHeaders["Content-Length"] = Buffer.byteLength(body);
    }

    let settled = false;
    const finish = (fn, val) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn(val);
    };

    const req = https.request(
      {
        protocol: parsed.protocol,
        hostname: parsed.hostname,
        port: parsed.port || 443,
        path: `${parsed.pathname}${parsed.search}`,
        method,
        headers: reqHeaders,
        family: 4,
        agent: false,
      },
      (res) => {
        const status = res.statusCode ?? 0;
        if ([301, 302, 303, 307, 308].includes(status) && res.headers.location && redirects > 0) {
          res.resume();
          const nextUrl = new URL(res.headers.location, url).toString();
          finish(
            resolvePromise,
            requestText(nextUrl, {
              method: status === 303 ? "GET" : method,
              headers,
              body: status === 303 ? null : body,
              timeoutMs,
              redirects: redirects - 1,
            }),
          );
          return;
        }

        if (status < 200 || status >= 300) {
          res.resume();
          const err = new Error(`HTTP ${status} ${res.statusMessage ?? ""}`.trim());
          err.status = status;
          finish(rejectPromise, err);
          return;
        }

        const encoding = (res.headers["content-encoding"] || "").toLowerCase();
        res.on("error", (err) => finish(rejectPromise, err));
        let stream = res;
        if (encoding === "gzip" || encoding === "x-gzip") {
          stream = res.pipe(createGunzip());
        } else if (encoding === "deflate") {
          stream = res.pipe(createInflate());
        }

        const chunks = [];
        stream.on("data", (chunk) => chunks.push(chunk));
        stream.on("end", () => {
          finish(resolvePromise, Buffer.concat(chunks).toString("utf8"));
        });
        stream.on("error", (err) => finish(rejectPromise, err));
      },
    );

    const timer = setTimeout(() => {
      req.destroy(new Error(`Timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    req.on("error", (err) => finish(rejectPromise, err));
    if (body != null) req.write(body);
    req.end();
  });
}

async function requestWithRetry(url, options = {}, retries = 2) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await requestText(url, options);
    } catch (err) {
      lastErr = err;
      const status = err.status ?? 0;
      const retryableStatus = status === 429 || status >= 500;
      const retryableNet = !status;
      if (attempt < retries && (retryableStatus || retryableNet)) {
        const delayMs = 1000 * (attempt + 1);
        console.warn(`  attempt ${attempt + 1} failed (${formatError(err)}); retrying in ${delayMs}ms...`);
        await new Promise((r) => setTimeout(r, delayMs));
        continue;
      }
      throw err;
    }
  }
  throw lastErr;
}

async function fetchOverpass(bbox) {
  const query = overpassQuery(bbox);
  let lastErr;
  for (const endpoint of OVERPASS_ENDPOINTS) {
    try {
      console.log(`Overpass: ${endpoint}`);
      const text = await requestWithRetry(
        endpoint,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: `data=${encodeURIComponent(query)}`,
          timeoutMs: 45000,
        },
        1,
      );
      let json;
      try {
        json = JSON.parse(text);
      } catch {
        throw new Error("Overpass returned non-JSON response (server busy or rate-limited)");
      }
      if (!Array.isArray(json.elements)) throw new Error("Malformed Overpass response");
      return json;
    } catch (err) {
      lastErr = err;
      console.warn(`  failed: ${formatError(err)}`);
    }
  }
  throw lastErr ?? new Error("All Overpass endpoints failed");
}

async function fetchOsmApi(bbox) {
  const b = `${bbox.west},${bbox.south},${bbox.east},${bbox.north}`;
  const url = `https://api.openstreetmap.org/api/0.6/map?bbox=${b}`;
  console.log(`OSM API: ${url}`);
  const xml = await requestWithRetry(url, { timeoutMs: 45000 }, 2);
  return {
    version: 0.6,
    generator: "scripts/fetch-osm.mjs (osm-api)",
    osm3s: { copyright: "The data included in this document is from www.openstreetmap.org. The data is made available under ODbL." },
    ...parseOsmXml(xml),
  };
}

export async function fetchOsmSnapshot({ useOsmApi = false, useOverpassFirst = false, allowCachedFallback = false } = {}) {
  let data;
  try {
    if (useOsmApi) {
      data = await fetchOsmApi(CAMPUS_BBOX);
    } else if (useOverpassFirst) {
      try {
        data = await fetchOverpass(CAMPUS_BBOX);
      } catch (err) {
        console.warn(`Overpass unavailable (${formatError(err)}); falling back to OSM API`);
        data = await fetchOsmApi(CAMPUS_BBOX);
      }
    } else {
      // Try the live OSM API first: it reflects JOSM uploads immediately and
      // responds in ~3-5s, whereas public Overpass mirrors frequently 504/429.
      try {
        data = await fetchOsmApi(CAMPUS_BBOX);
      } catch (err) {
        console.warn(`OSM API unavailable (${formatError(err)}); falling back to Overpass mirrors`);
        data = await fetchOverpass(CAMPUS_BBOX);
      }
    }
  } catch (err) {
    if (allowCachedFallback && existsSync(OUT)) {
      console.warn(`Network fetch failed (${formatError(err)}); keeping existing snapshot ${OUT}`);
      return;
    }
    throw err;
  }

  data.elements = dedupe(data.elements);
  data.fetchedAt = new Date().toISOString();
  data.bbox = CAMPUS_BBOX;

  const counts = { node: 0, way: 0, relation: 0 };
  for (const el of data.elements) counts[el.type] = (counts[el.type] ?? 0) + 1;

  mkdirSync(dirname(OUT), { recursive: true });
  const serialized = JSON.stringify(data);
  writeFileSafe(OUT, serialized);
  const mb = (Buffer.byteLength(serialized) / 1e6).toFixed(1);
  console.log(
    `Wrote ${OUT}\n  ${counts.node} nodes, ${counts.way} ways, ${counts.relation} relations (${mb} MB)`,
  );
  return data;
}

const isMain = process.argv[1] && resolve(fileURLToPath(import.meta.url)) === resolve(process.argv[1]);
if (isMain) {
  fetchOsmSnapshot({
    useOsmApi: process.argv.includes("--osm-api"),
    useOverpassFirst: process.argv.includes("--overpass"),
  }).catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
