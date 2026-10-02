"""Dependency-free bootstrap checks. JSON workflows are valid YAML 1.2.

Author-side checks are not independent governance approval. This verifier itself
must be reviewed under the existing, stricter governance policy before promotion.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys

REPO = "thanhtuyen662002/cineforge-os"
WORKFLOW = ".github/workflows/cineforge-ci.yml"
ACTIONS = {
    "actions/checkout@11d5960a326750d5838078e36cf38b85af677262",
    "actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020",
    "actions/setup-dotnet@67a3573c9a986a3f9c594539f4ab511d57bb3ce9",
    "actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02",
}
BASELINE = (
    "AGENTS.md", "docs/orchestration/BASELINE_LOCK.md",
    "docs/orchestration/BOOTSTRAP_READINESS.md",
    "docs/orchestration/CI_REVIEW_MERGE_PROTOCOL.md",
    "docs/orchestration/GOVERNANCE_AND_CI_SECURITY.md",
)
RUNTIME = (
    "core/package.json", "core/core.mjs", "core/schema.mjs", "core/http.mjs",
    "app/package.json", "app/package-lock.json", "app/src/App.tsx",
    "packaging/build_windows.ps1", "packaging/build_single_file.ps1",
    "packaging/smoke_test.ps1", "packaging/bootstrap/CineForge.Bootstrap.csproj",
    "docs/orchestration/doc_lint.py",
    "docs/orchestration/control_event_selftest.py",
    "docs/orchestration/architecture_closure_gate.py",
    "docs/orchestration/architecture_closure_gate_selftest.py",
    "docs/orchestration/promotion_lane_gate.py",
)
JOB_IDS = {"policy", "docs", "core-app", "windows-package", "required"}


def require(condition: bool, message: str) -> None:
    if not condition:
        raise ValueError(message)


def unique_pairs(pairs):
    result = {}
    for key, value in pairs:
        require(key not in result, f"Duplicate JSON key: {key}")
        result[key] = value
    return result


def read_json(path: Path):
    require(path.stat().st_size <= 512_000, "Oversized CI JSON")
    return json.loads(path.read_text(encoding="utf-8"), object_pairs_hook=unique_pairs)


def check_policy(workflow: dict) -> None:
    require(workflow.get("permissions") == {"contents": "read"}, "Read-only contents permission required")
    triggers = workflow.get("on", {})
    require(set(triggers) == {"push", "pull_request", "workflow_dispatch"}, "Unexpected or missing trigger")
    require(not triggers["workflow_dispatch"], "Dispatch inputs are not supported")
    require(triggers["push"].get("branches") == ["main", "agent/**", "ci/bootstrap-*"], "Push scope changed")
    require(set(triggers["push"]) == {"branches"}, "Push path/tag filters can skip a required check")
    require(set(triggers["pull_request"]) == {"types"}, "PR filters can skip a required check")
    require(set(triggers["pull_request"]["types"]) == {"opened", "synchronize", "reopened", "ready_for_review", "edited"}, "PR event scope changed")
    require(workflow.get("concurrency", {}).get("cancel-in-progress") is True, "Bounded concurrency required")
    jobs = workflow.get("jobs", {})
    require(set(jobs) == JOB_IDS, "Required job missing or unexpected job added")
    require(jobs["required"].get("name") == "CineForge required", "Stable aggregate check required")
    require(jobs["required"].get("if") == "always()", "Aggregate must run after failed/skipped jobs")
    require(set(jobs["required"].get("needs", [])) == JOB_IDS - {"required"}, "Aggregate must depend on all gates")
    require(not jobs["policy"].get("if") and not jobs["docs"].get("if"), "Policy/docs cannot be conditional")
    for name in ("core-app", "windows-package"):
        require(jobs[name].get("if") == "needs.policy.outputs.runtime == 'true'", "Runtime gating must use validated scope")
    for name, job in jobs.items():
        require(job.get("runs-on") == ("windows-2022" if name == "windows-package" else "ubuntu-24.04"), "Unexpected runner")
        require(1 <= job.get("timeout-minutes", 0) <= 35, "Bounded job timeout required")
        require("permissions" not in job and "environment" not in job and "secrets" not in job, "Privileged job configuration forbidden")
        require(not job.get("continue-on-error"), "Job failure must propagate")
        require("uses" not in job, "Unreviewed reusable workflow forbidden")
        for step in job.get("steps", []):
            require(not step.get("continue-on-error"), "Step failure must propagate")
            action = step.get("uses")
            if action:
                require(action in ACTIONS, "Action must use reviewed immutable SHA")
                if action.startswith("actions/checkout@"):
                    require(step.get("with", {}).get("persist-credentials") is False, "Checkout credentials must not persist")
                    require(step["with"].get("fetch-depth") == 0, "Source/context history required")
                    require(set(step["with"]) == {"fetch-depth", "persist-credentials"}, "Custom source checkout forbidden")
            if "run" in step:
                require("${{" not in step["run"], "Pass context through env, not shell interpolation")
    serialized = json.dumps(workflow)
    require("secrets." not in serialized and "id-token" not in serialized, "Secret/OIDC access forbidden")
    required_commands = (
        "python .ci/verify.py policy", "python .ci/verify.py context",
        "python .ci/verify.py docs", "npm test --prefix core",
        "npm ci --prefix app --no-audit --no-fund", "npm test --prefix app -- --run",
        "npm run build --prefix app", "build_windows.ps1 -Mode SingleFile",
    )
    runs = "\n".join(s.get("run", "") for j in jobs.values() for s in j.get("steps", []))
    for command in required_commands:
        require(command in runs, f"Missing mandatory command: {command}")
    require("-SkipTests" not in runs and "-SkipCoreBundle" not in runs, "Packaging cannot skip test/runtime gates")


def classify(paths: set[str], previous: set[str] | None = None) -> bool:
    for path in BASELINE:
        require(path in paths, f"Missing baseline file: {path}")
    runtime = any(p.startswith(("core/", "app/", "packaging/")) for p in paths)
    before_runtime = previous is not None and any(p.startswith(("core/", "app/", "packaging/")) for p in previous)
    require(not before_runtime or runtime, "Runtime removal cannot become docs-only PASS")
    if runtime:
        for path in RUNTIME:
            require(path in paths, f"Incomplete runtime source: {path}")
        require(any(p.startswith("core/") and p.endswith(".test.mjs") for p in paths), "Core tests missing")
        require(any(p.startswith("app/") and (p.endswith(".test.ts") or p.endswith(".test.tsx")) for p in paths), "UI tests missing")
    return runtime


def git(*args: str) -> str:
    return subprocess.check_output(["git", *args], text=True, encoding="utf-8").strip()


def tree(ref: str) -> set[str]:
    require(bool(re.fullmatch(r"[0-9a-f]{40}", ref)), "Expected exact Git SHA")
    return set(git("ls-tree", "-r", "--name-only", ref).splitlines())


def context() -> None:
    actual = git("rev-parse", "HEAD")
    expected = os.environ["GITHUB_SHA"]
    require(actual == expected, "Checked-out commit does not match event SHA")
    require(os.environ["GITHUB_REPOSITORY"] == REPO, "Unexpected repository")
    event = read_json(Path(os.environ["GITHUB_EVENT_PATH"]))
    kind = os.environ["GITHUB_EVENT_NAME"]
    pr = event.get("pull_request")
    head = pr["head"]["sha"] if kind == "pull_request" else actual
    base = pr["base"]["sha"] if kind == "pull_request" else event.get("before")
    if not base or base == "0" * 40:
        parents = git("rev-list", "--parents", "-n", "1", actual).split()
        base = parents[1] if len(parents) > 1 else None
    if kind == "pull_request":
        require(pr["base"]["repo"]["full_name"] == REPO, "Unexpected PR base repository")
        subprocess.run(["git", "merge-base", "--is-ancestor", head, actual], check=True)
        subprocess.run(["git", "merge-base", "--is-ancestor", base, actual], check=True)
    paths = tree(actual)
    runtime = classify(paths, tree(base) if base else None)
    for path in (*BASELINE, *(RUNTIME if runtime else ())):
        require(not Path(path).is_symlink() and Path(path).is_file(), f"Non-regular required file: {path}")
        require(Path(path).stat().st_size > 0, f"Empty required file: {path}")
    report = {
        "schema_version": 1, "repository": REPO, "event": kind,
        "head_sha": head, "base_sha": base, "tested_sha": actual,
        "verification_class": "PR_MERGE_CONTEXT" if kind == "pull_request" else "PUSH_OR_DISPATCH_HEAD",
        "workflow_ref": os.environ.get("GITHUB_WORKFLOW_REF"),
        "workflow_sha": os.environ.get("GITHUB_WORKFLOW_SHA"),
        "workflow_content_sha256": hashlib.sha256(Path(WORKFLOW).read_bytes()).hexdigest(),
        "run_id": os.environ["GITHUB_RUN_ID"], "attempt": os.environ["GITHUB_RUN_ATTEMPT"],
        "runner_trust_class": "GITHUB_HOSTED_EPHEMERAL",
        "runtime": runtime, "scope": "PRODUCT" if runtime else "DOCUMENTATION_BASELINE_ONLY",
        "independent_review": "NOT_ESTABLISHED_BY_CI", "release_authorized": False,
    }
    text = json.dumps(report, indent=2)
    (Path(os.environ["RUNNER_TEMP"]) / "cineforge-ci-context.json").write_text(text + "\n", encoding="utf-8")
    with open(os.environ["GITHUB_OUTPUT"], "a", encoding="utf-8") as output:
        output.write(f"runtime={str(runtime).lower()}\n")
    with open(os.environ["GITHUB_STEP_SUMMARY"], "a", encoding="utf-8") as summary:
        summary.write("## Verified source context\n```json\n" + text + "\n```\n")
    print(text)


def docs() -> None:
    runtime = classify(tree(git("rev-parse", "HEAD")))
    if not runtime:
        print("DOCS_BASELINE_FILES=PASS; runtime/control-script execution=NOT_APPLICABLE (docs-only source)")
        return
    commands = [
        [sys.executable, "docs/orchestration/doc_lint.py", "--root", "."],
        [sys.executable, "docs/orchestration/control_event_selftest.py"],
        [sys.executable, "docs/orchestration/promotion_lane_gate.py", "--root", "."],
        [sys.executable, "docs/orchestration/architecture_closure_gate.py", "--root", ".", "--skip-promotion"],
        [sys.executable, "docs/orchestration/architecture_closure_gate_selftest.py"],
    ]
    for command in commands:
        print("RUN", " ".join(command), flush=True)
        subprocess.run(command, check=True, timeout=240)
    print("DOCS_CONTROL=PASS (design/test evidence, not production closure)")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("command", choices=("policy", "context", "docs"))
    args = parser.parse_args()
    if args.command == "policy":
        check_policy(read_json(Path(WORKFLOW)))
        print("CI_POLICY=PASS")
    elif args.command == "context":
        context()
    else:
        docs()


if __name__ == "__main__":
    try:
        main()
    except (ValueError, OSError, KeyError, subprocess.SubprocessError) as error:
        print(f"CI_VERIFICATION=FAIL: {error}", file=sys.stderr)
        sys.exit(1)
