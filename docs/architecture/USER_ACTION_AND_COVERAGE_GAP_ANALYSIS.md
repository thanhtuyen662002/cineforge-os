# CineForge OS — User Action & Architecture Coverage Gap Analysis

> Mục tiêu: đối chiếu FOUNDATIONAL_RISK_REGISTER với FOUNDATION + CHARACTER_IDENTITY_SYSTEM theo góc nhìn hành động người dùng.
> Kết luận: nền kiến trúc đúng hướng nhưng chưa đủ để implementation. Các gap dưới đây phải được giải quyết trước hoặc trong foundation vertical slice.

## 1. Nguyên tắc kiểm tra

Mỗi hành động người dùng phải được xem như một transaction có:
- Intent: người dùng muốn đạt gì.
- Preconditions: cần điều gì đúng trước khi chạy.
- Scope: project/scene/shot/asset/global.
- Inputs: file/text/voice/reference/state.
- State changes: entity/revision nào thay đổi.
- Dependencies: thứ gì trở nên stale.
- Cost: tiền/credit/GPU/storage/time.
- Rights/privacy: dữ liệu nào được gửi ra ngoài.
- Progress: người dùng thấy gì khi chờ.
- Cancel semantics: hủy có thực sự hủy được không.
- Undo semantics: có hoàn tác được không.
- External side effects: API charge/upload/publish/email/web action.
- Output: artifact nào được tạo.
- Audit: quyết định và phiên bản nào được lưu.
- Failure ownership: CineForge tự xử lý hay cần user.

Không có action contract => UI có thể trông đúng nhưng state phía dưới dễ sai.

---

# 2. Coverage summary

## Đã có nền tốt

Đã được xác định tương đối rõ:
- Local-first + multi-transport Capability Fabric.
- Project truth thuộc CineForge Kernel.
- Universal Intake ở mức khái niệm.
- Output/deliverables/handoff ở mức khái niệm.
- Storage lifecycle classes.
- Character/voice/costume/prop/state separation.
- Approved revisions immutable.
- Exact revision pinning.
- Rights/provenance separation.
- Long-running human-readable status.
- Installer/update/provider decoupling.
- Vietnamese default + English locale.
- Connection types: local/CLI/MCP/API/browser/human.

## Mới chỉ có khung, chưa đủ code an toàn

- User action transaction model.
- Canon change impact workflow.
- Canonical editing/timeline domain.
- Script/story breakdown pipeline.
- Multi-user collaboration/concurrency.
- Autosave/undo/redo/checkpoints.
- Cancellation semantics.
- Cost/credit reservation and reconciliation.
- Browser/web manual handoff lifecycle.
- Re-import from external editors.
- Project-level media technical policy.
- Background task prioritization.
- Storage garbage collection safety algorithm.
- Backup/restore UX + consistent snapshots.
- Release/publish workflow.
- Migration/recovery UX.
- Connection onboarding/removal/revocation.
- Failure ownership and escalation.
- Search/navigation semantics.
- Accessibility/localization validation.
- Plugin/connector certification UX.

## Thiếu rõ ràng, cần thiết kế thêm

- Canonical Timeline/Edit Graph.
- Story Graph / Script Breakdown domain.
- Production Plan / Shot Dependency Graph.
- Human Decision Inbox / Needs You queue.
- Action Ledger / command history.
- Cost Ledger + quota reservation.
- Technical Media Profile / Project Media Contract.
- External Edit Round-trip model.
- Data portability/export full project.
- Trash/retention/GC state machine.
- Collaboration locks/merge/conflict model.
- Credential/account switching model.
- Browser session/profile ownership and failure recovery.
- Model/provider terms drift monitoring.
- Release readiness and publication gate.
- Accessibility/localization deliverable subsystem.
- Crash recovery after power loss at every long operation.
- Workspace/import dedup handling.
- User-configurable automation policy hierarchy.
- Template/preset versioning.

---

# 3. User actions that expose current gaps

## A01 — Create Project

User actions:
- tạo project trống;
- bắt đầu từ ý tưởng;
- bắt đầu từ script;
- bắt đầu từ video có sẵn;
- clone/duplicate project;
- tạo từ template.

Gaps:
- chưa có Project Creation Contract;
- chưa định nghĩa technical defaults: FPS, resolution, color pipeline, sample rate, language, aspect ratio;
- chưa có rule khi đổi các giá trị này sau khi production bắt đầu;
- duplicate chưa định nghĩa shared immutable asset vs copy-on-write.

Need:
- ProjectProfile revision;
- MediaProfile lock;
- Template revision;
- copy-on-write duplicate;
- project-level privacy/rights/budget policy.

