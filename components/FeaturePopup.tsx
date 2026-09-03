"use client";

import type { FeatureProps } from "@/lib/types";

const LABELS: Record<FeatureProps["kind"], string> = {
  ramp: "Ramp",
  stairs: "Stairs",
  skywalk: "Skywalk",
  crossing: "Crossing",
  elevator: "Elevator",
  entrance: "Entrance",
  bench: "Bench",
  rest_area: "Rest area",
  other: "Feature",
};

const ATTRS = [
  "wheelchair",
  "incline",
  "width",
  "surface",
  "smoothness",
  "handrail",
  "kerb",
  "tactile_paving",
  "step_count",
  "ramp",
  "covered",
  "lit",
];

type Props = {
  properties: FeatureProps & { notes?: string };
};

export function FeaturePopup({ properties }: Props) {
  const tags = properties.tags ?? {};
  const rows = ATTRS.filter((k) => tags[k]).map((k) => [k, tags[k]] as const);

  return (
    <div className="min-w-[180px] max-w-[240px]">
      <div className="text-xs font-semibold uppercase tracking-wide text-sky-700">
        {LABELS[properties.kind] ?? "Feature"}
      </div>
      <div className="mt-0.5 text-sm font-semibold text-slate-900">
        {properties.name || "Unnamed"}
      </div>
      <dl className="mt-2 space-y-1 text-xs text-slate-700">
        {rows.map(([k, v]) => (
          <div key={k} className="flex justify-between gap-3">
            <dt className="text-slate-500">{k.replaceAll("_", " ")}</dt>
            <dd className="font-medium">{v}</dd>
          </div>
        ))}
        <div className="flex justify-between gap-3">
          <dt className="text-slate-500">last checked</dt>
          <dd className="font-medium">{properties.check_date || "not surveyed"}</dd>
        </div>
      </dl>
      {properties.notes ? (
        <p className="mt-2 text-xs text-slate-600">{properties.notes}</p>
      ) : null}
    </div>
  );
}
