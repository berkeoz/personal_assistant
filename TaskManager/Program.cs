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
var jsonOpts = new JsonSerializerOptions { WriteIndented = true };
const int MaxBackups = 20;

void Backup()
{
    if (!File.Exists(dataFile)) return;
    Directory.CreateDirectory(backupDir);
    var stamp = DateTime.Now.ToString("yyyyMMdd_HHmmss");
    File.Copy(dataFile, Path.Combine(backupDir, $"tasks_{stamp}.json"), overwrite: true);
    // prune oldest backups beyond MaxBackups
    var files = Directory.GetFiles(backupDir, "tasks_*.json")
                         .OrderByDescending(f => f).ToArray();
    foreach (var old in files.Skip(MaxBackups))
        File.Delete(old);
}

JsonObject LoadData()
{
    if (!File.Exists(dataFile))
    {
        var seed = new JsonObject
        {
            ["projects"] = new JsonArray
            {
                new JsonObject
                {
                    ["id"] = Guid.NewGuid().ToString(),
                    ["name"] = "Personal",
                    ["color"] = "#6c8eff",
                    ["tasks"] = new JsonArray
                    {
                        new JsonObject
                        {
                            ["id"] = Guid.NewGuid().ToString(),
                            ["text"] = "Welcome! Edit or delete this task.",
                            ["status"] = "todo",
                            ["dueDate"] = (JsonNode?)null,
                            ["tags"] = new JsonArray()
                        }
                    }
                }
            }
        };
        File.WriteAllText(dataFile, seed.ToJsonString(jsonOpts));
        return seed;
    }
    return JsonNode.Parse(File.ReadAllText(dataFile))!.AsObject();
}

void SaveData(JsonObject data) { Backup(); File.WriteAllText(dataFile, data.ToJsonString(jsonOpts)); }

// GET /api/data
app.MapGet("/api/data", () => Results.Text(File.Exists(dataFile)
    ? File.ReadAllText(dataFile)
    : LoadData().ToJsonString(jsonOpts), "application/json"));

// POST /api/data — full replace
app.MapPost("/api/data", async (HttpRequest req) =>
{
    using var reader = new StreamReader(req.Body);
    var body = await reader.ReadToEndAsync();
    // validate JSON
    try { JsonNode.Parse(body); } catch { return Results.BadRequest("Invalid JSON"); }
    Backup();
    File.WriteAllText(dataFile, body);
    return Results.Ok();
});

// POST /api/projects — add project
app.MapPost("/api/projects", async (HttpRequest req) =>
{
    using var reader = new StreamReader(req.Body);
    var body = await reader.ReadToEndAsync();
    var proj = JsonNode.Parse(body)!.AsObject();
    proj["id"] = Guid.NewGuid().ToString();
    proj["tasks"] = new JsonArray();
    var data = LoadData();
    data["projects"]!.AsArray().Add(proj);
    SaveData(data);
    return Results.Ok(proj);
});

// DELETE /api/projects/{id}
app.MapDelete("/api/projects/{id}", (string id) =>
{
    var data = LoadData();
    var arr = data["projects"]!.AsArray();
    var node = arr.FirstOrDefault(p => p!["id"]?.GetValue<string>() == id);
    if (node != null) arr.Remove(node);
    SaveData(data);
    return Results.Ok();
});

// POST /api/projects/{id}/tasks — add task
app.MapPost("/api/projects/{projectId}/tasks", async (string projectId, HttpRequest req) =>
{
    using var reader = new StreamReader(req.Body);
    var body = await reader.ReadToEndAsync();
    var task = JsonNode.Parse(body)!.AsObject();
    task["id"] = Guid.NewGuid().ToString();
    if (task["status"] == null) task["status"] = "todo";
    if (task["tags"] == null) task["tags"] = new JsonArray();
    var data = LoadData();
    var proj = data["projects"]!.AsArray()
        .FirstOrDefault(p => p!["id"]?.GetValue<string>() == projectId);
    if (proj == null) return Results.NotFound();
    proj["tasks"]!.AsArray().Add(task);
    SaveData(data);
    return Results.Ok(task);
});

// PATCH /api/tasks/{id} — update task fields
app.MapMethods("/api/tasks/{id}", ["PATCH"], async (string id, HttpRequest req) =>
{
    using var reader = new StreamReader(req.Body);
    var body = await reader.ReadToEndAsync();
    var patch = JsonNode.Parse(body)!.AsObject();
    var data = LoadData();
    foreach (var proj in data["projects"]!.AsArray())
    {
        var task = proj!["tasks"]!.AsArray()
            .FirstOrDefault(t => t!["id"]?.GetValue<string>() == id);
        if (task != null)
        {
            foreach (var kv in patch) task.AsObject()[kv.Key] = kv.Value?.DeepClone();
            SaveData(data);
            return Results.Ok(task);
        }
    }
    return Results.NotFound();
});

// DELETE /api/tasks/{id}
app.MapDelete("/api/tasks/{id}", (string id) =>
{
    var data = LoadData();
    foreach (var proj in data["projects"]!.AsArray())
    {
        var arr = proj!["tasks"]!.AsArray();
        var task = arr.FirstOrDefault(t => t!["id"]?.GetValue<string>() == id);
        if (task != null) { arr.Remove(task); SaveData(data); return Results.Ok(); }
    }
    return Results.NotFound();
});

// GET /api/schedule — tasks with due dates sorted by date
app.MapGet("/api/schedule", () =>
{
    var data = LoadData();
    var items = new List<object>();
    foreach (var proj in data["projects"]!.AsArray())
    {
        var projName = proj!["name"]?.GetValue<string>() ?? "";
        var projColor = proj["color"]?.GetValue<string>() ?? "#6c8eff";
        foreach (var t in proj["tasks"]!.AsArray())
        {
            var due = t!["dueDate"]?.GetValue<string>();
            if (!string.IsNullOrEmpty(due))
                items.Add(new { id = t["id"]?.GetValue<string>(), text = t["text"]?.GetValue<string>(), status = t["status"]?.GetValue<string>(), dueDate = due, project = projName, projectColor = projColor });
        }
    }
    items.Sort((a, b) => string.Compare(
        (string)a.GetType().GetProperty("dueDate")!.GetValue(a)!,
        (string)b.GetType().GetProperty("dueDate")!.GetValue(b)!, StringComparison.Ordinal));
    return Results.Json(items);
});

// GET /api/backups — list available backups
app.MapGet("/api/backups", () =>
{
    if (!Directory.Exists(backupDir)) return Results.Json(Array.Empty<object>());
    var files = Directory.GetFiles(backupDir, "tasks_*.json")
                         .OrderByDescending(f => f)
                         .Select(f => new {
                             name = Path.GetFileName(f),
                             size = new FileInfo(f).Length,
                             created = new FileInfo(f).CreationTime.ToString("yyyy-MM-dd HH:mm:ss")
                         });
    return Results.Json(files);
});

// POST /api/backups/restore/{name} — restore a backup
app.MapPost("/api/backups/restore/{name}", (string name) =>
{
    var src = Path.Combine(backupDir, name);
    if (!File.Exists(src) || !name.StartsWith("tasks_") || !name.EndsWith(".json"))
        return Results.BadRequest("Invalid backup name");
    Backup(); // backup current before restoring
    File.Copy(src, dataFile, overwrite: true);
    return Results.Ok();
});

// Backup on startup, then ensure data file exists
Backup();
LoadData();

app.Run("http://localhost:5199");
