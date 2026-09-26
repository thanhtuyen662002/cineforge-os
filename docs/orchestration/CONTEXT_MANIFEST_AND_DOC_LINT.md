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
