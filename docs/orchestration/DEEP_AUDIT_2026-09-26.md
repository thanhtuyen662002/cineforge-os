# CineForge OS — Deep Cross-Role Audit 2026-09-26

> Scope: all architecture, detailed design, GitHub orchestration, templates and current repository enforcement.
> Method: product architect, filmmaker, Windows/platform engineer, DB/storage engineer, media engineer, security engineer, GitHub administrator, Planner, Builder, Reviewer, Integrator, QA/CI, Flow Governor, scheduled-runtime operator and incident/recovery perspectives.

# Executive result

The overall architecture remains strong, but the audit found a set of latent risks that become important only under real concurrency, a public GitHub control plane, or Windows/media-heavy production.

The highest-severity findings are not “missing roles”; they are places where a documented convention was being treated as if GitHub/Windows provided a stronger primitive than they actually do.

# P0/P1 findings

## F01 — Public GitHub prompt/control injection (P0)
Risk:
An external Issue/comment can look like an agent task/review/state event.

Impact:
Autonomous worker could execute attacker-authored instructions or accept fake review/control metadata.

Fix:
Mandatory trusted-control actor policy; external contributions remain untrusted inbox inputs.

## F02 — Concurrent Integrator merge race (P0)
Risk:
Two Integrators verify against the same main then both merge. The second merge's tested/reviewed base is no longer current.

Fix:
Single active Integrator/merge lease, or GitHub Merge Queue when available.

## F03 — Same-slot overlapping scheduled runs (P1)
Risk:
Overlap before first Draft PR can let one SLOT_ID start two separate tasks.

Fix:
Slot-run lease with append/re-read winner selection before mutation.

## F04 — Capacity Plan lost update/split brain (P1)
Risk:
GitHub Issue body update is not compare-and-swap; two control writers can overwrite plan versions.

Fix:
Append-only CAPACITY_PLAN_V2 chain using previous comment ID and deterministic conflict winner.

## F05 — Self-declared logical review identity (P1/security nuance)
Risk:
Different AGENT_INSTANCE_ID values written through one GitHub account are not cryptographic separation.

Fix:
Explicit review assurance levels. High-risk gate relaxation requires credential-independent or external assurance.

## F06 — Mutable task contract (P1)
Risk:
Issue acceptance/scheduling fields may change after a worker claims the task.

Fix:
contract_version/hash at claim and explicit contract revision/ACK.

## F07 — Orphan claim branch race (P1)
Risk:
Branch may exist briefly before Draft PR; Flow could incorrectly call it abandoned.

Fix:
two-cycle/grace observation before recovery/retire.

## F08 — WIP amplification from “never wait” (P1)
Risk:
Parking CI/review work and immediately claiming more work can flood CI/review and increase total lead time.

Fix:
global per-stage WIP limits/backpressure; when downstream saturated, workers review/fix/unblock instead of claiming more implementation.

## F09 — CI path filtering can miss semantic impact (P1)
Risk:
Changed files alone do not encode API/schema/runtime dependencies.

Fix:
CI tier selection uses diff + task risk/domain + dependency/contract impact. Unknown impact fails safe to broader testing.

## F10 — Privileged CI on public/fork code (P0 security)
Risk:
External PR code could execute on secrets/persistent self-hosted runners or poison caches.

Fix:
fork/untrusted separation, least privilege, no privileged pull_request_target checkout, ephemeral/self-hosted isolation and cache trust boundaries.

## F11 — Governance can weaken its own gate (P0)
Risk:
Until repo-native protection exists, an autonomous writer can modify AGENTS/workflows directly on main.

Fix:
bootstrap baseline lock; after lock governance/control files require HIGH-risk PR workflow and stricter non-retroactive gates.

## F12 — No repository-native enforcement yet (P1)
Observed:
rulesets absent; auto-merge disabled; branch protection admin not available via current integration.

Impact:
Correctness currently depends on protocol-following agents.

Fix:
treat repository protection as bootstrap blocker for broad autonomous scale, while Integrator protocol remains interim enforcement.

# Product/platform findings

