using System.Diagnostics;
using System.ComponentModel;
using System.Net;
using System.Net.Http.Headers;
using System.Net.Sockets;
using System.Text;
using System.Text.Json;

namespace CineForge.Bootstrap;

/// <summary>
/// Small, self-contained Windows host for the portable CineForge build.
///
/// The host deliberately owns only process/bootstrap concerns. The Core remains
/// the authority for project state and the web bundle remains a replaceable UI.
/// It binds to loopback, starts a packaged Core (or a local Python Core during
/// development), serves the static UI, and proxies /v1 requests to Core.
/// </summary>
internal static class Program
{
    private const int DefaultWebPort = 48200;
    private const int DefaultCorePort = 48201;
    private static readonly HttpClient Http = new(new SocketsHttpHandler
    {
        PooledConnectionLifetime = TimeSpan.FromMinutes(2),
        ConnectTimeout = TimeSpan.FromSeconds(2),
    });

    public static async Task<int> Main(string[] args)
    {
        var options = Options.Parse(args);
        var root = Path.GetFullPath(options.Root ?? AppContext.BaseDirectory);
        var dataRoot = Path.GetFullPath(options.DataRoot ??
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "CineForge", "data"));
        Directory.CreateDirectory(dataRoot);
        var logsRoot = Path.Combine(dataRoot, "logs");
        Directory.CreateDirectory(logsRoot);

        var webRoot = ResolveWebRoot(root);
        if (!Directory.Exists(webRoot))
        {
            Console.Error.WriteLine($"CineForge web bundle is missing: {webRoot}");
            Console.Error.WriteLine("Run packaging\\build_windows.ps1 first, or copy the Vite dist folder to web\\.");
            return 2;
        }

        var corePort = PickPort(options.CorePort ?? DefaultCorePort);
        var webPort = PickPort(options.WebPort ?? DefaultWebPort, corePort);
        var coreBase = new Uri($"http://127.0.0.1:{corePort}");
        using var lifetime = new CancellationTokenSource();
        Console.CancelKeyPress += (_, eventArgs) =>
        {
            eventArgs.Cancel = true;
            lifetime.Cancel();
        };

        CoreHost? core = null;
        try
        {
            core = StartCore(root, dataRoot, corePort, logsRoot);
            if (core is null)
            {
                Console.Error.WriteLine("CineForge Core was not found. The UI will open in offline/demo mode.");
            }

            using var listener = new HttpListener();
            var webPrefix = $"http://127.0.0.1:{webPort}/";
            listener.Prefixes.Add(webPrefix);
            listener.Start();

            var transport = core is not null ? await WaitForCoreAsync(core, coreBase, lifetime.Token) : CoreTransport.None;
            var health = new HealthState(webRoot, transport, core);
            Console.WriteLine($"CineForge is ready: {webPrefix}");
            Console.WriteLine($"Core: {(health.CoreReady ? transport.ToString().ToLowerInvariant() : "offline/demo")}; data: {dataRoot}");
            if (!options.NoBrowser)
            {
                OpenBrowser(webPrefix);
            }

            while (!lifetime.IsCancellationRequested)
            {
                var contextTask = listener.GetContextAsync();
                var completed = await Task.WhenAny(contextTask, Task.Delay(250, lifetime.Token));
                if (completed != contextTask) continue;
                _ = HandleRequestAsync(await contextTask, webRoot, coreBase, health, lifetime.Token);
            }
        }
        catch (HttpListenerException ex)
        {
            Console.Error.WriteLine($"CineForge web host could not start: {ex.Message}");
            return 3;
        }
        catch (OperationCanceledException) when (lifetime.IsCancellationRequested)
        {
            // Normal shutdown.
        }
        finally
        {
            lifetime.Cancel();
            core?.Dispose();
        }

