using System.Diagnostics;
using System.ComponentModel;
using System.IO.Compression;
using System.Net;
using System.Net.Http.Headers;
using System.Net.Sockets;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Globalization;

namespace CineForge.Bootstrap;

/// <summary>
/// Small, self-contained Windows host for the portable and resource-embedded
/// CineForge builds.
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
    private const int AlreadyRunningExitCode = 6;
    private const long MaxStagedUploadBytes = 8L * 1024 * 1024 * 1024;
    private const int MaxStagedFileNameLength = 255;
    private const string SingleInstanceMutexPrefix = "Local\\CineForge.Bootstrap.";
    // The single-file product embeds its payload as a .NET resource. A small
    // generated metadata class carries the SHA-256 digests into the bootstrap
    // at compile time. This avoids appending bytes after a PublishSingleFile
    // bundle (which is not a supported host format).
    private const string EmbeddedPayloadResourceName = "CineForge.payload.zip";
    private const long MaxEmbeddedPayloadBytes = 4L * 1024 * 1024 * 1024;
    private const long MaxEmbeddedUncompressedBytes = 8L * 1024 * 1024 * 1024;
    private const long MaxEmbeddedEntryBytes = 4L * 1024 * 1024 * 1024;
    private const int MaxEmbeddedEntryCount = 20_000;
    private const string EmbeddedPackageCachePrefix = "Local\\CineForge.EmbeddedPackage.";
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

        // A SingleFile build carries its web/Core payload as an authenticated
        // managed resource inside the .NET bundle. Resolve and authenticate
        // that payload before touching the user data directory. An explicit
        // --root always wins for development and for the portable layout.
        EmbeddedPayloadInfo? embeddedPayload = null;
        EmbeddedPayloadInfo? detectedPayload = null;
        string? embeddedError = null;
        if (options.Root is null
            && TryReadEmbeddedPayload(Environment.ProcessPath, out detectedPayload, out embeddedError))
        {
            if (detectedPayload is null)
            {
                Console.Error.WriteLine($"CineForge single-file payload is invalid: {embeddedError}");
                return 7;
            }

            try
            {
                embeddedPayload = detectedPayload;
                try
                {
                    root = ExtractEmbeddedPackage(detectedPayload);
                }
                finally
                {
                    detectedPayload.CleanupTemporaryPayload();
                }
            }
            catch (Exception ex) when (ex is IOException or UnauthorizedAccessException or InvalidDataException or InvalidOperationException)
            {
                Console.Error.WriteLine($"CineForge single-file payload could not be prepared: {ex.Message}");
                return 7;
            }
        }
        else if (options.Root is null && !string.IsNullOrEmpty(embeddedError))
        {
            Console.Error.WriteLine($"CineForge single-file payload is invalid: {embeddedError}");
            return 7;
        }

        // Validate the immutable package boundary before creating or pruning
        // anything under the user data root. A tampered package must fail
        // without changing the user's data, logs, or staged-upload state.
        var webRoot = ResolveWebRoot(root);
        if (!Directory.Exists(webRoot))
        {
            Console.Error.WriteLine($"CineForge web bundle is missing: {webRoot}");
            Console.Error.WriteLine("Run packaging\\build_windows.ps1 first, or copy the Vite dist folder to web\\.");
            return 2;
        }
        if (!ValidateArtifactManifest(root, embeddedPayload, out var manifestError))
        {
            Console.Error.WriteLine($"CineForge package integrity verification failed: {manifestError}");
            return 7;
        }

        // Port probing is intentionally not the ownership mechanism: a second
        // launch can otherwise choose a different port and open the same
        // SQLite database concurrently. Acquire a stable, data-root-scoped
        // mutex before touching the data directory or starting Core.
        var singleInstance = TryAcquireSingleInstance(dataRoot);
        if (singleInstance.State == SingleInstanceState.AlreadyRunning)
        {
            var message = $"CineForge is already running for this data directory: {dataRoot}";
            Console.Error.WriteLine(message);
            Console.Error.WriteLine($"Close the existing CineForge instance before launching another (exit code {AlreadyRunningExitCode}).");
            return AlreadyRunningExitCode;
        }
        if (singleInstance.State == SingleInstanceState.Failed)
        {
            var message = $"CineForge could not acquire its single-instance guard for {dataRoot}: {singleInstance.Error}";
            Console.Error.WriteLine(message);
            return 5;
        }

        using var singleInstanceLease = singleInstance.Lease!;
        Directory.CreateDirectory(dataRoot);
        PruneStagedUploads(dataRoot);
        var logsRoot = Path.Combine(dataRoot, "logs");
        Directory.CreateDirectory(logsRoot);
        var bootstrapLog = Path.Combine(logsRoot, "bootstrap.log");
        RotateLog(bootstrapLog);
        Log(bootstrapLog, $"startup root={root}; data={dataRoot}; offline={options.AllowOffline}");

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
            var coreCapabilityToken = CreateCapabilityToken();
            var sessionId = Guid.NewGuid().ToString("N");
            core = StartCore(root, dataRoot, corePort, logsRoot, coreCapabilityToken, sessionId);
            if (core is null)
            {
                Log(bootstrapLog, "Core was not found or could not be started.");
                Console.Error.WriteLine("CineForge Core was not found or could not be started.");
            }

            var transport = core is not null ? await WaitForCoreAsync(core, coreBase, coreCapabilityToken, lifetime.Token) : CoreTransport.None;
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

            var health = new HealthState(webRoot, transport, core, dataRoot, webPort, coreCapabilityToken, sessionId);
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

    private static bool TryReadEmbeddedPayload(string? executablePath, out EmbeddedPayloadInfo? payload, out string? error)
    {
        payload = null;
        error = null;
        // `executablePath` is retained in the signature so the portable and
        // single-file launch paths share the same call site. The resource is
        // read from the executing assembly; no sibling file is trusted.
#if !CINEFORGE_EMBEDDED_PAYLOAD
        _ = executablePath;
        return false;
#else
        try
        {
            var expected = EmbeddedBuildMetadata.PayloadSha256.Trim();
            if (!System.Text.RegularExpressions.Regex.IsMatch(expected, "^[0-9a-fA-F]{64}$"))
            {
                error = "the embedded payload digest metadata is missing or invalid.";
                return true;
            }

            var resource = typeof(Program).Assembly.GetManifestResourceStream(EmbeddedPayloadResourceName);
            if (resource is null)
            {
                error = "the embedded payload resource is missing from the executable.";
                return true;
            }

            var localAppData = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
            if (string.IsNullOrWhiteSpace(localAppData))
            {
                resource.Dispose();
                error = "the Windows local application-data directory is unavailable.";
                return true;
            }
            var cacheRoot = Path.Combine(localAppData, "CineForge", "packages");
            Directory.CreateDirectory(cacheRoot);
            var temporaryPath = Path.Combine(cacheRoot, ".payload-" + Guid.NewGuid().ToString("N") + ".tmp");
            try
            {
                using (resource)
                using (var output = new FileStream(temporaryPath, FileMode.CreateNew, FileAccess.Write, FileShare.None, 128 * 1024, FileOptions.SequentialScan))
                using (var hash = IncrementalHash.CreateHash(HashAlgorithmName.SHA256))
                {
                    var buffer = new byte[128 * 1024];
                    long total = 0;
                    while (true)
                    {
                        var read = resource.Read(buffer, 0, buffer.Length);
                        if (read == 0) break;
                        if (total > MaxEmbeddedPayloadBytes - read)
                            throw new InvalidDataException("the embedded payload exceeds its size bound.");
                        output.Write(buffer, 0, read);
                        hash.AppendData(buffer, 0, read);
                        total += read;
                    }
                    output.Flush(true);
                    var actual = hash.GetHashAndReset();
                    var expectedBytes = Convert.FromHexString(expected);
                    if (!CryptographicOperations.FixedTimeEquals(actual, expectedBytes))
                    {
                        try { if (File.Exists(temporaryPath)) File.Delete(temporaryPath); } catch { }
                        error = "the embedded payload digest does not match the bootstrap metadata.";
                        return true;
                    }
                    payload = new EmbeddedPayloadInfo(temporaryPath, 0, total, actual);
                }
            }
            catch
            {
                try { if (File.Exists(temporaryPath)) File.Delete(temporaryPath); } catch { }
                throw;
            }
            return true;
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException or InvalidDataException or ArgumentOutOfRangeException or FormatException)
        {
            error = $"could not read the embedded payload resource ({ex.Message})";
            return true;
        }
#endif
    }

    private static string ExtractEmbeddedPackage(EmbeddedPayloadInfo payload)
    {
        var localAppData = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
        if (string.IsNullOrWhiteSpace(localAppData))
            throw new InvalidOperationException("the Windows local application-data directory is unavailable.");

        var cacheRoot = Path.Combine(localAppData, "CineForge", "packages");
        Directory.CreateDirectory(cacheRoot);
        var packageKey = Convert.ToHexString(payload.PayloadSha256).ToLowerInvariant();
        var packageRoot = Path.Combine(cacheRoot, packageKey);
        var mutexName = EmbeddedPackageCachePrefix + packageKey;
        using var mutex = new Mutex(false, mutexName);
        var acquired = false;
        try
        {
            try { acquired = mutex.WaitOne(TimeSpan.FromSeconds(30)); }
            catch (AbandonedMutexException) { acquired = true; }
            if (!acquired) throw new IOException("timed out waiting for the embedded package cache lock.");

            if (Directory.Exists(packageRoot)
                && (File.GetAttributes(packageRoot) & FileAttributes.ReparsePoint) == 0
                && ValidateArtifactManifest(packageRoot, payload, out _))
            {
                return packageRoot;
            }

            // A cache entry is never followed through a reparse point. If a
            // user or another process placed one at this exact hash path, fail
            // closed instead of deleting outside the known cache root.
            if (File.Exists(packageRoot)
                || (Directory.Exists(packageRoot)
                    && (File.GetAttributes(packageRoot) & FileAttributes.ReparsePoint) != 0))
            {
                throw new InvalidDataException("the embedded package cache path is occupied by an unsafe entry.");
            }
            if (Directory.Exists(packageRoot))
            {
                // Do not let cleanup of a corrupted cache follow a nested
                // junction/symlink outside the package cache. The verifier
                // rejects reparse points; this second walk protects the
                // recursive delete on the failure path as well.
                foreach (var _ in EnumeratePackageFiles(packageRoot)) { }
                Directory.Delete(packageRoot, recursive: true);
            }

            var staging = packageRoot + ".staging-" + Guid.NewGuid().ToString("N");
            Directory.CreateDirectory(staging);
            try
            {
                ExtractEmbeddedZip(payload, staging);
                if (!ValidateArtifactManifest(staging, payload, out var manifestError))
                    throw new InvalidDataException($"embedded package manifest validation failed: {manifestError}");
                Directory.Move(staging, packageRoot);
            }
            finally
            {
                if (Directory.Exists(staging))
                {
                    try { Directory.Delete(staging, recursive: true); } catch { }
                }
            }

            return packageRoot;
        }
        finally
        {
            if (acquired)
            {
                try { mutex.ReleaseMutex(); } catch (ApplicationException) { }
                catch (SynchronizationLockException) { }
            }
        }
    }

    private static void ExtractEmbeddedZip(EmbeddedPayloadInfo payload, string destinationRoot)
    {
        using var source = new FileStream(payload.PayloadPath, FileMode.Open, FileAccess.Read, FileShare.Read,
            128 * 1024, FileOptions.SequentialScan);
        using var bounded = new BoundedReadStream(source, payload.PayloadOffset, payload.PayloadLength);
        using var archive = new ZipArchive(bounded, ZipArchiveMode.Read, leaveOpen: false);
        if (archive.Entries.Count == 0 || archive.Entries.Count > MaxEmbeddedEntryCount)
            throw new InvalidDataException("the embedded package has an invalid entry count.");

        var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        long totalBytes = 0;
        foreach (var entry in archive.Entries)
        {
            var normalized = entry.FullName.Replace('/', '\\').Replace(Path.AltDirectorySeparatorChar, Path.DirectorySeparatorChar);
            var isDirectory = normalized.EndsWith(Path.DirectorySeparatorChar);
            normalized = normalized.TrimEnd(Path.DirectorySeparatorChar);
            if (string.IsNullOrWhiteSpace(normalized) || normalized.Contains(':')
                || Path.IsPathRooted(normalized)
                || normalized.Split(Path.DirectorySeparatorChar, StringSplitOptions.RemoveEmptyEntries)
                    .Any(segment => segment is "." or ".."))
            {
                throw new InvalidDataException($"the embedded package contains an unsafe path: {entry.FullName}");
            }
            if (!string.Equals(normalized, "build-manifest.json", StringComparison.OrdinalIgnoreCase)
                && !string.Equals(normalized, "web", StringComparison.OrdinalIgnoreCase)
                && !string.Equals(normalized, "runtime", StringComparison.OrdinalIgnoreCase)
                && !(normalized.StartsWith("web" + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase)
                    || normalized.StartsWith("runtime" + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase)))
            {
                throw new InvalidDataException($"the embedded package contains an unsupported path: {entry.FullName}");
            }
            if (!seen.Add(normalized)) throw new InvalidDataException($"the embedded package contains a duplicate path: {entry.FullName}");

            var target = Path.GetFullPath(Path.Combine(destinationRoot, normalized));
            var rootWithSeparator = Path.GetFullPath(destinationRoot).TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar;
            if (!target.StartsWith(rootWithSeparator, StringComparison.OrdinalIgnoreCase))
                throw new InvalidDataException($"the embedded package path escaped its destination: {entry.FullName}");

            if (isDirectory)
            {
                if (File.Exists(target)) throw new InvalidDataException($"the embedded package has a file/directory collision: {entry.FullName}");
                Directory.CreateDirectory(target);
                continue;
            }
            if (entry.Length < 0 || entry.Length > MaxEmbeddedEntryBytes || totalBytes > MaxEmbeddedUncompressedBytes - entry.Length)
                throw new InvalidDataException("the embedded package exceeds its uncompressed size bound.");
            if (Directory.Exists(target)) throw new InvalidDataException($"the embedded package has a file/directory collision: {entry.FullName}");
            Directory.CreateDirectory(Path.GetDirectoryName(target)!);
            using var input = entry.Open();
            using var output = new FileStream(target, FileMode.CreateNew, FileAccess.Write, FileShare.None, 128 * 1024, FileOptions.SequentialScan);
            var copied = CopyBounded(input, output, entry.Length, MaxEmbeddedEntryBytes);
            if (copied != entry.Length) throw new InvalidDataException($"the embedded package entry was truncated: {entry.FullName}");
            totalBytes += copied;
        }
    }

    private static long CopyBounded(Stream input, Stream output, long expectedLength, long maxBytes)
    {
        var buffer = new byte[128 * 1024];
        long total = 0;
        while (true)
        {
            var read = input.Read(buffer, 0, buffer.Length);
            if (read == 0) break;
            if (total > maxBytes - read) throw new InvalidDataException("the embedded package entry exceeds its size bound.");
            output.Write(buffer, 0, read);
            total += read;
        }
        if (total > expectedLength) throw new InvalidDataException("the embedded package entry expanded beyond its declared size.");
        return total;
    }

    private static bool ValidateArtifactManifest(string root, EmbeddedPayloadInfo? embedded, out string error)
    {
        error = string.Empty;
        var manifestPath = Path.Combine(root, "build-manifest.json");
        if (!File.Exists(manifestPath))
        {
            if (embedded is not null)
            {
                error = "the embedded package is missing build-manifest.json.";
                return false;
            }
            return true;
        }

        try
        {
            var manifestInfo = new FileInfo(manifestPath);
            if ((manifestInfo.Attributes & FileAttributes.ReparsePoint) != 0)
            {
                error = "build-manifest.json is a reparse point.";
                return false;
            }
            if (manifestInfo.Length > 4 * 1024 * 1024)
            {
                error = "build-manifest.json is too large.";
                return false;
            }

            using var document = JsonDocument.Parse(File.ReadAllText(manifestPath));
            if (!document.RootElement.TryGetProperty("artifact_files", out var files)
                || files.ValueKind != JsonValueKind.Array
                || files.GetArrayLength() == 0
                || files.GetArrayLength() > 20_000)
            {
                error = "build-manifest.json has no bounded artifact file inventory.";
                return false;
            }

            // The inventory is the release boundary. Require the count and an
            // explicit bootstrap digest for a portable package. A SingleFile
            // package has no self-referential EXE hash; its resource digest is
            // authenticated by the compiled bootstrap metadata instead.
            if (!document.RootElement.TryGetProperty("artifact_file_count", out var countValue)
                || !countValue.TryGetInt32(out var declaredCount)
                || declaredCount != files.GetArrayLength())
            {
                error = "build-manifest.json has an invalid artifact file count.";
                return false;
            }
            string? bootstrapHash = null;
            if (document.RootElement.TryGetProperty("bootstrap_sha256", out var bootstrapHashValue)
                && bootstrapHashValue.ValueKind == JsonValueKind.String)
            {
                bootstrapHash = bootstrapHashValue.GetString();
            }
            if (embedded is null && !System.Text.RegularExpressions.Regex.IsMatch(bootstrapHash ?? string.Empty, "^[0-9a-fA-F]{64}$"))
            {
                error = "build-manifest.json has no valid bootstrap_sha256.";
                return false;
            }
            var manifestMode = document.RootElement.TryGetProperty("mode", out var modeValue)
                && modeValue.ValueKind == JsonValueKind.String
                ? modeValue.GetString()
                : null;
            if (embedded is not null)
            {
                if (!string.Equals(manifestMode, "single-file", StringComparison.OrdinalIgnoreCase))
                {
                    error = "the embedded package manifest does not identify a single-file build.";
                    return false;
                }
                if (bootstrapHash is not null)
                {
                    error = "the embedded package must not claim a self-referential bootstrap_sha256.";
                    return false;
                }
            }

            var rootFull = Path.GetFullPath(root).TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar)
                + Path.DirectorySeparatorChar;
            var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            var canonicalEntries = new List<CanonicalArtifactEntry>(files.GetArrayLength());
            string? inventoryBootstrapHash = null;
            foreach (var entry in files.EnumerateArray())
            {
                if (entry.ValueKind != JsonValueKind.Object
                    || !entry.TryGetProperty("path", out var pathValue)
                    || pathValue.ValueKind != JsonValueKind.String
                    || !entry.TryGetProperty("bytes", out var bytesValue)
                    || !bytesValue.TryGetInt64(out var expectedBytes)
                    || expectedBytes < 0
                    || !entry.TryGetProperty("sha256", out var hashValue)
                    || hashValue.ValueKind != JsonValueKind.String)
                {
                    error = "build-manifest.json contains an invalid artifact entry.";
                    return false;
                }

                var relative = pathValue.GetString() ?? string.Empty;
                var normalizedRelative = relative.Replace('/', Path.DirectorySeparatorChar).Replace('\\', Path.DirectorySeparatorChar);
                if (string.IsNullOrWhiteSpace(relative)
                    || Path.IsPathRooted(normalizedRelative)
                    || normalizedRelative.Split(Path.DirectorySeparatorChar, StringSplitOptions.RemoveEmptyEntries)
                        .Any(segment => segment is "." or ".."))
                {
                    error = $"build-manifest.json contains an unsafe artifact path '{relative}'.";
                    return false;
                }

                var candidate = Path.GetFullPath(Path.Combine(root, normalizedRelative));
                if (!candidate.StartsWith(rootFull, StringComparison.OrdinalIgnoreCase)
                    || !seen.Add(candidate))
                {
                    error = $"build-manifest.json contains a duplicate or escaped artifact path '{relative}'.";
                    return false;
                }
                if (!File.Exists(candidate))
                {
                    error = $"Packaged artifact is missing: {relative}.";
                    return false;
                }
                if ((File.GetAttributes(candidate) & FileAttributes.ReparsePoint) != 0)
                {
                    error = $"Packaged artifact is a reparse point: {relative}.";
                    return false;
                }

                var actualBytes = new FileInfo(candidate).Length;
                if (actualBytes != expectedBytes)
                {
                    error = $"Packaged artifact size mismatch: {relative}.";
                    return false;
                }
                var expectedHash = hashValue.GetString() ?? string.Empty;
                if (!System.Text.RegularExpressions.Regex.IsMatch(expectedHash, "^[0-9a-fA-F]{64}$"))
                {
                    error = $"build-manifest.json contains an invalid artifact hash for '{relative}'.";
                    return false;
                }
                if (string.Equals(relative, "CineForge.exe", StringComparison.OrdinalIgnoreCase))
                {
                    inventoryBootstrapHash = expectedHash;
                }
                using var stream = File.OpenRead(candidate);
                var actualHash = Convert.ToHexString(SHA256.HashData(stream));
                if (!actualHash.Equals(expectedHash, StringComparison.OrdinalIgnoreCase))
                {
                    error = $"Packaged artifact hash mismatch: {relative}.";
                    return false;
                }
                canonicalEntries.Add(new CanonicalArtifactEntry(relative.Replace('\\', '/'), expectedBytes, expectedHash.ToLowerInvariant()));
            }

            if (embedded is null && (inventoryBootstrapHash is null
                || !inventoryBootstrapHash.Equals(bootstrapHash, StringComparison.OrdinalIgnoreCase)))
            {
                error = "build-manifest.json bootstrap_sha256 does not match the CineForge.exe inventory entry.";
                return false;
            }
            if (embedded is not null && inventoryBootstrapHash is not null)
            {
                error = "the embedded package inventory must not include an external CineForge.exe entry.";
                return false;
            }

            if (embedded is not null)
            {
                if (!document.RootElement.TryGetProperty("embedded_content_sha256", out var contentHashValue)
                    || contentHashValue.ValueKind != JsonValueKind.String
                    || !System.Text.RegularExpressions.Regex.IsMatch(contentHashValue.GetString() ?? string.Empty, "^[0-9a-fA-F]{64}$"))
                {
                    error = "the embedded package has no valid embedded_content_sha256.";
                    return false;
                }
                var actualContentHash = ComputeCanonicalArtifactDigest(canonicalEntries);
                if (!actualContentHash.Equals(contentHashValue.GetString(), StringComparison.OrdinalIgnoreCase))
                {
                    error = $"the embedded package content digest does not match its manifest inventory (declared {contentHashValue.GetString()}, actual {actualContentHash}).";
                    return false;
                }
#if CINEFORGE_EMBEDDED_PAYLOAD
                var expectedContentHash = EmbeddedBuildMetadata.ContentSha256.Trim();
                if (!actualContentHash.Equals(expectedContentHash, StringComparison.OrdinalIgnoreCase))
                {
                    error = "the embedded package content digest does not match the bootstrap metadata.";
                    return false;
                }
#endif
            }

            // The inventory is also a closure boundary. Hashing every listed
            // file is insufficient if a stale or tampered package adds an
            // unlisted script/runtime file that the Core or browser can load.
            // Walk the tree without following reparse points and reject every
            // file that is not either in the inventory or the manifest itself.
            foreach (var actualPath in EnumeratePackageFiles(root))
            {
                var relative = Path.GetRelativePath(root, actualPath).Replace('\\', '/');
                if (string.Equals(relative, "build-manifest.json", StringComparison.OrdinalIgnoreCase))
                    continue;
                if (!seen.Contains(actualPath))
                {
                    error = $"Packaged artifact is not declared in build-manifest.json: {relative}.";
                    return false;
                }
            }

            return true;
        }
        catch (Exception ex) when (ex is IOException or InvalidDataException or UnauthorizedAccessException or JsonException or NotSupportedException)
        {
            error = $"could not validate build-manifest.json ({ex.Message})";
            return false;
        }
    }

    private static string ComputeCanonicalArtifactDigest(IEnumerable<CanonicalArtifactEntry> entries)
    {
        var canonical = new StringBuilder();
        // Manifest order is intentionally part of the compiled content
        // digest. This keeps the PowerShell release builder and the runtime
        // verifier independent of each platform's culture-sensitive sorting.
        foreach (var entry in entries)
        {
            canonical.Append(entry.Path).Append('\n')
                .Append(entry.Bytes.ToString(CultureInfo.InvariantCulture)).Append('\n')
                .Append(entry.Sha256).Append('\n');
        }
        return Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(canonical.ToString()))).ToLowerInvariant();
    }

    private sealed record CanonicalArtifactEntry(string Path, long Bytes, string Sha256);

    private static IEnumerable<string> EnumeratePackageFiles(string root)
    {
        var pending = new Stack<string>();
        pending.Push(Path.GetFullPath(root));
        while (pending.Count > 0)
        {
            var directory = pending.Pop();
            var directoryAttributes = File.GetAttributes(directory);
            if ((directoryAttributes & FileAttributes.ReparsePoint) != 0)
                throw new InvalidDataException($"Packaged directory is a reparse point: {directory}.");

            foreach (var path in Directory.EnumerateFileSystemEntries(directory))
            {
                var attributes = File.GetAttributes(path);
                if ((attributes & FileAttributes.ReparsePoint) != 0)
                    throw new InvalidDataException($"Packaged path is a reparse point: {path}.");
                if ((attributes & FileAttributes.Directory) != 0)
                    pending.Push(path);
                else
                    yield return Path.GetFullPath(path);
            }
        }
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

    private static string CreateCapabilityToken()
    {
        // The token is process-local bootstrap/Core capability material. It is
        // passed through the child environment (never command-line arguments
        // or logs) and is replaced on every launch.
        return Convert.ToBase64String(RandomNumberGenerator.GetBytes(32))
            .TrimEnd('=').Replace('+', '-').Replace('/', '_');
    }

    private static CoreHost? StartCore(string root, string dataRoot, int port, string logsRoot, string capabilityToken, string coreSession)
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
                nodeStart.Environment["CINEFORGE_CORE_TOKEN"] = capabilityToken;
                nodeStart.Environment["CINEFORGE_CORE_SESSION"] = coreSession;
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
        start.Environment["CINEFORGE_CORE_TOKEN"] = capabilityToken;
        start.Environment["CINEFORGE_CORE_SESSION"] = coreSession;
        return StartProcess(start, logsRoot);
    }

    private static SingleInstanceAttempt TryAcquireSingleInstance(string dataRoot)
    {
        Mutex? mutex = null;
        try
        {
            var mutexName = BuildSingleInstanceMutexName(dataRoot);
            mutex = new Mutex(initiallyOwned: false, name: mutexName, createdNew: out _);
            try
            {
                if (!mutex.WaitOne(0))
                {
                    mutex.Dispose();
                    return SingleInstanceAttempt.AlreadyRunning;
                }
            }
            catch (AbandonedMutexException)
            {
                // WaitOne acquires an abandoned mutex and reports the previous
                // owner's crash separately. The current process now owns it.
            }

            return SingleInstanceAttempt.Acquired(new SingleInstanceLease(mutex!));
        }
        catch (Exception ex) when (ex is UnauthorizedAccessException or IOException or
            WaitHandleCannotBeOpenedException or ArgumentException or PlatformNotSupportedException or
            System.Security.SecurityException)
        {
            try { mutex?.Dispose(); } catch (ObjectDisposedException) { }
            return SingleInstanceAttempt.Failed(ex.Message);
        }
    }

    private static string BuildSingleInstanceMutexName(string dataRoot)
    {
        var normalized = Path.TrimEndingDirectorySeparator(Path.GetFullPath(dataRoot));
        // Windows paths are case-insensitive. Normalizing before hashing makes
        // C:\CineForge\Data and c:\cineforge\data share one mutex.
        if (OperatingSystem.IsWindows()) normalized = normalized.ToUpperInvariant();
        var digest = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(normalized)));
        return SingleInstanceMutexPrefix + digest;
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

    private static async Task<CoreTransport> WaitForCoreAsync(CoreHost core, Uri coreBase, string capabilityToken, CancellationToken cancellationToken)
    {
        var deadline = DateTimeOffset.UtcNow.AddSeconds(20);
        while (DateTimeOffset.UtcNow < deadline && !cancellationToken.IsCancellationRequested)
        {
            try
            {
                using var request = new HttpRequestMessage(HttpMethod.Get, new Uri(coreBase, "/v1/dashboard"));
                request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", capabilityToken);
                using var response = await Http.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, cancellationToken);
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
                else if (health.Transport == CoreTransport.Http) await ProxyAsync(context, coreBase, health, cancellationToken);
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

    private static async Task ProxyAsync(HttpListenerContext context, Uri coreBase, HealthState health, CancellationToken cancellationToken)
    {
        var target = new Uri(coreBase, context.Request.Url!.PathAndQuery);
        using var request = new HttpRequestMessage(new HttpMethod(context.Request.HttpMethod), target);
        RewrittenAssetRequest? stagedRequest = null;
        var stagedLease = false;
        try
        {
            if (IsAssetImportRequest(context.Request))
            {
                var body = await ReadRequestBytesAsync(context.Request, 1 * 1024 * 1024, cancellationToken);
                // Resolve + consume are one filesystem lease.  The lock is
                // held across the Core request, so two concurrent idempotency
                // keys cannot both import the same browser handle.
                stagedRequest = RewriteStagedAssetRequest(body, health.DataRoot, context.Request.Headers["Idempotency-Key"]);
                stagedLease = stagedRequest.Lease is not null;
                request.Content = new ByteArrayContent(stagedRequest.Body);
                request.Content.Headers.ContentType = new MediaTypeHeaderValue("application/json");
            }
            else if (context.Request.HasEntityBody)
            {
                request.Content = new StreamContent(context.Request.InputStream);
                if (!string.IsNullOrWhiteSpace(context.Request.ContentType))
                    request.Content.Headers.ContentType = MediaTypeHeaderValue.Parse(context.Request.ContentType);
            }
            foreach (var headerName in new[] { "Accept", "Idempotency-Key", "If-Match", "If-None-Match", "X-Request-Id", "Range", "If-Range", "X-CineForge-Preview" })
            {
                var value = context.Request.Headers[headerName];
                if (!string.IsNullOrWhiteSpace(value)) request.Headers.TryAddWithoutValidation(headerName, value);
            }
            // Browser credentials never become Core credentials. The
            // bootstrap owns this capability and binds preview reads to the
            // current process session.
            request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", health.CoreCapabilityToken);
            request.Headers.Remove("X-CineForge-Session");
            request.Headers.TryAddWithoutValidation("X-CineForge-Session", health.SessionId);
            // The bootstrap supplies the exact Core epoch it requested at
            // launch.  Core rejects a stale epoch before any command/query is
            // dispatched, so a restarted process cannot accept old browser
            // or proxy traffic by accident.
            request.Headers.Remove("X-CineForge-Core-Epoch");
            request.Headers.TryAddWithoutValidation("X-CineForge-Core-Epoch", health.SessionId);
            // Only versioned API headers cross the desktop boundary. Browser
            // cookies, Origin, forwarding headers, and hop-by-hop transport
            // metadata must never reach Core or become part of its trust model.
            using var response = await Http.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, cancellationToken);
            context.Response.StatusCode = (int)response.StatusCode;
            if (response.Content.Headers.ContentType is not null)
                context.Response.ContentType = response.Content.Headers.ContentType.ToString();
            if (response.Content.Headers.ContentLength is long contentLength)
                context.Response.ContentLength64 = contentLength;
            foreach (var header in response.Headers)
            {
                if (header.Key.StartsWith("Access-Control-", StringComparison.OrdinalIgnoreCase)) continue;
                try { context.Response.Headers[header.Key] = string.Join(", ", header.Value); } catch (ArgumentException) { }
            }
            foreach (var header in response.Content.Headers)
            {
                if (header.Key.Equals("Content-Length", StringComparison.OrdinalIgnoreCase) ||
                    header.Key.Equals("Content-Type", StringComparison.OrdinalIgnoreCase)) continue;
                try { context.Response.Headers[header.Key] = string.Join(", ", header.Value); } catch (ArgumentException) { }
            }
            if (stagedRequest?.Handle is not null && (int)response.StatusCode is >= 200 and < 300)
            {
                try { MarkStagedUploadConsumed(health.DataRoot, stagedRequest.Handle, stagedRequest.IdempotencyKey!); }
                catch { /* a successful Core command remains canonical if cleanup is interrupted */ }
            }
            if (!context.Request.HttpMethod.Equals("HEAD", StringComparison.OrdinalIgnoreCase))
                await response.Content.CopyToAsync(context.Response.OutputStream, cancellationToken);
        }
        finally
        {
            if (stagedLease) stagedRequest?.Lease?.Dispose();
        }
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
        var stagedLease = ResolveStagedUpload(dataRoot, handle, idempotencyKey);
        var staged = stagedLease.Upload;
        payload.Remove("source_handle");
        payload["source_path"] = staged.Path;
        payload["storage_mode"] ??= "COPY";
        payload["original_name"] ??= staged.Name;
        if (!string.IsNullOrWhiteSpace(staged.MimeType)) payload["mime_type"] ??= staged.MimeType;
        return new RewrittenAssetRequest(JsonSerializer.SerializeToUtf8Bytes(payload), handle, idempotencyKey, stagedLease);
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

    private static StagedUploadLease ResolveStagedUpload(string dataRoot, string handle, string? idempotencyKey = null)
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
        FileStream lease;
        try
        {
            // A lock file is held until Core accepts/rejects this request. It
            // is process- and machine-wide on Windows, unlike an in-memory
            // semaphore, so a second bootstrap cannot consume the handle.
            var leasePath = Path.Combine(directory, "consume.lock");
            lease = new FileStream(leasePath, FileMode.OpenOrCreate, FileAccess.ReadWrite, FileShare.None, 1, FileOptions.SequentialScan);
        }
        catch (IOException)
        {
            throw new StageUploadException(409, "STAGE_BUSY", "The staged file is currently being imported.");
        }
        catch (UnauthorizedAccessException)
        {
            throw new StageUploadException(409, "STAGE_BUSY", "The staged file is currently being imported.");
        }
        var payloadPath = Path.GetFullPath(Path.Combine(directory, manifest.RelativePath));
        if (!IsWithinDirectory(payloadPath, directory) || !File.Exists(payloadPath) || IsReparsePoint(payloadPath))
        {
            lease.Dispose();
            throw new StageUploadException(409, "STAGE_UNTRUSTED", "The staged file bytes are not trusted.");
        }
        long size;
        try { size = new FileInfo(payloadPath).Length; }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
        {
            lease.Dispose();
            throw new StageUploadException(409, "STAGE_CORRUPT", "The staged file bytes could not be inspected.");
        }
        if (size != manifest.ByteSize || size > MaxStagedUploadBytes)
        {
            lease.Dispose();
            throw new StageUploadException(409, "STAGE_CORRUPT", "The staged file size does not match its manifest.");
        }
        return new StagedUploadLease(new StagedUpload(payloadPath, manifest.Name, manifest.MimeType, size, manifest.ConsumedIdempotencyKey), lease);
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

    private sealed record EmbeddedPayloadInfo(
        string PayloadPath,
        long PayloadOffset,
        long PayloadLength,
        byte[] PayloadSha256)
    {
        public void CleanupTemporaryPayload()
        {
            var fileName = Path.GetFileName(PayloadPath);
            if (!fileName.StartsWith(".payload-", StringComparison.OrdinalIgnoreCase)
                || !fileName.EndsWith(".tmp", StringComparison.OrdinalIgnoreCase)) return;
            try
            {
                var localAppData = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
                if (string.IsNullOrWhiteSpace(localAppData)) return;
                var packageRoot = Path.GetFullPath(Path.Combine(localAppData, "CineForge", "packages"))
                    .TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar)
                    + Path.DirectorySeparatorChar;
                var candidate = Path.GetFullPath(PayloadPath);
                if (!candidate.StartsWith(packageRoot, StringComparison.OrdinalIgnoreCase)) return;
                if (File.Exists(candidate)
                    && (File.GetAttributes(candidate) & FileAttributes.ReparsePoint) == 0)
                    File.Delete(candidate);
            }
            catch { }
        }
    }

    /// <summary>
    /// A seekable, read-only view over the bounded embedded resource copy.
    /// ZipArchive can therefore validate the central directory without
    /// allocating a second copy of the payload in memory.
    /// </summary>
    private sealed class BoundedReadStream : Stream
    {
        private readonly Stream inner;
        private readonly long start;
        private readonly long length;
        private long position;

        public BoundedReadStream(Stream inner, long start, long length)
        {
            if (!inner.CanSeek || start < 0 || length < 0 || start > inner.Length - length)
                throw new ArgumentOutOfRangeException(nameof(start));
            this.inner = inner;
            this.start = start;
            this.length = length;
            inner.Seek(start, SeekOrigin.Begin);
        }

        public override bool CanRead => inner.CanRead;
        public override bool CanSeek => true;
        public override bool CanWrite => false;
        public override long Length => length;
        public override long Position
        {
            get => position;
            set => Seek(value, SeekOrigin.Begin);
        }

        public override int Read(byte[] buffer, int offset, int count)
        {
            ValidateReadArguments(buffer, offset, count);
            var boundedCount = (int)Math.Min(count, length - position);
            if (boundedCount <= 0) return 0;
            inner.Seek(start + position, SeekOrigin.Begin);
            var read = inner.Read(buffer, offset, boundedCount);
            position += read;
            return read;
        }

        public override int Read(Span<byte> buffer)
        {
            var boundedCount = (int)Math.Min(buffer.Length, length - position);
            if (boundedCount <= 0) return 0;
            inner.Seek(start + position, SeekOrigin.Begin);
            var read = inner.Read(buffer[..boundedCount]);
            position += read;
            return read;
        }

        public override long Seek(long offset, SeekOrigin origin)
        {
            var next = origin switch
            {
                SeekOrigin.Begin => offset,
                SeekOrigin.Current => position + offset,
                SeekOrigin.End => length + offset,
                _ => throw new ArgumentOutOfRangeException(nameof(origin)),
            };
            if (next < 0 || next > length) throw new IOException("embedded payload seek escaped its bounded range.");
            position = next;
            return position;
        }

        public override void Flush() { }
        public override void SetLength(long value) => throw new NotSupportedException();
        public override void Write(byte[] buffer, int offset, int count) => throw new NotSupportedException();

        protected override void Dispose(bool disposing)
        {
            // The owner of the underlying executable stream disposes it.
            base.Dispose(disposing);
        }

        private static void ValidateReadArguments(byte[] buffer, int offset, int count)
        {
            if (buffer is null) throw new ArgumentNullException(nameof(buffer));
            if (offset < 0 || count < 0 || offset > buffer.Length - count)
                throw new ArgumentOutOfRangeException();
        }
    }

    private enum SingleInstanceState
    {
        Acquired,
        AlreadyRunning,
        Failed,
    }

    private sealed record SingleInstanceAttempt(SingleInstanceState State, SingleInstanceLease? Lease, string? Error)
    {
        public static SingleInstanceAttempt Acquired(SingleInstanceLease lease) => new(SingleInstanceState.Acquired, lease, null);
        public static SingleInstanceAttempt AlreadyRunning { get; } = new(SingleInstanceState.AlreadyRunning, null, null);
        public static SingleInstanceAttempt Failed(string error) => new(SingleInstanceState.Failed, null, error);
    }

    private sealed class SingleInstanceLease : IDisposable
    {
        private readonly Mutex mutex;
        private bool disposed;

        public SingleInstanceLease(Mutex mutex)
        {
            this.mutex = mutex;
        }

        public void Dispose()
        {
            if (disposed) return;
            disposed = true;
            try { mutex.ReleaseMutex(); } catch (ApplicationException) { }
            catch (SynchronizationLockException) { }
            catch (ObjectDisposedException) { }
            mutex.Dispose();
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

    private sealed class StagedUploadLease : IDisposable
    {
        public StagedUploadLease(StagedUpload upload, FileStream lockStream)
        {
            Upload = upload;
            LockStream = lockStream;
        }

        public StagedUpload Upload { get; }
        private FileStream LockStream { get; }

        public void Dispose() => LockStream.Dispose();
    }

    private sealed record RewrittenAssetRequest(byte[] Body, string? Handle, string? IdempotencyKey, StagedUploadLease? Lease = null);

    private sealed class HealthState
    {
        public HealthState(string webRoot, CoreTransport transport, CoreHost? core, string dataRoot, int webPort, string coreCapabilityToken, string sessionId)
        {
            WebRoot = webRoot;
            Transport = transport;
            Core = core;
            DataRoot = dataRoot;
            WebOrigin = $"http://127.0.0.1:{webPort}";
            CoreCapabilityToken = coreCapabilityToken;
            SessionId = sessionId;
        }

        public string WebRoot { get; }
        public CoreTransport Transport { get; }
        public CoreHost? Core { get; }
        public string DataRoot { get; }
        public string WebOrigin { get; }
        public string CoreCapabilityToken { get; }
        public string SessionId { get; }
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
