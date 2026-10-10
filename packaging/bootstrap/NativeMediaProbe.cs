using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Runtime.Versioning;
using System.Security.AccessControl;
using System.Security.Cryptography;
using System.Security.Principal;
using System.Text;
using Microsoft.Win32.SafeHandles;

namespace CineForge.Bootstrap;

// PREPARED component: deliberately not wired to commands or the desktop host.
// Only a reviewed Core broker may resolve these private paths and exact pins.
internal sealed record NativeProbeInput(string AttemptId, string SourcePath, string SourceHash, long SourceBytes,
    string BinaryPath, string BinaryHash, string AttemptRoot, int WallTimeMs = 120000,
    int StdoutLimit = 8388608, int StderrLimit = 1048576, long MemoryLimit = 536870912);

internal sealed record NativeProbeObservation(string Contract, string Code, bool TreeStopped,
    uint? ExitCode, byte[] Stdout, byte[] Stderr, long CpuTimeMs, long PeakMemoryBytes,
    bool ProfileReleased, string? RetainedAttemptRoot, string? RetainedProfile, string Phase, int? NativeError, string? FailureType,
    bool AppContainerVerified);

internal static class NativeMediaProbe
{
    private const uint Suspended = 4, UnicodeEnvironment = 0x400, ExtendedStartup = 0x80000, NoWindow = 0x8000000;
    private const uint ReadAccess = 0x80000000, ShareRead = 1, OpenExisting = 3, OpenReparse = 0x200000;
    private const uint KillOnClose = 0x2000, MemoryLimitFlag = 0x200, ActiveProcessLimit = 8;
    private const long HandleListAttribute = 0x20002, SecurityCapabilitiesAttribute = 0x20009;
    private const int JobBasicAccounting = 1, JobExtendedLimit = 9;
    private static readonly string[] Arguments = ["-hide_banner", "-v", "error", "-protocol_whitelist", "file,pipe",
        "-show_entries", "format=format_name,duration,size,nb_streams:stream=index,codec_type,codec_name,time_base,duration_ts,duration,r_frame_rate,avg_frame_rate,nb_frames,width,height,pix_fmt,sample_aspect_ratio,color_range,color_space,color_transfer,color_primaries,sample_rate,channels,channel_layout,sample_fmt:stream_disposition",
        "-of", "json", "-i", "input/media.bin"];

