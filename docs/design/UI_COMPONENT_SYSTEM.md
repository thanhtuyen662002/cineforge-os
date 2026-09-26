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
