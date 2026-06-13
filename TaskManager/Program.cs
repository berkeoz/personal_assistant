var builder = WebApplication.CreateBuilder(args);
builder.Services.AddCors();
var app = builder.Build();

app.UseCors(p => p.AllowAnyOrigin().AllowAnyMethod().AllowAnyHeader());
app.UseDefaultFiles();
app.UseStaticFiles();

var tasksFile = Path.Combine(Directory.GetCurrentDirectory(), "tasks.md");
if (!File.Exists(tasksFile))
    File.WriteAllText(tasksFile, "# Tasks\n\n- [ ] My first task\n");

// GET /api/tasks — return raw markdown
app.MapGet("/api/tasks", () => Results.Text(File.ReadAllText(tasksFile), "text/plain"));

// POST /api/tasks — save raw markdown
app.MapPost("/api/tasks", async (HttpRequest req) =>
{
    using var reader = new StreamReader(req.Body);
    var body = await reader.ReadToEndAsync();
    File.WriteAllText(tasksFile, body);
    return Results.Ok();
});

// GET /api/summary — parse checkbox tasks into structured JSON
app.MapGet("/api/summary", () =>
{
    var lines = File.ReadAllLines(tasksFile);
    var tasks = lines
        .Where(l => l.Trim().StartsWith("- ["))
        .Select(l =>
        {
            var t = l.Trim();
            var done = t.Length > 4 && t[3] != ' ';
            var text = t.Length > 5 ? t[5..].Trim() : "";
            return new { text, done };
        })
        .ToList();

    return Results.Json(new
    {
        total = tasks.Count,
        completed = tasks.Count(t => t.done),
        pending = tasks.Count(t => !t.done),
        tasks
    });
});

app.Run("http://localhost:5199");