## A02 — Import text/script/PDF/DOCX/Excel

Gaps:
- Universal Intake nhận được nhưng chưa có semantic import state machine.
- Chưa định nghĩa “preview before commit”.
- Chưa xử lý import trùng, import lại bản mới, mapping cột, diff giữa revisions.
- Chưa có Script Breakdown domain.

Need:
- ImportSession;
- ImportCandidate;
- SemanticMapping;
- Preview/Diff/Commit;
- DocumentRevision;
- Story/Script parser output;
- human confirmation khi semantic mapping không chắc chắn.

## A03 — Import image/video/audio/folder

Gaps:
- chưa định nghĩa copy/reference/link policy theo asset;
- chưa có missing-media relink contract;
- chưa định nghĩa proxy creation policy;
- chưa có duplicate detection UX;
- chưa định nghĩa corrupted/unsupported media UX;
- chưa xử lý external file mutated after import.

Need:
- SourceBinding mode: MANAGED_COPY / EXTERNAL_LINK / MIRRORED;
- source fingerprint;
- relink by content hash;
- immutable ingest snapshot option;
- proxy/thumbnail generation jobs;
- unsupported format normalization.

## A04 — Record voice / microphone input

Gaps:
- chưa có recording session UX;
- chưa xử lý input device, gain, clipping, sample rate, room noise;
- chưa phân biệt instruction voice vs dialogue performance vs cloning reference;
- chưa có explicit consent prompt khi voice được dùng cho clone/training.

Need:
- RecordingSession;
- input meter;
- local monitoring;
- semantic role selection;
- consent/right binding;
- quality suitability check.

## A05 — Create/lock a Character

Covered conceptually but missing action details:
- draft → candidate → approved → locked;
- unlock/change;
- create variant;
- retire/deprecate;
- change canonical reference.

Need:
- CharacterCanonStateMachine;
- impact preview before canon replacement;
- scoped override;
- invalidate descendants but never mutate them;
- waiver flow for old shots.

## A06 — Change a Character after 200 shots exist

Current architecture says stale/impact analysis, but UX/workflow not defined.

Need UI:
```text
Thay Visual Identity V18 → V19
Affects:
  214 shots
  37 approved
  4 final scenes
Estimated rerender: ...
Options:
  Apply future shots only
  Re-review affected shots
  Regenerate selected
  Cancel
```

Must never silently invalidate and enqueue 214 renders.

## A07 — Add/change voice

Covered identity separation, but missing:
- voice audition workflow;
- common test script;
- A/B blind review;
- fallback provider migration;
- voice replacement impact;
- dialogue batch regeneration;
- preserving approved takes.

Need:
- VoiceCastingSession;
- VoiceBindingCertification;
- DialogueImpactAnalysis;
- language-by-language lock.

## A08 — Multi-character dialogue

Architecture covers DialogueLine but still missing:
- conversational grouping;
- overlapping dialogue;
- room tone;
- interruption;
- reactions/non-verbal sounds;
- off-screen voice;
- crowd/background speech;
- sync ownership when edit changes timing.

Need:
- DialogueSequence / ConversationBeat;
- utterance timing graph;
- audio session context;
- selected take per line;
- scene mix preview.

## A09 — Change costume/prop state

Need action:
- apply to current shot;
- current scene onward;
- story interval;
- whole project.

Without scope UI, user can accidentally modify hundreds of shots.

Need scope selector + impact preview + undoable state event.

## A10 — Generate image/video/audio

Current capability routing is good conceptually, but execution UX lacks:
- number of candidates;
- candidate budget;
- stop early;
- cost reservation;
- progress evidence;
- user cancellation;
- partial result preservation;
- provider timeout choices;
- retry vs alternate provider decision;
- exact seed/revision capture.

Need GenerationSession entity.

## A11 — Cancel generation

Critical missing semantics.

Cancel may mean:
- remove from local queue;
- kill local process;
- API cancellation request;
- web generation cannot be stopped;
- cost already consumed;
- output may still arrive late.

Need:
- CANCELLATION_REQUESTED;
- CANCELLATION_CONFIRMED;
- CANNOT_CANCEL;
- COMPLETED_AFTER_CANCEL;
- late output handling.

UI must state what was actually cancelled.

## A12 — Retry failure

Need distinguish:
- retry exact profile;
- retry with repaired input;
- retry alternate tool;
- regenerate new creative attempt.

Do not put one generic “Retry” button.

## A13 — Approve result

Risk register covers exact-byte approval, but implementation needs:
- viewed representation ID;
- full-resolution requirement where needed;
- review completion requirements;
- dependency snapshot;
- reviewer role;
- notes;
- policy/evaluator version.

