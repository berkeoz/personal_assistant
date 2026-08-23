// Loads/saves the whole task-manager blob (columns, projects, tasks,
// calendarConnections) as a single JSON value in Vercel KV, replacing the
// original tasks.json file used by the local .NET version.

import { kvGet, kvSet } from "./kv.js";

const KEY = "personal-assistant-data";

function defaultData() {
  const pid = crypto.randomUUID();
  return {
    columns: [
      { id: "todo", name: "Todo", color: "#94a3b8" },
      { id: "inprogress", name: "In Progress", color: "#6c8eff" },
      { id: "done", name: "Done", color: "#34d399" },
    ],
    projects: [{ id: pid, name: "Personal", color: "#6c8eff" }],
    tasks: [
      { id: crypto.randomUUID(), text: "Welcome!", status: "todo", projectIds: [pid], dueDate: null, tags: [] },
    ],
    calendarConnections: [],
  };
}

export async function loadData() {
  let data = await kvGet(KEY);
  if (!data) {
    data = defaultData();
    await kvSet(KEY, data);
    return data;
  }
  let changed = false;
  if (!data.columns) { data.columns = defaultData().columns; changed = true; }
  if (!data.projects) { data.projects = []; changed = true; }
  if (!data.tasks) { data.tasks = []; changed = true; }
  if (!data.calendarConnections) { data.calendarConnections = []; changed = true; }
  if (changed) await kvSet(KEY, data);
  return data;
}

export async function saveData(data) {
  await kvSet(KEY, data);
}
