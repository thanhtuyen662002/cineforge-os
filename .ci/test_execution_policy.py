"""Regression tests for executable CI steps and real aggregate failure routing."""
import copy
import itertools
import json
import os
from pathlib import Path
import shutil
import subprocess
import unittest

from verify import check_policy
from execution_policy import AGGREGATE

ROOT = Path(__file__).resolve().parents[1]
WORKFLOW = json.loads((ROOT / '.github/workflows/cineforge-ci.yml').read_text(encoding='utf-8'))


class ExecutionPolicyTests(unittest.TestCase):
    def setUp(self):
        self.workflow = copy.deepcopy(WORKFLOW)

    def rejected(self):
        with self.assertRaises(ValueError):
            check_policy(self.workflow)

    def test_unchanged_workflow(self):
        check_policy(self.workflow)

    def test_display_name_change_is_not_execution_drift(self):
        self.workflow['jobs']['core-app']['steps'][2]['name'] = 'Core tests'
        check_policy(self.workflow)

    def test_conditional_steps_are_rejected(self):
        for job_id, job in WORKFLOW['jobs'].items():
            for index, step in enumerate(job['steps']):
                if 'run' not in step:
                    continue
                for condition in (False, 'false', '${{ false }}', 'success()'):
                    with self.subTest(job=job_id, step=index, condition=condition):
                        self.workflow = copy.deepcopy(WORKFLOW)
                        self.workflow['jobs'][job_id]['steps'][index]['if'] = condition
                        self.rejected()

    def test_mandatory_command_in_comment_is_rejected(self):
        self.workflow['jobs']['core-app']['steps'][2]['run'] = '# npm test --prefix core\necho skipped'
        self.rejected()

    def test_masked_command_failure_is_rejected(self):
        self.workflow['jobs']['core-app']['steps'][2]['run'] += ' || true'
        self.rejected()

    def test_command_moved_to_wrong_job_is_rejected(self):
        step = self.workflow['jobs']['core-app']['steps'].pop(2)
        self.workflow['jobs']['docs']['steps'].append(step)
        self.rejected()

    def test_test_execution_order_is_preserved(self):
        steps = self.workflow['jobs']['core-app']['steps']
        steps[3], steps[4] = steps[4], steps[3]
        self.rejected()

    def test_regression_suite_cannot_be_removed(self):
        self.workflow['jobs']['policy']['steps'].pop(2)
        self.rejected()

    def test_runtime_output_cannot_be_literal_or_rebound(self):
        for value in ('false', False, 'true', '${{ steps.other.outputs.runtime }}'):
            with self.subTest(value=value):
                self.workflow = copy.deepcopy(WORKFLOW)
                self.workflow['jobs']['policy']['outputs']['runtime'] = value
                self.rejected()

    def test_context_step_identity_is_pinned(self):
        self.workflow['jobs']['policy']['steps'][3]['id'] = 'other'
        self.rejected()

    def test_forged_result_binding_is_rejected(self):
        for key in WORKFLOW['jobs']['required']['env']:
            with self.subTest(key=key):
                self.workflow = copy.deepcopy(WORKFLOW)
                self.workflow['jobs']['required']['env'][key] = 'success'
                self.rejected()

    def test_aggregate_body_cannot_be_noop(self):
        self.workflow['jobs']['required']['steps'][0]['run'] = 'echo PASS'
        self.rejected()

    def test_aggregate_env_cannot_be_overridden_per_step(self):
        self.workflow['jobs']['required']['steps'][0]['env'] = {'WINDOWS': 'success'}
        self.rejected()

    def test_extra_aggregate_step_is_rejected(self):
        self.workflow['jobs']['required']['steps'].insert(0, {'run': 'echo WINDOWS=success >> "$GITHUB_ENV"'})
        self.rejected()

    def test_job_dependencies_cannot_be_removed(self):
        self.workflow['jobs']['docs']['needs'] = []
        self.rejected()

    def test_checkout_cannot_be_removed_or_skipped(self):
        for job_id in ('policy', 'docs', 'core-app', 'windows-package'):
            for mutation in ('remove', 'skip'):
                with self.subTest(job=job_id, mutation=mutation):
                    self.workflow = copy.deepcopy(WORKFLOW)
                    steps = self.workflow['jobs'][job_id]['steps']
                    if mutation == 'remove':
                        steps.pop(0)
                    else:
                        steps[0]['if'] = 'false'
                    self.rejected()

    def test_step_working_directory_is_rejected(self):
        self.workflow['jobs']['core-app']['steps'][2]['working-directory'] = 'fixture'
        self.rejected()

    def test_custom_shell_is_rejected(self):
        self.workflow['jobs']['core-app']['steps'][2]['shell'] = 'echo {0}'
        self.rejected()

    def test_workflow_defaults_are_rejected(self):
        self.workflow['defaults'] = {'run': {'shell': 'echo {0}'}}
        self.rejected()

    def test_job_container_and_defaults_are_rejected(self):
        for key, value in (('container', 'unreviewed:latest'), ('defaults', {'run': {'shell': 'echo {0}'}})):
            with self.subTest(key=key):
                self.workflow = copy.deepcopy(WORKFLOW)
                self.workflow['jobs']['core-app'][key] = value
                self.rejected()

    def test_bash_env_injection_is_rejected(self):
        self.workflow['env']['BASH_ENV'] = 'malicious.sh'
        self.rejected()

    def test_runtime_pin_cannot_silently_drift(self):
        self.workflow['jobs']['core-app']['steps'][1]['with']['node-version'] = 'latest'
        self.rejected()

    def test_global_concurrency_cannot_cancel_other_branches(self):
        self.workflow['concurrency']['group'] = 'global'
        self.rejected()


