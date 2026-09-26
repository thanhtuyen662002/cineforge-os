# CineForge OS — Capacity Control and Slot Plan

> Capacity guidance is append-only/reconciled control state. It never overrides live Issue/PR/CI facts.
> Read together with `CONTROL_PLANE_TRUST_AND_CONCURRENCY.md`.

# 1. Purpose

The active slot count is runtime configuration.

Planner converts available capacity into a role/offset plan without changing the GitHub coordination protocol.

# 2. Canonical Capacity Plan Issue

Discovery:
- exact title `[CONTROL] Agent Capacity Plan`;
- if none exists, trusted Planner creates one;
- if more than one exists, reconciliation selects the lowest-numbered trusted open Issue and marks others duplicate/obsolete;
- workers do not create additional plans.

The Issue body is bootstrap/display information only.

Live plan state is the winning append-only `CAPACITY_PLAN_V2` chain in trusted comments.

Fields include:

```text
CAPACITY_PLAN_V2
PLAN_VERSION=<n>
PREV_PLAN_COMMENT_ID=<id|none>
PRIMARY_PLANNER=<agent>
PRIMARY_FLOW_GOVERNOR=<agent>
PRIMARY_INTEGRATOR=<agent>
SLOT_COUNT=<n>
SCHEDULE_CYCLE=<...>
SLOT_BINDINGS=<...>
STAGGER_OFFSETS=<...>
CI_RUNNER_CAPACITY=<...>
REVIEW_CAPACITY=<...>
MAX_ACTIVE_IMPLEMENTATION=<n>
MAX_CI_IN_FLIGHT=<n>
MAX_WAITING_REVIEW=<n>
MAX_PARKED_TOTAL=<n>
CURRENT_CRITICAL_PATH=<...>
CURRENT_HOTSPOTS=<...>
UPDATED_BY=<agent>
```

Conflict rule:
- if two trusted plan comments reference the same PREV_PLAN_COMMENT_ID, the lower GitHub comment ID wins that version race;
- losing sibling comments remain historical and are `SUPERSEDED_CONFLICT`;
- next valid plan must extend the winning chain.

This avoids silent lost updates from Issue-body replacement.

# 3. Control-role leases

Planner, Flow Governor and Integrator are leased roles.

Use `CONTROL_ROLE_LEASE_V1` on the canonical Capacity Plan Issue.

A control agent:
1. appends ACQUIRE for the next role epoch;
2. re-reads trusted competing events;
3. lowest valid GitHub comment ID for that role/epoch wins;
4. loser performs no conflicting control mutation.

Lease expiry/failover uses GitHub server event time, not agent-local clock alone.

Control operations remain idempotent/reconciled because comments are not database transactions.

# 4. Scheduled slot run lease

Each scheduled slot has:
- stable SLOT_ID;
- stable AGENT_INSTANCE_ID;
- unique RUN_ID per invocation.

Before starting mutating work, invocation acquires `SLOT_LEASE_V1`.

Winner selection:
- earliest valid trusted ACQUIRE comment ID for the slot/epoch;
- loser exits or performs read-only analysis.

This protects against scheduler overlap before a Draft PR exists.

Task-level deterministic claim branch remains the authoritative duplicate-task protection.

# 5. Work chat

A Work chat is opportunistic capacity, not assumed scheduled capacity.

If only one Work chat exists it may use a simple ID, but protocol is future-safe:
- SLOT_ID=`WORK-<stable-short-id>`
- AGENT_INSTANCE_ID=`cineforge-WORK-<stable-short-id>`
- unique RUN_ID each invocation.

Multiple Work chats must not share one logical identity.

WORK may:
- plan;
- build;
- review other agents;
- integrate when it holds the required control lease;
- resolve bottlenecks.

It cannot satisfy independent review for its own PR by inventing another ID.

# 6. Slot preflight

At start:
1. read winning Capacity Plan version;
2. validate current slot/control lease;
3. inspect open PRs for same SLOT_ID/AGENT_INSTANCE_ID;
4. service failed CI/review feedback on owned work when appropriate;
5. ensure global/stage WIP budget permits a new implementation claim;
6. otherwise switch to review/CI/unblock/read-only control work.

# 7. Global WIP/backpressure

“No waiting” must not become “infinite WIP”.

Planner/Flow Governor uses stage budgets:
- MAX_ACTIVE_IMPLEMENTATION;
- MAX_CI_IN_FLIGHT;
- MAX_WAITING_REVIEW;
- MAX_PARKED_TOTAL;
- per-slot parked limit.

If CI/review is saturated:
- do not keep creating new implementation PRs merely because builders are free;
- redirect compatible slots to review, CI repair, tests, integration, task decomposition or hotspot work.

Throughput > utilization.

# 8. Duplicate planners

Multiple slots may have Planner capability, but only the current Planner role lease holder writes the canonical plan/backlog policy.

Other agents may:
- report bottlenecks;
- create narrowly-scoped bug/unblock issues when allowed;
- perform read-only planning analysis.

Flow Governor may acquire Planner lease after valid expiry/failover.

# 9. Plan update triggers

Recalculate when:
- user changes slot count;
- critical Epic changes;
- READY starvation;
- review/CI backlog;
- specialist imbalance;
- major blocker;
- release phase;
- stage WIP saturation;
- slot repeatedly idle;
- CI runner capacity changes.

# 10. Capacity degradation

If slots disappear:
- do not immediately reassign live claims;
- inspect lease liveness;
- take over critical stale work;
- reduce new WIP;
- preserve parked low-priority work until needed.

# 11. Capacity expansion

If slots increase:
- reserve control capacity;
- create/split enough safe READY work;
- respect downstream CI/review capacity;
- prefer tasks with downstream-unblock value;
- avoid hotspot collisions;
- never duplicate claimed work.

# 12. Minimum continuity

If Capacity Plan/control comments are unavailable or stale:
- Issues/PRs/CI remain durable work truth;
- do not invent new ownership;
- reconstruct plan after reconciliation;
- GitHub outage protocol applies when control-plane reads/writes cannot be trusted.
