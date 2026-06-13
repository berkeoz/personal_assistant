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
