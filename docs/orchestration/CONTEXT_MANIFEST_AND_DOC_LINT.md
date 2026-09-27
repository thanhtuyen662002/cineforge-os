# CineForge OS — Context Manifest & Documentation Contract Policy

> Status: mandatory for task-scoped authoritative context and documentation integrity.

# 1. Context reference format

Preferred reference:
`path#stable-section-id`

Examples:
- `docs/design/API_CONTRACTS.md#API-MONEY-01`
- `docs/architecture/FINAL_ARCHITECTURE.md#ARCH-CAPTURE-01`

Use `WHOLE_FILE` only when the entire file is genuinely required.

Line numbers are navigation hints only, never stable contract identity.

# 2. Context Manifest

Each claimed Task has a materialized Context Manifest.

Item fields:
- context_item_id
- path
- section_id | WHOLE_FILE
- source_commit_sha
- normalized_content_digest
- importance: MANDATORY | ADVISORY
- owner_class: ARCH | SCHEMA | STATE | API | UI | RISK | ORCHESTRATION | GOVERNANCE
- reason
- risk_codes / invariant refs when relevant

Manifest fields:
- task_issue
- task_contract_hash
- claim_base_sha
- generated_by
- generated_at
- manifest_hash

# 3. Loading rule

Before substantive mutation:
- every MANDATORY item must be fetched/read and digest-validated;
- truncation/partial retrieval is a failure;
- unavailable mandatory context yields `BLOCKED_CONTEXT`;
- ADVISORY context may be expanded as evidence requires.

A model summary is not a substitute for mandatory contract text when correctness depends on exact wording.

# 4. Section digest

Digest is computed from normalized section content:
- UTF-8;
- heading + owned section body until the next peer/higher heading boundary;
- normalized line endings;
- presentation-only trailing whitespace ignored;
- cryptographic digest algorithm qualified, e.g. `sha256:<hex>`.

Do not hash a search snippet.

# 5. Section identity

New authoritative sectional contracts use stable semantic IDs.

Rules:
- unique within the authoritative document;
- prefer stable domain identity over sequential numbering;
- ID does not change merely because earlier sections are inserted;
- renamed/split section records deprecation/redirect mapping.

Numeric headings may remain for old narrative organization but cannot be ambiguous.

# 6. Reviewer independence

For HIGH-risk PRs, reviewer independently resolves expected context from:
- changed paths/contracts;
- task risk profile;
- architecture owner mapping;
- dependency/security/rights implications.

Reviewer compares that set to the author's Context Manifest.

Missing mandatory context blocks approval.

# 7. Documentation lint

CI documentation-contract lint checks:
- duplicate semantic section IDs;
- duplicate top-level numeric IDs where numeric IDs are used as references;
- broken `path#section-id` refs;
- missing referenced paths;
- duplicate active machine-contract ownership;
- stale/deprecated authoritative references;
- required AGENTS/orchestration references;
- Context Manifest item digest validity when evaluated for a PR;
- generated index/catalog source revision freshness if such index exists.

# 8. Findings vs active contracts

Risk/red-team/audit documents contain evidence and adversarial findings.

They do not become implementation contracts automatically.

Active implementation behavior comes from:
- FINAL_ARCHITECTURE boundaries/invariants;
- detailed owner docs;
- orchestration/governance owner docs;
- EXTREME_HARDENING_CONTRACTS for explicitly promoted hardening contracts.

A finding marked CONTAINED must not trigger duplicate implementation merely because an agent saw the wording.

# 9. Context cache

A cached context item is valid only when:
- same path/section ID;
- source digest matches;
- governing trust/policy freshness requirements are satisfied.

HIGH-risk control/security/signing/rights tasks may require fresh retrieval even if content digest matches when policy marks the source freshness-sensitive.

# 10. Context overhead metrics

Track where practical:
- CONTEXT_ITEMS_REQUIRED
- CONTEXT_ITEMS_LOADED
- CONTEXT_BYTES_FETCHED
- CONTEXT_LOAD_TIME
- CONTEXT_CACHE_HIT
- CONTEXT_EXPANSION_COUNT
- CONTEXT_MANDATORY_MISS

