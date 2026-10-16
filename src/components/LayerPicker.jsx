/**
 * Layer picker — now shows only the Buildings view button.
 * The "Paths" mode has been removed from the UI.
 */
function BuildingsThumb() {
  return (
    <svg viewBox="0 0 48 48" aria-hidden="true">
      <rect width="48" height="48" fill="#eef2f7" />
      <rect x="6" y="8" width="14" height="12" rx="1.5" fill="#93c5fd" stroke="#475569" strokeWidth="1" />
      <rect x="26" y="6" width="16" height="10" rx="1.5" fill="#93c5fd" stroke="#475569" strokeWidth="1" />
      <rect x="8" y="27" width="12" height="14" rx="1.5" fill="#cbd5e1" stroke="#475569" strokeWidth="1" />
      <rect x="26" y="24" width="15" height="17" rx="1.5" fill="#93c5fd" stroke="#475569" strokeWidth="1" />
      <rect x="9" y="12" width="8" height="1.6" fill="#1e293b" />
      <rect x="29" y="30" width="9" height="1.6" fill="#1e293b" />
    </svg>
  );
}

/** Shows only the Buildings layer button. Clicking it has no effect since it's the only mode. */
export default function LayerPicker({ value, onChange }) {
  return (
    <div className="layer-picker" role="toolbar" aria-label="Map layer">
      <button
        type="button"
        role="radio"
        aria-checked={true}
        className="layer-btn active"
        title="Base map with building names"
        onClick={() => onChange("buildings")}
      >
        <span className="layer-thumb">
          <BuildingsThumb />
        </span>
        <span className="layer-label">Buildings</span>
      </button>
    </div>
  );
}
