# CineForge OS — Final Architecture Baseline v1

> **Status:** AUTHORITATIVE ARCHITECTURE BASELINE  
> **Applies to:** all code, schema, UI, connectors, workers, installer, updater, storage, QC, learning and release workflows.  
> **Primary product language:** `vi-VN`; secondary UI locale: `en-US`.  
> **Source risk baseline:** `docs/FOUNDATIONAL_RISK_REGISTER.md`.  
> **Change rule:** any implementation that conflicts with this file requires an explicit architecture decision and corresponding risk/invariant update before merge.

---

# 1. Product definition

CineForge OS is a **local-first Film Production Operating System**.

It is not:
- a single AI video generator;
- a ComfyUI wrapper;
- a browser automation script;
- a cloud SaaS;
- a single-agent application;
- a timeline editor only;
- a model manager only.

It is the local system of record and orchestration layer for film production that can attach replaceable execution “hands” through:

- local AI runtimes;
- local services;
- CLI applications;
- MCP servers;
- HTTP/API providers;
- automated browser/web tools;
- assisted/manual web tools;
- human operators and reviewers.

The core optimization target is:

> **Best approved creative result under explicit quality, time, cost, privacy, rights and editability constraints.**

The system must not optimize one metric such as raw generation speed, cheapest API call, AI pass rate or model benchmark in isolation.

---

# 2. Final architecture principles

1. **Kernel owns project truth.** No model/provider/editor owns canonical state.
2. **Intent > implementation.** Domain entities describe film intent; provider prompts and tool graphs are compiled derivatives.
3. **Capability > provider.** Routing selects a production strategy and capability implementation, not a brand name.
4. **Original > derived.** Original user input is immutable after ingest.
5. **Approved > latest.** Production pins explicit approved revisions; `latest` is never resolved inside deterministic execution.
6. **State changes flow through commands.** UI, assistant, automation and connectors do not mutate domain state directly.
7. **Unknown is a first-class state.** `UNKNOWN`, `OUT_OF_DOMAIN`, `STALE`, `CONFLICT` must not silently collapse into PASS.
8. **Human-readable execution.** Every long-running action must answer: what is happening, why, whether user action is needed, what is next, and what is blocked.
9. **Local-first, not local-only.** Online capabilities are optional extensions, never the system of record.
10. **Every external side effect is assumed non-transactional.** API charges, uploads, publishes and web actions may not be reversible.
11. **Approved assets are immutable.** Changes create new revisions.
12. **Every important artifact is traceable.** Immutable identity, content hash, dependency manifest, provenance and revision are required.
13. **Learning is governed.** Production feedback never directly changes production behavior without validation/promotion.
14. **Creative diversity is protected.** Routing and QC must not converge the studio into one model/style merely because it is easiest to measure.
15. **Failure containment is preferred over failure prevention fantasy.**
16. **Simple by default, deep on demand.**
17. **Vietnamese presentation is first-class; internal schemas remain locale-neutral.**

---

# 3. Layered system architecture

```text
┌──────────────────────────────────────────────────────────────┐
│                       CINEFORGE DESKTOP                      │
│ Tauri 2 + React/TypeScript                                  │
│ vi-VN default / en-US                                       │
│                                                              │
│ Home · Projects · Sáng tạo · Sản xuất · Hậu kỳ · Duyệt      │
│ Thư viện · Releases                                         │
│ Advanced: Connections · Queue · Storage · Diagnostics        │
└──────────────────────────┬───────────────────────────────────┘
                           │ local authenticated IPC/RPC
                           ▼
┌──────────────────────────────────────────────────────────────┐
│                  INTERACTION / COMMAND LAYER                 │
│                                                              │
│ Action & Command Engine                                      │
│ Assistant Intent Compiler                                    │
│ Impact Analyzer                                              │
│ Decision Inbox / Needs You                                   │
│ Undo / Compensation Ledger                                   │
└──────────────────────────┬───────────────────────────────────┘
                           ▼
┌──────────────────────────────────────────────────────────────┐
│                       STUDIO KERNEL                          │
│                                                              │
│ Project / Story / Script                                     │
│ Canon / Character / Voice / Prop / Costume / World          │
│ Asset Graph / Dependency Graph                               │
│ Canonical Timeline / Edit Graph                              │
│ Rights / Provenance                                          │
│ Project Media Contract                                       │
│ Deliverables / Release                                       │
│ Collaboration / Authority                                    │
└──────────────────────────┬───────────────────────────────────┘
                           ▼
┌──────────────────────────────────────────────────────────────┐
│                  PRODUCTION ORCHESTRATOR                     │
│                                                              │
│ Workflow Engine                                              │
│ Strategy Planner                                             │
│ Scheduler / Job Engine                                       │
│ Cost & Resource Ledger                                       │
│ Policy Engine                                                │
│ Context Compiler                                             │
└──────────────────────────┬───────────────────────────────────┘
                           ▼
┌──────────────────────────────────────────────────────────────┐
│                     CAPABILITY FABRIC                        │
│                                                              │
│ LOCAL_RUNTIME | LOCAL_SERVICE | CLI | MCP | API              │
│ BROWSER_AUTOMATED | BROWSER_ASSISTED | WEB_MANUAL | HUMAN   │
└──────────────┬───────────────────────────────────────────────┘
               ▼
┌──────────────────────────────────────────────────────────────┐
│                    ISOLATED EXECUTION                        │
│                                                              │
│ local workers · browser workers · CLI workers · MCP broker   │
│ API adapters · AI runtimes · FFmpeg · Blender · ComfyUI ... │
└──────────────┬───────────────────────────────────────────────┘
               ▼
┌──────────────────────────────────────────────────────────────┐
│                     ASSURANCE PLANE                          │
│                                                              │
│ Evidence / QC · Continuity · Rights · Security · Audit       │
│ Human Review · Benchmarking · Learning Governance            │
└──────────────┬───────────────────────────────────────────────┘
               ▼
┌──────────────────────────────────────────────────────────────┐
│                        DATA PLANE                            │
│                                                              │
│ SQLite WAL (V1) · immutable object store · manifests         │
│ event log · snapshots · indexes · cache · models · backups   │
└──────────────────────────────────────────────────────────────┘
```

