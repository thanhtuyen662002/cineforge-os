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
- 21 baseline cross-layer domains were checked for all four owners: Schema + State + API + UI.
- The baseline feature-matrix check reported zero uncovered owner gaps within those 21 domains.

The broader canonical red-team ledger has now received the same explicit
design-owner treatment: all 662 findings resolve to a unique owner section,
with 486 `DESIGN_COVERED` records, 173 `EMPIRICAL_TEST_REQUIRED` records and
3 explicit residuals.  There are zero `UNCOVERED` and zero
`OPEN_UNOWNED_PENDING_AUDIT` records.  This closes architectural ownership;
it does not promote any runtime evidence, and the required negative/chaos
tests, independent review and implementation evidence remain open.

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

# DESIGN-TECHNICAL-METADATA-NAMING. Canonical derived-media metadata owner

The canonical relational entity is `technical_metadata`, as defined in
`SCHEMA.md`. `asset_technical_metadata` is not a second table, compatibility
alias or runtime projection. Any future typed media-probe job must reference
an exact `asset_revision_id` and immutable `technical_metadata.id`, pin its
source content hash and toolchain/probe schema evidence, and preserve earlier
results as stale history when the source or toolchain changes. This section
resolves the former architecture-inventory naming ambiguity before executable
media probing is designed or implemented.

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
The first executable Slice 5 vertical is the metadata-first Issue #29
audio/subtitle timing baseline. It delivers:

- the canonical timeline dependency already established by the timeline slices;
- project-scoped `AudioCue` identities with immutable timing revisions pinned to
  one exact timeline revision ID and content hash;
- project/timeline-scoped `SubtitleTrack` identities with immutable, bounded
  rational timing segments pinned to that same exact timeline revision/hash;
- fail-closed materialization and rights checks for selected audio asset
  revisions, with `UNKNOWN` remaining blocked;
- dependency edges and derived `STALE` projections when the pinned timeline,
  selected asset, localization source or rights/materialization evidence
  changes; and
- Vietnamese-first metadata views with explicit next steps and no implied media
  work.

This vertical does not record, generate, mix, play, render, transcode, export,
publish or produce waveform/audio bytes. It does not add audio or caption
operations to the VIDEO-only timeline working session. Basic mix/stems,
generation/recording, playback and media delivery remain later Slice 5/6 work;
they must consume an exact approved timing revision rather than resolving
`latest`.

## Slice 6 — Handoff/Release/Storage
Deliver:
- generic/CapCut handoff;
- master export verification;
- ReleaseCandidate/Manifest;
- GC dry-run;
- backup/restore.

The current executable continuation after the metadata-only release candidate
is the `CreateReleaseBuildPlan` preflight. It freezes the exact input closure
for a future renderer and records a deterministic plan hash, but it does not
render, transcode, create a master, sign, publish or create a release
manifest. A real master requires a separate pinned local renderer/toolchain,
durability and QC contract before that boundary can be opened.

The next bounded implementation is `query.release.renderer.preflight`. It
checks an explicitly materialized local connector manifest and exact binary
digests without executing a process. The query is deliberately useful for the
desktop release surface: it distinguishes a missing/untrusted toolchain from
an approved plan while keeping rendering controls disabled. It must never
fall back to a machine `PATH`, auto-download `latest`, expose a private path,
or turn a successful preflight into release authority. Process execution,
staging, media probing, final-byte QC, durable activation and publication
remain separate contracts with their own schema and restart tests.

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



# 18. Control maturity and anti-overengineering

Implementation planning references `docs/design/CONTROL_REGISTRY.yaml`.

## Maturity
A control is:
- DESIGNED
- SPECIFIED
- IMPLEMENTED
- AUTOMATED_TESTED
- CHAOS_TESTED
- PRODUCTION_PROVEN

Documentation alone never advances a control beyond SPECIFIED.

## Applicability
Controls classify as:
- V1_FOUNDATION
- V1_BEFORE_RELEASE
- SCALE_HARDENING
- FUTURE_MULTIUSER
- OPTIONAL_HIGH_SECURITY

A coding task implements only controls applicable to its current slice/risk profile unless doing so would make later compatibility impossible.

