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


# 36. Persistence authority clarification

CineForge V1 is event/audit-backed, not a pure event-sourced system.

A successful Core mutation transaction writes:
- normalized authoritative domain rows/revisions;
- corresponding append-only domain events;
- outbox records when external dispatch is required.

Operational canonical state lives in the normalized domain model and immutable revision registries.
Domain events are the immutable causality/audit ledger and support reconciliation/projection rebuilds.

V1 does not require reconstructing every canonical table solely from event replay.

Derived projections/search/indexes are rebuildable and must never become a second source of truth.

This clarification prevents a dual-authority implementation where some agents treat relational tables as canonical and others treat event replay as canonical.


# 37. Windows storage/platform constraints

## Active SQLite database root

CineForge V1 uses SQLite WAL and therefore treats the active database root more strictly than general asset storage.

Default/supported production rule:
- active SQLite DB/WAL lives on a supported local filesystem/root managed by CineForge;
- do not silently place the live DB inside SMB/UNC/network shares, cloud-sync folders, removable media or provider-synced folders merely because the user selected them as a general data location;
- assets, exports and backups may use additional roots according to their own capability/availability policy;
- backup to remote/cloud is performed from a consistent checkpoint, not by relying on arbitrary live DB file synchronization.

If future versions support remote/network DB placement, it requires an explicit tested storage profile rather than inheriting generic file-path support.

## Windows filesystem behavior

Managed object storage uses hash-derived safe paths.

User-facing export/handoff names must handle:
- reserved Windows names;
- invalid path characters;
- case-insensitive collisions;
- Unicode normalization;
- long-path capability;
- offline/removable volumes.

Filename sanitization must preserve a manifest mapping original logical names to emitted paths.

# 38. Browser/web automation permission state

Technical ability to automate a consumer web product is not sufficient permission.

Each browser/web connection records an automation policy state:
- ALLOWED
- ASSISTED_ONLY
- MANUAL_ONLY
- UNKNOWN
- BLOCKED

Routing rules:
- ALLOWED may use BROWSER_AUTOMATED subject to policy;
- ASSISTED_ONLY may automate safe navigation but requires human takeover for restricted steps;
- MANUAL_ONLY uses prepared prompt/reference handoff;
- UNKNOWN does not silently assume automation is allowed;
- BLOCKED prevents automated use.

ProviderTermsSnapshot and project policy determine the effective mode.


# 39. Recovery epoch and external-world fencing

A database restore is not a rollback of providers, browsers, emails, publications, charges or in-flight jobs.

CineForge therefore maintains a monotonic **Recovery Epoch**.

Every external dispatch/attempt/session records:
- recovery_epoch;
- command/job identity;
- external correlation identity.

After a restore:
1. Core enters `RECOVERY_RECONCILIATION`;
2. increment recovery epoch;
3. freeze new external dispatch;
4. reconcile restored outbox entries against known provider/external receipts;
5. quarantine callbacks/events belonging to an unknown/newer historical epoch rather than applying them;
6. revalidate browser sessions/connections;
7. surface unresolved external side effects;
8. only then resume normal dispatch.

Never blindly replay a restored outbox.

# 40. SQLite WAL and system storage-pressure governor

SQLite WAL correctness requires more than “single writer”.

Core monitors:
- WAL bytes/growth rate;
- oldest active read transaction age;
- checkpoint progress;
- DB/cache/temp/free-disk reserve;
- write latency.

Rules:
- UI/projection reads must not hold unbounded read transactions;
- long analytical reads use bounded snapshots/chunking;
- failed checkpoints are visible health signals;
- CRITICAL storage pressure pauses large imports/generation/proxy/model downloads;
- if safe persistence cannot be guaranteed, Core enters read-only/degraded safe mode instead of repeatedly failing writes.

Disk reservation is advisory; external processes can consume the same volume.

# 41. Desktop WebView/native bridge security boundary

The desktop UI is privileged code.

Imported/generated/user content must never gain equivalent privilege through HTML/Markdown rendering.

Required:
- strict Content Security Policy;
- no unsanitized active HTML/script;
- remote navigation does not retain native/Tauri bridge access;
- external links open through a controlled system-browser path;
- local media resolver uses scoped short-lived tokens;
- IPC/native commands validate authenticated session, authority, origin/context and typed payload;
- renderer compromise is assumed possible and must not equal unrestricted filesystem/shell access.

# 42. Import/media parser sandbox and resource budgets

All media/document/archive inputs are hostile until validated.

Parser/prober workers enforce:
- recursion/archive expansion limits;
- decoded pixel/sample/frame limits;
- CPU/RAM/time quotas;
- file-count/metadata-size limits;
- protocol/network deny by default for media parsers such as FFmpeg;
- no arbitrary local-file/network traversal through playlists/manifests;
- sandboxed temporary output roots;
- kill/recover behavior for hung parsers.

File extension never authorizes a parser path.

# 43. Context Compiler trust channels

