# CineForge OS — Detailed Design Red-Team Review

> Purpose: attack the detailed schema/state/API/UI design from multiple real roles before declaring implementation readiness.
> Method: each role is asked “what can the user do that breaks assumptions, causes ambiguity, loses work, hides cost, corrupts continuity, or creates a support nightmare?”

# Pass 1 — User who knows nothing

Questions:
- If I drag a random folder with 20,000 files, what happens?
- If a 100 GB video takes minutes to ingest, do I know the app is alive?
- If I close the window, do renders continue?
- If I click twice because nothing appears to happen, do I create duplicate work?
- If internet dies, can I keep working locally?
- If CineForge asks for “MCP/API/codec”, have we failed the UX?
- If I delete a project, do I know what remains on cloud providers?

Required controls:
- immediate AsyncAction feedback;
- import pre-scan/estimate and cancellable session;
- idempotent commands;
- explicit UI-close/Core behavior;
- offline/degraded mode;
- technology vocabulary hidden by default;
- external side-effect disclosure.

New gap found:
- no explicit support/diagnostic workflow when user still cannot understand a problem.
Resolution:
- add Diagnostics/Support Bundle with redaction, project/context IDs, health snapshot and recent relevant events, never credentials/raw unreleased media by default.

# Pass 2 — Director / filmmaker

Questions:
- Can I branch a creative direction without destroying approved work?
- Can I lock face/voice but still change costume?
- Can I intentionally violate continuity for a dream/flashback?
- Can I mark a defect as an intentional creative exception?
- Can one scene deliberately use a different visual grammar?
- Can I compare two strategies blind?

Required controls:
- branch/variant model;
- independent lock dimensions;
- continuity waiver with reason/scope;
- review exception/waiver;
- style inheritance with explicit override;
- blind A/B review.

New gap found:
- no first-class “creative exception” entity separate from generic staleness waiver.
Resolution:
- add CreativeException/PolicyWaiver with scope, reason, authority and expiry.

# Pass 3 — Producer / project manager

Questions:
- What is actually blocking delivery?
- What is the critical path?
- Can I assign deadlines/priority/owners?
- Can I see WIP explosion?
- Can I cap spend by project/scene/department?
- What if a hero shot is starved behind 500 draft jobs?

New gap found:
- architecture had jobs and dependencies but no first-class production planning/schedule domain.
Resolution:
- add ProductionTask, Milestone, TaskDependency, assignment, deadline, priority, WIP limits and critical-path projection.
- scheduler consumes production priority but does not let manual urgency bypass rights/security.

# Pass 4 — Editor

Questions:
- Where is source timecode/reel name?
- Can I relink offline media?
- Can proxies and originals conform?
- What happens with VFR footage?
- Can I preserve handles when exporting to NLE?
- Can a timeline open if a plugin/model is missing?
- Can I inspect a historical edit without rerunning old AI?

New gaps:
- technical metadata lacks source timecode/reel/drop-frame semantics.
- handoff needs handles/conform identifiers.
- archived projects require viewability independent from execution dependencies.

Resolution:
- extend technical media metadata;
- stable media UUID/reel/conform map;
- HandoffManifest includes handles/timebase/conform map;
- read-only compatibility mode.

# Pass 5 — Dialogue editor / sound designer

Questions:
- Multiple characters interrupt each other; where is conversation context?
- Where is room tone?
- How do ADR and original dialogue coexist?
- Can a nonverbal gasp belong to a character?
- How are stems and buses represented?
- How does acoustic perspective remain consistent?

New gap:
- DialogueLine/Take is not enough for scene audio.

Resolution:
- add Conversation/PerformanceSession, AudioCue, RoomToneProfile, MixBus, StemAssignment, ADR linkage and acoustic-space profile.

# Pass 6 — Composer / music supervisor

Questions:
- How do motifs recur and evolve?
- How do I preserve a theme while generating new cues?
- What happens when edit duration changes?
- Can licensed music and generated score coexist?
- Can silence be an intentional cue?

New gap:
- music continuity existed only as risk/policy, not structured domain.

Resolution:
- add MusicTheme, MusicCue, CueRevision, SpottingEvent and silence as a valid cue strategy.
- timing dependency links cue to timeline revision/range.

# Pass 7 — VFX / compositing / 3D artist

Questions:
- Where are masks/depth/alpha passes grouped?
- Can a shot contain a layered composition rather than one flat clip?
- Can I replace one layer without invalidating unrelated layers?
- How do 3D camera/units/coordinate systems stay explicit?

New gap:
- generic assets/dependencies are insufficient for editable layered VFX.

Resolution:
- add Composition, CompositionRevision, CompositionLayer and RenderPassBinding.
- record coordinate system/unit/camera metadata for 3D-derived artifacts.

# Pass 8 — Localization / dubbing

