# CineForge OS — Autonomous Development Bootstrap Readiness

> The repository currently contains architecture/design/orchestration documentation but autonomous coding is not fully operational until bootstrap infrastructure exists.

# 1. Required before broad autonomous coding

## Work backlog
- create one current Epic for the implementation slice;
- create bounded READY Task Issues using the machine-readable template;
- create one canonical Capacity Plan Issue when scheduled workers are used.

## CI
At minimum establish a Tier A workflow appropriate to the first code stack:
- format/lint;
- compile/typecheck;
- unit/contract tests;
- basic static/security checks.

Add Tier B/C only when code exists that needs them.

## Repository protection
Target:
- PR-based changes to main;
- no force push;
- required checks once stable;
- governance/security review for control-plane changes.

Current protocol must continue to enforce gates even when repo-native protection is not yet configured.

## Code skeleton
Before many builders start, bootstrap:
- workspace/project structure;
- build/test command;
- migration/test harness baseline;
- ownership boundaries;
- CI cache conventions.

# 2. Do not start 15 builders against an empty repository

High slot count before contracts/skeleton exist creates:
- dependency collisions;
- package/config conflicts;
- duplicated bootstrap choices;
- CI instability;
- giant integration cost.

Recommended bootstrap sequence:
1. control/Planner creates initial Epic + Slice 0 tasks;
2. 2–4 slots establish contracts/skeleton/CI;
3. once main is green and interfaces exist, increase builder parallelism;
4. grow toward available slot count as READY lanes appear.

# 3. First implementation slice

Follow `docs/design/FINAL_DETAILED_DESIGN.md` Slice 0:
- ID/revision/event/command libraries;
- schema migrations;
- error envelope;
- Core API skeleton;
- UI design tokens/status primitives;
- state-machine test harness.

Planner should use contract-first splits so Core/Data/UI/QA lanes can start independently.

# 4. Bootstrap completion signal

Broad autonomous coding may scale when:
- main builds/tests green;
- Tier A CI is reliable;
- at least one Epic has machine-readable Task graph;
- claim/PR workflow has been exercised once;
- one independent review has been exercised;
- Flow Governor can observe/reconcile live GitHub state;
- READY depth supports the desired builder count.

# 5. Scaling rule

Capacity follows ready parallel work.

Do not create artificial tasks merely to occupy slots.
Unused capacity is better than merge chaos.
