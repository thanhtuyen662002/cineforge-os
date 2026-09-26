# CineForge OS — Task, Claim and Lease Protocol

> Read with `GITHUB_METADATA_CONVENTIONS.md`, `FLOW_METRICS_AND_RECONCILIATION.md`, and `CONTROL_PLANE_TRUST_AND_CONCURRENCY.md`.

# 1. Task Issue contract

Every schedulable trusted Task Issue contains one `agent_task_v1` contract:

```text
contract_version
area
preferred_role
risk
size
parallel_class
hard_dependencies
soft_dependencies
unblocks
likely_touched_paths
arch_context_required
design_context_required
risk_context_required
review_profiles
ci_tiers
external_blocker
```

Planner computes/stores a canonical contract hash for claim/review reconciliation.

L tasks should normally be split before claim unless inherently atomic.

# 2. Trust and readiness

A Task is READY only when:
- Issue/control source is trusted or explicitly adopted by trusted Planner;
- Issue is open;
- no merged Claim PR already completed it unless explicit rework exists;
- contract version/hash is valid;
- acceptance criteria are clear;
- all Hard dependencies are currently satisfied;
- no external/manual blocker;
- no open Claim PR;
- no unresolved architecture conflict;
- claiming would not violate global WIP/backpressure.

An external public Issue is never schedulable merely because it copies the template.

# 3. Dependency satisfaction

A hard dependency is satisfied by current main/contract evidence, not “this Issue was closed once”.

If an upstream contract is reverted/superseded:
- downstream readiness is recomputed;
- affected active work becomes review/rework/stale as appropriate.

# 4. Atomic task claim

1. Re-read trusted Task contract and dependencies.
2. Reconcile merged/open PRs and orphan claim branches.
3. If a Claim PR already merged and no explicit rework exists, reconcile the Issue rather than claiming.
4. Determine next attempt number from existing attempts/branches/PRs.
5. Derive exact branch:
   `agent/i<issue>-a<attempt>`
6. Create the exact branch `agent/i<issue>-a<attempt>` from current main. No free-form slug is allowed in the atomic claim key.
7. If branch creation conflicts, another agent won; choose another task.
8. Create one minimal machine claim-marker commit at `.cineforge/claims/i<issue>-a<attempt>.json`. This commit contains only claim identity/context and exists because GitHub rejects opening a zero-diff PR.
9. Immediately create Draft Claim PR.
10. Append initial `AGENT_STATE_V1`.
11. Only then start substantial implementation.

Branch creation is the task claim race primitive. The claim marker must be removed before READY_FOR_REVIEW unless a future repository tool replaces it with an empty-commit-capable claim mechanism.

# 5. Claim context record

Initial claim metadata records:
- Issue;
- attempt;
- AGENT_INSTANCE_ID;
- RUN_ID;
- SLOT_ID;
- role;
- CLAIM_BASE_SHA;
- TASK_CONTRACT_VERSION;
- TASK_CONTRACT_HASH;
- CONTEXT_BASE_SHA;
- required architecture/design paths;
- risk profile.

The PR body is historical/display metadata and technically editable on GitHub; critical merge decisions revalidate live facts and structured events.

# 6. Contract changes after claim

Planner must not silently change an active task contract.

Material change:
1. increment contract_version;
2. update contract_hash;
3. append `TASK_CONTRACT_REVISION_V1` with reason;
4. active owner re-reads and ACKs/replans;
5. reviewer/Integrator validates current contract hash before merge.

If new contract invalidates the existing PR, close/repurpose explicitly instead of forcing sunk-cost merge.

# 7. Authoritative context

Referenced docs resolve at CONTEXT_BASE_SHA.

At review/merge:
- compare referenced paths against current verification base;
- if materially changed, re-read affected docs and revalidate;
- unrelated repository changes do not force full corpus reload.

# 8. Progress events

Append state event only on meaningful transition:
- ACTIVE
- PARKED_WAITING_CI
- PARKED_WAITING_REVIEW
- PARKED_BLOCKED_DEPENDENCY
- READY_FOR_REVIEW
- READY_FOR_MERGE
- ABANDONED

Record:
- HEAD_SHA;
- BASE_SHA/verification context;
- blocker;
- next action.

No no-op heartbeat spam.

# 9. Parking

Parking preserves claim ownership but releases execution capacity.

Before parking:
- push safe work;
- record current verification context;
- blocker;
- next action;
- ensure GitHub alone is enough to resume.

Parking does not authorize unlimited new WIP; global stage limits apply.

# 10. Waiting CI/review/dependency

Do not spend a scheduled run idly waiting.