UI can crash without losing worker state.
A local worker can crash without killing the Kernel.
A provider can disappear without losing project truth.
A connector can update without forcing a CineForge Core release.

---

# 4. Action & Command Engine — mandatory bridge between UX and state

Every meaningful state-changing user action, AI assistant action or automation action becomes a typed command.

Examples:
- CreateProject
- ImportDocument
- BindCharacterReference
- ApproveCharacterRevision
- ChangeVoiceBinding
- GenerateShot
- CancelGeneration
- ApproveShot
- ChangeTimelineEdit
- ChangeProjectMediaProfile
- DisableConnection
- CleanStorage
- CreateRelease
- PublishRelease

A command contains:

```text
command_id
actor_id
intent
scope
target entity revisions
preconditions
policy context
estimated cost/time/storage
rights/privacy implications
reversibility = REVERSIBLE | COMPENSATABLE | IRREVERSIBLE
external side effects
expected events
```

Execution flow:

```text
Intent
→ Resolve Scope
→ Validate Preconditions
→ Impact Analysis
→ Rights/Privacy/Policy
→ Cost/Resource Reservation
→ Confirmation only if required
→ Execute
→ Append Events
→ Reconcile Derived State
→ Return Human-Readable Outcome
```

Natural-language assistant requests compile into proposed commands. The LLM never directly writes canonical DB state.

Bulk actions must have explicit scope:
- this shot;
- selected shots;
- this scene;
- from story point X onward;
- this project;
- future work only.

High fan-out changes require impact preview before execution.

---

# 5. Story and Script domain

CineForge must preserve the original creative source and maintain a structured story model.

```text
StoryProject
├─ FilmBible
├─ ScriptDocument
│  └─ ScriptRevision
├─ Sequence
├─ SceneDefinition
│  ├─ Beat
│  ├─ ActionLine
│  ├─ DialogueLine
│  ├─ CharacterMention
│  ├─ LocationMention
│  └─ PropMention
└─ StoryEvent / CausalityFact
```

Script/PDF/DOCX/TXT/Excel import produces **candidate structured data**.

AI extraction is never automatically canon.

Workflow:

```text
Imported Original
→ Parsed Candidate
→ User/AI assisted review
→ Diff
→ Accept
→ Canonical Script Revision
```

Film Bible hierarchy and conflict precedence:

```text
Studio Constitution
→ Franchise/IP Canon
→ Production Bible
→ Sequence Intent
→ Scene Intent
→ Shot Intent
→ Temporary Execution Notes
```

A contradiction creates `CONFLICT`; the model does not silently choose.

---

# 6. Character, voice, prop, costume and world domain

Authoritative details remain in:
`docs/architecture/CHARACTER_IDENTITY_SYSTEM.md`.

Final rules:

```text
Character
├─ stable CharacterIdentity
├─ VisualIdentityPackage revisions
├─ VoiceIdentityPackage revisions
├─ PerformanceBible revisions
├─ StyleBinding revisions
├─ RightsProfile
└─ CharacterStateTimeline
```

Voice provider IDs are bindings, never identity.

Dialogue is a first-class entity and pins:
- character;
- voice revision;
- language;
- original text;
- translation revision;
- performance intent;
- pronunciation;
- timing;
- selected take.

Props, costumes and environments maintain story-state timelines.

Every shot materializes a `ShotContinuitySnapshot` before production.

Changing canon:
- creates a new revision;
- never mutates approved descendants;
- marks affected dependencies according to dependency type;
- runs impact analysis;
- does not automatically rerender large fan-out sets.

---

# 7. Canonical Timeline / Edit Graph

