"""Offline regression tests for publication identity reconciliation."""
import unittest
import publish


def issue(number=15, marker='US-001', **overrides):
    row = {'number': number, 'html_url': f'{publish.render.WEB}/issues/{number}',
           'state': 'open', 'body': f'<!-- ams:{marker} -->\nHuman-reviewed content'}
    row.update(overrides)
    return row


class FakeGitHub:
    def __init__(self, rows, direct=None):
        self.rows = rows
        self.direct = direct or {}
        self.calls = []

    def pages(self, resource, state=False):
        assert resource == 'issues' and state is True
        return self.rows

    def call(self, method, endpoint, payload=None):
        self.calls.append((method, endpoint))
        assert method == 'GET', 'Reconciliation must never write issues'
        result = self.direct[endpoint]
        if isinstance(result, Exception):
            raise result
        return result


class ReconciliationTests(unittest.TestCase):
    def setUp(self):
        self.row = issue()
        self.mapping = {'US-001': publish.identity(self.row)}

    def reconcile(self, gh):
        return publish.reconcile_issues(gh, self.mapping, {'US-001'})

    def test_complete_list_needs_no_extra_reads(self):
        gh = FakeGitHub([self.row])
        self.assertEqual(self.reconcile(gh)['US-001'], self.row)
        self.assertEqual(gh.calls, [])

    def test_missing_list_item_uses_known_number_without_writes(self):
        gh = FakeGitHub([], {'issues/15': self.row})
        self.assertEqual(self.reconcile(gh)['US-001'], self.row)
        self.assertEqual(gh.calls, [('GET', 'issues/15')])

    def test_preserves_closed_state_and_human_content(self):
        row = issue(state='closed', body='<!-- ams:US-001 -->\nUpdated by reviewer')
        self.assertEqual(self.reconcile(FakeGitHub([], {'issues/15': row}))['US-001'], row)

    def test_missing_direct_read_fails_without_recreating(self):
        gh = FakeGitHub([], {'issues/15': RuntimeError('404')})
        with self.assertRaisesRegex(RuntimeError, '404'):
            self.reconcile(gh)
        self.assertEqual(gh.calls, [('GET', 'issues/15')])

    def test_wrong_marker_is_rejected(self):
        with self.assertRaisesRegex(ValueError, 'marker mismatch'):
            self.reconcile(FakeGitHub([], {'issues/15': issue(marker='US-002')}))

    def test_changed_number_is_rejected(self):
        with self.assertRaisesRegex(ValueError, 'identity changed'):
            self.reconcile(FakeGitHub([issue(number=99)]))

    def test_changed_url_is_rejected(self):
        with self.assertRaisesRegex(ValueError, 'identity changed'):
            self.reconcile(FakeGitHub([issue(html_url='https://example.org/15')]))

    def test_duplicate_markers_are_rejected(self):
        with self.assertRaisesRegex(ValueError, 'Duplicate durable issue marker'):
            self.reconcile(FakeGitHub([self.row, issue(number=99)]))

    def test_pull_request_is_not_accepted_as_issue(self):
        with self.assertRaisesRegex(ValueError, 'marker mismatch'):
            self.reconcile(FakeGitHub([], {'issues/15': issue(pull_request={})}))

    def test_extra_marker_is_rejected_on_fallback(self):
        row = issue(body='<!-- ams:US-001 -->\n<!-- ams:US-002 -->')
        with self.assertRaisesRegex(ValueError, 'marker mismatch'):
            self.reconcile(FakeGitHub([], {'issues/15': row}))


if __name__ == '__main__':
    unittest.main()