Approval command must be atomic and stale-safe.

## A14 — Reject/Repair result

Need reject reason taxonomy + free text + marker/time range.
Repair must be scoped:
- frame range;
- region;
- audio segment;
- identity;
- motion;
- color;
- dialogue.

Otherwise “repair” regenerates too much and creates unnecessary drift.

## A15 — Edit timeline

This is currently a major architecture gap.

Need Canonical Edit Graph with:
- clip instance;
- source asset revision;
- in/out;
- handles;
- track;
- gap;
- overlap;
- transition;
- speed/retime;
- freeze frame;
- transform/crop;
- audio gain/pan;
- link groups;
- nested sequence;
- markers;
- captions;
- effects reference;
- color reference;
- version.

Do not store edit as only rendered MP4.

## A16 — Change edit after lip-sync/music/subtitles

Must define dependency invalidation:
- retiming clip changes subtitles;
- dialogue cut changes music cue timing;
- edit shift may invalidate lip-sync/audio alignment;
- new scene duration changes score.

Need TimelineChangeImpactAnalyzer.

## A17 — Undo/Redo

Currently a critical gap.

Need Command/Action Ledger:
- user command;
- actor;
- timestamp;
- affected entities;
- before/after revision references;
- reversible?;
- compensation action?;
- external side effect?;
- undo window.

Not all actions can be undone.

## A18 — Autosave

Need:
- save state indicator;
- crash-safe persistence;
- drafts vs meaningful checkpoints;
- recovery after power loss;
- unsaved UI text buffers.

Autosave must not create a canonical approval automatically.

## A19 — Duplicate/branch creative direction

Need user ability:
- create Variant A/B;
- branch Scene;
- branch Character;
- branch Edit;
- compare;
- promote chosen branch;
- archive loser.

Otherwise experiments contaminate canonical production.

## A20 — Change tool/provider preference

Need hierarchy:
Studio → Project → Sequence → Scene → Shot → Task.

Need explain inheritance and reset-to-parent.

Changing routing preference must not silently rerender old outputs.

## A21 — Add a Connection

Need onboarding:
- detect type;
- capabilities;
- auth;
- rights/privacy;
- health test;
- permissions;
- concurrency;
- cost model;
- certification;
- test artifact;
- trust level.

Connection should begin UNVERIFIED, not READY.

## A22 — Remove/disable a Connection

Need:
- DRAIN;
- DISABLE;
- REMOVE CREDENTIAL;
- UNINSTALL RUNTIME;
- DELETE MODEL;
- REMOVE CONNECTOR.

These are different actions.

Must show:
- active jobs;
- pinned projects;
- reproducibility impact;
- freed storage.

## A23 — Browser/Web tool usage

Critical gaps:
- login/MFA/CAPTCHA human takeover;
- browser profile ownership;
- session expiry;
- web DOM drift;
- download-to-job association;
- multiple simultaneous jobs/profile locking;
- terms/credits uncertainty;
- manual completion confirmation.

Need BrowserInteractionSession + InteractionTrace.

## A24 — MCP tool usage

Need:
- tool discovery diff;
- server capability changes;
- tool schema change;
- permission prompts;
- user-granted scope;
- server quarantine;
- timeout/reconnect semantics.

MCP server must never automatically gain all project context.

## A25 — CLI tool usage

Need explicit typed tool manifests:
- binary hash/version;
- allowed args;
- working directory;
- allowed files;
- network permission;
- timeout;
- output parser;
- exit-code mapping.

User adding custom CLI must have test/sandbox mode.

## A26 — User asks CineForge “do this”

Need Assistant Command Interpreter separated from execution.

Natural-language request:
```text
"Đổi tất cả cảnh đêm sang tone lạnh hơn"
```

must compile to a proposed action plan with impact, not directly mutate hundreds of assets.

Need:
- intent parse;
- plan preview if high impact;
- policy check;
- command execution;
- undo/compensation.

## A27 — Drag/drop onto context

Need deterministic context rules:
- dropping image on Character;
- on Shot;
- on Style board;
- on general Library.

Same file produces different semantic binding.

UI must show binding after drop and allow quick change.

## A28 — External editing / CapCut / Premiere / Resolve

Foundation has Handoff but lacks round-trip lifecycle.

Need:
- ExportSession;
- HandoffManifest;
- ExternalEdit entity;
- expected media set;
- interchange compatibility report;
- re-import/diff;
- flattened-output limitations;
- relink;
- version lineage.

Never claim full round-trip if target format cannot preserve effect semantics.

