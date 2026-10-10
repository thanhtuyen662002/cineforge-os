using CineForge.Bootstrap;
using System.Net;
using System.Net.Sockets;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

if (!OperatingSystem.IsWindows()) throw new InvalidOperationException("Windows test lane required.");
if (args.Length != 2) throw new InvalidOperationException("Supply exact local fixture EXE and output directory.");
var fixture = Path.GetFullPath(args[0]);
var output = Path.GetFullPath(args[1]); Directory.CreateDirectory(output);
var testRoot = Path.Combine(output, "fixture " + Guid.NewGuid().ToString("N")); Directory.CreateDirectory(testRoot);
var binaryHash = Hash(File.ReadAllBytes(fixture));
Environment.SetEnvironmentVariable("CINEFORGE_TEST_SECRET", "must-not-be-inherited");
var evidence = new List<object>();
object? networkObservation = null;
using var listener = new TcpListener(IPAddress.Loopback, 0); listener.Start();
var port = ((IPEndPoint)listener.LocalEndpoint).Port;
using (var control = new TcpClient())
{
    await control.ConnectAsync(IPAddress.Loopback, port).WaitAsync(TimeSpan.FromSeconds(2));
    using var accepted = await listener.AcceptTcpClientAsync();
}
var unexpectedNetwork = listener.AcceptTcpClientAsync();
var outside = Path.Combine(testRoot, "outside-secret.txt"); File.WriteAllText(outside, "not accessible to the probe");

async Task<NativeProbeObservation> Run(string mode, int wall = 10000, int stdoutLimit = 65536,
    int stderrLimit = 65536, CancellationToken cancel = default, bool wrongHash = false, CancellationTokenSource? cancelOnStart = null)
{
    var source = Path.Combine(testRoot, "source-" + Guid.NewGuid().ToString("N") + ".txt");
    var data = Encoding.UTF8.GetBytes(mode == "ISOLATION" ? $"ISOLATION\n{outside}\n{port}" : mode);
    File.WriteAllBytes(source, data);
    var attemptId = Guid.NewGuid().ToString("N");
    var request = new NativeProbeInput(attemptId, source, mode == "WRONG_SOURCE" ? new string('0', 64) : Hash(data), data.Length, fixture,
        wrongHash ? new string('0', 64) : binaryHash, Path.Combine(testRoot, "attempt-" + attemptId), wall, stdoutLimit, stderrLimit);
    if (mode == "ROOT_EXISTS") Directory.CreateDirectory(request.AttemptRoot);
    if (mode == "HARDLINK")
    {
        if (!FixtureNative.CreateHardLinkW(Path.Combine(testRoot, "alias-" + attemptId), source, IntPtr.Zero)) throw new InvalidOperationException("Hardlink fixture creation failed.");
    }
    var result = await NativeMediaProbe.InspectAsync(request, cancel, cancelOnStart == null ? null : _ => cancelOnStart.CancelAfter(100));
    evidence.Add(new { name = mode, result.Code, result.TreeStopped, result.ExitCode, result.CpuTimeMs, result.PeakMemoryBytes,
        result.ProfileReleased, result.Phase, result.NativeError, result.FailureType, result.AppContainerVerified, stdout_bytes = result.Stdout.Length, stderr_bytes = result.Stderr.Length });
    Console.WriteLine($"{mode}: {result.Code}, phase={result.Phase}, native={result.NativeError}, type={result.FailureType}, tree={result.TreeStopped}, exit={result.ExitCode}, profile={result.ProfileReleased}");
    return result;
}
void Require(bool value, string reason) { if (!value) throw new InvalidOperationException(reason); }
string Hash(byte[] bytes) => Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant();

