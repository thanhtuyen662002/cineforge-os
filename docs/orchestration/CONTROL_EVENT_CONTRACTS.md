# CineForge OS — Canonical Control-Event Contracts

> Status: normative machine-contract companion to the control-plane trust and
> concurrency protocol.  The JSON file beside this document is the executable
> schema; this document explains the security boundary and reconciliation
> rules.

# CTRL-EVENT-GRAMMAR — Exact event encoding

Every new structured control event is one UTF-8 text block containing one
`KEY=VALUE` record per line.  Keys are ASCII uppercase identifiers matching
`^[A-Z][A-Z0-9_]{0,63}$`.  Keys are case-sensitive, duplicate keys are an
error, unknown keys are an error, blank lines are an error, and control
characters are an error.  The event is limited to 32 KiB and a line is limited
to 4 KiB.  Human narrative may remain Unicode in the value, subject to the
field's declared bound.

The first envelope field identifies the exact version:

```text
EVENT_SCHEMA=AGENT_STATE_V1
CONTROL_EVENT_ID=<stable-before-send-id>
CONTROL_EPOCH=<positive-integer>
PREV_EVENT_COMMENT_ID=<comment-id|none>
PREV_EVENT_HASH=<sha256:lowercase-hex|none>
EVENT_HASH_ALGORITHM=SHA-256
EVENT_HASH=<computed-sha256>
TRUSTED_AUTHOR=<GitHub-login>
```

The event-specific payload follows the envelope.  The JSON schema is the
single source of truth for required fields, field formats and enum values.
Payload-only snippets in older documents are explanatory shorthand; they are
not valid machine events and must not be parsed as control truth.

# CTRL-EVENT-ENVELOPE — Trust and hash-chain fields

The envelope is required for all event classes, including state, review,
claim, capacity, lease, CI and merge-outcome events.  `CONTROL_EVENT_ID` is
created before the network write and is reused for retries.  It is an
idempotency key, not a cryptographic identity.  `TRUSTED_AUTHOR` is a claimed
GitHub login whose authorization must be checked against the versioned trust
policy by the caller.

`PREV_EVENT_COMMENT_ID` and `PREV_EVENT_HASH` are an all-or-none pair.  They
describe the predecessor in the same control epoch.  A missing/deleted
predecessor, stale epoch, forked chain or changed content is a governance
anomaly until a trusted reconciliation resolves it.

# CTRL-EVENT-HASH — Deterministic event digest

`EVENT_HASH_ALGORITHM` is exactly `SHA-256`.  Compute the digest over UTF-8
bytes made from every `KEY=VALUE` line except `EVENT_HASH`, sorted by key, with
one LF after every line.  Prefix the lowercase digest with `sha256:` and put
that value in `EVENT_HASH`.  This canonicalization makes a retry with the same
payload byte-for-byte comparable and detects edits inside an otherwise valid
comment.  It does not make GitHub comments immutable and does not authenticate
the author.

# CTRL-EVENT-PAYLOADS — Versioned event classes

The executable schema defines these exact classes:

| Event | Purpose | Required payload highlights |
| --- | --- | --- |
| `AGENT_STATE_V1` | PR/worker lifecycle state | logical agent, run/slot, exact head/base, state, blocker, next action |
| `AGENT_TAKEOVER_V1` | Confirmed owner handoff | prior/new identity, exact head/base, authorization and next action |
| `AGENT_REVIEW_V1` | Review verdict | reviewer identity, exact head/base, synthetic merge, profile, verdict, blockers |
| `TASK_CONTRACT_REVISION_V1` | Material task contract change | issue/version, previous/new contract hashes and authorization |
| `ORPHAN_OBSERVED_V1` | Branch-without-PR observation | branch/head, observer, lifecycle state |
| `CLAIM_INTENT_V1` | Two-stage claim election | claim identity, issue/attempt, contract hash, agent/slot/run |
| `CAPACITY_PLAN_V2` | Append-only capacity plan | plan parent, role identities, slots, WIP/CI/review limits and hotspots |
| `SLOT_LEASE_V1` | Scheduled slot lease | slot/agent/run, action, epoch, TTL and reason |
| `CONTROL_ROLE_LEASE_V1` | Planner/Governor/Integrator lease | role/agent/run, action, epoch, TTL and reason |
| `MERGE_LEASE_V1` | Single-writer repository merge lease | repository, operation identity, expected main/PR heads, action, epoch and TTL |
| `CI_VERIFICATION_V1` | Provenance-bound CI evidence | head/base, synthetic merge, check/producer, workflow path/revision, runner and result |
| `MERGE_OUTCOME_V1` | Reconcile an ambiguous merge mutation | operation identity, confirmed/unknown outcome, expected/observed SHAs and source |

`MERGE_LEASE_V1` is the explicit serialization contract.  `ACQUIRE`,
`RENEW` and `TAKEOVER` require a positive TTL; `RELEASE` requires
`TTL_SECONDS=0`.  The expected main and PR head SHAs are mandatory on every
lease action and are checked again immediately before the merge API call.

`CI_VERIFICATION_V1` binds a result to the producer identity, workflow path,
workflow revision and runner trust class.  A green result from an unexpected
producer, stale head/base or unknown runner class is not merge evidence.

# CTRL-EVENT-RECONCILIATION — Retry, conflicts and unknown outcomes

The validator accepts repeated identical events with one
`CONTROL_EVENT_ID`.  It rejects different payloads under that ID as governance
corruption.  It preserves stream order for merge-operation fencing: after a
`MERGE_OUTCOME_V1` with `OUTCOME=UNKNOWN_OUTCOME`, a later merge lease
`ACQUIRE` or `TAKEOVER` for that operation is rejected until direct GitHub or
external-verifier reconciliation supplies a new outcome.  A timeout is never
silently converted to failure or success.

An external reconciler may bind events to live facts with the validator's
`--expected-head`, `--expected-base` and `--expected-producer` options.  Those
options are comparison hooks; the validator itself does not call GitHub and
cannot prove author trust, comment existence, branch ownership or merge state.

# CTRL-EVENT-VALIDATION-BOUNDARY — Evidence claim

Run the executable checks with:

```text
python docs/orchestration/control_event_lint.py <event-file>
python docs/orchestration/control_event_selftest.py
```

Passing these commands proves grammar/schema/hash/reconciliation behavior for
the supplied fixtures.  It does not promote any P0/P1 finding to `VERIFIED`,
does not create a GitHub lease, and does not substitute for independent CI,
runtime isolation, a trusted author check or direct server reconciliation.
