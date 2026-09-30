# CineForge Windows packaging

`CineForge-OneClick.cmd` is the shortest path for a Windows user:

1. Double-click `CineForge-OneClick.cmd`.
2. If `dist/CineForge/` already contains a verified package, the self-contained executable opens immediately and needs no Node, npm, Rust or .NET installation. A source checkout without an artifact takes the developer build path: install pinned UI dependencies, run the UI/Core checks, build the Vite bundle, package the Core, publish a self-contained `CineForge.exe`, run a loopback smoke test, and open the result.

The output is placed under `dist/CineForge/`:

```text
dist/CineForge/
  CineForge.exe          # self-contained bootstrap and local web host
  web/                   # built UI assets
  runtime/
    node.exe             # copied Node runtime when the Node Core is present
    core/                # Core source and its server entrypoint
  build-manifest.json    # source head, mode, hashes and explicit warnings
```

The bootstrap binds only to `127.0.0.1`. It starts the packaged Core, exposes the UI on a loopback port, and proxies `/v1/*` to the Core. Mutating API requests require the exact local UI origin; proxied Core CORS headers are stripped at this desktop boundary. The browser file picker uses `POST /v1/desktop/stage`: the bootstrap accepts the raw stream only from that origin, writes it below the data root's `intake` directory, and returns a 128-bit opaque handle plus size/name metadata. The handle is resolved only inside the bootstrap when the subsequent `ImportAsset` request arrives; the browser never receives the machine path. Each handle is bound to the first successful import idempotency key: a retry with that same key is replay-safe, while a new key is rejected. Staging is capped at 8 GiB per file and stale staging directories are removed after 24 hours. Core remains the canonical hasher, object-store writer, provenance recorder, and policy boundary. The active local database and startup/Core logs live under `%LOCALAPPDATA%\CineForge\data` by default. Pass `--data DIR` to choose another data root. The bootstrap never accepts a remote bind address. A packaged runtime refuses to open in offline/demo mode if the bundled Node/Core files are missing or unhealthy; this prevents a broken release from looking like a usable product. The build manifest contains a bounded inventory of the EXE, web bundle, and Core runtime with byte sizes and SHA-256 digests. The bootstrap verifies that inventory before starting, and `launch_windows.ps1` verifies it before delegating to the EXE. This detects accidental or post-build bundle changes; the manifest remains explicitly unsigned until trusted release signing is supplied. `--allow-offline` is an explicit development escape hatch and is not used by the production one-click path.

## Build commands

From PowerShell:

```powershell
.\packaging\build_windows.ps1
.\packaging\build_windows.ps1 -Mode Portable -SkipTests
.\packaging\build_windows.ps1 -Mode Tauri
```

`Auto` produces the verified portable bootstrap. `Portable` is the supported
Windows product path and does not require Rust. `Tauri` is fail-closed for now:
the native shell scaffold has not yet been wired to package and start the Core
sidecar, so an installer would otherwise open a UI without the canonical local
database. `-NoInstall` avoids changing the UI dependency tree and requires
dependencies to already be installed.

The build machine needs Node.js 22.5+ (the Core uses the built-in
`node:sqlite`) and the .NET 8 SDK. The resulting portable product bundles its
own Node executable, so an end user does not need Node, npm, Rust, or the .NET
SDK installed.

The portable build is the reliable fallback when the Rust toolchain is absent. When `core/server.mjs` is present, the build copies the Node executable next to the Core, so the target machine does not need Node installed. A Python Core is supported as a development fallback; it requires Python on the target unless PyInstaller is available during the build. The generated `build-manifest.json` records which mode was used.

## Launch and smoke test

```powershell
.\packaging\launch_windows.ps1
.\packaging\smoke_test.ps1 -ArtifactRoot .\dist\CineForge
.\packaging\tamper_test.ps1 -ArtifactRoot .\dist\CineForge
```

The launcher verifies the manifest hash and the adjacent web/Core runtime before starting the exact executable. The smoke test starts that artifact, checks `/healthz`, verifies that the root document is HTML, exercises the redacted local integrity job list, project/item CRUD, stages a raw browser-style upload through `/v1/desktop/stage`, imports the opaque handle through Core, creates and verifies a local backup (including idempotent replay, redacted metadata, tamper detection, and storage-pressure admission), exercises exact-pin audio/subtitle timing metadata (invalid rational bounds, overlap, idempotent replay, stale projection after a checkpoint and redaction), builds and downloads a verified timeline interchange, registers a managed returned interchange with rights/consent and idempotent replay, and verifies all durable records after a bootstrap restart. `tamper_test.ps1` copies the artifact to a verified temp directory, changes a manifest-bound web byte, and proves the bootstrap exits with code 7 before creating user data. Offline/demo mode is accepted only when the test is explicitly called with `-AllowOffline`; a production packaging run must have a ready Core. If a launch fails, inspect `%LOCALAPPDATA%\CineForge\data\logs\bootstrap.log` and `core.log`.

## Release boundary

The portable executable is self-contained but unsigned in this repository. A release job must sign the executable/installer with the trusted Windows certificate, publish the SBOM and provenance manifest, and verify the exact source/toolchain/dependency digests before distribution. The build manifest deliberately reports `UNSIGNED_BUILD_REQUIRES_TRUSTED_RELEASE_SIGNING`; it never presents an unsigned local build as a release artifact.

The current repository may not have Cargo/Rust installed. Even when it is
installed, the Tauri target remains disabled until sidecar Core startup and its
own end-to-end test are complete. The portable bootstrap is the reviewable,
usable executable path; this is an explicit product boundary, not evidence that
the Tauri installer or production release gate has passed.
