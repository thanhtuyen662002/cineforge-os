# CineForge OS — Final Detailed Design Baseline v1

> **Status:** AUTHORITATIVE DETAILED IMPLEMENTATION BASELINE  
> **Parent architecture:** `docs/architecture/FINAL_ARCHITECTURE.md`  
> **Risk source:** `docs/FOUNDATIONAL_RISK_REGISTER.md`  
> **Red-team source:** `docs/design/DETAILED_DESIGN_RED_TEAM.md`

# 1. Final design package

Coding agents must treat the following as one coherent contract:

1. `docs/architecture/FINAL_ARCHITECTURE.md`
2. `docs/design/SCHEMA.md`
3. `docs/design/STATE_MACHINES.md`
4. `docs/design/API_CONTRACTS.md`
5. `docs/design/UI_COMPONENT_SYSTEM.md`
6. `docs/architecture/CHARACTER_IDENTITY_SYSTEM.md`
7. `docs/architecture/USER_ACTION_AND_COVERAGE_GAP_ANALYSIS.md`
8. `docs/design/DETAILED_DESIGN_RED_TEAM.md`
9. `docs/architecture/RISK_COVERAGE_MATRIX.md`
10. `docs/FOUNDATIONAL_RISK_REGISTER.md`

Precedence:
- FINAL_ARCHITECTURE defines system boundaries/invariants.
- FINAL_DETAILED_DESIGN + SCHEMA/STATE/API/UI define implementation contracts.
- Risk/red-team documents remain adversarial requirements.
- If documents conflict, do not silently choose. Create an architecture decision and update the affected documents together.

# 2. Review depth reached

Before this baseline was declared:
- 17 root risk classes R01–R17 were mapped to architecture controls.
- 40 user-action groups were reviewed.
- 20 role-based red-team passes were performed.
- 20 cross-role interaction failure scenarios were tested conceptually.
- 21 cross-layer domains were checked for all four owners: Schema + State + API + UI.
- Final cross-layer check reported zero uncovered owner gaps.

This does not claim unknown unknowns are eliminated. It means newly found conceptual issues now reduce to existing ownership/control mechanisms rather than exposing a missing architectural category.

# 3. Core ownership model

Every feature must have owners in these dimensions:

```text
USER INTENT
   ↓
COMMAND / IMPACT
   ↓
DOMAIN ENTITY / REVISION
   ↓
STATE MACHINE
   ↓
DEPENDENCY / POLICY / RIGHTS
   ↓
JOB / RESOURCE / CONNECTION
   ↓
ASSET / STORAGE
   ↓
EVIDENCE / REVIEW
   ↓
DELIVERABLE / RELEASE
```

UI never bypasses this path for canonical mutation.

# 4. User action coverage matrix

