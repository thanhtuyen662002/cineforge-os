# CineForge Windows packaging

`CineForge-OneClick.cmd` is the shortest path for a Windows development machine:

1. Double-click `CineForge-OneClick.cmd`.
2. The script installs the pinned UI dependencies, runs the UI/Core checks, builds the Vite bundle, packages the Core, publishes a self-contained `CineForge.exe`, runs a loopback smoke test, and opens the result in the default browser.

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

The bootstrap binds only to `127.0.0.1`. It starts the packaged Core, exposes the UI on a loopback port, and proxies `/v1/*` to the Core. It stores the active local database and logs under `%LOCALAPPDATA%\CineForge\data` by default. Pass `--data DIR` to choose another data root. The bootstrap never accepts a remote bind address.

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
```

The smoke test starts the exact artifact, checks `/healthz`, verifies that the root document is HTML, and calls `/v1/dashboard` when Core is ready. Offline/demo mode is accepted only when the test is explicitly called with `-AllowOffline`; a production packaging run must have a ready Core.

## Release boundary

The portable executable is self-contained but unsigned in this repository. A release job must sign the executable/installer with the trusted Windows certificate, publish the SBOM and provenance manifest, and verify the exact source/toolchain/dependency digests before distribution. The build manifest deliberately reports `UNSIGNED_BUILD_REQUIRES_TRUSTED_RELEASE_SIGNING`; it never presents an unsigned local build as a release artifact.

The current repository may not have Cargo/Rust installed. Even when it is
installed, the Tauri target remains disabled until sidecar Core startup and its
own end-to-end test are complete. The portable bootstrap is the reviewable,
usable executable path; this is an explicit product boundary, not evidence that
the Tauri installer or production release gate has passed.
