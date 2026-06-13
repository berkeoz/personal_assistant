using System.Text.Json;
using System.Text.Json.Nodes;

var builder = WebApplication.CreateBuilder(args);
builder.Services.AddCors();
var app = builder.Build();

app.UseCors(p => p.AllowAnyOrigin().AllowAnyMethod().AllowAnyHeader());
app.UseDefaultFiles();
app.UseStaticFiles();

var dataFile = Path.Combine(Directory.GetCurrentDirectory(), "tasks.json");
var backupDir = Path.Combine(Directory.GetCurrentDirectory(), "backups");
var jsonOpts  = new JsonSerializerOptions { WriteIndented = true };
const int MaxBackups = 20;

void Backup()
{
    if (!File.Exists(dataFile)) return;
    Directory.CreateDirectory(backupDir);
    var stamp = DateTime.Now.ToString("yyyyMMdd_HHmmss");
    File.Copy(dataFile, Path.Combine(backupDir, $"tasks_{stamp}.json"), overwrite: true);
    foreach (var old in Directory.GetFiles(backupDir, "tasks_*.json").OrderByDescending(f => f).Skip(MaxBackups))
        File.Delete(old);
}

// Default columns
static JsonArray DefaultColumns() => new()
{
    new JsonObject { ["id"] = "todo",       ["name"] = "Todo",        ["color"] = "#94a3b8" },
    new JsonObject { ["id"] = "inprogress", ["name"] = "In Progress", ["color"] = "#6c8eff" },
    new JsonObject { ["id"] = "done",       ["name"] = "Done",        ["color"] = "#34d399" }
};

JsonObject LoadData()
{
    JsonObject data;
    if (!File.Exists(dataFile))
    {
        var pid = Guid.NewGuid().ToString();
        data = new JsonObject
        {
            ["columns"]  = DefaultColumns(),
            ["projects"] = new JsonArray { new JsonObject { ["id"] = pid, ["name"] = "Personal", ["color"] = "#6c8eff" } },
            ["tasks"]    = new JsonArray
            {
                new JsonObject { ["id"] = Guid.NewGuid().ToString(), ["text"] = "Welcome! Edit or delete this task.",
                    ["status"] = "todo", ["projectIds"] = new JsonArray(pid), ["dueDate"] = (JsonNode?)null, ["tags"] = new JsonArray() }
            }
        };
        File.WriteAllText(dataFile, data.ToJsonString(jsonOpts));
        return data;
    }

    data = JsonNode.Parse(File.ReadAllText(dataFile))!.AsObject();

    // ── Migrate old format (tasks nested inside projects) ──
    if (data["tasks"] == null)
    {
        var flatTasks = new JsonArray();
        foreach (var proj in data["projects"]!.AsArray())
        {
            var pid = proj!["id"]?.GetValue<string>() ?? Guid.NewGuid().ToString();
            foreach (var t in proj["tasks"]?.AsArray() ?? new JsonArray())
            {
                var task = t!.AsObject().DeepClone().AsObject();
                task["projectIds"] = new JsonArray(pid);
                if (task["id"] == null) task["id"] = Guid.NewGuid().ToString();
                if (task["tags"] == null) task["tags"] = new JsonArray();
                flatTasks.Add(task);
            }
            proj.AsObject().Remove("tasks");
        }
        data["tasks"] = flatTasks;
        File.WriteAllText(dataFile, data.ToJsonString(jsonOpts));
    }

    // Ensure columns exist
    if (data["columns"] == null) { data["columns"] = DefaultColumns(); File.WriteAllText(dataFile, data.ToJsonString(jsonOpts)); }

    return data;
}

void SaveData(JsonObject data) { Backup(); File.WriteAllText(dataFile, data.ToJsonString(jsonOpts)); }

// ── Data ──────────────────────────────────────────────────────────
app.MapGet("/api/data", () => Results.Text(File.Exists(dataFile)
    ? File.ReadAllText(dataFile) : LoadData().ToJsonString(jsonOpts), "application/json"));

app.MapPost("/api/data", async (HttpRequest req) =>
{
    using var r = new StreamReader(req.Body);
    var body = await r.ReadToEndAsync();
    try { JsonNode.Parse(body); } catch { return Results.BadRequest("Invalid JSON"); }
    Backup(); File.WriteAllText(dataFile, body);
    return Results.Ok();
});

// ── Projects ──────────────────────────────────────────────────────
app.MapPost("/api/projects", async (HttpRequest req) =>
{
    using var r = new StreamReader(req.Body);
    var proj = JsonNode.Parse(await r.ReadToEndAsync())!.AsObject();
    proj["id"] = Guid.NewGuid().ToString();
    var data = LoadData();
    data["projects"]!.AsArray().Add(proj);
    SaveData(data); return Results.Ok(proj);
});

