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

## Prepared private broker fixture

Use a fresh publish output directory for the single-file Fixture EXE. Sharing
the same output directory with `dotnet build` can leave an apphost that needs
ProbeFixture.dll, which the private runtime intentionally does not copy.

`BrokerRunner` links the native worker and private named-pipe broker; its Node
client imports `core/media-probe-broker.mjs`. Supply an explicitly chosen local
absolute Node executable path, never a PATH-discovered product fallback:

```powershell
$nodeExe = 'C:\path\to\node.exe'
dotnet build "$sourceRoot/packaging/native-probe-tests/BrokerRunner/BrokerRunner.csproj" -c Release -o "$nativeOutput/broker-bin"
if ($LASTEXITCODE -ne 0) { throw 'Broker runner build failed' }
dotnet "$nativeOutput/broker-bin/NativeBrokerTests.dll" $nodeExe "$sourceRoot/packaging/native-probe-tests/broker-client.mjs" "$nativeOutput/fixture-bin/ProbeFixture.exe" "$nativeOutput/broker-evidence"
if ($LASTEXITCODE -ne 0) { throw 'Broker fixture suite failed' }
node --test "$sourceRoot/core/media-probe-broker.test.mjs"
```

Ten native transport cases exercise exclusive endpoint creation, successful
private input/output, post-start cancel/disconnect, wrong HMAC/PID/session,
retargeted cancellation, replay and declared-size overflow. Separate Node
tests exercise fragmented/coalesced frames, strict JSON/UTF-8/MAC/length and
private request bounds, plus authenticated malicious-producer output hash,
budget, sequence and missing-start evidence. These latter producer cases start
no media tool and are distinct from the actual native fixture.

The prepared Core cases now include actual guarded canonical writing from an
owned PCM WAV fixture, parser rejection, reported source size conflict, rights
revocation immediately before binding, authority expiry after raw CAS
materialization, and audit rollback. Successful binding
checks exact raw CAS/hash/size, typed rational duration and stream rows,
immutable source identity, atomic audit/events, exact replay, and isolation of
private evidence from public staging queries/import/reconciliation.

CORE_BIND_DISCONNECT disposes the broker during the Core binding transaction.
The callback verifies source/binary write locks survive the lost broker,
commits historical PASS, records UNKNOWN pin release, and proves that closing
and reopening Core inside the same Node process cannot bypass the next-dispatch
gate. These are local fixture signatures and a fake producer; real ffprobe
certification, public admission and whole-film production remain unproven.

The pipe is created with a user-only protected DACL, network/anonymous deny
entries, non-inheritable handle, exclusive first-instance and
PIPE_REJECT_REMOTE_CLIENTS. Native queries the connected OS client PID. Client
authenticates the bootstrap PID in the HMAC challenge; it has no independent
OS query of the server PID. Remote connections, alternate-user/elevation paths,
PID reuse, outer-deadline pressure and arbitrary same-user malware are not
claimed tested by these fixtures. There is no public/Core-command listener,
production certificate or DB binding. Native staging remains retained.

- [Microsoft: named-pipe creation flags](https://learn.microsoft.com/en-us/windows/win32/api/winbase/nf-winbase-createnamedpipea)
- [Microsoft: querying named-pipe client PID](https://learn.microsoft.com/en-us/windows/win32/api/winbase/nf-winbase-getnamedpipeclientprocessid)
