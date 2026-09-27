# CineForge OS — CI, Review and Merge Protocol

> Required verification is a context tuple, not merely a recent green check.
> Read with `CONTROL_PLANE_TRUST_AND_CONCURRENCY.md` and `GOVERNANCE_AND_CI_SECURITY.md`.

# 1. CI objective

Give fast trustworthy merge evidence without making agents idle.

# 2. CI tiers

## Tier A — Fast PR Gate
- format/lint;
- compile/typecheck;
- focused unit/contract tests;
- static checks;
- changed-area tests.

## Tier B — Impacted Integration
For semantic/API/schema/media/storage/installer/connector boundaries.

## Tier C — Slow/Full
Nightly, merge/release/high-risk:
- platform matrices;
- packaging;
- long media;
- fuzz/chaos;
- restore;
- expensive E2E.

# 3. Semantic impact > path-only impact

Path filters are optimization only.

Required CI tier is derived from:
- actual diff paths;
- task risk/domain metadata;
- changed API/schema/event contracts;
- dependency/architecture impact;
- governance/security file classes.

If impact cannot be proven narrow, fail safe to broader testing.

A new/unknown path must not accidentally receive less testing because no path rule exists.

# 4. Verification tuple

Evidence records:

```text
HEAD_SHA
BASE_SHA or MERGE_BASE_SHA
optional SYNTHETIC_MERGE_SHA
WORKFLOW/CHECK_ID
CHECK_PRODUCER_APP/IDENTITY
WORKFLOW_PATH
WORKFLOW_REVISION
RUNNER_TRUST_CLASS
ATTEMPT
RESULT
```

Generic old green status is historical only.

# 5. CI throughput

- cancel superseded runs when safe;
- cache safely with trust boundaries;
- do not blind-rerun deterministic failures;
- classify flaky/infra failures;
- a red main is P0 flow work;
- long CI parks PR and releases worker capacity.

# 6. Review assurance

Review event records exact verification context plus:
- reviewer logical identity;
- runtime identity where available;
- GitHub authenticated author;
- assurance level:
  - LOGICAL_INDEPENDENT
  - RUNTIME_INDEPENDENT
  - CREDENTIAL_INDEPENDENT

Minimum assurance comes from risk/governance policy.

Different logical IDs using one GitHub credential are not cryptographic separation.

# 7. Risk profiles

LOW:
- fast CI;
- logical independent review.

MEDIUM:
- fast + impacted CI;
- preferably runtime-independent domain review.

HIGH:
- impacted/full policy tests;
- runtime-independent domain/QA/security review as applicable.

Governance/security changes that weaken gates/credentials/signing/trust boundary:
- credential-independent or explicit external/human approval if policy requires adversarial separation.

# 8. Base drift

Before merge, compare verification base with current main.

If main advanced:
- determine semantic overlap/dependency impact;
- HIGH/HOTSPOT default to fresh-base verification;
- MEDIUM reruns when overlap/impact unknown/material;
- LOW docs-only may proceed with recorded unrelated judgment.

Review on same HEAD may be stale when BASE changed materially.

# 9. Manual merge serialization

When GitHub Merge Queue is not authoritative:
1. current Integrator obtains control-role lease;
2. obtain repository `MERGE_LEASE_V1`;
3. re-read current main SHA;
4. revalidate task contract, dependencies, review assurance and verification tuple;
5. merge one PR using expected HEAD;
6. refresh main before considering another PR;
7. release merge lease.

This closes the race where two Integrators validate against one base then merge concurrently.

If Merge Queue is enabled and configured to test queued merge state, it replaces manual merge serialization.

# 10. Review after author push

Material head changes invalidate review according to policy.

Do not rely on a review event tied to an older HEAD.

# 11. After merge

- reconcile/close Task;
- unblock/recompute dependents;
- post-merge test if required;
- refresh main before next merge;
- preserve evidence.

# 12. Review bottleneck

When review queue dominates:
- reassign Flex/builders to reviews;
- prioritize critical-path/downstream-unblock value;
- Integrator is not sole reviewer.

# 13. CI bottleneck

Detect:
- runner queue/offline;
- long repeated job;
- global workflow overreach;
- cache issue;
- flaky cluster.

Response:
- create CI unblock task;
- park affected PRs;
- redirect builders;
- fix CI architecture;
- no user babysitting.


# 14. Verification producer provenance

A green status name is insufficient.

Required checks must validate:
- expected GitHub App/check-suite producer identity;
- expected workflow path;
- workflow revision/source;
- runner trust class;
- exact verification tuple.

A status/check from an unexpected producer with the same human-readable name does not satisfy the gate.

When repository-native rules support binding a required check to an expected App/integration, use that facility.

# 15. Governance workflow non-self-approval

A PR modifying:
- `.github/workflows/**`;
- CI bootstrap;
- required-check logic;
- governance/security verification scripts

must not be approved solely by the modified workflow code under test.

Its mandatory governance gate must run from:
- protected base-branch workflow logic that the PR cannot change for its own approval; or
- a separately trusted external verifier/App.

The PR may additionally test its proposed workflow, but that result is not the only approval evidence.

# 16. Release artifact provenance

PR verification and release artifact production are separate concerns.

For release/signing:
- build from the merged/release commit; or
- prove artifact content digest is reproducibly identical to an attested pre-merge build;
- bind artifact digest, source commit, toolchain/package lock and signing event in the release manifest.

Do not publish an artifact merely because a pre-squash PR HEAD built successfully if the final merged commit identity/content context differs.

# 17. Merge lease final check

Immediately before the merge API mutation, Integrator revalidates:
- current unexpired Integrator/merge lease;
- current main/base SHA;
- expected PR HEAD;
- task contract hash;
- required CI/review evidence.

A lease that expired before this final check does not authorize the merge.
