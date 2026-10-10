using System.Diagnostics;
using System.Net.Sockets;
using System.Text.Json;

// Deliberately not ffprobe or a certified pack. Exercises the OS boundary.
if (args.Length == 1 && args[0] == "child") { Thread.Sleep(20000); return; }
var input = File.ReadAllText("input/media.bin").Split('\n');
var mode = input[0].Trim();
switch (mode)
{
    case "HANG": Thread.Sleep(20000); break;
    case "STDOUT": for (int i = 0; i < 2048; i++) Console.Write(new string('x', 8192)); break;
    case "STDERR": for (int i = 0; i < 2048; i++) Console.Error.Write(new string('x', 8192)); break;
    case "SPAWN":
        using (var child = Process.Start(new ProcessStartInfo(Environment.ProcessPath!) { ArgumentList = { "child" }, UseShellExecute = false, CreateNoWindow = true }))
        { Console.Write(JsonSerializer.Serialize(new { spawned = child != null })); }
        break;
    case "ISOLATION":
        bool denied = false, networkDenied = false; string? networkError = null;
        try { File.ReadAllText(input[1].Trim()); } catch (UnauthorizedAccessException) { denied = true; }
        try
        {
            using var client = new TcpClient();
            await client.ConnectAsync("127.0.0.1", int.Parse(input[2])).WaitAsync(TimeSpan.FromSeconds(1));
        }
        catch (SocketException error) { networkError = error.SocketErrorCode.ToString(); networkDenied = error.SocketErrorCode == SocketError.AccessDenied; }
        catch (Exception error) { networkError = error.GetType().Name; }
        Console.Write(JsonSerializer.Serialize(new { secret_absent = Environment.GetEnvironmentVariable("CINEFORGE_TEST_SECRET") == null,
            outside_denied = denied, network_denied = networkDenied, network_error = networkError }));
        break;
    default: Console.Write("{\"private_input_read\":true}"); break;
}