CineForge requires a native, provider-neutral editorial model.

```text
Timeline
├─ TimelineRevision
├─ Track
│  ├─ ClipInstance
│  │  ├─ source_asset_revision
│  │  ├─ source_in/source_out
│  │  ├─ timeline_in/timeline_out
│  │  ├─ speed/retime
│  │  ├─ transform/crop
│  │  ├─ gain/pan
│  │  └─ effect references
│  ├─ Gap
│  └─ Transition
├─ Marker
├─ Caption
├─ LinkedGroup
└─ NestedSequence
```

Time is represented with rational/frame/sample semantics, never arbitrary accumulated floating-point seconds.

Timeline edits trigger targeted dependency impact:
- subtitle timing;
- dialogue/lip sync;
- score cue timing;
- Foley/SFX;
- transitions;
- scene duration;
- final delivery.

A rendered MP4 is never the only representation of an editable production.

---

# 8. Production Dependency Graph

Dependencies are typed:

- SEMANTIC — meaning/canon;
- VISUAL — appearance/reference;
- TIMING — timeline/audio/subtitle;
- TECHNICAL — format/runtime profile;
- RIGHTS — legal permission;
- PROVENANCE — source ancestry;
- SOFT_REFERENCE — useful but not invalidating by default.

Change propagation uses dependency semantics.

Example:
- new character face revision invalidates visual identity checks, not unrelated music;
- timeline retime invalidates timing dependencies, not character canon;
- rights revocation propagates through all derivative release dependencies.

Lineage graph must reject illegal cycles.

---

# 9. Universal Intake

Accepted input classes include:
- text/clipboard;
- voice/microphone;
- images;
- video;
- audio;
- TXT/MD/PDF/DOCX;
- Excel/CSV;
- subtitles;
- folders;
- archives;
- URLs;
- 3D/project formats;
- external editor packages.

Ingest state machine:

```text
RECEIVED
→ QUARANTINED (when untrusted)
→ IDENTIFIED
→ HASHED
→ DECODE_VERIFIED
→ METADATA_EXTRACTED
→ SEMANTIC_ROLE_CANDIDATE
→ USER_CONFIRMED (if ambiguous)
→ REGISTERED_ORIGINAL
→ DERIVED_PREVIEW_READY
```

Source modes:
- MANAGED_COPY;
- EXTERNAL_LINK;
- MIRRORED.

External-linked sources maintain fingerprint/hash and can become:
- AVAILABLE;
- CHANGED_EXTERNALLY;
- MISSING.

Originals are never overwritten by normalization, cleanup or editing.

---

# 10. Project Media Contract

Each project has a versioned `ProjectMediaProfile`:

- timeline frame rate/time base;
- master resolution/aspect;
- pixel aspect;
- working color space;
- HDR/SDR policy;
- audio sample rate;
- channel layout;
- subtitle language set;
- mastering targets;
- proxy profile.

Changing this profile after production begins is a high-impact command requiring migration/impact analysis.

Every asset has explicit technical media metadata and a normalization/conversion plan where needed.

---

# 11. Capability Fabric

Capability is semantic, provider-neutral and policy-aware.

A capability request includes:

```text
semantic capability
input/output types
quality tier
duration/resolution/language
identity/continuity requirements
editability requirements
deadline/latency
privacy
rights/commercial constraints
budget
allowed transports
preferred/fallback strategy
```

Connector types:

- LOCAL_RUNTIME
- LOCAL_SERVICE
- CLI
- MCP
- API
- BROWSER_AUTOMATED
- BROWSER_ASSISTED
- WEB_MANUAL
- HUMAN

Every connector has:
- immutable connector ID;
- version;
- capability declarations;
- capability extensions;
- input/output schemas;
- auth method;
- privacy/egress behavior;
- rights constraints;
- concurrency/execution model;
- cost model;
- reliability history;
- health state;
- compatibility range.

Connection lifecycle:

```text
ADDED
→ UNVERIFIED
→ TESTING
→ READY
↔ DEGRADED
→ DRAINING
→ DISABLED
→ QUARANTINED
→ REMOVED
```

Removal, disable, uninstall runtime, delete model and remove credential are separate operations.

---

# 12. Browser/Web execution

Consumer web tools are legitimate but best-effort capabilities.

A `BrowserInteractionSession` records:
- connector;
- account/profile;
- job;
- prompt/reference fingerprint;
- page/session identity where possible;
- actions;
- upload artifacts;
- generation timestamps;
- download events;
- resulting content hashes;
- human takeover events.

Browser profiles are isolated, encrypted locally and never committed to Git.

Stateful profile concurrency is explicit.

Possible states:
- SIGNED_OUT;
- READY;
- MFA_REQUIRED;
- CAPTCHA_REQUIRED;
- DOM_CHANGED;
- RATE_LIMITED;
- CREDITS_UNKNOWN;
- HUMAN_TAKEOVER;
- DEGRADED.

