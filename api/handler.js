// Single catch-all API handler for everything under /api/*.
//
// Vercel's Hobby plan caps a deployment at 12 Serverless Functions; this app
// has grown past that if every resource gets its own file (tasks, columns,
// projects, calendars, mindmaps, habits...). Routing every request through
// one function keeps the count at 1 regardless of how many resources this
// app grows to, at the cost of the route dispatch living here instead of
// being expressed as separate files.
//
// This is a plain (non-bracket) filename because Vercel's file-based
// `[...catchAll].js` routing convention is a Next.js-specific feature and
// does not route on a plain/framework-less Vercel Functions project (it
// deploys fine but nothing ever matches it). Instead, vercel.json rewrites
// every /api/* request here with the original path in the `path` query
// param, which this handler splits into segments itself.

import { loadData, saveData } from "../lib/store.js";
import { syncConnection, syncAll } from "../lib/ics.js";

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  const rawPath = req.query.path;
  const segs = Array.isArray(rawPath)
    ? rawPath
    : typeof rawPath === "string"
    ? rawPath.split("/").filter(Boolean)
    : [];
  const [resource, id, sub] = segs;

  let body = req.body;
  if (typeof body === "string") {
    try {
      body = body ? JSON.parse(body) : undefined;
    } catch {
      body = undefined;
    }
  }

  const ok = (v, code = 200) => res.status(code).json(v);
  const noContent = (code = 200) => res.status(code).end();
  const notFound = () => res.status(404).end();
  const badRequest = (msg) => res.status(400).json({ error: msg });
  const methodNotAllowed = (allow) => {
    res.setHeader("Allow", allow);
    return res.status(405).end();
  };

  try {
    // ── /api/data ──────────────────────────────────
    if (resource === "data" && !id) {
      if (req.method === "GET") return ok(await loadData());
      if (req.method === "POST") {
        if (body === undefined) return badRequest("Invalid JSON");
        await saveData(body);
        return noContent();
      }
      return methodNotAllowed("GET, POST");
    }

    // ── /api/tasks ─────────────────────────────────
    if (resource === "tasks") {
      const data = await loadData();
      if (!id) {
        if (req.method !== "POST") return methodNotAllowed("POST");
        const task = { ...body, id: crypto.randomUUID() };
        if (task.status === undefined) task.status = "todo";
        if (task.tags === undefined) task.tags = [];
        if (task.projectIds === undefined) task.projectIds = [];
        data.tasks.push(task);
        await saveData(data);
        return ok(task);
      }
      const task = data.tasks.find((t) => t.id === id);
      if (req.method === "PATCH") {
        if (!task) return notFound();
        Object.assign(task, body);
        await saveData(data);
        return ok(task);
      }
      if (req.method === "DELETE") {
        if (!task) return notFound();
        data.tasks = data.tasks.filter((t) => t.id !== id);
        await saveData(data);
        return noContent();
      }
      return methodNotAllowed("PATCH, DELETE");
    }

    // ── /api/columns ───────────────────────────────
    if (resource === "columns") {
      const data = await loadData();
      if (!id) {
        if (req.method !== "POST") return methodNotAllowed("POST");
        const col = { ...body, id: crypto.randomUUID() };
        data.columns.push(col);
        await saveData(data);
        return ok(col);
      }
      const col = data.columns.find((c) => c.id === id);
      if (req.method === "PATCH") {
        if (!col) return notFound();
        Object.assign(col, body);
        await saveData(data);
        return ok(col);
      }
      if (req.method === "DELETE") {
        if (!col) return notFound();
        const remaining = data.columns.find((c) => c.id !== id);
        const fallback = remaining?.id || "todo";
        for (const t of data.tasks) if (t.status === id) t.status = fallback;
        data.columns = data.columns.filter((c) => c.id !== id);
        await saveData(data);
        return noContent();
      }
      return methodNotAllowed("PATCH, DELETE");
    }

    // ── /api/projects ──────────────────────────────
    if (resource === "projects") {
      const data = await loadData();
      if (!id) {
        if (req.method !== "POST") return methodNotAllowed("POST");
        const proj = { ...body, id: crypto.randomUUID() };
        data.projects.push(proj);
        await saveData(data);
        return ok(proj);
      }
      if (req.method !== "DELETE") return methodNotAllowed("DELETE");
      data.projects = data.projects.filter((p) => p.id !== id);
      for (const t of data.tasks) {
        if (Array.isArray(t.projectIds)) t.projectIds = t.projectIds.filter((pid) => pid !== id);
      }
      await saveData(data);
      return noContent();
    }

    // ── /api/calendars ─────────────────────────────
    if (resource === "calendars") {
      const data = await loadData();
      if (!id) {
        if (req.method === "GET") return ok(data.calendarConnections || []);
        if (req.method === "POST") {
          const conn = { ...body, id: crypto.randomUUID(), lastSynced: null, status: "pending" };
          data.calendarConnections.push(conn);
          await syncConnection(data, conn);
          await saveData(data);
          return ok(conn);
        }
        return methodNotAllowed("GET, POST");
      }
      if (sub === "sync") {
        if (req.method !== "POST") return methodNotAllowed("POST");
        await syncAll(data);
        await saveData(data);
        const conn = (data.calendarConnections || []).find((c) => c.id === id);
        if (!conn) return notFound();
        return ok(conn);
      }
      if (req.method !== "DELETE") return methodNotAllowed("DELETE");
      data.calendarConnections = (data.calendarConnections || []).filter((c) => c.id !== id);
      data.tasks = data.tasks.filter((t) => t.calendarId !== id);
      await saveData(data);
      return noContent();
    }

    // ── /api/mindmaps ──────────────────────────────
    if (resource === "mindmaps") {
      const data = await loadData();
      if (!id) {
        if (req.method !== "POST") return methodNotAllowed("POST");
        const map = { id: crypto.randomUUID(), name: (body && body.name) || "Untitled Map", nodes: [], edges: [] };
        data.mindmaps.push(map);
        await saveData(data);
        return ok(map);
      }
      const map = data.mindmaps.find((m) => m.id === id);
      if (req.method === "PATCH") {
        if (!map) return notFound();
        Object.assign(map, body);
        await saveData(data);
        return ok(map);
      }
      if (req.method === "DELETE") {
        if (!map) return notFound();
        data.mindmaps = data.mindmaps.filter((m) => m.id !== id);
        await saveData(data);
        return noContent();
      }
      return methodNotAllowed("PATCH, DELETE");
    }

    // ── /api/habits ────────────────────────────────
    if (resource === "habits") {
      const data = await loadData();
      if (!id) {
        if (req.method !== "POST") return methodNotAllowed("POST");
        const habit = {
          id: crypto.randomUUID(),
          name: (body && body.name) || "Untitled Habit",
          color: (body && body.color) || "#6c8eff",
          schedule: (body && body.schedule) || { type: "daily" },
          entries: {},
          createdAt: new Date().toISOString().slice(0, 10),
        };
        data.habits.push(habit);
        await saveData(data);
        return ok(habit);
      }
      const habit = data.habits.find((h) => h.id === id);
      if (sub === "toggle") {
        if (req.method !== "POST") return methodNotAllowed("POST");
        const date = body && body.date;
        if (!date) return badRequest("Missing date");
        if (!habit) return notFound();
        if (!habit.entries) habit.entries = {};
        if (habit.entries[date]) delete habit.entries[date];
        else habit.entries[date] = true;
        await saveData(data);
        return ok(habit);
      }
      if (req.method === "PATCH") {
        if (!habit) return notFound();
        Object.assign(habit, body);
        await saveData(data);
        return ok(habit);
      }
      if (req.method === "DELETE") {
        if (!habit) return notFound();
        data.habits = data.habits.filter((h) => h.id !== id);
        await saveData(data);
        return noContent();
      }
      return methodNotAllowed("PATCH, DELETE");
    }

    return notFound();
  } catch (e) {
    return res.status(e.status || 500).json({ error: e.message });
  }
}
