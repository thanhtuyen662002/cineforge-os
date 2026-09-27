# CineForge OS — Extreme Finding Registry

> **Canonical finding identity registry for Draft PR #2.**
> Raw evidence remains in `docs/orchestration/EXTREME_FAILURE_STRESS_TEST_2026-09-26.md`.

## Why this exists

The raw red-team corpus contains hundreds of unique findings but later attack waves reused legacy `Xnn` labels. Legacy IDs are therefore **not unique** and must never be used by agents as machine identity.

Canonical identity is:

```text
CFRT-<deterministic title hash>
```

Adding new findings or reclassifying domain/severity does not renumber existing findings.

## Rules

- `stable_id` is canonical and does not contain mutable classification metadata.
- `legacy_id` is historical display metadata only.
- `domain` and `severity` are mutable classifications and may be corrected without changing `stable_id`.
- Raw stress-test file is evidence, not implementation contract.
- `docs/design/EXTREME_HARDENING_CONTRACTS.md` is the implementation-contract owner for promoted controls.
- A finding becomes COVERED only after explicit owner mapping and negative/chaos-test requirement.
- Registry generation fails on stable-ID collision.
- Existing stable IDs never change silently.

## Current inventory

- Total canonical findings: **662**
- Domains: **16**
- Findings with P0 in severity: **176**
- Findings with P1 in severity: **612**

### Domain counts

- BUILD: 25
- CAP: 31
- COLLAB: 16
- DATA: 29
- GEN: 108
- INGEST: 12
- MEDIA: 34
- ML: 27
- ORCH: 122
- PLAT: 22
- PRIV: 53
- REC: 41
- REL: 22
- SEC: 84
- STOR: 27
- TIME: 9

## Machine-readable registry

`docs/orchestration/findings/REGISTRY.json`

It carries every stable ID, legacy alias, title, severity, source section and source line.

## Canonical coverage ledger

`docs/orchestration/findings/COVERAGE.json`

The coverage ledger is keyed by `stable_id` and carries the exact control owner,
supporting owner paths, residual state, required negative/chaos tests and empirical
status for every registry record. It is the current coverage source; the registry's
`coverage_state` is synchronized from the ledger for quick inventory checks. The P0-first bootstrap
maps all 176 P0 findings to an owner and keeps each in `EMPIRICAL_TEST_REQUIRED`
until executable evidence exists. No design-only mapping is treated as `VERIFIED`.

Current P0/P1 audit status:

- P0: 176 total; 176 exact owners; 173 `EMPIRICAL_TEST_REQUIRED`; 3 explicit `RESIDUAL`; 0 `UNCOVERED`;
- P1-containing: 612 total; 138 exact owners; 137 `EMPIRICAL_TEST_REQUIRED`; 1 explicit `RESIDUAL`; 474 explicit `PARTIAL` records; 0 `UNCOVERED`;
- empirical `VERIFIED`: 0 (the branch contains specifications, not runtime proof).

The executable scenario catalog is
`docs/orchestration/CHAOS_TEST_PLAN.md` (`CT-01` through `CT-40`).
Cross-layer precedence and contradiction handling is indexed in
`docs/orchestration/CONTROL_CONSISTENCY_MATRIX.md`; the matrix points back to
the single authoritative owner for each behavior.
Run `python docs/orchestration/doc_lint_selftest.py` to exercise the
fail-closed documentation-gate fixtures without modifying the checkout.
Run `python docs/orchestration/control_event_selftest.py` for the canonical
control-event grammar/hash/reconciliation fixtures.  Promotion lanes #3--#7
are routed by
`docs/orchestration/PROMOTION_LANE_MATRIX.json`; validate its owner, control,
chaos and stable-ID mappings with
`python docs/orchestration/promotion_lane_gate.py`.

L4 has a bounded reference contract harness for recovery/storage decisions:
`docs/orchestration/l4_recovery_contract.py` and its machine-readable manifest
`docs/orchestration/L4_RECOVERY_CONTRACT_MANIFEST.json`.  Run the negative
fixtures with `python docs/orchestration/l4_recovery_selftest.py`, then run
`python docs/orchestration/l4_recovery_gate.py`.  The harness covers CT-10
through CT-16 (recovery epochs, old outbox policy, SQLite pressure, temporary
reservations, single-writer fencing, backup verification, and migration/update
rollback).  It is explicitly `REFERENCE_HARNESS_ONLY`: it does not open a
product SQLite database, acquire an OS lock, verify a real signing key, or
prove power-loss/hardware recovery.  A passing fixture therefore remains
`DESIGNED_UNVERIFIED`, and L4 promotion remains parked until independent
runtime and chaos evidence exists.
The gate metadata fixtures are exercised with
`python docs/orchestration/l4_recovery_gate_selftest.py`.

