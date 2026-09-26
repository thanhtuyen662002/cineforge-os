# CineForge OS — Orchestration Baseline Lock

> **LOCKED_AT_PARENT_SHA:** `9747f5bdc06877557954ea4cf66fedc8c8dc9e75`
> **Effective:** this file's merge/direct-bootstrap commit and later.

# 1. Purpose

All orchestration/governance work before this lock is treated as bootstrap construction of the autonomous development control plane.

From this lock forward, routine changes to the control plane must obey the same workflow it defines.

# 2. Protected governance surface

The following must no longer be changed directly on `main` during ordinary operation:

- `AGENTS.md`
- `docs/orchestration/**`
- `.github/workflows/**`
- `.github/actions/**`
- `.github/ISSUE_TEMPLATE/**`
- `.github/pull_request_template.md`
- repository CI/release/signing governance files
- scripts that can weaken/alter verification or privileged execution

Required path:

```text
Trusted Task Issue
→ deterministic claim branch
→ Draft PR
→ HIGH-risk governance review
→ required CI/security evidence
→ Integrator / Merge Queue
→ merge
```

# 3. Non-retroactivity

A governance PR cannot lower the requirements used to approve itself.

Use:
- policy in force at claim/base context; and
- proposed policy when stricter.

The stricter applicable gate wins.

# 4. Emergency

No emergency direct-main bypass is assumed.

If an emergency bypass is ever defined, it must be:
- explicit;
- narrowly scoped;
- actor/reason recorded;
- time-limited;
- followed by reconciliation/review.

# 5. Current repository-native enforcement status at lock time

Observed during audit:
- `main` branch protection: not enabled;
- rulesets: none;
- GitHub auto-merge: disabled;
- `.github/workflows`: not yet present.

Therefore this baseline lock is currently a **project governance rule**, not yet a fully repository-enforced security boundary.

Configuring repository-native protections and initial CI remains a bootstrap-readiness requirement before broad 10–15 slot autonomous coding.

# 6. Trust warning

The repository is public.

Public Issues/PRs/comments are untrusted unless authorized by the trusted control plane.
Different AGENT_INSTANCE_ID values using the same GitHub credential do not constitute cryptographic identity separation.

# 7. Next validation boundary

The next high-value validation is empirical:
- live Task claim race;
- scheduled slot overlap;
- Planner/Flow/Integrator failover;
- CI/review backpressure;
- two merge-ready PR serialization;
- public prompt-injection attempt;
- GitHub partial failure;
- Windows storage validation.



# 8. One-time bootstrap enablement exception

This baseline was locked before repository-native CI/protection existed. A strict requirement for CI to create the first CI would deadlock the repository.

A one-time `BOOTSTRAP_ENABLEMENT` exception therefore exists **only while Bootstrap Readiness explicitly reports the required verifier/protection primitives as absent**.

Allowed scope:
- create the initial trusted CI workflow/parser/check producer;
- create the initial machine metadata validator;
- configure/test initial branch/ruleset protection;
- make the minimum governance corrections required for those primitives to function.

Forbidden scope:
- product feature implementation;
- unrelated architecture changes;
- relaxing trust/review/security requirements;
- broad dependency/runtime changes not required by bootstrap.

Required evidence:
- explicit repository-owner/external approval;
- exact diff inspection;
- pinned source digest/commit;
- minimal GitHub token/workflow permissions;
- no self-approval solely from the newly introduced verifier;
- recorded bootstrap attestation.

Closure condition:
- initial trusted CI executes successfully on a disposable/controlled PR;
- metadata parser/validator is independently inspected;
- branch/ruleset protection is verified;
- control actor/App permissions are verified.

After closure, `BOOTSTRAP_ENABLEMENT` is permanently disabled for ordinary governance work.

A future disaster-recovery bypass, if ever needed, is a separate mechanism and must not reuse this bootstrap exception casually.
