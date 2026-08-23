import { loadData, saveData } from "../../lib/store.js";

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).end();
  }
  try {
    let body = req.body;
    if (typeof body === "string") body = JSON.parse(body);
    const data = await loadData();
    const col = { ...body, id: crypto.randomUUID() };
    data.columns.push(col);
    await saveData(data);
    return res.status(200).json(col);
  } catch (e) {
    return res.status(e.status || 500).json({ error: e.message });
  }
}
