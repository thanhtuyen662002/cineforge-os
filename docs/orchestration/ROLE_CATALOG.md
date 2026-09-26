# CineForge OS — Agent Role Catalog

> Roles are capabilities. Slots are runtime worker instances.

# 1. Planner / Task Architect

Reads:
- AGENTS.md
- FINAL_ARCHITECTURE
- FINAL_DETAILED_DESIGN
- orchestration operating model
- open Epics/Issues/PRs/CI

Produces:
- Epics;
- small Task Issues;
- dependency graph;
- role affinity;
- risk/review class;
- contract-first tasks;
- unblock tasks.

Must ask:
- Can this be parallelized?
- Is this dependency truly hard?
- Are two tasks touching the same hotspot?
- Can a contract merge first?
- Will this task remain valid if another PR merges?

Does not:
- create hundreds of speculative tasks far ahead;
- assign blocked tasks to active slots;
- make the user manually decompose ordinary engineering work.

# 2. Flow Governor / Bottleneck Controller

Primary objective: reduce idle time on the critical path.

Watches:
- ready queue depth;
- blocked issue count;
- PR age/state;
- verification-context CI age;
- review age;
- merge conflicts;
- dependency chain;
- slot distribution;
- integration hotspots;
- flaky infrastructure.

Actions:
- split/re-slice;
- add contract task;
- reassign role capacity;
- take over stale PR;
- fix/assign CI issue;
- prioritize review;
- reorder merge;
- temporarily stop low-value new work.

It is allowed to interrupt the default role allocation when flow is unhealthy.

# 3. Integrator

Owns merge safety.

Checks:
- dependency completion;
- exact reviewed HEAD plus relevant BASE/merge context;
- CI status;
- independent review;
- unresolved comments;
- migration ordering;
- branch freshness;
- scope drift.

May:
- update branch;
- resolve merge conflicts;
- request focused fix;
- merge;
- close task.

Should avoid becoming a serial approval bureaucracy. Low-risk green PRs should flow quickly.

# 4. QA / CI / Release Guardian

Owns confidence and throughput of verification.

Responsibilities:
- fast PR gates;
- impacted integration tests;
- flaky test classification;
- regression tests;
- nightly/full suites;
- release packaging checks;
- fuzz/chaos/recovery tests;
- CI performance.

Treat a 2-hour PR CI for every small change as an architecture problem in the development process, not normal waiting.

# 5. Core / Kernel Builder

Areas:
- Command Engine
- domain events
- IPC/API
- policy/decision engine
- orchestration core

# 6. Data / Storage Builder

Areas:
- SQLite migrations
- revision/event schema
- object store
- GC
- backup/restore
- project media metadata

Own migration discipline and compatibility.

# 7. Desktop / Platform Builder

Areas:
- Tauri shell
- Core process lifecycle
- installer
- updater
- Windows integration
- notifications
- provisioning shell

# 8. Product UI / UX Builder

Areas:
- React/shadcn
- design system
- navigation
- workspaces
- loading/error/recovery states
- accessibility
- vi-VN/en-US UX

Must implement Core-provided human state rather than inventing independent domain truth.

# 9. Story / Canon Builder

Areas:
- script
- Film Bible
- character
- voice identity
- props/costumes/world
- continuity

# 10. Timeline / Edit Builder

Areas:
- canonical timeline
- edit operations
- conform
- NLE handoff
- timing dependencies

# 11. Audio / Music / Localization Builder

Areas:
- dialogue
- voice production
- ADR
- mix/stems
- music themes/cues
- subtitles/dubbing/accessibility

# 12. Media Runtime Builder

Areas:
- FFmpeg/probing
- workers
- media normalization
- resource scheduling
- preview/proxy
- render staging

# 13. Capability / Connector Builder

Areas:
- connector SDK
- CLI
- MCP
- API
- browser/web
- local model/runtime adapters

# 14. Security / Rights Builder

Areas:
- trust boundaries
- sandbox
- credentials
- consent/license/provenance
- provider terms
- release gates
- supply chain

# 15. Flex / Hotspot Worker

A dynamically assigned role.

Used for:
- critical-path task;
- review surge;
- CI fixes;
- merge conflict;
- dependency unblock;
- integration hotspot;
- test debt.

A Flex slot should not accumulate long-lived feature ownership.
