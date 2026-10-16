/**
 * Secure feedback API server using Express + Resend.
 *
 * Runs alongside the Vite dev server on port 3001.
 * Vite proxies /api/* requests to this server (see vite.config.js).
 *
 * SETUP:
 *  1. Copy .env.example to .env and fill in your Resend credentials.
 *  2. Run: npm run server   (or npm run dev:full for both servers together)
 */

import express from "express";
import { Resend } from "resend";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

// ---- Load .env manually (no extra deps needed in Node 20.6+) ----
const __dirname = dirname(fileURLToPath(import.meta.url));

function loadEnv() {
  try {
    const envPath = join(__dirname, "..", ".env");
    const lines = readFileSync(envPath, "utf-8").split("\n");
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq).trim();
      const val = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
      process.env[key] = val;
    }
  } catch {
    // .env not found — rely on real environment variables
  }
}
loadEnv();

function getEnvConfig() {
  loadEnv();
  return {
    apiKey: process.env.RESEND_API_KEY,
    sender: process.env.FEEDBACK_SENDER_EMAIL,
    receiver: process.env.FEEDBACK_RECEIVER_EMAIL,
  };
}

const app = express();
app.use(express.json({ limit: "50kb" }));

// ---- Simple in-memory rate limiting (per IP, max 5 per 10 min) ----
const submissionLog = new Map();
function isRateLimited(ip) {
  const now = Date.now();
  const window = 10 * 60 * 1000; // 10 minutes
  const max = 5;
  const times = (submissionLog.get(ip) ?? []).filter((t) => now - t < window);
  if (times.length >= max) return true;
  times.push(now);
  submissionLog.set(ip, times);
  return false;
}

// ---- Feedback endpoint ----
app.post("/api/feedback", async (req, res) => {
  // Rate limiting
  const ip = req.headers["x-forwarded-for"]?.split(",")[0]?.trim() ?? req.socket.remoteAddress ?? "unknown";
  if (isRateLimited(ip)) {
    return res.status(429).json({ success: false, error: "Too many submissions. Please wait a few minutes and try again." });
  }

  // Validate body
  const { location, message, submittedAt } = req.body ?? {};

  if (!location || typeof location !== "object") {
    return res.status(400).json({ success: false, error: "Invalid location data." });
  }
  if (!message || typeof message !== "string" || message.trim().length === 0) {
    return res.status(400).json({ success: false, error: "Feedback message is required." });
  }
  if (message.trim().length > 5000) {
    return res.status(400).json({ success: false, error: "Message is too long (max 5000 characters)." });
  }

  const { name, lat, lng, address, mapUrl } = location;

  // Validate credentials dynamically from .env
  const { apiKey, sender, receiver } = getEnvConfig();
  if (!apiKey || apiKey === "re_YOUR_RESEND_API_KEY_HERE" || !sender || !receiver) {
    console.error("[feedback-api] Missing Resend credentials in .env file.");
    return res.status(503).json({ success: false, error: "Email service is not configured. Please check your .env file." });
  }

  const resend = new Resend(apiKey);

  // Format the timestamp
  const submittedDate = submittedAt ? new Date(submittedAt) : new Date();
  const formattedDate = submittedDate.toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    dateStyle: "full",
    timeStyle: "long",
  });

  // Build HTML email
  const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Location Feedback — IITK Accessible</title>
