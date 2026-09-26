# CineForge OS — Detailed UI/UX Component System v1

> Product language: vi-VN default, en-US secondary.
> UX principle: expose intent, hide machinery.
> The interface must make a complex production system feel calm, legible and controllable.

# 1. UX invariants

Every primary screen must answer within seconds:
1. Tôi đang ở đâu?
2. CineForge đang làm gì?
3. Có việc gì cần tôi?
4. Tôi nên làm gì tiếp theo?

Additional invariants:
- No fake progress.
- No technical error without a human-readable recovery path.
- One obvious primary action per context.
- Safe actions favor undo over confirmation.
- High-impact/destructive actions use impact preview.
- Technical details are progressive disclosure.
- The user can always discover why CineForge chose a tool/strategy.
- Background work remains visible without stealing focus.
- UI locale never changes creative source language.

# 2. Information architecture

Primary navigation:
- Trang chủ
- Dự án
- Sáng tạo
- Sản xuất
- Hậu kỳ
- Duyệt
- Thư viện
- Phát hành

Advanced/System:
- Kết nối
- Hàng đợi
- Dung lượng
- Chẩn đoán
- Cài đặt

Project contextual tabs:
- Tổng quan
- Kịch bản
- Canon
- Cảnh quay
- Timeline
- Âm thanh
- Duyệt
- Rights
- Phát hành

Do not show every contextual tab if it is irrelevant to project type/stage.

# 3. Desktop shell layout

Default wide layout:

```text
┌───────────────────────────────────────────────────────────┐
│ Context Bar: breadcrumb · search · activity · Needs You   │
├────────────┬───────────────────────────────┬──────────────┤
│ Navigation │ Main Workspace                │ Inspector    │
│ 64/232 px  │ flexible                      │ 320-420 px   │
│            │                               │ collapsible  │
├────────────┴───────────────────────────────┴──────────────┤
│ Optional activity/timeline drawer                         │
└───────────────────────────────────────────────────────────┘
```

Rules:
- Inspector collapsed by default if it would make preview/timeline cramped.
- On widths below comfortable editing threshold, inspector becomes overlay drawer.
- Full-screen Focus Mode hides navigation, inspector and noncritical notifications.
- No permanent bottom panel unless current task needs it.

# 4. Visual language

## 4.1 Theme
Two first-class themes:
- Light
- Dark

Both use identical semantic hierarchy.

## 4.2 Color roles
Use design tokens, not raw colors in components:
- surface.canvas
- surface.panel
- surface.elevated
- text.primary
- text.secondary
- border.subtle
- action.primary
- action.secondary
- state.info
- state.success
- state.warning
- state.critical
- state.ai

Rules:
- brand accent: restrained indigo/violet family;
- red only for destructive/critical/security/release blocking;
- amber for attention/recoverable problem;
- green only for verified/completed/healthy;
- purple is not sprayed everywhere merely because AI is involved;
- state meaning always uses icon + text, never color alone.

## 4.3 Typography
Five levels only:
- Page Title
- Section Title
- Body
- Secondary
- Metadata

Use a Windows/Vietnamese-safe system font stack by default.
Numeric tables may use tabular numerals.

## 4.4 Density
Three density presets:
- Comfortable default
- Compact
- Review/Timeline optimized

Do not create separate “beginner theme”; complexity is controlled through progressive disclosure.

# 5. Global components

## AppShell
Owns:
- navigation;
- context bar;
- project context;
- global overlays;
- event subscription state.

## ContextBreadcrumb
Example:
`Dự án Aurora › Scene 12 › Shot SH12C`

Always shows clickable parent context.

## ProjectSwitcher
Shows:
- active projects;
- recent;
- archived;
- project health indicator without technical noise.

## GlobalSearchCommand
Shortcut: Ctrl+K.
Searches:
- project;
- character;
- scene;
- shot;
- dialogue;
- asset;
- activity;
- actions/settings.

Results distinguish exact identity match vs semantic suggestion.

## GlobalActivityChip
Compact:
`● 7 đang xử lý · ! 2 cần bạn`

Click opens Activity Center.

## NeedsYouButton
Persistent but nonintrusive.
Badge count reflects open DecisionRequests, not arbitrary notifications.

## SaveStateIndicator
States:
- Đã lưu
- Đang lưu…
- Không thể lưu
- Đang khôi phục…

Never implies “approved”.

## ConnectivityIndicator
Only appears when relevant:
- Offline — local tools vẫn hoạt động
- Core reconnecting
- Cloud degraded

# 6. Activity Center

Tabs:
- Đang xử lý
- Cần bạn
- Hoàn tất gần đây
- Có vấn đề

Each ActivityItem shows:
- human-readable operation;
- project/context;
- real milestone;
- whether user action is required;
- cancelability;
- next action.

Advanced expand:
- job/attempt;
- connection;
- raw technical status;
- logs.

Never list every low-level event as a notification.

# 7. Needs You / Decision components

## DecisionCard
Shows:
- what needs decision;
- why;
- what is blocked;
- evidence preview;
- choices;
- recommended option if policy permits;
- “Không làm gì lúc này” if valid.

## ImpactPreviewSheet
Used for:
- canon replacement;
- bulk edit;
- media profile change;
- connection removal;
- storage purge;
- publication.

Shows:
- exact scope;
- affected counts;
- approved items affected;
- estimated time/cost/storage;
- rights/privacy consequences;
- reversibility;
- what happens if cancelled.

No generic “Are you sure?” for complex high-impact actions.

# 8. Home screen

Priority order:
1. Continue work
2. Needs You
3. Background production
4. Problems
5. Recent projects
6. System/storage only when attention is needed

Example:
```text
Tiếp tục
Aurora · Scene 18 · Đang duyệt Shot 18C

Cần bạn
3 quyết định

Đang tự xử lý
18 tác vụ

Có vấn đề
1 shot đang thử phương án khác
```

GPU/VRAM/storage stats do not dominate Home.

# 9. Project Overview

Cards:
- Project status
- Next Step
- Needs You
- Production progress
- Current bottleneck
- Release readiness
- Storage footprint
- Budget usage

Progress must not be one misleading percentage.
Show:
- shots completed / total;
- critical path/bottleneck;
- estimated state with uncertainty.

# 10. Universal Intake UI

One entry surface:
- drag files/folders;
- paste text;
- paste image;
- record voice;
- paste URL;
- choose from machine.

## ImportTray
Appears immediately on drop/paste.
Per item:
- name/type;
- scan/decode state;
- duplicate indicator;
- semantic role proposal;
- size/storage behavior;
- error if any.

## SemanticRolePicker
Examples:
- Character Reference
- Style Reference
- First Frame
- Story Document
- Shot List
- Voice Reference
- Dialogue Performance
- Generic Asset

If confidence is high, preselect but make the binding visible and undoable.

## ImportPreview
Before committing structured docs:
- original preview;
- parsed result;
- column/field mapping;
- diff against known revision;
- ambiguities.

## SourceStorageChoice
For large media:
- Quản lý trong CineForge
- Giữ ở vị trí hiện tại
- Mirror/backup

Explain missing-media consequence of external link.

