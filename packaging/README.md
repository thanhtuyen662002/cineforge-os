# CineForge Windows packaging

`CineForge-OneClick.cmd` is the shortest path for a Windows user:

1. Double-click `CineForge-OneClick.cmd`.
2. If `dist/CineForge-OneFile/CineForge.exe` already exists, that single executable opens immediately. A source checkout without the artifact takes the developer build path and produces it: install pinned UI dependencies, run the UI/Core checks, build the Vite bundle, package the Core, publish a self-contained bootstrap, embed and authenticate the web/Core/Node payload, run a loopback smoke test, and open the result.

The supported consumer artifact is `dist/CineForge-OneFile/CineForge.exe`. It is
one file: there is no adjacent web directory, Node runtime, Core source, or
manifest required to launch it. The EXE is a .NET single-file bundle with the
versioned ZIP payload embedded as a managed resource. Compiled metadata binds
the payload SHA-256 and canonical artifact-inventory digest before first launch.
The bootstrap extracts into `%LOCALAPPDATA%\CineForge\packages\<payload-sha256>`
using an atomic staging rename, verifies the embedded manifest and every
payload file, then starts the same local Core/web host used by the portable
path. The cache is rebuildable and keyed by the authenticated payload; user
database/data remain under `%LOCALAPPDATA%\CineForge\data`. A malformed or
tampered one-file artifact exits before creating the user data directory.

Build it explicitly with:

```powershell
.\packaging\build_windows.ps1 -Mode SingleFile
```

`-Mode Portable` remains available for diagnostics and deployment layouts that
prefer a visible `web/` and `runtime/` directory. `-Mode SingleFile` requires
the production `node-self-contained` Core mode and refuses Python/source
fallbacks so the one-file EXE never gains a hidden machine prerequisite.

Packaging is provenance fail-closed: the build refuses to run when Git reports
tracked or untracked source changes. Commit the exact source/toolchain changes
first, then rebuild; ignored build caches are recreated or excluded by the
packaging boundary. The generated manifest records `source_tree_clean: true`
alongside the exact source commit.

The one-file output is placed under `dist/CineForge-OneFile/`:

```text
dist/CineForge-OneFile/
  CineForge.exe          # the only consumer artifact
```

For diagnostics, the intermediate portable build remains available when
`-KeepBuildFiles` is supplied (or when `-Mode Portable` is run directly):

```text
dist/CineForge/
  CineForge.exe          # self-contained bootstrap and local web host
  web/                   # built UI assets
  runtime/
    node.exe             # copied Node runtime when the Node Core is present
    core/                # Core source and its server entrypoint
  build-manifest.json    # source head, mode, hashes and explicit warnings
```

The bootstrap binds only to `127.0.0.1`. It starts the packaged Core, exposes the UI on a loopback port, and proxies `/v1/*` to the Core. Mutating API requests require the exact local UI origin; proxied Core CORS headers are stripped at this desktop boundary. The browser file picker uses `POST /v1/desktop/stage`: the bootstrap accepts the raw stream only from that origin, writes it below the data root's `intake` directory, and returns a 128-bit opaque handle plus size/name metadata. The handle is resolved only inside the bootstrap when the subsequent `ImportAsset` request arrives; the browser never receives the machine path. Each handle is bound to the first successful import idempotency key: a retry with that same key is replay-safe, while a new key is rejected. Staging is capped at 8 GiB per file and stale staging directories are removed after 24 hours. Core remains the canonical hasher, object-store writer, provenance recorder, and policy boundary. The active local database and startup/Core logs live under `%LOCALAPPDATA%\CineForge\data` by default. Pass `--data DIR` to choose another data root. The bootstrap never accepts a remote bind address. A packaged runtime refuses to open in offline/demo mode if the bundled Node/Core files are missing or unhealthy; this prevents a broken release from looking like a usable product. The portable manifest contains a bounded inventory of the EXE, web bundle, and Core runtime; the embedded one-file manifest contains the web/Core inventory and is authenticated by compiled payload/content digests. The bootstrap verifies the applicable inventory before starting. This detects accidental or post-build bundle changes; the manifests remain explicitly unsigned until trusted release signing is supplied. `--allow-offline` is an explicit development escape hatch and is not used by the production one-click path.

## Build commands

From PowerShell:

```powershell
.\packaging\build_windows.ps1
.\packaging\build_windows.ps1 -Mode SingleFile
.\packaging\build_windows.ps1 -Mode Portable -SkipTests
.\packaging\build_windows.ps1 -Mode Tauri
```

`Auto` and `Portable` produce the verified intermediate portable bootstrap.
`SingleFile` is the supported Windows consumer path and does not require Rust.
It embeds the web/Core/Node payload inside the self-contained .NET bundle and
refuses Python/source Core fallbacks. `Tauri` is fail-closed for now:
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
.\packaging\single_file_smoke_test.ps1 -ExecutablePath .\dist\CineForge-OneFile\CineForge.exe
.\packaging\single_file_tamper_test.ps1 -ExecutablePath .\dist\CineForge-OneFile\CineForge.exe
```

The launcher verifies the portable manifest before starting an adjacent layout and delegates embedded-resource verification to the one-file bootstrap. The smoke tests start the real artifact, check `/healthz`, verify that the root document is HTML, exercise the redacted local integrity job list, project/item CRUD, and restart persistence. The broader portable smoke test also stages a raw browser-style upload through `/v1/desktop/stage`, imports the opaque handle through Core, creates and verifies a local backup (including idempotent replay, redacted metadata, tamper detection, and storage-pressure admission), exercises exact-pin audio/subtitle timing metadata (invalid rational bounds, overlap, idempotent replay, stale projection after a checkpoint and redaction), builds and downloads a verified timeline interchange, registers a managed returned interchange with rights/consent and idempotent replay, and verifies all durable records after a bootstrap restart. The one-file tamper test flips embedded bytes and proves the bootstrap exits with code 7 before creating user data. Offline/demo mode is accepted only when a test is explicitly called with `-AllowOffline`; a production packaging run must have a ready Core. If a launch fails, inspect `%LOCALAPPDATA%\CineForge\data\logs\bootstrap.log` and `core.log`.

## Release boundary

Both the portable bootstrap and the one-file executable are self-contained but
unsigned in this repository. A release job must sign the final EXE with the
trusted Windows certificate, publish the SBOM and provenance manifest, and
verify the exact source/toolchain/dependency digests before distribution. The
embedded and portable manifests deliberately report
`UNSIGNED_BUILD_REQUIRES_TRUSTED_RELEASE_SIGNING`; a local build is never
presented as a signed release artifact.

The current repository may not have Cargo/Rust installed. Even when it is
installed, the Tauri target remains disabled until sidecar Core startup and its
own end-to-end test are complete. The resource-embedded one-file bootstrap is
the reviewable, usable consumer path; this is an explicit product boundary,
not evidence that the Tauri installer or trusted signing/release gate has
passed.
