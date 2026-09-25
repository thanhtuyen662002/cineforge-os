# AGENTS.md — CineForge OS Coding Context

## Mission

CineForge OS là local-first Film Production OS, không phải một app AI video đơn lẻ.

Mọi implementation phải đọc:
1. docs/FOUNDATIONAL_RISK_REGISTER.md
2. docs/architecture/FOUNDATION.md
3. docs/architecture/CHARACTER_IDENTITY_SYSTEM.md

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

## Product rules

- UI mặc định vi-VN, en-US là locale thứ hai.
- Internal IDs/enums language-neutral.
- Simple by default, deep on demand.
- User intent first, machinery second.
- Technical metrics nằm trong Advanced trừ khi người dùng cần xử lý.
- Mọi lỗi phải nói rõ: CineForge tự xử lý / cần người dùng / không thể tiếp tục.
- Safe changes ưu tiên undo thay vì modal confirmation.
- Destructive/irreversible actions require explicit confirmation.

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

## Development sequencing

Không xây universal system toàn bộ trước khi có vertical slice.

Foundation:
- desktop/core;
- DB/event/audit;
- asset store;
- Universal Intake;
- Capability Fabric;
- jobs;
- character/voice/continuity baseline;
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