Context Compiler does not concatenate “all useful text” into one instruction stream.

Every segment has:
- provenance;
- trust class;
- semantic role;
- authority level.

Only trusted system/policy/task-control segments may instruct tools or mutate workflow behavior.

Untrusted:
- screenplay text;
- OCR;
- imported documents;
- subtitles;
- web content;
- model output;
- media metadata

are supplied as quoted/typed data, never promoted to control instructions merely because they contain imperative language.

# 44. Artifact durability, digest agility and external materialization

Provider/session URLs are not canonical assets.

External output becomes a CineForge READY artifact only after:
`REMOTE_RESULT → STAGING → LOCAL_MATERIALIZED → HASHED → DECODE_VERIFIED → REGISTERED → READY`.

Content identity stores an algorithm-qualified digest, e.g. `sha256:<digest>`, so hash algorithms can migrate without ambiguous identities.

# 45. Cost exposure and uncertain external acceptance

A reservation estimate is not a hard spending boundary when provider billing is delayed/unknown.

Budgets support:
- maximum unreconciled external exposure;
- per-command/job exposure ceiling;
- unknown-cost policy;
- provider quota/credit guard when observable.

When timeout leaves acceptance/cost unknown:
- reconcile before retry;
- do not multiply exposure blindly.

# 46. Update/DB compatibility and trust-root recovery

Application update declares:
- minimum readable schema version;
- maximum compatible schema version;
- migration plan;
- rollback compatibility.

Prefer expand/contract migrations across an app rollback window.

A destructive/incompatible migration requires a verified DB/object checkpoint and explicit recovery path; rolling back only the executable is not sufficient.

Updater/signing trust includes:
- key IDs;
- offline/root trust vs online signing key where practical;
- rotation;
- revocation;
- emergency recovery.

# 47. Human creative ownership and AI late-write fencing

AI automation must not silently overwrite intentional human edits.

Editable scopes may carry a human/manual ownership lock or revision fence.

If an AI job was created before a human edit/lock:
- its late result may remain a candidate/evidence;
- it cannot silently become canonical over the newer human-owned state;
- explicit user/command promotion is required.

# 48. Bulk fanout and resource reservation

Before large fanout:
- estimate job count/cost/storage/resource exposure;
- support sample-first/staged dispatch policy;
- set batch exposure cap;
- allow fast bulk cancel/invalidate after upstream canon/reference correction.

Resource scheduling uses reservations/leases with safety headroom, not free-memory telemetry alone, for GPU/VRAM/CPU/disk constrained work.

# 49. Restore/machine-move credential behavior

Credentials backed by OS/user secure storage may not be portable with project backups.

After restore/machine move:
- missing secure credential material yields `REAUTH_REQUIRED`;
- CineForge does not silently route creative work to another provider merely because credentials are unavailable;
- user/project policy determines whether fallback is allowed after explicit state reconciliation.

# 50. Backup resilience profile

Local writable backup is not protection against every machine-wide failure/ransomware event.

CineForge supports policy distinction:
- local fast backup;
- separate-volume backup;
- offline/immutable backup target when configured;
- restore-verified backup.

Backup health reports recoverability evidence, not only “last copy succeeded”.


# 51. URL intake, browser navigation and SSRF boundary

Universal URL intake and browser automation are network clients and therefore security boundaries.

Rules:
- explicit scheme allowlist;
- deny localhost, loopback, link-local, RFC1918/private and platform metadata destinations by default unless a trusted capability explicitly needs them;
- resolve and validate destination at connection time, not only at form-validation time;
- revalidate every redirect;
- defend against DNS rebinding;
- no automatic forwarding of credentials/cookies across origin changes;
- `file:`, device, custom and shell-like protocols are denied unless a separately trusted feature explicitly handles them;
- enforce download byte/time limits.

Browser navigation policy and URL-import policy are separate from generic “internet allowed”.

# 52. Callback/webhook authenticity

External inbox idempotency is not authentication.

Before an external callback enters trusted inbox processing:
- verify provider-specific signature/token/channel identity;
- validate timestamp/replay window where the provider supports it;
- bind callback to expected connection/provider account and external job identity;
- reject or quarantine unverifiable callbacks.

A forged callback cannot become authoritative merely because its `provider_event_id` is unique.

# 53. Immutable object-store alias safety

Canonical content-addressed objects are immutable bytes.

Never expose canonical object bytes through a writable hardlink or other writable alias to:
- an NLE;
- user workspace;
- external tool;
- export staging;
- connector.

Editable paths use:
- copy;
- verified copy-on-write/reflink semantics where supported;
- separate staging objects.

Canonical object hash is periodically verifiable and may be repaired from a trusted mirror according to policy.

# 54. Autonomous dependency and executable supply-chain governance

An agent may not treat “add package/library” as an ordinary invisible code edit.

