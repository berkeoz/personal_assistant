using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;

var builder = WebApplication.CreateBuilder(args);
builder.Services.AddCors();
builder.Services.AddHttpClient();
builder.Services.AddSingleton<CalendarSyncService>();
builder.Services.AddHostedService(sp => sp.GetRequiredService<CalendarSyncService>());
var app = builder.Build();

app.UseCors(p => p.AllowAnyOrigin().AllowAnyMethod().AllowAnyHeader());
app.UseDefaultFiles();
app.UseStaticFiles();

var dataFile  = Path.Combine(Directory.GetCurrentDirectory(), "tasks.json");
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

JsonObject LoadData()
{
    JsonObject data;
    if (!File.Exists(dataFile))
    {
        var pid = Guid.NewGuid().ToString();
        data = new JsonObject
        {
            ["columns"]             = new JsonArray {
                new JsonObject { ["id"] = "todo",       ["name"] = "Todo",        ["color"] = "#94a3b8" },
                new JsonObject { ["id"] = "inprogress", ["name"] = "In Progress", ["color"] = "#6c8eff" },
                new JsonObject { ["id"] = "done",       ["name"] = "Done",        ["color"] = "#34d399" }
            },
            ["projects"]            = new JsonArray { new JsonObject { ["id"] = pid, ["name"] = "Personal", ["color"] = "#6c8eff" } },
            ["tasks"]               = new JsonArray { new JsonObject { ["id"] = Guid.NewGuid().ToString(), ["text"] = "Welcome!", ["status"] = "todo", ["projectIds"] = new JsonArray(pid), ["dueDate"] = (JsonNode?)null, ["tags"] = new JsonArray() } },
            ["calendarConnections"] = new JsonArray()
        };
        File.WriteAllText(dataFile, data.ToJsonString(jsonOpts));
        return data;
    }

    data = JsonNode.Parse(File.ReadAllText(dataFile))!.AsObject();

    // Migrate nested tasks → flat
    if (data["tasks"] == null)
    {
        var flat = new JsonArray();
        foreach (var proj in data["projects"]!.AsArray())
        {
            var pid = proj!["id"]?.GetValue<string>() ?? Guid.NewGuid().ToString();
            foreach (var t in proj["tasks"]?.AsArray() ?? new JsonArray())
            {
                var task = t!.AsObject().DeepClone().AsObject();
                task["projectIds"] = new JsonArray(pid);
                if (task["id"]   == null) task["id"]   = Guid.NewGuid().ToString();
                if (task["tags"] == null) task["tags"] = new JsonArray();
                flat.Add(task);
            }
            proj.AsObject().Remove("tasks");
        }
        data["tasks"] = flat;
        File.WriteAllText(dataFile, data.ToJsonString(jsonOpts));
    }
    if (data["columns"]             == null) { data["columns"]             = new JsonArray { new JsonObject { ["id"] = "todo", ["name"] = "Todo", ["color"] = "#94a3b8" }, new JsonObject { ["id"] = "inprogress", ["name"] = "In Progress", ["color"] = "#6c8eff" }, new JsonObject { ["id"] = "done", ["name"] = "Done", ["color"] = "#34d399" } }; File.WriteAllText(dataFile, data.ToJsonString(jsonOpts)); }
    if (data["calendarConnections"] == null) { data["calendarConnections"] = new JsonArray(); File.WriteAllText(dataFile, data.ToJsonString(jsonOpts)); }

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
    foreach (var t in data["tasks"]!.AsArray())
    {
        var ids   = t!["projectIds"]?.AsArray();
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
    var remaining = arr.FirstOrDefault(c => c!["id"]?.GetValue<string>() != id);
    var fallback  = remaining?["id"]?.GetValue<string>() ?? "todo";
    foreach (var t in data["tasks"]!.AsArray())
        if (t!["status"]?.GetValue<string>() == id) t.AsObject()["status"] = fallback;
    arr.Remove(col); SaveData(data); return Results.Ok();
});

// ── Calendar Connections ──────────────────────────────────────────
app.MapGet("/api/calendars", () =>
{
    var data = LoadData();
    return Results.Json(data["calendarConnections"]?.AsArray() ?? new JsonArray());
});

app.MapPost("/api/calendars", async (HttpRequest req) =>
{
    using var r = new StreamReader(req.Body);
    var conn = JsonNode.Parse(await r.ReadToEndAsync())!.AsObject();
    conn["id"]         = Guid.NewGuid().ToString();
    conn["lastSynced"] = (JsonNode?)null;
    conn["status"]     = "pending";
    var data = LoadData();
    data["calendarConnections"]!.AsArray().Add(conn);
    SaveData(data);
    _ = Task.Run(async () =>
    {
        await Task.Delay(500);
        var svc = app.Services.GetRequiredService<CalendarSyncService>();
        await svc.SyncAll();
    });
    return Results.Ok(conn);
});

app.MapDelete("/api/calendars/{id}", (string id) =>
{
    var data     = LoadData();
    var arr      = data["calendarConnections"]!.AsArray();
    var conn     = arr.FirstOrDefault(c => c!["id"]?.GetValue<string>() == id);
    if (conn != null) arr.Remove(conn);
    var tasks    = data["tasks"]!.AsArray();
    var toRemove = tasks.Where(t => t!["calendarId"]?.GetValue<string>() == id).ToList();
    foreach (var t in toRemove) tasks.Remove(t);
    SaveData(data); return Results.Ok();
});