try
{
    var good = await Run("GOOD");
    Require(good.Code == "PROBE_PROCESS_STOPPED" && good.TreeStopped && good.ExitCode == 0 && good.ProfileReleased && good.AppContainerVerified, "Clean private-input fixture failed.");
    Require(Encoding.UTF8.GetString(good.Stdout) == "{\"private_input_read\":true}", "Private input read was not observed.");
    var isolation = await Run("ISOLATION");
    Console.WriteLine("Isolation observations: " + Encoding.UTF8.GetString(isolation.Stdout));
    Require(isolation.Code == "PROBE_PROCESS_STOPPED" && isolation.TreeStopped && isolation.ExitCode == 0, "Isolation fixture failed.");
    using (var parsed = JsonDocument.Parse(isolation.Stdout))
    {
        foreach (var field in new[] { "secret_absent", "outside_denied" }) Require(parsed.RootElement.GetProperty(field).GetBoolean(), "Isolation observation missing: " + field);
        var error = parsed.RootElement.GetProperty("network_error").GetString();
        networkObservation = new { access_denied = parsed.RootElement.GetProperty("network_denied").GetBoolean(), error };
        Require(isolation.AppContainerVerified && !unexpectedNetwork.IsCompletedSuccessfully
            && (parsed.RootElement.GetProperty("network_denied").GetBoolean() || error == "TimeoutException"), "Network isolation lacks token and live-listener evidence.");
    }
    var timed = await Run("HANG", 500);
    Require(timed.Code == "PROBE_TIMEOUT" && timed.TreeStopped && timed.ProfileReleased, "Timeout did not stop the process tree.");
    using var cancellation = new CancellationTokenSource();
    var cancelled = await Run("HANG", cancel: cancellation.Token, cancelOnStart: cancellation);
    Require(cancelled.Code == "PROBE_CANCELLED" && cancelled.TreeStopped && cancelled.ProfileReleased, "Cancellation did not stop the process tree.");
    var preCancelled = await Run("CANCEL_BEFORE_START", cancel: new CancellationToken(true));
    Require(preCancelled.Code == "PROBE_CANCELLED" && preCancelled.ExitCode == null && preCancelled.RetainedAttemptRoot == null, "Pre-cancelled request started preparation.");
    foreach (var mode in new[] { "STDOUT", "STDERR" })
    {
        var flood = await Run(mode);
        Require(flood.Code == "PROBE_OUTPUT_LIMIT_OR_IO" && flood.TreeStopped && flood.ProfileReleased, "Output flood did not stop safely.");
    }
    var spawned = await Run("SPAWN");
    Require(spawned.Code == "PROBE_PROCESS_STOPPED" && spawned.TreeStopped && spawned.ExitCode == 0 && spawned.ProfileReleased, "Child process tree was not stopped.");
    using (var parsed = JsonDocument.Parse(spawned.Stdout)) Require(parsed.RootElement.GetProperty("spawned").GetBoolean(), "Descendant test did not create a child.");
    var tampered = await Run("WRONG_BINARY", wrongHash: true);
    Require(tampered.Code == "PROBE_FILE_HASH_MISMATCH" && tampered.ExitCode == null, "Mismatched binary was launched.");
    foreach (var item in new[] { ("WRONG_SOURCE", "PROBE_FILE_HASH_MISMATCH"), ("ROOT_EXISTS", "PROBE_ATTEMPT_ROOT_EXISTS"),
        ("HARDLINK", "PROBE_FILE_IDENTITY_REJECTED") })
    {
        var rejected = await Run(item.Item1);
        Require(rejected.Code == item.Item2 && rejected.ExitCode == null && rejected.ProfileReleased, "Unsafe source/root launched: " + item.Item1);
    }
    Require(!unexpectedNetwork.IsCompletedSuccessfully, "Unexpected network connection observed after isolation fixture.");
    File.WriteAllText(Path.Combine(output, "native-verification.json"), JsonSerializer.Serialize(new { status = "PASS", fixture_sha256 = binaryHash,
        certified_ffprobe = false, core_integration = false, live_network_positive_control = true,
        child_connection_accepted = false, network_observation = networkObservation,
        cases = evidence }, new JsonSerializerOptions { WriteIndented = true }));
    Console.WriteLine("NATIVE_PROBE_FIXTURE=PASS");
}
catch
{
    File.WriteAllText(Path.Combine(output, "native-verification.json"), JsonSerializer.Serialize(new { status = "FAIL", certified_ffprobe = false,
        core_integration = false, cases = evidence }, new JsonSerializerOptions { WriteIndented = true }));
    throw;
}
finally { listener.Stop(); Environment.SetEnvironmentVariable("CINEFORGE_TEST_SECRET", null); }

internal static class FixtureNative
{
    [System.Runtime.InteropServices.DllImport("kernel32.dll", SetLastError = true, CharSet = System.Runtime.InteropServices.CharSet.Unicode)]
    internal static extern bool CreateHardLinkW(string name, string existing, IntPtr security);
}