Flow Governor may classify excessive context loading as throughput debt and ask Planner to split tasks/contracts.

# 11. Oversized mandatory section

If one mandatory section is itself too large for reliable consumption:
- split the contract into smaller stable owner sections;
- split the Task;
- or block execution until supported section/range retrieval can provide it safely.

Never silently truncate.

# 12. Deprecation/redirect

When a stable section is superseded:
- old section stays with a DEPRECATED marker long enough for live claims/archive references;
- point to replacement section ID;
- do not reuse the old ID for unrelated content.

Integrator/reviewer may require active tasks to rebind when semantics changed materially.


# 13. Finding-registry lint

CI documentation lint additionally verifies:
- every canonical finding in `findings/REGISTRY.json` has a unique `stable_id`;
- legacy `Xnn` is never treated as canonical identity;
- stable finding ID does not depend on mutable domain/severity classification;
- registry `title_hash` uses the declared SHA-256/normalized-title rule;
- no duplicate active hardening section ID;
- coverage records reference canonical stable finding IDs only;
- deprecated legacy coverage files are not accepted as current implementation evidence.

# 14. Hardening contract section identity

For `EXTREME_HARDENING_CONTRACTS.md`:
- every active top-level owner ID is unique;
- duplicate IDs block merge;
- renaming/migration records an explicit map;
- high-volume future contracts should prefer semantic stable IDs over alphabetic sequence continuation;
- a cross-reference must resolve to exactly one active section.

# 15. Red-team context routing and size budgets

The raw stress corpus is an audit source, not default implementation context.
Normal task context is routed through:

```text
REGISTRY.json
  -> COVERAGE.json (stable_id)
  -> exact control_owner_path#control_owner_section_id
  -> required CT-* chaos case
```

Context packs must not make `EXTREME_FAILURE_STRESS_TEST_2026-09-26.md`
mandatory merely because a finding is referenced. Load the source-evidence line
on demand when a reviewer needs the original attack text. A pack records an
omission reason for every excluded domain/control family.

Default budgets are guardrails, not permission to truncate:

- `MAX_CONTEXT_PACK_BYTES = 262144` for a normal implementation claim;
- `MAX_MANDATORY_SECTION_BYTES = 65536` for one required owner section;
- `MAX_RAW_EVIDENCE_BYTES = 0` in a default coding pack (on-demand only).

If a mandatory section exceeds its budget, split the contract or split the
Task. The loader must fail with `BLOCKED_CONTEXT` rather than silently
truncating it.

# 16. Executable documentation lint gate

The bootstrap repository provides a dependency-free checker:

```text
python docs/orchestration/doc_lint.py
```

The gate has a standard-library negative-fixture smoke suite:

```text
python docs/orchestration/doc_lint_selftest.py
```

Control-event grammar and reconciliation are checked separately with:

```text
python docs/orchestration/control_event_selftest.py
```

Promotion lanes #3--#7 use a generated, overlap-aware finding/chaos mapping:

```text
python docs/orchestration/promotion_lane_gate.py
python docs/orchestration/promotion_lane_selftest.py
```

It first proves the current tree passes, then copies the tree to a temporary
directory and verifies that duplicate IDs, broken references, stable-ID
collisions, coverage-count drift, missing P0 owners and malformed/incomplete
chaos references fail closed. The fixtures never modify the checkout.

The command is merge-blocking for authoritative-document changes. It checks
duplicate active IDs (including migrated architecture/design headings), broken
`path#section-id` references, hardening-section uniqueness, registry stable-ID
collisions, P0 ownership/test requirements, coverage/registry identity parity,
owner-section resolution, and the `CONTROL_REGISTRY.yaml` ID/applicability/
maturity/owner contract. A green result proves document identity and
ledger shape only. It also checks that `CHAOS_TEST_PLAN.md` contains exactly
`CT-01` through `CT-40`, each with the eight required executable-spec fields,
and that ledger references resolve to real cases. A green result does not
prove runtime implementation or empirical chaos success.

