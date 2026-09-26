## Immutable claim record

agent_claim_v1:
- issue: 0
- attempt: 1
- agent_instance_id:
- run_id_at_claim:
- slot_id:
- role_profile:
- claim_base_sha:
- architecture_refs: []
- risk_profile: LOW | MEDIUM | HIGH

This claim block records the initial claim and is not the live lease state.
Live state, takeover and review are append-only structured PR events/comments.

## Outcome

## Scope

In:
- 

Out:
- 

## Verification plan

Local:
- [ ]

CI:
- [ ] Required verification context is current

Manual/evidence:
- [ ]

## Current resume summary

Convenience only. Latest valid structured PR event is canonical live state.

- Last known HEAD_SHA:
- Last known BASE_SHA:
- Blocker:
- Next action:

## Merge checklist

- [ ] Task contract still valid
- [ ] Hard dependencies merged
- [ ] Current verification tuple satisfied
- [ ] Independent review(s) match required verification context
- [ ] No unresolved blocking review
- [ ] No stale architecture/schema/migration conflict
- [ ] Reconciliation found no merged/reopened/obsolete contradiction
