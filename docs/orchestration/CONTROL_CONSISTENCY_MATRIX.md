# CineForge OS — Cross-Control Consistency Matrix

> This is a reconciliation index, not a second product specification. Each row names the authoritative owner that defines the behavior and records the precedence, state transition, user effect and negative/chaos case used to test the interaction. If an owner changes, update the owner document first and then this index.

## Resolution rule

When two controls appear to disagree, the stronger safety property wins in this order:

1. legal/rights/privacy and explicit human authority;
2. immutable identity, provenance and current authorization/revocation;
3. durable recovery/financial integrity and external-side-effect truth;
4. availability, throughput and convenience.

An interaction that cannot establish its winner becomes `UNKNOWN` or
`NEEDS_HUMAN`; it never guesses a lower-risk state.

## Interaction rows

| ID | Apparent conflict | Precedence and authoritative owner | State transition | User-visible effect | Negative/chaos test |
| --- | --- | --- | --- | --- | --- |
| CC-01 | Approved/original immutability vs deletion or purge | Preserve immutable bytes and provenance; apply tombstone, retention class and policy-authorized crypto-erasure through `EXTREME_HARDENING_CONTRACTS.md#N7`, `#FQ`, `#S2` and `SCHEMA.md#SCHEMA-PRIVACY-PURGE-COORDINATION`. | `ACTIVE/APPROVED` → `TOMBSTONED/PURGE_PENDING` → `PURGED` only after the required barrier; retained evidence stays read-only. | Explain what disappeared from the project, what must remain for rights/audit, and whether external copies are still unknown. | CT-30 |
| CC-02 | Audit retention vs privacy minimization | Retain the smallest redacted security/rights receipt required by policy; purge payloads and derivatives. Owners: `EXTREME_HARDENING_CONTRACTS.md#CM`, `#CE`, `#AT`. | `RETAINED_REDACTED` or `PURGE_PENDING`; never claim full erasure while a required evidence class remains. | Separate “đã xóa khỏi project” from retained exposure/audit evidence. | CT-29, CT-30 |
| CC-03 | Restore vs forward deletion/revocation | Forward journal/recovery epoch dominates restored stale state. Owners: `EXTREME_HARDENING_CONTRACTS.md#B1`, `#S2`, `#DU`; `STATE_MACHINES.md#STATE-PRIVACY-PURGE`. | `RESTORING` → `RECOVERY_RECONCILIATION`; stale rows become `BLOCKED_BY_POLICY/TOMBSTONED`. | Restore pauses with a reconciliation explanation; no silent resurrection. | CT-10, CT-11, CT-30 |
| CC-04 | Offline operation vs fresh trust/authority | Offline drafts may be preserved; irreversible, rights, credential and publish actions require current Core authority. Owners: `EXTREME_HARDENING_CONTRACTS.md#AX`, `#EL`, `#NP`; `API_CONTRACTS.md#API-OFFLINE-IRREVERSIBLE-ACTION`. | `OFFLINE_DRAFT` → `AUTHORITY_REVOKED/IMPORT_AS_BRANCH_REQUIRED` or `READY_TO_SYNC` after revalidation. | Keep local work and show request-access/export/discard choices. | CT-38 |
| CC-05 | Local-only privacy vs web/API fallback | The selected privacy profile is a hard egress boundary; capability fallback cannot cross it. Owners: `EXTREME_HARDENING_CONTRACTS.md#D4`, `#D5`, `#N6`. | `LOCAL_ONLY` → `POLICY_BLOCKED` when only a remote capability remains; no downgrade. | Say that the action cannot continue locally and offer an explicit local alternative. | CT-18, CT-21 |
| CC-06 | Cache/index reuse vs rights change | Current authorization/rights generation fences every read and use; cache identity is scoped. Owners: `EXTREME_HARDENING_CONTRACTS.md#O1`, `#O4`, `#AW`, `#HI`. | `ACTIVE` → `STALE/PURGE_PENDING/BLOCKED_BY_POLICY` on generation change. | Explain why a previously generated result is unavailable and what can be rebuilt. | CT-29 |
| CC-07 | Manual human lock vs late AI repair | Human lock/current revision wins; AI output remains a candidate. Owners: `EXTREME_HARDENING_CONTRACTS.md#G1`, `#BM`, `#KU`; `STATE_MACHINES.md#STATE-POST-QC-MUTATION` when applicable. | `MANUAL_LOCKED` + `STALE_CANDIDATE`; explicit review may create a new revision. | Preserve the edit and show the late result separately. | CT-28 |
| CC-08 | Immutable release vs emergency revocation | Release bytes/manifests remain immutable; revocation blocks activation/publication and uses a compensating/takedown action. Owners: `EXTREME_HARDENING_CONTRACTS.md#AD`, `#DP`, `#DY`, `#GH`. | `PUBLISHED/ACTIVE` → `REVOKED/COMPENSATION_REQUIRED`; never rewrite the original manifest. | Show public status, revocation reason and what compensation is still unverified. | CT-31, CT-39 |
| CC-09 | Reproducible build vs environment-specific signing | Build must be reproducible and hermetic; signing attests the exact final bytes plus signer/environment identity. Owners: `EXTREME_HARDENING_CONTRACTS.md#N4`, `#AC`, `#Y3`, `#Y4`, `#MF`. | `BUILD_ATTESTED` → `SIGNING_BLOCKED` on digest/environment mismatch. | Release remains blocked with the exact provenance difference. | CT-32, CT-34, CT-36 |
| CC-10 | No-wait throughput rule vs WIP limits/backpressure | Global WIP/backpressure controls whether another task may be claimed; a parked worker can switch to review/unblock work. Owners: `FLOW_METRICS_AND_RECONCILIATION.md#11`, `#FLOW-CRITICAL-PATH`, `CAPACITY_CONTROL.md#6`. | `WAITING_*` → `PARKED_*` or `REDIRECTED_TO_REVIEW`; no unbounded new WIP. | Explain the blocker and next action without fabricating progress. | CT-02, CT-04 |
| CC-11 | Retries vs uncertain external side effects | Stable idempotency and unknown-outcome reconciliation precede retry. Owners: `EXTREME_HARDENING_CONTRACTS.md#O2`, `#BG`, `#OL`; `CONTROL_PLANE_TRUST_AND_CONCURRENCY.md#CTRL-MUTATION-OUTCOME`. | `UNKNOWN_OUTCOME` blocks dependent mutation → `CONFIRMED_*` or `COMPENSATION_REQUIRED`. | Show “đang xác minh” and a safe reconcile action rather than “failed, retry”. | CT-06, CT-39 |
| CC-12 | Backup completeness vs crypto-erasure | Backups preserve recoverability for allowed classes, but key/policy journals and forward revocation prevent readable resurrection. Owners: `EXTREME_HARDENING_CONTRACTS.md#V1`, `#BA`, `#DT`, `#DU`. | `RESTORED` → `DECRYPTABILITY_BLOCKED` or `PURGE_PENDING` when keys/policy no longer permit use. | Distinguish backup presence from usable/authorized recovery. | CT-11, CT-30, CT-31 |
| CC-13 | Telemetry usefulness vs privacy minimization | Telemetry is governed egress; security evidence uses separate redacted durable channels. Owners: `EXTREME_HARDENING_CONTRACTS.md#JJ`, `#JN`, `#JR`, `#CM`. | `EMIT_REQUESTED` → `REDACTED/LOCAL_ONLY/POLICY_BLOCKED` when data class is not allowed. | Show health without exposing source media, credentials or sensitive content. | CT-07, CT-29 |
| CC-14 | Collaboration/offline freedom vs authority revocation | Preserve branch bytes for inspection/export, but current authorization dominates canonical merge and irreversible actions. Owners: `EXTREME_HARDENING_CONTRACTS.md#AX`, `#EL`, `#NP`; `API_CONTRACTS.md#API-COLLABORATION-AUTHORITY-REVALIDATION`. | `ACTIVE_OFFLINE` → `AUTHORITY_REVOKED/IMPORT_AS_BRANCH_REQUIRED`; never auto-merge. | Keep the user's work and clearly offer access request or export. | CT-38 |
| CC-15 | Provider fallback availability vs protected quality/rights | Capability fallback may choose degraded mode only when policy permits and must disclose the semantic change. Owners: `FINAL_ARCHITECTURE.md#11`, `EXTREME_HARDENING_CONTRACTS.md#N11`, `#F1`. | `ROUTING` → `DEGRADED_EXPLICIT` or `POLICY_BLOCKED`, never silent downgrade. | Explain the quality/cost/privacy tradeoff and request confirmation when needed. | CT-22, CT-25 |

## Review status

All rows have a single named owner and a required negative/chaos case. The
owners are design contracts; no row is empirically verified by this document.