# 11. Story/Script workspace

Three-pane optional layout:
- Outline/Scenes
- Script editor
- Structured inspector

Features:
- original text preserved;
- parsed entities highlighted;
- AI suggestions appear as proposals;
- conflicts visible;
- accept/reject per extraction;
- change history;
- canon checkpoint.

AI never silently rewrites canonical script.

# 12. Canon workspace

Sections:
- Characters
- Environments
- Props
- Costumes
- Style

## CharacterCard
Shows:
- hero thumbnail;
- name;
- Canon/Draft;
- visual lock;
- voice lock;
- used in N scenes;
- attention badges.

## CharacterWorkspace
Tabs:
- Ngoại hình
- Giọng
- Trang phục
- Vật dụng
- Diễn xuất
- Trạng thái câu chuyện
- Rights
- Lịch sử

Primary action depends on state:
- Hoàn thiện nhân vật
- Duyệt revision
- Tạo biến thể

## RevisionRail
Human-friendly:
- Bản hiện tại
- Candidate
- Previous versions

Do not make user manage filenames/version numbers manually.

## ChangeImpactPanel
Before replacing canonical identity:
- affected shots;
- approved shots;
- release impact;
- cost/time estimate;
- future-only option.

# 13. Voice Casting UI

## VoiceAuditionBoard
Side-by-side candidates using same test lines.
Controls:
- play;
- blind A/B mode;
- language;
- emotional test;
- mark favorite;
- approve binding.

Shows simple dimensions:
- Giống nhân vật
- Rõ lời
- Cảm xúc
- Phát âm
- Consistency

Raw similarity scores are Advanced.

## VoiceReferenceRecorder
- input device;
- level meter;
- clipping indicator;
- room noise indicator;
- sample script;
- consent/use-purpose notice;
- test playback.

Explicitly asks whether recording is:
- performance only;
- voice reference;
- cloning reference.

# 14. Production workspace

Hierarchy:
Film → Sequence → Scene → Shot.

## ProductionBoard
View modes:
- Cards
- List
- Scene strip

Shot card:
- preview;
- shot code;
- human status;
- selected candidate;
- character/canon stale indicator;
- current action.

## ShotWorkspace
Center:
- preview/player;
- candidate strip;
- shot intent.

Inspector:
- cast;
- environment;
- props;
- camera;
- lighting;
- style;
- dialogue;
- references;
- tool strategy;
- history.

Primary actions:
- Tạo
- Duyệt
- Tạo lại
- Sửa
depending on current state.

## StrategyControl
Default:
`Tự động`

Expandable:
- quality priority;
- local/cloud;
- preferred connection;
- budget;
- editability;
- privacy.

Advanced:
- exact connector/model/workflow/seed where supported.

## WhyThisChoice
Explains:
- selected strategy;
- reason;
- alternatives;
- cost/time/quality tradeoff;
- policy constraints.

# 15. Long-running action components

## AsyncActionButton
On click, responds instantly:
`Đã gửi · Đang chuẩn bị…`

No dead click.

## ProgressMilestones
Example:
- ✓ Chuẩn bị reference
- ✓ Kiểm tra continuity
- ● Đang tạo candidate 2/3
- ○ Kiểm tra kết quả

Only real milestones.

## WaitingExternalCard
Example:
`Đang chờ Google Flow · 2 phút 14 giây`

If slower than normal:
- explain;
- continue waiting;
- use alternate strategy;
- cancel if possible.

## BackgroundContinuationBanner
`Bạn có thể tiếp tục làm việc ở nơi khác.`

# 16. Candidate selection

CandidateGrid:
- progressive arrival;
- play/preview before all candidates finish;
- stop remaining generation;
- compare;
- select;
- send to review;
- mark failure reason.

Selecting a candidate is not approving it.

# 17. Review workspace

Default Focus Mode.

Layout:
- large player;
- timeline issue markers;
- concise issue panel;
- Previous/Next;
- Approve / Repair / Reject / Abstain.

Issue language:
- “Tay phải biến dạng khoảng 00:03.2”
- “Áo khác màu so với shot trước”
- “Chưa thể đánh giá diễn xuất”

Not:
- raw embedding metric.

Advanced:
- evaluator details;
- thresholds;
- raw scores;
- evidence images.

Keyboard:
- Space play/pause
- arrows previous/next
- marker/comment shortcuts
- approval/reject shortcuts configurable and protected from accidental destructive use.

# 18. Timeline / Post workspace

Main areas:
- viewer;
- timeline;
- media/bin;
- inspector;
- audio meters when needed.

## TimelineCanvas
Must support:
- clips;
- audio;
- captions;
- markers;
- transitions;
- retime;
- linked clips;
- snapping;
- zoom;
- nested sequences baseline.

## DependencyImpactToast
After timing edit:
`Thay đổi này làm 4 subtitle và 1 music cue cần kiểm tra lại.`

Not a blocking modal unless policy says severe.

## ExternalEditorHandoff
Wizard:
1. target editor;
2. compatibility check;
3. package contents;
4. destination;
5. export progress;
6. manifest summary.

Never claim editable round-trip features unsupported by target.

# 19. Audio workspace

Views:
- Dialogue
- Voice
- Music
- Foley/SFX
- Ambience
- Mix

Dialogue view groups by scene/conversation, not only a flat file list.

Each line:
- speaker;
- text;
- selected take;
- timing;
- pronunciation warning;
- lip-sync state.

Exports can generate:
- per-character tracks;
- dialogue stem;
- music stem;
- SFX/Foley;
- ambience;
- master mix.

# 20. Library UI

Filters by:
- type;
- project;
- character;
- semantic role;
- approved/candidate;
- source;
- rights state;
- created date.

AssetDetail:
- preview;
- human name;
- usage;
- revision history;
- provenance;
- rights;
- storage;
- technical metadata Advanced.

Never expose object-store hash paths as normal filenames.

# 21. Connections UI

Default grouping by capability:
- Tạo ảnh
- Tạo video
- Giọng nói
- Âm thanh
- 3D
- Hậu kỳ
- Công cụ khác

ConnectionCard:
- Sẵn sàng / Cần đăng nhập / Đang bận / Hết quota / Bị tạm dừng
- main capabilities;
- automation level;
- privacy;
- approximate cost;
- current jobs.

Detail:
- permissions;
- projects allowed;
- priority;
- limits;
- versions;
- health history;
- technical connector info Advanced.

Actions clearly separate:
- Ngừng nhận việc mới
- Tạm dừng
- Ngắt tài khoản
- Gỡ connector
- Xóa runtime/model

# 22. Add Connection wizard

Step 1: type
- AI/Model
- Software on computer
- MCP
- API
- Website
- CLI
- Human/Team

Step 2: detect/configure

Step 3: requested permissions + privacy

Step 4: health/capability test

Step 5: capability mapping confirmation

A new connection starts UNVERIFIED and cannot receive production work until tested/certified per policy.

# 23. Queue UI

Default:
- Đang xử lý
- Đang chờ
- Cần bạn
- Có vấn đề

Each job shows work language:
`Scene 12 · Tạo Shot SH12C`

