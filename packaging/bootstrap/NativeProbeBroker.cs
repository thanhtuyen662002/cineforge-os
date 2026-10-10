using System.Buffers.Binary;
using System.Diagnostics;
using System.IO.Pipes;
using System.Runtime.InteropServices;
using System.Runtime.Versioning;
using System.Security.Cryptography;
using System.Security.Principal;
using System.Text;
using System.Text.Encodings.Web;
using System.Text.Json;
using System.Text.RegularExpressions;
using Microsoft.Win32.SafeHandles;

namespace CineForge.Bootstrap;

internal sealed record ProbeBrokerIdentity(string InstallationId, string LibraryId, string CoreEpoch, string SessionId);
internal sealed record ProbeBrokerRun(string Code, bool PeerVerified, bool Authenticated, bool Disconnected,
    NativeProbeObservation? Observation);

// PREPARED only; no Main/bootstrap/public route creates this listener.
[SupportedOSPlatform("windows")]
internal sealed class NativeProbeBroker : IDisposable
{
    private const string Contract = "NATIVE_MEDIA_PROBE_BROKER_V1";
    private static readonly byte[] Domain = Encoding.UTF8.GetBytes("CINEFORGE_MEDIA_PROBE_BROKER_FRAME_V1\0");
    private static readonly string[] Common = ["contract", "role", "type", "sequence", "installation_id", "library_id", "core_epoch", "session_id", "client_nonce", "server_nonce"];
    private static readonly JsonSerializerOptions JsonOptions = new() { Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping };
    private readonly NamedPipeServerStream pipe;
    private readonly byte[] key;
    private readonly ProbeBrokerIdentity identity;
    private bool used;
    internal NativeProbeBroker(string pipeName, byte[] secret, ProbeBrokerIdentity context)
    {
        if (!OperatingSystem.IsWindows() || !Regex.IsMatch(pipeName, "^CineForge\\.MediaProbe\\.[0-9a-f]{64}$")
            || secret.Length != 32 || !new[] { context.InstallationId, context.LibraryId, context.CoreEpoch, context.SessionId }.All(Uuid))
            throw new InvalidOperationException("PROBE_BROKER_DESCRIPTOR_INVALID");
        identity = context; key = (byte[])secret.Clone();
        var owner = WindowsIdentity.GetCurrent().User ?? throw new InvalidOperationException("PROBE_BROKER_OWNER_UNKNOWN");
        var sddl = "D:P(D;;GA;;;NU)(D;;GA;;;AN)(A;;GA;;;" + owner.Value + ")";
        if (!ConvertStringSecurityDescriptorToSecurityDescriptorW(sddl, 1, out var descriptor, out _))
            throw new InvalidOperationException("PROBE_BROKER_ACL_REJECTED");
        try
        {
            var security = new SecurityAttributes { Size = Marshal.SizeOf<SecurityAttributes>(), Descriptor = descriptor };
            // Duplex + overlapped + FIRST_PIPE_INSTANCE. Byte mode + REJECT_REMOTE_CLIENTS.
            var handle = CreateNamedPipeW(@"\\.\pipe\" + pipeName, 3 | 0x40000000 | 0x80000, 8, 1, 65536, 65536, 0, ref security);
            if (handle.IsInvalid) { handle.Dispose(); throw new InvalidOperationException("PROBE_BROKER_ENDPOINT_REJECTED"); }
            try { pipe = new NamedPipeServerStream(PipeDirection.InOut, true, false, handle); }
            catch { handle.Dispose(); throw; }
        }
        finally { LocalFree(descriptor); }
    }

    internal async Task<ProbeBrokerRun> RunOneAsync(Process expectedCore, CancellationToken cancellation = default)
    {
        if (used) throw new InvalidOperationException("PROBE_BROKER_ALREADY_USED"); used = true;
        bool peer = false, authenticated = false, disconnected = false;
        NativeProbeObservation? observation = null;
        using var outer = CancellationTokenSource.CreateLinkedTokenSource(cancellation); outer.CancelAfter(150000);
        using var nativeStop = CancellationTokenSource.CreateLinkedTokenSource(outer.Token);
        using var controlStop = CancellationTokenSource.CreateLinkedTokenSource(outer.Token);
        Task? coreExit = null, control = null;
        string? controlError = null;
        try
        {
            await pipe.WaitForConnectionAsync(outer.Token).WaitAsync(TimeSpan.FromSeconds(10), outer.Token);
            if (expectedCore.HasExited || !GetNamedPipeClientProcessId(pipe.SafePipeHandle.DangerousGetHandle(), out uint clientPid)
                || clientPid != expectedCore.Id) throw Failure("PROBE_BROKER_PEER_REJECTED");
            peer = true;
            coreExit = WatchCoreAsync(expectedCore, outer);
            using var helloDoc = await ReadAsync(outer.Token);
            var hello = helloDoc.RootElement; CheckCommon(hello, "HELLO", 0, null, "", []);
            var clientNonce = Text(hello, "client_nonce"); if (!Hash(clientNonce)) throw Failure("PROBE_BROKER_SESSION_REJECTED");
            var serverNonce = Convert.ToHexString(RandomNumberGenerator.GetBytes(32)).ToLowerInvariant();
            Dictionary<string, object?> Envelope(string type, int sequence, params (string, object?)[] extras)
            {
                var frame = new Dictionary<string, object?> { ["contract"] = Contract, ["role"] = "SERVER", ["type"] = type,
                    ["sequence"] = sequence, ["installation_id"] = identity.InstallationId, ["library_id"] = identity.LibraryId,
                    ["core_epoch"] = identity.CoreEpoch, ["session_id"] = identity.SessionId,
                    ["client_nonce"] = clientNonce, ["server_nonce"] = serverNonce };
                foreach (var (name, value) in extras) frame.Add(name, value); return frame;
            }
            await WriteAsync(Envelope("CHALLENGE", 0, ("broker_process_id", Environment.ProcessId)), outer.Token);
            using var authDoc = await ReadAsync(outer.Token);
            CheckCommon(authDoc.RootElement, "AUTH", 0, clientNonce, serverNonce, []); authenticated = true;
            string dispatchHash = "";
            using var probeDoc = await ReadAsync(outer.Token, onDigest: value => dispatchHash = value);
            var probe = probeDoc.RootElement;
            CheckCommon(probe, "PROBE", 1, clientNonce, serverNonce, ["scope", "pins", "input", "budgets"]);
            var input = ValidateRequest(probe);
            control = ReadControlAsync();
            async Task ReadControlAsync()
            {
                try
                {
                    using var doc = await ReadAsync(controlStop.Token, 150000);
                    CheckCommon(doc.RootElement, "CANCEL", 2, clientNonce, serverNonce, ["dispatch_hash"]);
                    if (Text(doc.RootElement, "dispatch_hash") != dispatchHash) throw Failure("PROBE_BROKER_DISPATCH_REJECTED");
                    nativeStop.Cancel();
                }
                catch (OperationCanceledException) when (controlStop.IsCancellationRequested) { }
                catch (BrokerFailure failure) { controlError = failure.Code; nativeStop.Cancel(); }
                catch { disconnected = true; nativeStop.Cancel(); }
            }
            int sequence = 0; Task started = Task.CompletedTask;
            observation = await NativeMediaProbe.InspectAsync(input, nativeStop.Token, pid =>
            {
                started = WriteAsync(Envelope("STARTED", ++sequence, ("dispatch_hash", dispatchHash), ("process_id", pid)), outer.Token);
            });
            await started;
            if (controlError != null) throw Failure(controlError);
            foreach (var (channel, bytes) in new[] { ("STDOUT", observation.Stdout), ("STDERR", observation.Stderr) })
                for (int offset = 0; offset < bytes.Length; offset += 3072)
                    await WriteAsync(Envelope("OUTPUT", ++sequence, ("dispatch_hash", dispatchHash), ("channel", channel),
                        ("data", Convert.ToBase64String(bytes, offset, Math.Min(3072, bytes.Length - offset)))), outer.Token);
            var facts = new { contract = observation.Contract, code = observation.Code, tree_stopped = observation.TreeStopped,
                exit_code = observation.ExitCode, cpu_time_ms = observation.CpuTimeMs, peak_memory_bytes = observation.PeakMemoryBytes,
                profile_released = observation.ProfileReleased, retained_attempt_root = observation.RetainedAttemptRoot,
                retained_profile = observation.RetainedProfile, phase = observation.Phase, native_error = observation.NativeError,
                failure_type = observation.FailureType, app_container_verified = observation.AppContainerVerified,
                stdout_bytes = observation.Stdout.Length, stderr_bytes = observation.Stderr.Length,
                stdout_sha256 = Sha(observation.Stdout), stderr_sha256 = Sha(observation.Stderr) };
            await WriteAsync(Envelope("RESULT", ++sequence, ("dispatch_hash", dispatchHash), ("observation", facts)), outer.Token);
            return new("PROBE_BROKER_OBSERVED", peer, authenticated, disconnected, observation);
        }
        catch (BrokerFailure failure) { return new(failure.Code, peer, authenticated, disconnected, observation); }
        catch (OperationCanceledException) { return new("PROBE_BROKER_CANCELLED_OR_EXPIRED", peer, authenticated, disconnected, observation); }
        catch { return new("PROBE_BROKER_UNAVAILABLE", peer, authenticated, disconnected, observation); }
        finally
        {
            nativeStop.Cancel(); controlStop.Cancel(); outer.Cancel();
            if (control != null) try { await control; } catch { }
            if (coreExit != null) try { await coreExit; } catch { }
        }
    }
    private static async Task WatchCoreAsync(Process core, CancellationTokenSource outer)
    { try { await core.WaitForExitAsync(outer.Token); outer.Cancel(); } catch (OperationCanceledException) { } }
    private void CheckCommon(JsonElement frame, string type, int sequence, string? clientNonce, string serverNonce, string[] extras)
    {
        Exact(frame, Common.Concat(extras).ToArray());
        if (Text(frame, "contract") != Contract || Text(frame, "role") != "CLIENT" || Text(frame, "type") != type
            || Number(frame, "sequence", 0, 2) != sequence || Text(frame, "installation_id") != identity.InstallationId
            || Text(frame, "library_id") != identity.LibraryId || Text(frame, "core_epoch") != identity.CoreEpoch
            || Text(frame, "session_id") != identity.SessionId || Text(frame, "server_nonce") != serverNonce
            || (clientNonce != null && Text(frame, "client_nonce") != clientNonce)) throw Failure("PROBE_BROKER_SESSION_REJECTED");
    }
    private static NativeProbeInput ValidateRequest(JsonElement frame)
    {
        var scope = frame.GetProperty("scope"); Exact(scope, ["project_id", "asset_revision_id", "job_id", "attempt_id", "fencing_token"]);
        foreach (var field in new[] { "project_id", "asset_revision_id", "job_id", "attempt_id" }) if (!Uuid(Text(scope, field))) throw Failure("PROBE_BROKER_SCOPE_REJECTED");
        if (!Hash(Text(scope, "fencing_token"))) throw Failure("PROBE_BROKER_SCOPE_REJECTED");
        var pins = frame.GetProperty("pins"); Exact(pins, ["source_hash", "source_bytes", "binary_hash", "manifest_hash", "certificate_hash", "trust_generation", "rights_generation"]);
        foreach (var field in new[] { "source_hash", "binary_hash", "manifest_hash", "certificate_hash", "trust_generation", "rights_generation" }) if (!Hash(Text(pins, field))) throw Failure("PROBE_BROKER_PIN_REJECTED");
        var paths = frame.GetProperty("input"); Exact(paths, ["source_path", "binary_path", "attempt_root"]);
        foreach (var field in new[] { "source_path", "binary_path", "attempt_root" })
        {
            var path = Text(paths, field);
            if (!Regex.IsMatch(path, "^[A-Za-z]:[\\\\/]") || path.Skip(2).Contains(':') || path.Any(c => c < 32)) throw Failure("PROBE_BROKER_PATH_REJECTED");
        }
        var limits = frame.GetProperty("budgets"); Exact(limits, ["wall_time_ms", "stdout_limit", "stderr_limit", "memory_limit"]);
        return new(Text(scope, "attempt_id").Replace("-", ""), Text(paths, "source_path"), Text(pins, "source_hash"),
            Number(pins, "source_bytes", 1, 1073741824), Text(paths, "binary_path"), Text(pins, "binary_hash"), Text(paths, "attempt_root"),
            (int)Number(limits, "wall_time_ms", 1, 120000), (int)Number(limits, "stdout_limit", 1, 8388608),
            (int)Number(limits, "stderr_limit", 1, 1048576), Number(limits, "memory_limit", 1048576, 536870912));
    }
    private async Task<JsonDocument> ReadAsync(CancellationToken cancellation, int timeoutMs = 10000, Action<string>? onDigest = null)
    {
        using var deadline = CancellationTokenSource.CreateLinkedTokenSource(cancellation); deadline.CancelAfter(timeoutMs);
        var header = new byte[4]; await pipe.ReadExactlyAsync(header, deadline.Token);
        uint declared = BinaryPrimitives.ReadUInt32LittleEndian(header);
        if (declared < 1 || declared > 16384) throw Failure("PROBE_BROKER_FRAME_LIMIT");
        int size = (int)declared;
        var body = new byte[size]; var receivedMac = new byte[32];
        await pipe.ReadExactlyAsync(body, deadline.Token); await pipe.ReadExactlyAsync(receivedMac, deadline.Token);
        if (!CryptographicOperations.FixedTimeEquals(Mac(body), receivedMac)) throw Failure("PROBE_BROKER_MAC_REJECTED");
        onDigest?.Invoke(Sha(body));
        _ = new UTF8Encoding(false, true).GetString(body);
        var doc = JsonDocument.Parse(body, new JsonDocumentOptions { MaxDepth = 8 });
        try { int nodes = 0; ValidateJson(doc.RootElement, ref nodes); return doc; } catch { doc.Dispose(); throw; }
    }
    private async Task WriteAsync(object value, CancellationToken cancellation)
    {
        var bytes = JsonSerializer.SerializeToUtf8Bytes(value, JsonOptions);
        if (bytes.Length > 16384) throw Failure("PROBE_BROKER_FRAME_LIMIT");
        var header = new byte[4]; BinaryPrimitives.WriteUInt32LittleEndian(header, (uint)bytes.Length);
        await pipe.WriteAsync(header, cancellation); await pipe.WriteAsync(bytes, cancellation); await pipe.WriteAsync(Mac(bytes), cancellation);
        await pipe.FlushAsync(cancellation);
    }
    private byte[] Mac(byte[] bytes) { using var hmac = new HMACSHA256(key); return hmac.ComputeHash(Domain.Concat(bytes).ToArray()); }
    private static string Sha(byte[] bytes) => Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant();
    private static bool Hash(string value) => Regex.IsMatch(value, "^[0-9a-f]{64}$");
    private static bool Uuid(string value) => Regex.IsMatch(value, "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$");
    private static string Text(JsonElement value, string field) => value.GetProperty(field).ValueKind == JsonValueKind.String
        ? value.GetProperty(field).GetString()! : throw Failure("PROBE_BROKER_SCHEMA_REJECTED");
    private static long Number(JsonElement value, string field, long min, long max) => value.GetProperty(field).TryGetInt64(out long number)
        && number >= min && number <= max ? number : throw Failure("PROBE_BROKER_POLICY_REJECTED");
    private static void Exact(JsonElement value, string[] fields)
    {
        if (value.ValueKind != JsonValueKind.Object || value.EnumerateObject().Count() != fields.Length
            || value.EnumerateObject().Any(property => !fields.Contains(property.Name))) throw Failure("PROBE_BROKER_SCHEMA_REJECTED");
    }
    private static void ValidateJson(JsonElement value, ref int nodes)
    {
        if (++nodes > 256) throw Failure("PROBE_BROKER_JSON_LIMIT");
        if (value.ValueKind == JsonValueKind.Object)
        {
            var names = new HashSet<string>();
            foreach (var p in value.EnumerateObject())
            { if (++nodes > 256 || !names.Add(p.Name) || Encoding.UTF8.GetByteCount(p.Name) > 4096) throw Failure("PROBE_BROKER_JSON_REJECTED"); ValidateJson(p.Value, ref nodes); }
        }
        else if (value.ValueKind == JsonValueKind.Array) throw Failure("PROBE_BROKER_JSON_REJECTED");
        else if (value.ValueKind == JsonValueKind.String && Encoding.UTF8.GetByteCount(value.GetString()!) > 4096) throw Failure("PROBE_BROKER_JSON_LIMIT");
        else if (value.ValueKind == JsonValueKind.Number && (!Regex.IsMatch(value.GetRawText(), "^-?(0|[1-9][0-9]*)$")
            || !value.TryGetInt64(out long n) || n < -9007199254740991 || n > 9007199254740991)) throw Failure("PROBE_BROKER_JSON_REJECTED");
    }
    private sealed class BrokerFailure(string code) : Exception { internal string Code { get; } = code; }
    private static BrokerFailure Failure(string code) => new(code);
    public void Dispose() { pipe.Dispose(); CryptographicOperations.ZeroMemory(key); }
    [DllImport("kernel32.dll", SetLastError = true)] private static extern bool GetNamedPipeClientProcessId(IntPtr pipe, out uint clientProcessId);
    [StructLayout(LayoutKind.Sequential)] private struct SecurityAttributes { public int Size; public IntPtr Descriptor; [MarshalAs(UnmanagedType.Bool)] public bool Inherit; }
    [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)] private static extern SafePipeHandle CreateNamedPipeW(string name, uint openMode, uint pipeMode, uint instances, uint outSize, uint inSize, uint timeout, ref SecurityAttributes security);
    [DllImport("advapi32.dll", SetLastError = true, CharSet = CharSet.Unicode)] private static extern bool ConvertStringSecurityDescriptorToSecurityDescriptorW(string value, uint revision, out IntPtr descriptor, out uint size);
    [DllImport("kernel32.dll")] private static extern IntPtr LocalFree(IntPtr pointer);
}
