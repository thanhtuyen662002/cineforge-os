# CineForge OS — Context Loading Protocol

> Goal: preserve correctness without making every scheduled run reload hundreds of kilobytes of architecture/risk documents.

# 1. Problem

The repository contains large authoritative documents.
Re-reading all of them on every hourly run causes:
- unnecessary GitHub/API traffic;
- excessive model context/token consumption;
- slower task startup;
- greater risk that important task-local facts are diluted by unrelated material.

Correctness requires the right context, not maximum context.

# 2. Three context tiers

## Tier 0 — Always read on every start/resume
Small operational core:
1. `AGENTS.md`
2. current Capacity Plan when scheduled mode uses one
3. current Issue
4. current Claim PR + latest structured state/review comments when resuming
5. `docs/orchestration/FINAL_GITHUB_AGENT_OPERATING_MODEL.md` only when orchestration version changed or the worker does not already have its current revision in the run context

## Tier 1 — Task-required authoritative design
Read documents explicitly referenced by the Task Issue and any direct owner docs from the mapping below.

Examples:
- Core/API → FINAL_ARCHITECTURE + FINAL_DETAILED_DESIGN + API_CONTRACTS/STATE_MACHINES sections
- Data/storage → SCHEMA + STATE_MACHINES + storage/risk sections
- UI → UI_COMPONENT_SYSTEM + relevant API/query/state sections
- Character/canon → CHARACTER_IDENTITY_SYSTEM + relevant schema/state/API
- Orchestration/control → orchestration docs + relevant GitHub live state

## Tier 2 — Deep adversarial context
Read when:
- architecture is being changed;
- the task touches a high-risk invariant;
- reviewer requests it;
- a failure cannot be explained by Tier 0/1;
- Planner is decomposing new cross-domain work;
- Flow Governor/QA is doing systemic investigation.

Includes:
- FOUNDATIONAL_RISK_REGISTER
- DETAILED_DESIGN_RED_TEAM
- USER_ACTION_AND_COVERAGE_GAP_ANALYSIS
- RISK_COVERAGE_MATRIX
- MULTI_AGENT_RED_TEAM

# 3. Task Issue must name required context

Every schedulable Task Issue lists:
- ARCH_CONTEXT_REQUIRED
- DESIGN_CONTEXT_REQUIRED
- RISK_CONTEXT_REQUIRED when applicable

A builder should not guess a huge document set if the task contract already scopes it.

Planner owns the initial context list.
Reviewer may add missing authoritative context before merge.

# 4. Context revision check

Task/PR records:
- BASE_SHA_AT_CLAIM
- architecture/design document paths used

At merge/review, if main changed after claim:
- Integrator checks whether authoritative docs referenced by the task changed materially;
- if yes, task must re-read changed docs and revalidate;
- if no, no full-context reload is required.

# 5. Context cache inside one run

Within one agent invocation:
- do not repeatedly fetch unchanged large files;
- reuse concrete Issue/PR IDs;
- reuse already fetched commit/check state until a mutation makes it stale.

This is an execution optimization only; GitHub remains durable truth.

# 6. Mandatory full reread triggers

Full relevant authoritative reread is required when:
- PR base is materially refreshed across an architecture/design change;
- task is taken over by another logical agent;
- Issue scope/acceptance is edited;
- architecture decision changes an invariant;
- merge conflict resolution crosses domain boundaries;
- stale review is being renewed after material changes.

# 7. Review context

Reviewer reads:
- Issue contract;
- PR diff;
- exact verification tuple;
- authoritative docs referenced by the Issue/PR;
- high-risk source docs only for affected risk classes.

Reviewer is not required to load unrelated film-production domains.

# 8. Planner context

Planner performs broad scans but still uses layered loading:
- orchestration docs;
- current Epics/tasks/PRs;
- architecture summaries;
- deep domain docs only for the slice being decomposed.

# 9. Rule

> More context is not automatically safer. Missing critical context is unsafe; irrelevant context is throughput debt.

Agents must load the minimum authoritative context sufficient to make the task correct, then expand when evidence requires it.