Advanced columns:
- worker;
- connection;
- attempt;
- GPU;
- lease;
- raw state;
- cost.

Do not make normal users read Jenkins-like tables.

# 24. Storage Manager UI

Summary:
- Projects
- Originals
- Approved
- Models
- Cache
- Temp
- Exports
- Backups
- Trash

Primary message:
`Có thể dọn an toàn: 126 GB`

Cleanup preview explains every class.

Actions:
- Dọn an toàn
- Xem chi tiết
- Di chuyển thư viện
- Quản lý model
- Thùng rác
- Backup

Never provide a blind “Clear everything” action.

# 25. Release UI

ReleaseReadiness checklist:
- Picture
- Audio
- Subtitle/localization
- Rights
- QC
- Technical media
- Missing files
- Decisions

States:
- Sẵn sàng
- Cần xử lý
- Chưa kiểm tra

Primary action stays disabled/guarded if blocking gates remain.

Export and Publish are separate buttons/workflows.

Publish screen always shows:
- exact release manifest;
- target platform/account;
- what will become public;
- irreversible/compensatable nature.

# 26. Error and recovery components

## RecoverableProblemCard
Structure:
1. what happened;
2. what CineForge is doing;
3. whether user action is needed;
4. choices;
5. Advanced technical detail.

Example:
`Không đủ bộ nhớ GPU cho cấu hình hiện tại. CineForge có thể chuyển sang công cụ khác mà không thay đổi project.`

## BlockingProblemCard
Clearly states what is blocked.

## CrashRecoveryBanner
`CineForge đã khôi phục phiên làm việc sau khi bị gián đoạn.`
Show recovered drafts/jobs and any uncertain external jobs.

# 27. Offline/degraded UX

If internet is lost:
- local workflow continues;
- cloud jobs show waiting/reconciliation;
- no full-app error page.

If Core unavailable:
- UI enters reconnect screen;
- unsent local UI drafts preserved;
- no commands pretending success.

Safe mode:
- projects remain browsable/readable;
- execution/update actions disabled;
- recovery guidance shown.

# 28. Undo/redo UX

Safe reversible actions:
- perform;
- show short Undo toast;
- history available.

High-impact undo:
- show consequences;
- may create compensating command.

Never label “Undo” if external publication/upload/charge cannot actually be reversed.

# 29. Empty states

Every empty state has:
- explanation;
- one primary action;
- optional example.

No bare “No data”.

# 30. First-run experience

Maximum core setup:
1. Ngôn ngữ
2. Nơi lưu dữ liệu
3. Cách sử dụng công cụ: Tự động / Local only / Local + Online

Then enter app.

Connections and heavy model packs are configured just-in-time.

First-run hardware scan is visible but not overwhelming.

# 31. Notifications

Channels:
- in-app transient toast;
- persistent Activity Center;
- Needs You;
- native Windows notification.

Native notification only for:
- decision needed while app not focused;
- meaningful milestone;
- critical system problem.

No per-job spam.

# 32. Accessibility

Required:
- keyboard navigation;
- visible focus states;
- scalable text/UI;
- sufficient contrast;
- reduce motion;
- status not color-only;
- screen-reader labels for management UI;
- caption/subtitle workflows;
- configurable shortcuts.

# 33. Localization

Rules:
- all UI strings keyed;
- no concatenated translatable sentences;
- plural/date/number formatting locale-aware;
- terminology dictionary for film terms;
- preserve English industry terms where Vietnamese users commonly use them;
- creative content language independent from UI locale;
- Vietnamese diacritics and Unicode paths tested end-to-end.

# 34. Design token/component discipline

Component layers:
1. Tokens
2. Primitives
3. Semantic components
4. Domain components
5. Workspace compositions

No page-local one-off status color or error pattern if a semantic component exists.

Domain components include:
- EntityHeader
- RevisionBadge
- CanonLockBadge
- StaleBadge
- RightsBadge
- HumanStateBadge
- DecisionCard
- ImpactPreviewSheet
- ProgressMilestones
- AsyncActionButton
- CandidateGrid
- AssetCard
- CharacterCard
- VoiceAuditionCard
- ShotCard
- EvidenceIssue
- ConnectionCard
- StorageCleanupCard
- ReleaseGateCard

# 35. UI test matrix

Every primary workflow tested at:
- first use/no data;
- normal success;
- slow operation;
- partial result;
- recoverable failure;
- blocking failure;
- offline;
- stale revision;
- permission/rights block;
- cancellation;
- Core restart;
- dark/light;
- vi-VN/en-US;
- keyboard-only;
- 100%/125%/150%/200% scale.

Critical usability test:
a person who does not know API/MCP/CLI/model/GPU must complete a short film flow without encountering those concepts unless a technical problem requires them.


# 36. Producer / Project Management workspace

This workspace answers:
- what is blocking delivery?
- what is on the critical path?
- what is at risk?
- where is work piling up?
- which decision is waiting on whom?
- how much budget/capacity remains?

Primary modules:
- MilestoneStrip
- CriticalPathList
- BottleneckCard
- WipPressureCard
- BudgetUsageCard
- NeedsDecisionByRole
- ResourceCapacitySummary

Do not show a fake single percent as the primary truth.
If progress percent is shown, pair it with:
- source basis;
- critical path;
- confidence/uncertainty.

# 37. Control Mode UI

Scope-aware mode selector:
- Tự động
- Có hướng dẫn
- Nâng cao
- Chuyên sâu

Rules:
- user sees current effective mode;
- show where it is inherited from;
- allow “Đặt lại theo cấp trên”;
- changing mode affects future behavior, not past outputs.

Guided mode surfaces:
- quality priority;
- local/online preference;
- cost limit;
- privacy;
- preferred capability pool;
- review strictness.

Expert mode may expose:
- connector/model/workflow revision;
- seed;
- runtime parameters;
- raw prompt;
- timeout/retry policy.

# 38. Creative Exception UI

When CineForge flags something that is intentional:
`Đây là chủ ý sáng tạo`

Opens CreativeExceptionSheet:
- issue/evidence;
- scope;
- why intentional;
- applies until when;
- who can approve;
- whether release/QC should still warn.

Exception never deletes evidence.

# 39. Music workspace

Sections:
- Themes / Motifs
- Spotting
- Cues
- Candidates
- Approved Score

## MusicThemeCard
Shows:
- motif identity;
- associated characters/themes;
- approved references;
- usage count.

## SpottingTimeline
Places:
- cue start/end;
- hit points;
- transitions;
- intentional silence.

When edit changes:
`3 music cues need timing review`
not immediate destructive regeneration.

# 40. Localization workspace

Tabs:
- Translation
- Subtitles
- Dubbing
- Accessibility

Translation table:
- source original;
- target;
- semantic notes;
- review state.

Subtitle editor:
- player;
- timing;
- line length/readability warnings;
- UTF-8/font coverage checks.

Dubbing view:
- character;
- source line;
- localized line;
- voice binding;
- timing;
- selected take.

User can intentionally approve subtitle/dub wording differences with recorded rationale.

# 41. Composition / VFX workspace

Default:
- composite preview;
- layers;
- passes;
- inspector.

