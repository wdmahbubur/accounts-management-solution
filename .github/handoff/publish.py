"""One-shot, idempotent publication of the user-approved AMS docs and backlog.
No application deployment, Supabase mutation, secrets export or payments.
Run --check with a local fixture to validate without any network writes.
"""
from __future__ import annotations
import argparse
import base64
import hashlib
import json
import lzma
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
from pathlib import Path, PurePosixPath
import render

ARCHIVE_SHA = '74cbabbc4988e4ce5a2840e3d94284f7bbbee5c872e4c09c6b0a74bf73e31501'
SEED_HASHES = {
 'stories-01.psv': '0b9aad62a7a8e1037aa8329001f03ad4d75a14eb672339e75ac01346d164c114',
 'stories-02.psv': '8eb62e6bd3f23eca9d6e01bdf08d25d7391a13b267497a7011f242ec30f58b3a',
 'stories-03.psv': '580736b568dc6a783ab15a0679ad2c6d448a1a223079dc6fbef600811520889b',
}
MARKER = re.compile(r'<!-- ams:(US-\d{3}|E\d{2}|ROADMAP) -->')
PLACEHOLDER = '<!-- ams:bootstrap:placeholder -->'


def digest(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def write(root: Path, name: str, text: str, preserve: bool = False) -> None:
    rel = PurePosixPath(name)
    if rel.is_absolute() or '..' in rel.parts:
        raise ValueError('Unsafe output path')
    target = root / name
    if not target.resolve().is_relative_to(root.resolve()):
        raise ValueError('Output escapes repository')
    if target.is_symlink():
        raise ValueError('Refusing symlink output')
    data = text.encode('utf-8')
    if preserve and target.exists() and target.read_bytes() != data:
        raise ValueError(f'Refusing to overwrite modified original: {name}')
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(data)


def load_sources(root: Path) -> tuple[dict, dict]:
    staging = root / '.github/handoff'
    request = json.loads((staging / 'publish-request.json').read_text(encoding='utf-8'))
    if request.get('repository') != render.REPO or request.get('source_sha256') != ARCHIVE_SHA:
        raise ValueError('Publication request does not match this approved repository/source')
    parts = sorted(staging.glob('source-part-*.b64'))
    if [p.name for p in parts] != [f'source-part-{i:02d}.b64' for i in range(1, 9)]:
        raise ValueError('Expected exactly eight complete source parts')
    raw = base64.b64decode(''.join(p.read_text().strip() for p in parts), validate=True)
    if digest(raw) != ARCHIVE_SHA:
        raise ValueError('Original source checksum mismatch')
    files = json.loads(lzma.decompress(raw).decode('utf-8'))
    if len(files) != 20 or sum(p.endswith('.md') for p in files) != 11:
        raise ValueError('Unexpected original source file count')
    for name, text in files.items():
        if not name.startswith('docs/') or not isinstance(text, str):
            raise ValueError('Source archive contains an unexpected destination')
        write(root, name, text, preserve=True)
    for name, expected in SEED_HASHES.items():
        if digest((staging / name).read_bytes()) != expected:
            raise ValueError(f'Story seed checksum mismatch: {name}')
    hashes = {name: digest(text.encode('utf-8')) for name, text in files.items()}
    write(root, 'docs/source-file-hashes.json', json.dumps(hashes, indent=2) + '\n')
    return files, hashes


def reference_checks(root: Path) -> dict:
    # The original static checker writes a JSON result; run in a disposable copy
    # so the published source handoff is preserved byte-for-byte.
    with tempfile.TemporaryDirectory(prefix='ams-reference-') as td:
        docs = Path(td) / 'docs'
        shutil.copytree(root / 'docs', docs)
        a = subprocess.run([sys.executable, '-m', 'unittest', 'discover', '-s', str(docs / 'tests'), '-v'],
                           capture_output=True, text=True, timeout=90)
        b = subprocess.run([sys.executable, str(docs / 'verification/check_spec.py')],
                           capture_output=True, text=True, timeout=90)
        if a.returncode or b.returncode:
            raise RuntimeError('Reference/artifact checks failed:\n' + a.stdout + a.stderr + b.stdout + b.stderr)
        result = json.loads((docs / 'verification/static-checks.json').read_text())
        match = re.search(r'Ran (\d+) tests', a.stderr)
        if not match or int(match[1]) != 35 or result['checks_passed'] != 24 or result['checks_total'] != 24:
            raise ValueError('Unexpected reference verification counts')
        output = {
            'scope': 'Reference model and static artifacts only; no application, SQL execution, RLS, races, browser, billing or restore testing',
            'reference_tests_passed': 35, 'reference_tests_total': 35,
            'static_checks_passed': 24, 'static_checks_total': 24,
            'reference_output': a.stdout + a.stderr, 'static_output': b.stdout + b.stderr,
        }
    write(root, 'docs/verification/publication-reference-checks.json', json.dumps(output, indent=2) + '\n')
    return output


class GitHub:
    def __init__(self, token: str):
        self.token = token
        self.base = f'https://api.github.com/repos/{render.REPO}/'
        self.last_write = 0.0

    def call(self, method: str, endpoint: str, payload: dict | None = None):
        if method != 'GET':
            time.sleep(max(0, 1.25 - (time.monotonic() - self.last_write)))
        for attempt in range(7):
            data = None if payload is None else json.dumps(payload).encode('utf-8')
            req = urllib.request.Request(self.base + endpoint, data=data, method=method, headers={
                'Authorization': 'Bearer ' + self.token,
                'Accept': 'application/vnd.github+json', 'Content-Type': 'application/json',
                'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'ams-authorized-handoff',
            })
            try:
                with urllib.request.urlopen(req, timeout=60) as response:
                    body = response.read()
                    if method != 'GET':
                        self.last_write = time.monotonic()
                    return json.loads(body) if body else None
            except urllib.error.HTTPError as exc:
                text = exc.read().decode('utf-8', errors='replace')
                limited = exc.code == 429 or (exc.code == 403 and 'rate limit' in text.lower())
                if limited and attempt < 6:
                    pause = min(120, max(10 * (attempt + 1), int(exc.headers.get('Retry-After', '0'))))
                    print(f'GitHub rate limit: bounded retry in {pause}s', flush=True)
                    time.sleep(pause)
                    continue
                # Do not blindly retry potentially committed issue POSTs. A rerun
                # discovers durable hidden markers and reuses existing issues.
                raise RuntimeError(f'GitHub {method} {endpoint} failed ({exc.code}); rerun is marker-idempotent. '
                                   + text[:350].replace(self.token, '[REDACTED]')) from None
            except (urllib.error.URLError, TimeoutError) as exc:
                raise RuntimeError(f'GitHub {method} {endpoint} network failure; inspect and rerun to recover without duplicate issue creation.') from None
        raise RuntimeError('GitHub request retry budget exhausted')

    def pages(self, resource: str, state: bool = False) -> list:
        result = []
        for page in range(1, 101):
            rows = self.call('GET', f'{resource}?per_page=100&page={page}' + ('&state=all' if state else ''))
            if not isinstance(rows, list):
                raise ValueError(f'Unexpected list response for {resource}')
            result.extend(rows)
            if len(rows) < 100:
                return result
        raise RuntimeError('Pagination bound exceeded')


def git_publish(root: Path, token: str, message: str) -> str:
    def git(*args: str):
        return subprocess.run(['git', *args], cwd=root, capture_output=True, text=True, timeout=120)
    r = git('add', '--', 'docs')
    if r.returncode:
        raise RuntimeError('Could not stage documentation')
    status = git('diff', '--cached', '--quiet')
    if status.returncode == 1:
        r = git('commit', '-m', message)
        if r.returncode:
            raise RuntimeError('Could not commit documentation')
    elif status.returncode:
        raise RuntimeError('Could not inspect staged documentation')
    auth = base64.b64encode(('x-access-token:' + token).encode()).decode()
    r = git('-c', 'http.https://github.com/.extraheader=AUTHORIZATION: basic ' + auth,
            'push', 'origin', 'HEAD:master')
    if r.returncode:
        raise RuntimeError('Non-forced documentation push failed; preserve concurrent changes and inspect the remote branch. '
                           + r.stderr.replace(token, '[REDACTED]').replace(auth, '[REDACTED]')[:500])
    sha = git('rev-parse', 'HEAD')
    if sha.returncode:
        raise RuntimeError('Could not resolve documentation commit')
    return sha.stdout.strip()


def managed_issues(rows: list) -> dict:
    result = {}
    for issue in rows:
        if 'pull_request' in issue:
            continue
        keys = MARKER.findall(issue.get('body') or '')
        for key in keys:
            if key in result:
                raise ValueError(f'Duplicate durable issue marker: {key}')
            result[key] = issue
    return result


def identity(issue: dict) -> dict:
    return {'number': issue['number'], 'url': issue['html_url'], 'state': issue['state']}


def reconcile_issues(gh: GitHub, mapping: dict, expected_keys: set) -> dict:
    """Verify durable identities without trusting immediate list visibility.

    The list endpoint can lag just-completed creates. Use the issue number
    returned by the original write for a read-only fallback, never another POST.
    Keep rejecting duplicate markers, changed identities and missing records.
    """
    actual = managed_issues(gh.pages('issues', state=True))
    for key in sorted(expected_keys):
        known = mapping[key]
        if key not in actual:
            issue = gh.call('GET', f'issues/{known["number"]}')
            found = managed_issues([issue])
            if set(found) != {key}:
                raise ValueError(f'Published issue marker mismatch: {key} #{known["number"]}')
            actual[key] = found[key]
        issue = actual[key]
        if issue['number'] != known['number'] or issue['html_url'] != known['url']:
            raise ValueError(f'Published issue identity changed: {key}')
    return actual


def create_labels_and_milestones(gh: GitHub) -> dict:
    colors = {'type:story': '1D76DB', 'type:epic': '5319E7', 'type:roadmap': '0052CC',
              'priority:P0': 'B60205', 'priority:P1': 'FBCA04', 'priority:P2': 'C2E0C6',
              'phase:v1': '0E8A16', 'phase:post-v1': 'D4C5F9',
              'status:ready': '0E8A16', 'status:blocked': 'D93F0B', 'needs:human-review': 'FEF2C0'}
    colors.update({f'epic:E{e}': 'BFD4F2' for e in render.EPICS})
    existing = {x['name'] for x in gh.pages('labels')}
    for name, color in colors.items():
        if name not in existing:
            gh.call('POST', 'labels', {'name': name, 'color': color,
                    'description': 'AMS backlog grouping; readiness labels are initial snapshots, not automatic dependency state.'})
    milestones = {x['title']: x for x in gh.pages('milestones', state=True)}
    result = {}
    for number, (title, description) in render.MILESTONES.items():
        if title not in milestones:
            milestones[title] = gh.call('POST', 'milestones', {'title': title, 'description': description})
        result[number] = milestones[title]
    return result


def master_body(mapping: dict) -> str:
    lines = ['<!-- ams:ROADMAP -->', '# Accounts Management Solution — master implementation tracker', '',
             '**100 stories: 88 V1 implementation/review gates and 12 post-V1 discovery stories.** '
             'Grouped into 14 epic trackers and eight milestones. All are planning items, not implemented features.', '',
             f'Read [AGENTS.md]({render.WEB}/blob/master/AGENTS.md), [complete source docs]({render.WEB}/tree/master/docs), '
             f'[story roadmap]({render.DOC}10-implementation-roadmap.md), [AI execution guide]({render.DOC}11-ai-execution-guide.md), '
             f'and [source coverage]({render.DOC}12-coverage-matrix.md).', '', '## Start',
             f'Owner/accountant scope review: {render.issue_link("US-001", mapping)}. Reproducible repository setup: {render.issue_link("US-002", mapping)}.',
             'Follow actual prerequisite links, not ascending issue numbers. Shared approval/storage primitives occur earlier than their epic numbers suggest. '
             'The first accounting vertical slice must pass before daily finance expansion.', '', '## Epic checklist']
    lines.extend(f'- [ ] {render.issue_link("E"+e, mapping)} — {title}.' for e, title in render.EPICS.items())
    lines.extend(['', '## Release boundaries', 'No real accounting application, production migration/deployment, billing integration, payment execution or professional sign-off is completed by this setup. '
                  'Original reference tests cover selected arithmetic and artifact consistency only. Real DB, authorization, race, browser, provider and recovery tests belong to implementation stories.', '',
                  'Initial labels and checklists are not auto-updated and are not native GitHub blocking relations. '
                  'Do not close this tracker until all approved V1 gates are satisfied; post-V1 discovery remains separately scoped.'])
    return '\n'.join(lines) + '\n'


def publish_issues(gh: GitHub, stories: list, order: list, refs: dict) -> tuple[dict, dict]:
    milestones = create_labels_and_milestones(gh)
    existing = managed_issues(gh.pages('issues', state=True))
    mapping = {key: identity(issue) for key, issue in existing.items()}
    snapshots = dict(existing)
    def ensure(key: str, title: str, body: str, labels: list, milestone: int):
        if key in existing:
            issue = existing[key]
        else:
            issue = gh.call('POST', 'issues', {'title': title, 'body': body, 'labels': labels,
                            'milestone': milestones[milestone]['number']})
            existing[key] = issue
        mapping[key] = identity(issue)
        snapshots[key] = issue
        return issue
    for e, title in render.EPICS.items():
        group = [s for s in stories if s['epic'] == 'E' + e]
        ensure('E'+e, f'[E{e}] {title}', f'<!-- ams:E{e} -->\n{PLACEHOLDER}\n# {title}\n\nThe bootstrap is attaching the approved child stories. This is a planning tracker, not completed work.\n',
               ['type:epic', 'epic:E'+e, 'phase:post-v1' if e == '13' else 'phase:v1',
                'priority:P2' if e == '13' else 'priority:P0'], min(s['milestone'] for s in group))
    by_id = {s['id']: s for s in stories}
    for index, sid in enumerate(order, 1):
        s = by_id[sid]
        ensure(sid, f'[{sid}] {s["title"]}', render.story_body(s, refs, mapping), render.labels_for(s), s['milestone'])
        if index % 10 == 0:
            print(f'Published/reused {index}/100 story issues', flush=True)
    for e in render.EPICS:
        key = 'E' + e
        issue = snapshots[key]
        expected = render.epic_body(key, stories, mapping)
        if PLACEHOLDER in (issue.get('body') or ''):
            issue = gh.call('PATCH', f'issues/{issue["number"]}', {'body': expected})
            snapshots[key] = issue
        elif issue.get('body') != expected:
            children = [s for s in stories if s['epic'] == key]
            if any(mapping[s['id']]['url'] not in (issue.get('body') or '') for s in children):
                raise RuntimeError(f'{key} has modified content without all required child links; reconcile rather than overwrite it')
    ensure('ROADMAP', '[ROADMAP] V1 implementation, AI handoff and release gates', master_body(mapping),
           ['type:roadmap', 'priority:P0', 'phase:v1'], 6)
    expected_keys = set(render.EPICS)
    expected_keys = {'E'+e for e in expected_keys} | {s['id'] for s in stories} | {'ROADMAP'}
    actual = reconcile_issues(gh, mapping, expected_keys)
    if len({actual[k]['number'] for k in expected_keys}) != 115:
        raise ValueError('Expected 115 distinct managed issues')
    for s in stories:
        issue = actual[s['id']]
        body = issue.get('body') or ''
        if any(mapping[d]['url'] not in body for d in s['depends_on']):
            raise ValueError(f'Missing actual prerequisite links in {s["id"]}')
        if mapping[s['epic']]['url'] not in body:
            raise ValueError(f'Missing actual epic link in {s["id"]}')
    return {k: identity(actual[k]) for k in expected_keys}, {k: actual[k] for k in expected_keys}


def make_outputs(root: Path, files: dict, hashes: dict, stories: list, order: list, refs: dict,
                 mapping: dict, snapshots: dict, checks: dict, source_commit: str, dry: bool) -> None:
    issue_map = dict(sorted(mapping.items()))
    write(root, 'docs/issue-map.json', json.dumps(issue_map, indent=2, ensure_ascii=False) + '\n')
    catalogue = {'schema_version': 1, 'source_version': '1.0 (29 September 2026)', 'repository': render.REPO,
                 'scope': 'Initial publication snapshot; subsequent progress lives in GitHub and merged code',
                 'stories': [dict(s, issue=mapping[s['id']]) for s in stories], 'topological_order': order,
                 'epics': render.EPICS, 'milestones': render.MILESTONES, 'coverage': render.coverage_map(stories, refs)}
    write(root, 'docs/backlog.json', json.dumps(catalogue, indent=2, ensure_ascii=False) + '\n')
    for s in stories:
        issue = snapshots[s['id']]
        body = issue.get('body') or render.story_body(s, refs, mapping)
        write(root, f'docs/user-stories/{s["id"]}.md', f'> Initial issue snapshot: {mapping[s["id"]]["url"]}\n> Subsequent discussion/state is on GitHub; this file is not automatically synchronized.\n\n' + body)
    write(root, 'docs/user-stories/README.md', '# User-story snapshots\n\n100 initial GitHub story bodies. Read [the roadmap](../10-implementation-roadmap.md), [AI guide](../11-ai-execution-guide.md) and [AGENTS.md](../../AGENTS.md).\n\nLive issue progress is on GitHub; these are not continuous mirrors. US-001..US-088 cover V1 implementation/review gates. US-089..US-100 are discovery only.\n')
    write(root, 'docs/10-implementation-roadmap.md', render.roadmap(stories, order, mapping) + f'\nMaster tracker: {mapping["ROADMAP"]["url"]}\n')
    write(root, 'docs/12-coverage-matrix.md', render.coverage_md(stories, refs, mapping))
    for name, expected in hashes.items():
        if digest((root / name).read_bytes()) != expected:
            raise ValueError(f'Original source changed during publication: {name}')
    run_url = f'{render.WEB}/actions/runs/{os.environ.get("GITHUB_RUN_ID", "local-check")}'
    report = {
        'mode': 'offline dry-run; no actual issues created' if dry else 'live GitHub API publication',
        'source_archive_sha256': ARCHIVE_SHA, 'original_files': len(files), 'original_markdown_files': 11,
        'original_files_preserved': True, 'story_count': 100, 'v1_story_count': 88, 'post_v1_discovery_count': 12,
        'epic_count': 14, 'master_tracker_count': 1, 'distinct_managed_issues': len(mapping), 'milestone_count': 8,
        'dependency_graph_acyclic': True, 'all_source_references_resolved': True,
        'coverage_counts': {k: len(v) for k, v in refs.items()},
        'reference_checks': {k: v for k, v in checks.items() if not k.endswith('_output')},
        'source_commit': source_commit, 'workflow_run': run_url,
        'application_implemented': False, 'production_or_supabase_changed': False,
    }
    write(root, 'docs/verification/publication.json', json.dumps(report, indent=2, ensure_ascii=False) + '\n')
    text = f'''# Documentation and backlog publication verification

## Scope

This records documentation/backlog setup, not application delivery. Mode: **{report['mode']}**.

## Verified before final publication

- 20 original engineering text files retained byte-for-byte, including all 11 original Markdown files; hashes are in `source-file-hashes.json`.
- 100 stories: 88 V1 implementation/review gates and 12 post-V1 discovery items.
- 14 epic trackers, one master tracker, 115 distinct managed issue identities and eight milestones.
- All story prerequisite IDs resolve, the dependency graph has no cycles, and issue bodies contain actual GitHub prerequisite/epic links.
- All 19 FR groups, 54 UI groups, 18 DB guards and 72 acceptance/security cases have V1 story ownership.
- 35/35 Python reference-model tests and 24/24 static artifact checks pass in an isolated copy of the source package.

Source-document commit: `{source_commit}`.
Publication workflow: {run_url}
Master tracker: {mapping['ROADMAP']['url']}

The workflow performs a non-forced final push and verifies the remote Git tree matches every original source file and all 100 story snapshots. Its job log/summary records the final commit and remote-tree result. This document is written before that final push; use the workflow result and commit for delivery verification.

## Important limits

No application scaffold, real PostgreSQL migration, posting routine, RLS/race/browser/load/provider/restore test, independent accounting approval or production deployment was performed by this setup. The 52 business and 20 security/concurrency cases are assigned implementation requirements, not 72 passing app tests. Source SQL remains a reference until its implementation stories pass real database verification.

Initial labels/checklists are planning snapshots, not live dependency automation or native GitHub blocking/sub-issue relationships. GitHub discussions and merged code are authoritative for future progress. Existing human-edited issues are preserved on a rerun; bootstrap publication never reopens completed issues.
'''
    write(root, 'docs/13-publication-verification.md', text)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument('--check', action='store_true', help='Offline fixture validation; no API or git writes')
    parser.add_argument('--root', type=Path, default=Path.cwd())
    args = parser.parse_args()
    root = args.root.resolve()
    files, hashes = load_sources(root)
    refs = render.references(root / 'docs')
    stories, order = render.parse_catalog(root / '.github/handoff', refs)
    checks = reference_checks(root)
    print('Validated original source, 100-story DAG, complete source coverage, 35 reference and 24 static checks', flush=True)
    if args.check:
        mapping = {'E'+e: {'number': i+1, 'url': f'{render.WEB}/issues/{i+1}', 'state': 'open'} for i, e in enumerate(render.EPICS)}
        for i, sid in enumerate(order, 15):
            mapping[sid] = {'number': i, 'url': f'{render.WEB}/issues/{i}', 'state': 'open'}
        mapping['ROADMAP'] = {'number': 115, 'url': f'{render.WEB}/issues/115', 'state': 'open'}
        snapshots = {s['id']: {'body': render.story_body(s, refs, mapping)} for s in stories}
        make_outputs(root, files, hashes, stories, order, refs, mapping, snapshots, checks, 'offline-not-published', True)
        print('Offline output validation complete; GitHub untouched', flush=True)
        return 0
    if os.environ.get('GITHUB_REPOSITORY') != render.REPO or os.environ.get('TARGET_BRANCH') != 'master':
        raise ValueError('Unexpected repository or target branch')
    token = os.environ.get('GH_TOKEN')
    if not token:
        raise ValueError('The workflow-scoped GitHub token is required')
    source_commit = git_publish(root, token, 'docs: preserve complete original PRD, schema, rules, UI and reference checks')
    print(f'Original documentation pushed: {source_commit}', flush=True)
    gh = GitHub(token)
    mapping, snapshots = publish_issues(gh, stories, order, refs)
    make_outputs(root, files, hashes, stories, order, refs, mapping, snapshots, checks, source_commit, False)
    final_commit = git_publish(root, token, 'docs: publish 100 linked AI-ready stories, dependency roadmap and coverage evidence')
    tree = gh.call('GET', f'git/trees/{final_commit}?recursive=1')
    if tree.get('truncated'):
        raise RuntimeError('Cannot verify a truncated remote tree')
    remote = {row['path']: row['sha'] for row in tree['tree'] if row['type'] == 'blob'}
    expected_files = list(files) + [f'docs/user-stories/{s["id"]}.md' for s in stories]
    for name in expected_files:
        data = (root / name).read_bytes()
        blob = hashlib.sha1(f'blob {len(data)}\0'.encode() + data).hexdigest()
        if remote.get(name) != blob:
            raise RuntimeError(f'Remote file verification failed: {name}')
    summary = (f'# AMS handoff publication completed\n\nFinal commit: `{final_commit}`\n\n'
               f'Master tracker: {mapping["ROADMAP"]["url"]}\n\n'
               '100 story issues + 14 epic trackers + 1 master tracker = 115 managed issues; eight milestones.\n\n'
               'All 20 original source files and 100 story snapshots match the remote Git tree. '
               'All 11 original Markdown files are under docs/.\n\n'
               '100-story acyclic dependency graph; coverage: 19 FR, 54 UI, 18 guards, 52 business + 20 security cases.\n\n'
               '35 reference-model tests and 24 static artifact checks passed. No real application, SQL, RLS, race, browser, billing, load or restore tests were run.\n')
    Path('/tmp/ams-publication-summary.md').write_text(summary, encoding='utf-8')
    print(summary, flush=True)
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