Questions:
- Can Vietnamese original have English subtitle and English dub with different timing?
- How do pronunciation and character voice identity survive language change?
- Can subtitle and dub diverge intentionally?
- What if a font lacks Vietnamese characters?
- Where are accessibility captions/audio description?

New gap:
- captions have language but localization is not a first-class package.

Resolution:
- add LocalizationPackage, TranslationUnit, SubtitleTrackRevision, DubbingTrack, AccessibilityTrack.
- preserve original source; localized variants are derived and independently approved.

# Pass 9 — Connector author

Questions:
- How do I add a capability without editing Core?
- How are connector schema upgrades handled?
- Can a connector declare that it is stateful/single-session?
- What if cost/quota is unknown?
- Can a connector emit partial outputs?

Required:
- versioned manifest;
- extension namespaces;
- execution model;
- capability schema;
- partial-result contract;
- unknown cost state;
- certification tests.

New gap:
- package installation/version dependency domain is underspecified.
Resolution:
- add Package/Installation/Dependency/Pin records and provisioning state machine.

# Pass 10 — Backend/database engineer

Questions:
- Polymorphic dependencies use entity_type/entity_id; how do we enforce target existence?
- How do projections know their event checkpoint?
- Can events be replayed after schema evolution?
- How do we avoid “draft every keystroke becomes canonical revision”?

New gaps:
- need global entity/revision registries for referential integrity.
- need projection checkpoints.
- need explicit draft vs immutable revision pattern.

Resolution:
- add EntityRegistry + RevisionRegistry.
- typed domain tables extend those registries.
- add ProjectionCheckpoint.
- working copies/edit ops are mutable WIP; checkpoints create immutable revisions.

# Pass 11 — Distributed systems engineer

Questions:
- What if DB commit succeeds but worker dispatch fails?
- What if callback comes twice?
- What if callback arrives after cancel/revocation?
- What if worker dies while holding lease?
- What if the UI reconnects after missing events?

Covered:
- transactional outbox/inbox;
- idempotency;
- fencing;
- resumable event cursor.

New gap:
- worker/resource inventory absent.
Resolution:
- add Worker, WorkerCapability, ResourceInventory, ResourceSample and worker lifecycle.

# Pass 12 — Storage/recovery engineer

Questions:
- What if object bytes are written but DB registration fails?
- What if disk fills during copy?
- What if a symlink/junction escapes staging?
- How do we know a cache is truly rebuildable?
- What happens to WAL during backup?
- How do we reopen project if a historical runtime disappeared?

New gaps:
- explicit storage roots/volumes and staging transactions.
- rebuild recipe proof.
- Windows reparse-point policy.

Resolution:
- add StorageRoot/Volume, StagingObject, DerivedRecipe.
- import sandbox does not follow reparse points by default.
- backup checkpoint includes DB event seq + object manifest.

# Pass 13 — Security engineer

Questions:
- Can a malicious filename become a shell argument?
- Can a generated image containing instructions influence an agent?
- Can a custom MCP tool silently add new permissions?
- Can crash reports leak prompts/assets?
- Can a local plugin replace a signed binary?

Covered conceptually.

New gaps:
- connector/package signature and certification evidence should be first-class.
- support bundles require redaction policy.

Resolution:
- PackageSignature/CertificationRecord.
- DiagnosticBundle manifest with explicit included/excluded sensitive classes.

# Pass 14 — Rights/legal/release

Questions:
- Provider terms changed after generation but before release—what snapshot applies?
- Can identical bytes be legal in one project and illegal in another?
- User removes local asset—does cloud provider still retain it?
- Does a voice consent allow cloning, training and commercial release separately?

Covered in rights separation.

New gap:
- provider terms snapshot must bind to connector execution/release, not just source asset license.

Resolution:
- add ProviderTermsSnapshot and execution binding.

# Pass 15 — QA / chaos engineer

Questions:
- Can any state transition be replayed?
- What if migration stops halfway?
- What if UI submits approval while dependency changes?
- What if cleanup dry-run becomes stale before execute?
- What if a published platform transcodes output incorrectly?
- What if monitoring stops reporting?

Required:
- migration journal + safe mode;
- stale review guard;
- GC generation token;
- publication verification;
- monitor heartbeat.

New gap:
- diagnostic health is not binary; monitor itself requires last heartbeat and freshness threshold.

# Pass 16 — Support / operator

Questions:
- When user says “nó đứng rồi”, can support determine whether Core, worker, browser, provider or UI is waiting?
- Can they export enough evidence without exposing secret media?
- Can user reset only a broken connector instead of reinstalling entire app?

Resolution:
- HealthGraph projection;
- redacted diagnostic bundle;
- connector/runtime repair/reinstall isolated by package.

# Pass 17 — Accessibility user

