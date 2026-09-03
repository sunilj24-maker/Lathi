import { formatDistance, formatDuration } from "../lib/geo/haversine.js";

/** Rotation (degrees, clockwise) of the arrow icon for each manoeuvre. */
const TURN_ROTATION = {
  straight: 0,
  "slight-left": -45,
  "slight-right": 45,
  left: -90,
  right: 90,
  "sharp-left": -135,
  "sharp-right": 135,
  uturn: 180,
};

const KIND_LABEL = { stairs: "Stairs", ramp: "Ramp", elevator: "Lift", skywalk: "Skywalk", crossing: "Cross", indoor: "Indoor" };
const KIND_COLOR = { stairs: "#dc2626", ramp: "#16a34a", elevator: "#0891b2", skywalk: "#7c3aed", crossing: "#f59e0b", indoor: "#64748b" };

function Arrow({ rotation = 0, color = "currentColor" }) {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" style={{ transform: `rotate(${rotation}deg)` }}>
      <path d="M12 3l6 7h-4v11h-4V10H6l6-7z" fill={color} />
    </svg>
  );
}

function FlagIcon() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
      <path d="M5 3v18h2v-7h11l-2-4 2-4H7V3H5z" fill="#d93025" />
    </svg>
  );
}

function stepIcon(step) {
  if (step.type === "arrive") return <FlagIcon />;
  const rotation = step.type === "depart" ? 0 : TURN_ROTATION[step.turn] ?? 0;
  const color = step.kind && KIND_COLOR[step.kind] && step.kind !== "walk" ? KIND_COLOR[step.kind] : "#5f6368";
  return <Arrow rotation={rotation} color={color} />;
}

function kindBadge(step) {
  if (!step.kind || step.kind === "walk" || step.kind === "arrive") return null;
  return (
    <span className="step-kind" style={{ color: KIND_COLOR[step.kind], borderColor: KIND_COLOR[step.kind] }}>
      {KIND_LABEL[step.kind]}
    </span>
  );
}

/** Google-Maps-style summary card + step list for a computed route. */
export default function RouteSummary({ result, onHoverStep, onSelectStep }) {
  const { main, comparison } = result;
  const c = main.counts;
  const isWheelchair = main.profile === "wheelchair";

  const chips = [];
  if (c.stairs) chips.push({ text: `${c.stairs} staircase${c.stairs > 1 ? "s" : ""}`, tone: isWheelchair ? "warn" : "neutral" });
  else if (isWheelchair) chips.push({ text: "Step-free", tone: "good" });
  if (c.ramp) chips.push({ text: `${c.ramp} ramp${c.ramp > 1 ? "s" : ""}`, tone: "good" });
  if (c.skywalk) chips.push({ text: `${c.skywalk} skywalk${c.skywalk > 1 ? "s" : ""}`, tone: "neutral" });
  if (c.elevator) chips.push({ text: `${c.elevator} elevator${c.elevator > 1 ? "s" : ""}`, tone: "good" });
  if (c.crossing) chips.push({ text: `${c.crossing} road crossing${c.crossing > 1 ? "s" : ""}`, tone: "neutral" });
  const footShare = main.footM + main.roadM > 0 ? main.footM / (main.footM + main.roadM) : 0;
  chips.push({ text: footShare >= 0.6 ? "Mostly footpaths" : footShare <= 0.25 ? "Mostly along roads" : "Footpaths + roads", tone: "neutral" });

  let comparisonNote = null;
  if (comparison && !comparison.sameAsMain) {
    const avoided = comparison.counts.stairs - main.counts.stairs;
    const extra = main.distanceM - comparison.distanceM;
    comparisonNote =
      avoided > 0
        ? `Avoids ${avoided} staircase${avoided > 1 ? "s" : ""} on the shortest route (+${formatDistance(Math.max(0, extra))}).`
        : `Differs from the shortest route to avoid steep, narrow or rough paths (+${formatDistance(Math.max(0, extra))}).`;
  } else if (comparison?.sameAsMain) {
    comparisonNote = "Same as the shortest walking route.";
  }

  return (
    <div className="route">
      <div className="route-head">
        <div className="route-time">{formatDuration(main.durationS)}</div>
        <div className="route-dist">
          {formatDistance(main.distanceM)} · {isWheelchair ? "Wheelchair route" : "Walking route"}
        </div>
      </div>

      <div className="chips">
        {chips.map((ch) => (
          <span key={ch.text} className={`chip chip-${ch.tone}`}>
            {ch.text}
          </span>
        ))}
      </div>

      {comparisonNote && <div className="route-compare">{comparisonNote}</div>}

      {main.warnings.map((w) => (
        <div key={w} className="route-warning">
          {w}
        </div>
      ))}

      <ol className="steps">
        {main.directions.map((step, i) => (
          <li
            key={i}
            className={`step step-${step.type}`}
            onMouseEnter={() => onHoverStep?.(step)}
            onMouseLeave={() => onHoverStep?.(null)}
            onClick={() => onSelectStep?.(step)}
          >
            <span className="step-icon" aria-hidden="true">
              {stepIcon(step)}
            </span>
            <span className="step-body">
              <span className="step-text">
                {step.text} {kindBadge(step)}
              </span>
              {step.distance > 0 && <span className="step-dist">{formatDistance(step.distance)}</span>}
            </span>
          </li>
        ))}
      </ol>

      <div className="route-foot">
        Route computed in the browser over {main.nodeIds.length} path points · explored {main.visited} nodes
      </div>
    </div>
  );
}
