# CineForge OS — Bottleneck Detection and Unblocking Playbook

# 1. Bottleneck categories

## READY_STARVATION
Builders have capacity but insufficient ready tasks.

Actions:
- decompose next Epic;
- merge contract/interface task;
- convert false hard dependencies to soft;
- create test/stub/fixture tasks;
- split oversized task.

## DEPENDENCY_CHAIN
Many tasks wait on one task/PR.

Actions:
- elevate blocker to critical path;
- assign strongest compatible worker;
- add parallel reviewers;
- narrow blocker to contract-first PR;
- move nonessential implementation after interface merge.

## CI_QUEUE
Checks queued/runners unavailable.

Actions:
- QA/Flow investigates runners/workflow;
- park PRs;
- stop blind reruns;
- builders pivot;
- create CI unblock issue.

## CI_SLOW
Checks run too long for small PRs.

Actions:
- path-filter;
- split fast/slow tiers;
- cache;
- move full suite nightly/release;
- isolate slow media tests;
- parallelize matrices where efficient.

## CI_FAILING
Code/test actually broken.

Actions:
- owner fixes;
- if unattended/critical, takeover;
- regression test required for bug when appropriate.

## FLAKY_CI
Inconsistent without source change.

Actions:
- quarantine/classify;
- preserve signal;
- fix flake;
- do not normalize endless reruns as workflow.

## REVIEW_QUEUE
PRs green but waiting review.

Actions:
- temporarily reassign Flex/build slots;
- review critical-path oldest first;
- avoid Integrator as sole reviewer.

## MERGE_CONFLICT
Parallel PRs collide.

Actions:
- Integrator decides merge order;
- update dependent branch;
- if repeated, mark hotspot and change decomposition.

## HOTSPOT_CONTENTION
Many tasks need same migration/config/registry.

Actions:
- temporary hotspot owner;
- narrow serial edit;
- expose interface;
- parallelize outside hotspot.

## STALE_LEASE
Draft PR exists but no live owner progress.

Actions:
- inspect CI/review;
- takeover on same branch;
- abandon only if implementation is invalid.

## SCOPE_EXPLOSION
One task/PR keeps expanding.

Actions:
- stop;
- preserve coherent core;
- split follow-ups;
- merge smallest valid slice first.

## ARCHITECTURE_CONFLICT
Two implementations require incompatible architectural interpretation.

Actions:
- pause only conflicting work;
- use authoritative docs;
- propose architecture decision/update;
- continue unrelated work.

Escalate user only if it is a real product/business decision outside existing policy.

## EXTERNAL_BLOCKER
Credential/account/service/manual legal decision unavailable.

Actions:
- mark explicit external blocker;
- create mock/contract/test work if possible;
- continue independent paths;
- do not consume worker slot waiting.

# 2. Bottleneck signals

Flow Governor inspects:
- ready_tasks / builder_slots;
- blocked_tasks / open_tasks;
- oldest green-unreviewed PR;
- oldest failed-unattended PR;
- current verification-context CI age vs normal baseline;
- number of PRs touching same hotspot;
- dependency fan-out;
- stale claim PRs;
- red main;
- review request volume;
- active vs parked work per slot.

Thresholds are repository-configurable; use trend/context rather than brittle fixed minutes alone.

# 3. Critical-path preference

When two tasks are ready, prefer:
- task that unblocks more downstream tasks;
- task needed for current vertical slice;
- task reducing system-wide risk;
- task clearing release gate;
- task removing shared CI/integration bottleneck.

Do not maximize issue closure count.

# 4. Flow Governor authority

May:
- reclassify task priority;
- create unblock task;
- split task;
- reassign role;
- take over stale implementation;
- request/perform review;
- fix CI;
- sequence hotspot merges;
- ask Planner for more ready work.

May not:
- silently bypass failed correctness/security/rights gate;
- merge without required evidence;
- duplicate a live implementation;
- invent a business/product decision outside policy.

# 5. No-idle fallback ladder

If a worker cannot progress current task:
1. service owned CI/review feedback;
2. review another compatible PR;
3. take a ready critical-path task;
4. take test/fixture/docs/unblock work;
5. help resolve hotspot/CI issue;
6. only then report no executable work.

# 6. Lead/Flow self-check

Every control cycle asks:
- What is the single largest throughput constraint now?
- Is any slot waiting unnecessarily?
- Which task unlocks the most work?
- Which PR is closest to merge but unattended?
- Is CI or review slower than coding?
- Are we creating too much WIP?
- Is main green?


# 7. DEPENDENCY_CYCLE

Signal:
- hard-dependency graph contains a cycle;
- no member can become READY without another member in the same cycle.

Actions:
1. mark the cycle as a planning defect;
2. do not “pick one anyway” as READY;
3. identify whether edges are falsely hard;
4. split/merge contract tasks to break the cycle;
5. if an architecture contract genuinely requires simultaneous change, create one cohesive HOTSPOT/integration task rather than cyclic Issues;
6. re-run DAG validation before scheduling.

Planner must validate the hard-dependency graph before publishing READY work.

# 8. RESTART_STORM

Signal:
- worker/runtime repeatedly crashes and restarts within budget window.

Actions:
- stop new dispatch to affected worker;
- enter backoff/quarantine;
- redirect safe work;
- create root-cause task;
- do not let automatic restart become the throughput bottleneck.

# 9. SUPPLY_CHAIN_BLOCKER

Signal:
- required new package/model/connector has UNKNOWN/BLOCKED provenance, security or license state.

Actions:
- create/review dependency-governance task;
- seek safer existing capability/implementation if appropriate;
- do not bypass the gate merely to keep a builder busy.