## F13 — SQLite WAL placement not constrained enough (P1)
Risk:
First-run “data location” could put the active SQLite WAL DB on SMB/UNC/cloud-sync/removable/problematic filesystems.

Fix:
Core DB root defaults/requires supported local filesystem; assets/backups may live on other roots. Remote/sync paths require explicit support mode, not silent acceptance.

## F14 — Browser automation terms mode is not explicit enough (P1/legal/connector)
Risk:
A web product may be technically automatable but provider terms may not permit automated use.

Fix:
connection/provider policy records automation permission state. Unknown/blocked automation routes to assisted/manual mode rather than silent automation.

## F15 — Windows filesystem/export edge cases (P2)
Risks:
reserved names, long paths, case-insensitive collisions, Unicode normalization, removable/offline volumes.

Fix:
managed object store uses safe hash paths; export/handoff name sanitizer + collision manifest; storage volumes have capability/availability checks.

# Development-system findings

## F16 — Current repo is not operationally bootstrapped (P1)
Observed:
no open Tasks/PRs and no implementation CI/code skeleton.

Meaning:
the orchestration design is documented but has not yet been proven under live concurrent agents.

Fix:
BOOTSTRAP_READINESS sequence remains mandatory before scaling to many slots.

## F17 — Machine metadata parser/validator not implemented (P1)
Risk:
Templates exist, but no trusted parser/check currently proves agent_task/claim/review event syntax.

Fix:
Slice 0 control-plane tooling should include parser/validator/reconciliation tests.

## F18 — Dependency satisfaction can be semantically reverted (P2)
Risk:
Dependency Issue/PR merged, then later reverted or contract superseded.

Fix:
readiness/merge revalidates dependency contract/current main context; reverts create rework/staleness, not blindly “dependency was once merged”.

## F19 — Work chat identity collision (P1)
Risk:
multiple Work chats using SLOT_ID=WORK collide.

Fix:
stable unique WORK-<id> slot/agent identity.

## F20 — API/rate amplification at 15+ agents (P2)
Risk:
every worker broad-scans docs/issues/PRs each run.

Fix:
tiered context loading + control-plane broad scans + narrow builder scans + backoff.

# Architecture consistency findings

## F21 — Event/audit authority ambiguity
Status:
Already corrected in current docs: relational domain state is canonical; events are causality/audit, not competing pure event-source authority.

## F22 — Revision registry duplication ambiguity
Status:
Current schema now clarifies revision_registry owns shared physical revision metadata; typed revision tables should not duplicate it.

## F23 — UI event cursor unbounded retention
Status:
Current API now has cursor expiry/backpressure and projection refresh path.

## F24 — Creative branch/variant was implicit only
Status:
Current schema/state/API/UI now include explicit variant group/candidate compare/promote domain.

# Residual risks after fixes

Even with protocol hardening:
- one compromised write credential can still damage a public repo without native branch/ruleset enforcement;
- logical multi-agent independence through one GitHub credential is not an adversarial security boundary;
- GitHub itself is an external control-plane dependency;
- exact CI semantics depend on actual workflows once implemented;
- scheduling/backpressure thresholds require empirical tuning;
- unknown unknowns require live multi-agent chaos testing.

# Required validation before 10–15 slot scale

1. Create initial Epic + machine-readable Tasks.
2. Implement Tier A CI.
3. Exercise two agents racing one Task claim.
4. Exercise same-slot overlap lease.
5. Exercise Planner/Flow failover.
6. Exercise merge serialization with two merge-ready PRs.
7. Exercise malicious/untrusted public Issue/comment.
8. Exercise stale review/base drift.
9. Exercise orphan branch recovery.
10. Exercise CI/review backpressure and WIP limits.
11. Exercise GitHub partial failure.
12. Configure repository-native main protection when administration access permits.

# Conclusion

The design is suitable to proceed, but broad autonomous coding should not be scaled merely because more scheduled slots are available.

Scale should follow proven coordination primitives:
trust → claim → slot/control lease → CI → independent review → serialized/queued merge → reconciliation.

The next unknowns are primarily empirical concurrency failures, not missing conceptual roles.
