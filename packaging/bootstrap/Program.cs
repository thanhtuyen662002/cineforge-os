using System.Diagnostics;
using System.ComponentModel;
using System.Net;
using System.Net.Http.Headers;
using System.Net.Sockets;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;

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
    private const long MaxStagedUploadBytes = 8L * 1024 * 1024 * 1024;
    private const int MaxStagedFileNameLength = 255;
    private static readonly TimeSpan StagedUploadTtl = TimeSpan.FromHours(24);
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
        PruneStagedUploads(dataRoot);
        var logsRoot = Path.Combine(dataRoot, "logs");
        Directory.CreateDirectory(logsRoot);
        var bootstrapLog = Path.Combine(logsRoot, "bootstrap.log");
        RotateLog(bootstrapLog);
        Log(bootstrapLog, $"startup root={root}; data={dataRoot}; offline={options.AllowOffline}");

        var webRoot = ResolveWebRoot(root);
        if (!Directory.Exists(webRoot))
        {
            var message = $"CineForge web bundle is missing: {webRoot}";
            Log(bootstrapLog, message);
            Console.Error.WriteLine(message);
            Console.Error.WriteLine("Run packaging\\build_windows.ps1 first, or copy the Vite dist folder to web\\.");
            return 2;
        }

        using var lifetime = new CancellationTokenSource();
        Console.CancelKeyPress += (_, eventArgs) =>
        {
            eventArgs.Cancel = true;
            lifetime.Cancel();
        };

        CoreHost? core = null;
        try
        {
            var corePort = PickPort(options.CorePort ?? DefaultCorePort);
            var webPort = PickPort(options.WebPort ?? DefaultWebPort, corePort);
            var coreBase = new Uri($"http://127.0.0.1:{corePort}");
            core = StartCore(root, dataRoot, corePort, logsRoot);
            if (core is null)
            {
                Log(bootstrapLog, "Core was not found or could not be started.");
                Console.Error.WriteLine("CineForge Core was not found or could not be started.");
            }

            var transport = core is not null ? await WaitForCoreAsync(core, coreBase, lifetime.Token) : CoreTransport.None;
            if (transport == CoreTransport.None && !options.AllowOffline)
            {
                var message = "CineForge Core did not become ready. The packaged product refuses to open in demo mode; inspect logs\\bootstrap.log and logs\\core.log.";
                Log(bootstrapLog, message);
                Console.Error.WriteLine(message);
                return 4;
            }

            using var listener = new HttpListener();
            var webPrefix = $"http://127.0.0.1:{webPort}/";
            listener.Prefixes.Add(webPrefix);
            listener.Start();
            using var stopListener = lifetime.Token.Register(() =>
            {
                try { listener.Stop(); } catch (ObjectDisposedException) { }
            });

            var health = new HealthState(webRoot, transport, core, dataRoot, webPort);
            Log(bootstrapLog, $"ready url={webPrefix}; transport={transport}; data={dataRoot}");
            Console.WriteLine($"CineForge is ready: {webPrefix}");
            Console.WriteLine($"Core: {(health.CoreReady ? transport.ToString().ToLowerInvariant() : "offline/demo")}; data: {dataRoot}");
            if (!options.NoBrowser)
            {
                OpenBrowser(webPrefix);
            }

            while (!lifetime.IsCancellationRequested)
            {
                HttpListenerContext context;
                try
                {
                    // Keep exactly one accept operation outstanding. Repeated
                    // polling with GetContextAsync leaves abandoned requests
                    // in HTTP.sys and can make a healthy host appear hung.
                    context = await listener.GetContextAsync();
                }
                catch (HttpListenerException) when (lifetime.IsCancellationRequested)
                {
                    break;
                }
                catch (ObjectDisposedException) when (lifetime.IsCancellationRequested)
                {
                    break;
                }
                _ = HandleRequestAsync(context, webRoot, coreBase, health, bootstrapLog, lifetime.Token);
            }
        }
        catch (HttpListenerException ex)
        {
            Log(bootstrapLog, $"web host failed: {ex}");
            Console.Error.WriteLine($"CineForge web host could not start: {ex.Message}");
            return 3;
        }
        catch (OperationCanceledException) when (lifetime.IsCancellationRequested)
        {
            // Normal shutdown.
        }
        catch (Exception ex)
        {
            Log(bootstrapLog, $"startup failed: {ex}");
            Console.Error.WriteLine($"CineForge startup failed: {ex.Message}");
            return 5;
        }
        finally
        {
            lifetime.Cancel();
            core?.Dispose();
        }

        return 0;
    }

    private static void Log(string path, string message)
    {
        try
        {
            File.AppendAllText(path, $"{DateTimeOffset.UtcNow:O} {message}{Environment.NewLine}");
        }
        catch
        {
            // Diagnostics must never prevent the product from starting.
        }
    }

    private static void RotateLog(string path)
    {
        try
        {
            const long maxBytes = 2 * 1024 * 1024;
            if (!File.Exists(path) || new FileInfo(path).Length <= maxBytes) return;
            var rotated = path + ".1";
            if (File.Exists(rotated)) File.Delete(rotated);
            File.Move(path, rotated);
        }
        catch
        {
            // A locked diagnostics file must never prevent startup.
        }
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
        var hasPackagedRuntime = Directory.Exists(runtimeRoot);
        var nodeServerCandidates = new[]
        {
            Path.Combine(runtimeRoot, "core", "server.mjs"),
            Path.Combine(root, "core", "server.mjs"),
        };
        var nodeServer = nodeServerCandidates.FirstOrDefault(File.Exists);
        if (nodeServer is not null)
        {
            var runtimePrefix = Path.GetFullPath(runtimeRoot).TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar;
            var nodeServerPath = Path.GetFullPath(nodeServer);
            var isPackagedCore = nodeServerPath.StartsWith(runtimePrefix, StringComparison.OrdinalIgnoreCase);
            var bundledNode = new[]
            {
                Path.Combine(runtimeRoot, "node.exe"),
                Path.Combine(root, "node.exe"),
            }.FirstOrDefault(File.Exists);
            // A release bundle must be independent of the developer machine.
            // When the Core lives under runtime/, do not silently fall back to
            // an arbitrary PATH Node.js if the adjacent bundled runtime was
            // removed or quarantined. Source-tree development may still use
            // PATH Node.js when the Core lives under root/core/.
            var node = bundledNode ?? (isPackagedCore ? null : FindExecutableOnPath("node"));
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
            if (isPackagedCore)
            {
                AppendCoreLog(logsRoot, "Bundled Core was found, but runtime\\node.exe is missing; refusing PATH fallback.");
                return null;
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
            if (hasPackagedRuntime)
            {
                AppendCoreLog(logsRoot, "Packaged runtime exists, but no supported Core entrypoint was found; refusing machine-level fallback.");
                return null;
            }
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
            AppendCoreLog(logsRoot, $"Could not start Core: {ex}");
            Console.Error.WriteLine($"Could not start Core: {ex.Message}");
            log.Dispose();
            process.Dispose();
            return null;
        }
    }

    private static void AppendCoreLog(string logsRoot, string message)
    {
        Log(Path.Combine(logsRoot, "core.log"), message);
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

    private static async Task HandleRequestAsync(HttpListenerContext context, string webRoot, Uri coreBase, HealthState health, string bootstrapLog, CancellationToken cancellationToken)
    {
        try
        {
            var path = context.Request.Url?.AbsolutePath ?? "/";
            if (path.Equals("/healthz", StringComparison.OrdinalIgnoreCase))
            {
                var payload = JsonSerializer.Serialize(new
                {
                    status = health.CoreReady ? "ok" : "degraded",
                    core = health.CoreReady,
                    web = Directory.Exists(health.WebRoot),
                    transport = health.Transport.ToString().ToLowerInvariant(),
                    dataRoot = health.DataRoot,
                });
                await WriteBytesAsync(context.Response, Encoding.UTF8.GetBytes(payload), "application/json; charset=utf-8", 200);
            }
            else if (path.Equals("/v1/desktop/stage", StringComparison.OrdinalIgnoreCase) && context.Request.HttpMethod.Equals("POST", StringComparison.OrdinalIgnoreCase))
            {
                if (!health.CoreReady)
                {
                    await WriteJsonAsync(context.Response, new { ok = false, error = new { code = "CORE_NOT_READY", message = "CineForge Core is not ready." } }, 503);
                }
                else if (!IsTrustedBrowserOrigin(context.Request, health.WebOrigin))
                {
                    await WriteJsonAsync(context.Response, new { ok = false, error = new { code = "ORIGIN_NOT_ALLOWED", message = "The file picker request origin is not trusted." } }, 403);
                }
                else
                {
                    await StageBrowserUploadAsync(context, health.DataRoot, cancellationToken);
                }
            }
            else if (path.Equals("/v1/desktop/stage", StringComparison.OrdinalIgnoreCase))
            {
                await WriteJsonAsync(context.Response, new { ok = false, error = new { code = "METHOD_NOT_ALLOWED", message = "Use POST to stage a file." } }, 405);
            }
            else if (path.StartsWith("/v1/", StringComparison.OrdinalIgnoreCase) || path.Equals("/v1", StringComparison.OrdinalIgnoreCase))
            {
                if (RequiresBrowserOrigin(context.Request) && !IsTrustedBrowserOrigin(context.Request, health.WebOrigin))
                {
                    await WriteJsonAsync(context.Response, new { ok = false, error = new { code = "ORIGIN_NOT_ALLOWED", message = "The API mutation origin is not trusted." } }, 403);
                }
                else if (health.Transport == CoreTransport.Http) await ProxyAsync(context, coreBase, health.DataRoot, cancellationToken);
                else if (health.Transport == CoreTransport.Rpc && health.Core is not null) await RpcBridgeAsync(context, health.Core, cancellationToken);
                else await WriteBytesAsync(context.Response, Encoding.UTF8.GetBytes("CineForge Core is not ready."), "text/plain; charset=utf-8", 503);
            }
            else
            {
                await ServeStaticAsync(context, webRoot);
            }
        }
        catch (StageUploadException ex)
        {
            await WriteJsonAsync(context.Response, new { ok = false, error = new { code = ex.Code, message = ex.Message } }, ex.StatusCode);
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested) { }
        catch (Exception ex)
        {
            Log(bootstrapLog, $"request failed: {ex}");
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

    private static async Task ProxyAsync(HttpListenerContext context, Uri coreBase, string dataRoot, CancellationToken cancellationToken)
    {
        var target = new Uri(coreBase, context.Request.Url!.PathAndQuery);
        using var request = new HttpRequestMessage(new HttpMethod(context.Request.HttpMethod), target);
        RewrittenAssetRequest? stagedRequest = null;
        if (IsAssetImportRequest(context.Request))
        {
            var body = await ReadRequestBytesAsync(context.Request, 1 * 1024 * 1024, cancellationToken);
            stagedRequest = RewriteStagedAssetRequest(body, dataRoot, context.Request.Headers["Idempotency-Key"]);
            request.Content = new ByteArrayContent(stagedRequest.Body);
            request.Content.Headers.ContentType = new MediaTypeHeaderValue("application/json");
        }
        else if (context.Request.HasEntityBody)
        {
            request.Content = new StreamContent(context.Request.InputStream);
            if (!string.IsNullOrWhiteSpace(context.Request.ContentType))
                request.Content.Headers.ContentType = MediaTypeHeaderValue.Parse(context.Request.ContentType);
        }
        foreach (var headerName in new[] { "Accept", "Authorization", "Idempotency-Key", "If-Match", "If-None-Match", "X-Request-Id" })
        {
            var value = context.Request.Headers[headerName];
            if (!string.IsNullOrWhiteSpace(value)) request.Headers.TryAddWithoutValidation(headerName, value);
        }
        // Only versioned API headers cross the desktop boundary. Browser
        // cookies, Origin, forwarding headers, and hop-by-hop transport
        // metadata must never reach Core or become part of its trust model.
        using var response = await Http.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, cancellationToken);
        context.Response.StatusCode = (int)response.StatusCode;
        if (response.Content.Headers.ContentType is not null)
            context.Response.ContentType = response.Content.Headers.ContentType.ToString();
        foreach (var header in response.Headers)
        {
            if (header.Key.StartsWith("Access-Control-", StringComparison.OrdinalIgnoreCase)) continue;
            try { context.Response.Headers[header.Key] = string.Join(", ", header.Value); } catch (ArgumentException) { }
        }
        var bytes = await response.Content.ReadAsByteArrayAsync(cancellationToken);
        if (stagedRequest?.Handle is not null && (int)response.StatusCode is >= 200 and < 300)
        {
            try { MarkStagedUploadConsumed(dataRoot, stagedRequest.Handle, stagedRequest.IdempotencyKey!); }
            catch { /* a successful Core command remains canonical if cleanup is interrupted */ }
        }
        await context.Response.OutputStream.WriteAsync(bytes, cancellationToken);
    }

    private static bool IsAssetImportRequest(HttpListenerRequest request)
    {
        if (!request.HttpMethod.Equals("POST", StringComparison.OrdinalIgnoreCase)) return false;
        var path = request.Url?.AbsolutePath ?? string.Empty;
        if (!path.StartsWith("/v1/", StringComparison.OrdinalIgnoreCase) || !path.EndsWith("/assets", StringComparison.OrdinalIgnoreCase)) return false;
        return request.ContentType?.StartsWith("application/json", StringComparison.OrdinalIgnoreCase) == true;
    }

    private static bool IsTrustedBrowserOrigin(HttpListenerRequest request, string webOrigin)
    {
        var origin = request.Headers["Origin"];
        if (string.IsNullOrWhiteSpace(origin)) return false;
        var normalized = origin.TrimEnd('/');
        var originMatches = string.Equals(normalized, webOrigin, StringComparison.OrdinalIgnoreCase) ||
            string.Equals(normalized, webOrigin.Replace("127.0.0.1", "localhost", StringComparison.OrdinalIgnoreCase), StringComparison.OrdinalIgnoreCase);
        if (!originMatches) return false;
        var fetchSite = request.Headers["Sec-Fetch-Site"];
        return string.IsNullOrWhiteSpace(fetchSite) || string.Equals(fetchSite, "same-origin", StringComparison.OrdinalIgnoreCase);
    }

    private static bool RequiresBrowserOrigin(HttpListenerRequest request)
    {
        return request.HttpMethod.Equals("POST", StringComparison.OrdinalIgnoreCase) ||
            request.HttpMethod.Equals("PUT", StringComparison.OrdinalIgnoreCase) ||
            request.HttpMethod.Equals("PATCH", StringComparison.OrdinalIgnoreCase) ||
            request.HttpMethod.Equals("DELETE", StringComparison.OrdinalIgnoreCase);
    }

    private static async Task<byte[]> ReadRequestBytesAsync(HttpListenerRequest request, int maximumBytes, CancellationToken cancellationToken)
    {
        if (request.ContentLength64 > maximumBytes) throw new StageUploadException(413, "REQUEST_TOO_LARGE", "The JSON request is too large.");
        await using var buffer = new MemoryStream();
        var chunk = new byte[64 * 1024];
        var total = 0;
        while (true)
        {
            var read = await request.InputStream.ReadAsync(chunk.AsMemory(), cancellationToken);
            if (read <= 0) break;
            total += read;
            if (total > maximumBytes) throw new StageUploadException(413, "REQUEST_TOO_LARGE", "The JSON request is too large.");
            await buffer.WriteAsync(chunk.AsMemory(0, read), cancellationToken);
        }
        return buffer.ToArray();
    }

    private static RewrittenAssetRequest RewriteStagedAssetRequest(byte[] body, string dataRoot, string? headerIdempotencyKey)
    {
        JsonNode? parsed;
        try { parsed = JsonNode.Parse(body); }
        catch (JsonException) { return new RewrittenAssetRequest(body, null, null); }
        if (parsed is not JsonObject payload || payload["source_handle"] is not JsonValue handleValue || !handleValue.TryGetValue<string>(out var handle) || string.IsNullOrWhiteSpace(handle)) return new RewrittenAssetRequest(body, null, null);
        if (payload.ContainsKey("source_path")) throw new StageUploadException(400, "AMBIGUOUS_SOURCE", "Choose either a staging handle or a local source path, not both.");

        var bodyIdempotencyKey = payload["idempotency_key"] is JsonValue bodyKeyValue && bodyKeyValue.TryGetValue<string>(out var bodyKey) ? bodyKey : null;
        var idempotencyKey = string.IsNullOrWhiteSpace(headerIdempotencyKey) ? bodyIdempotencyKey : headerIdempotencyKey;
        if (string.IsNullOrWhiteSpace(idempotencyKey) || idempotencyKey.Length > 200) throw new StageUploadException(400, "IDEMPOTENCY_REQUIRED", "A bounded Idempotency-Key is required for staged imports.");
        var staged = ResolveStagedUpload(dataRoot, handle, idempotencyKey);
        payload.Remove("source_handle");
        payload["source_path"] = staged.Path;
        payload["storage_mode"] ??= "COPY";
        payload["original_name"] ??= staged.Name;
        if (!string.IsNullOrWhiteSpace(staged.MimeType)) payload["mime_type"] ??= staged.MimeType;
        return new RewrittenAssetRequest(JsonSerializer.SerializeToUtf8Bytes(payload), handle, idempotencyKey);
    }

    private static async Task StageBrowserUploadAsync(HttpListenerContext context, string dataRoot, CancellationToken cancellationToken)
    {
        var filename = SanitizeStagedFileName(DecodeFilenameHeader(context.Request.Headers["X-CineForge-Filename-B64"], context.Request.Headers["X-CineForge-Filename"]));
        var mimeType = (context.Request.ContentType ?? "application/octet-stream").Split(';', 2)[0].Trim();
        if (mimeType.Length > 200 || mimeType.Any(char.IsControl)) mimeType = "application/octet-stream";
        if (context.Request.ContentLength64 > MaxStagedUploadBytes) throw new StageUploadException(413, "SOURCE_TOO_LARGE", "The selected file is larger than the supported 8 GiB limit.");

        var intakeRoot = Path.GetFullPath(Path.Combine(dataRoot, "intake"));
        Directory.CreateDirectory(intakeRoot);
        var handle = Guid.NewGuid().ToString("N");
        var directory = Path.Combine(intakeRoot, handle);
        Directory.CreateDirectory(directory);
        var partial = Path.Combine(directory, "payload.part");
        var payloadPath = Path.Combine(directory, "payload.bin");
        var manifestPath = Path.Combine(directory, "manifest.json");
        try
        {
            long total = 0;
            await using (var output = new FileStream(partial, new FileStreamOptions
            {
                Mode = FileMode.CreateNew,
                Access = FileAccess.Write,
                Share = FileShare.None,
                BufferSize = 1024 * 1024,
                Options = FileOptions.Asynchronous | FileOptions.SequentialScan,
            }))
            {
                var buffer = new byte[1024 * 1024];
                while (true)
                {
                    var read = await context.Request.InputStream.ReadAsync(buffer.AsMemory(), cancellationToken);
                    if (read <= 0) break;
                    total += read;
                    if (total > MaxStagedUploadBytes) throw new StageUploadException(413, "SOURCE_TOO_LARGE", "The selected file is larger than the supported 8 GiB limit.");
                    await output.WriteAsync(buffer.AsMemory(0, read), cancellationToken);
                }
                await output.FlushAsync(cancellationToken);
                output.Flush(true);
            }
            File.Move(partial, payloadPath);
            var manifest = new StagedUploadManifest(handle, filename, mimeType, total, "payload.bin", DateTimeOffset.UtcNow);
            var manifestTemp = manifestPath + ".part";
            File.WriteAllText(manifestTemp, JsonSerializer.Serialize(manifest));
            File.Move(manifestTemp, manifestPath);
            await WriteJsonAsync(context.Response, new
            {
                ok = true,
                result = new { handle, name = filename, mimeType, byteSize = total },
            }, 200);
        }
        catch
        {
            try { if (Directory.Exists(directory)) Directory.Delete(directory, true); } catch { }
            throw;
        }
    }

    private static string SanitizeStagedFileName(string? value)
    {
        if (string.IsNullOrWhiteSpace(value)) return "upload.bin";
        if (value.Any(char.IsControl)) throw new StageUploadException(400, "INVALID_FILENAME", "The selected file name is invalid.");
        var name = Path.GetFileName(value.Replace('/', Path.DirectorySeparatorChar).Replace('\\', Path.DirectorySeparatorChar));
        if (string.IsNullOrWhiteSpace(name) || name is "." or "..") throw new StageUploadException(400, "INVALID_FILENAME", "The selected file name is invalid.");
        if (name.Length > MaxStagedFileNameLength) name = name[..MaxStagedFileNameLength];
        return name;
    }

    private static string? DecodeFilenameHeader(string? encoded, string? legacy)
    {
        if (string.IsNullOrWhiteSpace(encoded)) return legacy;
        if (encoded.Length > 4096 || encoded.Any(character => !(char.IsLetterOrDigit(character) || character is '-' or '_')))
            throw new StageUploadException(400, "INVALID_FILENAME", "The selected file name is invalid.");
        try
        {
            var padded = encoded.Replace('-', '+').Replace('_', '/');
            padded = padded.PadRight(padded.Length + ((4 - padded.Length % 4) % 4), '=');
            return new UTF8Encoding(encoderShouldEmitUTF8Identifier: false, throwOnInvalidBytes: true).GetString(Convert.FromBase64String(padded));
        }
        catch (FormatException)
        {
            throw new StageUploadException(400, "INVALID_FILENAME", "The selected file name is invalid.");
        }
        catch (DecoderFallbackException)
        {
            throw new StageUploadException(400, "INVALID_FILENAME", "The selected file name is invalid.");
        }
    }

    private static StagedUpload ResolveStagedUpload(string dataRoot, string handle, string? idempotencyKey = null)
    {
        if (handle.Length != 32 || handle.Any(character => !Uri.IsHexDigit(character))) throw new StageUploadException(400, "INVALID_STAGE_HANDLE", "The staging handle is invalid.");
        var intakeRoot = Path.GetFullPath(Path.Combine(dataRoot, "intake"));
        var directory = Path.GetFullPath(Path.Combine(intakeRoot, handle));
        if (!IsWithinDirectory(directory, intakeRoot) || !Directory.Exists(directory)) throw new StageUploadException(404, "STAGE_NOT_FOUND", "The staged file no longer exists.");
        if (IsReparsePoint(directory)) throw new StageUploadException(409, "STAGE_UNTRUSTED", "The staged file location is not trusted.");
        var manifestPath = Path.Combine(directory, "manifest.json");
        if (!File.Exists(manifestPath) || IsReparsePoint(manifestPath)) throw new StageUploadException(404, "STAGE_NOT_FOUND", "The staged file manifest no longer exists.");
        StagedUploadManifest? manifest;
        try { manifest = JsonSerializer.Deserialize<StagedUploadManifest>(File.ReadAllText(manifestPath)); }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException or JsonException or NotSupportedException)
        {
            throw new StageUploadException(409, "STAGE_UNTRUSTED", "The staged file manifest is invalid.");
        }
        if (manifest is null || !string.Equals(manifest.Handle, handle, StringComparison.Ordinal) ||
            string.IsNullOrWhiteSpace(manifest.Name) || manifest.Name.Length > MaxStagedFileNameLength ||
            manifest.Name.Any(char.IsControl) || string.IsNullOrWhiteSpace(manifest.MimeType) || manifest.MimeType.Length > 200 || manifest.MimeType.Any(char.IsControl) ||
            !string.Equals(manifest.RelativePath, "payload.bin", StringComparison.Ordinal) ||
            manifest.ByteSize < 0 || manifest.ByteSize > MaxStagedUploadBytes ||
            manifest.CreatedAtUtc < DateTimeOffset.UtcNow - StagedUploadTtl || manifest.CreatedAtUtc > DateTimeOffset.UtcNow.AddMinutes(5))
            throw new StageUploadException(409, "STAGE_UNTRUSTED", "The staged file manifest is invalid.");
        if (!string.IsNullOrWhiteSpace(manifest.ConsumedIdempotencyKey) && !string.Equals(manifest.ConsumedIdempotencyKey, idempotencyKey, StringComparison.Ordinal))
            throw new StageUploadException(409, "STAGE_CONSUMED", "The staged file has already been imported with another idempotency key.");
        var payloadPath = Path.GetFullPath(Path.Combine(directory, manifest.RelativePath));
        if (!IsWithinDirectory(payloadPath, directory) || !File.Exists(payloadPath) || IsReparsePoint(payloadPath)) throw new StageUploadException(409, "STAGE_UNTRUSTED", "The staged file bytes are not trusted.");
        long size;
        try { size = new FileInfo(payloadPath).Length; }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
        {
            throw new StageUploadException(409, "STAGE_CORRUPT", "The staged file bytes could not be inspected.");
        }
        if (size != manifest.ByteSize || size > MaxStagedUploadBytes) throw new StageUploadException(409, "STAGE_CORRUPT", "The staged file size does not match its manifest.");
        return new StagedUpload(payloadPath, manifest.Name, manifest.MimeType, size, manifest.ConsumedIdempotencyKey);
    }

    private static void MarkStagedUploadConsumed(string dataRoot, string handle, string idempotencyKey)
    {
        var intakeRoot = Path.GetFullPath(Path.Combine(dataRoot, "intake"));
        var directory = Path.GetFullPath(Path.Combine(intakeRoot, handle));
        var manifestPath = Path.Combine(directory, "manifest.json");
        if (!File.Exists(manifestPath) || IsReparsePoint(manifestPath)) return;
        var manifest = JsonSerializer.Deserialize<StagedUploadManifest>(File.ReadAllText(manifestPath));
        if (manifest is null || !string.Equals(manifest.Handle, handle, StringComparison.Ordinal)) return;
        if (string.Equals(manifest.ConsumedIdempotencyKey, idempotencyKey, StringComparison.Ordinal)) return;
        if (!string.IsNullOrWhiteSpace(manifest.ConsumedIdempotencyKey)) return;
        var updated = manifest with { ConsumedIdempotencyKey = idempotencyKey };
        var temporary = manifestPath + ".part";
        File.WriteAllText(temporary, JsonSerializer.Serialize(updated));
        File.Move(temporary, manifestPath, true);
    }

    private static bool IsWithinDirectory(string candidate, string root)
    {
        var normalizedRoot = Path.GetFullPath(root).TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar) + Path.DirectorySeparatorChar;
        return candidate.StartsWith(normalizedRoot, StringComparison.OrdinalIgnoreCase);
    }

    private static bool IsReparsePoint(string path)
    {
        try { return (File.GetAttributes(path) & FileAttributes.ReparsePoint) != 0; }
        catch { return true; }
    }

    private static void PruneStagedUploads(string dataRoot)
    {
        var intakeRoot = Path.Combine(dataRoot, "intake");
        if (!Directory.Exists(intakeRoot)) return;
        try
        {
            foreach (var directoryPath in Directory.EnumerateDirectories(intakeRoot))
            {
                try
                {
                    var info = new DirectoryInfo(directoryPath);
                    if ((info.Attributes & FileAttributes.ReparsePoint) != 0 || DateTime.UtcNow - info.LastWriteTimeUtc < StagedUploadTtl) continue;
                    info.Delete(true);
                }
                catch { /* stale staging cleanup must never block startup */ }
            }
        }
        catch { }
    }

    private static async Task RpcBridgeAsync(HttpListenerContext context, CoreHost core, CancellationToken cancellationToken)
    {
        var path = context.Request.Url?.AbsolutePath ?? string.Empty;
        var method = context.Request.HttpMethod.ToUpperInvariant();
        if (method == "POST" && path.Equals("/v1/commands", StringComparison.OrdinalIgnoreCase))
        {
            using var body = await ParseRequestBodyAsync(context.Request, cancellationToken);
            var commandType = ReadString(body, "command_type");
            if (string.IsNullOrWhiteSpace(commandType)) { await WriteBytesAsync(context.Response, Encoding.UTF8.GetBytes("{\"error\":\"command_type is required\"}"), "application/json; charset=utf-8", 400); return; }
            var payload = body.RootElement.TryGetProperty("payload", out var payloadElement) ? payloadElement.Clone() : JsonSerializer.SerializeToElement(new Dictionary<string, object?>());
            var expectedVersions = body.RootElement.TryGetProperty("expected_versions", out var expectedElement) ? expectedElement.Clone() : JsonSerializer.SerializeToElement(new Dictionary<string, object?>());
            var idempotencyKey = context.Request.Headers["Idempotency-Key"] ?? ReadString(body, "idempotency_key");
            using var response = await core.SendAsync(new
            {
                request_id = Guid.NewGuid().ToString("N"), api_version = "1", method = "command.execute",
                @params = new { command_type = commandType, payload, expected_versions = expectedVersions, idempotency_key = idempotencyKey },
            }, cancellationToken);
            var commandError = "Core command failed.";
            if (response is null || !TryRpcResult(response.RootElement, out var result, out commandError)) { await WriteBytesAsync(context.Response, Encoding.UTF8.GetBytes(commandError), "application/json; charset=utf-8", 409); return; }
            await WriteJsonAsync(context.Response, new { ok = true, result = result.Clone() }, 200);
            return;
        }
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
        if (method == "GET" && path.Equals("/v1/decisions", StringComparison.OrdinalIgnoreCase))
        {
            using var response = await core.SendAsync(new
            {
                request_id = Guid.NewGuid().ToString("N"), api_version = "1", method = "query.needs_you.list",
                @params = new
                {
                    state = context.Request.QueryString["state"] ?? "OPEN",
                    project_id = context.Request.QueryString["project_id"],
                    severity = context.Request.QueryString["severity"],
                    limit = context.Request.QueryString["limit"],
                },
            }, cancellationToken);
            var decisionListError = "Core decision list failed.";
            if (response is null || !TryRpcResult(response.RootElement, out var result, out decisionListError)) { await WriteBytesAsync(context.Response, Encoding.UTF8.GetBytes(decisionListError), "application/json; charset=utf-8", 502); return; }
            await WriteJsonAsync(context.Response, new { ok = true, result = result.Clone() }, 200);
            return;
        }
        if (method == "GET" && path.StartsWith("/v1/decisions/", StringComparison.OrdinalIgnoreCase))
        {
            var decisionId = Uri.UnescapeDataString(path["/v1/decisions/".Length..]);
            if (decisionId.EndsWith("/resolve", StringComparison.OrdinalIgnoreCase) || decisionId.EndsWith("/dismiss", StringComparison.OrdinalIgnoreCase) || decisionId.EndsWith("/ack", StringComparison.OrdinalIgnoreCase))
            {
                await WriteBytesAsync(context.Response, Encoding.UTF8.GetBytes("{\"error\":\"method not allowed\"}"), "application/json; charset=utf-8", 405);
                return;
            }
            using var response = await core.SendAsync(new
            {
                request_id = Guid.NewGuid().ToString("N"), api_version = "1", method = "query.needs_you.get",
                @params = new { decision_request_id = decisionId },
            }, cancellationToken);
            var decisionGetError = "Core decision read failed.";
            if (response is null || !TryRpcResult(response.RootElement, out var result, out decisionGetError)) { await WriteBytesAsync(context.Response, Encoding.UTF8.GetBytes(decisionGetError), "application/json; charset=utf-8", 502); return; }
            await WriteJsonAsync(context.Response, new { ok = true, result = result.Clone() }, 200);
            return;
        }
        if (method == "POST" && path.StartsWith("/v1/decisions/", StringComparison.OrdinalIgnoreCase)
            && (path.EndsWith("/resolve", StringComparison.OrdinalIgnoreCase) || path.EndsWith("/dismiss", StringComparison.OrdinalIgnoreCase)))
        {
            var suffix = path.EndsWith("/resolve", StringComparison.OrdinalIgnoreCase) ? "/resolve" : "/dismiss";
            var decisionId = Uri.UnescapeDataString(path["/v1/decisions/".Length..^suffix.Length]);
            using var body = await ParseRequestBodyAsync(context.Request, cancellationToken);
            var expectedVersion = ReadInt64(body, "expected_decision_version") ?? ReadInt64(body, "decision_version");
            var idempotencyKey = context.Request.Headers["Idempotency-Key"];
            object payload = suffix == "/resolve"
                ? new { decision_request_id = decisionId, choice_id = ReadString(body, "choice_id"), expected_decision_version = expectedVersion }
                : new { decision_request_id = decisionId, expected_decision_version = expectedVersion };
            using var response = await core.SendAsync(new
            {
                request_id = Guid.NewGuid().ToString("N"), api_version = "1", method = "command.execute",
                @params = new { command_type = suffix == "/resolve" ? "ResolveDecisionRequest" : "DismissDecisionRequest", payload, expected_versions = new Dictionary<string, long?> { ["DECISION_REQUEST"] = expectedVersion }, idempotency_key = idempotencyKey },
            }, cancellationToken);
            var decisionCommandError = "Core decision command failed.";
            if (response is null || !TryRpcResult(response.RootElement, out var result, out decisionCommandError)) { await WriteBytesAsync(context.Response, Encoding.UTF8.GetBytes(decisionCommandError), "application/json; charset=utf-8", 409); return; }
            await WriteJsonAsync(context.Response, new { ok = true, result = result.Clone() }, 200);
            return;
        }
        if (method == "POST" && path.StartsWith("/v1/decisions/", StringComparison.OrdinalIgnoreCase) && path.EndsWith("/ack", StringComparison.OrdinalIgnoreCase))
        {
            await WriteBytesAsync(context.Response, Encoding.UTF8.GetBytes("{\"ok\":false,\"error\":{\"code\":\"LEGACY_ACK_UNSUPPORTED\",\"message\":\"Use a canonical decision resolution or dismissal.\"}}"), "application/json; charset=utf-8", 410);
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

    private static long? ReadInt64(JsonDocument document, string property)
    {
        if (!document.RootElement.TryGetProperty(property, out var value)) return null;
        if (value.ValueKind == JsonValueKind.Number && value.TryGetInt64(out var numeric)) return numeric;
        if (value.ValueKind == JsonValueKind.String && long.TryParse(value.GetString(), out numeric)) return numeric;
        return null;
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
        var decisions = new List<JsonElement>();
        if (result.TryGetProperty("needs_you", out var needsYou) && needsYou.ValueKind == JsonValueKind.Array)
        {
            foreach (var row in needsYou.EnumerateArray()) decisions.Add(row.Clone());
        }
        return new
        {
            generatedAt = result.TryGetProperty("generated_at", out var generated) ? generated.GetString() : DateTime.UtcNow.ToString("O"),
            projects,
            decisions,
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
        response.Headers["Cache-Control"] = "no-store";
        response.Headers["X-Content-Type-Options"] = "nosniff";
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

    private sealed class StageUploadException : Exception
    {
        public StageUploadException(int statusCode, string code, string message) : base(message)
        {
            StatusCode = statusCode;
            Code = code;
        }

        public int StatusCode { get; }
        public string Code { get; }
    }

    private sealed record StagedUploadManifest(
        string Handle,
        string Name,
        string MimeType,
        long ByteSize,
        string RelativePath,
        DateTimeOffset CreatedAtUtc,
        string? ConsumedIdempotencyKey = null);

    private sealed record StagedUpload(string Path, string Name, string MimeType, long ByteSize, string? ConsumedIdempotencyKey);

    private sealed record RewrittenAssetRequest(byte[] Body, string? Handle, string? IdempotencyKey);

    private sealed class HealthState
    {
        public HealthState(string webRoot, CoreTransport transport, CoreHost? core, string dataRoot, int webPort)
        {
            WebRoot = webRoot;
            Transport = transport;
            Core = core;
            DataRoot = dataRoot;
            WebOrigin = $"http://127.0.0.1:{webPort}";
        }

        public string WebRoot { get; }
        public CoreTransport Transport { get; }
        public CoreHost? Core { get; }
        public string DataRoot { get; }
        public string WebOrigin { get; }
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

    private sealed record Options(string? Root, string? DataRoot, int? WebPort, int? CorePort, bool NoBrowser, bool AllowOffline)
    {
        public static Options Parse(string[] args)
        {
            string? root = null;
            string? data = null;
            int? web = null;
            int? core = null;
            var noBrowser = false;
            var allowOffline = false;
            for (var i = 0; i < args.Length; i++)
            {
                switch (args[i])
                {
                    case "--root" when i + 1 < args.Length: root = args[++i]; break;
                    case "--data" when i + 1 < args.Length: data = args[++i]; break;
                    case "--web-port" when i + 1 < args.Length && int.TryParse(args[++i], out var parsedWeb): web = parsedWeb; break;
                    case "--core-port" when i + 1 < args.Length && int.TryParse(args[++i], out var parsedCore): core = parsedCore; break;
                    case "--no-browser": noBrowser = true; break;
                    case "--allow-offline": allowOffline = true; break;
                    case "--help" or "-h":
                        Console.WriteLine("CineForge [--root DIR] [--data DIR] [--web-port PORT] [--core-port PORT] [--no-browser] [--allow-offline]");
                        Environment.Exit(0);
                        break;
                }
            }
            return new Options(root, data, web, core, noBrowser, allowOffline);
        }
    }
}
