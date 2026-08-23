import { loadData, saveData } from "../../lib/store.js";

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  const { id } = req.query;
  try {
    const data = await loadData();
    const col = data.columns.find((c) => c.id === id);

    if (req.method === "PATCH") {
      if (!col) return res.status(404).end();
      let body = req.body;
      if (typeof body === "string") body = JSON.parse(body);
      Object.assign(col, body);
      await saveData(data);
      return res.status(200).json(col);
    }

    if (req.method === "DELETE") {
      if (!col) return res.status(404).end();
      const remaining = data.columns.find((c) => c.id !== id);
      const fallback = remaining?.id || "todo";
      for (const t of data.tasks) if (t.status === id) t.status = fallback;
      data.columns = data.columns.filter((c) => c.id !== id);
      await saveData(data);
      return res.status(200).end();
    }

    res.setHeader("Allow", "PATCH, DELETE");
    return res.status(405).end();
  } catch (e) {
    return res.status(e.status || 500).json({ error: e.message });
  }
}
