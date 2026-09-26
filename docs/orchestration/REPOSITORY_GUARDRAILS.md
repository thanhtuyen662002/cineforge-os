# CineForge OS — Repository Guardrails

> Current observation at design time:
> - default branch: main
> - repository visibility: public
> - GitHub rulesets endpoint returned no configured rulesets
> - repository auto-merge setting is disabled
> - branch-protection administration could not be verified/modified through the current GitHub integration

The autonomous operating model therefore MUST NOT assume GitHub itself enforces every rule yet.

# 1. Protocol-enforced rules now

Until repository-native protection is configured:
- implementation agents do not push feature code directly to main;
- every schedulable coding task uses Issue → Claim branch → Draft/Open PR;
- Integrator checks CI/review for the current HEAD + BASE/merge verification context before merge;
- no force-push that destroys useful shared evidence;
- no secrets in repo;
- main remains the authoritative base.

# 2. Target repository-native protections

When administration capability is available, configure main to:
- require pull request before merge;
- prohibit force pushes;
- prohibit branch deletion;
- require exact status checks for current CI gate;
- require conversation resolution where practical;
- require branch to be up-to-date/merge-queue policy according to CI design;
- restrict bypass to emergency/control policy;
- optionally enable GitHub auto-merge for eligible PRs.

# 3. Agent review identity caveat

Many logical agents may operate through the same GitHub account/integration.

Therefore GitHub's human reviewer identity alone cannot prove logical independent agent review.

Independent agent review remains recorded through:
- AGENT_INSTANCE_ID;
- REVIEW_HEAD_SHA;
- REVIEW_PROFILE;
- structured review evidence.

Repository-native review requirements must be chosen so they do not accidentally require the user to manually approve every PR.

# 4. Public repository security

Never commit:
- signing private keys;
- updater private keys;
- API secrets;
- web/browser auth state;
- production credentials;
- private unreleased user media.

CI/release secrets belong in approved secret/signing infrastructure.

# 5. Auto-merge

Current repository setting reports auto-merge disabled.

Until enabled:
- Integrator performs merge promptly once gates pass.

If enabled later:
- it is an execution optimization only;
- all task/review/CI gates remain unchanged.

# 6. Enforcement drift

Flow Governor/QA periodically verifies:
- rules/settings still match policy when readable;
- required CI names did not drift;
- no accidental direct-main implementation commits;
- no disabled security/release gate.

A detected guardrail drift becomes an infrastructure/control task.


# 7. Deep-audit enforcement gaps

Until repository-native rules are configured:
- one compromised trusted write credential can bypass protocol;
- logical AGENT_INSTANCE_ID separation is not cryptographic identity separation;
- manual merge correctness requires the Integrator/MERGE_LEASE protocol;
- public Issues/comments must be trust-filtered before scheduling.

Target configuration should avoid requiring a GitHub “approval” that all same-account agents are technically unable to provide. Machine/agent review assurance may need a trusted custom gate or separate credential identities.

# 8. Baseline-lock transition

After `docs/orchestration/BASELINE_LOCK.md` exists, direct-main governance edits are forbidden by project policy except a separately defined emergency path.

Repository-native enforcement remains a bootstrap target because policy-only enforcement is weaker.
