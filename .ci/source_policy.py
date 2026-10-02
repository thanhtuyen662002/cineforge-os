"""Explicit eligibility for the temporary documentation-only CI bootstrap.

Known CI scripts are tested by the policy job. Other executable/configuration
paths must get an explicit verification lane, not a docs-only green result.
This exception is not used once the recognized product tree is present.
"""
from __future__ import annotations

import re

DOCS_ONLY_FILES = frozenset({
    'AGENTS.md', 'README.md', 'global.json',
    '.github/ISSUE_TEMPLATE/agent-task.md',
    '.github/ISSUE_TEMPLATE/capacity-plan.md',
    '.github/ISSUE_TEMPLATE/epic.md',
    '.github/pull_request_template.md',
    '.github/workflows/cineforge-ci.yml',
    '.github/rulesets/cineforge-main.json',
    '.ci/README.md', '.ci/verify.py', '.ci/test_verify.py',
    '.ci/execution_policy.py', '.ci/test_execution_policy.py',
    '.ci/source_policy.py', '.ci/test_source_policy.py',
})
CLAIM_PATH = re.compile(r'\.cineforge/claims/i[1-9][0-9]*-a[1-9][0-9]*(?:\.context)?\.json')


def documentation_only_path(path: str) -> bool:
    if path in DOCS_ONLY_FILES or CLAIM_PATH.fullmatch(path):
        return True
    parts = path.split('/')
    return (len(parts) >= 2 and parts[0] == 'docs' and path.endswith('.md')
            and all(part and not part.startswith('.') for part in parts)
            and not any(ord(char) < 32 or char == '\\' for char in path))


def validate_documentation_only(paths: set[str]) -> None:
    unknown = sorted(path for path in paths if not documentation_only_path(path))
    if unknown:
        raise ValueError('Unclassified source cannot use docs-only CI: ' + ', '.join(unknown[:5]))
