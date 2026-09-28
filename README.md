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
dist/CineForge/CineForge.exe
```

The EXE is self-contained for the bootstrap and starts the bundled Core without
requiring Node.js on the target machine. Keep the adjacent `web/` and
`runtime/` directories next to the EXE; together they form the portable app.
An end user can then double-click `CineForge.exe` directly. The app binds only
to `127.0.0.1` and opens the browser automatically. User data is stored under
`%LOCALAPPDATA%\CineForge\data` by default; pass `--data DIR` when a different
data location is required.

## Working vertical slice

The shipped flow is real and persisted:

1. Open Home and create a project.
2. Open the project and add production items.
3. Open Library & intake, choose files with the browser picker (or drag them
   into the intake area). The packaged bootstrap streams each file into a
   short-lived local staging area and returns only an opaque handle to the
   browser. Press Import to send that handle to Core; Core verifies SHA-256,
   stores a content-addressed copy by default, and keeps immutable
   revision/provenance records. The advanced local-path field remains
   available for development and controlled migrations.
4. Reload the dashboard or restart `CineForge.exe`.
5. The project, production items, activity, and imported assets are read back
   from SQLite/object storage, with command, event, and
   audit records retained by Core.

The UI defaults to Vietnamese and includes an English toggle, dark/light theme,
responsive navigation, search, loading/error/needs-user states, Activity,
Library, Settings, and an honest offline/demo fallback only when no Core
endpoint is configured. The packaged build always configures the same-origin
Core proxy; the production import action stays disabled in the demo fallback.

## Verification

From the repository root:

```powershell
npm test --prefix core
Push-Location app; npm test; npm run build; Pop-Location
.\packaging\build_windows.ps1 -Mode Portable
```

The packaging command is the release-shaped check: it rebuilds the artifact and
must finish with `PACKAGING_SMOKE=PASS`. The manifest at
`dist/CineForge/build-manifest.json` records the source head, bootstrap hash,
runtime mode, and signing status.

The Tauri 2 files under `app/src-tauri/` are a future native-shell scaffold.
They are intentionally fail-closed in packaging until the shell packages and
starts the Core sidecar; the verified product path is the portable EXE above.
The local artifact is unsigned and must be signed by the trusted release
pipeline before distribution outside a controlled environment.
