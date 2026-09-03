// Pushover alerts. No LLM, no narrative: every message here is plain templated
// text built from engine/job output (CLAUDE.md non-negotiable).
export async function sendPushover(message: string, title = "Legacy League Dynasty") {
  const token = process.env.PUSHOVER_APP_TOKEN;
  const user = process.env.PUSHOVER_USER_KEY;
  if (!token || !user) {
    throw new Error("PUSHOVER_APP_TOKEN / PUSHOVER_USER_KEY not configured");
  }

  const res = await fetch("https://api.pushover.net/1/messages.json", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token, user, message, title }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Pushover send failed: ${res.status} ${text}`);
  }
}
