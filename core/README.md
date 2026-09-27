# CineForge Core vertical slice

This directory contains the first runnable local-first Core slice. It is a
Node.js 22 implementation because the current development image has no Rust
toolchain; the public boundary is deliberately transport-neutral so it can be
hosted by Tauri or replaced with a Rust Core without changing the desktop API.

The slice owns project truth in SQLite and provides:

- SQLite WAL with `foreign_keys=ON`, `synchronous=FULL`, and a busy timeout;
- local studio/actor bootstrap;
- project create, metadata update, pause, archive, trash and restore;
- task and shot records plus append-only project/task/shot notes;
- local asset intake with SHA-256 verification, content-addressed object
  storage, immutable revisions and redacted provenance-safe locations;
- optimistic `row_version` checks and deterministic idempotency keys;
- append-only `commands`, `domain_events`, and `audit_records` ledgers;
- query projections for home, project workspace, health, activity, search,
  storage, library assets, import sessions and command history;
- resumable event reads using `events.subscribe({after_seq})`;
- a JSON-line process boundary for a desktop host;
- a loopback HTTP adapter for the packaged desktop shell.

## Requirements

Node.js `>=22.5.0` is required. The implementation uses the built-in
`node:sqlite` module and has no npm runtime dependencies.

## Run tests

From the repository root:

```powershell
npm test --prefix core
```

The tests cover WAL persistence/reload, optimistic concurrency, failed-command
auditing, idempotent replay, append-only protections, task/shot notes and the
HTTP presentation surface.

## Start the Core

Without `--host` or `--port`, the process uses JSON lines on stdin/stdout. This
is the safest child-process boundary for a Tauri shell:

```powershell
node core/server.mjs --stdio --db .cineforge/cineforge.sqlite
```

Each input line is one API envelope. For example:

```json
{"api_version":"1","request_id":"r1","method":"query.system.health","params":{}}
```

When `--host` or `--port` is provided (or when `--http` is passed), the same
Core also exposes a loopback HTTP surface. The packaged Windows bootstrap uses
this mode:

```powershell
node core/server.mjs --host 127.0.0.1 --port 48201 --db .cineforge/cineforge.sqlite
```

The desktop-facing routes are:

| Method | Route | Purpose |
| --- | --- | --- |
| GET | `/v1/dashboard` | Dashboard projection used by the UI |
| GET | `/v1/health` | Versioned Core health envelope |
| POST | `/v1/projects` | Create a project; body accepts `name` or `title` |
| GET | `/v1/projects/{id}` | Read one project |
| PATCH | `/v1/projects/{id}` | Update metadata with `row_version` or `expected_version` |
| GET | `/v1/projects/{id}/workspace` | Project, tasks, shots and notes |
| POST | `/v1/projects/{id}/production-items` | Create a production task |
| GET | `/v1/projects/{id}/assets` | List project assets and latest immutable revisions |
| POST | `/v1/projects/{id}/assets` | Hash and register a local file (copy by default) |
| GET | `/v1/assets` | List assets across the studio |
| POST | `/v1/assets` | Hash and register a studio-wide local file |
| GET | `/v1/imports/{id}` | Read an import session and its item state |
| POST | `/v1/projects/{id}/notes` | Add a project note |
| POST | `/v1/decisions/{id}/ack` | Idempotent desktop acknowledgement receipt |
| GET | `/v1/events?after_seq=N` | Replay domain activity after a cursor |

Advanced clients can use `POST /v1/commands` with the canonical command
envelope. The HTTP adapter binds to loopback only. Pass `--token` (or set
`CINEFORGE_CORE_TOKEN`) to require a bearer token on every HTTP request.

The database path is user data, not an installer-owned file. Imported bytes
remain outside SQLite in a content-addressed `asset-store/objects/...` tree by
default. `ImportAsset` hashes the source through a file descriptor, rejects
symlinks/directories, verifies an optional caller hash, atomically stages the
copy, and then registers the object, immutable asset revision, provenance
record, location and import session in one Core command. The `REFERENCE` mode
records an external file location without copying it; its path is redacted in
public projections and the revision remains `UNREVIEWED` with security/decode
warnings until later scanners provide evidence.

Canonical JSON clients can call:

```json
{
  "api_version": "1",
  "method": "command.execute",
  "params": {
    "command_type": "ImportAsset",
    "idempotency_key": "import-2026-001",
    "payload": {
      "project_id": "<project-id>",
      "source_path": "C:/media/shot-010.png",
      "asset_type": "IMAGE",
      "semantic_role": "SHOT_REFERENCE",
      "storage_mode": "COPY"
    }
  }
}
```

An import succeeds only after the bytes have been read and SHA-256 verified;
security scanning and media decode remain explicit `UNKNOWN` evidence rather
than being represented as a false pass.