Executable dependency additions/upgrades must consider:
- registry/package identity;
- lockfile/provenance;
- publisher/source reputation where available;
- license/commercial compatibility;
- vulnerability/security policy;
- install/build/postinstall scripts;
- transitive executable payload;
- SBOM/release provenance.

Typosquatting or license conflict is a build-governance defect, not merely a coding failure.

# 55. Protected invariant tests

Tests that enforce security/architecture/data invariants are governance assets.

A feature PR may update them only with explicit rationale and review appropriate to the protected invariant.

CI/governance should detect:
- deletion;
- weakening;
- unexplained coverage disappearance;
- changed expected-failure semantics

for protected invariant suites.

A PR cannot make itself “green” by silently deleting the rule that would fail it.

# 56. Local OS-user isolation

Default local roots, IPC endpoints and secure metadata are scoped to the current OS user.

Rules:
- user-specific ACLs on Core DB, credentials, browser profiles, diagnostics and unreleased media by default;
- shared/multi-user roots require explicit configuration;
- local authenticated RPC is additionally protected by OS endpoint ACL/session binding;
- local-user separation is not replaced by “localhost only”.

# 57. External linked-source TOCTOU protection

For critical ingest/relink:
- resolve selected source;
- open/copy it into private staging or hold a stable OS handle where practical;
- hash the bytes actually parsed/imported;
- compare expected identity before canonicalization.

Path, file size and mtime are hints, not authoritative identity.

# 58. Rebuildability includes legal and executable dependencies

A derived artifact is safely rebuildable only if:
- recipe inputs remain available;
- required package/runtime/model/provider capability remains usable;
- required rights/license remain permitted;
- the recipe is still compatible with current policy.

GC/package removal/license revocation can therefore invalidate “rebuildable” status.

# 59. Canonical/event integrity audit

Because V1 is relational-canonical with event/audit backing, add an integrity auditor for:
- aggregate version monotonicity;
- revision registry consistency;
- command→event/outbox expectations;
- orphan/missing audit links;
- impossible state combinations;
- duplicate or skipped aggregate versions.

The auditor reports/repairs through explicit recovery commands; it never silently rewrites history.

# 60. Worker crash circuit breaker

Automatic restart is bounded.

Repeated crash/restart:
- exponential backoff;
- restart budget;
- transition worker/package/runtime to UNHEALTHY/QUARANTINED;
- stop dispatching dependent work;
- surface diagnostic evidence.

“Restart forever” is not self-healing.

# 61. Web account/workspace identity

Authentication success does not prove the correct provider account/tenant/workspace is active.

Where provider semantics permit, a connection pins/verifies:
- account identity;
- tenant/workspace/project identity;
- region/data-residency-relevant identity.

If identity changes unexpectedly:
- mark connection NEEDS_REVIEW/REAUTH;
- do not continue automation into the new workspace silently.

# 62. Bulk action snapshot scope

Bulk approve/delete/generate/review commands bind an immutable scope:
- exact entity/revision IDs; or
- a materialized query snapshot with hash/version.

Items that appear after user/agent confirmation do not silently join the operation.

UI selection/focus changes cannot mutate the command scope after confirmation.


# 63. Core singleton and DB ownership fencing

CineForge V1 supports one authoritative Core process per live Core database.

Protection has two layers:
- OS-user scoped instance/process lock for fast duplicate-launch prevention;
- DB ownership epoch/fencing record for crash/updater/restart correctness.

Rules:
- a second live Core cannot become active scheduler/writer for the same DB;
- a stale lock file alone cannot permanently block restart;
- Core startup proves previous owner is dead/expired before taking a new ownership epoch;
- every external-dispatch scheduler/maintenance owner validates current DB ownership epoch;
- V1 does not support two OS users/processes sharing one live SQLite database as a multi-user server.

Updater must drain/stop old Core before activating new Core ownership.

# 64. Database maintenance and SQLite connection invariants

Every Core SQLite connection verifies required PRAGMAs, including foreign-key enforcement.

Migrations/rebuild/VACUUM:
- estimate/reserve worst-case temporary disk;
- run under maintenance/safe-boundary policy;
- use transactional/verified migration patterns;
- compare applied migration checksum to repository migration identity;
- fail safe on checksum drift.

A user copy of only the main DB file while WAL is active is not an approved backup method.
Approved backup uses SQLite-safe online backup/snapshot semantics plus object manifest checkpoint.

# 65. Time semantics and clock uncertainty

Separate:
- monotonic duration/timeout measurement;
- sequence/version ordering;
- wall-clock civil/legal timestamps.

Authoritative history ordering uses sequence/version, not UUIDv7 or wall-clock timestamp alone.

If system clock changes beyond configured tolerance:
- enter `TIME_UNCERTAIN`;
- revalidate token/license/rights/schedule assumptions where material;
- do not reorder history based on changed wall clock.

# 66. Derived confidential-data lifecycle

Privacy/rights scope propagates to derived artifacts and indexes:
- thumbnails;
- proxies;
- waveforms;
- OCR/transcripts;
- embeddings/vector indexes;
- search indexes;
- diagnostics;
- learning examples.

