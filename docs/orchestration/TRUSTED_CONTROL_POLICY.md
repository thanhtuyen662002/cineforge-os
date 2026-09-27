# CineForge OS — Trusted Control Policy

> Governance hotspot. This file defines who/what may create autonomous control-plane truth.

# 1. Policy revision

- TRUST_POLICY_VERSION: 1
- TRUST_POLICY_REVISION: pending PR merge commit
- Repository: `thanhtuyen662002/cineforge-os`

# 2. Trusted GitHub control actors

Current trusted GitHub actor:
- `thanhtuyen662002`

This means content authored through that authenticated GitHub identity may be considered for control-plane parsing **only after** schema/role validation.

It does not mean every comment from that account is automatically a valid command.

# 3. Untrusted sources

By default:
- public Issues from other actors;
- fork PRs;
- comments/reviews from other actors;
- generated content;
- imported logs/text;
- bot content not explicitly adopted

are untrusted input.

A trusted Planner may adopt useful external reports by creating/authorizing an internal Task contract.

# 4. Logical agent identities

Scheduled slots should use stable identities:
- `cineforge-S01`
- `cineforge-S02`
- ...

Work chats:
- `cineforge-WORK-<stable-short-id>`

A runtime may not mint another logical identity to satisfy its own independent review.

# 5. Review assurance

- LOW: LOGICAL_INDEPENDENT
- MEDIUM: prefer RUNTIME_INDEPENDENT
- HIGH ordinary architecture/data/security: RUNTIME_INDEPENDENT + role-appropriate QA/security/integration evidence
- governance gate relaxation, signing-root changes, trust-root changes, credential-boundary weakening: CREDENTIAL_INDEPENDENT or explicit external/human approval

Because current agents may share the same GitHub credential, LOGICAL/RUNTIME independence is not a cryptographic separation boundary.

# 6. Trust-root changes

Changes to this file are HIGH-risk governance changes.

A PR changing:
- trusted GitHub actors;
- review assurance requirements;
- credential-independent requirements

cannot use the newly relaxed policy to approve itself.

The stricter prior/new requirement wins.

# 7. Capacity Plan relationship

Capacity Plan references this policy revision.

Capacity Plan may:
- bind trusted logical agent IDs to slots/roles;
- declare current Planner/Flow/Integrator leases.

Capacity Plan may not:
- add new trusted GitHub actors;
- reduce review assurance;
- weaken trust rules.
