import { loadData, saveData } from "../../../lib/store.js";

// Toggles a single YYYY-MM-DD entry for a habit on/off. A dedicated
// endpoint (rather than the client sending a full replacement `entries`
// map) keeps this a small, targeted mutation.
export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).end();
  }
  const { id } = req.query;
  try {
    let body = req.body;
    if (typeof body === "string") body = JSON.parse(body);
    const date = body && body.date;
    if (!date) return res.status(400).json({ error: "Missing date" });

    const data = await loadData();
    const habit = data.habits.find((h) => h.id === id);
    if (!habit) return res.status(404).end();
    if (!habit.entries) habit.entries = {};

    if (habit.entries[date]) delete habit.entries[date];
    else habit.entries[date] = true;

    await saveData(data);
    return res.status(200).json(habit);
  } catch (e) {
    return res.status(e.status || 500).json({ error: e.message });
  }
}
