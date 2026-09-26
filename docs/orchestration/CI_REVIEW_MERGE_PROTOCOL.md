# CineForge OS — CI, Review and Merge Protocol

> **v1.1 verification rule:** “exact-head” alone is insufficient when main/base moved. Required evidence is a verification tuple of HEAD_SHA plus BASE_SHA/merge-base context and, when applicable, the synthetic PR merge SHA used by CI.

# 1. CI objective

CI exists to give fast, trustworthy merge evidence.

It must not turn every agent into a two-hour waiter.

# 2. CI tiers

## Tier A — Fast PR Gate
Run on nearly every code PR:
- formatting/lint;
- compile/typecheck;
- focused unit tests;
- schema/event/API contract tests;
- static security checks;
- changed-area tests.

Target design: small and predictable.

## Tier B — Impacted Integration
Run only when touched paths/domains require:
- Core↔UI contract;
- DB migration;
- connector integration;
- media pipeline;
- installer/update;
- storage/recovery.

## Tier C — Slow/Full
Run:
- nightly;
- on merge queue/release candidate;
- on explicitly high-risk PRs.

Includes:
- full platform matrices;
- packaging;
- long media integration;
- fuzz/chaos;
- restore drills;
- expensive end-to-end tests.

# 3. CI throughput rules

- cancel/supersede obsolete runs when supported;
- cache dependencies/build outputs safely;
- path-filter expensive jobs;
- split flaky tests from deterministic gates;
- verification result must match current required HEAD + BASE/merge context;
- do not rerun a deterministic failure without a change;
- infrastructure/flaky rerun must be recorded/classified;
- a red main is P0 flow work.

# 4. CI while worker continues

If Tier B/C is long:
- push/checkpoint;
- park PR;
- slot picks independent task;
- Flow Governor watches completion.

A long CI run is not an excuse for an idle scheduled slot.

# 5. Independent review

Reviewer must be a different logical AGENT_INSTANCE_ID from author.

Review checklist:
- task outcome/acceptance;
- architecture/design compliance;
- scope discipline;
- state/error/cancel/retry semantics;
- migrations/backward compatibility;
- tests;
- security/rights;
- user-visible UX states if relevant;
- exact HEAD_SHA and reviewed BASE_SHA/merge context.

Review comment records:
```text
REVIEW_AGENT_INSTANCE_ID:
REVIEW_HEAD_SHA:
REVIEW_BASE_SHA:
VERIFICATION_MERGE_SHA:
REVIEW_PROFILE:
VERDICT: APPROVE | REQUEST_CHANGES | COMMENT
BLOCKERS:
FOLLOWUPS:
```

# 6. Risk profiles

## Low
Examples:
- docs;
- isolated tests;
- small UI presentation;
- non-semantic refactor.

Gate:
- fast CI;
- one independent review.

## Medium
Examples:
- ordinary feature;
- API contract extension;
- connector;
- timeline/UI workflow.

Gate:
- fast + impacted CI;
- one independent domain review.

## High
Examples:
- schema migration;
- command/event semantics;
- storage delete/GC;
- updater;
- security/credentials;
- rights/release;
- installer/signing;
- concurrency/idempotency.

Gate:
- impacted/full policy tests;
- domain/integrator review;
- QA/security/release review as applicable.

# 7. Ready for merge

A PR is MERGE_READY only when:
- linked task still valid;
- required checks match the current verification tuple;
- required independent review(s) tied to current head;
- no unresolved blocking review thread;
- no unmet dependency;
- no merge conflict;
- migration/order gate satisfied.

If author pushes after review:
- material code changes invalidate review according to policy;
- reviewer/integrator rechecks exact head.

# 7.1 Base drift and stale verification

Before merge, Integrator compares the PR verification context with current main.

If main advanced after CI/review:
- determine whether changed main files/contracts overlap the PR's touched paths, dependencies, migrations or architecture context;
- if overlap/material semantic risk exists, update/rebase/merge main into the branch according to repo policy and rerun impacted CI/review;
- if change is demonstrably unrelated, record that judgment and continue;
- HIGH-risk and HOTSPOT PRs default to fresh-base verification unless policy explicitly says otherwise.

A review on the same HEAD can still be stale if the effective diff/dependency context changed because BASE moved.

If CI runs on GitHub's synthetic pull-request merge commit, record that merge SHA in the verification evidence.

# 8. Merge

Preferred default: squash merge for task PRs unless preserving commits is important.

Integrator supplies expected head SHA when merging.

After merge:
- close/complete Task Issue;
- update/unblock dependent issues;
- delete/retire claim branch when supported;
- trigger post-merge verification where required.

# 9. Auto-merge

Current repo may have GitHub auto-merge disabled.

Protocol supports:
- AUTO_MERGE mode when repository settings permit;
- INTEGRATOR_MERGE mode otherwise.

Correctness gates are identical.

# 10. Review bottleneck response

If review queue exceeds capacity:
- Flow Governor assigns Flex/build slots temporarily as reviewers;
- oldest critical-path PR first;
- small independent PRs can be cleared rapidly;
- Integrator should not be sole reviewer for all code.

# 11. CI bottleneck response

Detect:
- queue delay;
- runner offline;
- same job hanging repeatedly;
- workflow unnecessarily global;
- cache failure;
- flaky test cluster.

Response:
- create/claim CI unblock issue;
- park affected PRs;
- reroute workers to independent work;
- fix CI architecture;
- do not ask user to babysit reruns.