</head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:'Segoe UI',Roboto,system-ui,-apple-system,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:32px 16px;">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:16px;box-shadow:0 2px 16px rgba(0,0,0,0.10);overflow:hidden;max-width:100%;">

        <!-- Header -->
        <tr>
          <td style="background:#1a73e8;padding:28px 32px;">
            <div style="display:flex;align-items:center;gap:12px;">
              <span style="font-size:28px;">♿</span>
              <div>
                <div style="color:#fff;font-size:20px;font-weight:700;margin:0;">IITK Accessible</div>
                <div style="color:rgba(255,255,255,0.8);font-size:13px;margin-top:2px;">Location Feedback Report</div>
              </div>
            </div>
          </td>
        </tr>

        <!-- Body -->
        <tr>
          <td style="padding:28px 32px;">

            <!-- Location card -->
            <div style="background:#f0f7ff;border:1px solid #bfdbfe;border-radius:10px;padding:16px 20px;margin-bottom:24px;">
              <div style="font-size:13px;font-weight:600;color:#1e40af;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:10px;">📍 Reported Location</div>
              <table cellpadding="0" cellspacing="0" width="100%">
                <tr>
                  <td style="padding:3px 0;color:#64748b;font-size:13px;width:80px;vertical-align:top;">Name</td>
                  <td style="padding:3px 0;font-size:13px;font-weight:600;color:#1e293b;">${escapeHtml(name ?? "Unknown")}</td>
                </tr>
                <tr>
                  <td style="padding:3px 0;color:#64748b;font-size:13px;vertical-align:top;">Latitude</td>
                  <td style="padding:3px 0;font-size:13px;color:#1e293b;font-family:monospace;">${lat?.toFixed(6) ?? "—"}</td>
                </tr>
                <tr>
                  <td style="padding:3px 0;color:#64748b;font-size:13px;vertical-align:top;">Longitude</td>
                  <td style="padding:3px 0;font-size:13px;color:#1e293b;font-family:monospace;">${lng?.toFixed(6) ?? "—"}</td>
                </tr>
                ${address ? `<tr>
                  <td style="padding:3px 0;color:#64748b;font-size:13px;vertical-align:top;">Address</td>
                  <td style="padding:3px 0;font-size:13px;color:#1e293b;">${escapeHtml(address)}</td>
                </tr>` : ""}
                ${mapUrl ? `<tr>
                  <td style="padding:3px 0;color:#64748b;font-size:13px;vertical-align:top;">Map link</td>
                  <td style="padding:3px 0;"><a href="${mapUrl}" style="color:#1a73e8;font-size:13px;">Open in Google Maps ↗</a></td>
                </tr>` : ""}
              </table>
            </div>

            <!-- Feedback message -->
            <div style="margin-bottom:24px;">
              <div style="font-size:13px;font-weight:600;color:#374151;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:10px;">💬 User Feedback</div>
              <div style="background:#fafafa;border:1px solid #e5e7eb;border-radius:8px;padding:14px 16px;font-size:14px;color:#1f2937;line-height:1.65;white-space:pre-wrap;">${escapeHtml(message.trim())}</div>
            </div>

            <!-- Submission info -->
            <div style="border-top:1px solid #e5e7eb;padding-top:16px;">
              <div style="font-size:12px;color:#9ca3af;">
                <span>⏰ Submitted: ${formattedDate}</span>
              </div>
            </div>
          </td>
        </tr>

        <!-- Footer -->
        <tr>
          <td style="background:#f8fafc;border-top:1px solid #e2e8f0;padding:16px 32px;text-align:center;">
            <div style="font-size:11px;color:#94a3b8;">
              This email was automatically generated by IITK Accessible feedback system.
              Do not reply to this email — the sender address is unmonitored.
            </div>
          </td>
        </tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;

  // Plain text version
  const text = [
    "IITK Accessible — Location Feedback Report",
    "=".repeat(50),
    "",
    "LOCATION",
    `  Name      : ${name ?? "Unknown"}`,
    `  Latitude  : ${lat?.toFixed(6) ?? "—"}`,
    `  Longitude : ${lng?.toFixed(6) ?? "—"}`,
    address ? `  Address   : ${address}` : null,
    mapUrl ? `  Map Link  : ${mapUrl}` : null,
    "",
    "FEEDBACK",
    message.trim(),
    "",
    `Submitted: ${formattedDate}`,
  ].filter((l) => l !== null).join("\n");

  try {
    const result = await resend.emails.send({
      from: sender,
      to: receiver,
      subject: `📍 Location Feedback: ${name ?? "Unknown location"} (${lat?.toFixed(4)}, ${lng?.toFixed(4)})`,
      html,
      text,
    });

    if (result.error) {
      console.error("[feedback-api] Resend error:", result.error);
      return res.status(502).json({
        success: false,
        error: result.error.message || "Failed to send email. Please check server logs."
      });
    }

    console.log(`[feedback-api] Feedback sent for "${name}" (${lat}, ${lng}). Resend ID: ${result.data?.id}`);
    return res.json({ success: true, id: result.data?.id });

  } catch (err) {
    console.error("[feedback-api] Unexpected error:", err);
    return res.status(500).json({
      success: false,
      error: err.message || "An unexpected error occurred. Please try again."
    });
  }
});

// ---- Health check ----
app.get("/api/health", (_req, res) => {
  const { apiKey, sender, receiver } = getEnvConfig();
  const configured = Boolean(apiKey && apiKey !== "re_YOUR_RESEND_API_KEY_HERE" && sender && receiver);
  res.json({ ok: true, configured, sender, receiver });
});

// ---- HTML escaping ----
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

const PORT = process.env.API_PORT ?? 3001;
app.listen(PORT, () => {
  const { sender, receiver } = getEnvConfig();
  console.log(`[feedback-api] ✅ Running on http://localhost:${PORT}`);
  console.log(`[feedback-api]    Sender  : ${sender ?? "(not set)"}`);
  console.log(`[feedback-api]    Receiver: ${receiver ?? "(not set)"}`);
});
