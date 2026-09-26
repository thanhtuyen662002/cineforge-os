---
name: Agent Task
about: Schedulable autonomous engineering task
title: "[TASK] "
---

## Machine-readable task contract

agent_task_v1:
- area:
- preferred_role:
- risk: LOW | MEDIUM | HIGH
- size: S | M | L
- parallel_class: SAFE | CONTRACT | HOTSPOT | SERIAL
- hard_dependencies: []
- soft_dependencies: []
- unblocks: []
- likely_touched_paths: []
- arch_context_required: []
- design_context_required: []
- risk_context_required: []
- review_profiles: [domain]
- ci_tiers: [A]
- external_blocker: false

This block is the canonical schedulable metadata. Narrative sections below must not contradict it.

## Outcome

## Why

## Acceptance criteria

- [ ]
- [ ]

## Required tests / evidence

- [ ]
- [ ]

## Architecture / design notes

## External/manual blocker detail

None.

## Notes

Transient worker state does not live in this Issue. Claim/lease state lives in the Claim PR structured event stream.

A Task is not READY merely because this Issue is open. Readiness is derived by the Task/Lease and Reconciliation protocols.