Revocation/delete/privacy-scope change invalidates or removes derived copies according to policy.

Cross-project/global retrieval cannot return derived confidential data without matching scope/authority.

# 67. Local runtime network egress policy

A “local” worker/package does not automatically have network permission.

Runtime/package/connector manifest declares:
- network DENY;
- destination ALLOWLIST;
- or explicitly REQUIRED network scope.

Sensitive/local-only project policy can require network-denied workers.

Unexpected egress is a health/security failure.

# 68. Local service binding and IPC replay resistance

Local services:
- bind approved local interfaces only unless explicitly designed otherwise;
- use OS ACL/firewall/session isolation;
- do not expose MCP/Core/worker control APIs on `0.0.0.0` by default;
- use short-lived/scoped authentication material;
- protect privileged commands from replay with session/nonce/idempotency semantics;
- never log bearer/session secrets.

# 69. Timeline/undo/variant scale management

Mutable edit histories are bounded by compaction/checkpoints.

Rules:
- periodic working-session snapshots reduce replay length;
- undo-retained operations pin required dependent assets;
- GC respects undo reachability until retention expires/checkpoint policy releases it;
- candidate/variant sets have WIP/archive/retention policies;
- UI/search do not require loading every historical candidate at once.

# 70. Recovery projection/index invalidation

Recovery epoch applies to derived read models too.

After restore:
- any projection/search/vector/cache built from events/state newer than restored checkpoint is invalid;
- projections are rebuilt or version-fenced before authoritative UI/query use;
- security-sensitive deletion/revocation may synchronously fence stale index versions so deleted confidential content is not queryable during rebuild.

# 71. Release final revalidation

Immediately before final signing/release/publish:
- reverify required artifact hash/availability;
- rights/consent/provider terms;
- signing trust/readiness;
- release manifest dependency versions;
- no blocking recovery/integrity finding.

A previous approval does not override current missing/corrupt/revoked release input.

# 72. Large bulk scope manifests

Large bulk command scope is stored as an immutable manifest object with digest rather than an unbounded JSON payload.

The command/event references:
- scope manifest ID/hash;
- item count;
- query/source snapshot metadata.

Execution streams the pinned manifest and revalidates per-item revision policy.



# 51. URL intake, browser navigation and SSRF boundary

Universal Intake URL support and browser connectors are network security boundaries.

Default-deny rules:
- allow only explicitly supported schemes;
- deny `file:`, device/custom protocols and arbitrary local-path navigation unless a dedicated trusted feature requires them;
- resolve and classify destination at connect time;
- revalidate every redirect;
- block localhost, loopback, link-local, RFC1918/private ranges and platform metadata endpoints unless an explicit trusted connector policy grants access;
- do not forward credentials/cookies/auth headers across origins unless connector policy explicitly allows it;
- bound response size, redirect count, DNS resolution time and total transfer duration.

DNS rebinding is handled by checking the actual connected address, not only the hostname before resolution.

# 52. External callback authenticity

Idempotency protects against duplicates; it does not prove who sent the event.

Every provider callback/webhook ingress must have a connector-specific authenticity policy:
- signature or shared-secret verification when supported;
- provider/source identity;
- timestamp/replay window where supported;
- raw-body hash;
- event/correlation ID dedupe;
- recovery epoch compatibility.

Unauthenticated callbacks never enter canonical `external_inbox_events` as trusted provider facts. They are rejected or quarantined as security evidence.

# 53. Content-addressed storage immutability

Canonical CAS bytes are immutable by construction.

Rules:
- canonical objects are not exposed through writable hardlinks;
- editable handoff/export/staging uses copies or proven copy-on-write semantics;
- registration verifies the final stored object hash after write/rename;
- external files are copied/opened into stable private staging before security/parser work when TOCTOU matters;
- symlink/junction/reparse/hardlink semantics must not allow external mutation of canonical objects.

# 54. Autonomous dependency supply-chain governance

A coding agent may not treat “add package” as an ordinary invisible implementation detail when executable dependencies change.

Dependency additions/upgrades require evidence appropriate to risk:
- exact registry/source and version/commit;
- lockfile;
- package integrity/provenance when available;
- license/commercial compatibility;
- vulnerability/advisory check;
- install/build/postinstall script implications;
- transitive/native binary implications;
- SBOM inclusion for releasable artifacts.

Typosquatting and dependency-confusion risk are part of review.

# 55. Critical invariant-test protection

Tests that encode security, storage, rights, command/idempotency, recovery or orchestration invariants are governance-sensitive assets.

A feature PR may update them when semantics legitimately change, but:
- deletion/weakening must be explicit in diff/review;
- required invariant-test classes cannot silently disappear and still satisfy CI;
- CI/review compares expected invariant inventory/coverage against baseline;
- a PR cannot make itself green merely by removing the test that caught the violation.

# 56. Local user isolation