The gate also requires the canonical `CONTROL_EVENT_CONTRACTS.json` schema and
its normative Markdown companion. The control-event self-test covers strict
ASCII keys, duplicate/unknown fields, unknown versions, bounded values,
malformed hashes, cross-field lease/review rules, idempotent retries,
conflicting event IDs, stale head/base bindings, CI producer provenance and
`UNKNOWN_OUTCOME` merge fencing. These are contract checks; they do not
authenticate GitHub authors or query live refs.

`PROMOTION_LANE_MATRIX.json` freezes the CT-to-finding selection for each lane,
resolves every required control/owner reference and records the evidence
boundary.  Lane overlap is intentional for cross-boundary findings.  All five
lanes are contract-gate complete, while their runtime status remains
`NOT_IMPLEMENTED_IN_REPOSITORY` and their promotion state remains
`PARKED_EXPLORATION_ONLY`.

The L4 slice also has a bounded reference harness and gate:

```text
python docs/orchestration/l4_recovery_selftest.py
python docs/orchestration/l4_recovery_gate.py
python docs/orchestration/l4_recovery_gate_selftest.py
```

These fixtures exercise CT-10 through CT-16 for recovery-epoch/outbox
fencing, SQLite pressure, temporary-space admission, single-Core ownership,
backup integrity, and migration/update rollback.  They are explicitly
`REFERENCE_HARNESS_ONLY`; they do not provide product SQLite, OS lock,
signing-key, power-loss, hardware, or production-restore evidence.  The L4
matrix therefore remains fail-closed at `DESIGNED_UNVERIFIED` and
`PARKED_EXPLORATION_ONLY`.

The L5 slice adds a bounded reference harness for hostile input, IPC, parser,
external materialization, browser identity and software-supply-chain decisions:

```text
python docs/orchestration/l5_security_selftest.py
python docs/orchestration/l5_security_gate.py
python docs/orchestration/l5_security_gate_selftest.py
```

These fixtures cover CT-17 through CT-24 and CT-31 through CT-37.  They model
staged immutable bytes, Windows path/collision rules, private-network and DNS
rebinding policy, parser budgets, scoped IPC and context/tool gates, callback
replay, external-artifact expiry/digest binding, account/semantic fences, and
package/artifact/toolchain provenance.  The module is explicitly
`REFERENCE_HARNESS_ONLY`: it does not parse a real archive, verify a stable OS
file handle, open a socket, create a WebView/native bridge, verify a provider or signing signature, or
prove a production release.  L5 therefore remains `DESIGNED_UNVERIFIED` and
`PARKED_EXPLORATION_ONLY` until an independent product implementation,
provider/security verifier and executed chaos evidence exist.

# 17. Lane #3 bootstrap gate

The first promotion slice for the exploration PR is the control-plane and
documentation-integrity gate. Its bounded evidence surface is:

- canonical registry/coverage identity and title-hash parity;
- exact owner-section and raw-evidence pointers;
- Context Manifest routing and size budgets;
- `doc_lint.py` pass/fail behavior;
- `doc_lint_selftest.py` baseline plus fail-closed negative fixtures;
- canonical event grammar and fail-closed reconciliation fixtures in
  `CONTROL_EVENT_CONTRACTS.json`, `control_event_lint.py` and
  `control_event_selftest.py`;
- promotion-lane matrix/gate and negative fixtures for lanes #3--#7;
- chaos specifications `CT-01` through `CT-09` for claim, lease, event and CI
  provenance controls.

The slice does not claim GitHub mutation enforcement, runtime lease locking,
independent CI, or executed chaos. Those require a repository-native runtime
and independent verifier in the reviewable promotion lane. Until that evidence
exists, affected findings remain `EMPIRICAL_TEST_REQUIRED` or explicit
`RESIDUAL`.
