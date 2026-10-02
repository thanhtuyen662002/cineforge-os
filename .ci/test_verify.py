"""Adversarial tests for the bootstrap checks; no external dependencies."""
import copy
import json
from pathlib import Path
import unittest
from verify import BASELINE, RUNTIME, check_policy, classify, unique_pairs

ROOT = Path(__file__).resolve().parents[1]
WORKFLOW = json.loads((ROOT / '.github/workflows/cineforge-ci.yml').read_text())


class ScopeTests(unittest.TestCase):
    def test_docs_only_baseline_is_explicit(self):
        self.assertFalse(classify(set(BASELINE)))

    def test_complete_runtime(self):
        paths = set(BASELINE + RUNTIME) | {'core/example.test.mjs', 'app/src/example.test.tsx'}
        self.assertTrue(classify(paths))

    def test_missing_lock_cannot_skip_runtime(self):
        paths = set(BASELINE + RUNTIME) - {'app/package-lock.json'}
        with self.assertRaisesRegex(ValueError, 'Incomplete runtime'):
            classify(paths)

    def test_partial_runtime_fails(self):
        with self.assertRaisesRegex(ValueError, 'Incomplete runtime'):
            classify(set(BASELINE) | {'core/README.md'})

    def test_removed_runtime_fails(self):
        with self.assertRaisesRegex(ValueError, 'Runtime removal'):
            classify(set(BASELINE), set(BASELINE + RUNTIME))

    def test_missing_tests_fails(self):
        with self.assertRaisesRegex(ValueError, 'Core tests missing'):
            classify(set(BASELINE + RUNTIME))

    def test_baseline_missing_fails(self):
        with self.assertRaisesRegex(ValueError, 'Missing baseline'):
            classify(set(BASELINE) - {'AGENTS.md'})


class PolicyTests(unittest.TestCase):
    def setUp(self):
        self.workflow = copy.deepcopy(WORKFLOW)

    def rejected(self, message=None):
        with self.assertRaises(ValueError):
            check_policy(self.workflow)

    def test_positive_workflow(self):
        check_policy(self.workflow)

    def test_writable_token(self):
        self.workflow['permissions']['contents'] = 'write'
        self.rejected()

    def test_privileged_trigger(self):
        self.workflow['on']['pull_request_target'] = {}
        self.rejected()

    def test_paths_filter(self):
        self.workflow['on']['pull_request']['paths'] = ['core/**']
        self.rejected()

    def test_mutable_action(self):
        self.workflow['jobs']['policy']['steps'][0]['uses'] = 'actions/checkout@v4'
        self.rejected()

    def test_persisted_credentials(self):
        self.workflow['jobs']['policy']['steps'][0]['with']['persist-credentials'] = True
        self.rejected()

    def test_custom_checkout(self):
        self.workflow['jobs']['policy']['steps'][0]['with']['ref'] = 'main'
        self.rejected()

    def test_skip_failure(self):
        self.workflow['jobs']['core-app']['continue-on-error'] = True
        self.rejected()

    def test_step_skip_failure(self):
        self.workflow['jobs']['core-app']['steps'][2]['continue-on-error'] = True
        self.rejected()

    def test_aggregate_missing_dependency(self):
        self.workflow['jobs']['required']['needs'].remove('windows-package')
        self.rejected()

    def test_aggregate_does_not_run_on_failure(self):
        self.workflow['jobs']['required'].pop('if')
        self.rejected()

    def test_test_step_removed(self):
        self.workflow['jobs']['core-app']['steps'].pop(2)
        self.rejected()

    def test_runner_changed(self):
        self.workflow['jobs']['windows-package']['runs-on'] = 'self-hosted'
        self.rejected()

    def test_shell_context_injection(self):
        self.workflow['jobs']['core-app']['steps'][2]['run'] += '\necho ${{ github.event.pull_request.title }}'
        self.rejected()

    def test_secret_access(self):
        self.workflow['jobs']['core-app']['env'] = {'TOKEN': '${{ secrets.PRODUCTION }}'}
        self.rejected()

    def test_job_privilege(self):
        self.workflow['jobs']['core-app']['permissions'] = {'contents': 'write'}
        self.rejected()

    def test_duplicate_json_key(self):
        with self.assertRaisesRegex(ValueError, 'Duplicate'):
            json.loads('{"on": {}, "on": {}}', object_pairs_hook=unique_pairs)


if __name__ == '__main__':
    unittest.main()