## Anti-overengineering test
Before implementing a major abstraction/control:
1. Is it required by the current slice or current reachable P0/P1?
2. Is it necessary to keep a future boundary compatible?
3. Can it remain a specified interface/design reserve without code now?

If yes to deferral, do not code it yet.

The comprehensive schema/design is a compatibility map, not a big-bang backlog.

# 19. Governance/product WIP balance

Planner monitors WIP distribution among:
- vertical product delivery;
- control-plane/governance;
- reliability/hardening;
- testing/CI.

Unbounded hardening cannot starve the first real 3–5 minute film unless a currently reachable unresolved P0 prevents safe continuation.

The first real film remains a mandatory architecture validation milestone.


# DESIGN-MEDIA-PROBE-01. ProbeMediaAsset implementation contract

`ProbeMediaAsset` is the first executable technical-media capability. It is a
Core command with no direct UI/worker/connector database writes and no generic
shell or provider dispatch. The command accepts an exact project, asset
revision, content hash/byte size, rights decision generation, pinned toolchain
manifest identity, parser-policy version and an idempotency key. It never
accepts a filesystem path, URI, provider field, arbitrary argv or a `latest`
selector.

The command creates a durable probe job and immutable attempt. The job pins the
source revision/hash, exact toolchain/probe schema/parser versions and expected
row version. The attempt pins a fencing token and bounded resource reservations.
A retry is a new exact attempt for the same tuple; it cannot silently move to a
newer source revision or toolchain. Replaying an identical idempotency key
returns the same job/result, while reusing the key with a different canonical
payload returns `IDEMPOTENCY_KEY_REUSE_CONFLICT`.

The local connector is permitted only after the startup-bound renderer manifest
has verified an exact regular-file `ffprobe` identity. It runs with `shell=false`,
a fixed allowlisted argv, private staged input, sanitized environment/CWD, no
network, bounded stdout/stderr and process-tree termination on cancel/timeout.
The connector returns typed process evidence and never receives a database
handle. Missing, stale, reparse, hardlink, tampered or oversized toolchain
inputs produce `BLOCKED_TOOLCHAIN`/`UNKNOWN`, not a guessed fallback.

The parser reads only bounded UTF-8 ffprobe JSON. The allowlist is versioned;
duplicate/unknown keys, non-finite values, unsafe stream dispositions,
malformed rationals, zero denominators, BigInt overflow, dimensions outside
policy, excessive depth/nodes/strings/streams and contradictory duration/frame
facts are rejected. Raw stdout/stderr and private paths remain internal
evidence; public projections expose only typed fields, hashes, bounded codes and
a redacted `next_step`.

Binding is a single Core transaction after the source descriptor/hash, rights
generation, toolchain digest and expected row version are revalidated. It adds
an immutable `technical_metadata` row, append-only stream inventory and raw
evidence identity. It cannot update original assets, approved canon, timelines,
release candidates, masters or publication. Earlier probe results remain
auditable history and become `STALE` when any pinned identity changes.

The implementation must prove parser, process, cancellation, restart,
idempotency, stale-fencing, rights, project-isolation, redaction and packaging
negative paths with executable tests. Documentation maturity remains
`SPECIFIED` until the corresponding code, independent review and exact-head
evidence exist; prose alone never advances a control to `PRODUCTION_PROVEN`.


# DESIGN-MEDIA-PROBE-PARSER-01. Prepared bounded JSON profile

The proposed profile MEDIA_PROBE_PARSER_V1 is prepared for review, not a
certified descriptor or production promotion. It uses the hardening defaults
8 MiB stdout, depth 32, 50000 total nodes including object keys, 4096 UTF-8
bytes per decoded string, 256 streams and 1024 entries per array. Callers can
only tighten these limits. Numeric JSON tokens must be safe integer literals;
fractions and exponent forms are rejected. Decimal media durations and
rational rates arrive as strings and are converted with checked BigInt, never
floating point. Rational components and normalized API forms cannot exceed
Number.MAX_SAFE_INTEGER; duration is positive and at most 604800 seconds.
Proposed physical bounds are 32768 per dimension, 1000 frames/second,
384000 samples/second and 64 channels; expansion requires a new policy review.

