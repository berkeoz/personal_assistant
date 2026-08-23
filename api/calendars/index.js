import { loadData, saveData } from "../../lib/store.js";
import { syncConnection } from "../../lib/ics.js";

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  try {
    if (req.method === "GET") {
      const data = await loadData();
      return res.status(200).json(data.calendarConnections || []);
    }
    if (req.method === "POST") {
      let body = req.body;
      if (typeof body === "string") body = JSON.parse(body);
      const data = await loadData();
      const conn = { ...body, id: crypto.randomUUID(), lastSynced: null, status: "pending" };
      data.calendarConnections.push(conn);
      await syncConnection(data, conn);
      await saveData(data);
      return res.status(200).json(conn);
    }
    res.setHeader("Allow", "GET, POST");
    return res.status(405).end();
  } catch (e) {
    return res.status(e.status || 500).json({ error: e.message });
  }
}
