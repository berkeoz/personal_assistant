// ICS calendar feed parsing + syncing calendar events into tasks.
// Ported from the original CalendarSyncService in TaskManager/Program.cs.

function unfold(text) {
  return text.replace(/\r?\n[ \t]/g, "");
}

function getField(block, key) {
  const re = new RegExp(`^${key}(?:;[^:\\r\\n]+)?:([^\\r\\n]+)`, "im");
  const m = block.match(re);
  if (!m) return null;
  return m[1]
    .trim()
    .replace(/\\n/g, "\n")
    .replace(/\\N/g, "\n")
    .replace(/\\,/g, ",")
    .replace(/\\;/g, ";")
    .replace(/\\\\/g, "\\");
}

export function parseIcs(icsText) {
  const unfolded = unfold(icsText);
  const blocks = unfolded.split("BEGIN:VEVENT").slice(1);
  return blocks.map((block) => ({
    uid: getField(block, "UID") || crypto.randomUUID(),
    summary: getField(block, "SUMMARY") || "Untitled Event",
    description: getField(block, "DESCRIPTION"),
    dtstart: getField(block, "DTSTART"),
  }));
}

export function parseIcsDate(dtstart) {
  if (!dtstart) return null;
  const d = dtstart.replace(/[^0-9]/g, "");
  if (d.length < 8) return null;
  const date = `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`;
  return d.length >= 12 ? `${date}T${d.slice(8, 10)}:${d.slice(10, 12)}` : date;
}

// Mutates `data` in place: updates/creates tasks from `conn`'s ICS feed and
// updates conn's sync status fields.
export async function syncConnection(data, conn) {
  const firstColId = data.columns[0]?.id || "todo";
  const projIds = conn.projectId ? [conn.projectId] : [];
  try {
    const r = await fetch(conn.url, { signal: AbortSignal.timeout(30000) });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const icsText = await r.text();
    const events = parseIcs(icsText);

    for (const ev of events) {
      const calUid = `${conn.id}::${ev.uid}`;
      const dueDate = parseIcsDate(ev.dtstart);
      const existing = data.tasks.find((t) => t.calendarUid === calUid);
      if (existing) {
        existing.text = ev.summary;
        existing.dueDate = dueDate;
        if (ev.description != null) existing.notes = ev.description;
      } else {
        data.tasks.push({
          id: crypto.randomUUID(),
          text: ev.summary,
          notes: ev.description,
          dueDate,
          status: firstColId,
          projectIds: [...projIds],
          tags: ["calendar"],
          calendarUid: calUid,
          calendarId: conn.id,
        });
      }
    }

    conn.lastSynced = new Date().toISOString().slice(0, 19).replace("T", " ");
    conn.lastCount = events.length;
    conn.lastError = null;
    conn.status = "ok";
  } catch (e) {
    conn.lastError = e.message;
    conn.status = "error";
  }
}

export async function syncAll(data) {
  for (const conn of data.calendarConnections || []) {
    if (!conn.url) continue;
    await syncConnection(data, conn);
  }
}
