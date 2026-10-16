import { useState } from "react";

/**
 * FeedbackModal — appears when user clicks "Send Feedback" after pinning a location.
 *
 * Props:
 *  location  — { name, lat, lng, address?, mapUrl }
 *  onClose   — callback to close the modal
 */
export default function FeedbackModal({ location, onClose }) {
  const [message, setMessage] = useState("");
  const [status, setStatus] = useState("idle"); // idle | submitting | success | error
  const [errorMsg, setErrorMsg] = useState("");

  const canSubmit = message.trim().length > 0 && status !== "submitting";

  async function handleSubmit(e) {
    e.preventDefault();
    if (!canSubmit) return;
    setStatus("submitting");
    setErrorMsg("");

    try {
      const res = await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          location,
          message: message.trim(),
          submittedAt: new Date().toISOString(),
        }),
      });

      const data = await res.json().catch(() => ({}));

      if (res.ok && data.success) {
        setStatus("success");
      } else {
        setStatus("error");
        setErrorMsg(data.error || "Something went wrong. Please try again.");
      }
    } catch {
      setStatus("error");
      setErrorMsg("Network error. Please check your connection and try again.");
    }
  }

  return (
    <>
      {/* Backdrop */}
      <div className="fb-backdrop" onClick={onClose} aria-hidden="true" />

      {/* Modal */}
      <div
        className="fb-modal"
        role="dialog"
        aria-modal="true"
        aria-label="Send location feedback"
      >
        {/* Header */}
        <div className="fb-header">
          <div className="fb-header-icon" aria-hidden="true">📍</div>
          <div>
            <h2 className="fb-title">Send Feedback</h2>
            <p className="fb-subtitle">Report an issue or share information about this location</p>
          </div>
          <button
            type="button"
            className="fb-close"
            onClick={onClose}
            aria-label="Close feedback form"
          >
            ✕
          </button>
        </div>

        {/* Location info card */}
        <div className="fb-location-card">
          <div className="fb-location-icon" aria-hidden="true">🗺️</div>
          <div className="fb-location-details">
            <div className="fb-location-name">
              {location.name || "Dropped Pin"}
            </div>
            <div className="fb-location-coords">
              {location.lat.toFixed(6)}, {location.lng.toFixed(6)}
              {location.address && ` · ${location.address}`}
            </div>
            <a
              href={location.mapUrl}
              target="_blank"
              rel="noreferrer"
              className="fb-location-link"
            >
              Open in Google Maps ↗
            </a>
          </div>
        </div>

        {/* Form */}
        {status === "success" ? (
          <div className="fb-success">
            <div className="fb-success-icon" aria-hidden="true">✅</div>
            <p className="fb-success-title">Feedback Submitted!</p>
            <p className="fb-success-text">
              Thank you! Your feedback has been submitted successfully.
            </p>
            <button type="button" className="fb-btn fb-btn-primary" onClick={onClose}>
              Close
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} noValidate>
            <label className="fb-label" htmlFor="fb-message">
              Your feedback <span className="fb-required" aria-hidden="true">*</span>
            </label>
            <textarea
              id="fb-message"
              className="fb-textarea"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Describe the issue or provide information about this location…"
              rows={5}
              required
              disabled={status === "submitting"}
              aria-describedby={status === "error" ? "fb-error" : undefined}
            />

            {status === "error" && (
              <div id="fb-error" className="fb-error" role="alert">
                ⚠️ {errorMsg}
              </div>
            )}

            <div className="fb-actions">
              <button
                type="button"
                className="fb-btn fb-btn-cancel"
                onClick={onClose}
                disabled={status === "submitting"}
              >
                Cancel
              </button>
              <button
                type="submit"
                className={`fb-btn fb-btn-primary ${status === "submitting" ? "fb-btn-loading" : ""}`}
                disabled={!canSubmit}
              >
                {status === "submitting" ? (
                  <>
                    <span className="fb-spinner" aria-hidden="true" />
                    Submitting…
                  </>
                ) : (
                  "Submit Feedback"
                )}
              </button>
            </div>
          </form>
        )}
      </div>
    </>
  );
}