The root allowlist is format and streams. Format permits format_name,
duration, size, nb_streams. Streams permit index, codec_type, codec_name,
time_base, duration_ts, duration, r_frame_rate, avg_frame_rate, nb_frames,
width, height, pix_fmt, sample_aspect_ratio, color_range, color_space,
color_transfer, color_primaries, sample_rate, channels, channel_layout,
sample_fmt and disposition. Disposition permits only the declared ffprobe
integer boolean flags. duration_ts permits a safe integer JSON token or an unsigned decimal string;
other temporal ratios/durations and nb_frames remain strings.
No filename, tags, arbitrary metadata or raw output
can enter the typed result. Tokens must belong to the fixed prepared profile enumerations for codecs,
container formats, pixel/sample formats, color fields and channel layouts.
Unrecognized identifiers remain UNKNOWN and cannot project attacker text.
Video codecs: h264, hevc, av1, vp8, vp9, mpeg4, mpeg2video, prores, dnxhd,
ffv1, rawvideo, mjpeg, png, jpeg2000. Audio codecs: aac, mp3, opus, vorbis,
flac, alac, pcm_s16le, pcm_s24le, pcm_s32le, pcm_f32le, pcm_f64le,
pcm_s16be, pcm_s24be, pcm_s32be, ac3, eac3, dts. Container tokens: mov, mp4,
m4a, 3gp, 3g2, mj2, matroska, webm, avi, wav, flac, mp3, ogg, mpegts,
mpeg, nut, image2, image2pipe, aac, ac3, eac3; combinations use commas.
Pixel formats: yuv420p, yuv422p, yuv444p, yuv420p10le, yuv422p10le,
yuv444p10le, yuv420p12le, yuv422p12le, yuv444p12le, yuva420p, yuva422p,
yuva444p, nv12, nv21, p010le, rgb24, bgr24, rgba, bgra, argb, abgr,
gbrp, gbrp10le, gbrp12le, gbrap, gray, gray16le, gray16be, pal8.
Sample formats: u8, u8p, s16, s16p, s32, s32p, s64, s64p, flt, fltp,
dbl, dblp. Channel layouts: mono, stereo, 2.1, 3.0, 3.0(back), quad,
quad(side), 4.0, 4.1, 5.0, 5.0(side), 5.1, 5.1(side), 6.1, 7.1,
7.1(wide), 7.1(wide-side), hexagonal, octagonal. Color range: unknown, tv, pc. Color space: unknown, rgb, bt709, fcc, bt470bg,
smpte170m, smpte240m, ycgco, bt2020nc, bt2020c, smpte2085,
chroma-derived-nc, chroma-derived-c, ictcp. Transfer: unknown, bt709,
gamma22, gamma28, smpte170m, smpte240m, linear, log, log_sqrt,
iec61966-2-4, bt1361e, iec61966-2-1, bt2020-10, bt2020-12, smpte2084,
smpte428, arib-std-b67. Primaries: unknown, bt709, bt470m, bt470bg,
smpte170m, smpte240m, film, bt2020, smpte428, smpte431, smpte432, ebu3213; absent
values stay null and the literal unknown stays unknown, never PASS.
Tokens are bounded ASCII identifiers; invalid
values produce fixed codes without echoing attacker content.

Audio/video are the only supported stream kinds in this prepared profile.
Video requires exact average and nominal rates and dimensions; audio requires
sample rate and channels. Every stream requires time_base and duration_ts.
Missing or unsupported facts produce UNKNOWN rather than inferred defaults.
Rates or aspect ratios with zero denominator, including 0/0 and N/A sentinels,
are rejected; no audio-specific sentinel exception is silently introduced.
The certified producer must emit exactly this allowlist or the reviewed
profile must change before it can be used with real ffprobe output.

Stream duration_ts multiplied by time_base is authoritative. A media clock
tick must not exceed one second in this prepared profile. Optional decimal
duration may differ by at most one stream tick plus 1 microsecond for printed
precision. Frame count with average rate may differ by at most one tick and
1 microsecond; this does not assert constant frame cadence.
Container duration cannot be shorter than a stream by more than one stream
tick plus 1 microsecond. Contradictory facts return CONFLICT, never best effort
success. Missing color or layout stays null; no format or rate default is
invented. Streams are ordered by index and duplicate indices are rejected.