Questions:
- Can everything important be done without color?
- Can timeline/review still be navigated with keyboard?
- Does 150–200% scaling break inspector?
- Are native notifications enough for action-required items?

Resolution:
- accessibility requirements already present; add UI test thresholds up to 200% and persistent Needs You independent from native notifications.

# Pass 18 — User switching between beginner and expert behavior

Questions:
- If I configure advanced provider preference, will Auto mode overwrite it?
- Can a setting be global but overridden per project/scene/shot?
- Can I see where an inherited rule came from?
- Can I reset override back to parent?

New gap:
- automation/control preference hierarchy requires first-class policy inheritance.

Resolution:
- add Policy/PolicyRevision/PolicyBinding with Studio→Project→Sequence→Scene→Shot→Task precedence and explainable effective-policy query.

# Pass 19 — Multi-user future

Questions:
- Two editors open same timeline?
- Director approves while producer changes canon?
- Offline user returns with stale edits?
- Who can waive rights/continuity?

Covered partially by actor_id/optimistic concurrency.

Resolution:
- edit lease for exclusive workspaces where merge is unsafe;
- stale working session branch instead of forced overwrite;
- authority requirements on waiver/approval commands.

# Pass 20 — Long-term archive

Questions:
- In 8 years, can project be inspected without old model binaries?
- What if connector vendor no longer exists?
- Can we understand why a creative choice was made?
- Are project file formats documented/versioned?

Resolution:
- archive readable without execution;
- manifest snapshots contain connector/tool descriptors;
- decision rationale is durable;
- open/documented interchange outputs retained.

# Saturation pass — Cross-role interaction failures

The following interactions were tested conceptually:

1. Canon change while review is open.
   - Review dependency hash rejects stale approval.
2. Voice change after dub and lip-sync are approved.
   - typed dependency edges mark only affected dialogue/lip-sync/review stale.
3. Timeline retime while music generation is running.
   - running job remains tied to old timeline revision; result cannot auto-canonicalize for new revision.
4. Rights revocation while export is building.
   - release gate invalidates; completed bytes remain non-releasable.
5. User disables Flow while browser job is active.
   - connection DRAINING; active session completes/reconciles unless explicit cancel.
6. User deletes project while cloud job is still running.
   - local project enters Trash; external attempt reconciliation continues; late output cannot resurrect project.
7. Disk fills while generating.
   - staging write fails; no registered READY artifact; scheduler blocks new large jobs.
8. Core crashes after DB commit before worker dispatch.
   - outbox redispatches idempotently after restart.
9. Worker writes output then crashes before DB registration.
   - staging reconciliation hashes/verifies and either registers via job evidence or quarantines orphan.
10. Browser download name collides with another job.
   - association uses interaction trace/hash, never filename alone.
11. Update installs while archive project is open.
   - read operation independent; pinned production dependencies remain unchanged.
12. User asks assistant to “đổi hết cho đẹp hơn”.
   - interpreted as proposed bulk command; impact/ambiguity prevents direct mutation.
13. User runs storage cleanup while an export references rebuildable proxy.
   - active job/lease protects object despite nominal cache class.
14. User changes UI language to English.
   - creative Vietnamese source, subtitles and prompts do not mutate.
15. External NLE returns flattened master.
   - ExternalEdit lineage = FLATTENED; CineForge does not fabricate internal edit structure.
16. Evaluator update makes pass rate jump.
   - versioned metrics + shadow/golden comparison prevent silent production promotion.
17. Provider becomes dominant due short-term benchmark.
   - concentration/diversity monitor flags systemic convergence.
18. Backup exists but restore parser changed.
   - restore drill and migration compatibility gate reveal path rot.
19. Multiple characters share similar voice.
   - voice identity QC + explicit speaker binding; diarization is evidence only.
20. Intentional continuity break is flagged by QC.
   - scoped CreativeException prevents endless auto-repair but remains visible in audit.

# Remaining irreducible risks

No architecture can eliminate:
- human creative judgment error;
- unknown future provider behavior;
- unknown future legal change;
- hardware failure beyond retained copies/backups;
- AI out-of-domain blind spots;
- exact cloud reproducibility;
- long-term ecosystem obsolescence;
- unknown unknowns.

The design goal is containment, traceability, recovery and explicit uncertainty.

# Review conclusion

After role passes and cross-role interaction tests, new findings now mostly reduce to already-owned mechanisms:
- typed command/impact analysis;
- immutable revision + dependency invalidation;
- independent state axes;
- capability/connector contract;
- evidence/abstention;
- policy/rights;
- resource/cost scheduling;
- storage staging/GC/recovery;
- DecisionRequest/human authority.

This is conceptual saturation for the detailed-design phase. Remaining validation must come from a real vertical slice, fuzz/chaos tests and an actual short-film production.
