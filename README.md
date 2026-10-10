# CineForge OS

CineForge OS is a local-first film-production workspace. The current product
slice is usable on Windows: it starts a loopback web host, launches the local
Core, stores the canonical workspace in SQLite, and exposes a calm Vietnamese
first-run UI for the first production workflow.

## One-click Windows run

For a development checkout, double-click [`CineForge-OneClick.cmd`](CineForge-OneClick.cmd).
It installs the pinned UI dependencies when needed, runs the UI and Core tests,
builds the UI, bundles the Core plus a self-contained Node runtime, publishes
the bootstrap, runs the packaged CRUD and restart-persistence smoke test, and
opens CineForge in the default browser.

The resulting product is:

```text
dist/CineForge-OneFile/CineForge.exe
```

The one-file EXE embeds and authenticates the web bundle, Core, and self-contained
Node runtime. An end user can double-click `CineForge.exe` directly; no Node.js,
.NET SDK, `web/`, `runtime/`, or manifest is required beside it. On first launch
the authenticated payload is extracted into a per-user rebuildable cache and the
local Core/database starts behind a loopback web host. The app binds only to
`127.0.0.1` and opens the browser automatically. User data is stored under
`%LOCALAPPDATA%\CineForge\data` by default; pass `--data DIR` when a different
data location is required.

The portable layout remains available for diagnostics and controlled deployment:

```text
dist/CineForge/CineForge.exe
dist/CineForge/web/
dist/CineForge/runtime/
dist/CineForge/build-manifest.json
```

## Working vertical slice

The shipped flow is real and persisted:

1. Open Home and create a project.
2. Open the project workspace. Add canonical tasks, planning shots, and
   append-only notes. Tasks own planning status; a planning shot owns only its
   lifecycle and does not stand in for rendered media, review, or approval.
3. Open Library & intake, choose files with the browser picker (or drag them
   into the intake area). The packaged bootstrap streams each file into a
   short-lived local staging area and returns only an opaque handle to the
   browser. Press Import to send that handle to Core; Core verifies SHA-256,
   stores a content-addressed copy by default, and keeps immutable
   revision/provenance records. The advanced local-path field remains
   available for development and controlled migrations.
4. Reload the dashboard or restart `CineForge.exe`.
5. The project, tasks, planning shots, notes, activity, and imported assets are
   read back from SQLite/object storage, with command, event, and
   audit records retained by Core.
6. Open a timeline to add project-scoped audio cues and subtitle timing
   metadata. Each cue/track pins an exact timeline revision and SHA-256 content
   hash; rational intervals, same-locale overlap, idempotency, rights and
   materialization gates are enforced by Core. A newer checkpoint projects old
   timing as STALE with a next step. This slice records metadata only and does
   not play, render, generate or approve media automatically.

The UI defaults to Vietnamese and includes an English toggle, dark/light theme,
responsive navigation, search, loading/error/needs-user states, Activity,
Library, and Settings. A bounded offline/demo adapter exists only in Vite
development/test mode for design review. The production bundle fails closed
when Core is unavailable and never presents or mutates demo data. The packaged
build always configures the same-origin Core proxy, and production import
remains disabled until that live Core is ready.

## Verification

Prepared technical-media reads use `MEDIA_PROBE_PROJECTION_V1`. Core verifies
bound evidence and each typed stream against raw CAS bytes and rechecks source,
rights and current toolchain authority before returning measurements. Library
shows the verified summary and stream details; stale/blocked/unknown projections
hide measurements without rewriting immutable history. Native fixture evidence
is explicitly fake-producer/ephemeral-signer evidence. It does not certify a
real ffprobe pack, enable public analysis or prove end-to-end film completion.

From the repository root:

```powershell
npm test --prefix core
Push-Location app; npm test; npm run build; Pop-Location
.\packaging\build_windows.ps1 -Mode SingleFile
```

The packaging command is the release-shaped check: it rebuilds the one-file
artifact and must finish with `SINGLE_FILE_SMOKE=PASS` and
`SINGLE_FILE_TAMPER=PASS`. The embedded manifest records the source head, byte/
hash inventory for the web bundle and Core runtime, runtime mode, and signing
status. The bootstrap verifies that inventory before starting; the local build
remains explicitly unsigned until a trusted release signer attaches authenticity.

The Tauri 2 files under `app/src-tauri/` are a future native-shell scaffold.
They are intentionally fail-closed in packaging until the shell packages and
starts the Core sidecar; the verified product path is the one-file EXE above.
The local artifact is unsigned and must be signed by the trusted release
pipeline before distribution outside a controlled environment.