Default CineForge roots and local IPC are scoped to the current OS user.

Requirements:
- user-private filesystem ACLs for DB/secrets/session metadata by default;
- no world/every-user writable IPC endpoint;
- secure local token/session material is per user;
- shared media roots are explicit and do not imply shared credential/control-plane access.

# 57. External source stability and TOCTOU

For linked/external assets, metadata fingerprint is only a fast-change hint.

When identity matters:
- validate canonical path/volume/file identity;
- open/copy into trusted staging through a stable handle where platform permits;
- compute cryptographic digest before approval/use as pinned production input;
- detect replacement even when size/mtime are unchanged.

# 58. Rebuildability includes legal and package availability

A derived object is “rebuildable” only if its recipe dependencies are currently acceptable:
- inputs available;
- tool/model/package version available or substitutable by policy;
- required rights/licenses permit regeneration;
- connection/provider capability still exists;
- privacy policy permits the execution route.

Package/model removal and storage GC share this dependency graph.

# 59. Canonical/event integrity audit

Because V1 stores canonical relational state plus append-only audit/events, Core periodically verifies invariants such as:
- aggregate/revision version monotonicity;
- entity/revision registry consistency;
- command→event/outbox transaction expectations;
- orphan/missing outbox records;
- impossible canonical transitions;
- audit references to nonexistent entities/revisions.

Detected mismatch enters integrity-recovery state; automatic “repair” must not invent missing historical facts.

# 60. Worker crash-loop circuit breaker

Worker restart policy is bounded.

Repeated crashes within a policy window cause:
`UNHEALTHY → BACKING_OFF → QUARANTINED`

The scheduler stops assigning new work until:
- automatic repair/health test succeeds; or
- operator/agent resolves the cause.

Restart storms must not consume all system capacity or repeatedly corrupt the same workload.

# 61. Browser account/workspace identity

For services where account/workspace/tenant matters, connection identity includes expected remote identity.

Authentication success alone is insufficient.

Health/dispatch may verify:
- account identifier;
- organization/workspace/project;
- region or environment where relevant.

A re-login that lands in a different account/workspace enters `IDENTITY_MISMATCH` and blocks autonomous mutation until resolved.

# 62. Bulk command snapshot semantics

Bulk commands never mean “whatever currently matches this filter at execution time” unless explicitly designed that way.

At confirmation/plan time, bind:
- exact entity/revision IDs; or
- immutable/materialized query snapshot hash.

New items arriving after confirmation are excluded.
Items whose revisions changed are stale/revalidated according to command policy.



# 63. Execution-time revalidation for long/high-impact work

Plan-time authorization is not sufficient when reality can change during execution.

Before each irreversible/high-impact phase/item, revalidate the relevant current facts:
- rights/consent;
- actor authority where policy requires continued authority;
- current recovery epoch;
- current manual ownership/revision fence;
- package/runtime identity;
- resource reservation;
- budget/unreconciled exposure;
- connection/account/workspace identity.

If revalidation fails:
- pause/stop before the unsafe phase;
- preserve already-completed evidence;
- do not pretend prior external effects were undone.

# 64. Protection leases for concurrent retention/removal

Operations that require an object/package/runtime to remain available acquire temporary protection leases.

Examples:
- backup;
- restore;
- export/release build;
- active job;
- integrity scrub/repair;
- rebuild recipe verification.

GC/package removal/uninstall cannot finalize while an unexpired valid protection lease exists.

Protection lease is scoped to immutable identity, not path alone.

# 65. Time-source discipline

Different time meanings use different clocks.

Use:
- monotonic elapsed time for local duration/backoff/lease-renew timing where possible;
- GitHub/provider/Core authoritative server time for cross-agent lease event ordering;
- trusted wall time for certificate/license/absolute expiry.

Detect large wall-clock jumps.

Security-sensitive validity checks encountering implausible time drift enter DEGRADED/NEEDS_REVALIDATION rather than silently trusting local clock.

UUIDv7 timestamps and ordinary event timestamps are not authoritative ordering primitives.

# 66. Crash-resumable migrations

Every nontrivial migration defines:
- precondition;
- idempotent step/checkpoint;
- durable completion marker;
- postcondition;
- compatibility/rollback state.

After crash/reboot:
- resume from last verified step;
- never blindly replay an ambiguous destructive step;
- enter SAFE_MODE/RECOVERY_REQUIRED if postcondition cannot prove state.

# 67. Integrity incident containment

Severe canonical/audit/event inconsistency creates an integrity incident.

Containment may freeze:
- one aggregate;
- one project;
- one subsystem;
- whole canonical mutation plane,

according to severity.

Allowed during freeze:
- read/diagnostic;
- evidence capture;
- verified backup;
- typed repair/reconciliation.

Normal writes resume only after recheck passes or an explicit authority-approved degraded policy applies.

# 68. Event/projection scale and bounded rebuild

Event/audit history is durable, but runtime must not require replay from event 0 forever.

