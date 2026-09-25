# CineForge OS — Product & System Architecture Foundation

> **Authoritative architecture:** `docs/architecture/FINAL_ARCHITECTURE.md`  
> Tài liệu này được giữ làm supporting foundation/history. Nếu có khác biệt, `FINAL_ARCHITECTURE.md` là nguồn chuẩn.

> Trạng thái: Pre-implementation architecture baseline  
> Ngôn ngữ sản phẩm mặc định: `vi-VN`; hỗ trợ `en-US`  
> Mục tiêu: xây CineForge OS như một hệ điều hành sản xuất phim local-first, vendor-neutral, có thể gắn thêm “tay chân” qua Local Runtime, CLI, MCP, API, Browser/Web và Human.

## 1. Nguyên tắc nền

1. CineForge Kernel sở hữu Project Truth, không provider/tool nào sở hữu sự thật của dự án.
2. Capability > Provider. Người dùng yêu cầu năng lực; hệ thống chọn chiến lược thực hiện.
3. Creative Intent > Prompt. Prompt chỉ là artifact biên dịch cho từng provider.
4. Original > Derived. File gốc không bao giờ bị sửa đè.
5. Approved Canon > Latest. Production luôn pin revision cụ thể, không chạy theo “latest”.
6. UI phải expose intent, không expose machinery mặc định.
7. Mọi trạng thái backend phải có diễn giải tiếng Việt dễ hiểu: đang làm gì, có cần người dùng không, bước tiếp theo là gì.
8. Local-first không đồng nghĩa local-only. Cloud/API/Web/MCP/CLI/Human đều là execution providers hợp lệ.
9. Không silent fallback làm giảm chất lượng hoặc vi phạm privacy/rights.
10. Mọi hành động irreversible phải có governance mạnh hơn hành động có thể undo.

## 2. Kiến trúc logic

```text
CineForge Desktop
  ├─ Home / Projects / Sáng tạo / Sản xuất / Hậu kỳ / Duyệt / Thư viện
  ├─ Activity + Needs You + Next Step
  └─ Advanced: Connections / Queue / Diagnostics / Storage / Settings

CineForge Kernel
  ├─ Project & Canon
  ├─ Character / Identity / Continuity
  ├─ Asset Graph
  ├─ Workflow & Production Strategy
  ├─ Capability Fabric
  ├─ Scheduler & Job Engine
  ├─ Evidence / QC
  ├─ Rights / Provenance
  ├─ Deliverables / Handoff
  ├─ Storage Lifecycle
  ├─ Notification / Activity
  └─ Audit / Event Log

Capability Fabric
  ├─ LOCAL_RUNTIME
  ├─ LOCAL_SERVICE
  ├─ CLI
  ├─ MCP
  ├─ API
  ├─ BROWSER_AUTOMATED
  ├─ BROWSER_ASSISTED
  ├─ WEB_MANUAL
  └─ HUMAN
```

## 3. Core execution model

Workflow node không được chứa provider cụ thể. Node biểu diễn intent, ví dụ:

- CREATE_CHARACTER_REFERENCE
- GENERATE_DIALOGUE
- GENERATE_VIDEO
- CREATE_MUSIC_CUE
- LIP_SYNC
- FACE_REPAIR
- COMPOSITE
- EDIT
- QC
- HUMAN_REVIEW

Production Strategy Engine quyết định phương án:
- direct text-to-video;
- image-to-video;
- 3D blocking → render → AI enhancement;
- live-action → VFX;
- performance audio → voice conversion;
- local draft → premium cloud final;
- human/manual handoff.

Mỗi decision phải lưu:
- strategy_id/version;
- tool/connector/revision;
- reason;
- alternatives considered;
- cost estimate/actual;
- policy checks;
- input dependency manifest.

## 4. Capability contract

Capability request tối thiểu gồm:
- semantic capability;
- required input/output types;
- quality tier;
- duration/resolution/language;
- identity/continuity requirements;
- editability requirement;
- latency/deadline;
- privacy policy;
- rights/commercial policy;
- budget;
- acceptable transports;
- preferred/fallback providers.

Connection health không phải boolean. Trạng thái phải tách:
- INSTALLED
- AUTHENTICATED
- AVAILABLE
- CAPACITY_AVAILABLE
- POLICY_ALLOWED
- HEALTHY
- DEGRADED
- HUMAN_ACTION_REQUIRED
- QUARANTINED

## 5. Universal Intake

Một vùng nhập chung phải nhận:
- text/clipboard;
- voice recording;
- image;
- video;
- audio;
- PDF/DOCX/TXT/MD;
- Excel/CSV;
- subtitle;
- folder;
- archive;
- URL;
- 3D/project files.

Pipeline:
```text
Receive
→ Quarantine if untrusted
→ Identify MIME/format
→ Hash
→ Inspect/decode
→ Extract metadata
→ Infer possible semantic roles
→ Ask only if ambiguous
→ Register ORIGINAL
→ Build derived proxies/indexes
```

Không được suy ra mục đích chỉ từ file type. Một image có thể là character reference, prop, style, first frame, storyboard hoặc asset thường.

