# CineForge OS — Task, Claim and Lease Protocol

> **v1.1 authoritative clarifications**
> - Read `GITHUB_METADATA_CONVENTIONS.md` and `FLOW_METRICS_AND_RECONCILIATION.md` with this protocol.
> - The PR body is the immutable initial claim record; live owner/state is the latest valid structured PR event.
> - A merged Claim PR prevents re-claim of the same open Issue unless the Issue is explicitly reopened for rework.
> - Claim attempts must reconcile orphan claim branches before selecting a new attempt.
> - Only the designated primary Flow Governor/control authority initiates takeover of a stale PR; other agents may flag it.
> - Review/merge liveness binds to current verification context, not just an old HEAD result.

# 1. Task Issue contract

Every schedulable Task Issue contains:

```text
Outcome:
Why:
Area:
Preferred role:
Risk class:
Size: S | M | L
Parallel class: SAFE | CONTRACT | HOTSPOT | SERIAL
Hard dependencies:
Soft dependencies:
Unblocks:
Likely touched paths/domains:
Architecture references:
Acceptance criteria:
Tests/evidence:
Review profile:
External/manual blockers:
```

L tasks should normally be split before claim unless they are inherently atomic.

# 2. Readiness

A task is READY when:
- issue is open;
- no merged Claim PR already completed the Issue unless explicit rework exists;
- acceptance contract is clear;
- all Hard dependencies are merged;
- no external/manual blocker;
- no open Claim PR;
- no unresolved architecture conflict.

Soft dependencies do not block scheduling.

# 3. Atomic claim

1. Re-read issue and dependencies.
2. Reconcile merged/open PRs and orphan claim branches for this Issue.
3. If any Claim PR merged and no explicit rework exists, reconcile/close the Issue instead of claiming.
4. Search all prior claim attempts/branches and determine next attempt number.
4. Derive branch:
   `agent/i<issue>-a<attempt>-<slug>`
5. Create that exact branch from current main.
6. If branch creation conflicts, another agent won. Do not implement; choose another task.
7. Immediately open Draft PR.
8. Append an initial structured AGENT_STATE_V1 event.
9. Only then start substantial code.

This branch creation is the claim race lock.

# 4. Claim PR record

Draft PR body contains the immutable `agent_claim_v1` block from the PR template:
- issue
- attempt
- agent_instance_id
- run_id_at_claim
- slot_id
- role_profile
- claim_base_sha
- architecture_refs
- risk_profile

The initial claim block is historical identity, not live lease state.
Current owner/state is derived from the latest valid structured state/takeover events.

Do not depend on GitHub username to distinguish logical agents; many slots may use the same connected account.

# 5. Progress checkpoints

At meaningful boundaries:
- push code;
- append structured progress event when state changes;
- record observed HEAD_SHA + BASE_SHA, blocker and next action;
- treat PR-body state summaries as convenience only.

State comments:
- ACTIVE
- PARKED_WAITING_CI
- PARKED_WAITING_REVIEW
- PARKED_BLOCKED_DEPENDENCY
- READY_FOR_REVIEW
- READY_FOR_MERGE
- TAKEOVER
- ABANDONED

Do not spam heartbeat comments without a state/progress change.

# 6. Parking

Parking preserves ownership but releases slot capacity.

Before parking:
- push all safe work;
- record observed HEAD_SHA + BASE_SHA;
- record blocker;
- record next action;
- ensure another worker can resume from GitHub alone.

# 7. Waiting CI

When CI is pending:
- mark PARKED_WAITING_CI;
- do not duplicate CI blindly;
- take another independent ready task if allowed;
- owner revisits when scheduled again or Flow Governor sees failure/completion.

If CI fails:
- classify product failure vs flaky infra;
- fix code/test if owned;
- Governor may take over if owner inactive or critical-path impact is high.

# 8. Waiting dependency

A claimed task should rarely wait on an unmerged hard dependency.

If discovered mid-task:
- determine whether interface/stub can remove hard block;
- park only the dependent part;
- split remainder into separate issue if it can merge independently;
- do not hold a slot doing nothing.

# 9. Takeover

The designated primary Flow Governor/control authority may take over when:
- original worker is stale/unavailable;
- CI failure is unattended;
- review changes are unattended;
- critical path is blocked;
- worker explicitly hands off.

Takeover steps:
1. inspect issue/PR/diff/checks/comments;
2. post TAKEOVER with new AGENT_INSTANCE_ID/SLOT_ID and reason;
3. continue on same PR branch where safe;
4. do not create duplicate implementation;
5. preserve original authorship/history.

# 10. Abandon/retry

Close a failed Claim PR only when preserving it no longer helps.

Reopened task uses next attempt branch number.

Never force-push away useful evidence solely to make the history “clean”.

# 11. One-slot WIP policy

Default per slot:
- at most 1 ACTIVE implementation PR;
- parked waiting-CI/review PRs do not count as active;
- avoid more than 2 parked owned PRs unless Planner/Flow Governor approves.

Purpose:
- allow productive work while waiting;
- avoid each agent accumulating an unmanageable backlog.

# 12. Hotspot lease

For declared integration hotspot:
- only one ACTIVE PR may modify the hotspot contract/file range at a time;
- other tasks can continue outside it;
- Integrator/Planner sequences the narrow hotspot edit;
- do not serialize the whole feature unnecessarily.
