import { loadData, saveData } from "../../../lib/store.js";
import { syncAll } from "../../../lib/ics.js";

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).end();
  }
  const { id } = req.query;
  try {
    const data = await loadData();
    await syncAll(data);
    await saveData(data);
    const conn = (data.calendarConnections || []).find((c) => c.id === id);
    if (!conn) return res.status(404).end();
    return res.status(200).json(conn);
  } catch (e) {
    return res.status(e.status || 500).json({ error: e.message });
  }
}
