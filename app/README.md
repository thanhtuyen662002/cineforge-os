# CineForge OS desktop slice

This directory is the first usable desktop vertical slice. It keeps the UI
behind a small `CoreClient` interface so the screen can run against the real
local Core when available and still provide a deterministic first-run workspace
for design review. The browser fallback stores only the dashboard snapshot in
`localStorage`; it does not claim to be the canonical Core database.

## Run it

```powershell
cd app
npm install
npm run dev
```

Open `http://localhost:1420`. The default is Vietnamese (`vi-VN`). Use the
`VI/EN` control in the top bar to switch locale and the sun/moon control to
switch theme.

If a local Core HTTP service is available, provide its versioned base URL before
starting Vite:

```powershell
$env:VITE_CORE_BASE_URL = "http://127.0.0.1:8765"
npm run dev
```

The adapter calls:

- `GET /v1/dashboard`
- `POST /v1/projects` with `{ "name": string }`
- `POST /v1/projects/{projectId}/production-items` with `{ "title": string }`
- `POST /v1/decisions/{decisionId}/ack`

The UI never writes a database directly. When no URL is configured, the local
adapter gives the first-run shell a clearly bounded, persisted demo workspace
and labels production state honestly.

## Verify and build

```powershell
npm test
npm run build
```

`npm test` covers local persistence, decision acknowledgement, and malformed
snapshot recovery. `npm run build` runs the strict TypeScript project build
before producing `dist/`.

## Windows desktop package

The repository contains a Tauri 2 shell scaffold in `src-tauri/` for the
future native distribution. It is not the current product path: the shell does
not yet package and start the Node Core sidecar, so the packaging script fails
closed instead of producing an installer that silently falls back to the
bounded demo adapter.

Use the verified one-click portable package from the repository root:

```powershell
.\CineForge-OneClick.cmd
```

That path builds the Vite UI, bundles the local Core and Node runtime, publishes
the self-contained `CineForge.exe`, runs the vertical-slice smoke test, and
opens the app. Signing, update manifests, and final release attestation remain
release-pipeline responsibilities. The UI never receives direct filesystem or
database access.