Use:
- aggregate snapshots;
- projection checkpoints;
- versioned compatible snapshot formats;
- verified archival of older event ranges;
- rebuild from nearest compatible checkpoint;
- integrity links between archived ranges/checkpoints.

Archival never removes evidence required by rights/audit/forensics policy.

# 69. Hermetic CI/release execution

Security-critical CI and release/signing use clean declared inputs.

Required:
- clean checkout/worktree/container/VM;
- no untracked residue from earlier PR;
- pinned toolchain/dependency inputs;
- verified package/runtime hashes;
- trusted cache policy or clean rebuild;
- artifact attestation to source/config/toolchain.

Release signing never consumes arbitrary artifact found in a persistent workspace.

# 70. Search is navigation, never mutation authority

Search/vector/index results may be stale.

Any command/bulk operation:
1. resolves canonical entity/revision IDs;
2. revalidates current permissions/rights/state;
3. materializes exact scope snapshot;
4. only then mutates.

Deleted/revoked/stale search hits cannot regain authority by appearing in search.

# 71. Large-directory intake budget

Folder intake is incremental and bounded before fanout.

Limits:
- maximum enumerated files per phase;
- nesting depth;
- enumeration wall/CPU budget;
- metadata-read budget;
- cancel/pause checkpoints;
- deferred/lazy deeper enumeration where appropriate.

Proxy/hash/semantic generation starts under separate fanout budgets, not during uncontrolled traversal.



# 72. At-rest encryption policy

Filesystem ACLs and encryption are distinct controls.

CineForge supports an explicit at-rest protection policy, for example:
- `OS_VOLUME_PROTECTED` — rely on validated OS/disk encryption such as BitLocker-equivalent;
- `CINEFORGE_MANAGED_ENCRYPTION` — CineForge-managed encryption for selected data classes;
- `EXTERNAL_ENCRYPTED_TARGET` — destination provides verified encryption;
- `UNENCRYPTED_ALLOWED_BY_POLICY`.

UI/security status must not claim “encrypted” merely because a path is private to one Windows user.

Selected sensitive classes may require stronger policy:
- Core DB;
- unreleased media;
- browser/session material;
- diagnostic bundles;
- backups.

# 73. Encryption key lifecycle and crypto agility

Managed encryption requires:
- authority-qualified globally unique key identity;
- OS-backed secure key storage;
- explicit key wrapping/recovery policy;
- rotation/revocation;
- resumable rewrap/re-encryption;
- algorithm/version metadata;
- periodic decryptability verification for archives.

If no recoverable wrapped key exists, the user must be told that losing the key can make data permanently unreadable.

Key material is never stored beside encrypted backup as plaintext.

# 74. Project clone/duplicate semantics

`DuplicateProject` is not a byte-for-byte policy clone.

The operation explicitly declares inheritance for:
- creative/canon assets;
- linked media;
- rights/consent evidence;
- project privacy/egress policy;
- budgets;
- external connection permissions;
- automation preferences;
- learning/data-use scope.

Defaults:
- do not clone credentials;
- do not clone browser sessions/cookies;
- do not assume rights/consent valid for the new purpose/project;
- shared CAS bytes remain reference-counted/graph-protected.

# 75. Purpose-specific data-use policy

A single `training_allowed` boolean is insufficient for all derivative uses.

Policy distinguishes purposes such as:
- PRODUCTION
- EVALUATION_QC
- SEARCH_INDEX
- CROSS_PROJECT_RETRIEVAL
- FAILURE_ANALYSIS
- LEARNING
- TRAINING_FINE_TUNING
- EXTERNAL_PROVIDER_PROCESSING
- EXPORT_SHARE
- PUBLIC_RELEASE

Derived-data creation/retrieval/learning obeys the allowed purpose + scope.

# 76. Egress authority is separate from read authority

Permission to view/read project data does not imply permission to:
- send it to cloud/model/provider;
- export/share it;
- publish it;
- include it in diagnostics;
- use it for learning/training.

Every egress-capable command validates an egress/share/export permission and current project privacy policy.

# 77. Diagnostic artifact security

Diagnostic bundles are sensitive managed artifacts.

They carry:
- sensitivity classification;
- redaction policy;
- allowed recipient/use;
- ACL/encryption state;
- expiry/purge policy;
- explicit raw-media inclusion flag.

Redaction includes:
- secrets/tokens;
- local usernames;
- sensitive absolute paths;
- private URLs/query strings;
- browser form/password fields;
- clipboard content by default excluded.

# 78. Honest deletion semantics

CineForge differentiates:
- logical deletion/tombstone;
- policy purge;
- provider deletion request;
- cryptographic erasure where managed key destruction meaningfully renders ciphertext inaccessible;
- physical secure erase.

The product does not guarantee physical byte erasure on SSD/cloud/provider systems where it cannot prove it.

# 79. Release privacy leakage scan

