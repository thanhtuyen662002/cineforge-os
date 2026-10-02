"""Intentional CI bootstrap negative control. NEVER MERGE this branch."""
import unittest


class ControlledFailure(unittest.TestCase):
    def test_ci_propagates_a_real_test_failure(self):
        self.fail("EXPECTED_BOOTSTRAP_FAILURE: the aggregate check must be red")