Downloaded media that cannot be confidently associated with a job becomes `UNVERIFIED_ASSOCIATION`, never canonical automatically.

---

# 13. CLI and MCP security model

CLI tools use typed manifests:
- executable hash/path/version;
- allowlisted arguments;
- allowed working directories;
- allowed input/output paths;
- network permission;
- timeout;
- exit-code map;
- structured parser;
- sandbox profile.

No raw LLM-generated shell string reaches a production shell.

MCP access goes through a broker:
- explicit server identity;
- explicit tool allowlist;
- scoped project resources;
- schema/version fingerprint;
- permission policy;
- timeout/reconnect;
- quarantine on unexpected capability/schema change.

MCP server access never implies whole-project access.

---

# 14. Job, scheduler and distributed-systems model

Job identity:
- job_id;
- attempt_id;
- idempotency_key;
- provider_job_id;
- provider_event_id;
- pinned dependency manifest;
- fencing token/lease version where required.

Job states include:
- QUEUED;
- CLAIMED;
- RUNNING;
- WAITING_EXTERNAL;
- HUMAN_WAIT;
- CANCELLATION_REQUESTED;
- CANCELLED_CONFIRMED;
- CANNOT_CANCEL;
- COMPLETED;
- COMPLETED_AFTER_CANCEL;
- FAILED_RETRYABLE;
- FAILED_FINAL;
- QUARANTINED.

Timeout is not equivalent to provider failure.

Retry strategies are explicit:
- exact retry;
- repaired-input retry;
- alternate-provider retry;
- creative regeneration.

Use:
- retry budgets;
- exponential backoff;
- jitter;
- circuit breakers;
- dead-letter/quarantine;
- capacity-aware fallback;
- scheduling priority + aging/fairness.

Local scheduling accounts for:
- VRAM/RAM;
- loaded model state;
- thermal/resource telemetry;
- model-switch cost;
- worker memory leaks/recycling;
- storage reserve.

---

# 15. Cost & Resource Ledger

CineForge tracks:
- currency spend;
- provider credits;
- estimated/actual API cost;
- local GPU time;
- storage growth;
- human review time;
- retries/repair cost.

Before large jobs:

```text
Estimate
→ Reserve Budget/Capacity
→ Execute
→ Actual Usage
→ Reconcile
```

Unknown provider/browser costs remain `UNKNOWN`; they are not guessed as zero.

Routing objective is multi-dimensional:
- quality;
- expected approval rate;
- cost;
- latency;
- editability;
- privacy;
- rights;
- capacity;
- narrative importance.

Cost per generated second is not a primary quality metric.
Track cost/time/human-minutes per approved result.

---

# 16. Evidence & QC Engine

QC is an ensemble of evidence producers, not one omniscient AI judge.

Evidence classes include:
- deterministic media validation;
- identity;
- anatomy/object;
- temporal;
- continuity;
- motion;
- depth;
- text/OCR;
- speech transcript;
- speaker;
- voice identity;
- pronunciation;
- lip sync;
- audio technical;
- acoustic continuity;
- film grammar;
- rights/provenance;
- human review.

Every evaluation records:
- evaluator ID/version;
- threshold/policy revision;
- validated domain;
- tested dimensions;
- untested dimensions;
- evidence pointers;
- confidence/calibration;
- result: PASS/FAIL/UNKNOWN/OUT_OF_DOMAIN/CONFLICT.

AI PASS never means global correctness.

Critical high-confidence PASS samples receive random human audits.

Reviewer UI defaults to human-readable issues and timestamps/regions; raw metrics are Advanced.

Approval binds to:
- exact artifact hash/revision;
- exact representation actually reviewed;
- dependency snapshot;
- review policy;
- reviewer/authority;
- timestamp.

---

# 17. Repair system

Repair is represented as new attempts and never overwrites approved content.

Repair scopes may target:
- frame/time range;
- spatial region;
- audio segment;
- identity;
- motion;
- dialogue;
- color;
- subtitle;
- composite.

Repair Engine:
- starts from highest-quality valid ancestor;
- enforces attempt budget;
- detects repeated state/quality cycles;
- compares multi-objective/Pareto candidates;
- may switch production strategy;
- escalates to human instead of infinite repair.

---

# 18. Decision Inbox / Needs You

Human decisions are domain objects, not arbitrary modal dialogs.

`DecisionRequest` includes:
- title;
- human-readable reason;
- blocking scope;
- affected entities;
- evidence;
- choices;
- recommended choice;
- deadline if any;
- default behavior if ignored;
- authority required.

Home, notifications, project view and assistant all consume the same DecisionRequest source.

If nothing is required:

> “Bạn chưa cần làm gì. CineForge đang tiếp tục xử lý.”

---

# 19. Undo, autosave and branching

Autosave preserves work-in-progress; it never approves/canonicalizes content.

Every mutating command records reversibility:

- REVERSIBLE — true inverse available;
- COMPENSATABLE — cannot reverse external side effect but can compensate;
- IRREVERSIBLE — publish/leak/training transfer etc.

