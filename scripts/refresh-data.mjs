/**
 * Refresh the OSM snapshot and rebuild all generated files in public/data/.
 *
 *   npm run data:refresh                 # fetch from OSM + build
 *   npm run data:refresh -- --osm-api    # force the live OSM API 0.6 endpoint
 *   npm run data:refresh -- --offline    # skip fetch, rebuild from existing snapshot
 */
import { fetchOsmSnapshot } from "./fetch-osm.mjs";
import { buildData } from "./build-data.mjs";

async function main() {
  const args = process.argv.slice(2);
  let raw = null;
  if (!args.includes("--offline")) {
    raw = await fetchOsmSnapshot({
      useOsmApi: args.includes("--osm-api"),
      useOverpassFirst: args.includes("--overpass"),
      allowCachedFallback: true,
    });
  } else {
    console.log("Skipping fetch (--offline); rebuilding from existing data/raw/iitk.osm.json");
  }
  buildData(raw);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
