# CineForge OS — GitHub Metadata Conventions

Metadata helps agents scan quickly but is not a substitute for Issue/PR truth.

# 1. Recommended labels

If repository labels are provisioned, use namespaces:

## State
- state:ready
- state:blocked
- state:claimed
- state:waiting-ci
- state:waiting-review
- state:merge-ready

## Type
- type:epic
- type:feature
- type:bug
- type:refactor
- type:test
- type:infra
- type:unblock

## Area
- area:core
- area:data
- area:desktop
- area:ui
- area:story-canon
- area:timeline
- area:audio
- area:media-runtime
- area:connectors
- area:security-rights
- area:ci-release

## Risk
- risk:low
- risk:medium
- risk:high

## Flow
- flow:critical-path
- flow:hotspot
- flow:external-blocker
- flow:needs-human

# 2. Canonical truth if labels are missing/stale

Labels are convenience projections.

Agents must derive truth from:
- Issue dependency contract;
- open Claim PR;
- PR state/comments;
- exact-head CI;
- merge status.

A missing label must never cause duplicate work.

# 3. Structured PR comments

State transition comment format:

```text
AGENT_STATE
AGENT_INSTANCE_ID=<id>
SLOT_ID=<id>
HEAD_SHA=<sha>
STATE=<state>
BLOCKER=<none|description>
NEXT_ACTION=<description>
```

Review:

```text
AGENT_REVIEW
REVIEW_AGENT_INSTANCE_ID=<id>
REVIEW_HEAD_SHA=<sha>
REVIEW_PROFILE=<domain|qa|security|integration>
VERDICT=<APPROVE|REQUEST_CHANGES|COMMENT>
BLOCKERS=<none|description>
```

Takeover:

```text
AGENT_TAKEOVER
FROM=<prior id>
TO=<new id>
HEAD_SHA=<sha>
REASON=<reason>
NEXT_ACTION=<description>
```

# 4. Branch names

Task attempt:
`agent/i<issue>-a<attempt>-<slug>`

Examples:
- agent/i42-a1-command-envelope
- agent/i42-a2-command-envelope

The deterministic next attempt is part of distributed claim safety.

# 5. Commit messages

Prefer:
- feat(core): ...
- fix(ci): ...
- test(storage): ...
- refactor(api): ...
- docs(orchestration): ...

Commit formatting is useful but never used as task identity.
