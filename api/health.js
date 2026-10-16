export default function handler(req, res) {
  const apiKey = process.env.RESEND_API_KEY;
  const sender = process.env.FEEDBACK_SENDER_EMAIL;
  const receiver = process.env.FEEDBACK_RECEIVER_EMAIL;
  const configured = Boolean(apiKey && apiKey !== "re_YOUR_RESEND_API_KEY_HERE" && sender && receiver);

  res.status(200).json({
    ok: true,
    configured,
    sender: sender ?? null,
    receiver: receiver ?? null,
  });
}
