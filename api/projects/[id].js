import { loadData, saveData } from "../../lib/store.js";

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "DELETE") {
    res.setHeader("Allow", "DELETE");
    return res.status(405).end();
  }
  const { id } = req.query;
  try {
    const data = await loadData();
    data.projects = data.projects.filter((p) => p.id !== id);
    for (const t of data.tasks) {
      if (Array.isArray(t.projectIds)) t.projectIds = t.projectIds.filter((pid) => pid !== id);
    }
    await saveData(data);
    return res.status(200).end();
  } catch (e) {
    return res.status(e.status || 500).json({ error: e.message });
  }
}
