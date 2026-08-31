import { loadData, saveData } from "../../lib/store.js";

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  const { id } = req.query;
  try {
    const data = await loadData();
    const habit = data.habits.find((h) => h.id === id);

    if (req.method === "PATCH") {
      if (!habit) return res.status(404).end();
      let body = req.body;
      if (typeof body === "string") body = JSON.parse(body);
      Object.assign(habit, body);
      await saveData(data);
      return res.status(200).json(habit);
    }

    if (req.method === "DELETE") {
      if (!habit) return res.status(404).end();
      data.habits = data.habits.filter((h) => h.id !== id);
      await saveData(data);
      return res.status(200).end();
    }

    res.setHeader("Allow", "PATCH, DELETE");
    return res.status(405).end();
  } catch (e) {
    return res.status(e.status || 500).json({ error: e.message });
  }
}