| ID | User action | Canonical owner | Critical safeguards | UI owner |
|---|---|---|---|---|
| A01 | Create/duplicate project | Project + MediaProfile + Command | copy-on-write assets, explicit defaults | Project Creation |
| A02 | Import text/PDF/DOCX/Excel | ImportSession + Script/Story | preview/diff, AI output candidate only | Universal Intake |
| A03 | Import image/video/audio/folder | ImportSession + Asset | copy/link/mirror, hash/decode/security | Universal Intake |
| A04 | Record voice | Recording/Audio + Rights | role of recording, consent, quality | Voice Recorder |
| A05 | Create/lock character | Character/Revision/Lock | immutable approved canon | Canon |
| A06 | Change character after production | Command + DependencyGraph | impact preview, scoped invalidate | ChangeImpactPanel |
| A07 | Add/change voice | VoiceIdentity + Binding | provider-independent identity | Voice Casting |
| A08 | Multi-character dialogue | Conversation + Dialogue + AudioCue | context, overlap, speaker binding | Audio/Dialogue |
| A09 | Change costume/prop | StateInterval + Command | explicit story scope | Canon/Continuity |
| A10 | Generate media | GenerationSession + Job | candidate/cost budget, pinned inputs | Production |
| A11 | Cancel generation | Job state | cancel unknown/late completion | Activity/Job |
| A12 | Retry failure | JobAttempt | retry-kind explicit, idempotency | Recovery |
| A13 | Approve | Review + Revision | exact representation/dependency hash | Review |
| A14 | Reject/repair | Review + RepairSession | scoped repair, convergence guard | Review |
| A15 | Edit timeline | TimelineWorkingSession | typed ops, immutable checkpoint | Timeline |
| A16 | Edit after sync/music/subtitle | DependencyGraph | targeted timing invalidation | Timeline impact |
| A17 | Undo/redo | Command/EditOp ledger | no fake reversal of external effects | Undo/History |
| A18 | Autosave | WorkingCopy | never equals approval | SaveState |
| A19 | Branch creative direction | Branch/Revision | no canonical overwrite | Variant compare |
| A20 | Change provider preference | PolicyBinding | inheritance, future-only behavior | Strategy/Control |
| A21 | Add connection | Connection/ConnectorVersion | UNVERIFIED→TESTING→READY | Connections |
| A22 | Disable/remove connection | Connection lifecycle | drain, impact pinned production | Connections |
| A23 | Use browser/web tool | BrowserInteractionSession | session/trace/human takeover | Activity/Connections |
| A24 | Use MCP | MCP Broker | schema fingerprint + least privilege | Connections Advanced |
| A25 | Use CLI | CLI Manifest/Runner | typed argv, sandbox | Connections Advanced |
| A26 | Natural-language “do this” | Assistant→Command Plan | no direct DB mutation | Assistant/Impact |
| A27 | Drag/drop in context | Import + SemanticBinding | visible role binding/undo | Drop Target |
| A28 | External edit | HandoffManifest + ExternalEdit | lineage confidence | Handoff |
| A29 | Export master | ExportSession | validate bytes/media, manifest | Export |
| A30 | Publish | Publication | separate irreversible boundary | Release |
| A31 | Delete asset/project | Trash + DependencyGraph | logical vs physical delete | Trash/Impact |
| A32 | Clean storage | GC Run | graph/lease/retention proof | Storage |
| A33 | Move library | StorageRoot migration | copy/hash/switch/rollback | Storage |
| A34 | Backup/restore | Backup state | consistent checkpoint, verify | Backup |
| A35 | Update CineForge | Package/Update | signatures, safe boundary, pins | Update |
| A36 | Change FPS/color/audio profile | ProjectMediaProfile | migration/impact analysis | Project Settings |
| A37 | Multi-user future | Actor/Authority/Version | optimistic concurrency/lease | Collaboration-ready |
| A38 | Search/Command Palette | Projection/Search | exact vs semantic distinction | Ctrl+K |
| A39 | Notifications/Needs You | DecisionRequest | source of truth independent of toast | Needs You |
| A40 | Close app/shutdown | App/Core lifecycle | jobs/reconciliation/recovery | Exit/Activity |

# 5. Additional detailed domains discovered by red-team

The following are mandatory, not optional “future polish”:

## Production planning
- ProductionTask
- TaskDependency
- Milestone
- WIP policy
- critical-path/bottleneck projection

Reason: jobs alone cannot answer producer questions or prevent starvation/WIP explosion.

## Audio scene context
- ConversationSession
- PerformanceContext
- AudioCue
- ADR link
- RoomTone/AcousticSpace
- MixBus/Stem

Reason: per-line TTS is insufficient for cinematic dialogue/audio continuity.

## Music continuity
- MusicTheme
- MusicCue
- SpottingEvent
- intentional silence

Reason: independent “good songs” do not form a film score.

## Localization/accessibility
- LocalizationPackage
- TranslationUnit
- SubtitleTrack
- DubbingTrack
- AccessibilityTrack

Reason: original, subtitle and dub are distinct approved derivatives.

## VFX/compositing
- Composition
- Layer
- RenderPass
- explicit coordinate/unit/camera metadata

Reason: editable layers cannot be represented by a flat video asset alone.

## Provisioning/packages
- Package
- Dependency
- Installation
- Signature
- Certification
- Pin

Reason: one-click install/update and reproducibility require package lifecycle as first-class data.

## Policy inheritance
- Studio→Project→Sequence→Scene→Shot→Task
- Auto/Guided/Advanced/Expert as effective policy

Reason: user customization must be explainable and reversible to parent defaults.

## Diagnostics/support
- HealthGraph
- DiagnosticBundle with redaction

Reason: “tool bị đứng” must be diagnosable without exposing credentials/private media.

# 6. Independent state axes rule

Do not build giant combined states.

Examples:

Asset:
- availability
- review
- rights
- staleness
- lifecycle

Connection:
- lifecycle
- auth
- availability
- capacity
- policy

Project/shot user status is a projection of underlying axes.

This rule prevents state explosion and false simplification.

# 7. Canonical revision rule

The system differentiates:
- mutable working copy;
- immutable checkpoint/candidate revision;
- immutable approved revision.

Autosave updates working state only.
Approval always binds an immutable revision.

This applies to:
- script;
- Film Bible;
- character identity;
- voice identity;
- style;
- project media profile;
- timeline;
- composition;
- policy.

# 8. Physical data rule

