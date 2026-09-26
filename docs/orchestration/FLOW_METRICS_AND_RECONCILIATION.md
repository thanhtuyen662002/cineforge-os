# CineForge OS — Flow Metrics and Reconciliation

> Purpose: make Flow Governor decisions evidence-based and make GitHub state self-healing after partial failures.

# 1. Why reconciliation is mandatory

GitHub mutations are not one transaction.

Examples:
- PR merges but linked Issue is not closed;
- claim branch is created but Draft PR creation fails;
- CI finishes but PR state comment still says waiting;
- takeover comment lands but Capacity Plan still names old owner;
- main advances while old review/CI evidence remains attached to the PR.

Workers must reconcile observed GitHub facts before creating new work.

# 2. Canonical fact precedence

For task completion:
1. merged Claim PR on the task
2. explicit reopened/rework decision on the Issue
3. Issue open/closed state

A merged Claim PR means the same Issue must not be newly claimed merely because the Issue was accidentally left open.

For claim ownership:
1. open Claim PR exists
2. latest valid structured PR state/takeover event
3. initial immutable claim block in PR body

PR body is the initial claim record, not the live lease state.

For verification:
1. verification evidence matching current required head/base/merge context
2. older checks/reviews are historical only

For Capacity Plan:
- it is guidance;
- Issue/PR/CI facts win if the plan is stale.

# 3. Reconciliation cycle

Before Planner/Flow/Integrator creates or reassigns work:

1. Find open Issues with merged Claim PRs.
   - close/reconcile Issue unless explicitly reopened for rework.
2. Find open Claim PRs whose Issue is closed/not-planned.
   - determine whether PR is obsolete, needs re-linking, or Issue should reopen.
3. Find `agent/i*` claim branches without PR.
   - classify ORPHAN_EMPTY or ORPHAN_WITH_WORK.
4. Find PRs whose latest state says WAITING_CI but required CI is complete.
   - advance to failure/review/merge handling.
5. Find PRs whose review/CI evidence is for an old verification tuple.
   - mark evidence stale.
6. Find stale Capacity Plan slot/owner references.
   - update guidance; do not mutate claims merely to match the plan.
7. Find dependencies whose blocking Issue/PR merged.
   - recompute readiness.

# 4. Flow metrics

Flow Governor tracks trends, not vanity totals.

Core metrics:
- READY_DEPTH = ready tasks / active builder capacity
- ACTIVE_WIP = active implementation PRs
- PARKED_WIP = parked PRs
- BLOCKED_RATIO = blocked open tasks / schedulable open tasks
- CLAIM_TO_FIRST_PUSH
- CODE_TO_CI_START
- CI_QUEUE_WAIT
- CI_RUN_TIME
- CI_FAILURE_RATE
- FLAKE_RATE
- GREEN_TO_REVIEW
- REVIEW_TIME
- REVIEW_TO_MERGE
- PR_CYCLE_TIME
- MERGE_CONFLICT_RATE
- STALE_TAKEOVER_COUNT
- REOPEN/REWORK_RATE
- MAIN_RED_DURATION
- HOTSPOT_CONTENTION
- READY_STARVATION_EVENTS

# 5. Relative thresholds

Do not hard-code one universal minute threshold.

Maintain a rolling baseline by class:
- docs/small;
- ordinary code;
- media/integration;
- installer/release;
- high-risk migration/security.

Flag:
- sudden regression from baseline;
- oldest item far beyond peers;
- queue growth across multiple control cycles;
- repeated failure of same stage.

# 6. Flow Governor decision order

Each control cycle:
1. Is main red or a mandatory gate broken?
2. Is a critical-path task blocked?
3. Is review/merge queue the dominant wait?
4. Is CI queue/runtime dominant?
5. Is READY depth too low?
6. Is WIP too high?
7. Is a hotspot causing repeated conflicts?
8. Are old parked/stale claims accumulating?
9. Are easy tasks starving hard/high-value work?

Then act on the largest constraint.

# 7. Aging/fairness

Critical path has priority, but noncritical work must not starve indefinitely.

Ready-task ranking includes an aging bonus after repeated eligible cycles.

Aging never overrides:
- security/rights blocks;
- unmet hard dependency;
- invalid architecture contract.

# 8. Task-size interpretation

Suggested scheduling size:
- S: expected to reach a merge/review checkpoint in one active worker cycle
- M: expected to need 1–3 active cycles with resumable checkpoints
- L: expected >3 active cycles or cross-domain; Planner should normally split before claim

Size is planning guidance, not a promise of wall-clock duration.

# 9. Orchestration health report

