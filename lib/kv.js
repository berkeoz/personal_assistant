// Thin client for Vercel KV's REST API (Upstash Redis under the hood).
// Requires a KV store attached to this Vercel project (env vars
// KV_REST_API_URL / KV_REST_API_TOKEN).

const BASE = process.env.KV_REST_API_URL;
const TOKEN = process.env.KV_REST_API_TOKEN;

function assertConfigured() {
  if (!BASE || !TOKEN) {
    throw Object.assign(new Error("No KV store attached to this project yet."), { status: 500 });
  }
}

export async function kvGet(key) {
  assertConfigured();
  const r = await fetch(`${BASE}/get/${key}`, {
    headers: { Authorization: `Bearer ${TOKEN}` },
  });
  if (!r.ok) throw Object.assign(new Error("KV read failed"), { status: 502 });
  const data = await r.json();
  return data.result ? JSON.parse(data.result) : null;
}

export async function kvSet(key, value) {
  assertConfigured();
  const r = await fetch(`${BASE}/set/${key}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify(value),
  });
  if (!r.ok) throw Object.assign(new Error("KV write failed"), { status: 502 });
}
