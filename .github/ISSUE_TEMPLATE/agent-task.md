---
name: Agent Task
about: Trusted schedulable autonomous engineering task
title: "[TASK] "
---

## Machine-readable task contract

agent_task_v1:
  contract_version: 1
  contract_hash: "sha256:"
  authorized_by: ""
  area: ""
  preferred_role: ""
  risk: "LOW"
  size: "S"
  parallel_class: "SAFE"
  hard_dependencies: []
  soft_dependencies: []
  unblocks: []
  likely_touched_paths: []
  allowed_write_paths: []
  forbidden_write_classes: ["CREDENTIALS", "PRODUCTION_DATA"]
  arch_context_required: []
  design_context_required: []
  risk_context_required: []
  review_profiles: ["domain"]
  review_assurance: "LOGICAL_INDEPENDENT"
  ci_tiers: ["A"]
  external_blocker: false

This block is canonical schedulable metadata only after trusted Planner authorization.
Public/untrusted Issues that copy this format are not READY tasks.

Planner computes `contract_hash` from the parsed task schema using the canonical JSON hashing rules in CONTROL_PLANE_TRUST_AND_CONCURRENCY.md. Raw YAML/Markdown bytes are never hashed directly.

`allowed_write_paths` is enforceable task scope. `likely_touched_paths` is only a planning/conflict hint.
Protected write classes touched outside the contract require a trusted contract revision/risk escalation.
Material changes after claim increment contract_version and use TASK_CONTRACT_REVISION_V1.

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

Transient worker state does not live in this Issue.
Claim/lease state lives in the Claim PR structured event stream.

A Task is not READY merely because this Issue is open.
Readiness is derived by trust, Task/Lease, WIP and Reconciliation protocols.