Layer row shows:
- source;
- mask/depth/alpha;
- state;
- dependencies.

Replacing one layer previews exact impact before commit.

Advanced inspector:
- color space;
- alpha mode;
- coordinate system;
- units;
- camera metadata.

# 42. Provisioning / Capability Pack UI

Normal user sees capabilities, not package graph.

Example:
`Tạo video local — Chưa cài`
`[Cài đặt]`

Install sheet:
- download size;
- disk required;
- GPU compatibility;
- publisher/signature;
- expected capability;
- restart/reboot if any.

Advanced:
- package dependencies;
- exact versions;
- pins;
- benchmark/certification.

Do not expose Python/CUDA package trivia unless troubleshooting.

# 43. Diagnostics UI

Default health summary:
`Mọi thứ đang hoạt động bình thường`

If issue:
- affected area;
- what still works;
- what CineForge is doing;
- user action if required.

Advanced HealthGraph:
- Core
- DB
- workers
- storage
- connections
- monitor heartbeat.

Support action:
`Tạo gói chẩn đoán`

Before creation show:
- included logs/metadata;
- excluded credentials;
- whether any media will be included;
- file size estimate.

# 44. Archive / Read-only compatibility UX

Historical projects must open even if old execution dependencies are gone.

Banner:
`Dự án đang mở ở chế độ chỉ đọc vì một số công cụ cũ không còn khả dụng.`

Still allow:
- browse script/canon;
- inspect timeline;
- preview available media;
- inspect approvals/rights/history;
- export already available artifacts when safe.

Do not force model/runtime reinstall merely to view history.

# 45. External side-effect disclosure

For actions that touch external providers, UI must distinguish:
- local state rollback;
- provider-side action;
- money/credits already consumed;
- data that may remain with provider.

Example after deleting local project with prior cloud generation:
`Project đã được chuyển vào Thùng rác. Nội dung đã gửi tới dịch vụ bên ngoài có thể vẫn được lưu theo chính sách của dịch vụ đó.`

# 46. Folder/reparse-point import UX

Folder pre-scan shows:
- file count;
- total size;
- unsupported/suspicious entries;
- symbolic link/junction/reparse-point exclusions.

Default does not follow filesystem redirections outside selected root.

User is not shown low-level reparse terminology unless they inspect details.

# 47. Media conform / relink UI

Offline media card:
`Không tìm thấy file nguồn`

Actions:
- Tìm tự động bằng fingerprint/hash
- Chọn thư mục mới
- Bỏ qua tạm thời

Conform detail can show:
- reel/source ID;
- source timecode;
- proxy ↔ original mapping.

# 48. UI architecture saturation test

Before a new workspace/component is approved, test:
- first-time user can identify primary action;
- intermediate user can find override;
- expert can inspect exact implementation;
- slow operation is visible;
- stale/conflict state is visible;
- user can tell whether CineForge needs them;
- irreversible effect is explicit;
- keyboard/focus works;
- vi-VN copy is natural;
- technical details are not required for normal completion.

If a workflow passes only in Expert mode, normal UX is incomplete.


# 49. Learning / Improvement UI (Advanced)

This area is hidden from normal creative flow.

Sections:
- Failure Lake
- Golden Examples
- Benchmarks
- Shadow Runs
- Promotion Candidates
- Systemic Monitors

Rules:
- no “Self-improve now” button;
- production feedback is shown as evidence, not automatic truth;
- promotion screen clearly separates current production version vs candidate;
- blind comparison preferred where applicable;
- rollback target shown before promotion.

## PromotionCandidateCard
Shows:
- component/evaluator/router version;
- benchmark coverage;
- golden-set result;
- shadow result;
- out-of-domain failures;
- systemic-monitor warnings;
- human review status;
- rollback target.

Primary action only appears when governance gates pass.

## SystemicMonitorPanel
Shows warnings such as:
- provider concentration rising;
- repair oscillation;
- fallback oscillation;
- evaluation mix-shift;
- creative-style convergence;
- starvation/resource imbalance.

These are warnings about system behavior, not automatic proof of quality failure.

# 50. Provider Terms UI (Advanced / Rights)

Connection detail includes:
- current terms snapshot date;
- whether legal review is required;
- historical terms used by prior executions.

Release readiness can surface:
`Điều khoản của một dịch vụ đã thay đổi kể từ khi nội dung được tạo. Cần xem lại trước khi phát hành.`

Do not force ordinary users to read provider legal text during every generation; only surface it when policy/rights requires action.


# 51. Creative Variant UI

VariantCompareBoard supports:
- create A/B direction from an explicit base revision;
- label candidates in human language;
- side-by-side/blind comparison where useful;
- compare exact revision/dependency context;
- show downstream impact before promotion;
- promote one candidate without deleting alternatives;
- archive losing variants later.

Common entry points:
- Character: Tạo biến thể
- Scene/Shot: Thử hướng khác
- Timeline: Tạo nhánh dựng
- Style/Audio: Tạo phương án

The UI must always show which revision is the base and which candidate, so experimentation cannot silently replace Canon.


# 52. First-run storage location clarification

Do not present one ambiguous “Nơi lưu dữ liệu” picker that silently places every storage class together.

Default simple UX may still look like one setup step, but CineForge internally chooses safe roots:
- Core database: supported local fixed storage;
- media library: local default, user may relocate;
- models/cache: local high-capacity root;
- backup/export: user-configurable.

If user selects a network/synced/removable location for general media:
- do not silently move live SQLite WAL there;
- explain that project media can use that location while CineForge's active database stays in a safe local location.

Advanced storage settings expose roots separately.

# 53. Connection automation permission UI

Connection status separates:
- technical health;
- authentication;
- quota/capacity;
- automation permission.

Examples:
- “Sẵn sàng · Tự động được phép”
- “Sẵn sàng · Chỉ dùng có hỗ trợ”
- “Sẵn sàng · Thao tác thủ công”
- “Cần xem lại điều khoản”

Do not show a green “Ready” card that implies browser automation is permitted when policy state is UNKNOWN/BLOCKED.


# Extreme hardening extension

UI behavior for recovery reconciliation, storage pressure, secure URL import, reauthentication, manual ownership, bulk fanout, durable provider materialization, dependency review, backup resilience and other extreme-hardening cases is governed by `docs/design/EXTREME_HARDENING_CONTRACTS.md` plus the architecture invariants. Keep normal UX intent-first; expose technical detail progressively.



# 61. URL import security UX

When a pasted URL is blocked, normal users see:
- “CineForge không thể truy cập địa chỉ này một cách an toàn.”
- concise reason category;
- no encouragement to disable network protections.

Advanced detail may show redirect/private-network diagnostics.

# 62. Dependency change UX (Advanced / Development)

When CineForge/agent needs a new library/runtime dependency, the change view shows:
- package/source;
- version;
- why needed;
- license;
- security/advisory state;
- install/build scripts;
- release/SBOM impact.

Do not hide executable dependency additions inside an unrelated feature review.

# 63. Integrity warning UX

If Core detects canonical/audit inconsistency:
`CineForge phát hiện dữ liệu nội bộ không khớp và đã hạn chế một số thao tác để bảo vệ dự án.`

