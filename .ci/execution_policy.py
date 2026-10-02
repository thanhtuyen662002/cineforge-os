"""Executable contract for the bounded CI bootstrap, not a general shell linter.

Match executable steps and evidence bindings, not command substrings. A skipped
step, shell comment, or literal success must never replace a mandatory check.
Changes to this contract/verifier still require independent governance review;
matching a workflow against code from its own PR is not trust-root approval.
"""
from __future__ import annotations

CHECKOUT = {
    "uses": "actions/checkout@11d5960a326750d5838078e36cf38b85af677262",
    "with": {"fetch-depth": 0, "persist-credentials": False},
}
NODE = {
    "uses": "actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020",
    "with": {"node-version": "22.16.0"},
}
DOTNET = {
    "uses": "actions/setup-dotnet@67a3573c9a986a3f9c594539f4ab511d57bb3ce9",
    "with": {"global-json-file": "global.json"},
}
CONTEXT_ARTIFACT = {
    "if": "always()",
    "uses": "actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02",
    "with": {
        "name": "ci-context-${{ github.run_id }}-${{ github.run_attempt }}",
        "path": "${{ runner.temp }}/cineforge-ci-context.json",
        "if-no-files-found": "warn", "retention-days": 3,
    },
}
WINDOWS_TOOLS = """$ErrorActionPreference = 'Stop'
node --version
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
dotnet --version
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
python --version
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
$PSVersionTable.PSVersion.ToString()
git status --porcelain=v1 --untracked-files=all"""
WINDOWS_BUILD = r"""$ErrorActionPreference = 'Stop'
& .\packaging\build_windows.ps1 -Mode SingleFile
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }"""
WINDOWS_IDENTITY = """$ErrorActionPreference = 'Stop'
$exe = Get-Item -LiteralPath dist/CineForge-OneFile/CineForge.exe
$hash = (Get-FileHash -LiteralPath $exe.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
Write-Output ('CINEFORGE_EXE_BYTES=' + $exe.Length)
Write-Output ('CINEFORGE_EXE_SHA256=' + $hash)
git diff --exit-code
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }"""
AGGREGATE = r"""set -euo pipefail
printf 'policy=%s docs=%s runtime=%s core_app=%s windows=%s\n' "$POLICY" "$DOCS" "$RUNTIME" "$CORE_APP" "$WINDOWS"
test "$POLICY" = success
test "$DOCS" = success
case "$RUNTIME" in
  true) test "$CORE_APP" = success; test "$WINDOWS" = success ;;
  false) test "$CORE_APP" = skipped; test "$WINDOWS" = skipped ;;
  *) echo 'Missing or invalid scope evidence'; exit 1 ;;
esac
echo 'CINEFORGE_REQUIRED=PASS (test evidence; not review or release approval)'"""
RESULT_BINDINGS = {
    "POLICY": "${{ needs.policy.result }}", "DOCS": "${{ needs.docs.result }}",
    "RUNTIME": "${{ needs.policy.outputs.runtime }}",
    "CORE_APP": "${{ needs.core-app.result }}", "WINDOWS": "${{ needs.windows-package.result }}",
}
GLOBAL_ENV = {
    "CI": "true", "PYTHONDONTWRITEBYTECODE": "1",
    "DOTNET_CLI_TELEMETRY_OPTOUT": "1", "DOTNET_NOLOGO": "1",
}
STEPS = {
    "policy": [
        CHECKOUT,
        {"run": "python .ci/verify.py policy"},
        {"run": "python -m unittest discover -s .ci -p 'test_*.py' -v"},
        {"id": "context", "run": "python .ci/verify.py context"},
        CONTEXT_ARTIFACT,
    ],
    "docs": [CHECKOUT, {"run": "python .ci/verify.py docs"}],
    "core-app": [
        CHECKOUT, NODE,
        {"run": "npm test --prefix core"},
        {"run": "npm ci --prefix app --no-audit --no-fund"},
        {"run": "npm test --prefix app -- --run"},
        {"run": "npm run build --prefix app"},
        {"run": "git diff --exit-code && git diff --cached --exit-code"},
    ],
    "windows-package": [
        CHECKOUT, NODE, DOTNET,
        {"shell": "powershell", "run": WINDOWS_TOOLS},
        {"shell": "powershell", "run": WINDOWS_BUILD},
        {"shell": "powershell", "run": WINDOWS_IDENTITY},
    ],
    "required": [{"shell": "bash", "run": AGGREGATE}],
}


def _expect(actual: object, expected: object, location: str) -> None:
    # JSON serialization distinguishes true/1 and false/0, unlike Python ==.
    # No normalization of scripts, conditions or evidence expressions is safe.
    import json
    if json.dumps(actual, sort_keys=True) != json.dumps(expected, sort_keys=True):
        raise ValueError(f"CI execution contract mismatch: {location}")


def check_execution_contract(workflow: dict) -> None:
    """Reject any executable drift; only display names and bounded timeouts vary."""
    _expect(sorted(workflow), sorted(("name", "on", "permissions", "concurrency", "env", "jobs")), "workflow keys")
    _expect(workflow.get("env"), GLOBAL_ENV, "global environment")
    _expect(workflow.get("concurrency"), {
        "group": "cineforge-ci-${{ github.event_name }}-${{ github.ref }}",
        "cancel-in-progress": True,
    }, "concurrency")
    jobs = workflow.get("jobs", {})
    _expect(sorted(jobs), sorted(STEPS), "jobs")
    for job_id, expected_steps in STEPS.items():
        job = jobs[job_id]
        # Other structural fields (runner, name, timeout) are checked by verify.
        permitted = {"name", "runs-on", "timeout-minutes", "steps"}
        if job_id == "policy":
            permitted.add("outputs")
            _expect(job.get("outputs"), {"runtime": "${{ steps.context.outputs.runtime }}"}, "runtime output binding")
        else:
            permitted.add("needs")
            expected_needs = ["policy", "docs", "core-app", "windows-package"] if job_id == "required" else ["policy"]
            _expect(job.get("needs"), expected_needs, f"{job_id}.needs")
        if job_id in ("core-app", "windows-package", "required"):
            permitted.add("if")
        if job_id == "required":
            permitted.add("env")
            _expect(job.get("env"), RESULT_BINDINGS, "aggregate result bindings")
        _expect(sorted(job), sorted(permitted), f"{job_id} keys")
        steps = job.get("steps", [])
        if not isinstance(steps, list) or not all(isinstance(step, dict) for step in steps):
            raise ValueError(f"CI execution contract mismatch: {job_id}.steps")
        executable_steps = [{key: value for key, value in step.items() if key != "name"} for step in steps]
        _expect(executable_steps, expected_steps, f"{job_id}.steps")
