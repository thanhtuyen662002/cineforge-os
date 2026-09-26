# AGENTS.md — CineForge OS Coding Context

## Mission

CineForge OS là local-first Film Production OS, không phải một app AI video đơn lẻ.

Mỗi START/RESUME phải nạp context theo `docs/orchestration/CONTEXT_LOADING_PROTOCOL.md`.

Always-read tối thiểu:
1. `AGENTS.md`
2. Task Issue hiện tại; nếu resume thì Claim PR + latest structured state/review events
3. Capacity Plan nếu chạy scheduled mode và plan tồn tại
4. `docs/orchestration/FINAL_GITHUB_AGENT_OPERATING_MODEL.md` khi worker chưa có revision hiện tại trong run context

Sau khi chọn task, chỉ đọc authoritative architecture/design/risk docs được Issue yêu cầu hoặc Context Loading Protocol ánh xạ. Không được mặc định đọc toàn bộ repository mỗi run.

Control-plane roles phải đọc thêm khi thực hiện control work:
- `docs/orchestration/CAPACITY_CONTROL.md`
- `docs/orchestration/BOTTLENECK_PLAYBOOK.md`
- `docs/orchestration/FLOW_METRICS_AND_RECONCILIATION.md`
- CI/merge work: `docs/orchestration/CI_REVIEW_MERGE_PROTOCOL.md`


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

## GitHub orchestration non-negotiables

- Context loading phải theo tier; không reload toàn bộ risk/design corpus nếu task không cần.
- PR body giữ immutable initial claim metadata; live lease state/owner lấy từ latest valid structured PR state/takeover event.
- Review/CI evidence phải bind đủ verification context, không chỉ một head SHA khi base/main đã đổi.
- Planner/Flow/Integrator chạy reconciliation trước khi tạo duplicate/reassign/merge.

- GitHub Issues + Draft/Open PRs + exact-head CI là live development source of truth.
- Role != slot; một slot có thể mang nhiều role và role có thể do nhiều slot phục vụ.
- Task claim dùng deterministic branch + Draft PR lease; không duplicate live work.
- Worker không được ngồi chờ CI/review/dependency nếu còn independent READY work.
- Parked PR giữ ownership nhưng giải phóng execution capacity.
- Independent review phải dùng logical AGENT_INSTANCE_ID khác author.
- Planner duy trì bounded ready queue; không tạo backlog khổng lồ dễ stale.
- Flow Governor có trách nhiệm phát hiện/gỡ critical-path bottleneck, stale lease, review/CI congestion và hotspot.
- Integrator chỉ merge exact head sau đủ gate.
- Waiting/blocked state phải được checkpoint đủ để agent khác resume từ GitHub.
- Capacity Plan là single-writer guidance, không phải queue/lease truth.
- Work chat là opportunistic super-slot; không được giả định là scheduled capacity thường trực.
- Repo-native branch/ruleset guardrails hiện không được giả định đã bật; agent protocol phải tự tuân thủ cho tới khi enforcement được cấu hình.

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