app.MapPost("/api/calendars/{id}/sync", async (string id) =>
{
    var svc = app.Services.GetRequiredService<CalendarSyncService>();
    await svc.SyncAll();
    var data = LoadData();
    var conn = data["calendarConnections"]!.AsArray().FirstOrDefault(c => c!["id"]?.GetValue<string>() == id);
    return conn != null ? Results.Ok(conn) : Results.NotFound();
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

// ── Types (must come after top-level statements) ──────────────────
public class CalendarSyncService(IHttpClientFactory httpFactory) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken ct)
    {
        await Task.Delay(2000, ct);
        await SyncAll(ct);
        using var timer = new PeriodicTimer(TimeSpan.FromHours(1));
        while (!ct.IsCancellationRequested && await timer.WaitForNextTickAsync(ct))
            await SyncAll(ct);
    }

    public async Task SyncAll(CancellationToken ct = default)
    {
        var dataFile = Path.Combine(Directory.GetCurrentDirectory(), "tasks.json");
        var opts     = new JsonSerializerOptions { WriteIndented = true };
        if (!File.Exists(dataFile)) return;
        var data        = JsonNode.Parse(File.ReadAllText(dataFile))!.AsObject();
        var connections = data["calendarConnections"]?.AsArray() ?? new JsonArray();
        if (connections.Count == 0) return;

        bool changed = false;
        foreach (var conn in connections)
        {
            var id  = conn!["id"]?.GetValue<string>();
            var url = conn["url"]?.GetValue<string>();
            if (string.IsNullOrEmpty(url) || string.IsNullOrEmpty(id)) continue;
            try
            {
                var http = httpFactory.CreateClient();
                http.Timeout = TimeSpan.FromSeconds(30);
                var icsText    = await http.GetStringAsync(url, ct);
                var events     = ParseIcs(icsText);
                var tasks      = data["tasks"]!.AsArray();
                var firstColId = data["columns"]!.AsArray().FirstOrDefault()?["id"]?.GetValue<string>() ?? "todo";
                var projId     = conn["projectId"]?.GetValue<string>();
                var projIds    = !string.IsNullOrEmpty(projId) ? new JsonArray(projId) : new JsonArray();

                int added = 0, updated = 0;
                foreach (var ev in events)
                {
                    var calUid   = $"{id}::{ev.Uid}";
                    var dueDate  = ParseIcsDate(ev.DtStart);
                    var existing = tasks.FirstOrDefault(t => t!["calendarUid"]?.GetValue<string>() == calUid);
                    if (existing != null)
                    {
                        existing.AsObject()["text"]    = ev.Summary;
                        existing.AsObject()["dueDate"] = dueDate;
                        if (ev.Description != null) existing.AsObject()["notes"] = ev.Description;
                        updated++;
                    }
                    else
                    {
                        tasks.Add(new JsonObject
                        {
                            ["id"]          = Guid.NewGuid().ToString(),
                            ["text"]        = ev.Summary,
                            ["notes"]       = ev.Description,
                            ["dueDate"]     = dueDate,
                            ["status"]      = firstColId,
                            ["projectIds"]  = projIds.DeepClone(),
                            ["tags"]        = new JsonArray("calendar"),
                            ["calendarUid"] = calUid,
                            ["calendarId"]  = id
                        });
                        added++;
                    }
                }

                conn.AsObject()["lastSynced"] = DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss");
                conn.AsObject()["lastCount"]  = events.Count;
                conn.AsObject()["lastError"]  = (JsonNode?)null;
                conn.AsObject()["status"]     = "ok";
                Console.WriteLine($"[CalSync] {conn["name"]}: +{added} new, ~{updated} updated");
                changed = true;
            }
            catch (Exception ex)
            {
                conn.AsObject()["lastError"] = ex.Message;
                conn.AsObject()["status"]    = "error";
                Console.WriteLine($"[CalSync] {conn["name"]} FAILED: {ex.Message}");
                changed = true;
            }
        }

        if (changed) File.WriteAllText(dataFile, data.ToJsonString(opts));
    }

    private static List<(string Uid, string Summary, string? Description, string? DtStart)> ParseIcs(string icsText)
    {
        var unfolded = Regex.Replace(icsText, "\r?\n[ \t]", "");
        var result   = new List<(string, string, string?, string?)>();
        foreach (var block in unfolded.Split(["BEGIN:VEVENT"], StringSplitOptions.None).Skip(1))
        {
            string? Get(string key)
            {
                var m = Regex.Match(block, $@"^{key}(?:;[^:\r\n]+)?:([^\r\n]+)", RegexOptions.Multiline | RegexOptions.IgnoreCase);
                return m.Success ? m.Groups[1].Value.Trim()
                    .Replace("\\n", "\n").Replace("\\N", "\n")
                    .Replace("\\,", ",").Replace("\\;", ";").Replace("\\\\", "\\") : null;
            }
            result.Add((Get("UID") ?? Guid.NewGuid().ToString(), Get("SUMMARY") ?? "Untitled Event", Get("DESCRIPTION"), Get("DTSTART")));
        }
        return result;
    }

    private static string? ParseIcsDate(string? dtstart)
    {
        if (dtstart == null) return null;
        var d = Regex.Replace(dtstart, "[^0-9]", "");
        if (d.Length < 8) return null;
        var date = $"{d[..4]}-{d[4..6]}-{d[6..8]}";
        return d.Length >= 12 ? $"{date}T{d[8..10]}:{d[10..12]}" : date;
    }
}