        return 0;
    }

    private static string ResolveWebRoot(string root)
    {
        var candidates = new[]
        {
            Path.Combine(root, "web"),
            Path.Combine(root, "app", "dist"),
            Path.Combine(root, "dist", "web"),
        };
        return candidates.FirstOrDefault(Directory.Exists) ?? candidates[0];
    }

    private static int PickPort(int preferred, params int[] excluded)
    {
        var candidates = Enumerable.Range(Math.Max(1024, preferred), 40)
            .Where(port => !excluded.Contains(port));
        foreach (var port in candidates)
        {
            try
            {
                using var probe = new TcpListener(IPAddress.Loopback, port);
                probe.Start();
                probe.Stop();
                return port;
            }
            catch (SocketException)
            {
                // Another instance owns the port. Try the next deterministic port.
            }
        }

        throw new InvalidOperationException("No available loopback port in the CineForge port range.");
    }

    private static CoreHost? StartCore(string root, string dataRoot, int port, string logsRoot)
    {
        var database = Path.Combine(dataRoot, "cineforge.sqlite3");
        var runtimeRoot = Path.Combine(root, "runtime");
        var nodeServerCandidates = new[]
        {
            Path.Combine(runtimeRoot, "core", "server.mjs"),
            Path.Combine(root, "core", "server.mjs"),
        };
        var nodeServer = nodeServerCandidates.FirstOrDefault(File.Exists);
        if (nodeServer is not null)
        {
            var bundledNode = new[]
            {
                Path.Combine(runtimeRoot, "node.exe"),
                Path.Combine(root, "node.exe"),
            }.FirstOrDefault(File.Exists);
            var node = bundledNode ?? FindExecutableOnPath("node");
            if (node is not null)
            {
                var nodeWorkingDirectory = Path.GetDirectoryName(nodeServer) ?? runtimeRoot;
                var nodeStart = new ProcessStartInfo(node)
                {
                    WorkingDirectory = nodeWorkingDirectory,
                    UseShellExecute = false,
                    CreateNoWindow = true,
                };
                nodeStart.ArgumentList.Add(nodeServer);
                AddServerArguments(nodeStart, database, port);
                return StartProcess(nodeStart, logsRoot);
            }
            Console.Error.WriteLine("Core server.mjs was found, but Node.js is unavailable.");
        }

        var packagedCandidates = new[]
        {
            Path.Combine(runtimeRoot, "CineForgeCore.exe"),
            Path.Combine(runtimeRoot, "CineForgeCore", "CineForgeCore.exe"),
            Path.Combine(runtimeRoot, "core.exe"),
            Path.Combine(root, "CineForgeCore.exe"),
        };
        var packaged = packagedCandidates.FirstOrDefault(File.Exists);
        ProcessStartInfo start;
        if (packaged is not null)
        {
            start = new ProcessStartInfo(packaged)
            {
                WorkingDirectory = Path.GetDirectoryName(packaged) ?? runtimeRoot,
                UseShellExecute = false,
                CreateNoWindow = true,
            };
            start.ArgumentList.Add("serve");
        }
        else
        {
            var python = FindPython();
            if (python is null) return null;
            start = new ProcessStartInfo(python.Value.FileName)
            {
                WorkingDirectory = Directory.Exists(Path.Combine(root, "runtime")) ? runtimeRoot : root,
                UseShellExecute = false,
                CreateNoWindow = true,
            };
            foreach (var argument in python.Value.PrefixArguments) start.ArgumentList.Add(argument);
            start.ArgumentList.Add("-m");
            start.ArgumentList.Add("core");
            start.ArgumentList.Add("serve");
            var pythonPath = Path.Combine(root, "runtime");
            if (Directory.Exists(Path.Combine(pythonPath, "core")))
            {
                start.Environment["PYTHONPATH"] = pythonPath;
            }
        }

        AddServerArguments(start, database, port);
        return StartProcess(start, logsRoot);
    }

    private static void AddServerArguments(ProcessStartInfo start, string database, int port)
    {
        start.ArgumentList.Add("--db");
        start.ArgumentList.Add(database);
        start.ArgumentList.Add("--host");
        start.ArgumentList.Add("127.0.0.1");
        start.ArgumentList.Add("--port");
        start.ArgumentList.Add(port.ToString(System.Globalization.CultureInfo.InvariantCulture));
    }

    private static CoreHost? StartProcess(ProcessStartInfo start, string logsRoot)
    {
        start.RedirectStandardOutput = true;
        start.RedirectStandardError = true;

        var process = new Process { StartInfo = start, EnableRaisingEvents = true };
        var logPath = Path.Combine(logsRoot, "core.log");
        var log = new StreamWriter(new FileStream(logPath, FileMode.Append, FileAccess.Write, FileShare.Read)) { AutoFlush = true };
        process.ErrorDataReceived += (_, e) => { if (e.Data is not null) { Console.Error.WriteLine($"[core] {e.Data}"); log.WriteLine(e.Data); } };
        try
        {
            if (!process.Start())
            {
                log.Dispose();
                process.Dispose();
                return null;
            }
            process.BeginErrorReadLine();
            return new CoreHost(process, log);
        }
        catch (Exception ex) when (ex is Win32Exception or InvalidOperationException)
        {
            Console.Error.WriteLine($"Could not start Core: {ex.Message}");
            log.Dispose();
            process.Dispose();
            return null;
        }
    }

    private static string? FindExecutableOnPath(string name)
    {
        var path = Environment.GetEnvironmentVariable("PATH") ?? string.Empty;
        foreach (var folder in path.Split(Path.PathSeparator, StringSplitOptions.RemoveEmptyEntries))
        {
            var candidate = Path.Combine(folder.Trim(), name + ".exe");
            if (File.Exists(candidate)) return candidate;
            candidate = Path.Combine(folder.Trim(), name);
            if (File.Exists(candidate)) return candidate;
        }
        return null;
    }

    private static (string FileName, string[] PrefixArguments)? FindPython()
    {
        var localCandidates = new[]
        {
            Path.Combine(AppContext.BaseDirectory, "runtime", "python.exe"),
            Path.Combine(AppContext.BaseDirectory, ".venv", "Scripts", "python.exe"),
        };
        foreach (var candidate in localCandidates)
        {
            if (File.Exists(candidate)) return (candidate, Array.Empty<string>());
        }

        try
        {
            using var probe = Process.Start(new ProcessStartInfo("python")
            {
                ArgumentList = { "--version" },
                UseShellExecute = false,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                CreateNoWindow = true,
            });
            probe?.WaitForExit(3000);
            if (probe is not null && probe.ExitCode == 0) return ("python", Array.Empty<string>());
        }
        catch (Win32Exception) { }

        try
        {
            using var probe = Process.Start(new ProcessStartInfo("py")
            {
                ArgumentList = { "-3", "--version" },
                UseShellExecute = false,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                CreateNoWindow = true,
            });
            probe?.WaitForExit(3000);
            if (probe is not null && probe.ExitCode == 0) return ("py", new[] { "-3" });
        }
        catch (Win32Exception) { }

        return null;
    }

    private static async Task<CoreTransport> WaitForCoreAsync(CoreHost core, Uri coreBase, CancellationToken cancellationToken)
    {
        var deadline = DateTimeOffset.UtcNow.AddSeconds(20);
        while (DateTimeOffset.UtcNow < deadline && !cancellationToken.IsCancellationRequested)
        {
            try
            {
                using var response = await Http.GetAsync(new Uri(coreBase, "/v1/dashboard"), cancellationToken);
                if (response.IsSuccessStatusCode) return CoreTransport.Http;
            }
            catch (HttpRequestException) { }
            catch (TaskCanceledException) when (!cancellationToken.IsCancellationRequested) { }
            try
            {
                using var rpc = await core.SendAsync(new
                {
                    request_id = Guid.NewGuid().ToString("N"),
                    api_version = "1",
                    method = "query.system.health",
                    @params = new { },
                }, cancellationToken);
                if (rpc is not null && rpc.RootElement.TryGetProperty("ok", out var ok) && ok.GetBoolean()) return CoreTransport.Rpc;
            }
            catch (Exception ex) when (ex is IOException or JsonException or InvalidOperationException or TimeoutException) { }
            await Task.Delay(200, cancellationToken);
        }
        return CoreTransport.None;
    }

    private static async Task HandleRequestAsync(HttpListenerContext context, string webRoot, Uri coreBase, HealthState health, CancellationToken cancellationToken)
    {
        try
        {
            var path = context.Request.Url?.AbsolutePath ?? "/";
            if (path.Equals("/healthz", StringComparison.OrdinalIgnoreCase))
            {
                var payload = JsonSerializer.Serialize(new { status = "ok", core = health.CoreReady, web = Directory.Exists(health.WebRoot) });
                await WriteBytesAsync(context.Response, Encoding.UTF8.GetBytes(payload), "application/json; charset=utf-8", 200);
            }
            else if (path.StartsWith("/v1/", StringComparison.OrdinalIgnoreCase) || path.Equals("/v1", StringComparison.OrdinalIgnoreCase))
            {
                if (health.Transport == CoreTransport.Http) await ProxyAsync(context, coreBase, cancellationToken);
                else if (health.Transport == CoreTransport.Rpc && health.Core is not null) await RpcBridgeAsync(context, health.Core, cancellationToken);
                else await WriteBytesAsync(context.Response, Encoding.UTF8.GetBytes("CineForge Core is not ready."), "text/plain; charset=utf-8", 503);
            }
            else
            {
                await ServeStaticAsync(context, webRoot);
            }
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested) { }
        catch (Exception ex)
        {
            Console.Error.WriteLine($"Request failed: {ex.Message}");
            if (context.Response.OutputStream.CanWrite)
            {
                await WriteBytesAsync(context.Response, Encoding.UTF8.GetBytes("CineForge request failed."), "text/plain; charset=utf-8", 500);
            }
        }
        finally
        {
            context.Response.Close();
        }
    }

    private static async Task ProxyAsync(HttpListenerContext context, Uri coreBase, CancellationToken cancellationToken)
    {
        var target = new Uri(coreBase, context.Request.Url!.PathAndQuery);
        using var request = new HttpRequestMessage(new HttpMethod(context.Request.HttpMethod), target);
        if (context.Request.HasEntityBody)
        {
            request.Content = new StreamContent(context.Request.InputStream);
            if (!string.IsNullOrWhiteSpace(context.Request.ContentType))
                request.Content.Headers.ContentType = MediaTypeHeaderValue.Parse(context.Request.ContentType);
        }
        foreach (var headerName in new[] { "Authorization", "Idempotency-Key", "X-Request-Id" })
        {
            var value = context.Request.Headers[headerName];
            if (!string.IsNullOrWhiteSpace(value)) request.Headers.TryAddWithoutValidation(headerName, value);
        }
        // Preserve the versioned command contract through the bootstrap. In
        // particular, idempotency and bearer headers must reach Core so a
        // retry through the packaged host has the same semantics as a direct
        // loopback Core request. Hop-by-hop transport headers are owned by
        // HttpClient and must not be forwarded.
        foreach (var headerName in context.Request.Headers.AllKeys)
        {
            if (string.IsNullOrWhiteSpace(headerName) || headerName.Equals("Host", StringComparison.OrdinalIgnoreCase) ||
                headerName.Equals("Connection", StringComparison.OrdinalIgnoreCase) || headerName.Equals("Content-Length", StringComparison.OrdinalIgnoreCase)) continue;
            var headerValue = context.Request.Headers[headerName];
            if (string.IsNullOrWhiteSpace(headerValue)) continue;
            if (!request.Headers.TryAddWithoutValidation(headerName, headerValue) && request.Content is not null)
                request.Content.Headers.TryAddWithoutValidation(headerName, headerValue);
        }
        using var response = await Http.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, cancellationToken);
        context.Response.StatusCode = (int)response.StatusCode;
        if (response.Content.Headers.ContentType is not null)
            context.Response.ContentType = response.Content.Headers.ContentType.ToString();
        foreach (var header in response.Headers)
        {
            try { context.Response.Headers[header.Key] = string.Join(", ", header.Value); } catch (ArgumentException) { }
        }
        var bytes = await response.Content.ReadAsByteArrayAsync(cancellationToken);
        await context.Response.OutputStream.WriteAsync(bytes, cancellationToken);
    }

    private static async Task RpcBridgeAsync(HttpListenerContext context, CoreHost core, CancellationToken cancellationToken)
    {
        var path = context.Request.Url?.AbsolutePath ?? string.Empty;
        var method = context.Request.HttpMethod.ToUpperInvariant();
        if (method == "GET" && path.Equals("/v1/dashboard", StringComparison.OrdinalIgnoreCase))
        {
            using var response = await core.SendAsync(new
            {
                request_id = Guid.NewGuid().ToString("N"), api_version = "1", method = "query.home", @params = new { },
            }, cancellationToken);
            if (response is null) { await WriteBytesAsync(context.Response, Encoding.UTF8.GetBytes("Core RPC closed."), "text/plain; charset=utf-8", 503); return; }
            if (!TryRpcResult(response.RootElement, out var result, out var error)) { await WriteBytesAsync(context.Response, Encoding.UTF8.GetBytes(error), "application/json; charset=utf-8", 502); return; }
            await WriteJsonAsync(context.Response, MapDashboard(result), 200);
            return;
        }
        if (method == "POST" && path.Equals("/v1/projects", StringComparison.OrdinalIgnoreCase))
        {
            using var body = await ParseRequestBodyAsync(context.Request, cancellationToken);
            var title = ReadString(body, "name") ?? ReadString(body, "title");
            if (string.IsNullOrWhiteSpace(title)) { await WriteBytesAsync(context.Response, Encoding.UTF8.GetBytes("{\"error\":\"name is required\"}"), "application/json; charset=utf-8", 400); return; }
            using var response = await core.SendAsync(new
            {
                request_id = Guid.NewGuid().ToString("N"), api_version = "1", method = "command.execute",
                @params = new { command_type = "CreateProject", payload = new { title } },
            }, cancellationToken);
            var projectError = "Core project creation failed.";
            if (response is null || !TryRpcResult(response.RootElement, out var result, out projectError)) { await WriteBytesAsync(context.Response, Encoding.UTF8.GetBytes(projectError), "application/json; charset=utf-8", 502); return; }
            await WriteJsonAsync(context.Response, MapProject(result), 200);
            return;
        }
        if (method == "POST" && path.StartsWith("/v1/projects/", StringComparison.OrdinalIgnoreCase) && path.EndsWith("/production-items", StringComparison.OrdinalIgnoreCase))
        {
            var projectId = Uri.UnescapeDataString(path["/v1/projects/".Length..^"/production-items".Length]);
            using var body = await ParseRequestBodyAsync(context.Request, cancellationToken);
            var title = ReadString(body, "title");
            if (string.IsNullOrWhiteSpace(projectId) || string.IsNullOrWhiteSpace(title)) { await WriteBytesAsync(context.Response, Encoding.UTF8.GetBytes("{\"error\":\"project and title are required\"}"), "application/json; charset=utf-8", 400); return; }
            using var response = await core.SendAsync(new
            {
                request_id = Guid.NewGuid().ToString("N"), api_version = "1", method = "command.execute",
                @params = new { command_type = "CreateTask", payload = new { project_id = projectId, title } },
            }, cancellationToken);
            var itemError = "Core production item creation failed.";
            if (response is null || !TryRpcResult(response.RootElement, out var result, out itemError)) { await WriteBytesAsync(context.Response, Encoding.UTF8.GetBytes(itemError), "application/json; charset=utf-8", 502); return; }
            await WriteJsonAsync(context.Response, MapProductionItem(result, title), 200);
            return;
        }
        if (method == "POST" && path.StartsWith("/v1/decisions/", StringComparison.OrdinalIgnoreCase) && path.EndsWith("/ack", StringComparison.OrdinalIgnoreCase))
        {
            await WriteBytesAsync(context.Response, Encoding.UTF8.GetBytes("{\"ok\":true}"), "application/json; charset=utf-8", 200);
            return;
        }
        await WriteBytesAsync(context.Response, Encoding.UTF8.GetBytes("{\"error\":\"unsupported endpoint\"}"), "application/json; charset=utf-8", 404);
    }

    private static async Task<JsonDocument> ParseRequestBodyAsync(HttpListenerRequest request, CancellationToken cancellationToken)
    {
        using var reader = new StreamReader(request.InputStream, request.ContentEncoding ?? Encoding.UTF8);
        var text = await reader.ReadToEndAsync(cancellationToken);
        return JsonDocument.Parse(string.IsNullOrWhiteSpace(text) ? "{}" : text);
    }

    private static string? ReadString(JsonDocument document, string property)
    {
        return document.RootElement.TryGetProperty(property, out var value) && value.ValueKind == JsonValueKind.String ? value.GetString() : null;
    }

    private static bool TryRpcResult(JsonElement envelope, out JsonElement result, out string error)
    {
        if (envelope.TryGetProperty("ok", out var ok) && ok.GetBoolean() && envelope.TryGetProperty("result", out result)) { error = string.Empty; return true; }
        result = default;
        error = envelope.TryGetProperty("error", out var detail) ? detail.GetRawText() : "Core request failed.";
        return false;
    }

    private static object MapDashboard(JsonElement result)
    {
        var projects = new List<object>();
        if (result.TryGetProperty("projects", out var rows) && rows.ValueKind == JsonValueKind.Array)
        {
            foreach (var row in rows.EnumerateArray()) projects.Add(MapProject(row));
        }
        return new
        {
            generatedAt = result.TryGetProperty("generated_at", out var generated) ? generated.GetString() : DateTime.UtcNow.ToString("O"),
            projects,
            decisions = Array.Empty<object>(),
            activity = Array.Empty<object>(),
            system = new { connected = true, offline = false, storageUsed = "—", storageTotal = "—", storageAttention = false },
        };
    }

    private static object MapProject(JsonElement source)
    {
        var id = ReadJsonString(source, "id") ?? Guid.NewGuid().ToString("N");
        var name = ReadJsonString(source, "title") ?? ReadJsonString(source, "name") ?? "CineForge project";
        var lifecycle = ReadJsonString(source, "lifecycle_state") ?? "ACTIVE";
        var updated = ReadJsonString(source, "updated_at") ?? ReadJsonString(source, "updatedAt") ?? "Vừa cập nhật";
        return new
        {
            id, name, kind = "Project", updatedAt = updated, stage = lifecycle, stageDetail = ReadJsonString(source, "code") ?? "",
            cover = "linear-gradient(145deg, #7664a9 0%, #35446a 56%, #171c2a 100%)", accent = "#b9a0ff",
            completion = new { done = 0, total = 0 }, health = lifecycle == "TRASHED" ? "blocked" : "healthy",
            nextAction = "Mở dự án", nextActionLabel = "Mở", storage = "—", productionItems = Array.Empty<object>(),
        };
    }

    private static object MapProductionItem(JsonElement source, string title)
    {
        var id = ReadJsonString(source, "id") ?? ReadJsonString(source, "task_id") ?? Guid.NewGuid().ToString("N");
        return new { id, title = ReadJsonString(source, "title") ?? title, detail = "Mới tạo · chưa bắt đầu", state = "todo" };
    }

    private static string? ReadJsonString(JsonElement element, string property)
    {
        return element.TryGetProperty(property, out var value) && value.ValueKind == JsonValueKind.String ? value.GetString() : null;
    }

    private static async Task WriteJsonAsync(HttpListenerResponse response, object payload, int statusCode)
    {
        await WriteBytesAsync(response, JsonSerializer.SerializeToUtf8Bytes(payload), "application/json; charset=utf-8", statusCode);
    }

    private static async Task ServeStaticAsync(HttpListenerContext context, string webRoot)
    {
        var requestPath = context.Request.Url?.AbsolutePath ?? "/";
        var relative = Uri.UnescapeDataString(requestPath.TrimStart('/').Replace('/', Path.DirectorySeparatorChar));
        if (string.IsNullOrWhiteSpace(relative)) relative = "index.html";
        var candidate = Path.GetFullPath(Path.Combine(webRoot, relative));
        var rootWithSeparator = Path.GetFullPath(webRoot).TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar;
        if (!candidate.StartsWith(rootWithSeparator, StringComparison.OrdinalIgnoreCase) || !File.Exists(candidate))
        {
            candidate = Path.Combine(webRoot, "index.html");
        }
        if (!File.Exists(candidate))
        {
            await WriteBytesAsync(context.Response, Encoding.UTF8.GetBytes("CineForge web bundle is missing."), "text/plain; charset=utf-8", 404);
            return;
        }
        await WriteBytesAsync(context.Response, await File.ReadAllBytesAsync(candidate), ContentType(Path.GetExtension(candidate)), 200);
    }

    private static async Task WriteBytesAsync(HttpListenerResponse response, byte[] bytes, string contentType, int statusCode)
    {
        response.StatusCode = statusCode;
        response.ContentType = contentType;
        response.ContentLength64 = bytes.Length;
        await response.OutputStream.WriteAsync(bytes);
    }

    private static string ContentType(string extension) => extension.ToLowerInvariant() switch
    {
        ".html" => "text/html; charset=utf-8",
        ".js" => "text/javascript; charset=utf-8",
        ".css" => "text/css; charset=utf-8",
        ".json" => "application/json; charset=utf-8",
        ".svg" => "image/svg+xml",
        ".png" => "image/png",
        ".jpg" or ".jpeg" => "image/jpeg",
        ".webp" => "image/webp",
        ".woff" => "font/woff",
        ".woff2" => "font/woff2",
        _ => "application/octet-stream",
    };

    private static void OpenBrowser(string url)
    {
        try
        {
            Process.Start(new ProcessStartInfo { FileName = url, UseShellExecute = true });
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine($"Could not open the browser automatically: {ex.Message}");
        }
    }

    private enum CoreTransport
    {
        None,
        Http,
        Rpc,
    }

    private sealed class HealthState
    {
        public HealthState(string webRoot, CoreTransport transport, CoreHost? core)
        {
            WebRoot = webRoot;
            Transport = transport;
            Core = core;
        }

        public string WebRoot { get; }
        public CoreTransport Transport { get; }
        public CoreHost? Core { get; }
        public bool CoreReady => Transport != CoreTransport.None;
    }

    private sealed class CoreHost : IDisposable
    {
        private readonly Process process;
        private readonly StreamWriter log;
        private readonly SemaphoreSlim gate = new(1, 1);

        public CoreHost(Process process, StreamWriter log)
        {
            this.process = process;
            this.log = log;
        }

        public async Task<JsonDocument?> SendAsync(object request, CancellationToken cancellationToken)
        {
            await gate.WaitAsync(cancellationToken);
            try
            {
                if (process.HasExited) return null;
                var json = JsonSerializer.Serialize(request);
                await process.StandardInput.WriteLineAsync(json);
                await process.StandardInput.FlushAsync();
                var line = await process.StandardOutput.ReadLineAsync().WaitAsync(TimeSpan.FromSeconds(10), cancellationToken);
                if (string.IsNullOrWhiteSpace(line)) return null;
                return JsonDocument.Parse(line);
            }
            finally
            {
                gate.Release();
            }
        }

        public void Dispose()
        {
            try { process.StandardInput.Close(); } catch (InvalidOperationException) { }
            try
            {
                if (!process.HasExited)
                {
                    process.Kill(entireProcessTree: true);
                    process.WaitForExit(3000);
                }
            }
            catch (InvalidOperationException) { }
            catch (Win32Exception) { }
            try { process.Dispose(); } catch (InvalidOperationException) { }
            try { log.Dispose(); } catch (ObjectDisposedException) { }
            gate.Dispose();
        }
    }

    private sealed record Options(string? Root, string? DataRoot, int? WebPort, int? CorePort, bool NoBrowser)
    {
        public static Options Parse(string[] args)
        {
            string? root = null;
            string? data = null;
            int? web = null;
            int? core = null;
            var noBrowser = false;
            for (var i = 0; i < args.Length; i++)
            {
                switch (args[i])
                {
                    case "--root" when i + 1 < args.Length: root = args[++i]; break;
                    case "--data" when i + 1 < args.Length: data = args[++i]; break;
                    case "--web-port" when i + 1 < args.Length && int.TryParse(args[++i], out var parsedWeb): web = parsedWeb; break;
                    case "--core-port" when i + 1 < args.Length && int.TryParse(args[++i], out var parsedCore): core = parsedCore; break;
                    case "--no-browser": noBrowser = true; break;
                    case "--help" or "-h":
                        Console.WriteLine("CineForge [--root DIR] [--data DIR] [--web-port PORT] [--core-port PORT] [--no-browser]");
                        Environment.Exit(0);
                        break;
                }
            }
            return new Options(root, data, web, core, noBrowser);
        }
    }
}