Actions:
- Xem phạm vi ảnh hưởng
- Chạy đối chiếu
- Khôi phục từ checkpoint if applicable

Do not offer a blind “Fix automatically” when authority is ambiguous.

# 64. Connection identity mismatch UX

Example:
`Bạn đã đăng nhập, nhưng tài khoản/workspace hiện tại khác với workspace đã cấu hình cho kết nối này.`

Actions:
- Đăng nhập đúng workspace
- Cập nhật cấu hình connection (requires appropriate authority)
- Tạm dừng connection

Do not silently continue merely because authentication succeeded.

# 65. Bulk action scope UX

Bulk confirmation displays a frozen scope:
`Duyệt 87 mục`

If the list changes after confirmation:
- the original 87 remain the action scope;
- newly arriving items stay unselected;
- if existing selected revisions changed materially, show stale-scope handling before execute.

# 66. External source change UX

If an externally linked source changes after approval:
`File nguồn đã thay đổi kể từ lần CineForge duyệt trước.`

Actions:
- Xem thay đổi
- Tạo revision mới
- Relink correct file

Do not silently replace approved bytes behind the same asset revision.



# 67. Recovery external-reality UX

If a full restore cannot prove what happened in external services:
`CineForge đã khôi phục dữ liệu cục bộ nhưng chưa thể xác nhận toàn bộ thao tác đã xảy ra trên các dịch vụ bên ngoài.`

Show:
- which providers/actions are uncertain;
- possible duplicate charge/upload/publication risk;
- automatic reconciliation attempts;
- only necessary human decisions.

Do not offer “Tiếp tục tất cả” as a casual default.

# 68. Backup trust UX

Backup status separates:
- Nội dung đã kiểm tra
- Nguồn backup đã xác thực
- Đã mã hóa / Chưa mã hóa
- Cùng ổ với dữ liệu chính / Khác vùng lỗi
- Restore drill gần nhất

A green backup card requires the policy's required dimensions, not only a successful copy.

# 69. Cache eligibility UX

Normally invisible.

If a prior generated result cannot be reused because rights/privacy/policy changed, explain:
`Bản cũ vẫn được giữ trong lịch sử nhưng không còn đủ điều kiện để dùng cho tác vụ này.`

Do not tell users “cache lỗi” when the reason is legal/policy eligibility.

# 70. Callback/account mismatch UX

Connection diagnostic:
`Dịch vụ đã gửi phản hồi hợp lệ nhưng phản hồi thuộc tài khoản/workspace khác với kết nối hiện tại.`

The affected job remains unresolved/quarantined until reconciled.


# UI-CORE-OWNERSHIP-01. Core ownership conflict UX

If another CineForge Core already owns the same database/library:
`Dự án đang được một phiên CineForge khác sử dụng.`

Actions depend on evidence:
- Mở chỉ đọc
- Chuyển tới phiên đang hoạt động
- Kiểm tra phiên cũ đã dừng
- Khôi phục quyền sở hữu (only after safe stale-owner verification)

Never offer an unconditional “Force unlock”.

# UI-UPDATE-TRUST-01. Anti-rollback/update trust UX

If user selects an older signed package/version that policy blocks:
`Phiên bản này đã bị chặn vì lý do bảo mật hoặc không còn tương thích.`

Advanced detail shows:
- version;
- key/signature status;
- revocation/trust-floor reason.

Do not equate “signature valid” with “safe to install”.

# 71. Stale decision UX

If an approval/delete/publish plan changed after confirmation:
`Nội dung đã thay đổi kể từ lúc bạn xác nhận.`

Show:
- what changed;
- old vs new affected count/scope;
- whether cost/rights/public visibility changed.

Primary action:
`Xem lại và xác nhận mới`

Never silently extend the prior approval to new items.

# 72. Security/AV interference UX

When write/package failure evidence points to Windows security tooling:
- explain that CineForge did not detect data corruption automatically;
- show affected path/component without exposing secrets;
- offer retry after user/security policy resolution;
- avoid destructive “repair storage” as the default action.




# 73. Shared connection incident UX

When many tasks are blocked by the same login/account problem, show one incident:

`Google Flow cần đăng nhập lại · 127 tác vụ đang chờ`

Actions:
- Đăng nhập lại
- Tạm dừng kết nối
- Xem tác vụ bị ảnh hưởng

Do not create 127 identical MFA notifications.

# 74. Long maintenance UX

Migration/index rebuild/library move shows real phases/checkpoints:
- Đang chuẩn bị
- Đang sao lưu checkpoint
- Đang xử lý …
- Đang kiểm tra
- Hoàn tất

If safely resumable:
`Bạn có thể đóng giao diện; CineForge sẽ tiếp tục/khôi phục từ checkpoint.`

If force-close is dangerous, explain why without fake percentage.

# 75. Worker stalled UX

Normal user sees:
`Tác vụ này chưa có tiến triển trong thời gian bất thường. CineForge đang kiểm tra và sẽ thử khôi phục an toàn.`

Advanced:
- heartbeat;
- last semantic checkpoint;
- worker/resource state.

Do not call a heartbeat-only worker “healthy”.

# 76. Observability/storage debt UX

Logs/audit normally stay hidden.
Only when action is useful:
`Dữ liệu chẩn đoán đang chiếm nhiều dung lượng. CineForge đã tự giới hạn log tạm thời; dữ liệu kiểm toán quan trọng vẫn được giữ.`

Storage cleanup must distinguish:
- disposable debug logs;
- retained audit/security evidence.

# 77. Rebuild/index UX

Users continue using the old verified index/projection while a new generation builds when safe.

Do not expose partial rebuild results as if canonical.
If rebuild is required for correctness, relevant query features show:
`Đang xây lại chỉ mục an toàn — kết quả mới chưa được dùng.`




# 78. Production tree / Series UX

For series/multi-deliverable projects, Project navigation can show:

```text
Series
  Season 1
    Episode 1
    Episode 2
  Season 2
```

Each node shows:
- current canon baseline;
- release state;
- inherited policies;
- unresolved impact.

Users do not manage raw revision IDs; they see “Dùng canon đã khóa cho Episode 4”.

# 79. Narrative Context UX

Continuity workspace exposes context only when needed:
- Mạch chính
- Hồi tưởng
- Giấc mơ
- Giả định
- Nhánh khác
- Vòng lặp

Scene shows two concepts separately:
- xuất hiện ở đâu trong phim;
- xảy ra khi nào/trong nhánh nào của câu chuyện.

Changing context/chronology previews continuity impact.

# 80. Casting workspace

Character page gains `Diễn viên / Thể hiện`.

Shows by scope:
- on-camera performer;
- voice/dub;
- stunt/body double;
- mocap;
- face/reference source;
- digital representation.

Rights/consent warning attaches to the real performer binding, not the fictional character.

# 81. Live-action Shoot / DIT workspace

Views:
- Shoot Days
- Slates/Takes
- Camera/Audio Rolls
- Card Ingest
- Sync
- Notes

Take card:
- slate/take;
- cameras/audio present;
- checksum/ingest state;
- director preference;
- continuity note;
- sync verification.