Canonical truth is not equivalent to a file path.

```text
Entity identity
→ Revision identity
→ Storage object hash
→ One or more locations
```

A file can move without changing creative identity.
Identical bytes can retain different rights identities.
An external path can disappear without deleting project history.

# 9. Execution rule

No external tool receives more context/permission than required.

All execution passes:
- policy;
- rights/privacy;
- budget/resource reservation;
- typed connector;
- staging;
- verification/normalization;
- registration.

External provider output never writes canonical state directly.

# 10. User-visible asynchronous rule

Every operation longer than an immediate UI interaction provides:
- immediate acknowledgement;
- real current milestone;
- whether user can leave;
- whether user action is needed;
- cancel semantics;
- partial output when available;
- clear stalled/waiting distinction.

No fabricated percent complete.

# 11. Approval rule

Approval stores:
- exact subject revision;
- exact representation reviewed;
- dependency snapshot hash;
- reviewer/authority;
- policy/evaluator context;
- timestamp.

If dependencies change before submit, approval fails stale rather than blessing old content.

# 12. Release rule

Export != Release != Publish.

Export:
- builds a deliverable.

Release:
- freezes a verified immutable release manifest.

Publish:
- performs external, potentially irreversible distribution.

Each has a separate state machine and authority gate.

# 13. Learning rule

CineForge can learn but cannot “learn itself into production” directly.

Required path:
Memory → Measurement → Benchmark → Golden validation → Shadow → Human/Policy gate → Promotion → Rollback capability.

Systemic monitors guard:
- provider concentration;
- evaluator correlation;
- style convergence;
- retry/repair oscillation;
- fallback oscillation;
- workload mix shift;
- starvation.

# 14. Implementation slices

## Slice 0 — Contracts
Deliver:
- ID/revision/event/command libraries;
- schema migrations;
- error envelope;
- Core API skeleton;
- UI design tokens/status primitives;
- state-machine test harness.

## Slice 1 — Project/Input/Asset
Deliver:
- create project;
- ProjectMediaProfile;
- Universal Intake;
- immutable object store;
- basic Library;
- storage summary;
- command/event/audit.

## Slice 2 — Story/Canon
Deliver:
- script ingest;
- scene/shot;
- character visual/voice;
- costume/prop;
- continuity snapshot;
- DecisionRequest.

## Slice 3 — Capability/Jobs
Deliver:
- connector SDK/host;
- one local/CLI connector;
- one API connector;
- one browser-assisted connector;
- job/cancel/retry;
- resource/cost ledger.

## Slice 4 — Production/Review
Deliver:
- generation candidates;
- basic evidence;
- exact review/approval;
- repair request;
- impact/staleness.

## Slice 5 — Timeline/Audio
Deliver:
- canonical timeline;
- dialogue/audio cues;
- basic mix/stems;
- subtitle track;
- timing invalidation.

## Slice 6 — Handoff/Release/Storage
Deliver:
- generic/CapCut handoff;
- master export verification;
- ReleaseCandidate/Manifest;
- GC dry-run;
- backup/restore.

## Slice 7 — First real film
Produce a 3–5 minute film with:
- at least two speaking characters;
- multiple scenes/locations;
- voice identity;
- music + ambience + SFX/Foley;
- subtitles;
- external handoff;
- final release candidate.

Only real failures from this slice should justify broad architecture expansion.

# 15. Definition of implementation-ready for a feature

A feature is not ready to code until all are known:
1. logical entity/identity;
2. mutable vs immutable revision boundary;
3. state axes/transitions;
4. command(s);
5. query/read projection;
6. dependency edges;
7. rights/privacy behavior;
8. cost/resource behavior;
9. cancel/retry/undo semantics;
10. user-visible waiting/error behavior;
11. storage/cleanup behavior;
12. event/audit behavior;
13. migration/versioning behavior;
14. tests including failure path.

# 16. Definition of done for a vertical feature

Done requires:
- schema migration;
- Core domain logic;
- state-machine tests;
- command/query API;
- UI normal state;
- empty state;
- loading/slow state;
- partial/recoverable failure;
- blocking failure;
- stale/conflict case;
- dark/light;
- vi-VN/en-US;
- accessibility pass;
- audit/provenance;
- crash/restart reconciliation if async;
- relevant risk-regression test.

# 17. Final design conclusion

The detailed design is considered conceptually saturated for implementation start.

Further design changes should now be driven by:
- prototype evidence;
- real film production failures;
- fuzz/chaos/recovery tests;
- connector/provider behavior observed in practice.

New speculative complexity should not be added unless it maps to an observed failure or a documented risk that current controls cannot contain.
