# CineForge OS — GitHub Control-Plane Outage and Partial Failure

# 1. Principle

GitHub is durable coordination truth. If that truth is unavailable, autonomy degrades safely rather than inventing local ownership.

# 2. New claims

If GitHub cannot be read/written reliably:
- do not create a new Task claim;
- do not merge;
- do not perform takeover;
- do not change shared governance state.

A local worker cannot prove another agent has not claimed the same work.

# 3. Already-owned work

If a worker had a confirmed Claim PR before the outage:
- it may continue local reversible implementation within already agreed scope for a bounded period;
- it must not perform irreversible/shared external actions that require fresh coordination;
- it stores a local checkpoint;
- once GitHub returns, re-read/reconcile before pushing.

If ownership becomes ambiguous, stop at a safe checkpoint.

# 4. CI/review

Do not infer:
- green;
- approval;
- merge-ready

from cached state after control-plane outage.

Refresh current verification evidence after recovery.

# 5. Partial mutation failures

Every multi-step GitHub operation assumes partial success is possible.

Examples:
- branch created, PR failed;
- PR merged, Issue close failed;
- review posted, label update failed;
- Capacity Plan updated, notification failed.

Response:
- never blindly repeat the entire sequence;
- inspect current GitHub facts;
- reconcile from authoritative partial state;
- perform only missing idempotent steps.

# 6. Recovery

After GitHub/control plane recovers:
1. Flow Governor runs reconciliation;
2. resolve orphan claims;
3. reconcile merged PR/open Issues;
4. refresh CI/reviews;
5. refresh Capacity Plan guidance;
6. only then return to normal high-parallel claims.