    internal static async Task<NativeProbeObservation> InspectAsync(NativeProbeInput input, CancellationToken cancellation = default,
        Action<uint>? onProcessStarted = null)
    {
        if (!OperatingSystem.IsWindows() || RuntimeInformation.ProcessArchitecture != Architecture.X64) return Empty("PROBE_PLATFORM_UNSUPPORTED");
        if (input.AttemptId.Length != 32 || !input.AttemptId.All(c => c is >= '0' and <= '9' or >= 'a' and <= 'f')
            || !Digest(input.SourceHash) || !Digest(input.BinaryHash) || input.SourceBytes < 1 || input.SourceBytes > 1073741824
            || input.WallTimeMs is < 1 or > 120000 || input.StdoutLimit is < 1 or > 8388608
            || input.StderrLimit is < 1 or > 1048576 || input.MemoryLimit is < 1048576 or > 536870912)
            return Empty("PROBE_POLICY_INVALID");

        string root;
        try { root = LocalPath(input.AttemptRoot); NoReparseParents(root); }
        catch { return Empty("PROBE_PATH_REJECTED"); }
        if (Directory.Exists(root) || File.Exists(root)) return Empty("PROBE_ATTEMPT_ROOT_EXISTS");
        IntPtr packageSid = IntPtr.Zero, job = IntPtr.Zero, attributeList = IntPtr.Zero, capabilities = IntPtr.Zero;
        IntPtr inherited = IntPtr.Zero, environment = IntPtr.Zero;
        ProcessInfo child = default;
        bool createdRoot = false, createdProfile = false, resumed = false, stopped = false, released = false;
        // Core can journal this deterministic identity before starting the broker.
        // A pre-existing profile is rejected; it is never silently reused.
        var profile = "CineForge.Probe." + input.AttemptId;
        string code = "PROBE_NATIVE_FAILED";
        uint? exitCode = null;
        byte[] stdout = [], stderr = [];
        long cpuMs = 0, peak = 0;
        string phase = "SOURCE_PIN"; int? nativeError = null; string? failureType = null; bool containerVerified = false;
        SafeFileHandle? outRead = null, outWrite = null, errRead = null, errWrite = null, inRead = null, inWrite = null;
        FileStream? source = null, binary = null, stagedSource = null, stagedBinary = null;
        Task<byte[]>? outTask = null, errTask = null;
        try
        {
            cancellation.ThrowIfCancellationRequested();
            source = OpenPinned(input.SourcePath, input.SourceHash, input.SourceBytes);
            phase = "BINARY_PIN";
            binary = OpenPinned(input.BinaryPath, input.BinaryHash, null);
            if (binary.Length > 536870912) throw Failure("PROBE_BINARY_SIZE_LIMIT");
            phase = "PRIVATE_ROOT";
            if (!CreateDirectoryW(root, IntPtr.Zero)) throw Failure("PROBE_ATTEMPT_ROOT_EXISTS");
            createdRoot = true;
            Protect(root, null, false);
            phase = "APP_CONTAINER";
            int profileResult = CreateAppContainerProfile(profile, profile, "CineForge bounded media observation", IntPtr.Zero, 0, out packageSid);
            if (profileResult != 0) throw new Win32Exception(profileResult & 0xffff);
            createdProfile = true;
            phase = "PRIVATE_STAGE";
            var sid = new SecurityIdentifier(packageSid);
            Protect(root, sid, false);
            Directory.CreateDirectory(Path.Combine(root, "input"));
            Directory.CreateDirectory(Path.Combine(root, "bin"));
            Directory.CreateDirectory(Path.Combine(root, "scratch"));
            var inputFile = Path.Combine(root, "input", "media.bin");
            var executable = Path.Combine(root, "bin", "ffprobe.exe");
            CopyPinned(source, inputFile); CopyPinned(binary, executable);
            Protect(inputFile, sid, false); Protect(executable, sid, false);
            Protect(Path.Combine(root, "scratch"), sid, true);
            stagedSource = OpenPinned(inputFile, input.SourceHash, input.SourceBytes);
            stagedBinary = OpenPinned(executable, input.BinaryHash, binary.Length);

            phase = "JOB_LIMITS";
            job = CreateJobObjectW(IntPtr.Zero, null); Check(job != IntPtr.Zero);
            var limits = new ExtendedLimits { Basic = new BasicLimits { Flags = KillOnClose | MemoryLimitFlag | ActiveProcessLimit,
                ActiveProcesses = 4 }, JobMemory = (UIntPtr)input.MemoryLimit };
            WithStructure(limits, (p, n) => Check(SetInformationJobObject(job, JobExtendedLimit, p, n)));
            var effectiveLimits = ReadStructure<ExtendedLimits>(job, JobExtendedLimit);
            if (effectiveLimits.Basic.Flags != limits.Basic.Flags || effectiveLimits.Basic.ActiveProcesses != 4
                || effectiveLimits.JobMemory != limits.JobMemory) throw Failure("PROBE_JOB_LIMITS_UNVERIFIED");
            phase = "PIPES";
            Pipe(out outRead, out outWrite); Pipe(out errRead, out errWrite); Pipe(out inRead, out inWrite);
            // Parent ends cannot be inherited. Only the fixed handle list below is passed.
            Check(SetHandleInformation(outRead.DangerousGetHandle(), 1, 0));
            Check(SetHandleInformation(errRead.DangerousGetHandle(), 1, 0));
            Check(SetHandleInformation(inWrite.DangerousGetHandle(), 1, 0));
            inWrite.Dispose(); inWrite = null; // stdin is EOF; it cannot carry commands.
            phase = "ATTRIBUTES";
            UIntPtr bytes = UIntPtr.Zero;
            InitializeProcThreadAttributeList(IntPtr.Zero, 2, 0, ref bytes);
            attributeList = Marshal.AllocHGlobal(checked((int)bytes.ToUInt64()));
            Check(InitializeProcThreadAttributeList(attributeList, 2, 0, ref bytes));
            capabilities = Marshal.AllocHGlobal(Marshal.SizeOf<Capabilities>());
            Marshal.StructureToPtr(new Capabilities { Sid = packageSid }, capabilities, false);
            Check(UpdateProcThreadAttribute(attributeList, 0, (IntPtr)SecurityCapabilitiesAttribute, capabilities,
                (UIntPtr)Marshal.SizeOf<Capabilities>(), IntPtr.Zero, IntPtr.Zero));
            inherited = Marshal.AllocHGlobal(3 * IntPtr.Size);
            Marshal.WriteIntPtr(inherited, 0, inRead.DangerousGetHandle());
            Marshal.WriteIntPtr(inherited, IntPtr.Size, outWrite.DangerousGetHandle());
            Marshal.WriteIntPtr(inherited, 2 * IntPtr.Size, errWrite.DangerousGetHandle());
            Check(UpdateProcThreadAttribute(attributeList, 0, (IntPtr)HandleListAttribute, inherited,
                (UIntPtr)(3 * IntPtr.Size), IntPtr.Zero, IntPtr.Zero));
            // No PATH, credentials, NODE_OPTIONS, provider URLs or user profile environment.
            var windows = Environment.GetFolderPath(Environment.SpecialFolder.Windows);
            var scratch = Path.Combine(root, "scratch");
            var allowedEnvironment = new SortedDictionary<string, string>(StringComparer.OrdinalIgnoreCase)
            {
                ["APPDATA"] = scratch, ["LOCALAPPDATA"] = scratch, ["USERPROFILE"] = root,
                ["HOMEDRIVE"] = Path.GetPathRoot(root)!.TrimEnd('\\'), ["HOMEPATH"] = root[2..],
                ["DOTNET_BUNDLE_EXTRACT_BASE_DIR"] = scratch, ["SystemRoot"] = windows, ["windir"] = windows,
                ["SystemDrive"] = Path.GetPathRoot(windows)!.TrimEnd('\\'), ["OS"] = "Windows_NT",
                ["PROCESSOR_ARCHITECTURE"] = "AMD64", ["NUMBER_OF_PROCESSORS"] = "4", ["TEMP"] = scratch, ["TMP"] = scratch
            };
            var env = string.Join('\0', allowedEnvironment.Select(pair => pair.Key + "=" + pair.Value)) + "\0\0";
            environment = Marshal.StringToHGlobalUni(env);
            var startup = new StartupEx { Info = new Startup { Size = Marshal.SizeOf<StartupEx>(), Flags = 0x100,
                In = inRead.DangerousGetHandle(), Out = outWrite.DangerousGetHandle(), Error = errWrite.DangerousGetHandle() }, Attributes = attributeList };
            var commandLine = new StringBuilder(string.Join(" ", new[] { executable }.Concat(Arguments).Select(Quote)));
            cancellation.ThrowIfCancellationRequested();
            phase = "SPAWN_SUSPENDED";
            Check(CreateProcessW(executable, commandLine, IntPtr.Zero, IntPtr.Zero, true,
                Suspended | UnicodeEnvironment | ExtendedStartup | NoWindow, environment, root, ref startup, out child));
            phase = "JOB_ATTACH";
            Check(AssignProcessToJobObject(job, child.Process));
            phase = "TOKEN_VERIFICATION";
            VerifyContainerToken(child.Process, packageSid); containerVerified = true;
            // Recheck locked private copies while the process is still suspended.
            phase = "REVALIDATE";
            CheckPinned(stagedSource, input.SourceHash, input.SourceBytes);
            CheckPinned(stagedBinary, input.BinaryHash, binary.Length);
            cancellation.ThrowIfCancellationRequested();
            phase = "RESUME";
            Check(ResumeThread(child.Thread) != uint.MaxValue); resumed = true;
            onProcessStarted?.Invoke(child.Id);
            inRead.Dispose(); inRead = null; outWrite.Dispose(); outWrite = null; errWrite.Dispose(); errWrite = null;
            phase = "OBSERVE";
            outTask = Drain(outRead, input.StdoutLimit); outRead = null;
            errTask = Drain(errRead, input.StderrLimit); errRead = null;
            var watch = System.Diagnostics.Stopwatch.StartNew();
            code = "PROBE_PROCESS_STOPPED";
            while (true)
            {
                if (cancellation.IsCancellationRequested) { code = "PROBE_CANCELLED"; break; }
                if (watch.ElapsedMilliseconds >= input.WallTimeMs) { code = "PROBE_TIMEOUT"; break; }
                if (outTask.IsFaulted || errTask.IsFaulted) { code = "PROBE_OUTPUT_LIMIT_OR_IO"; break; }
                if (WaitForSingleObject(child.Process, 0) == 0) break;
                await Task.Delay(10).ConfigureAwait(false);
            }
            // Descendants are terminated even after a clean root exit.
            Check(TerminateJobObject(job, code == "PROBE_PROCESS_STOPPED" ? 0u : 1u));
            var stopWatch = System.Diagnostics.Stopwatch.StartNew();
            while (stopWatch.ElapsedMilliseconds < 2000)
            {
                var accounting = ReadStructure<Accounting>(job, JobBasicAccounting);
                cpuMs = checked((accounting.UserTime + accounting.KernelTime) / 10000);
                if (accounting.ActiveProcesses == 0) { stopped = true; break; }
                await Task.Delay(10).ConfigureAwait(false);
            }
            var stats = ReadStructure<ExtendedLimits>(job, JobExtendedLimit);
            peak = checked((long)stats.PeakJobMemory.ToUInt64());
            if (!stopped) code = "PROBE_PROCESS_TREE_UNRESOLVED";
            if (GetExitCodeProcess(child.Process, out uint observed) && observed != 259) exitCode = observed;
            if (stopped)
            {
                try
                {
                    stdout = await outTask.WaitAsync(TimeSpan.FromSeconds(2));
                    stderr = await errTask.WaitAsync(TimeSpan.FromSeconds(2));
                }
                catch { if (code == "PROBE_PROCESS_STOPPED") code = "PROBE_OUTPUT_LIMIT_OR_IO"; }
                CheckPinned(source, input.SourceHash, input.SourceBytes);
                CheckPinned(stagedSource, input.SourceHash, input.SourceBytes);
                CheckPinned(binary, input.BinaryHash, binary.Length);
                CheckPinned(stagedBinary, input.BinaryHash, binary.Length);
                if (code == "PROBE_PROCESS_STOPPED" && exitCode != 0) code = "PROBE_NONZERO_EXIT";
            }
        }
        catch (OperationCanceledException) { code = "PROBE_CANCELLED"; }
        catch (ProbeFailure failure) { code = failure.Code; }
        catch (Win32Exception failure) { code = "PROBE_NATIVE_FAILED"; nativeError = failure.NativeErrorCode; }
        catch (Exception failure) { code = "PROBE_NATIVE_FAILED"; failureType = failure.GetType().Name; }
        finally
        {
            if (child.Process != IntPtr.Zero && !resumed)
            {
                TerminateProcess(child.Process, 1);
                stopped = WaitForSingleObject(child.Process, 2000) == 0;
            }
            if (job != IntPtr.Zero) { TerminateJobObject(job, 1); CloseHandle(job); }
            if (child.Thread != IntPtr.Zero) CloseHandle(child.Thread);
            if (child.Process != IntPtr.Zero) CloseHandle(child.Process);
            source?.Dispose(); binary?.Dispose(); stagedSource?.Dispose(); stagedBinary?.Dispose();
            outRead?.Dispose(); outWrite?.Dispose(); errRead?.Dispose(); errWrite?.Dispose(); inRead?.Dispose(); inWrite?.Dispose();
            if (attributeList != IntPtr.Zero) { DeleteProcThreadAttributeList(attributeList); Marshal.FreeHGlobal(attributeList); }
            foreach (var memory in new[] { capabilities, inherited, environment }) if (memory != IntPtr.Zero) Marshal.FreeHGlobal(memory);
            // A never-created process owns no runtime. Unresolved trees retain their profile/root.
            released = !createdProfile;
            if (createdProfile && (stopped || child.Process == IntPtr.Zero)) released = DeleteAppContainerProfile(profile) == 0;
            if (packageSid != IntPtr.Zero) FreeSid(packageSid);
        }
        // Attempt files are retained for Core-owned reference/lifecycle reconciliation.
        return new("NATIVE_MEDIA_PROBE_V1", code, stopped, exitCode, stdout, stderr, cpuMs, peak, released,
            createdRoot ? root : null, createdProfile && !released ? profile : null, phase, nativeError, failureType, containerVerified);
    }