Original camera media is visually distinguished from proxy/editorial derivatives.

# 82. Multicam Sync UX

Sync group shows:
- clips/cameras/recorders;
- timecode/waveform/manual method;
- offset/drift;
- confidence/evidence;
- conflict markers.

If metadata disagrees:
`Slate và metadata camera không khớp — cần xác nhận trước khi gắn Take.`

# 83. Documentary Sources workspace

Tabs:
- Sources
- Interviews
- Fact Claims
- Quotes
- Rights/Releases

FactClaimCard shows:
- claim;
- supporting/contradicting sources;
- verification state;
- source snapshot;
- where used in timeline.

# 84. Documentary quote review

Review player shows:
- exact used quote;
- source context before/after;
- timeline use;
- transcript;
- participant/release status.

Reviewer can mark:
- consistent;
- potentially misleading;
- misleading;
- approved exception with rationale.

# 85. Retcon/shared-canon UX

When updating shared series canon:
`Thay đổi này ảnh hưởng 3 episode đang sản xuất. 5 episode đã phát hành sẽ giữ canon lịch sử của chúng.`

Options:
- áp dụng cho future/current production;
- create explicit retcon note;
- inspect affected current shots.

No “update all history” default.



# UI-NUMERIC-01. Numeric/domain validation UX

Normal users see domain language:
- “Tốc độ khung hình của file này không hợp lệ.”
- “Khoảng thời gian bắt đầu/kết thúc bị lỗi.”
- “Thông số media quá lớn để xử lý an toàn.”
- “Đơn vị tiền tệ của chi phí này khác với ngân sách dự án.”

Advanced details may expose raw timebase/value/overflow evidence.

Never silently clamp malformed canonical media values without recording the normalization decision.

# UI-TIMECODE-01. Timecode/locale entry UX

Localized numeric entry may accept familiar locale input, but confirmation displays the normalized canonical interpretation for high-impact settings.

Timecode controls explicitly distinguish:
- frame rate;
- drop-frame/non-drop-frame;
- project start timecode.

Rights/date controls show timezone/boundary meaning when it can affect release eligibility.

# UI-SPREADSHEET-01. Spreadsheet export safety UX

Normally invisible.

If a user explicitly intends a formula-bearing spreadsheet, export settings distinguish:
- Text dữ liệu
- Công thức được tin cậy

Imported/untrusted project text defaults to literal cells.



# UI-STORAGE-INTEGRITY-01. Storage integrity UX

Normal users:
- “CineForge đang kiểm tra độ toàn vẹn của dữ liệu.”
- “Phát hiện 1 file quan trọng bị lỗi; đã tìm thấy bản sao an toàn để khôi phục.”
- “Một file gốc bị lỗi và chưa có bản sao an toàn.”

Advanced view may show hashes/storage objects/scrub evidence.

Do not call a redundant copy “backup an toàn” until it has been independently verified.

# UI-ENV-DRIFT-01. Environment drift UX

If a driver/OS/runtime update affects a certified capability:
`Môi trường máy đã thay đổi. CineForge đang kiểm tra lại khả năng tạo video local trước khi dùng cho shot quan trọng.`

Other unaffected work continues.

# UI-RELEASE-DURABILITY-01. Release durability UX

Release screen distinguishes:
- Đã render
- Đã kiểm tra file
- Đã lưu an toàn
- Sẵn sàng phát hành

A path existing on disk is never presented as “release ready” by itself.



# UI-DEPLOYMENT-01. Library opened on another machine UX

When CineForge detects that a library is not bound to the current deployment:

`Thư viện này đến từ một phiên CineForge khác.`

Ask intent:
- Chuyển sang máy này
- Khôi phục sau sự cố
- Tạo bản sao độc lập
- Mở chỉ đọc

Explain different consequences, especially external accounts/jobs.

Do not offer “Continue anyway” writable mode.

# UI-FORK-01. Fork UX

Independent fork summary:
- creative/media history copied;
- external connections disabled until rebound;
- scheduled publications/jobs not activated;
- browser sessions not trusted;
- new backup/execution namespace.

# UI-DEPLOYMENT-INCIDENT-01. Deployment incident UX

If possible duplicate deployment activity is detected:
`Có dấu hiệu cùng một thư viện đang hoạt động ở nhiều phiên triển khai.`

Show:
- which external actions are at risk;
- current local deployment identity;
- recovery/retirement options;
- avoid claiming CineForge can automatically stop an offline/fully cloned machine without remote authority.



# 86. Endpoint / Core identity incident UX

Normal users should not see pipe/port terminology.

If Desktop reaches an unexpected local Core:
`CineForge không thể xác nhận phiên xử lý cục bộ hiện tại và đã chặn thao tác ghi để bảo vệ dữ liệu.`

Actions:
- Thử kết nối lại
- Mở chỉ đọc
- Xem chẩn đoán

Never offer “connect anyway” for privileged mutation.

# 87. Proxy/network-route UX

Advanced Connection detail shows:
- effective route: Direct / System proxy / Explicit proxy / Enterprise managed;
- last verified;
- provider/account/region identity.

If route changes materially:
`Đường kết nối mạng của công cụ này đã thay đổi. CineForge cần kiểm tra lại trước khi tiếp tục gửi dữ liệu.`

# 88. Capture privacy UX

Capture controls always show:
- active source/device;
- recording indicator;
- elapsed time;
- project/purpose where useful.

On Stop:
- indicator changes to `Đang dừng…` until OS/device confirms closure;
- only then show `Đã dừng`.

If default device changes:
- do not silently switch for sensitive capture.

# 89. Deletion guarantee UX

Use precise language:
- Đã xóa khỏi CineForge
- Đã crypto-erase
- Đã cố gắng ghi đè
- Không thể xác nhận xóa vật lý
- Có thể còn bản sao ở dịch vụ/backup bên ngoài

Do not use one universal “Đã xóa an toàn”.

# 90. Maintenance / low-disk UX

Before a large maintenance operation:
`Tác vụ này cần thêm khoảng … dung lượng tạm thời và có thể làm chậm sản xuất.`

If reserve insufficient:
- Dọn an toàn
- Chọn lúc khác
- Đổi vị trí cache/temp where supported

Do not start VACUUM/rebuild and fail halfway merely because current free space is above zero.

# 91. Stale notification action UX

When user clicks an old native notification:
`Tình trạng đã thay đổi kể từ khi thông báo được gửi.`

Open the current Decision/Activity state instead of executing the historical action.

# 92. Resume reconciliation UX

After wake/hibernate:
`CineForge đang đối chiếu lại các tác vụ chạy trong lúc máy tạm nghỉ.`

User may continue local browsing where safe.
Cloud/browser retry buttons remain temporarily disabled until reconciliation completes.



# 93. Pricing / billing UX

Before a paid large dispatch, show when material:
- estimated spend;
- current pricing freshness;
- credits vs cash exposure;
- maximum approved exposure.

If provider price/credits changed beyond policy:
`Chi phí đã thay đổi kể từ lúc bạn xác nhận. CineForge cần bạn xem lại trước khi tiếp tục.`

Billing view separates:
- Đã ghi nhận
- Đang đối chiếu
- Refund đang chờ
- Điều chỉnh