app.MapDelete("/api/projects/{id}", (string id) =>
{
    var data = LoadData();
    var arr  = data["projects"]!.AsArray();
    var node = arr.FirstOrDefault(p => p!["id"]?.GetValue<string>() == id);
    if (node != null) arr.Remove(node);
    // remove project from task projectIds
    foreach (var t in data["tasks"]!.AsArray())
    {
        var ids = t!["projectIds"]?.AsArray();
        var match = ids?.FirstOrDefault(x => x?.GetValue<string>() == id);
        if (match != null) ids!.Remove(match);
    }
    SaveData(data); return Results.Ok();
});

// ── Tasks ─────────────────────────────────────────────────────────
app.MapPost("/api/tasks", async (HttpRequest req) =>
{
    using var r = new StreamReader(req.Body);
    var task = JsonNode.Parse(await r.ReadToEndAsync())!.AsObject();
    task["id"] = Guid.NewGuid().ToString();
    if (task["status"]     == null) task["status"]     = "todo";
    if (task["tags"]       == null) task["tags"]       = new JsonArray();
    if (task["projectIds"] == null) task["projectIds"] = new JsonArray();
    var data = LoadData();
    data["tasks"]!.AsArray().Add(task);
    SaveData(data); return Results.Ok(task);
});

app.MapMethods("/api/tasks/{id}", ["PATCH"], async (string id, HttpRequest req) =>
{
    using var r = new StreamReader(req.Body);
    var patch = JsonNode.Parse(await r.ReadToEndAsync())!.AsObject();
    var data  = LoadData();
    var task  = data["tasks"]!.AsArray().FirstOrDefault(t => t!["id"]?.GetValue<string>() == id);
    if (task == null) return Results.NotFound();
    foreach (var kv in patch) task.AsObject()[kv.Key] = kv.Value?.DeepClone();
    SaveData(data); return Results.Ok(task);
});

app.MapDelete("/api/tasks/{id}", (string id) =>
{
    var data = LoadData();
    var arr  = data["tasks"]!.AsArray();
    var task = arr.FirstOrDefault(t => t!["id"]?.GetValue<string>() == id);
    if (task == null) return Results.NotFound();
    arr.Remove(task); SaveData(data); return Results.Ok();
});

// ── Columns ───────────────────────────────────────────────────────
app.MapPost("/api/columns", async (HttpRequest req) =>
{
    using var r = new StreamReader(req.Body);
    var col = JsonNode.Parse(await r.ReadToEndAsync())!.AsObject();
    col["id"] = Guid.NewGuid().ToString();
    var data = LoadData();
    data["columns"]!.AsArray().Add(col);
    SaveData(data); return Results.Ok(col);
});

app.MapMethods("/api/columns/{id}", ["PATCH"], async (string id, HttpRequest req) =>
{
    using var r = new StreamReader(req.Body);
    var patch = JsonNode.Parse(await r.ReadToEndAsync())!.AsObject();
    var data  = LoadData();
    var col   = data["columns"]!.AsArray().FirstOrDefault(c => c!["id"]?.GetValue<string>() == id);
    if (col == null) return Results.NotFound();
    foreach (var kv in patch) col.AsObject()[kv.Key] = kv.Value?.DeepClone();
    SaveData(data); return Results.Ok(col);
});

app.MapDelete("/api/columns/{id}", (string id) =>
{
    var data = LoadData();
    var arr  = data["columns"]!.AsArray();
    var col  = arr.FirstOrDefault(c => c!["id"]?.GetValue<string>() == id);
    if (col == null) return Results.NotFound();
    // move tasks in this column to first remaining column
    var remaining = arr.FirstOrDefault(c => c!["id"]?.GetValue<string>() != id);
    var fallback  = remaining?["id"]?.GetValue<string>() ?? "todo";
    foreach (var t in data["tasks"]!.AsArray())
        if (t!["status"]?.GetValue<string>() == id) t.AsObject()["status"] = fallback;
    arr.Remove(col); SaveData(data); return Results.Ok();
});

// ── Backups ───────────────────────────────────────────────────────
app.MapGet("/api/backups", () =>
{
    if (!Directory.Exists(backupDir)) return Results.Json(Array.Empty<object>());
    return Results.Json(Directory.GetFiles(backupDir, "tasks_*.json")
        .OrderByDescending(f => f)
        .Select(f => new { name = Path.GetFileName(f), size = new FileInfo(f).Length,
                            created = new FileInfo(f).CreationTime.ToString("yyyy-MM-dd HH:mm:ss") }));
});

app.MapPost("/api/backups/restore/{name}", (string name) =>
{
    var src = Path.Combine(backupDir, name);
    if (!File.Exists(src) || !name.StartsWith("tasks_") || !name.EndsWith(".json"))
        return Results.BadRequest("Invalid backup name");
    Backup(); File.Copy(src, dataFile, overwrite: true);
    return Results.Ok();
});

Backup();
LoadData();

app.Run("http://localhost:5199");
