"""Review regressions: unknown source scope and staged Windows build changes."""
import copy
import json
import os
from pathlib import Path
import shlex
import shutil
import subprocess
import tempfile
import unittest

from verify import BASELINE, check_policy, classify

ROOT = Path(__file__).resolve().parents[1]
WORKFLOW = json.loads((ROOT / '.github/workflows/cineforge-ci.yml').read_text(encoding='utf-8'))


class DocumentationScopeTests(unittest.TestCase):
    def test_unknown_product_roots_fail_closed(self):
        for path in ('desktop/main.ts', 'src/app.ts', 'tools/build.py',
                     'scripts/run.sh', 'package.json', 'server.mjs'):
            with self.subTest(path=path), self.assertRaisesRegex(ValueError, 'Unclassified source'):
                classify(set(BASELINE) | {path})

    def test_documentation_directory_does_not_hide_executable_source(self):
        for path in ('docs/example.py', 'docs/example.md.py',
                     'docs/site/index.js', 'docs/Makefile'):
            with self.subTest(path=path), self.assertRaisesRegex(ValueError, 'Unclassified source'):
                classify(set(BASELINE) | {path})

    def test_unvalidated_workflow_and_ci_script_fail_closed(self):
        for path in ('.github/workflows/other.yml', '.github/actions/run/action.yml',
                     '.ci/unreviewed.py', '.cineforge/claims/run.sh', '.hidden/entry.js'):
            with self.subTest(path=path), self.assertRaisesRegex(ValueError, 'Unclassified source'):
                classify(set(BASELINE) | {path})

    def test_docs_and_known_bootstrap_files_remain_eligible(self):
        paths = set(BASELINE) | {
            'README.md', 'docs/architecture/new.md',
            '.github/ISSUE_TEMPLATE/agent-task.md', '.github/pull_request_template.md',
            '.github/workflows/cineforge-ci.yml', '.github/rulesets/cineforge-main.json',
            '.cineforge/claims/i67-a1.json', 'global.json',
            '.ci/README.md', '.ci/verify.py', '.ci/execution_policy.py',
            '.ci/source_policy.py', '.ci/test_source_policy.py',
            '.ci/test_verify.py', '.ci/test_execution_policy.py',
        }
        self.assertFalse(classify(paths))

    def test_ambiguous_documentation_path_is_not_allowlisted(self):
        for path in ('docs/../src/main.md', 'docs//readme.md',
                     'docs/.hidden/run.md', '/docs/readme.md'):
            with self.subTest(path=path), self.assertRaisesRegex(ValueError, 'Unclassified source'):
                classify(set(BASELINE) | {path})


class WindowsIndexGuardTests(unittest.TestCase):
    def setUp(self):
        self.git = shutil.which('git')
        self.assertIsNotNone(self.git, 'Git must be available; no silent test skip')
        temporary = tempfile.TemporaryDirectory(prefix='cineforge-ci-index-')
        self.addCleanup(temporary.cleanup)
        self.repo = Path(temporary.name)
        self.env = {key: os.environ[key] for key in ('PATH', 'SYSTEMROOT', 'WINDIR', 'TEMP', 'TMP') if key in os.environ}
        self.env.update({'GIT_CONFIG_NOSYSTEM': '1', 'GIT_CONFIG_GLOBAL': os.devnull,
                         'GIT_CONFIG_SYSTEM': os.devnull, 'GIT_TERMINAL_PROMPT': '0'})
        self.run_git('init', '-q', check=True)
        (self.repo / 'source.txt').write_text('original\n', encoding='utf-8')
        self.run_git('add', 'source.txt', check=True)
        self.run_git('-c', 'user.name=CI regression', '-c', 'user.email=ci-regression@example.invalid',
                     '-c', 'commit.gpgsign=false', 'commit', '-qm', 'fixture', check=True)

    def run_git(self, *args, check=False):
        return subprocess.run([self.git, *args], cwd=self.repo, env=self.env,
                              capture_output=True, text=True, timeout=10, check=check)

    def run_actual_windows_git_guard(self):
        # Windows PowerShell executes these exact two Git commands and checks
        # each exit code. Exercise real Git worktree/index states locally too.
        script = WORKFLOW['jobs']['windows-package']['steps'][-1]['run']
        commands = [line for line in script.splitlines() if line.startswith('git diff ')]
        self.assertEqual(commands, ['git diff --exit-code', 'git diff --cached --exit-code'])
        for command in commands:
            self.assertIn(command + '\nif ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }', script)
            result = self.run_git(*shlex.split(command)[1:])
            if result.returncode:
                return result.returncode
        return 0

    def test_clean_checkout_passes_both_guards(self):
        self.assertEqual(self.run_actual_windows_git_guard(), 0)

    def test_unstaged_source_change_is_rejected(self):
        (self.repo / 'source.txt').write_text('changed\n', encoding='utf-8')
        self.assertNotEqual(self.run_actual_windows_git_guard(), 0)

    def test_staged_source_change_is_rejected(self):
        (self.repo / 'source.txt').write_text('changed\n', encoding='utf-8')
        self.run_git('add', 'source.txt', check=True)
        self.assertEqual(self.run_git('diff', '--exit-code').returncode, 0)
        self.assertNotEqual(self.run_git('diff', '--cached', '--exit-code').returncode, 0)
        self.assertNotEqual(self.run_actual_windows_git_guard(), 0)

    def test_ci_policy_rejects_removing_the_index_check(self):
        candidate = copy.deepcopy(WORKFLOW)
        candidate['jobs']['windows-package']['steps'][-1]['run'] = candidate['jobs']['windows-package']['steps'][-1]['run'].replace(
            '\ngit diff --cached --exit-code\nif ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }', '')
        with self.assertRaises(ValueError):
            check_policy(candidate)


if __name__ == '__main__':
    unittest.main()