A successful parse returns only typed facts and versions. Core must still
verify exact source/toolchain/rights/fence/process evidence before creating a
canonical measurement or PASS. There is no additive DB migration in this
parser-only preparation. Production descriptor, custody and independent
review remain outstanding; do not expose this module as a working UI action.


# DESIGN-MEDIA-PROBE-PERSISTENCE-01. Prepared migration and binding

The independent preparation now extends from the pure parser to schema 21;
this does not enable commands, process execution, HTTP or UI. New measurements
use the canonical table and exact derived proof fields. Historical unbound
measurements have null source/evidence pins, remain readable as UNKNOWN and
cannot satisfy the new binding guard. Do not fabricate a migration backfill.
Binding occurs inside the owning Core transaction: write validated PASS
while job/attempt VERIFYING, mark that attempt SUCCEEDED, append measurement
and streams, then complete the job. Cancellation, source/rights recheck and
expected row version must be resolved before entering this transaction.
A current-attempt pointer plus fencing token prevents a late old producer
from binding even when its source hash is unchanged. Process/resource and
rights validations are Core obligations beyond these SQL constraints.

# DESIGN-MEDIA-PROBE-ADMISSION-01. Prepared command and read model

ARCH-MEDIA-PROBE-ADMISSION-01, API-MEDIA-PROBE-ADMISSION-01,
STATE-MEDIA-PROBE-ADMISSION-01 and UI-MEDIA-PROBE-ADMISSION-01 define the next
prepared lane after persistence. This adds audited blocked admission and
cancellation, exact project/revision projections and an on-demand Library
panel. The owning ASSET row_version fences admission; JOB row_version fences
cancellation. SOURCE_USE rights/consent are checked for MEDIA_INSPECTION and
rechecked when reading effective state. The producer is still unavailable:
no attempt/process/PASS/measurement is created. Requested manifest hashes are
never presented as verified execution identity. These additions do not relax
the separately required process and binding gates or close Task #64.

# DESIGN-MEDIA-PROBE-BINARY-PINS-01. Measurement and evidence identity

ARCH-MEDIA-PROBE-BINARY-PINS-01 and SCHEMA-MEDIA-PROBE-V22-01 correct the
schema-21 implementation's missing binary pins before a producer can bind
canonical metadata. The owning Core must supply the exact reverified binary
hash in both new evidence and measurements. Missing or mismatched pins prevent
PASS binding/completion. Legacy null pins remain UNKNOWN with no fabricated
backfill. Process containment, rights rechecks and descriptor verification are
still required independently; matching hashes alone authorize no execution.

# DESIGN-MEDIA-PROBE-NATIVE-01. Prepared native observations

NativeMediaProbe receives exact source hash/size, executable hash, private
attempt root and bounded budgets through an internal typed call. The argv is
one fixed ffprobe preset. Neither shell text nor arbitrary options are accepted.
AppContainer has no capability grants; the attempt SID receives read/execute
access to private input/binary copies. Environment is explicitly rebuilt.
Job Object limits include memory, active processes and kill-on-close; timeout,
cancel and output overflow terminate the job and verify active-process count.
Unconfirmed teardown produces UNKNOWN and preserves the attempt namespace.
Even a clean zero exit returns process evidence, not metadata PASS or rights.
Core admission remains blocked until a reviewed broker and certified-pack
contract bind this component to durable attempts and source/rights rechecks.

The broker supplies a lowercase 32-hex attempt ID already journaled by Core.
The AppContainer moniker is derived from that explicit identity; a pre-existing
profile is rejected. Before resuming, native token queries independently verify
AppContainer state, zero capability groups and the exact expected package SID.
Unreleased profile/root identities are returned privately for reconciliation.
Attempt staging has lifecycle class MEDIA_PROBE_ATTEMPT_TEMP and a proposed
24-hour TTL after terminal reconciliation; TTL never authorizes deletion while
process/resource ownership is uncertain. Native preparation retains its files;
the future Core retention/reference graph must own cleanup.

Effective Job Object limits are read back before process creation. Cancellation
is checked before preparation, spawn and resume. A private start callback carries
the observed PID after resume for trusted broker progress/cancel coordination;
it conveys no metadata, authority, persisted state or PASS verdict.
