# AGENTS.md — CineForge OS Coding Context

## Mission

CineForge OS là local-first Film Production OS, không phải một app AI video đơn lẻ.

Mọi implementation phải đọc:
1. docs/FOUNDATIONAL_RISK_REGISTER.md
2. docs/architecture/FINAL_ARCHITECTURE.md
3. docs/design/FINAL_DETAILED_DESIGN.md
4. docs/design/SCHEMA.md
5. docs/design/STATE_MACHINES.md
6. docs/design/API_CONTRACTS.md
7. docs/design/UI_COMPONENT_SYSTEM.md
8. docs/design/DETAILED_DESIGN_RED_TEAM.md
9. docs/architecture/RISK_COVERAGE_MATRIX.md
10. docs/architecture/CHARACTER_IDENTITY_SYSTEM.md
11. docs/architecture/USER_ACTION_AND_COVERAGE_GAP_ANALYSIS.md
12. docs/architecture/FOUNDATION.md

`docs/architecture/FINAL_ARCHITECTURE.md` là kiến trúc authoritative cho boundaries/invariants. `docs/design/FINAL_DETAILED_DESIGN.md` cùng SCHEMA/STATE_MACHINES/API_CONTRACTS/UI_COMPONENT_SYSTEM là authoritative cho implementation contracts. Risk/red-team docs vẫn là yêu cầu đối kháng bắt buộc. Khi có xung đột, không được tự chọn: phải cập nhật architecture + detailed design + risk/test liên quan trước khi code.

## Architectural non-negotiables

- Kernel owns project truth.
- Capability > provider.
- Provider/tool-specific fields không được rò vào canonical domain nếu không nằm trong extension namespace.
- Approved revisions immutable.
- Production không resolve "latest".
- UNKNOWN != PASS.
- Original assets immutable.
- Search/vector index không phải identity.
- UI/workers/connectors không ghi DB trực tiếp.
- Generated content là untrusted input.
- No arbitrary LLM shell execution.
- Cloud egress phải qua policy check.
- Rights/consent phải checked trước generation/training/release.
- Long-running operation phải expose human-readable state + needs_user + next_step.
- Không silent downgrade chất lượng khi fallback.
- Mọi external job/callback phải idempotent và stale-write safe.
- Mọi mutating user action phải có auditable Action/Command record.
- Bulk actions phải có explicit scope và impact analysis.
- Natural-language requests compile thành auditable commands; không mutate DB trực tiếp.
- Publish là irreversible boundary riêng, không đồng nhất với Export.
- Autosave không bao giờ đồng nghĩa với approval.

## Product rules

- UI mặc định vi-VN, en-US là locale thứ hai.
- Internal IDs/enums language-neutral.
- Simple by default, deep on demand.
- User intent first, machinery second.
- Technical metrics nằm trong Advanced trừ khi người dùng cần xử lý.
- Mọi lỗi phải nói rõ: CineForge tự xử lý / cần người dùng / không thể tiếp tục.
- Safe changes ưu tiên undo thay vì modal confirmation.
- Destructive/irreversible actions require explicit confirmation.
- Mọi long-running action phải nói rõ: đang làm gì, có cần user không, tiếp theo là gì.
- Không hiển thị “progress giả” nếu backend không có bằng chứng tiến độ thực.

## Character/voice rules

Không được implement Character như một table/object chứa image + voice_id + outfit.

Phải giữ tách:
- CharacterIdentity
- VisualIdentityPackage revision
- VoiceIdentityPackage revision
- PerformanceBible
- Costume state
- Prop state
- Story/continuity state

Shot phải pin snapshot revision cụ thể.

## Storage rules

Không auto-delete:
- originals;
- approved canon;
- release masters;
- required rights/provenance.

Cache/temp/rebuildable derivatives phải có lifecycle class và TTL.

Trước batch lớn phải estimate storage.

Cleanup phải dựa trên reference graph + retention policy, không dựa filename/folder heuristic.

## Connector rules

Supported execution classes:
- LOCAL_RUNTIME
- LOCAL_SERVICE
- CLI
- MCP
- API
- BROWSER_AUTOMATED
- BROWSER_ASSISTED
- WEB_MANUAL
- HUMAN

Mỗi connector phải khai báo:
- capabilities;
- health;
- execution/concurrency model;
- auth;
- privacy;
- rights constraints;
- cost model;
- version;
- reliability;
- inputs/outputs.

## User-action rules

Mỗi action làm thay đổi state phải xác định:
- intent;
- scope;
- preconditions;
- affected entities;
- dependencies becoming stale;
- cost/storage estimate nếu đáng kể;
- rights/privacy impact;
- cancel semantics;
- undo/compensation semantics;
- external side effects;
- human-readable progress;
- failure ownership.

Các thao tác chưa có contract rõ ràng không được implement ad-hoc trong UI.

## Development sequencing

Không xây universal system toàn bộ trước khi có vertical slice.

Foundation:
- desktop/core;
- DB/event/audit;
- asset store;
- Action/Command Engine;
- Universal Intake;
- Capability Fabric;
- jobs;
- character/voice/continuity baseline;
- canonical timeline baseline;
- review;
- deliverables;
- storage manager.

Sau đó ép hệ thống chạy một phim thật ngắn đầu-cuối và dùng failure thực tế để mở rộng architecture.

## Change discipline

Khi code mới làm thay đổi một invariant:
- dừng;
- cập nhật architecture/risk document trước;
- thêm migration/test;
- không silently reinterpret dữ liệu cũ.

Mọi schema/event/manifest public phải versioned.