## 6. Output & Deliverables

CineForge phải xuất được độc lập:
- candidate;
- approved shot;
- scene;
- sequence;
- full film master;
- image;
- voice/dialogue take;
- music cue;
- SFX;
- Foley;
- ambience;
- audio stems;
- subtitle SRT/VTT;
- transcript;
- reference frames;
- masks/depth/layers khi có;
- project handoff.

Deliverable intent:
- Preview
- Review Copy
- Final Master
- Social/Platform Delivery
- Individual Shots
- Audio Stems
- Subtitle Package
- Editorial Handoff
- Archive Package

## 7. Editorial interchange

Không giả định một NLE duy nhất.

CineForge timeline canonical phải độc lập editor. Có thể dùng/adapter theo các chuẩn interchange như OpenTimelineIO, AAF, EDL, FCP XML khi phù hợp. OTIO mô tả clips, timing, tracks, transitions, markers và metadata nhưng media được tham chiếu ngoài, nên CineForge phải duy trì media manifest riêng.

Handoff package luôn nên có:
- reference render;
- ordered source clips;
- audio stems;
- subtitles;
- timeline/interchange file nếu target hỗ trợ;
- manifest;
- frame rate/color/audio settings;
- provenance/rights summary cần thiết.

## 8. Storage lifecycle

Storage classes:
- ORIGINAL: không tự xóa.
- CANONICAL_APPROVED: không tự xóa.
- RELEASE_MASTER: không tự xóa.
- LEGAL_PROVENANCE: retention dài hạn.
- DERIVED_REBUILDABLE: có thể xóa và rebuild.
- CANDIDATE: giữ theo policy.
- FAILED_CANDIDATE: TTL/Failure Lake sampling.
- CACHE: TTL.
- TEMP: TTL ngắn.
- INSTALLER/UPDATE_CACHE: xóa an toàn.
- MODEL: user-controlled.

Storage Manager phải:
- dự đoán dung lượng trước batch lớn;
- ngăn chạy nếu dưới critical reserve;
- đề xuất safe cleanup;
- không “Clear Cache” mù;
- hỗ trợ move library transactionally;
- verify checksum sau move;
- phân biệt project/models/cache/temp/backups/exports;
- tính dung lượng thực sự giải phóng dựa trên reference graph;
- hỗ trợ Trash và retention;
- archive project theo policy.

## 9. Local database boundaries

Khởi đầu: SQLite WAL, chỉ CineForge Core được ghi.

UI/workers/tools không mở DB trực tiếp.

Domain data phải tách khỏi:
- search index;
- embeddings;
- thumbnails;
- caches;
- provider metadata.

Search/index là derived state, không phải source of truth.

## 10. Event/Audit model

Critical state dùng append-oriented event history:
- EntityCreated
- RevisionCreated
- RevisionApproved
- DependencyChanged
- GenerationRequested
- AttemptStarted
- ArtifactReceived
- QCEvaluated
- HumanReviewed
- CanonChanged
- RightsRevoked
- ReleaseCreated

Materialized current state có thể rebuild/reconcile từ authoritative events + snapshots.

## 11. UI state contract

Mọi long-running task phải expose:
- WHAT: đang làm gì;
- WHY: vì sao làm;
- STATE: đang ở bước nào;
- NEEDS_USER: có cần người dùng không;
- NEXT: tiếp theo là gì;
- IMPACT: lỗi này chặn cái gì;
- CANCEL: có hủy được không;
- REVERSIBILITY: có undo được không.

Các trạng thái người dùng thấy:
- Đang chuẩn bị
- Đang xử lý
- Đang chờ
- CineForge đang tự xử lý vấn đề
- Cần bạn quyết định
- Không thể tiếp tục
- Hoàn tất

## 12. Bilingual rules

Internal enum/id luôn language-neutral:
- APPROVED, BLOCKED, STALE...

UI mapping:
- vi-VN: Đã duyệt, Bị chặn...
- en-US: Approved, Blocked...

Creative text:
- ORIGINAL language luôn canonical;
- translation/provider prompt là derived artifact;
- không overwrite bản gốc;
- mọi translation quan trọng có provenance và revision.

## 13. Installer/update architecture

Windows:
- Tauri 2 desktop shell;
- Rust Core;
- NSIS Setup.exe + optional MSI;
- signed Windows binaries/installer;
- updater signature riêng;
- runtime/tool/model packs update độc lập.

Provisioner cài capability packs theo nhu cầu, không ép tải mọi model trong installer.

Core/Connector/Runtime/Model update tách riêng.
Production có thể pin connector/runtime/model revision.

## 14. Không được làm

- Không để LLM chạy shell tùy ý.
- Không để Web/MCP/API/CLI truy cập DB trực tiếp.
- Không hard-code provider vào domain model.
- Không cho web consumer UI trở thành dependency bắt buộc.
- Không silent upload confidential asset lên cloud.
- Không mutate approved revision.
- Không auto-delete original/canonical/master.
- Không coi AI score là quality truth.
- Không mặc định một nhân vật = một ảnh + voice_id.
