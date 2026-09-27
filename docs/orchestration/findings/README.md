# CineForge OS — Extreme Finding Registry

> **Canonical finding identity registry for Draft PR #2.**
> Raw evidence remains in `docs/orchestration/EXTREME_FAILURE_STRESS_TEST_2026-09-26.md`.

## Why this exists

The raw red-team corpus contains hundreds of unique findings but later attack waves reused legacy `Xnn` labels. Legacy IDs are therefore **not unique** and must never be used by agents as machine identity.

Canonical identity is:

```text
CFRT-<DOMAIN>-<deterministic title hash>
```

Adding new findings does not renumber existing findings.

## Rules

- `stable_id` is canonical.
- `legacy_id` is historical display metadata only.
- Raw stress-test file is evidence, not implementation contract.
- `docs/design/EXTREME_HARDENING_CONTRACTS.md` is the implementation-contract owner for promoted controls.
- A finding becomes COVERED only after explicit owner mapping and negative/chaos-test requirement.
- Registry generation fails on stable-ID collision.
- Existing stable IDs never change silently.

## Current inventory

- Total canonical findings: **662**
- Domains: **17**
- Findings with P0 in severity: **176**
- Findings with P1 in severity: **612**

### Domain counts

- GEN: 144
- ORCH: 101
- PRIV: 53
- REC: 41
- SEC: 40
- MEDIA: 38
- BUILD: 34
- REL: 33
- PLAT: 29
- ML: 28
- CAP: 27
- STOR: 24
- DATA: 23
- COLLAB: 19
- OBS: 14
- TIME: 8
- INGEST: 6

## Machine-readable registry

`docs/orchestration/findings/REGISTRY.json`

It carries every stable ID, legacy alias, title, severity, source section and source line.

## Next gate

Before this PR can become review-ready:
1. map every P0/P1 finding to a control owner;
2. map a required negative/chaos test;
3. mark residual/external limitations explicitly;
4. no P0 finding may remain `NEEDS_COVERAGE_REVIEW`.
