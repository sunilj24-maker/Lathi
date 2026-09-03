import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { RoutingGraph } from "@/lib/types";

let cached: RoutingGraph | null = null;

export function loadGraph(): RoutingGraph {
  if (cached) return cached;
  const path = join(process.cwd(), "data/graph.json");
  cached = JSON.parse(readFileSync(path, "utf8")) as RoutingGraph;
  return cached;
}