Do not increase “available budget” from an unsettled refund without policy.

# 94. Rights effective-time UX

When a right expires/revokes:
- show exact effective time/territory in human language;
- show impact: future generation / publish / takedown / internal-only;
- avoid vague “license expired” when only one use purpose is blocked.

Publish confirmation always reflects current legal state.

# 95. Retention hold UX

Delete/cleanup impact can say:
`Không thể xóa vật lý mục này vì đang có yêu cầu giữ lại.`

Show:
- hold reason category;
- authority/source if user is allowed to see it;
- expiry/review date when applicable.

Do not imply the hold grants publication/use rights.

# 96. Portable Archive UX

Separate actions:
- Backup CineForge
- Xuất project portable

Portable archive wizard shows:
- app/schema compatibility;
- included media/evidence;
- external refs that will be materialized;
- excluded credentials/sessions;
- expected size.

Never expose a raw SQLite/database backup as the default portable handoff.

# 97. Archive compatibility UX

Opening old archive:
- compatible → normal import;
- migration required → show migration preview;
- missing codec/runtime → use durable reference representation if present;
- missing critical media → explicit degraded state.

No silent semantic migration of canon/timeline/rights fields.

# 98. Project clone/template privacy UX

Before clone/template:
`CineForge sẽ không sao chép tài khoản đăng nhập, browser session, lịch publish hoặc dữ liệu học dùng chung trừ khi bạn chọn rõ.`

Show cross-project refs/private assets that would otherwise leak outside closure.

# 99. Shared craft-memory UX

Default project experience does not expose an unexplained global-memory toggle.

When opting in:
- explain what examples/metadata may be shared across projects;
- show rights/privacy scope;
- allow later revoke/purge workflow.

# 100. Compensation readiness UX

Publication detail may show:
- Đã publish
- Có thể takedown
- Cần đăng nhập lại để takedown
- Platform không hỗ trợ xác nhận tự động

Do not claim “Có thể hoàn tác” merely because CineForge has a takedown button.



# 61. Release provenance UI

Advanced Release detail shows:
- exact source commit;
- build workflow/run;
- artifact digest;
- SBOM/compliance status;
- signing key/publisher;
- installer/update manifest version.

Normal user sees concise:
`Bản phát hành đã được xác minh`
or
`Bản phát hành chưa đủ bằng chứng để ký/phát hành`.

# 62. Update security UX

Update card distinguishes:
- Có bản cập nhật hợp lệ
- Bản cập nhật bị thu hồi
- Bản thấp hơn mức an toàn tối thiểu
- Không xác minh được thông tin thu hồi mới nhất
- Gói cập nhật không khớp bản đang cài

Never collapse all failures into “Update failed”.

# 63. Installer/uninstall impact preview

Before uninstall/repair:
- app components to remove/replace;
- shared runtime/components retained;
- user projects/media explicitly preserved;
- settings/security policy preserved or migrated;
- reboot/admin requirement.

The UI must never suggest that uninstalling CineForge deletes project media by default.

# 64. Offline installer warning

When revocation freshness is stale:
`Chữ ký hợp lệ, nhưng máy này không thể kiểm tra thông tin thu hồi mới nhất.`

Policy may:
- continue;
- require network;
- block.

Do not label this as equivalent to fully current online verification.



# 65. Privacy purge UX

Delete/Purge progress separates:
- Đã xóa khỏi project
- Đang dọn thumbnail/cache/index
- Bản sao backup đang được giữ theo chính sách
- Dữ liệu đã từng gửi ra dịch vụ ngoài
- Hoàn tất trong phạm vi chính sách hiện tại

Never show “đã xóa hoàn toàn mọi nơi” unless policy/evidence can actually support it.

# 66. External exposure view

Privacy/Project detail can show:
`Dữ liệu từng được gửi ra ngoài`

Per entry:
- destination/provider;
- data class;
- date;
- purpose;
- known provider retention/takedown status.

This remains auditable after local purge according to retention policy.

# 67. Semantic search privacy

Search results never display cross-project content merely because semantic similarity is high.

When shared-library search is enabled:
- current scope is visible;
- shared result provenance/project is visible;
- permissions are checked before preview.

# 68. Model/session isolation status

Advanced Diagnostics may show:
- runtime isolation class;
- current project/session scope;
- last reset;
- TAINTED/RESET_REQUIRED state.

Normal users see:
`AI runtime đang được làm sạch trước khi chuyển sang project khác.`

# 69. Learning derivative revocation UX

When a rights/privacy revocation affects a trained derivative:
`Nội dung này đã được dùng trong một mô hình/tập học trước đó.`

Show possible actions:
- Ngừng sử dụng mô hình này
- Yêu cầu tái huấn luyện
- Xem phạm vi ảnh hưởng

Do not falsely claim one-click deletion “unlearned” the model.

# 70. Core ownership UX

If another valid Core already owns the library:
`CineForge đang chạy ở phiên khác. Cửa sổ này sẽ kết nối vào phiên đang hoạt động.`

If writer ownership is uncertain:
`Không thể xác nhận phiên ghi dữ liệu. CineForge đang mở ở chế độ bảo vệ cho đến khi đối chiếu xong.`

No second writer startup retry loop.

# 71. Archive read-only UX

Banner:
`Đây là bản lưu trữ đã niêm phong. CineForge sẽ không thay đổi nội dung gốc.`

Actions:
- Xem
- Kiểm tra
- Tạo bản làm việc mới

Never “upgrade this archive in place”.

# 72. Notification privacy

Settings:
- Hiện đầy đủ
- Ẩn nội dung khi máy khóa
- Chỉ báo chung

Decision notifications still remain actionable after unlock/revalidation; privacy mode never removes the underlying Needs You item.



# 73. Offline collaboration UX

When offline:
`Bạn đang làm trên một nhánh cục bộ. Thay đổi sẽ được đối chiếu khi kết nối lại.`

Do not say “Đã đồng bộ”.

Reconnect states:
- Đang đối chiếu
- Có thể nhập tự động
- Có xung đột cần bạn xử lý
- Quyền truy cập đã thay đổi
- Project đã bị lưu trữ/xóa trong khi bạn offline

# 74. Collaboration conflict workspace

Show side-by-side:
- base;
- thay đổi của bạn;
- bản hiện tại;
- affected timeline/story/canon scope;
- why automatic merge is unsafe.

Resolution actions:
- Giữ bản hiện tại
- Áp dụng thay đổi của tôi lên bản mới
- Chọn từng phần
- Lưu nhánh của tôi thành biến thể
- Bỏ nhánh

No generic “Use Mine / Use Theirs” when semantic invariants are involved.

# 75. Permission revoked while offline

Message:
`Quyền của bạn đã thay đổi từ lần kết nối trước. Thay đổi cục bộ vẫn được giữ, nhưng CineForge không thể ghi chúng vào project hiện tại.`

Options depend on policy:
- export branch;
- request access;
- discard local branch.

# 76. Concurrent approval conflict UX

If another user approved first:
`Một bản khác đã được duyệt trước khi thao tác của bạn hoàn tất.`