But when downstream CI/review queues are saturated:
- prefer review/CI/unblock work over claiming additional implementation.

If dependency appears mid-task:
- determine whether contract/stub can decouple;
- split mergeable independent work;
- park only truly blocked scope.

# 11. Orphan claim branch

A branch without PR is ambiguous, not immediately abandoned.

Flow Governor:
1. append `ORPHAN_OBSERVED_V1` with branch/head;
2. wait one reconciliation cycle/policy grace;
3. re-read;
4. if unchanged/no PR, classify ORPHAN_EMPTY or ORPHAN_WITH_WORK;
5. recover/adopt/retire.

Never race an agent that may be between branch creation and Draft PR creation.

# 12. Takeover and write fencing

Only current trusted Flow Governor/control authority initiates takeover.

Two modes exist.

## Confirmed handoff
Use the same branch only when the prior owner explicitly handed off and is known to have stopped mutating it.

## Stale/unconfirmed takeover
If the prior worker is unreachable, stale or may still wake/push, do **not** continue on the same branch.

Procedure:
1. inspect Issue, contract hash, old PR/diff/checks/reviews;
2. append trusted `AGENT_TAKEOVER_V1` on the old PR;
3. create a fenced replacement branch from the exact adopted old HEAD:
   `agent/i<issue>-a<attempt>-owner<epoch>`;
4. open a replacement Draft PR referencing/superseding the old PR;
5. close the old PR as `SUPERSEDED_TAKEOVER` only after the replacement PR exists;
6. any later commits pushed by the stale owner to the old branch cannot enter the replacement PR;
7. preserve original authorship/history and explicitly adopt only verified commits.

This physical branch separation is the fencing boundary. A comment/lease alone cannot stop a stale worker with write access from pushing to the same Git ref.

# 13. One-slot WIP

Default:
- at most 1 ACTIVE implementation per slot;
- parked work does not count active but does count parked/global WIP;
- default max parked ownership = 2 unless control policy says otherwise.

Scheduled slot run lease prevents overlapping invocations from violating this before PR visibility.

# 14. Hotspot lease

For declared hotspot:
- only one ACTIVE PR changes the hotspot contract/range at a time;
- parallelize outside it;
- Planner/Integrator sequences the narrow serial surface.


# 15. Lease renewal rule

Slot/control ownership TTL is not permission to let a long-running mutation continue blindly after expiry.

For long operations:
- renew before entering a new mutating phase;
- before each push, takeover, merge or shared-control mutation, revalidate current lease/owner state;
- if ownership is uncertain, stop at a local safe checkpoint and reconcile;
- stale/unconfirmed takeover uses the fenced replacement-branch procedure above.

A lease is coordination evidence, not a magic write lock.


# 16. Hard-dependency DAG invariant

The schedulable hard-dependency graph must be acyclic.

Planner/Reconciliation:
- validates cycles whenever hard dependencies change;
- treats a detected cycle as BLOCKED_PLANNING_DEFECT;
- does not mark any member READY by guessing an order;
- resolves by weakening false hard edges, extracting a contract task, or combining truly atomic work.

Soft/review/integration coordination edges may be cyclic if their semantics allow it, but they never act as READY blockers like hard dependencies.


# 17. Write-scope contract

Every schedulable task should define:
- `allowed_write_paths`;
- `forbidden_write_classes`.

`likely_touched_paths` remains advisory and helps conflict prediction; it is not authorization.

Diff outside allowed scope:
- blocks READY_FOR_REVIEW until contract revision or split;
- cannot be waived by the author alone;
- escalates risk automatically if protected governance/security/release surfaces are touched.

# 18. Attempt allocation

Next attempt is `max(trusted historical claim attempts)+1`.

Sources include closed/merged PR history and trusted claim events, not merely currently existing branches.

A deleted branch never makes an old attempt number reusable.



# 16. Claim intent and ambiguous branch creation

Before branch creation, a claimant participates in `CLAIM_INTENT_V1` election defined by CONTROL_PLANE_TRUST_AND_CONCURRENCY.md.

The exact deterministic branch is created only by the winning intent.

Claim marker includes:
- CLAIM_INTENT_ID
- CLAIM_INTENT_COMMENT_ID
- CONTROL_EVENT_ID
- task contract hash
- context/base SHA
- agent/slot/run identity

GitHub write timeout is UNKNOWN_OUTCOME, not failure.

If branch exists but its association to the winning claim intent cannot be proven:
- do not write substantive commits;
- classify CLAIM_ASSOCIATION_UNKNOWN;
- Flow Governor reconciles.
