import { loadData, saveData } from "../lib/store.js";

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  try {
    if (req.method === "GET") {
      const data = await loadData();
      return res.status(200).json(data);
    }
    if (req.method === "POST") {
      let body = req.body;
      if (typeof body === "string") {
        try {
          body = JSON.parse(body);
        } catch {
          return res.status(400).send("Invalid JSON");
        }
      }
      await saveData(body);
      return res.status(200).end();
    }
    res.setHeader("Allow", "GET, POST");
    return res.status(405).end();
  } catch (e) {
    return res.status(e.status || 500).json({ error: e.message });
  }
}