L5 has a bounded reference security harness for untrusted-input, IPC, parser,
external-materialization, browser-identity and supply-chain decisions:
`docs/orchestration/l5_security_contract.py` and
`docs/orchestration/L5_SECURITY_CONTRACT_MANIFEST.json`.  Run
`python docs/orchestration/l5_security_selftest.py`, then
`python docs/orchestration/l5_security_gate.py`; the gate metadata fixtures
run with `python docs/orchestration/l5_security_gate_selftest.py`.  The slice
covers CT-17 through CT-24 and CT-31 through CT-37.  It is explicitly
`REFERENCE_HARNESS_ONLY`: it does not parse a real archive, verify a stable OS
file handle, open a socket, create a WebView/native bridge, verify a provider or signing signature, or
prove production security.  Passing fixtures remain `DESIGNED_UNVERIFIED`,
and L5 promotion remains parked until the product implementation,
independent verifier and executed chaos evidence exist.

L6 has a bounded reference harness for resource/cost admission, worker crash
loops, pinned fanout, manual revision fences and publication unknown outcomes:
`docs/orchestration/l6_runtime_contract.py` and
`docs/orchestration/L6_RUNTIME_CONTRACT_MANIFEST.json`.  Run
`python docs/orchestration/l6_runtime_selftest.py`, then
`python docs/orchestration/l6_runtime_gate.py`; gate metadata fixtures run
with `python docs/orchestration/l6_runtime_gate_selftest.py`.  The exact chaos
slice is CT-25, CT-26, CT-27, CT-28 and CT-39.  Capture ownership/device
binding is a supplemental fixture only and is not publication evidence.  The
module is explicitly `REFERENCE_HARNESS_ONLY`: it does not reserve a real GPU,
start a worker process, access a camera, call a provider or publish externally.
Passing fixtures remain `DESIGNED_UNVERIFIED`, and L6 promotion remains parked
until independent runtime, verifier and executed chaos evidence exist.

L7 has a bounded reference harness for rights-generation cache fences,
forward-delete/restore reconciliation, package-key revocation and security
epochs, CI artifact provenance, clean release closure, final-byte signer
binding, offline authority revalidation and deployment split-brain fencing:
`docs/orchestration/l7_release_contract.py` and
`docs/orchestration/L7_RELEASE_CONTRACT_MANIFEST.json`.  Run
`python docs/orchestration/l7_release_selftest.py`, then
`python docs/orchestration/l7_release_gate.py`; gate metadata fixtures run
with `python docs/orchestration/l7_release_gate_selftest.py`.  The exact chaos
slice is CT-29, CT-30, CT-31, CT-32, CT-33, CT-34, CT-38 and CT-40.  The
read-only archive import is supplemental and cannot satisfy a production
restore or erasure claim.  The module is explicitly `REFERENCE_HARNESS_ONLY`:
it does not enforce real rights, erase a real disk, restore a real backup,
verify a real signing key or CI runner, authorize a real offline actor, or
activate a real deployment.  Passing fixtures remain `DESIGNED_UNVERIFIED`,
and L7 promotion remains parked until independent runtime, verifier and
executed chaos evidence exist.

The architecture-level closure boundary is machine-readable in
`docs/orchestration/ARCHITECTURE_CLOSURE_MANIFEST.json`; validate it with
`python docs/orchestration/architecture_closure_gate.py` and its metadata
fixtures with `python docs/orchestration/architecture_closure_gate_selftest.py`.
That gate can close the design baseline only.  It must report
`CHOT_DESIGN_BASELINE`, `NOT_IMPLEMENTED_IN_REPOSITORY` and `NOT_CLOSED`
together; those values are deliberate and are not a release authorization.

## Next gate

Before this PR can become review-ready:
1. map every P0/P1 finding to a control owner;
2. map a required negative/chaos test;
3. mark residual/external limitations explicitly;
4. no P0 finding may remain `NEEDS_COVERAGE_REVIEW`.

The bounded contract gates for lanes #3--#7 are now present, but their matrix
keeps runtime evidence `NOT_IMPLEMENTED_IN_REPOSITORY` and promotion
`PARKED_EXPLORATION_ONLY` until the product implementation and independent
verification lanes exist.