Creative experiments support branching:
- Character variant;
- Scene variant;
- Timeline variant;
- Workflow experiment.

Branches can be compared, promoted or discarded without overwriting canonical state.

---

# 20. Deliverables, handoff and release

CineForge can produce:
- individual image/video/audio;
- approved shots;
- scenes/sequences;
- dialogue takes;
- voice tracks;
- music cues;
- Foley/SFX/ambience;
- stems;
- subtitles/transcripts;
- masks/depth/layers where available;
- timeline interchange;
- final masters;
- archive packages.

Canonical timeline is editor-neutral.

Handoff adapters may produce:
- generic media package;
- CapCut-oriented package;
- OpenTimelineIO where suitable;
- AAF/EDL/FCP XML adapters where validated;
- editor-specific compatibility report.

Every handoff has a `HandoffManifest`.

External edits re-enter as `ExternalEdit` revisions. If only a flattened render is available, CineForge records lineage but does not pretend to know internal edits.

Export and Publish are distinct.

Release pipeline:

```text
Picture/Timeline Revision Locked
→ Audio Master Locked
→ Subtitle/Localization Locked
→ Rights Revalidated
→ Technical Master Build
→ Final QC
→ Release Candidate
→ Immutable Release Manifest
→ Optional Publish
→ Delivered Output Verification
```

Publish is treated as an irreversible boundary with stronger authorization.

---

# 21. Storage, garbage collection, backup and archive

Storage classes:
- ORIGINAL;
- CANONICAL_APPROVED;
- RELEASE_MASTER;
- LEGAL_PROVENANCE;
- DERIVED_REBUILDABLE;
- CANDIDATE;
- FAILED_CANDIDATE;
- CACHE;
- TEMP;
- MODEL;
- UPDATE/INSTALLER CACHE.

GC is graph-aware and never directory-age-only.

Safe purge checks:
- canonical references;
- release references;
- active jobs/leases;
- legal hold/rights evidence;
- Failure Lake retention;
- Trash retention;
- true rebuildability;
- cross-project dedup references.

GC runs dry-run first and reports expected reclaimed bytes.

Storage pressure policy:
- warn;
- clean rebuildable cache;
- stop new large jobs at critical reserve;
- never delete originals/canon/masters automatically.

Move-library workflow:
- preflight;
- pause writers;
- copy;
- hash verify;
- atomic root switch;
- rollback;
- delayed deletion.

Backup:
- consistent DB + object manifest checkpoint;
- verification;
- restore drills;
- alternate-location restore;
- project-only or full-studio restore.

Archive retains:
- canonical creative source;
- approved assets;
- final masters;
- timeline;
- audio;
- subtitles;
- rights/provenance;
- project DB snapshot/manifests;
- critical failure examples if required.

---

# 22. Security and trust boundaries

Trust zones:
1. CineForge Kernel — highest trust.
2. Signed CineForge workers.
3. Certified local tools/runtimes.
4. Connected MCP/API providers.
5. Browser/web sessions.
6. Imported/generated media/content — untrusted data.
7. User-installed custom connectors/models — quarantined until certified.

Models/custom nodes/plugins follow:

```text
QUARANTINE
→ HASH
→ SCAN/REVIEW
→ SANDBOX
→ BENCHMARK
→ CERTIFY
→ PRODUCTION
```

Credentials:
- stored through Windows secure credential facilities;
- DB stores references, not plaintext secrets;
- workers receive minimum scoped credentials;
- browser auth state encrypted locally;
- never included in logs/crash dumps.

Telemetry is local-first and privacy-safe by default.

Generated text inside an image, subtitle or document never becomes a trusted instruction channel.

---

# 23. Rights and provenance

Separate records:
- provenance;
- ownership;
- license;
- consent;
- commercial rights;
- territories;
- expiration;
- attribution;
- cloning permission;
- training permission;
- derivative permission;
- provider restrictions.

License evidence is snapshotted, not only linked.

Rights are checked:
- at ingest when relevant;
- before cloud egress;
- before training/fine-tuning;
- before generation if provider terms matter;
- before release;
- before publish.

Rights revocation creates a tombstone/revocation state that dominates stale callbacks.

Taint propagation discovers affected derivatives, timelines, masters and releases.

Binary deduplication never merges distinct legal identities.

---

# 24. Learning and systemic-failure safeguards

This is mandatory to cover R04 and R16.

Learning order:

```text
Memory
→ Measurement
→ Benchmarking
→ Routing improvement
→ optional model/evaluator training
```

Production feedback never directly promotes a new evaluator/router.

Promotion pipeline:

```text
Candidate
→ Offline benchmark
→ Golden-set validation
→ Cross-domain validation
→ Shadow mode
→ Randomized comparison
→ Human review
→ Promotion
→ Rollback-capable deployment
```

