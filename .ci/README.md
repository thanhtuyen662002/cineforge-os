# CineForge CI bootstrap — Issue #67 / PR #68

This is CI infrastructure, not product approval or a release pipeline.

## Execution

`.github/workflows/cineforge-ci.yml` uses JSON syntax, a YAML 1.2 subset, so the
policy validator can reject duplicate keys without adding a parser dependency.
Every action is pinned to an immutable GitHub commit. Default token permission
is `contents: read`; checkout does not persist credentials; no secrets, OIDC,
self-hosted runner, reusable workflow, privileged trigger, publication or signing
is used. All jobs have bounded timeouts; superseded same-ref/event runs cancel.

Pushes to main, agent branches and controlled `ci/bootstrap-*` branches run the
workflow. PR events run on GitHub's actual merge-context commit, including
stacked PRs. Context records distinguish event HEAD, BASE and tested SHA and
include workflow/run identity. The small context artifact expires after 3 days.
No EXE, user media or production data is uploaded.

`CineForge required` always runs and fails if any required upstream gate fails,
is cancelled or unexpectedly skipped. A source tree with no runtime can pass
only as DOCUMENTATION_BASELINE_ONLY. Partial runtime trees, removed runtime,
missing lockfiles and missing test files fail; they do not become skipped PASS.
The aggregate is a test result, not independent review or release permission.

Runtime source runs actual Core tests and locked UI installation/tests/build on
Ubuntu, then the existing SingleFile builder on Windows. That builder owns the
portable, single-file, restart and tamper smoke tests. Windows environment/version
output alone is not packaging evidence. Node 22.16.0 matches the inherited
baseline; the build SDK is pinned by global.json. Runner OS labels are fixed,
but hosted images still update; actual version output is retained in run logs.
These are isolated developer builds, not a hermetic or signed production release.

## Bootstrap verification branches

The main-targeting PR changes only CI/config/claim files. A non-mergeable
`ci/bootstrap-i67-runtime` branch can carry the same CI files on exact product
source 85d7ae1a3e39ee20bdeb3cf0a28b4cf71ed53c4b. It is evidence for that combined
test commit only, not evidence of a merge into main or completion of Issue #64.

A separate `ci/bootstrap-i67-negative` branch adds one deliberately failing
unittest. It must fail Policy and then CineForge required. Never merge that
branch or transplant its intentional failure. Real application tests must not
be weakened to achieve bootstrap PASS. Positive and negative hosted results,
check-producer identity and independent review are required before trusting CI.

## Ruleset rollout

`.github/rulesets/cineforge-main.json` is intentionally DISABLED and is not
applied merely by being committed. The proposed rules require a PR, one genuine
approval, stale-review dismissal, last-push approval and resolved threads;
block force-push/deletion; and require the up-to-date `CineForge required` check
from GitHub Actions (expected integration 15368, verify from actual check runs).
No bypass actor is installed. Ensure a real eligible reviewer and the legitimate
merge/recovery path exist before activation; a sole author cannot approve their
own PR and an agent must not fabricate a second identity.

Activation requires repository Administration access, independent bootstrap
review, positive/negative check evidence, and an actual ruleset read-back.
The current connector has content/workflow/issue writes but exposes no ruleset
administration write. Do not invent or embed an administrator token to work
around that. An administrator may import the JSON through Settings > Rules >
Rulesets; keep it disabled until the rollout gates above are met. After review,
set enforcement to active and verify a disposable PR cannot bypass the check.

Existing product branches do not automatically inherit this new workflow.
After the bootstrap PR is reviewed and merged, propagate it by normal reviewed
integration to the active stack and rerun each current HEAD/BASE. Do not claim
that enabling Actions or committing this file retroactively tested old PRs.

## Local author checks

```
python .ci/verify.py policy
python -m unittest discover -s .ci -p 'test_*.py' -v
```

These tests exercise the CI implementation, not independent governance approval.
