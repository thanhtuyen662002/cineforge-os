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


# 6. Additional P0 bootstrap requirements from deep audit

Before scaling broad autonomous work:
- define TRUSTED_CONTROL_GITHUB_ACTORS;
- create canonical Capacity Plan Issue and exercise append-only CAPACITY_PLAN_V2;
- exercise SLOT_LEASE_V1 with overlapping simulated runs;
- exercise Flow/Planner/Integrator control-role failover;
- exercise manual MERGE_LEASE_V1 or configure authoritative Merge Queue;
- implement strict parser/validator for task/claim/state/review/control metadata;
- verify public/fork Issues/PRs cannot become schedulable agent work without trusted adoption;
- establish CI runner/cache trust boundary;
- configure repository-native main protection when admin capability is available.

The control plane is not considered security-enforced merely because agents agree to follow Markdown policy.



# 7. Bootstrap enablement completion checklist

The one-time BOOTSTRAP_ENABLEMENT state remains open until all are true:

- [ ] trusted machine metadata parser/validator exists;
- [ ] Tier A CI exists and has a recorded producer/workflow identity;
- [ ] controlled failing change proves the CI gate fails closed;
- [ ] controlled passing change proves expected merge path works;
- [ ] public/fork trust behavior is tested;
- [ ] repository protection/ruleset is enabled and verified;
- [ ] GitHub App/agent permissions still permit intended Integrator operations;
- [ ] required-check migration/recovery procedure is documented;
- [ ] bootstrap attestation is recorded;
- [ ] BOOTSTRAP_ENABLEMENT is marked CLOSED.

If any item is false, broad 10–15 slot autonomous coding remains unproven.