Safeguards:
- evaluator version frozen/pinned per production policy;
- benchmark suites versioned;
- rotating unseen benchmarks;
- stratified metrics by shot archetype;
- random audits of high-confidence PASS;
- explicit OUT_OF_DOMAIN;
- diversity/exploration budget for routing;
- provider/model identity hidden from blind evaluators where possible;
- no AI-generated label becomes ground truth without policy;
- Failure Lake taxonomy versioning;
- ability to deprecate/forget obsolete heuristics;
- cross-project training requires explicit rights scope.

Emergent-loop detector monitors:
- provider share concentration;
- evaluator/provider correlation;
- repeated style convergence;
- retry/repair oscillations;
- fallback oscillations;
- metric improvements caused by workload mix shift;
- rapid fan-out invalidations;
- queue/resource starvation.

No single metric can trigger autonomous promotion.

---

# 25. UI/UX architecture

Primary navigation:
- Trang chủ
- Dự án
- Sáng tạo
- Sản xuất
- Hậu kỳ
- Duyệt
- Thư viện
- Releases

Advanced:
- Kết nối
- Hàng đợi
- Dung lượng
- Diagnostics
- Settings

Every important screen must answer within seconds:
1. Tôi đang ở đâu?
2. CineForge đang làm gì?
3. Có cần tôi làm gì không?
4. Tiếp theo là gì?

Global lightweight status:
- background tasks;
- Needs You count;
- critical blocking issue count.

Do not expose provider/GPU/queue details in normal creative workflows unless relevant.

Design rules:
- one clear primary action per screen;
- progressive disclosure;
- Focus Mode for review/editing;
- no fake percentage progress;
- long waits expose real milestones/evidence;
- result previews appear as soon as available;
- color + icon + text, never color-only;
- dark/light themes share identical semantic hierarchy;
- red reserved for truly critical/destructive/release/security issues;
- Vietnamese copy written naturally, not literal technical translations;
- terminology dictionary governs film terms.

---

# 26. Collaboration-ready model

V1 may be single-user, but all authoritative events include:
- actor_id;
- authority role;
- entity revision/version;
- timestamp;
- command_id.

Future collaboration uses:
- optimistic concurrency;
- stale-form detection;
- edit leases where necessary;
- explicit conflict states;
- review/approval authority;
- offline merge policy.

Do not redesign IDs/events later to “add users.”

---

# 27. Persistence and database architecture

V1:
- SQLite WAL;
- only CineForge Core writes;
- UI/workers/connectors use Core IPC/RPC.

Logical domains/tables include:

### Identity / access
- actors
- roles
- permissions
- credentials_refs

### Projects / story
- projects
- project_media_profiles
- film_bibles
- script_documents
- script_revisions
- sequences
- scenes
- beats
- story_events
- dialogue_lines

### Canon
- characters
- visual_identity_revisions
- voice_identity_revisions
- performance_bibles
- costumes
- costume_states
- props
- prop_states
- environments
- environment_states
- style_bibles
- continuity_snapshots

### Assets
- assets
- asset_revisions
- asset_locations
- asset_dependencies
- asset_lineage
- asset_technical_metadata
- asset_rights_bindings

### Editorial
- timelines
- timeline_revisions
- tracks
- clip_instances
- transitions
- markers
- captions
- external_edits

### Commands/events
- commands
- domain_events
- snapshots
- decision_requests
- undo_compensations

### Production
- workflows
- workflow_revisions
- production_strategies
- jobs
- job_attempts
- leases
- generation_sessions
- repair_sessions

### Connections
- connections
- connector_versions
- capabilities
- capability_extensions
- health_checks
- browser_sessions

### QC
- evaluations
- evidence
- human_reviews
- failure_labels
- golden_examples
- benchmark_runs
- promotion_records

### Rights
- rights_records
- licenses
- consents
- revocations
- license_snapshots

### Cost/resources
- budgets
- reservations
- usage_records
- resource_samples

### Delivery
- export_sessions
- handoff_manifests
- release_candidates
- release_manifests
- publications

### System
- notifications
- audit_log
- schema_migrations
- storage_objects
- storage_gc_runs
- backups
- update_history

Binary media lives in immutable/content-addressed storage, not SQLite blobs.

---

# 28. Installer, runtime provisioning and updates

Windows distribution:
- Tauri 2 shell;
- Rust Core;
- signed binaries;
- signed NSIS Setup.exe;
- optional MSI;
- separate updater signing key;
- capability/runtime packs.

Base installer contains only what is needed to boot CineForge reliably.

Optional heavyweight capabilities/models are provisioned after installation.

Provisioning flow:
- hardware scan;
- capability need;
- signed manifest;
- download;
- hash/signature verification;
- staging;
- health check;
- benchmark;
- atomic activation.

Update planes are independent:
- Core/UI;
- connector;
- runtime;
- model;
- benchmark/evaluator policy.

Production can pin exact dependency revisions.

No dependency update is forced into an active production if it can change output semantics without an explicit policy/migration.