    private static NativeProbeObservation Empty(string code) => new("NATIVE_MEDIA_PROBE_V1", code, false, null, [], [], 0, 0, true, null, null, "ADMISSION", null, null, false);
    private static bool Digest(string value) => value.Length == 64 && value.All(c => c is >= '0' and <= '9' or >= 'a' and <= 'f');
    private static void VerifyContainerToken(IntPtr process, IntPtr expectedSid)
    {
        Check(OpenProcessToken(process, 8, out var token));
        try
        {
            foreach (var information in new[] { 29, 30, 31 })
            {
                GetTokenInformation(token, information, IntPtr.Zero, 0, out var length);
                if (length < 4 || length > 65536) throw Failure("PROBE_TOKEN_UNVERIFIED");
                var data = Marshal.AllocHGlobal((int)length);
                try
                {
                    Check(GetTokenInformation(token, information, data, length, out _));
                    if (information == 29 && Marshal.ReadInt32(data) != 1) throw Failure("PROBE_TOKEN_UNVERIFIED");
                    if (information == 30 && Marshal.ReadInt32(data) != 0) throw Failure("PROBE_CAPABILITIES_NOT_EMPTY");
                    if (information == 31 && !EqualSid(Marshal.ReadIntPtr(data), expectedSid)) throw Failure("PROBE_TOKEN_SID_MISMATCH");
                }
                finally { Marshal.FreeHGlobal(data); }
            }
        }
        finally { CloseHandle(token); }
    }
    private static string LocalPath(string value)
    {
        if (!Path.IsPathFullyQualified(value) || value.Length > 4096 || value.StartsWith(@"\\")
            || value.Skip(2).Contains(':') || value.Any(c => c < 32)) throw Failure("PROBE_PATH_REJECTED");
        return Path.GetFullPath(value);
    }
    private static void NoReparseParents(string full)
    {
        for (var p = full; !string.IsNullOrEmpty(p); p = Path.GetDirectoryName(p))
            if (File.Exists(p) || Directory.Exists(p))
                if ((File.GetAttributes(p) & FileAttributes.ReparsePoint) != 0) throw Failure("PROBE_REPARSE_REJECTED");
    }
    private static FileStream OpenPinned(string file, string hash, long? size)
    {
        file = LocalPath(file); NoReparseParents(file);
        var handle = CreateFileW(file, ReadAccess, ShareRead, IntPtr.Zero, OpenExisting, OpenReparse, IntPtr.Zero);
        if (handle.IsInvalid) { handle.Dispose(); throw Failure("PROBE_FILE_UNREADABLE"); }
        try
        {
            Check(GetFileInformationByHandle(handle, out var identity));
            if ((identity.Attributes & 0x410) != 0 || identity.Links != 1 || (identity.IndexHigh == 0 && identity.IndexLow == 0))
                throw Failure("PROBE_FILE_IDENTITY_REJECTED");
            var stream = new FileStream(handle, FileAccess.Read);
            try { CheckPinned(stream, hash, size); return stream; } catch { stream.Dispose(); throw; }
        }
        catch { handle.Dispose(); throw; }
    }
    private static void CheckPinned(FileStream stream, string hash, long? size)
    {
        if (stream.Length < 1 || stream.Length > 1073741824 || (size.HasValue && stream.Length != size)) throw Failure("PROBE_FILE_SIZE_MISMATCH");
        stream.Position = 0;
        if (Convert.ToHexString(SHA256.HashData(stream)).ToLowerInvariant() != hash) throw Failure("PROBE_FILE_HASH_MISMATCH");
        stream.Position = 0;
    }
    private static void CopyPinned(FileStream source, string destination)
    {
        using var output = new FileStream(destination, FileMode.CreateNew, FileAccess.Write, FileShare.None);
        source.Position = 0; source.CopyTo(output, 1048576); output.Flush(true); source.Position = 0;
    }
    [SupportedOSPlatform("windows")]
    private static void Protect(string target, SecurityIdentifier? package, bool writable)
    {
        var owner = WindowsIdentity.GetCurrent().User ?? throw Failure("PROBE_OWNER_UNKNOWN");
        var system = new SecurityIdentifier(WellKnownSidType.LocalSystemSid, null);
        var inheritance = Directory.Exists(target) ? InheritanceFlags.ContainerInherit | InheritanceFlags.ObjectInherit : InheritanceFlags.None;
        FileSystemSecurity existing = Directory.Exists(target)
            ? new DirectoryInfo(target).GetAccessControl(AccessControlSections.Owner)
            : new FileInfo(target).GetAccessControl(AccessControlSections.Owner);
        if (!owner.Equals(existing.GetOwner(typeof(SecurityIdentifier)))) throw Failure("PROBE_ROOT_OWNER_MISMATCH");
        FileSystemSecurity security = Directory.Exists(target) ? new DirectorySecurity() : new FileSecurity();
        // The creating user already owns the object. Do not request WRITE_OWNER
        // or SeRestorePrivilege merely to restate that unchanged owner.
        security.SetAccessRuleProtection(true, false);
        foreach (var sid in new[] { owner, system }) security.AddAccessRule(new FileSystemAccessRule(sid, FileSystemRights.FullControl, inheritance, PropagationFlags.None, AccessControlType.Allow));
        if (package != null) security.AddAccessRule(new FileSystemAccessRule(package, writable ? FileSystemRights.Modify : FileSystemRights.ReadAndExecute, inheritance, PropagationFlags.None, AccessControlType.Allow));
        if (security is DirectorySecurity directory) new DirectoryInfo(target).SetAccessControl(directory);
        else new FileInfo(target).SetAccessControl((FileSecurity)security);
        if (writable)
        {
            Check(ConvertStringSecurityDescriptorToSecurityDescriptorW("S:(ML;OICI;NW;;;LW)", 1, out var descriptor, out _));
            try { Check(SetFileSecurityW(target, 0x10, descriptor)); } finally { LocalFree(descriptor); }
        }
    }
    private static async Task<byte[]> Drain(SafeFileHandle handle, int limit)
    {
        using var stream = new FileStream(handle, FileAccess.Read); using var output = new MemoryStream();
        var buffer = new byte[8192]; int count;
        while ((count = await stream.ReadAsync(buffer)) != 0)
        { if (output.Length + count > limit) throw Failure("PROBE_OUTPUT_LIMIT"); output.Write(buffer, 0, count); }
        return output.ToArray();
    }
    private static void Pipe(out SafeFileHandle read, out SafeFileHandle write)
    { var security = new SecurityAttributes { Size = Marshal.SizeOf<SecurityAttributes>(), Inherit = true }; Check(CreatePipe(out read, out write, ref security, 65536)); }
    private static string Quote(string value)
    {
        var quoted = new StringBuilder("\""); int slashes = 0;
        foreach (var c in value)
        {
            if (c == '\\') { slashes++; continue; }
            quoted.Append('\\', c == '"' ? slashes * 2 + 1 : slashes).Append(c); slashes = 0;
        }
        return quoted.Append('\\', slashes * 2).Append('"').ToString();
    }
    private static ProbeFailure Failure(string code) => new(code);
    private sealed class ProbeFailure(string code) : Exception { internal string Code { get; } = code; }
    private static void Check(bool success) { if (!success) throw new Win32Exception(Marshal.GetLastWin32Error()); }
    private static void WithStructure<T>(T value, Action<IntPtr, uint> action) where T : struct
    { var p = Marshal.AllocHGlobal(Marshal.SizeOf<T>()); try { Marshal.StructureToPtr(value, p, false); action(p, (uint)Marshal.SizeOf<T>()); } finally { Marshal.FreeHGlobal(p); } }
    private static T ReadStructure<T>(IntPtr job, int type) where T : struct
    { var p = Marshal.AllocHGlobal(Marshal.SizeOf<T>()); try { Check(QueryInformationJobObject(job, type, p, (uint)Marshal.SizeOf<T>(), IntPtr.Zero)); return Marshal.PtrToStructure<T>(p); } finally { Marshal.FreeHGlobal(p); } }

