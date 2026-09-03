"use client";

type Summary = {
  distanceM: number;
  rampsUsed: number;
  stairsUsed: number;
  stairsAvoided: boolean;
};

type Props = {
  status: "idle" | "loading" | "ok" | "no-route" | "outside" | "error";
  message?: string;
  summary?: Summary;
  profileLabel: string;
};

function formatDistance(m: number): string {
  if (m < 1000) return `${m} m`;
  return `${(m / 1000).toFixed(2)} km`;
}

export function RouteSummary({ status, message, summary, profileLabel }: Props) {
  if (status === "idle") return null;

  return (
    <div className="rounded-xl border border-slate-200 bg-white/95 p-3 shadow-lg backdrop-blur">
      {status === "loading" && (
        <p className="text-sm text-slate-600">Finding a {profileLabel.toLowerCase()} route…</p>
      )}
      {status === "ok" && summary && (
        <div>
          <p className="text-sm font-semibold text-slate-900">
            {formatDistance(summary.distanceM)} · {profileLabel}
          </p>
          <p className="mt-1 text-xs text-slate-600">
            {summary.rampsUsed} ramp{summary.rampsUsed === 1 ? "" : "s"} used
            {summary.stairsUsed > 0
              ? ` · ${summary.stairsUsed} stair flight${summary.stairsUsed === 1 ? "" : "s"}`
              : " · stairs avoided"}
          </p>
        </div>
      )}
      {(status === "no-route" || status === "outside" || status === "error") && (
        <p className="text-sm text-slate-800">{message}</p>
      )}
    </div>
  );
}