Flow Governor should write concise actionable state only when useful:
- largest bottleneck;
- critical path;
- ready depth;
- old/stale claims;
- review/CI health;
- capacity change if needed.

Avoid verbose status reporting that itself consumes the control slot.

# 10. Success criterion

The flow system is healthy when most waiting time is intentional work-in-progress or unavoidable external latency—not confusion about ownership, stale evidence, queue starvation, CI architecture or review capacity.


# 11. Stage WIP/backpressure metrics

Add:
- ACTIVE_IMPLEMENTATION
- CI_IN_FLIGHT
- WAITING_REVIEW
- MERGE_READY_COUNT
- PARKED_TOTAL
- WIP_BY_SLOT
- WIP_BY_HOTSPOT
- REVIEW_CAPACITY_UTILIZATION
- CI_CAPACITY_UTILIZATION

Flow rule:
- when downstream stage occupancy exceeds configured budget for multiple control cycles, reduce new implementation claims;
- redirect compatible workers to the dominant constrained stage;
- “worker idle” is not a defect if creating more WIP would worsen cycle time.

# 12. Control/merge lease health

Track:
- SLOT_LEASE_CONFLICTS
- CONTROL_ROLE_FAILOVERS
- MERGE_LEASE_WAIT
- ORPHAN_CLAIM_OBSERVATIONS
- TASK_CONTRACT_REVISION_COUNT

Repeated conflicts indicate scheduler/control design problems rather than normal productive work.


# 13. Search/index consistency rule

Reconciliation must not infer absence from GitHub Search alone.

For claim/control correctness:
- use direct branch/ref lookup;
- direct PR/Issue collections or known IDs;
- paginate to completion for the scoped set;
- use search only to discover candidates.

If API response is truncated/partial and completeness cannot be established, state is UNKNOWN and no duplicate claim/takeover/merge is authorized.

# 14. Control epoch maintenance

Monitor Capacity Plan comment/event count and payload size.
Rotate to a new control epoch before parsing/fetching becomes a throughput bottleneck.

Metric:
- CONTROL_EVENT_COUNT_CURRENT_EPOCH
- CONTROL_EVENT_FETCH_TIME
- CONTROL_EPOCH_ROTATIONS



# 15. Integrity/time/storage stop-the-line signals

Flow Governor treats as stop-the-line or scoped freeze according to severity:
- integrity incident on canonical state;
- database READ_ONLY_SAFE;
- untrusted system time affecting signing/release/leases;
- migration RECOVERY_REQUIRED;
- release attestation failure.

Builders may continue unrelated safe work when freeze scope is narrower than whole repository/system.

# 16. Archive/rebuild health metrics

Track:
- PROJECTION_REBUILD_FROM_SEQ
- PROJECTION_REBUILD_DURATION
- EVENT_ARCHIVE_LAG
- SNAPSHOT_AGE
- INTEGRITY_INCIDENT_COUNT

Repeated full replay from event 0 is a scaling defect, not expected steady state.


# 15. Context throughput metrics

Track where available:
- CONTEXT_ITEMS_REQUIRED
- CONTEXT_ITEMS_LOADED
- CONTEXT_BYTES_FETCHED
- CONTEXT_LOAD_TIME
- CONTEXT_CACHE_HIT
- CONTEXT_MANDATORY_MISS
- CONTEXT_EXPANSION_COUNT

Repeated high context-load share is a decomposition/documentation bottleneck.
Flow Governor may create a docs-contract split/index task rather than letting every worker repeatedly load oversized owner files.



# 15. Anti-gaming / flow-quality signals

Track operational signals for diagnosis:
- CLAIM_ABANDON_RATE_BY_AGENT
- CLAIM_WITHOUT_VALID_PARK_EVIDENCE
- CONTRACT_HASH_MISMATCHES
- REPEATED_PRIORITY_METADATA_EDITS
- LOW_VALUE_TASK_INFLATION
- UNRESOLVED_REVIEW_FINDINGS_ON_ADOPTED_COMMITS
- FORCE_PUSH_REWRITE_COUNT
- REVIEW_RUBBER_STAMP_SAMPLE_FAILURES

These metrics do not create an automatic punitive “agent reputation score”.
They trigger Flow/QA investigation and capacity/role adjustment.

# 16. Critical-path derivation

Downstream-unblock value is computed from the actual current hard/soft dependency graph and milestone path.
Self-declared prose such as “unblocks 50 tasks” is advisory only.

# 17. Random audit sampling

Flow/QA may select a sample of:
- low/medium-risk approved PRs;
- repeated reviewer pairs;
- high-throughput agents;
- test/fixture-changing PRs

for fresh independent re-review.

Purpose: detect correlated blind spots/rubber-stamping without making every PR expensive.
