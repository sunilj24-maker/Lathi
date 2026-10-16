import { useMemo, useState } from "react";
import { AMENITY_GROUPS } from "../../data/config.js";
import { formatDistance, haversineMeters } from "../lib/geo/haversine.js";
import { levelLabel } from "../lib/levels.js";

/**
 * List of the amenities highlighted by a top-bar finder. Picking one makes it
 * the destination; "Nearest" routes to the closest one by walking distance.
 */
export default function AmenityList({ finder, items, from, selectedId, onPick, onNearest, nearestBusy, onClose }) {
  const groups = finder.groups;
  const [group, setGroup] = useState("all");
  const shown = useMemo(() => {
    const list = group === "all" ? items : items.filter((i) => i.group === group);
    if (!from) return list.map((item) => ({ item, crow: null }));
    return list
      .map((item) => ({ item, crow: haversineMeters(from.lat, from.lon, item.lat, item.lon) }))
      .sort((a, b) => a.crow - b.crow);
  }, [items, group, from]);

  return (
    <div className="amenities">
      <div className="amenities-head">
        <strong>
          {finder.icon} {finder.label}
        </strong>
        <button type="button" className="amenities-close" onClick={onClose} aria-label="Close list">
          ✕
        </button>
      </div>

      {groups.length > 1 && (
        <div className="amenities-filter" role="radiogroup" aria-label="Filter">
          {["all", ...groups].map((g) => (
            <button key={g} type="button" role="radio" aria-checked={group === g} className={`chip ${group === g ? "chip-active" : ""}`} onClick={() => setGroup(g)}>
              {g === "all" ? "All" : `${AMENITY_GROUPS[g].icon} ${AMENITY_GROUPS[g].label}`}
            </button>
          ))}
        </div>
      )}

      {from ? (
        <button type="button" className="amenities-nearest" disabled={nearestBusy || !shown.length} onClick={() => onNearest(shown.map((s) => s.item))}>
          {nearestBusy ? "Finding the nearest…" : `Take me to the nearest${group === "all" ? "" : ` ${AMENITY_GROUPS[group].label.toLowerCase()}`}`}
        </button>
      ) : (
        <div className="hint hint-small">Choose a starting point to sort these by distance. Pick any of them to make it your destination.</div>
      )}

      <ul className="amenities-list">
        {shown.map(({ item, crow }) => (
          <li key={item.id}>
            <button type="button" className={`amenity ${item.id === selectedId ? "selected" : ""}`} onClick={() => onPick(item)}>
              <span className="amenity-dot" style={{ background: AMENITY_GROUPS[item.group].color }} aria-hidden="true" />
              <span className="amenity-body">
                <span className="amenity-name">{item.name}</span>
                <span className="amenity-sub">
                  {[
                    AMENITY_GROUPS[item.group].label,
                    item.level != null && item.level !== "0" ? levelLabel(item.level) : null,
                    item.openingHours,
                    item.wheelchair === "no" ? "not wheelchair accessible" : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
              </span>
              {crow != null && <span className="amenity-dist">{formatDistance(crow)}</span>}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