---

# 29. Observability and recovery

Operational observability is separate from creative state.

Track:
- core health;
- worker health;
- queue state;
- connector health;
- storage pressure;
- DB integrity;
- update state;
- backup state;
- monitoring-heartbeat itself.

“No alerts” is not health.

App/window close semantics are explicit:
- Close UI only;
- continue Core/jobs;
- Exit CineForge after safe job handling.

Power loss/crash recovery:
- atomic/staged asset writes;
- job reconciliation;
- temporary-file quarantine;
- idempotent re-entry;
- incomplete command recovery;
- no approval from partially persisted actions.

---

# 30. Red-team and verification architecture

CI/staging must eventually exercise:
- schema migrations;
- command idempotency;
- stale revision writes;
- duplicate callbacks;
- delayed callbacks;
- cancelled-late completion;
- disk full;
- corrupt media;
- malformed archives;
- bad Unicode;
- huge metadata;
- provider outage;
- browser session expiry;
- MCP schema drift;
- malicious filenames;
- custom connector sandbox;
- restore drills;
- rights revocation;
- evaluator version drift;
- canon fan-out changes;
- timeline timing changes;
- GC dry run;
- update rollback.

Architecture is not accepted merely because unit tests pass.

---

# 31. Risk Register coverage matrix

| Risk | Architecture control |
|---|---|
| R01 Specification | Film Bible hierarchy, conflict state, Script candidate review, Context Compiler |
| R02 Epistemic | explicit UNKNOWN/OUT_OF_DOMAIN, evidence ensemble, human authority |
| R03 QC | Evidence Engine, exact-byte approval, random audits, final-master QC |
| R04 Learning | golden/shadow/promotion pipeline, no direct production self-training |
| R05 Creative degeneration | creative intent first, diversity/exploration budget, human creative authority |
| R06 State/continuity | typed Dependency Graph, Story State, ShotContinuitySnapshot |
| R07 Media engineering | ProjectMediaProfile, rational timing, media technical metadata, final validation |
| R08 Distributed systems | Command Engine, idempotency, fencing/stale write rejection, retry budgets |
| R09 Reproducibility | pinned manifests, runtime/model/connector revisions, archived outputs |
| R10 Tool/integration | Capability Fabric, typed connector contracts, extension namespaces |
| R11 Infrastructure/storage | staged ingest, graph-aware GC, storage reserve, backup/restore |
| R12 Security | trust zones, sandbox, quarantine/certification, scoped credentials, no arbitrary shell |
| R13 Rights/provenance | separate Rights domain, release-time revalidation, taint propagation |
| R14 Human/org | DecisionRequest, authority roles, exact approvals, collaboration-ready actor model |
| R15 Economic | Cost & Resource Ledger, reservations, approved-result metrics, WIP limits |
| R16 Emergent/systemic | learning governance, concentration/oscillation monitors, diversity budget, fan-out controls |
| R17 Lifecycle/archive | schema versioning, migration discipline, archive packages, pinned dependencies, restore drills |

No R01–R17 class is considered “solved”; each has an explicit containment/control location in architecture and must retain tests/monitoring.

---

# 32. Implementation order

## Phase 0 — Architecture contracts
- schemas for IDs/revisions/events/commands;
- ProjectMediaProfile;
- Asset/Dependency types;
- connector contract;
- UI state contract.

## Phase 1 — Foundation vertical slice
- installer/updater skeleton;
- Desktop + Core;
- SQLite/event/audit;
- Action/Command Engine;
- Universal Intake;
- immutable asset store;
- Story/Script baseline;
- Character/Voice/Continuity baseline;
- Capability Fabric with a minimal local/CLI/web/API sample set;
- Job engine;
- Decision Inbox;
- basic Review;
- canonical timeline baseline;
- Deliverable export;
- Storage Manager.

## Phase 2 — First complete real short film
Target: 3–5 minutes with:
- at least 2 speaking characters;
- multiple locations;
- character continuity;
- voice continuity;
- music/SFX/Foley;
- subtitles;
- edit/timeline;
- export + external handoff;
- release candidate.

Use failures from this production to refine architecture.

## Phase 3 — Production intelligence
- richer Evidence/QC;
- continuity graph;
- repair engine;
- strategy router;
- benchmarking;
- cost routing.

## Phase 4 — Adaptive studio
- Failure Lake;
- learning/promotion;
- distributed workers;
- collaboration;
- multi-production;
- advanced connectors.

Universal breadth is expanded only after the first end-to-end production proves the foundation.

---

# 33. Architecture invariants to enforce in code/tests

