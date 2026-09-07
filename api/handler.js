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
  const [resource, id, sub, subId] = segs;

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

  const TEAM_COLORS = ["#6c8eff", "#a78bfa", "#34d399", "#fbbf24", "#f87171", "#fb923c", "#38bdf8", "#f472b6", "#94a3b8"];

  // A column counts as "done" if its name says so (matches the client's
  // isCompleted() heuristic) — used to stamp/clear completedAt so History
  // views can sort by when a task actually finished.
  function isDoneColumn(columns, colId) {
    const col = (columns || []).find((c) => c.id === colId);
    if (!col) return false;
    const n = col.name.toLowerCase();
    return n === "done" || n.includes("archive") || n.includes("complet");
  }
  function stampCompletion(task, columns) {
    if (isDoneColumn(columns, task.status)) {
      if (!task.completedAt) task.completedAt = new Date().toISOString();
    } else if (task.completedAt) {
      delete task.completedAt;
    }
  }

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
        stampCompletion(task, data.columns);
        data.tasks.push(task);
        await saveData(data);
        return ok(task);
      }
      const task = data.tasks.find((t) => t.id === id);
      if (req.method === "PATCH") {
        if (!task) return notFound();
        Object.assign(task, body);
        stampCompletion(task, data.columns);
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
      const proj = data.projects.find((p) => p.id === id);
      if (req.method === "PATCH") {
        if (!proj) return notFound();
        Object.assign(proj, body);
        await saveData(data);
        return ok(proj);
      }
      if (req.method !== "DELETE") return methodNotAllowed("PATCH, DELETE");
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
          parentId: (body && body.parentId) || null,
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
        // Ungroup rather than delete children — losing a whole group's
        // history because its parent got removed would be surprising.
        data.habits.forEach((h) => { if (h.parentId === id) h.parentId = null; });
        await saveData(data);
        return noContent();
      }
      return methodNotAllowed("PATCH, DELETE");
    }

    // ── /api/events ──────────────────────────────────
    // Calendar events — one-time (recurrence.type "once", with a "date") or
    // repeating daily/weekly/monthly. Shown on the Calendar/Today/Week views
    // but deliberately NOT tasks (no status, no checkbox, don't count
    // toward task stats).
    if (resource === "events") {
      const data = await loadData();
      if (!id) {
        if (req.method !== "POST") return methodNotAllowed("POST");
        const event = {
          id: crypto.randomUUID(),
          text: (body && body.text) || "Untitled Event",
          time: (body && body.time) || null,
          endTime: (body && body.endTime) || null,
          color: (body && body.color) || "#6c8eff",
          recurrence: (body && body.recurrence) || { type: "daily" },
        };
        data.recurringEvents.push(event);
        await saveData(data);
        return ok(event);
      }
      const event = data.recurringEvents.find((e) => e.id === id);
      if (req.method === "PATCH") {
        if (!event) return notFound();
        Object.assign(event, body);
        await saveData(data);
        return ok(event);
      }
      if (req.method === "DELETE") {
        if (!event) return notFound();
        data.recurringEvents = data.recurringEvents.filter((e) => e.id !== id);
        await saveData(data);
        return noContent();
      }
      return methodNotAllowed("PATCH, DELETE");
    }

    // ── /api/settings ──────────────────────────────
    // A small free-form bag for UI preferences that should sync across
    // devices (e.g. which Kanban columns are hidden) — PATCH merges keys in.
    if (resource === "settings" && !id) {
      const data = await loadData();
      if (req.method === "GET") return ok(data.settings || {});
      if (req.method === "PATCH") {
        data.settings = { ...(data.settings || {}), ...body };
        await saveData(data);
        return ok(data.settings);
      }
      return methodNotAllowed("GET, PATCH");
    }

    // ── /api/teamboards ─────────────────────────────
    // Self-contained team Kanban boards (e.g. "Scotiabank"): each has its own
    // member roster, projects, columns and tasks — independent of the
    // personal tasks/projects/columns above.
    if (resource === "teamboards") {
      const data = await loadData();

      if (!id) {
        if (req.method !== "POST") return methodNotAllowed("POST");
        const memberNames = Array.isArray(body?.memberNames) ? body.memberNames : [];
        const board = {
          id: crypto.randomUUID(),
          name: (body && body.name) || "Untitled Team",
          members: memberNames.filter(Boolean).map((name, i) => ({
            id: crypto.randomUUID(),
            name,
            color: TEAM_COLORS[i % TEAM_COLORS.length],
          })),
          projects: [],
          columns: [
            { id: "todo", name: "To Do", color: "#94a3b8" },
            { id: "inprogress", name: "In Progress", color: "#6c8eff" },
            { id: "review", name: "Review", color: "#fbbf24" },
            { id: "done", name: "Done", color: "#34d399" },
          ],
          tasks: [],
          hiddenColumnIds: [],
        };
        data.teamBoards.push(board);
        await saveData(data);
        return ok(board);
      }

      const board = data.teamBoards.find((b) => b.id === id);
      if (!board) return notFound();

      // Board-level: rename, replace columns/hiddenColumnIds, etc.
      if (!sub) {
        if (req.method === "PATCH") {
          Object.assign(board, body);
          await saveData(data);
          return ok(board);
        }
        if (req.method === "DELETE") {
          data.teamBoards = data.teamBoards.filter((b) => b.id !== id);
          await saveData(data);
          return noContent();
        }
        return methodNotAllowed("PATCH, DELETE");
      }

      if (sub === "members") {
        if (!subId) {
          if (req.method !== "POST") return methodNotAllowed("POST");
          const member = {
            id: crypto.randomUUID(),
            name: (body && body.name) || "Unnamed",
            color: (body && body.color) || TEAM_COLORS[board.members.length % TEAM_COLORS.length],
          };
          board.members.push(member);
          await saveData(data);
          return ok(member);
        }
        const member = board.members.find((m) => m.id === subId);
        if (req.method === "PATCH") {
          if (!member) return notFound();
          Object.assign(member, body);
          await saveData(data);
          return ok(member);
        }
        if (req.method === "DELETE") {
          if (!member) return notFound();
          board.members = board.members.filter((m) => m.id !== subId);
          for (const t of board.tasks) if (t.assigneeId === subId) t.assigneeId = null;
          await saveData(data);
          return noContent();
        }
        return methodNotAllowed("PATCH, DELETE");
      }

      if (sub === "projects") {
        if (!subId) {
          if (req.method !== "POST") return methodNotAllowed("POST");
          const proj = { id: crypto.randomUUID(), name: (body && body.name) || "Untitled", color: (body && body.color) || "#6c8eff" };
          board.projects.push(proj);
          await saveData(data);
          return ok(proj);
        }
        const proj = board.projects.find((p) => p.id === subId);
        if (req.method === "PATCH") {
          if (!proj) return notFound();
          Object.assign(proj, body);
          await saveData(data);
          return ok(proj);
        }
        if (req.method !== "DELETE") return methodNotAllowed("PATCH, DELETE");
        board.projects = board.projects.filter((p) => p.id !== subId);
        for (const t of board.tasks) {
          if (Array.isArray(t.projectIds)) t.projectIds = t.projectIds.filter((pid) => pid !== subId);
        }
        await saveData(data);
        return noContent();
      }

      if (sub === "columns") {
        if (!subId) {
          if (req.method !== "POST") return methodNotAllowed("POST");
          const col = { id: crypto.randomUUID(), name: (body && body.name) || "Column", color: (body && body.color) || "#6c8eff" };
          board.columns.push(col);
          await saveData(data);
          return ok(col);
        }
        const col = board.columns.find((c) => c.id === subId);
        if (req.method === "PATCH") {
          if (!col) return notFound();
          Object.assign(col, body);
          await saveData(data);
          return ok(col);
        }
        if (req.method === "DELETE") {
          if (!col) return notFound();
          const remaining = board.columns.find((c) => c.id !== subId);
          const fallback = remaining?.id || subId;
          for (const t of board.tasks) if (t.status === subId) t.status = fallback;
          board.columns = board.columns.filter((c) => c.id !== subId);
          board.hiddenColumnIds = (board.hiddenColumnIds || []).filter((cid) => cid !== subId);
          await saveData(data);
          return noContent();
        }
        return methodNotAllowed("PATCH, DELETE");
      }

      if (sub === "tasks") {
        if (!subId) {
          if (req.method !== "POST") return methodNotAllowed("POST");
          const task = { ...body, id: crypto.randomUUID() };
          if (task.status === undefined) task.status = board.columns[0]?.id;
          if (task.projectIds === undefined) task.projectIds = [];
          if (task.tags === undefined) task.tags = [];
          stampCompletion(task, board.columns);
          board.tasks.push(task);
          await saveData(data);
          return ok(task);
        }
        const task = board.tasks.find((t) => t.id === subId);
        if (req.method === "PATCH") {
          if (!task) return notFound();
          Object.assign(task, body);
          stampCompletion(task, board.columns);
          await saveData(data);
          return ok(task);
        }
        if (req.method === "DELETE") {
          if (!task) return notFound();
          board.tasks = board.tasks.filter((t) => t.id !== subId);
          await saveData(data);
          return noContent();
        }
        return methodNotAllowed("PATCH, DELETE");
      }

      return notFound();
    }

    return notFound();
  } catch (e) {
    return res.status(e.status || 500).json({ error: e.message });
  }
}
