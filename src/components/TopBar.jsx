import { AMENITY_FINDERS } from "../../data/config.js";

/** Buttons across the top of the map: amenity finders and the day / night switch. */
export default function TopBar({ finder, onFinder, counts = {}, night, onNight, lang = "en", onLang }) {
  return (
    <div className="topbar" role="toolbar" aria-label="Find nearby and lighting">
      {AMENITY_FINDERS.map((f) => {
        const active = finder === f.id;
        const n = f.groups.reduce((s, g) => s + (counts[g] ?? 0), 0);
        return (
          <button
            key={f.id}
            type="button"
            className={`topbar-btn ${active ? "active" : ""}`}
            aria-pressed={active}
            onClick={() => onFinder(active ? null : f.id)}
            title={active ? "Hide" : `Highlight all ${f.label.toLowerCase()} on the map`}
          >
            <span aria-hidden="true">{f.icon}</span>
            <span>{f.label}</span>
            {n > 0 && <span className="topbar-count">{n}</span>}
          </button>
        );
      })}
      <div className="topbar-actions">
        <div className="lang-toggle" role="radiogroup" aria-label="Language">
          <button
            type="button"
            role="radio"
            aria-checked={lang === "en"}
            className={lang === "en" ? "active" : ""}
            onClick={() => onLang?.("en")}
            title="English directions"
          >
            EN
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={lang === "hi"}
            className={lang === "hi" ? "active" : ""}
            onClick={() => onLang?.("hi")}
            title="हिन्दी निर्देश"
          >
            हिन्दी
          </button>
        </div>
        <div className="daynight" role="radiogroup" aria-label="Time of day">
          <button
            type="button"
            role="radio"
            aria-checked={!night}
            className={!night ? "active" : ""}
            onClick={() => onNight(false)}
            title="Daytime routing"
          >
            ☀️ Day
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={night}
            className={night ? "active" : ""}
            onClick={() => onNight(true)}
            title="Avoid dim and dark paths"
          >
            🌙 Night
          </button>
        </div>
      </div>
    </div>
  );
}
