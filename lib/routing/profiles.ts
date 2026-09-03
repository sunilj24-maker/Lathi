import type { ProfileId } from "@/data/config";

export type OsmTags = Record<string, string>;

export type CostResult =
  | { kind: "ok"; cost: number; usedRamp: boolean; usedSteps: boolean }
  | { kind: "forbidden" };

function parsePercent(raw: string | undefined): number | null {
  if (!raw) return null;
  const m = raw.match(/(-?\d+(?:\.\d+)?)\s*%/);
  if (m) return Math.abs(Number(m[1]));
  const n = Number(raw);
  if (Number.isFinite(n)) return Math.abs(n);
  if (/steep/i.test(raw)) return 12;
  if (/up|down/i.test(raw)) return 6;
  return null;
}

function parseWidthMeters(raw: string | undefined): number | null {
  if (!raw) return null;
  const m = raw.match(/(\d+(?:\.\d+)?)/);
  return m ? Number(m[1]) : null;
}

const ROUGH_SURFACES = new Set(["gravel", "sand", "ground", "unpaved", "dirt", "grass"]);

export function edgeCost(
  lengthM: number,
  tags: OsmTags,
  nodeTags: OsmTags | undefined,
  profile: ProfileId,
): CostResult {
  let factor = 1;
  let extra = 0;
  let usedRamp = false;
  let usedSteps = false;

  const highway = tags.highway;
  const wheelchair = tags.wheelchair;
  const incline = parsePercent(tags.incline);
  const width = parseWidthMeters(tags.width);
  const surface = (tags.surface || "").toLowerCase();
  const smoothness = (tags.smoothness || "").toLowerCase();
  const isRamp =
    tags.ramp === "yes" ||
    tags["ramp:wheelchair"] === "yes" ||
    (highway === "footway" && Boolean(tags.incline));
  const isSteps = highway === "steps";
  const isElevator = highway === "elevator";

  if (profile === "normal") {
    if (isSteps) {
      factor *= 1.2;
      usedSteps = true;
    }
    if (ROUGH_SURFACES.has(surface)) factor *= 1.1;
    if (smoothness === "bad" || smoothness === "very_bad") factor *= 1.1;
    if (nodeTags?.highway === "crossing" && nodeTags.kerb === "raised") extra += 5;
  } else {
    if (isSteps && tags["ramp:wheelchair"] !== "yes") {
      return { kind: "forbidden" };
    }
    if (isSteps && tags["ramp:wheelchair"] === "yes") {
      usedRamp = true;
    }
    if (wheelchair === "no") return { kind: "forbidden" };
    if (incline != null && incline > 8) factor *= 6;
    else if (incline != null && incline >= 5) factor *= 2.5;
    if (width != null && width < 0.9) factor *= 4;
    if (ROUGH_SURFACES.has(surface)) factor *= 3;
    if (smoothness === "bad" || smoothness === "very_bad") factor *= 4;
    if (nodeTags?.highway === "crossing" && nodeTags.kerb === "raised") extra += 200;
    if (wheelchair === "yes" && isRamp) {
      factor *= 0.8;
      usedRamp = true;
    }
    if (isElevator && wheelchair !== "no") {
      factor *= 0.8;
      usedRamp = true;
    }
    if (isRamp) usedRamp = true;
  }

  if (isRamp) usedRamp = true;

  return { kind: "ok", cost: lengthM * factor + extra, usedRamp, usedSteps };
}

export function parseInclinePercent(raw: string | undefined): number | null {
  return parsePercent(raw);
}
