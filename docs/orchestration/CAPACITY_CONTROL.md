# CineForge OS — Capacity Control and Slot Plan

> Capacity guidance is single-writer and append/revision aware. It never overrides live Issue/PR/CI facts.

# 1. Purpose

The active slot count is runtime configuration.

Planner converts available capacity into a role/offset plan without changing the GitHub coordination protocol.

# 2. Capacity Plan

Planner owns one canonical Capacity Plan Issue.

Canonical discovery rule:
- exact title `[CONTROL] Agent Capacity Plan`;
- if none exists, Planner creates one;
- if more than one exists, the lowest-numbered open Issue is canonical until Flow reconciliation closes/marks duplicates;
- workers do not create additional plans.

The plan contains:

```text
PLAN_VERSION:
SLOT_COUNT:
SCHEDULE_CYCLE:
CONTROL_SLOTS:
BUILD_SLOTS:
FLEX_SLOTS:
SLOT_BINDINGS:
STAGGER_OFFSETS:
CURRENT_CRITICAL_PATH:
CURRENT_HOTSPOTS:
CI_RUNNER_CAPACITY:
REVIEW_CAPACITY:
GLOBAL_ACTIVE_WIP_LIMIT:
CI_HEALTH:
REVIEW_HEALTH:
READY_DEPTH:
UPDATED_BY:
UPDATED_AT:
```

Only the current PRIMARY_PLANNER edits the canonical plan.
PRIMARY_FLOW_GOVERNOR is also named explicitly.
A control role re-reads the current plan version before writing; stale controllers do not overwrite a newer plan.
Workers treat it as read-only guidance.

The Capacity Plan is not:
- the task queue;
- a lease;
- canonical task state.

If it becomes stale, Issues/PRs/CI still provide safe operation.

# 3. Work chat

A Work chat uses:
- SLOT_ID=WORK
- MODE=WORK

It is an opportunistic super-slot.

Planner must not assume WORK is permanent scheduled capacity.

WORK may:
- act as control plane;
- take a critical builder task;
- review;
- integrate;
- resolve bottleneck.

It still uses normal atomic task claim and cannot bypass independent review rules on its own PR.

# 4. Scheduled slots

Each slot has a stable SLOT_ID and stable AGENT_INSTANCE_ID such as:
- SLOT_ID=S03
- AGENT_INSTANCE_ID=cineforge-S03

Each invocation also has a unique RUN_ID.

Slot examples:
- S01
- S02
- ...

Its role affinity can change between Capacity Plan versions without creating a new scheduled task if the runtime prompt reads the current plan.

Therefore a generic scheduled prompt is preferable to hardcoding a permanent specialist identity into every task.

# 5. Slot preflight

At start:
1. read current Capacity Plan if present;
2. inspect open PRs containing SLOT_ID;
3. if one ACTIVE claim from same slot appears live, do not start another active implementation;
4. service parked/failed work when appropriate;
5. otherwise claim READY work by current role affinity.

# 6. Overlap safety

Scheduled systems may start a new invocation while prior work is still running.

Protection layers:
- same SLOT_ID/AGENT_INSTANCE_ID preflight;
- task-level atomic claim remains the correctness primitive even if a same-slot overlap slips through before Draft PR creation;
- one-active-implementation policy;
- Git branch/non-fast-forward protection;
- deterministic issue claim branch;
- exact-head review/merge;
- Flow Governor stale takeover.

A second run that sees a fresh ACTIVE claim should perform read-only control/review work or exit without mutating that branch.

# 7. Duplicate planners

If multiple slots have Planner capability:
- one is PRIMARY_PLANNER in Capacity Plan;
- others may create concrete unblock/bug tasks but do not independently rebuild the whole backlog;
- Flow Governor can become temporary planner if PRIMARY is unavailable.

Purpose: avoid contradictory task decomposition.

# 8. Plan update triggers

Planner recalculates on:
- user changes slot count;
- critical Epic changes;
- READY starvation;
- review/CI backlog;
- specialist backlog imbalance;
- major blocker;
- release phase;
- slot repeatedly idle.

# 9. Capacity degradation

If slots disappear:
- no task is reassigned merely because its owner slot is temporarily absent;
- Flow Governor inspects lease liveness;
- critical stale work is taken over;
- low-priority parked PR can wait;
- Planner reduces new WIP.

# 10. Capacity expansion

If slots increase:
- Planner creates/splits enough READY work;
- reserve control capacity;
- prefer downstream-unlocking tasks;
- avoid activating many hotspot-conflicting tasks;
- do not duplicate already claimed work.

# 11. Minimum continuity

The system must still operate safely if Capacity Plan is unavailable:
- agents derive ready work from Issues;
- claims from branches/PRs;
- blockers from dependencies/CI/reviews;
- control roles can reconstruct a new plan.
