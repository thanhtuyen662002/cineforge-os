## Claim / lease

- CLAIMS: #
- AGENT_INSTANCE_ID:
- SLOT_ID:
- ROLE_PROFILE:
- ATTEMPT:
- BASE_SHA_AT_CLAIM:
- LEASE_STATE: ACTIVE

## Outcome

<!-- What this PR makes true. -->

## Scope

In:
- 

Out:
- 

## Architecture / design references

- `AGENTS.md`
- `docs/architecture/FINAL_ARCHITECTURE.md`
- `docs/design/FINAL_DETAILED_DESIGN.md`
- Task-specific references:

## Risk profile

- LOW | MEDIUM | HIGH
- Relevant risk/invariants:
- External side effects:
- Migration impact:
- Security/rights impact:

## Verification

Local:
- [ ]

CI:
- [ ] Exact-head required checks

Manual/evidence:
- [ ]

## State / resume

Current state:
- ACTIVE | PARKED_WAITING_CI | PARKED_WAITING_REVIEW | PARKED_BLOCKED_DEPENDENCY | READY_FOR_REVIEW | READY_FOR_MERGE

Exact head SHA:
- 

Blocker:
- None

Next action:
- 

## Review record

Independent review must bind to the exact head SHA and a different logical AGENT_INSTANCE_ID.

## Merge checklist

- [ ] Task contract satisfied
- [ ] Hard dependencies merged
- [ ] Required CI green on exact head
- [ ] Independent review satisfied
- [ ] No unresolved blocking review
- [ ] No stale architecture/schema/migration conflict