## A29 — Export master

Need ReleaseBuild pipeline:
- picture lock revision;
- audio master revision;
- subtitles;
- color transform;
- codec;
- rights snapshot;
- QC policy;
- technical validation;
- checksum;
- release manifest.

File render success != release success.

## A30 — Publish

Major gap.

Publish must be separate from Export.

Need:
- target platform/account;
- release candidate;
- irreversible confirmation;
- rights gate;
- metadata;
- upload progress;
- platform processing state;
- delivered-output verification;
- rollback/replace semantics where provider supports them.

## A31 — Delete asset/project

Need distinction:
- remove reference;
- move to Trash;
- purge bytes;
- legal deletion;
- secure credential deletion.

Must calculate affected dependencies and real bytes freed.

## A32 — Clean storage

Foundation defines classes but GC algorithm missing.

Need:
- graph reachability;
- retention policy;
- lease check;
- active job protection;
- trash protection;
- rebuildability verification;
- sampled Failure Lake protection;
- dry-run report;
- transactional delete/tombstone;
- post-delete reconciliation.

## A33 — Move storage/library

Need:
- preflight free space;
- pause writers;
- copy;
- verify hashes;
- switch authoritative root;
- rollback;
- delayed deletion of old copy.

## A34 — Backup/Restore

Need user action contract:
- backup now;
- scheduled backup;
- verify backup;
- restore preview;
- full restore;
- project-only restore;
- alternate-location restore.

Restore must reconcile DB + objects + rights + release records.

## A35 — Update CineForge

Need UX:
- what will update;
- active jobs impact;
- DB migration;
- compatibility;
- rollback;
- connector/runtime/model pin.

Never auto-update critical production dependencies mid-project without policy.

## A36 — Change project technical profile

Changing FPS/color/sample rate/resolution mid-production is high-impact.

Need impact analysis:
- affected media;
- timeline timing;
- subtitles;
- audio sync;
- proxies;
- exports;
- QC.

Should usually create new ProjectMediaProfile revision with explicit migration.

## A37 — Multi-user collaboration

Currently missing.

Even local-first may later have:
- Director + editor;
- producer + reviewer;
- multiple machines.

Need:
- actor identity;
- optimistic concurrency;
- leases for edits;
- stale form detection;
- review conflict;
- approval authority;
- offline edits/merge policy.

Design IDs/events now so future collaboration is possible.

## A38 — Search / Command Palette

Need global search over:
- project;
- character;
- scene;
- shot;
- asset;
- dialogue;
- activity;
- action.

Search result must respect project/privacy scope and never substitute semantic similarity for identity.

## A39 — Notification/Needs You

Current UI contract mentions NEEDS_USER, but need canonical DecisionRequest entity:
- reason;
- blocking scope;
- choices;
- recommended option;
- deadline;
- default if ignored;
- evidence;
- one-click resolve.

This prevents arbitrary modals/toasts.

## A40 — User leaves app / shutdown Windows

Need:
- UI close behavior;
- core service continues?;
- active render;
- update pending;
- system shutdown;
- power failure;
- checkpoint;
- resume.

The user must know whether “Close” means hide UI, stop background work, or exit completely.

---

# 4. Major subsystem gaps to add

## 4.1 Action & Command Engine

All meaningful user mutations should pass through:
```text
Intent
→ Validate
→ Impact Analysis
→ Policy
→ Execute Command
→ Event(s)
→ Reconcile
→ UI outcome
```

Command metadata:
- reversible;
- compensatable;
- irreversible;
- confirmation policy;
- cost estimate;
- storage estimate;
- rights impact;
- stale dependencies.

This is the missing bridge between UX and domain correctness.

## 4.2 Story & Script Engine

Need:
- StoryProject;
- ScriptDocument;
- ScriptRevision;
- SceneDefinition;
- Beat;
- DialogueLine;
- ActionLine;
- CharacterMention;
- LocationMention;
- PropMention;
- StoryEvent;
- continuity assertions.

Script import must create candidates, not silently canonicalize AI extraction.

## 4.3 Canonical Timeline / Edit Graph

Required for:
- real post-production;
- output as individual clips;
- NLE handoff;
- subtitle/music synchronization;
- change-impact analysis;
- round-trip editing.

## 4.4 Production Dependency Graph

Need formal dependency kinds:
- semantic dependency;
- timing dependency;
- visual dependency;
- rights dependency;
- technical dependency;
- soft reference.

Not every dependency change should stale all descendants equally.

## 4.5 Decision Inbox / Needs You

Replace scattered confirmation dialogs with one domain object.

