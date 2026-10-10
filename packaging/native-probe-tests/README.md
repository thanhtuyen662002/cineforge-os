# Prepared Windows media-probe process boundary

This suite tests `../bootstrap/NativeMediaProbe.cs` with a locally compiled,
explicitly hashed **fixture executable**. The fixture is not ffprobe and is not
a certified capability pack. The component is internal and has no public
command, HTTP, desktop-startup or UI execution path.

## Reproduce

Requires Windows x64 and a .NET 8 SDK selected by the calling directory's SDK
resolver. Run these PowerShell commands from the repository root (the verified
local run selected SDK 8.0.300):

```powershell
$sourceRoot = (Get-Location).Path
$nativeOutput = Join-Path $sourceRoot 'dist/native-probe-preparation'
dotnet publish "$sourceRoot/packaging/native-probe-tests/Fixture/Fixture.csproj" -c Release -o "$nativeOutput/fixture-bin"
if ($LASTEXITCODE -ne 0) { throw 'Fixture build failed' }
dotnet build "$sourceRoot/packaging/native-probe-tests/Runner/Runner.csproj" -c Release -o "$nativeOutput/runner-bin"
if ($LASTEXITCODE -ne 0) { throw 'Runner build failed' }
dotnet "$nativeOutput/runner-bin/NativeProbeTests.dll" "$nativeOutput/fixture-bin/ProbeFixture.exe" "$nativeOutput/evidence"
if ($LASTEXITCODE -ne 0) { throw 'Native fixture suite failed' }
```

The runner fails on a missing observation and writes `native-verification.json`.
Every test owns a new namespace; staging is retained for inspection. Test outputs
belong under ignored `dist`, and project-local `bin`/`obj` are ignored as well.
No original asset or user AppContainer profile is removed.

## Current evidence and limits

The 12 cases cover private input read, no inherited secret, inaccessible outside
fixture file, a live loopback positive control and zero-capability AppContainer
token/SID verification, timeout, cancellation after launch, cancellation before
preparation, stdout/stderr flooding, a spawned descendant, wrong binary/source
hashes, a pre-existing attempt root and a hardlinked source. Timeout and cancel
require a verified stopped process tree. The source test directory deliberately
contains spaces to exercise Windows argument quoting.

Network timeout is recorded separately from explicit access denial. A timeout
alone is not proof of isolation: the runner also verifies the actual token and
that the established listener accepted no child connection. This evidence does
not demonstrate every Windows networking or filesystem policy. A regular
AppContainer is not an LPAC profile; shared system/package resources are outside
the fixture's user-file denial check. Reparse-path rejection exists in the
component, but a reparse fixture has not been run in this suite.

Memory/active-process limits are set and read back; OOM/process-count pressure
cases remain untested. Real ffprobe compatibility, executable attestation,
external module loading, parser integration, durable Core attempts, rights
revalidation, stale-write fences, crash/restart reconciliation and Core-owned
retention are still required. No process observation is a metadata PASS verdict.
Task #64 and product completion remain open.

`packaging/bootstrap/NativeMediaProbe.cs` and this test directory are proposed
extensions to Task #64's current allowed paths. This PREPARED source requires
trusted task/path authorization, custody and independent review before
promotion; it changes no existing claim owner or control maturity.

## Owner contracts and platform references

- `docs/architecture/FINAL_ARCHITECTURE.md#ARCH-MEDIA-PROBE-NATIVE-01`
- `docs/design/FINAL_DETAILED_DESIGN.md#DESIGN-MEDIA-PROBE-NATIVE-01`
- `docs/design/EXTREME_HARDENING_CONTRACTS.md#MEDIA-PROBE-NATIVE-TEST-01`
- [Microsoft: implementing an AppContainer](https://learn.microsoft.com/en-us/windows/win32/secauthz/implementing-an-appcontainer)
- [Microsoft: process attributes](https://learn.microsoft.com/en-us/windows/win32/api/processthreadsapi/nf-processthreadsapi-updateprocthreadattribute)
- [Microsoft: Job Objects](https://learn.microsoft.com/en-us/windows/win32/procthread/job-objects)
- [Microsoft: querying token information](https://learn.microsoft.com/en-us/windows/win32/api/securitybaseapi/nf-securitybaseapi-gettokeninformation)