Final release verification can include privacy/content metadata rules:
- absolute/local file paths;
- internal project/client names in metadata;
- hidden audio/video/data tracks;
- embedded comments/notes;
- subtitle/transcript sensitive strings;
- unintended provenance fields;
- private identifiers.

Privacy scan is separate from copyright/rights and codec QC.

# 80. Child-process privacy containment

Local tools/models/plugins operate in managed scopes.

Policy controls:
- writable filesystem roots;
- temp/log/crash-dump roots;
- network destinations;
- environment variable secrets;
- clipboard access;
- diagnostic capture.

A child process must not quietly create an unmanaged long-term prompt/media history outside the declared sandbox.



# 81. Logical content identity vs encrypted physical storage

CineForge separates:
- logical plaintext content identity;
- physical stored-object/ciphertext identity;
- encryption/wrapping scope.

Cross-project dedup is a policy choice, not a universal invariant.

Rules:
- do not require convergent/deterministic encryption to preserve dedup;
- crypto-erasure of one privacy scope must not destroy another scope that legitimately references equivalent content;
- global plaintext hashes are not exposed as untrusted user/API lookup oracles;
- physical storage may contain multiple encrypted representations of the same logical plaintext when privacy/key scopes differ.

# 82. Envelope encryption

For CineForge-managed media encryption:
- each large object may use a random data-encryption key;
- policy/root keys wrap the data key;
- key rotation should prefer rewrapping data keys over rewriting terabytes when policy/algorithm permits;
- store ciphertext digest/integrity separately from plaintext logical digest;
- plaintext digest verification occurs only after successful decrypt/read.

No key identity or wrapped-key metadata is accepted without authority/key-version binding.

# 83. Multi-resource reservation deadlock prevention

Resource admission across GPU/VRAM/CPU/RAM/DISK/BROWSER_PROFILE uses:
- deterministic global resource acquisition order; or
- atomic admission plan before any partial reservation becomes ACTIVE.

A job must not hold resource A indefinitely while waiting for B if another job holds B while waiting for A.

Reservations support:
- priority/admission class;
- interactive reserve;
- aging/fairness;
- bounded future horizon.

HUMAN_WAIT releases resources that are not physically necessary to preserve the waiting session.

# 84. Context criticality and non-droppable classes

Context Compiler assigns each segment a criticality class:
- MANDATORY_POLICY
- MANDATORY_RIGHTS_PRIVACY
- MANDATORY_CANON
- TASK_CRITICAL
- OPTIONAL_ENRICHMENT

Compilation fails or requests a different strategy/model when mandatory content cannot fit.
It never silently drops mandatory policy/rights/privacy/canon constraints to satisfy provider context size.

# 85. Context dependency fence

Compiled context stores a dependency manifest/hash covering:
- canonical revisions;
- policy/privacy/rights revisions;
- task contract;
- provider/adapter semantic profile;
- translation/derived prompt representation.

Immediately before dispatch and before policy-sensitive retry:
- revalidate dependency manifest;
- recompile if stale;
- bind exact compiled payload hash to the job attempt.

A stale compiled prompt is evidence, not reusable authority.

# 86. Provider semantic-limit certification

Capability certification covers practical semantics, not only request schema:
- observed context/request limits;
- reference count/size behavior;
- first/last-frame semantics;
- unsupported/ignored parameters;
- server-side truncation/rewrite behavior where detectable;
- output association/materialization behavior.

Detected semantic drift can mark connector capability DEGRADED/REQUIRES_RECERTIFICATION.

# 87. Adapter semantic conformance

Each adapter feature mapping declares:
- NATIVE
- APPROXIMATED
- UNSUPPORTED
- UNKNOWN

Critical constraint mapping that is UNSUPPORTED/UNKNOWN cannot be silently compiled into a best-effort provider call.

Approximation is allowed only where policy permits and user/strategy quality constraints accept it.

# 88. Package/model byte ceiling and digest identity

Package/model acquisition requires:
- maximum expected/download bytes;
- disk reservation;
- exact digest pin;
- publisher/signature/trust policy;
- decompression/install expansion budget.

Version/name alone never identifies executable model/runtime bytes.

Resident workers revalidate package identity/revocation before accepting new jobs.

# 89. Browser observation privacy

Screenshots, DOM captures, accessibility trees and recordings are separate sensitive inputs.

Before sending browser observations to AI/evaluator:
- apply privacy/redaction policy;
- avoid credential/MFA/password fields;
- scope capture to minimum required region/content;
- do not persist raw observations beyond retention policy;
- record whether observation left the local machine.

Login/MFA/account-management pages default to stricter capture policy.



# 51. Task dependency DAG integrity

Hard scheduling dependencies form a DAG.

Planner/reconciler must reject or surface cycles before tasks become READY.
Manual Issue edits that introduce a cycle invalidate readiness until resolved.

Soft/reference dependencies may be cyclic only when their semantics explicitly permit it.

# 52. URL intake and browser network boundary

