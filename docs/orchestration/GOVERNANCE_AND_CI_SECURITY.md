# CineForge OS — Governance and CI Security

> Status: mandatory control-plane security policy.

# 1. Why this exists

Autonomous agents can potentially edit:
- AGENTS.md;
- orchestration protocols;
- GitHub workflow files;
- CI scripts;
- release/update/signing configuration;
- dependency/bootstrap scripts.

Those files define how the same agents are checked.

A worker must never be able to weaken its own gate and then rely on the weakened gate for the same change.

# 2. Governance hotspot

The following are CONTROL_PLANE_HOTSPOT by default:
- `AGENTS.md`
- `.github/workflows/**`
- `.github/actions/**`
- `.github/ISSUE_TEMPLATE/**`
- `.github/pull_request_template.md`
- `docs/orchestration/**`
- branch/ruleset/release policy files
- signing/update scripts
- CI bootstrap/runner scripts
- dependency scripts that execute with CI/release credentials

Planner marks such tasks:
- risk: HIGH
- parallel_class: HOTSPOT
- review_profiles: integration + security/qa

# 3. Non-retroactivity

A governance PR is evaluated under:
- the policy/gates in force at its claim/base context; and
- the proposed new policy where it is stricter.

Use the stricter applicable requirement.

A governance change does not reduce the requirements for its own PR.

After merge, the new policy applies prospectively to subsequent claims/reviews.

# 4. Separation

Do not combine:
- product feature implementation; and
- a relaxation/change of the gates that approve that feature

in one PR unless the change is purely mechanical and does not reduce assurance.

If a product task requires a governance change:
1. merge governance/contract change first;
2. then implement product task under the new merged rule.

# 5. CI workflow permissions

GitHub Actions should use least privilege:
- default token permissions read-only where possible;
- grant write permissions only to specific jobs that require them;
- build/test jobs should not have repository write authority;
- release/signing credentials only in explicit protected release jobs;
- never expose secrets to arbitrary PR code.

Avoid `pull_request_target` with untrusted checkout/execution unless a dedicated security design proves it safe.

# 6. Third-party actions

For production CI/release:
- pin third-party actions to immutable commit SHAs where practical;
- review publisher/source;
- minimize action count;
- record controlled upgrades.

# 7. Generated/build scripts

Scripts executed by CI are part of the trust boundary.

Changes to:
- build scripts;
- installer scripts;
- package hooks;
- code-generation scripts;
- test harness bootstrap

receive the same risk review if they can access privileged CI context.

# 8. Review independence

A governance/security PR cannot satisfy required independent review using the same logical AGENT_INSTANCE_ID as author.

If only one logical reviewer is available:
- PR remains unmerged unless explicit emergency governance exists;
- do not mint a fake reviewer identity.

# 9. Public repository hygiene

Issue/PR/comments/logs must never include:
- credentials;
- API keys;
- browser cookies/session state;
- signing keys;
- private client data;
- confidential media;
- sensitive filesystem paths when avoidable.

An external-blocker note records only the type of missing credential/account, not its value.

# 10. Governance drift

Flow Governor/QA periodically checks:
- expected control files still exist;
- CI workflow names/gates did not silently disappear;
- privileged jobs did not gain broader permissions unexpectedly;
- ruleset/branch guardrail state when readable;
- direct-main implementation commits did not bypass protocol.

Detected drift creates a HIGH-risk control task.

# 11. Emergency policy

Emergency bypass, if ever defined, must:
- be explicit;
- be narrowly scoped;
- record actor/reason;
- expire;
- create follow-up verification;
- never silently become normal procedure.

No emergency bypass is assumed by default.