    [StructLayout(LayoutKind.Sequential)] private struct Capabilities { public IntPtr Sid, List; public uint Count, Reserved; }
    [StructLayout(LayoutKind.Sequential)] private struct SecurityAttributes { public int Size; public IntPtr Descriptor; [MarshalAs(UnmanagedType.Bool)] public bool Inherit; }
    [StructLayout(LayoutKind.Sequential)] private struct Startup { public int Size; public IntPtr Reserved, Desktop, Title; public uint X, Y, XSize, YSize, XChars, YChars, Fill, Flags; public ushort Show, ReservedSize; public IntPtr ReservedBytes, In, Out, Error; }
    [StructLayout(LayoutKind.Sequential)] private struct StartupEx { public Startup Info; public IntPtr Attributes; }
    [StructLayout(LayoutKind.Sequential)] private struct ProcessInfo { public IntPtr Process, Thread; public uint Id, ThreadId; }
    [StructLayout(LayoutKind.Sequential)] private struct BasicLimits { public long ProcessTime, JobTime; public uint Flags; public UIntPtr MinWorking, MaxWorking; public uint ActiveProcesses; public UIntPtr Affinity; public uint Priority, Scheduling; }
    [StructLayout(LayoutKind.Sequential)] private struct IoCounters { public ulong ReadOps, WriteOps, OtherOps, ReadBytes, WriteBytes, OtherBytes; }
    [StructLayout(LayoutKind.Sequential)] private struct ExtendedLimits { public BasicLimits Basic; public IoCounters Io; public UIntPtr ProcessMemory, JobMemory, PeakProcessMemory, PeakJobMemory; }
    [StructLayout(LayoutKind.Sequential)] private struct Accounting { public long UserTime, KernelTime, PeriodUser, PeriodKernel; public uint PageFaults, TotalProcesses, ActiveProcesses, TerminatedProcesses; }
    [StructLayout(LayoutKind.Sequential)] private struct FileIdentity { public uint Attributes; public System.Runtime.InteropServices.ComTypes.FILETIME Creation, Access, Write; public uint Volume, SizeHigh, SizeLow, Links, IndexHigh, IndexLow; }
    [DllImport("userenv.dll", CharSet = CharSet.Unicode)] private static extern int CreateAppContainerProfile(string name, string display, string description, IntPtr capabilities, uint count, out IntPtr sid);
    [DllImport("userenv.dll", CharSet = CharSet.Unicode)] private static extern int DeleteAppContainerProfile(string name);
    [DllImport("advapi32.dll")] private static extern IntPtr FreeSid(IntPtr sid);
    [DllImport("advapi32.dll", SetLastError = true)] private static extern bool OpenProcessToken(IntPtr process, uint access, out IntPtr token);
    [DllImport("advapi32.dll", SetLastError = true)] private static extern bool GetTokenInformation(IntPtr token, int information, IntPtr data, uint length, out uint returned);
    [DllImport("advapi32.dll")] private static extern bool EqualSid(IntPtr left, IntPtr right);
    [DllImport("advapi32.dll", SetLastError = true, CharSet = CharSet.Unicode)] private static extern bool ConvertStringSecurityDescriptorToSecurityDescriptorW(string text, uint revision, out IntPtr descriptor, out uint size);
    [DllImport("advapi32.dll", SetLastError = true, CharSet = CharSet.Unicode)] private static extern bool SetFileSecurityW(string target, uint information, IntPtr descriptor);
    [DllImport("kernel32.dll")] private static extern IntPtr LocalFree(IntPtr memory);
    [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)] private static extern bool CreateDirectoryW(string path, IntPtr security);
    [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)] private static extern SafeFileHandle CreateFileW(string path, uint access, uint share, IntPtr security, uint disposition, uint flags, IntPtr template);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern bool GetFileInformationByHandle(SafeFileHandle file, out FileIdentity info);
    [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)] private static extern IntPtr CreateJobObjectW(IntPtr security, string? name);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern bool SetInformationJobObject(IntPtr job, int type, IntPtr data, uint size);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern bool QueryInformationJobObject(IntPtr job, int type, IntPtr data, uint size, IntPtr returned);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern bool TerminateJobObject(IntPtr job, uint exit);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern bool TerminateProcess(IntPtr process, uint exit);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern bool CreatePipe(out SafeFileHandle read, out SafeFileHandle write, ref SecurityAttributes security, uint size);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern bool SetHandleInformation(IntPtr handle, uint mask, uint flags);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern bool InitializeProcThreadAttributeList(IntPtr list, int count, int flags, ref UIntPtr bytes);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern bool UpdateProcThreadAttribute(IntPtr list, uint flags, IntPtr attribute, IntPtr value, UIntPtr bytes, IntPtr previous, IntPtr returned);
    [DllImport("kernel32.dll")] private static extern void DeleteProcThreadAttributeList(IntPtr list);
    [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)] private static extern bool CreateProcessW(string application, StringBuilder command, IntPtr processSecurity, IntPtr threadSecurity, bool inherit, uint flags, IntPtr environment, string directory, ref StartupEx startup, out ProcessInfo process);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern uint ResumeThread(IntPtr thread);
    [DllImport("kernel32.dll")] private static extern uint WaitForSingleObject(IntPtr handle, uint milliseconds);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern bool GetExitCodeProcess(IntPtr process, out uint exit);
    [DllImport("kernel32.dll")] private static extern bool CloseHandle(IntPtr handle);
}
