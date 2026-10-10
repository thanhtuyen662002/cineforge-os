using CineForge.Bootstrap;
using System.Diagnostics;
using System.Security.Cryptography;
using System.Text.Json;

if (!OperatingSystem.IsWindows()) throw new InvalidOperationException("Windows lane required.");
if (args.Length != 4) throw new InvalidOperationException("Supply exact node.exe, client script, fixture EXE and evidence directory.");
var node = Path.GetFullPath(args[0]); var script = Path.GetFullPath(args[1]); var fixture = Path.GetFullPath(args[2]);
var output = Path.GetFullPath(args[3]); Directory.CreateDirectory(output);
var root = Path.Combine(output, "broker fixture " + Guid.NewGuid().ToString("N")); Directory.CreateDirectory(root);
var reports = new List<object>();
string Hash(byte[] bytes) => Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant();
void Require(bool value, string reason) { if (!value) throw new InvalidOperationException(reason); }
var key = RandomNumberGenerator.GetBytes(32);
var identity = new ProbeBrokerIdentity(Guid.NewGuid().ToString(), Guid.NewGuid().ToString(), Guid.NewGuid().ToString(), Guid.NewGuid().ToString());
try
{
    var collision = "CineForge.MediaProbe." + Hash(RandomNumberGenerator.GetBytes(32));
    using (var first = new NativeProbeBroker(collision, key, identity))
    {
        bool rejected = false;
        try { using var duplicate = new NativeProbeBroker(collision, key, identity); }
        catch (InvalidOperationException failure) { rejected = failure.Message == "PROBE_BROKER_ENDPOINT_REJECTED"; }
        Require(rejected, "Pre-existing pipe was reused."); reports.Add(new { name = "ENDPOINT_COLLISION", rejected });
    }
    foreach (var mode in new[] { "GOOD", "CANCEL", "DISCONNECT", "WRONG_KEY", "WRONG_PID", "STALE_SESSION", "WRONG_CANCEL", "REPLAY", "BAD_LENGTH" })
    {
        var pipeName = "CineForge.MediaProbe." + Hash(RandomNumberGenerator.GetBytes(32));
        var attempt = Guid.NewGuid().ToString(); var source = Path.Combine(root, "source-" + attempt + ".txt");
        File.WriteAllText(source, mode == "GOOD" ? "GOOD" : "HANG");
        var sourceBytes = File.ReadAllBytes(source);
        var request = new { scope = new { project_id = Guid.NewGuid().ToString(), asset_revision_id = Guid.NewGuid().ToString(),
                job_id = Guid.NewGuid().ToString(), attempt_id = attempt, fencing_token = Hash(RandomNumberGenerator.GetBytes(32)) },
            pins = new { source_hash = Hash(sourceBytes), source_bytes = sourceBytes.Length,
                binary_hash = Hash(File.ReadAllBytes(fixture)), manifest_hash = Hash([1]), certificate_hash = Hash([2]),
                trust_generation = Hash([3]), rights_generation = Hash([4]) },
            input = new { source_path = source, binary_path = fixture, attempt_root = Path.Combine(root, "attempt-" + attempt) },
            budgets = new { wall_time_ms = 10000, stdout_limit = 65536, stderr_limit = 65536, memory_limit = 536870912 } };
        using var broker = new NativeProbeBroker(pipeName, key, identity);
        var start = new ProcessStartInfo(node) { UseShellExecute = false, CreateNoWindow = true, RedirectStandardOutput = true, RedirectStandardError = true };
        start.ArgumentList.Add(script);
        start.Environment["CINEFORGE_TEST_BROKER"] = JsonSerializer.Serialize(new { pipe_name = pipeName, broker_process_id = Environment.ProcessId,
            installation_id = identity.InstallationId, library_id = identity.LibraryId, core_epoch = identity.CoreEpoch,
            session_id = identity.SessionId, key_hex = Convert.ToHexString(key).ToLowerInvariant(), request, mode });
        using var client = Process.Start(start) ?? throw new InvalidOperationException("Fixture client did not start.");
        var stdout = client.StandardOutput.ReadToEndAsync(); var stderr = client.StandardError.ReadToEndAsync();
        using var current = Process.GetCurrentProcess();
        var observed = await broker.RunOneAsync(mode == "WRONG_PID" ? current : client);
        broker.Dispose();
        try { await client.WaitForExitAsync().WaitAsync(TimeSpan.FromSeconds(10)); }
        catch { client.Kill(true); throw; }
        using var clientReport = JsonDocument.Parse(await stdout);
        Console.WriteLine($"{mode}: {observed.Code}, peer={observed.PeerVerified}, auth={observed.Authenticated}, native={observed.Observation?.Code}, phase={observed.Observation?.Phase}, client={clientReport.RootElement.GetRawText()}");
        Require(client.ExitCode == 0 && (await stderr).Length == 0, "Fixture client failed.");
        if (mode == "GOOD") Require(observed.Code == "PROBE_BROKER_OBSERVED" && observed.PeerVerified && observed.Authenticated
            && observed.Observation is { TreeStopped: true, ExitCode: 0, AppContainerVerified: true, ProfileReleased: true }
            && clientReport.RootElement.GetProperty("code").GetString() == "PROBE_PROCESS_STOPPED", "Valid broker flow failed.");
        else if (mode == "CANCEL") Require(observed.Code == "PROBE_BROKER_OBSERVED"
            && observed.Observation is { Code: "PROBE_CANCELLED", TreeStopped: true, ProfileReleased: true }, "Cancellation did not stop native work.");
        else if (mode is "DISCONNECT" or "WRONG_CANCEL" or "REPLAY") Require(observed.Code != "PROBE_BROKER_OBSERVED"
            && observed.Observation is { Code: "PROBE_CANCELLED", TreeStopped: true, ProfileReleased: true }, "Broken channel left a live native tree.");
        else Require(observed.Code != "PROBE_BROKER_OBSERVED" && observed.Observation == null, "Rejected client launched native work.");
        reports.Add(new { name = mode, broker_code = observed.Code, observed.PeerVerified, observed.Authenticated,
            observed.Disconnected, native_code = observed.Observation?.Code, tree_stopped = observed.Observation?.TreeStopped,
            profile_released = observed.Observation?.ProfileReleased, client = clientReport.RootElement.Clone() });
        Console.WriteLine($"{mode}: {observed.Code}, native={observed.Observation?.Code}, stopped={observed.Observation?.TreeStopped}");
    }
    File.WriteAllText(Path.Combine(output, "broker-verification.json"), JsonSerializer.Serialize(new { status = "PASS", certified_ffprobe = false,
        public_core_binding = false, cases = reports }, new JsonSerializerOptions { WriteIndented = true }));
    Console.WriteLine("NATIVE_BROKER_FIXTURE=PASS");
}
catch
{
    File.WriteAllText(Path.Combine(output, "broker-verification.json"), JsonSerializer.Serialize(new { status = "FAIL", certified_ffprobe = false,
        public_core_binding = false, cases = reports }, new JsonSerializerOptions { WriteIndented = true })); throw;
}
finally { CryptographicOperations.ZeroMemory(key); }
