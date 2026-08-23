import { loadData, saveData } from "../../lib/store.js";

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  const { id } = req.query;
  try {
    const data = await loadData();
    const task = data.tasks.find((t) => t.id === id);

    if (req.method === "PATCH") {
      if (!task) return res.status(404).end();
      let body = req.body;
      if (typeof body === "string") body = JSON.parse(body);
      Object.assign(task, body);
      await saveData(data);
      return res.status(200).json(task);
    }

    if (req.method === "DELETE") {
      if (!task) return res.status(404).end();
      data.tasks = data.tasks.filter((t) => t.id !== id);
      await saveData(data);
      return res.status(200).end();
    }

    res.setHeader("Allow", "PATCH, DELETE");
    return res.status(405).end();
  } catch (e) {
    return res.status(e.status || 500).json({ error: e.message });
  }
}