Universal URL intake and browser automation are network-security boundaries.

Required URL fetch policy:
- explicit allowed schemes;
- localhost, loopback, link-local, private RFC1918/RFC4193 and cloud-metadata ranges denied by default unless an explicit trusted feature permits them;
- resolve and validate every redirect target;
- validate connect-time resolved addresses to resist DNS rebinding;
- bound response bytes, redirects, duration and content type;
- credentials/cookies are not forwarded to unrelated origins;
- file/custom protocols are denied unless specifically allowlisted.

Browser navigation follows the same principle: website content cannot escape into `file:`, privileged custom schemes or unrestricted localhost services.

# 53. Content-addressed storage immutability

Canonical CAS bytes must be physically protected from writable aliasing.

Rules:
- no writable hardlink from CAS object to editable handoff/staging paths;
- reflink/clone is allowed only when the filesystem guarantees copy-on-write semantics and CineForge verifies the destination is not a mutable alias;
- otherwise copy bytes;
- canonical object modification detection quarantines the object and all dependent revisions until repaired/reconciled.

# 54. External callback authenticity

Inbox idempotency is not source authentication.

Provider callbacks/webhooks require provider-specific authentication before canonical inbox registration:
- HMAC/signature/token/mTLS/channel identity as supported;
- expected endpoint/account/provider identity;
- bounded timestamp/replay window where available;
- raw signed payload hash/evidence.

Unauthenticated callback input remains untrusted and cannot drive state transitions.

# 55. Autonomous dependency supply-chain policy

An agent adding/upgrading executable source dependencies changes the trust and legal surface.

Dependency changes require:
- pinned lockfile/provenance;
- expected registry/source;
- license classification;
- vulnerability/advisory checks where available;
- build/postinstall script review according to risk;
- SBOM update for releasable builds;
- elevated review for new native/binary/install-script dependencies.

Typosquatted or unexpected-registry packages are blocked, not “tested in production”.

# 56. Critical invariant test protection

Tests that enforce architecture/security/data-integrity invariants are governance assets.

A feature PR may update them only with explicit explanation and review.
CI/review flags:
- removed invariant test;
- reduced assertions/coverage for invariant paths;
- changed expected failure into success without corresponding architecture decision.

A PR cannot make itself green merely by deleting the guard that caught it.

# 57. Local user isolation

Default local deployment is user-scoped.

Core DB, credential references, runtime state, browser profiles, logs and IPC endpoints use OS-user scoped ACL/permissions.

Shared folders/multi-user execution are explicit deployment modes and require their own authority/locking model.

# 58. Stable ingest and external-source TOCTOU defense

For security/canonical ingest:
- open/copy source into private staging using a stable OS handle where practical;
- normalize/reject reparse escapes;
- hash the staged bytes;
- parse the staged immutable copy.

External-link mode may monitor a path, but any canonical/review decision binds a cryptographic content fingerprint, not only size/mtime/path.

# 59. Rebuildability is technical + rights + dependency availability

A DerivedRecipe is rebuildable only when:
- required source revisions remain available;
- required package/model/provider capability remains available or policy-approved alternative is proven equivalent enough for that class;
- required rights/license permit rebuilding;
- recipe/toolchain identity is resolvable.

GC/package removal/license revocation must reevaluate dependent rebuildability before deleting the last durable copy.

# 60. SQLite-consistent backup invariant

A live SQLite database is never backed up by naively copying only the main DB file while WAL may contain committed state.

Backup uses:
- SQLite Online Backup API; or
- a validated equivalent consistent snapshot/checkpoint method.

Backup manifest records the DB snapshot identity/event checkpoint and corresponding object manifest.

# 61. Canonical/event integrity auditor

Because CineForge V1 is event/audit-backed rather than pure event-sourced, a periodic integrity auditor verifies:
- aggregate row_version/event version monotonicity;
- expected command→event/outbox transaction relationships;
- revision_registry ↔ typed revision consistency;
- orphan/missing outbox/inbox evidence;
- storage-object/revision references;
- impossible state transitions.

Detected inconsistency enters SAFE_MODE/RECONCILIATION according to severity; it is not silently “fixed” by whichever table seems newer.

# 62. Worker crash-loop circuit breaker

Repeated crash/restart of worker/runtime/connector uses exponential backoff, restart budget and quarantine.

A poisoned runtime must not restart forever and consume the entire machine/queue.

# 63. Web account/workspace identity

A browser/API connection may pin:
- provider account identity;
- organization/tenant/workspace identity;
- region/data-residency metadata where relevant.

“Authenticated” does not mean “authenticated to the correct workspace”.

Before privileged production action, connector verifies required identity scope.

# 64. Bulk command snapshot scope

Bulk commands never mean “whatever currently matches this filter when execution happens”.

Planning materializes:
- exact entity/revision IDs; or
- an immutable query-result snapshot/hash.

Execution operates on that pinned scope.
New items arriving after confirmation are excluded unless the user explicitly replans.