## 4.6 Cost & Resource Ledger

Need:
- credit/money budget;
- reservation before job;
- actual usage;
- refund/failed-charge;
- unknown cost;
- local GPU time;
- storage cost;
- human review time.

Router must not use stale/assumed balances.

## 4.7 Project Media Contract

Pin:
- base frame rate;
- timeline time base;
- resolution/aspect;
- working color space;
- delivery color transforms;
- audio sample rate/layout;
- subtitle languages;
- mastering targets.

Every imported/generated asset normalized or explicitly carries conversion plan.

## 4.8 External Handoff/Round-trip

Formal adapters:
- generic media package;
- CapCut-oriented package;
- Premiere/Resolve/FCP interchange where supported;
- re-import lineage.

## 4.9 Storage/GC Engine

Must be graph-aware, transaction-aware, job-aware, retention-aware.

## 4.10 Collaboration-ready identity model

Even if V1 single-user:
- all commands/events have actor_id;
- approvals have authority role;
- optimistic version numbers;
- conflict states.

---

# 5. UI/UX gaps by visibility

## Always visible

At project/scene/shot level, user should see:
- Tôi đang ở đâu?
- CineForge đang làm gì?
- Có gì cần tôi?
- Có gì bị chặn?
- Bước tiếp theo?
- Có thay đổi chưa lưu/đang lưu?
- Background work count.

## Contextually visible

Only when relevant:
- cloud data egress;
- credits/cost;
- affected dependencies;
- storage pressure;
- rights issue;
- stale canon;
- connection degraded.

## Advanced only

- provider IDs;
- model IDs;
- seeds;
- embeddings;
- queue lease;
- raw evaluator metrics;
- CUDA/runtime details;
- raw API/MCP payloads.

---

# 6. Risk register ↔ architecture coverage verdict

### Strong conceptual coverage
- vendor/tool lock-in;
- character identity separation;
- basic rights/provenance;
- storage categories;
- immutable approvals;
- unknown != pass;
- multi-transport connectivity;
- human-readable long jobs;
- language separation;
- installer/update separation.

### Partial coverage
- continuity;
- QC/evidence;
- repair;
- web automation;
- media technical correctness;
- handoff;
- storage cleanup;
- fallback;
- update safety;
- release;
- backup/recovery.

### Currently insufficient
- user command semantics;
- undo/redo;
- cancellation;
- canonical timeline;
- script breakdown;
- external edit round-trip;
- project technical profile migration;
- collaboration;
- cost reservation/reconciliation;
- decision inbox;
- publish workflow;
- GC algorithm;
- crash/shutdown resume;
- action-level privacy/rights review;
- scope of bulk edits;
- bulk impact simulation.

---

# 7. New non-negotiable invariants

1. Every mutating user action has an Action/Command record.
2. Every bulk action has explicit scope.
3. High-impact bulk actions run impact analysis before execution.
4. A cancelled external job may still produce an artifact; late results never become canonical automatically.
5. Autosave never implies approval.
6. Undo never pretends to reverse irreversible external effects.
7. Canonical timeline uses pinned asset revisions.
8. Timeline edits invalidate only affected timing/semantic dependencies.
9. Every project has a versioned MediaProfile.
10. Script parsing output is candidate data until accepted.
11. Import never overwrites original files.
12. External linked files are continuously identifiable by fingerprint/hash and can become MISSING/CHANGED.
13. Cleanup runs from reference graph and retention policy, never directory heuristics.
14. Connection removal cannot break pinned production silently.
15. Natural-language AI commands compile to auditable commands; they do not directly mutate the DB.
16. Every decision request has clear owner, impact, choices, and blocking scope.
17. Every generation session records candidate budget, cost budget, and stop/cancel semantics.
18. Publish is a separate irreversible boundary from Export.
19. Every critical user-visible wait state reports real evidence of progress or explicitly says progress is unknown.
20. Every command/event carries actor identity even in single-user V1.

---

# 8. Recommended next architecture documents

Before implementation grows, create:
- USER_ACTION_MODEL.md
- STORY_SCRIPT_DOMAIN.md
- TIMELINE_EDIT_MODEL.md
- PRODUCTION_DEPENDENCY_GRAPH.md
- QC_EVIDENCE_ENGINE.md
- CONNECTIONS_CAPABILITY_FABRIC.md
- STORAGE_GC_BACKUP.md
- DELIVERABLES_HANDOFF_RELEASE.md
- UI_UX_SYSTEM.md
- DATA_MODEL.md
- SECURITY_TRUST_BOUNDARIES.md

These documents should derive schemas/state machines from the risk register, not invent independent designs.