class AggregateExecutionTests(unittest.TestCase):
    def test_real_shell_failure_matrix(self):
        bash = shutil.which('bash')
        self.assertIsNotNone(bash, 'Aggregate regression requires Bash; it must not silently skip')
        # Execute the ACTUAL workflow body, not a Python reimplementation.
        script = WORKFLOW['jobs']['required']['steps'][0]['run']
        self.assertEqual(script, AGGREGATE)
        keys = ('POLICY', 'DOCS', 'RUNTIME', 'CORE_APP', 'WINDOWS')
        passing = {
            ('success', 'success', 'true', 'success', 'success'),
            ('success', 'success', 'false', 'skipped', 'skipped'),
        }
        states = ('success', 'failure', 'cancelled', 'skipped', 'timed_out', 'unknown', '')
        cases = set(passing)
        for baseline in passing:
            for index in range(len(keys)):
                values = states if keys[index] != 'RUNTIME' else ('true', 'false', '', 'unknown', '0', 'FALSE')
                for value in values:
                    candidate = list(baseline)
                    candidate[index] = value
                    cases.add(tuple(candidate))
        # All four combinations of skipped/success product jobs are covered for
        # both scope values; a docs-only bypass must not accept executed jobs.
        for runtime, core, windows in itertools.product(('true', 'false', ''), ('success', 'skipped'), ('success', 'skipped')):
            cases.add(('success', 'success', runtime, core, windows))
        for case in sorted(cases):
            with self.subTest(case=case):
                env = {key: os.environ[key] for key in ('PATH', 'SYSTEMROOT', 'WINDIR', 'TEMP', 'TMP') if key in os.environ}
                env.update(dict(zip(keys, case)))
                result = subprocess.run([bash, '--noprofile', '--norc', '-c', script], env=env,
                                        capture_output=True, text=True, timeout=5)
                self.assertEqual(result.returncode == 0, case in passing, result.stdout + result.stderr)
                if case not in passing:
                    self.assertNotIn('CINEFORGE_REQUIRED=PASS', result.stdout)
        print(f'AGGREGATE_EXECUTION_CASES={len(cases)}')


if __name__ == '__main__':
    unittest.main()
