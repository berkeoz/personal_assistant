# Personal Assistant - Task Manager

A lightweight local task manager with a web UI. Stores tasks in a plain `tasks.md` file.

## Requirements

- [.NET 8 SDK](https://dotnet.microsoft.com/download/dotnet/8.0)

## Run

```powershell
.\Start.ps1
```

Opens automatically at `http://localhost:5199`.

## Features

- **Task List** — add, complete, delete tasks. Filter by All / Pending / Done. Tag tasks with `#tag`.
- **Markdown Editor** — edit `tasks.md` directly in the browser.
- **Summary** — stats and pending task overview.

## tasks.md format

Standard markdown checkboxes:

```markdown
# Tasks

- [ ] Pending task
- [x] Completed task
- [ ] Tagged task #work
```

The file is created automatically on first run and is excluded from git (add your own tasks without committing them).

## Running on Vercel

The repo root also contains a Vercel-ready port of the app: the same `index.html`
UI, backed by serverless functions in `api/` (instead of the .NET API) that store
data in Vercel KV (instead of `tasks.json`). `TaskManager/` (the local .NET app)
is untouched and still works with `Start.ps1`.

1. Import this repo in Vercel (New Project → this GitHub repo).
2. Attach a KV store to the project (Storage tab → Create → KV) — this sets the
   `KV_REST_API_URL` / `KV_REST_API_TOKEN` env vars the API routes need.
3. Deploy. No build step or dependencies required.

Calendar sync (`api/calendars/*`) runs on-demand ("Sync now" in the UI) rather
than on an hourly timer, since serverless functions don't run background
processes the way the local .NET host does.
