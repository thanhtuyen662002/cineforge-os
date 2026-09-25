# CineForge OS — CI, Review and Merge Protocol

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
- exact-head result required;
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
- exact head SHA.

Review comment records:
```text
REVIEW_AGENT_INSTANCE_ID:
REVIEW_HEAD_SHA:
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
- exact-head required checks green;
- required independent review(s) tied to current head;
- no unresolved blocking review thread;
- no unmet dependency;
- no merge conflict;
- migration/order gate satisfied.

If author pushes after review:
- material code changes invalidate review according to policy;
- reviewer/integrator rechecks exact head.

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