Show current approved revision vs user's candidate.
Do not silently replace either side.

# 77. Collaboration privacy indicator

If collaboration transport is cloud-based:
- project privacy eligibility visible;
- LOCAL_ONLY blocks cloud sync;
- shared/local mode clearly distinguished.

Normal editing UI should not imply “offline/local” when background collaboration is transmitting data.



# 78. Browser connection security UX

Connection detail separates:
- Browser/runtime health
- Account/workspace identity
- Login state
- Automation permission
- Semantic site compatibility

Examples:
- `Sẵn sàng · đúng workspace`
- `Cần đăng nhập lại`
- `Đang dùng nhầm workspace`
- `Website đã thay đổi · cần kiểm tra connector`
- `Profile bị cách ly`

Do not collapse these into one green/red dot.

# 79. Browser auth challenge UX

When login/MFA/CAPTCHA appears during a job:
`CineForge cần bạn xác nhận tài khoản. Tác vụ tạo nội dung chưa được tự động chạy lại.`

The UI distinguishes:
- generation still running;
- generation state unknown;
- generation definitely failed.

Replacement generation is not the default response to an auth challenge.

# 80. Human takeover resume UX

After user hands control back:
`Đang kiểm tra lại trang, tài khoản và tác vụ trước khi tiếp tục…`

If mismatch:
`CineForge không thể tiếp tục tự động từ trạng thái hiện tại.`

Show:
- expected provider/account/workspace;
- observed mismatch;
- safe actions: return to expected page, reconcile, cancel.

# 81. Browser download safety UX

Downloaded provider result first appears as:
- Đang tải
- Đang xác minh
- Sẵn sàng

Executable/script/unsupported downloads never receive “Mở/Chạy tự động”.
Unexpected content type is quarantined with human-readable reason.

# 82. Browser diagnostics privacy

Advanced diagnostic capture explains:
- screenshot/DOM/network metadata may contain account/project data;
- default capture is minimal/redacted;
- full diagnostic capture is explicit and time-limited.

Profile recreation:
`CineForge sẽ tạo profile sạch. Bạn có thể cần đăng nhập lại; project/media không bị xóa.`



# 83. QC uncertainty UX

Never render UNKNOWN/OUT_OF_DOMAIN as a green success.

Examples:
- `Chưa thể đánh giá đáng tin cậy`
- `Bộ kiểm tra này chưa được hiệu chuẩn cho phong cách/điều kiện này`
- `Đã kiểm tra 20% khung hình theo chiến lược lấy mẫu`

Advanced detail shows evaluator/version/calibration/coverage.

# 84. Human review anti-anchoring

For configured review classes:
- hide AI score until reviewer submits first verdict;
- mix random unflagged samples with flagged samples;
- show AI/evaluator evidence afterward for reconciliation.

Do not place one giant “92/100” score next to the Approve button when it would bias judgment.

# 85. QC coverage visualization

Review can display:
- Full scan
- Sampled
- Event-triggered
- Adaptive

Timeline overlay shows checked/unobserved ranges when useful.
User can understand that sampled PASS is not identical to whole-master proof.

# 86. Post-QC mutation warning

If export/mux/transcode/edit changed approved bytes:
`Bản này đã thay đổi sau lần kiểm tra trước. Cần xác minh lại trước khi phát hành.`

Do not silently preserve old green badges on the new artifact.

# 87. Benchmark/golden integrity UX

Advanced Learning screen surfaces:
- corrupt/quarantined examples;
- rights-blocked examples;
- hidden holdout health;
- benchmark set revision changes.

Promotion button remains unavailable while required benchmark integrity is not satisfied.



# 88. Provenance/authenticity UX

Avoid one global badge “Verified”.

Show dimensions:
- Byte/file matched
- Internal lineage
- External signature
- Signer trust
- Rights/use permission
- Public-platform verification

Possible labels:
- Đã xác minh nguồn nội bộ
- Có chữ ký nhưng signer chưa được tin cậy
- Thiếu bằng chứng nguồn
- Bằng chứng nguồn đang xung đột
- Quyền sử dụng hợp lệ / chưa đủ thông tin

# 89. Publication provenance UX

Release detail separates:
- Master đã duyệt
- File thực tế đã upload
- Bản công khai sau xử lý của nền tảng

If platform derivative cannot be fetched:
`File upload đã được xác minh; CineForge chưa thể xác minh byte cuối cùng mà nền tảng phát cho người xem.`

# 90. Provenance privacy export

Before exporting/sharing provenance:
show whether package includes:
- creator identity;
- device;
- location;
- timestamps;
- internal project IDs.

Provide privacy-minimized export where policy permits.

# 91. Provenance conflict UX

When external signed metadata conflicts with internal lineage:
- show both evidence sources;
- explain exactly what conflicts;
- avoid auto-picking newest;
- offer review/reconciliation.

Media remains usable as candidate unless another policy blocks it.



# 61. Structured document import preview

Document import distinguishes:
- File ingested
- Text/structure parsed
- Meaning mapped into project
- Mapping accepted

These are separate milestones.

## SemanticCoveragePanel
Shows human language such as:
- “Đã đọc: nội dung hiển thị, bảng, ghi chú”
- “Chưa đọc được đầy đủ: biểu đồ và Pivot”
- “Có 2 sheet ẩn”
- “File có macro/đối tượng nhúng — CineForge không chạy chúng”
- “Giá trị công thức có thể đã cũ”
- “Một số đoạn OCR chưa chắc chắn”

Do not show one generic green “Imported” badge when semantic coverage is partial.

# 62. Spreadsheet mapping workspace

For Excel/CSV:
- sheet/table/range navigator;
- visible vs hidden state;
- merged-cell visualization;
- original cell coordinates;
- formula vs cached value;
- external link warning;
- date-system/locale/encoding interpretation;
- field mapping preview.

Critical mapping can be confirmed per table/range instead of flattening the entire workbook.

# 63. PDF/DOCX/PPTX review workspace

Preview can expose:
- page/slide;
- extracted text region;
- comments/notes/footnotes;
- track changes/current revision view;
- speaker notes;
- attachments/embedded objects inventory;
- form/signature status;
- OCR confidence overlays.

Unsupported channels are listed explicitly.

# 64. Protected/encrypted document UX

Use:
- “File cần mật khẩu”
- “File được bảo vệ”
- “Không thể xác minh chữ ký”
- “File bị lỗi”

as distinct states.

Password entry is scoped to the current import operation and clearly not stored unless a future explicit secure policy says otherwise.

# 65. Document active-content warning

Macros/OLE/DDE/PDF actions/external data refresh are never executed in preview/import.

UI message:
“CineForge phát hiện nội dung có thể chạy hoặc tải dữ liệu bên ngoài. Nội dung này đã bị vô hiệu hóa; bạn vẫn có thể xem dữ liệu an toàn mà CineForge đọc được.”

# 66. Structured import confidence

When OCR/layout/semantic parse is uncertain:
- highlight affected range/page/field;
- show original beside parsed result;
- allow accept/correct;
- do not force user to review high-confidence regions one by one.

The goal is targeted human judgment, not making the user manually reconstruct the document.