1. UNKNOWN never silently becomes PASS.
2. Approved revisions never mutate.
3. Production jobs never resolve `latest`.
4. Every canonical mutation has a Command record.
5. Every important artifact has immutable identity + hash + dependency manifest.
6. Approval binds to exact reviewed bytes/revision/dependencies.
7. Revocation/tombstone dominates stale callbacks.
8. External callbacks and jobs are idempotent/replay-safe.
9. Stale writes are rejected.
10. Asset lineage rejects illegal cycles.
11. Cache keys include all semantic dependencies.
12. Original inputs are never overwritten.
13. File existence never proves validity.
14. Media time is rational/frame/sample based.
15. Color/audio/timebase/codec/precision are first-class.
16. Evaluator results record version, domain, tested/untested scope and uncertainty.
17. High-confidence PASS still receives random audit according to policy.
18. Out-of-domain evaluators abstain.
19. Generated/imported content is untrusted data.
20. Uncertified models/plugins/connectors cannot receive production privilege.
21. Workers and agents are least-privilege.
22. Learning changes cannot self-promote from production feedback.
23. Repair loops have convergence and attempt guards.
24. Fallback is capacity/policy aware and cannot silently lower protected quality/privacy/rights.
25. Rights are revalidated before release/publish.
26. Irreversible actions receive stronger governance.
27. Every release has immutable release manifest.
28. Search/vector indexes never define identity.
29. Rollback distinguishes internal rollback from external compensation.
30. Monitoring health is itself monitored.
31. No metric is treated as proof of film quality.
32. Every bulk mutation has explicit scope and impact analysis.
33. Cancelled external jobs can still complete; late results never auto-canonicalize.
34. Autosave never implies approval.
35. Timeline revisions pin exact source asset revisions.
36. Script AI extraction is candidate until accepted.
37. Cleanup is graph/retention based, never filename/folder heuristic.
38. Connection removal cannot silently break pinned production.
39. Natural-language commands compile into auditable typed commands.
40. Publish is distinct from Export.
41. Every critical wait state exposes real progress evidence or says progress is unknown.
42. Every authoritative event carries actor identity.
43. No provider/tool/model is required for project truth to remain usable.
44. Creative original-language source is never overwritten by translation/provider prompts.
45. No production-wide learning change is activated without rollback path.

---

# Final architecture statement

CineForge OS is finalized at the architecture level as:

> **A local-first, event/audit-backed, command-driven film production kernel with immutable asset/canon revisions, a provider-neutral capability fabric, explicit story/continuity/timeline state, evidence-based QC, rights-aware routing, graph-aware storage lifecycle, safe external handoff/release, and governed adaptive learning.**

The architecture deliberately separates:
- **what the film means** from **how a tool executes it**;
- **what the user intends** from **what state changes occur**;
- **what AI believes** from **what evidence establishes**;
- **what can be undone** from **what has irreversible external effects**.

This baseline is the authoritative reference for implementation until replaced by an explicitly reviewed architecture revision.


# 34. Detailed-design domains promoted to architecture

The multi-role detailed-design red-team found several concerns that are architectural, not optional implementation detail. They are therefore part of the authoritative architecture:

## Production planning
CineForge includes a production planning domain distinct from execution jobs:
- ProductionTask;
- TaskDependency;
- Milestone;
- WIP policy;
- critical-path/bottleneck projections.

## Audio/music
CineForge models:
- conversational/performance context;
- dialogue/ADR/nonverbal/Foley/SFX/ambience/room-tone/music cues;
- acoustic-space profiles;
- mix buses/stems;
- music themes/motifs and spotting events;
- intentional silence.

## Localization/accessibility
Original-language content remains canonical while translation, subtitle, dubbing and accessibility tracks are independently versioned/approved derivatives.

## VFX/compositing
Layered compositions, masks/depth/alpha/render passes and coordinate/unit/camera metadata are first-class where needed; a flat rendered video is not the only editable representation.

## Provisioning/package lifecycle
Core/connector/runtime/model/tool/policy/benchmark packages have signed manifests, dependencies, installations, health checks, certification and project pins.

## Policy inheritance
Automation/control preferences resolve through:
Studio → Project → Sequence → Scene → Shot → Task.
Auto/Guided/Advanced/Expert behavior is policy, not hard-coded UI mode.

## Diagnostics/support
CineForge exposes a health graph and redacted diagnostic bundles so failures can be diagnosed without exposing credentials or private media by default.

## Global entity/revision registry
Logical entities and immutable revisions have global registries so polymorphic dependencies, reviews, rights and audit records can validate referential identity.

# 35. Authoritative detailed implementation references

Implementation must conform to:
- `docs/design/FINAL_DETAILED_DESIGN.md`
- `docs/design/SCHEMA.md`
- `docs/design/STATE_MACHINES.md`
- `docs/design/API_CONTRACTS.md`
- `docs/design/UI_COMPONENT_SYSTEM.md`
- `docs/design/DETAILED_DESIGN_RED_TEAM.md`

This architecture remains authoritative for boundaries/invariants; the detailed design files are authoritative for implementation contracts.

If implementation reveals a contradiction:
1. stop the conflicting implementation;
2. identify the affected risk/invariant;
3. update architecture + detailed contracts together;
4. add migration and regression test;
5. only then resume code.
