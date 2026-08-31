import { loadData, saveData } from "../../lib/store.js";

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  const { id } = req.query;
  try {
    const data = await loadData();
    const map = data.mindmaps.find((m) => m.id === id);

    if (req.method === "PATCH") {
      if (!map) return res.status(404).end();
      let body = req.body;
      if (typeof body === "string") body = JSON.parse(body);
      Object.assign(map, body);
      await saveData(data);
      return res.status(200).json(map);
    }

    if (req.method === "DELETE") {
      if (!map) return res.status(404).end();
      data.mindmaps = data.mindmaps.filter((m) => m.id !== id);
      await saveData(data);
      return res.status(200).end();
    }

    res.setHeader("Allow", "PATCH, DELETE");
    return res.status(405).end();
  } catch (e) {
    return res.status(e.status || 500).json({ error: e.message });
  }
}
