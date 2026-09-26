---
name: Agent Capacity Plan
about: Single-writer runtime plan for autonomous worker slots
title: "[CONTROL] Agent Capacity Plan"
---

## Canonical control record

- CONTROL_ID: cineforge-capacity-v1
- PLAN_VERSION:
- SLOT_COUNT:
- SCHEDULE_CYCLE:
- PRIMARY_PLANNER:
- PRIMARY_FLOW_GOVERNOR:
- UPDATED_BY:
- UPDATED_AT:

## Slot bindings

| Slot | Agent instance | Role affinity | Mode | Offset |
|---|---|---|---|---|
| S01 | cineforge-S01 |  | SCHEDULED |  |

## Control plane

- Integrator capability:
- QA/CI capability:
- Flex capability:

## Current flow

- Critical path:
- Integration hotspots:
- CI runner capacity:
- Review capacity:
- Global active WIP limit:
- CI health:
- Review health:
- Ready depth:
- Major blockers:

## Notes

This Issue is single-writer guidance owned by PRIMARY_PLANNER.
It is not a task queue, task lease or correctness lock.

If duplicate open Capacity Plan Issues exist, the lowest-numbered open Issue is canonical until Flow reconciliation resolves duplicates.
