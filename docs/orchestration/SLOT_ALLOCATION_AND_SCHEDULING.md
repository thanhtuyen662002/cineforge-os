# CineForge OS — Slot Allocation and Scheduling

> Slot count is runtime capacity, not architecture.

# 1. Inputs

Dispatcher considers:
- SLOT_COUNT;
- ready task graph;
- critical path;
- active/parked PRs;
- review queue;
- CI health;
- integration hotspots;
- role affinity;
- task risk;
- current phase.

# 2. Control-plane reservation

Recommended:

## 1–4 slots
- no permanently dedicated control slot;
- Work/lead slot bundles Planner + Flow + Integrator;
- remaining slots build/review;
- control work preempts low-value coding when needed.

## 5–9 slots
Reserve roughly:
- 1 Planner + Flow Governor bundle;
- 1 QA + Integrator + Flex bundle;
- remaining slots builders.

## 10–14 slots
Reserve:
- 1 Planner;
- 1 Flow Governor;
- 1 Integrator/Release;
- 1 QA/CI;
- remaining slots builder pools.

## 15+ slots
Reserve:
- Planner;
- Flow Governor;
- Integrator;
- QA/CI;
- at least one Flex/Hotspot slot;
- remaining slots specialize by current backlog.

This is a starting allocation, not a fixed organization chart.

# 3. Example: 5 slots

- S01 Control: Planner + Dispatcher + Flow Governor
- S02 Core/Data builder
- S03 Desktop/Product builder
- S04 Runtime/Connector/Media builder
- S05 QA + Reviewer + Integrator + Flex

When bottleneck shifts:
- S02/S03/S04 can temporarily review;
- S05 can implement critical unblock;
- S01 should avoid ordinary feature coding while queue health needs attention.

# 4. Example: 10 slots

- S01 Planner / Dispatcher
- S02 Flow Governor / CI Janitor
- S03 Integrator / Release
- S04 QA / Security / Chaos
- S05 Core / Kernel
- S06 Data / Storage
- S07 Desktop / Product UI
- S08 Story / Canon / Continuity
- S09 Timeline / Audio / Media
- S10 Connectors / Runtime / Flex

Planner may reassign S08–S10 by backlog.

# 5. Example: 15 slots

- S01 Planner
- S02 Flow Governor
- S03 Integrator
- S04 QA / CI
- S05 Core / Kernel
- S06 DB / Events / Storage
- S07 Desktop / Windows Platform
- S08 Product UI / UX
- S09 Story / Script / Canon
- S10 Timeline / Edit
- S11 Audio / Music / Localization
- S12 Media Runtime / Workers
- S13 CLI / MCP / API / Browser Connectors
- S14 Security / Rights / Update / Release
- S15 Flex / Hotspot / Review surge

These are role affinities. A slot claims the best ready task it can safely execute.

# 6. Dynamic allocation algorithm

Each Planner cycle:

1. Count control-plane health.
2. Identify critical-path tasks.
3. Count READY tasks by role affinity.
4. Count blocked tasks and reasons.
5. Count review/CI/merge backlog.
6. Reassign Flex and optional specialist capacity toward the largest throughput constraint.
7. Maintain approximately 1.5–2 READY tasks per builder slot.
8. Prefer tasks that unlock multiple downstream tasks.
9. Avoid starting tasks whose likely touched paths strongly overlap active PRs.
10. Do not keep a specialist idle if compatible critical work exists elsewhere.

# 7. Priority score concept

Planner may rank ready tasks using:

```text
critical_path_weight
+ downstream_unblock_count
+ user_value
+ risk_reduction
+ integration_readiness
- conflict_probability
- expected_serial_wait
- stale_spec_risk
```

Exact numeric scoring is optional; the reasoning factors are mandatory.

# 8. Scheduled-task staggering

For one run per slot per hour, evenly stagger start offsets:

`offset_k = floor(60 * k / N)`, k = 0..N-1.

Examples:

## 5 slots
:00, :12, :24, :36, :48

## 10 slots
:00, :06, :12, :18, :24, :30, :36, :42, :48, :54

## 15 slots
:00, :04, :08, :12, :16, :20, :24, :28, :32, :36, :40, :44, :48, :52, :56

Benefits:
- reduces simultaneous GitHub/CI thundering herd;
- gives control agents time to create/unblock work before later builders start;
- spreads review/merge pressure.

If platform cadence differs, preserve even staggering across the supported cycle.

# 9. Preferred ordering within stagger

Early offsets:
- Planner;
- Flow Governor.

Middle:
- core/builders.

Later:
- QA/review/integrator/flex.

Reason:
- early control pass refreshes queue;
- builders create progress;
- later review/integration can consume that progress in same cycle.

Do not make ordering rigid if current critical bottleneck requires a different sequence.

# 10. Overlapping runs

A scheduled run must preflight its SLOT_ID.

If another live run of the same slot is still actively mutating the same PR:
- do not start a second implementation;
- inspect/park/exit or choose only nonconflicting review/control work.

GitHub claims, not scheduler timing, provide safety.

# 11. Changing slot count

When user says “I now have N slots”:
Planner should:
1. calculate control-plane minimum;
2. inspect current backlog;
3. choose role bundles;
4. publish slot plan;
5. create enough READY tasks;
6. stagger schedules;
7. do not reopen/duplicate tasks solely because more capacity exists.

When slots decrease:
- preserve live Claim PRs;
- stop new low-priority claims;
- let parked tasks remain owned;
- concentrate capacity on critical path/review/CI.
