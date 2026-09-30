# CineForge OS desktop slice

This directory is the first usable desktop vertical slice. It keeps the UI
behind a small `CoreClient` interface so the screen can run against the real
local Core when available and still provide a deterministic first-run workspace
for design review. The browser fallback stores a bounded demo snapshot plus
workspace records and local idempotency bindings in `localStorage`; it remains
a development/offline path and does not claim to be the canonical Core database
or to provide the Core command/audit ledger.

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
- `GET /v1/projects/{projectId}/workspace` for the canonical project workspace
  projection (tasks, planning shots, notes, counts, and projection sequence)
- `GET/POST/PATCH /v1/projects/{projectId}/tasks` and task resource routes for
  versioned task planning records
- `GET/POST/PATCH /v1/projects/{projectId}/shots` and shot resource routes for
  planning-shot records with a separate lifecycle state
- `GET/POST /v1/projects/{projectId}/notes` plus task/shot note routes for
  append-only, auditable notes
- `GET /v1/assets` and `GET /v1/projects/{projectId}/assets`
- `GET /v1/jobs`, `GET /v1/jobs/{jobId}` and
  `GET /v1/jobs/{jobId}/retry-plan` for the redacted local integrity queue
- `POST /v1/projects/{projectId}/assets/{revisionId}/integrity-probe` to queue
  an exact managed-object check, plus `POST /v1/jobs/{jobId}/cancel` and
  `POST /v1/jobs/{jobId}/retry` with optimistic row-version fencing
- `POST /v1/assets` or `POST /v1/projects/{projectId}/assets` with an advanced
  `source_path` or a bootstrap-issued `source_handle`
- `POST /v1/desktop/stage` for same-origin browser file-picker uploads. The
  packaged bootstrap stores the raw stream under its managed data root and
  returns an opaque, short-lived handle; the browser never receives the local
  machine path. The first successful import binds that handle to its
  idempotency key so a retry is safe and a second import with a new key is
  rejected.
- `GET /v1/decisions` and `GET /v1/decisions/{decisionId}`
- `POST /v1/decisions/{decisionId}/resolve` with a choice and decision version
- `POST /v1/decisions/{decisionId}/dismiss` with the current decision version

The UI never writes a database directly. When no URL is configured, the local
adapter gives the first-run shell a clearly bounded, persisted demo workspace,
replays equivalent local mutations by idempotency key, and labels production
state honestly. The canonical live workspace keeps task, planning-shot, and
note identities separate; a planning shot is never labelled as rendered or
approved media. The staging endpoint exists on the
packaged bootstrap boundary; a Vite development server pointed directly at
Core should use the advanced path or a Core endpoint that implements the same
staged-file contract.

## Verify and build

```powershell
npm test
npm run build
```

`npm test` covers local persistence, canonical decision resolution/dismissal,
malformed snapshot recovery, workspace records, idempotent retries, stale
conflicts, and the HTTP adapter mapping. `npm run build` runs the strict TypeScript
project build before producing `dist/`.

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

## Slice 3A integrity queue

The Activity screen shows the Core-owned local integrity queue and renders
only durable job state, next step, bounded evidence and the exact asset
revision ID. A Library row can queue a `LOCAL_ASSET_PROBE_V1` check using its
current immutable revision and SHA-256 content hash. Cancel and retry buttons
send audited commands with the latest `row_version`; the UI does not invent a
percentage or completion state while Core is reading bytes. `PASS`, `FAIL` and
`UNKNOWN` remain distinct, and `UNKNOWN` is presented as needing attention.

The desktop adapter never receives absolute paths, fencing tokens, provider
job IDs or raw diagnostics. The queue is local-only and read-only with respect
to asset bytes. Generation, provider dispatch, network/CLI execution,
automatic repair/quarantine, destructive cleanup, restore activation and
recovery epochs are outside this vertical slice.
